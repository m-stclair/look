import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONFIG } from "../src/config.js";
import {
  LOOK_VERSION,
  configFingerprint,
  createLook,
  nextCopyName,
  parseLookJson,
  serializeLookConfig,
  slugifyLookName
} from "../src/look-serialization.js";

test("serializeLookConfig writes every shader-facing config key", () => {
  const config = serializeLookConfig({exposure: 1.25, gamma: 1.4});
  assert.deepEqual(Object.keys(config), Object.keys(DEFAULT_CONFIG));
  assert.equal(config.exposure, 1.25);
  assert.equal(config.gamma, 1.4);
  assert.equal(config.tintStrength, DEFAULT_CONFIG.tintStrength);
});

test("createLook normalizes name, version, and config", () => {
  const look = createLook({id: "look-test", name: "  Warm   Thing  ", config: {tintStrength: 0.3}});
  assert.equal(look.id, "look-test");
  assert.equal(look.version, LOOK_VERSION);
  assert.equal(look.name, "Warm Thing");
  assert.equal(look.config.tintStrength, 0.3);
  assert.equal(look.config.exposure, DEFAULT_CONFIG.exposure);
});

test("parseLookJson accepts a single exported look", () => {
  const [look] = parseLookJson(JSON.stringify({name: "Imported", config: {exposure: -0.4}}));
  assert.equal(look.name, "Imported");
  assert.equal(look.config.exposure, -0.4);
  assert.equal(look.builtIn, false);
});

test("parseLookJson accepts a look bundle", () => {
  const looks = parseLookJson(JSON.stringify({looks: [
    {name: "One", config: {gamma: 0.9}},
    {name: "Two", config: {gamma: 1.2}}
  ]}));
  assert.deepEqual(looks.map(look => look.name), ["One", "Two"]);
});

test("configFingerprint is stable for equivalent partial configs", () => {
  assert.equal(configFingerprint({exposure: 1}), configFingerprint({...DEFAULT_CONFIG, exposure: 1}));
});

test("helpers create clean filenames and copy names", () => {
  assert.equal(slugifyLookName("Warm Soft Contrast!"), "warm-soft-contrast");
  assert.equal(nextCopyName("Warm Soft Contrast", ["Warm Soft Contrast copy"]), "Warm Soft Contrast copy 2");
});
