import assert from "node:assert/strict";
import test from "node:test";
import {
  CHROMA_MAP_CONTROL_KEYS,
  CONTROL_GROUPS,
  DEFAULT_CONFIG,
  TINT_CONTROL_KEYS,
  TONE_MAP_CONTROL_KEYS,
  cloneDefaultConfig,
  groupControlDefinitions,
  normalizeConfig,
  resetChromaMapConfig,
  resetControlGroup,
  resetTintConfig,
  resetToneMapConfig
} from "../src/config.js";

const expectedRanges = new Map([
  ["gamma", {min: 0.1, max: 4, step: 0.01}],
  ["exposure", {min: -5, max: 5, step: 0.05}],
  ["chromaGamma", {min: 0.1, max: 4, step: 0.01}],
  ["chromaExposure", {min: -5, max: 5, step: 0.05}],
  ["curveStrength", {min: 0, max: 1, step: 0.01}],
  ["toneShoulder", {min: 1, max: 6, step: 0.02}],
  ["tonePivotNudge", {min: -1, max: 1, step: 0.001}],
  ["lift", {min: -0.2, max: 0.2, step: 0.01}],
  ["midtone", {min: -0.2, max: 0.2, step: 0.01}],
  ["gain", {min: -0.2, max: 0.2, step: 0.01}],
  ["chromaFadeLow", {min: -6, max: 6, step: 0.1}],
  ["chromaFadeHigh", {min: -6, max: 6, step: 0.1}],
  ["chromaFadeStrength", {min: 0, max: 1, step: 0.01}],
  ["tintStrength", {min: 0, max: 1, step: 0.01}],
  ["tintHue", {min: 0, max: 360, step: 0.01}]
]);

test("cloneDefaultConfig returns a mutable copy", () => {
  const config = cloneDefaultConfig();
  config.exposure = 1;
  assert.equal(DEFAULT_CONFIG.exposure, 0.0);
});

test("control groups separate tone curve from post-curve tonal balance", () => {
  assert.deepEqual(CONTROL_GROUPS.map(group => group.label), [
    "Adjustments",
    "Tone Curve",
    "Tonal Balance",
    "Chroma Fade",
    "Tint"
  ]);
  assert.deepEqual(CONTROL_GROUPS.map(group => group.id), ["adjustments", "tone", "tonal-balance", "chroma", "tint"]);
});

test("every visible UI control maps once to an existing config key", () => {
  const keys = new Set(Object.keys(DEFAULT_CONFIG));
  const seen = new Set();

  for (const group of CONTROL_GROUPS) {
    for (const control of group.controls) {
      assert.ok(keys.has(control.key), `Unknown control key: ${control.key}`);
      assert.equal(seen.has(control.key), false, `Duplicate control key: ${control.key}`);
      seen.add(control.key);
    }
  }

  assert.equal(seen.has("tonePivotNudge"), false);
  assert.ok([...seen].every(key => keys.has(key)));
});

test("hidden tone nudge is part of the tone group without becoming a slider", () => {
  const toneGroup = CONTROL_GROUPS.find(group => group.id === "tone");
  assert.deepEqual(toneGroup.controls.map(control => control.key), ["curveStrength", "toneShoulder"]);
  assert.deepEqual(toneGroup.hiddenControls.map(control => control.key), ["tonePivotNudge"]);
  assert.deepEqual(groupControlDefinitions(toneGroup).map(control => control.key), ["curveStrength", "toneShoulder", "tonePivotNudge"]);
});

test("control ranges match the extraction plan", () => {
  for (const group of CONTROL_GROUPS) {
    for (const control of groupControlDefinitions(group)) {
      const expected = expectedRanges.get(control.key);
      assert.deepEqual(
        {min: control.min, max: control.max, step: control.step},
        expected,
        `Unexpected range for ${control.key}`
      );
    }
  }
});

test("tone nudge is hidden and clamped around the visible luma domain", () => {
  const nudge = CONTROL_GROUPS.find(group => group.id === "tone").hiddenControls.find(control => control.key === "tonePivotNudge");
  assert.equal(nudge.min, -1);
  assert.equal(nudge.max, 1);
});

test("logistic controls use human-facing labels", () => {
  const toneControls = CONTROL_GROUPS.find(group => group.id === "tone").controls;
  assert.deepEqual(toneControls.map(control => control.label), ["Tone Amount", "Shoulder"]);
});


test("normalizeConfig fills missing values from defaults", () => {
  assert.equal(normalizeConfig({exposure: 2}).tonePivotNudge, DEFAULT_CONFIG.tonePivotNudge);
  assert.equal(normalizeConfig({exposure: 2}).exposure, 2);
  assert.equal(normalizeConfig({gamma: 1.5}).gamma, 1.5);
});

test("resetControlGroup restores only the selected group", () => {
  const config = normalizeConfig({
    gamma: 1.4,
    exposure: 3,
    curveStrength: 0.2,
    tonePivotNudge: 0.3,
    tintStrength: 0.6
  });

  resetControlGroup(config, "adjustments");

  assert.equal(config.gamma, DEFAULT_CONFIG.gamma);
  assert.equal(config.exposure, DEFAULT_CONFIG.exposure);
  assert.equal(config.curveStrength, 0.2);
  assert.equal(config.tonePivotNudge, 0.3);
  assert.equal(config.tintStrength, 0.6);
});


test("resetControlGroup restores hidden tone nudge with the visible tone controls", () => {
  const config = normalizeConfig({curveStrength: 0.7, toneShoulder: 5, tonePivotNudge: 0.25});
  resetControlGroup(config, "tone");
  assert.equal(config.curveStrength, DEFAULT_CONFIG.curveStrength);
  assert.equal(config.toneShoulder, DEFAULT_CONFIG.toneShoulder);
  assert.equal(config.tonePivotNudge, DEFAULT_CONFIG.tonePivotNudge);
});


test("tone map control keys include graph-owned visible and hidden parameters", () => {
  assert.deepEqual(TONE_MAP_CONTROL_KEYS, [
    "exposure",
    "gamma",
    "curveStrength",
    "toneShoulder",
    "tonePivotNudge",
    "lift",
    "midtone",
    "gain"
  ]);
  for (const key of TONE_MAP_CONTROL_KEYS) {
    assert.ok(Object.hasOwn(DEFAULT_CONFIG, key), `Unknown tone map key: ${key}`);
  }
});

test("resetToneMapConfig restores all graph-owned tone map parameters", () => {
  const config = normalizeConfig({
    exposure: 2,
    gamma: 1.7,
    curveStrength: 0.8,
    toneShoulder: 5.5,
    tonePivotNudge: -0.22,
    lift: 0.1,
    midtone: -0.04,
    gain: 0.16,
    chromaGamma: 1.4,
    tintStrength: 0.6
  });

  resetToneMapConfig(config);

  for (const key of TONE_MAP_CONTROL_KEYS) {
    assert.equal(config[key], DEFAULT_CONFIG[key], `${key} should reset`);
  }
  assert.equal(config.chromaGamma, 1.4);
  assert.equal(config.tintStrength, 0.6);
});


test("chroma map control keys include graph-owned chroma parameters", () => {
  assert.deepEqual(CHROMA_MAP_CONTROL_KEYS, [
    "chromaExposure",
    "chromaGamma",
    "chromaFadeStrength",
    "chromaFadeLow",
    "chromaFadeHigh"
  ]);
  for (const key of CHROMA_MAP_CONTROL_KEYS) {
    assert.ok(Object.hasOwn(DEFAULT_CONFIG, key), `Unknown chroma map key: ${key}`);
  }
});

test("resetChromaMapConfig restores only chroma map parameters", () => {
  const config = normalizeConfig({
    chromaExposure: 1.5,
    chromaGamma: 1.7,
    chromaFadeStrength: 0.8,
    chromaFadeLow: -1,
    chromaFadeHigh: 0.7,
    exposure: 2,
    tintStrength: 0.6
  });

  resetChromaMapConfig(config);

  for (const key of CHROMA_MAP_CONTROL_KEYS) {
    assert.equal(config[key], DEFAULT_CONFIG[key], `${key} should reset`);
  }
  assert.equal(config.exposure, 2);
  assert.equal(config.tintStrength, 0.6);
});


test("tint control keys cover both tint parameters", () => {
  assert.deepEqual(TINT_CONTROL_KEYS, ["tintStrength", "tintHue"]);
  for (const key of TINT_CONTROL_KEYS) {
    assert.ok(Object.hasOwn(DEFAULT_CONFIG, key), `Unknown tint key: ${key}`);
  }
});

test("resetTintConfig restores only tint parameters", () => {
  const config = normalizeConfig({
    tintStrength: 0.8,
    tintHue: 220,
    exposure: 2,
    chromaGamma: 1.4
  });

  resetTintConfig(config);

  for (const key of TINT_CONTROL_KEYS) {
    assert.equal(config[key], DEFAULT_CONFIG[key], `${key} should reset`);
  }
  assert.equal(config.exposure, 2);
  assert.equal(config.chromaGamma, 1.4);
});
