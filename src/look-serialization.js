import { DEFAULT_CONFIG, normalizeConfig } from "./config.js";

export const LOOK_VERSION = 1;

export const LOOK_CONFIG_KEYS = Object.freeze(Object.keys(DEFAULT_CONFIG));

export function sanitizeLookName(name, fallback = "Untitled Look") {
  const trimmed = String(name || "").replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

export function serializeLookConfig(config = {}) {
  const normalized = normalizeConfig(config);
  const serialized = {};
  for (const key of LOOK_CONFIG_KEYS) {
    const value = Number(normalized[key]);
    serialized[key] = Number.isFinite(value) ? value : DEFAULT_CONFIG[key];
  }
  return serialized;
}

export function createLook({id, name, config, builtIn = false} = {}) {
  return Object.freeze({
    id: id || createLookId(),
    version: LOOK_VERSION,
    name: sanitizeLookName(name),
    builtIn: !!builtIn,
    config: Object.freeze(serializeLookConfig(config))
  });
}

export function normalizeLook(candidate, options = {}) {
  if (!candidate || typeof candidate !== "object") {
    throw new Error("Look data must be an object.");
  }

  const config = candidate.config && typeof candidate.config === "object" ? candidate.config : candidate;
  return createLook({
    id: options.id || candidate.id || createLookId(),
    name: candidate.name || options.name || "Imported Look",
    config,
    builtIn: options.builtIn ?? !!candidate.builtIn
  });
}

export function duplicateLook(look, options = {}) {
  const source = normalizeLook(look, {builtIn: false});
  return createLook({
    id: options.id || createLookId(),
    name: options.name || copyName(source.name),
    config: source.config,
    builtIn: false
  });
}

export function lookPayload(look) {
  const normalized = normalizeLook(look, {id: look?.id, builtIn: !!look?.builtIn});
  return {
    version: LOOK_VERSION,
    name: normalized.name,
    config: serializeLookConfig(normalized.config)
  };
}

export function looksEqual(a, b) {
  if (!a || !b) return false;
  return stableStringify(lookPayload(a)) === stableStringify(lookPayload(b));
}

export function configFingerprint(config = {}) {
  return stableStringify(serializeLookConfig(config));
}

export function parseLookJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text || ""));
  } catch (error) {
    throw new Error(`Could not parse look JSON: ${error.message}`);
  }

  const candidates = Array.isArray(parsed) ? parsed : parsed.looks || parsed.look ? parsed.looks || [parsed.look] : [parsed];
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error("No looks found in JSON.");
  }
  return candidates.map(candidate => normalizeLook(candidate, {builtIn: false}));
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function slugifyLookName(name) {
  const slug = sanitizeLookName(name, "look")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "look";
}

export function nextCopyName(name, existingNames = []) {
  const base = sanitizeLookName(name).replace(/ copy( \d+)?$/i, "");
  const taken = new Set(existingNames.map(existing => String(existing).toLowerCase()));
  let candidate = `${base} copy`;
  let index = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base} copy ${index}`;
    index += 1;
  }
  return candidate;
}

function copyName(name) {
  return `${sanitizeLookName(name)} copy`;
}

function createLookId() {
  const random = Math.random().toString(36).slice(2, 8);
  return `look-${Date.now().toString(36)}-${random}`;
}
