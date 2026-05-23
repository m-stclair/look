import { normalizeLook } from "./look-serialization.js";

export const LOOK_STORAGE_KEY = "look-minimal.userLooks.v1";

export function loadUserLooks(storage = globalThis.localStorage) {
  if (!storage) return [];
  try {
    const raw = storage.getItem(LOOK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return dedupeLooks(parsed.map(item => normalizeLook(item, {builtIn: false})));
  } catch {
    return [];
  }
}

export function saveUserLooks(looks, storage = globalThis.localStorage) {
  if (!storage) return false;
  const normalized = dedupeLooks((looks || []).map(item => normalizeLook(item, {builtIn: false})));
  const payload = normalized.map(look => ({
    id: look.id,
    version: look.version,
    name: look.name,
    config: look.config
  }));
  try {
    storage.setItem(LOOK_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch (error) {
    console.warn("Unable to save looks.", error);
    return false;
  }
}

export function dedupeLooks(looks) {
  const byId = new Map();
  for (const look of looks || []) {
    if (!look?.id) continue;
    byId.set(look.id, look);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
