import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTROL_GROUPS,
  DEFAULT_CONFIG,
  cloneDefaultConfig,
  normalizeConfig,
  resetControlGroup
} from "../src/config.js";

const expectedRanges = new Map([
  ["gamma", {min: 0.1, max: 4, step: 0.01}],
  ["exposure", {min: -5, max: 5, step: 0.05}],
  ["chromaGamma", {min: 0.1, max: 4, step: 0.01}],
  ["chromaExposure", {min: -5, max: 5, step: 0.05}],
  ["curveStrength", {min: 0, max: 1, step: 0.01}],
  ["toneShoulder", {min: 1, max: 6, step: 0.02}],
  ["toneCenter", {min: -3, max: 1, step: 0.05}],
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

test("control groups now lead with Adjustments before Tone, Chroma, and Tint", () => {
  assert.deepEqual(CONTROL_GROUPS.map(group => group.label), ["Adjustments", "Tone", "Chroma Fade", "Tint"]);
  assert.deepEqual(CONTROL_GROUPS.map(group => group.id), ["adjustments", "tone", "chroma", "tint"]);
});

test("every UI control maps once to an existing config key", () => {
  const keys = new Set(Object.keys(DEFAULT_CONFIG));
  const seen = new Set();

  for (const group of CONTROL_GROUPS) {
    for (const control of group.controls) {
      assert.ok(keys.has(control.key), `Unknown control key: ${control.key}`);
      assert.equal(seen.has(control.key), false, `Duplicate control key: ${control.key}`);
      seen.add(control.key);
    }
  }

  assert.deepEqual([...seen].sort(), [...keys].sort());
});

test("UI control ranges match the extraction plan", () => {
  for (const group of CONTROL_GROUPS) {
    for (const control of group.controls) {
      const expected = expectedRanges.get(control.key);
      assert.deepEqual(
        {min: control.min, max: control.max, step: control.step},
        expected,
        `Unexpected range for ${control.key}`
      );
    }
  }
});

test("normalizeConfig fills missing values from defaults", () => {
  assert.equal(normalizeConfig({exposure: 2}).toneCenter, DEFAULT_CONFIG.toneCenter);
  assert.equal(normalizeConfig({exposure: 2}).exposure, 2);
  assert.equal(normalizeConfig({gamma: 1.5}).gamma, 1.5);
});

test("resetControlGroup restores only the selected group", () => {
  const config = normalizeConfig({
    gamma: 1.4,
    exposure: 3,
    curveStrength: 0.2,
    tintStrength: 0.6
  });

  resetControlGroup(config, "adjustments");

  assert.equal(config.gamma, DEFAULT_CONFIG.gamma);
  assert.equal(config.exposure, DEFAULT_CONFIG.exposure);
  assert.equal(config.curveStrength, 0.2);
  assert.equal(config.tintStrength, 0.6);
});
