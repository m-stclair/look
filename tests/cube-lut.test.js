import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../src/config.js";
import { lookTintFromHueDegrees } from "../src/color-utils.js";
import { applyLookToSrgb, cubeTitle, generateCubeLut, normalizeLutSize } from "../src/cube-lut.js";

function dataRows(cubeText) {
  return cubeText.trim().split("\n").filter(line => /^\d/.test(line));
}

function parseRow(row) {
  return row.split(/\s+/).map(Number);
}

function assertClose(actual, expected, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be close to ${expected}`);
}

const RGB_LUMA = [0.2126, 0.7152, 0.0722];
const TINT_RGB_SCALE = 0.22;

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function lumaNeutralDye(rgb) {
  const y = dot3(rgb, RGB_LUMA);
  const dye = rgb.map(channel => channel - y);
  const maxAbs = Math.max(...dye.map(channel => Math.abs(channel)));
  return maxAbs > 1e-6 ? dye.map(channel => channel / maxAbs) : [0, 0, 0];
}

test("generateCubeLut writes a valid 3D cube header and row count", () => {
  const cube = generateCubeLut(DEFAULT_CONFIG, {size: 2, title: "Neutral"});
  assert.match(cube, /^TITLE "Neutral"/);
  assert.match(cube, /DOMAIN_MIN 0\.0 0\.0 0\.0/);
  assert.match(cube, /DOMAIN_MAX 1\.0 1\.0 1\.0/);
  assert.match(cube, /LUT_3D_SIZE 2/);
  assert.equal(dataRows(cube).length, 8);
});

test("generateCubeLut orders samples with red fastest and blue slowest", () => {
  const rows = dataRows(generateCubeLut(DEFAULT_CONFIG, {size: 2})).map(parseRow);

  assertClose(rows[0][0], 0);
  assertClose(rows[0][1], 0);
  assertClose(rows[0][2], 0);

  assertClose(rows[1][0], 1);
  assertClose(rows[1][1], 0);
  assertClose(rows[1][2], 0);

  assertClose(rows[2][0], 0);
  assertClose(rows[2][1], 1);
  assertClose(rows[2][2], 0);

  assertClose(rows[4][0], 0);
  assertClose(rows[4][1], 0);
  assertClose(rows[4][2], 1);
});

test("applyLookToSrgb clamps display output for LUT compatibility", () => {
  const output = applyLookToSrgb([1, 0.5, 0.25], {
    exposure: 3,
    chromaExposure: 3,
    tintStrength: 1,
    gain: 0.2
  });
  assert.equal(output.length, 3);
  for (const channel of output) {
    assert.ok(channel >= 0);
    assert.ok(channel <= 1);
  }
});

test("tint axis center is independent from the tone pivot", () => {
  const input = [0.25, 0.25, 0.25];
  const base = {
    tintStrength: 0.6,
    tintLowHue: 248,
    tintHighHue: 68,
    tintAxisCenter: -1,
    curveStrength: 0
  };

  const lowPivot = applyLookToSrgb(input, {...base, tonePivotNudge: -0.4});
  const highPivot = applyLookToSrgb(input, {...base, tonePivotNudge: 0.4});

  lowPivot.forEach((channel, index) => assertClose(channel, highPivot[index], 1e-12));
});

test("tint axis center controls the bipolar tint crossover", () => {
  const input = [0.25, 0.25, 0.25];
  const shadowsCentered = applyLookToSrgb(input, {tintStrength: 0.6, tintLowHue: 248, tintHighHue: 68, tintAxisCenter: -3});
  const midtonesCentered = applyLookToSrgb(input, {tintStrength: 0.6, tintLowHue: 248, tintHighHue: 68, tintAxisCenter: -1});

  assert.ok(
    shadowsCentered.some((channel, index) => Math.abs(channel - midtonesCentered[index]) > 1e-4),
    "changing tintAxisCenter should change the tint vector"
  );
});


test("highlight tint uses its own luma-neutral RGB dye", () => {
  // Neutral sRGB value whose OKLab L is 0.5, so tintAxisCenter -2 gives tintSide +1.
  const input = [0.3885728590463344, 0.3885728590463344, 0.3885728590463344];
  const strength = 0.05;
  const config = {
    tintStrength: strength,
    tintLowHue: 240,
    tintHighHue: 60,
    tintAxisCenter: -2,
    curveStrength: 0
  };

  const neutral = applyLookToSrgb(input, {...config, tintStrength: 0});
  const tinted = applyLookToSrgb(input, config);
  const delta = tinted.map((channel, index) => channel - neutral[index]);
  const expectedDye = lumaNeutralDye(lookTintFromHueDegrees(config.tintHighHue));

  delta.forEach((channel, index) => {
    assertClose(channel, expectedDye[index] * strength * TINT_RGB_SCALE, 1e-9);
  });
  assertClose(dot3(tinted, RGB_LUMA), dot3(neutral, RGB_LUMA), 1e-9);
});


test("normalizeLutSize accepts only Cube-compatible sizes", () => {
  assert.equal(normalizeLutSize("33"), 33);
  assert.throws(() => normalizeLutSize(1), /2 to 256/);
  assert.throws(() => normalizeLutSize(257), /2 to 256/);
  assert.throws(() => normalizeLutSize("nope"), /2 to 256/);
});

test("cubeTitle strips characters that break quoted titles", () => {
  assert.equal(cubeTitle('Warm "Film"\nLook'), "Warm  Film  Look");
});


test("low and high tint hues are independent dye handles", () => {
  const lowInput = [0.08, 0.08, 0.08];
  const highInput = [0.8, 0.8, 0.8];
  const base = {tintStrength: 0.05, tintAxisCenter: -1, tintLowHue: 240, tintHighHue: 60, curveStrength: 0};

  const lowA = applyLookToSrgb(lowInput, base);
  const lowB = applyLookToSrgb(lowInput, {...base, tintLowHue: 120});
  const lowC = applyLookToSrgb(lowInput, {...base, tintHighHue: 120});
  const highA = applyLookToSrgb(highInput, base);
  const highB = applyLookToSrgb(highInput, {...base, tintLowHue: 120});
  const highC = applyLookToSrgb(highInput, {...base, tintHighHue: 120});

  assert.ok(lowA.some((channel, index) => Math.abs(channel - lowB[index]) > 1e-4));
  lowA.forEach((channel, index) => assertClose(channel, lowC[index], 1e-12));

  highA.forEach((channel, index) => assertClose(channel, highB[index], 1e-12));
  assert.ok(highA.some((channel, index) => Math.abs(channel - highC[index]) > 1e-4));
});
