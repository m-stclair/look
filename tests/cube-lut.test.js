import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../src/config.js";
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

test("normalizeLutSize accepts only Cube-compatible sizes", () => {
  assert.equal(normalizeLutSize("33"), 33);
  assert.throws(() => normalizeLutSize(1), /2 to 256/);
  assert.throws(() => normalizeLutSize(257), /2 to 256/);
  assert.throws(() => normalizeLutSize("nope"), /2 to 256/);
});

test("cubeTitle strips characters that break quoted titles", () => {
  assert.equal(cubeTitle('Warm "Film"\nLook'), "Warm  Film  Look");
});
