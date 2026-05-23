import assert from "node:assert/strict";
import test from "node:test";
import { createLook } from "../src/look-serialization.js";
import { LOOK_STORAGE_KEY, loadUserLooks, saveUserLooks } from "../src/look-storage.js";

function fakeStorage() {
  const store = new Map();
  return {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); }
  };
}

test("saveUserLooks persists normalized user looks", () => {
  const storage = fakeStorage();
  const look = createLook({id: "look-a", name: "A", config: {exposure: 0.5}});
  assert.equal(saveUserLooks([look], storage), true);
  const raw = JSON.parse(storage.getItem(LOOK_STORAGE_KEY));
  assert.equal(raw.length, 1);
  assert.equal(raw[0].builtIn, undefined);
  assert.equal(raw[0].config.exposure, 0.5);
});

test("loadUserLooks ignores malformed storage", () => {
  const storage = fakeStorage();
  storage.setItem(LOOK_STORAGE_KEY, "not json");
  assert.deepEqual(loadUserLooks(storage), []);
});

test("loadUserLooks dedupes by id and sorts by name", () => {
  const storage = fakeStorage();
  storage.setItem(LOOK_STORAGE_KEY, JSON.stringify([
    {id: "b", name: "Zed", config: {}},
    {id: "a", name: "Alpha", config: {}},
    {id: "b", name: "Beta", config: {exposure: 1}}
  ]));
  const looks = loadUserLooks(storage);
  assert.deepEqual(looks.map(look => look.name), ["Alpha", "Beta"]);
  assert.equal(looks.find(look => look.id === "b").config.exposure, 1);
});
