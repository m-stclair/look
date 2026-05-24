import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createCubeInputPixels,
  createCubeLutText,
  cubeLutFilename,
  cubePixelOffset,
  cubeTextureDimensions,
  cubeTitle,
  normalizeLutSize
} from "../src/cube-lut.js";

function dataRows(cubeText) {
  return cubeText.trim().split("\n").filter(line => /^\d/.test(line));
}

function parseRow(row) {
  return row.split(/\s+/).map(Number);
}

function pixelRgb(pixels, size, rIndex, gIndex, bIndex) {
  const offset = cubePixelOffset(size, rIndex, gIndex, bIndex);
  return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
}

test("createCubeLutText writes a valid 3D cube header and row count", () => {
  const cube = createCubeLutText(createCubeInputPixels(2), {size: 2, title: "Neutral"});
  assert.match(cube, /^TITLE "Neutral"/);
  assert.match(cube, /DOMAIN_MIN 0\.0 0\.0 0\.0/);
  assert.match(cube, /DOMAIN_MAX 1\.0 1\.0 1\.0/);
  assert.match(cube, /LUT_3D_SIZE 2/);
  assert.equal(dataRows(cube).length, 8);
});

test("cube texture samples are packed with red fastest and blue slowest", () => {
  const pixels = createCubeInputPixels(2);

  assert.deepEqual(pixelRgb(pixels, 2, 0, 0, 0), [0, 0, 0]);
  assert.deepEqual(pixelRgb(pixels, 2, 1, 0, 0), [1, 0, 0]);
  assert.deepEqual(pixelRgb(pixels, 2, 0, 1, 0), [0, 1, 0]);
  assert.deepEqual(pixelRgb(pixels, 2, 0, 0, 1), [0, 0, 1]);
});

test("createCubeLutText preserves shader readback ordering", () => {
  const rows = dataRows(createCubeLutText(createCubeInputPixels(2), {size: 2})).map(parseRow);

  assert.deepEqual(rows[0], [0, 0, 0]);
  assert.deepEqual(rows[1], [1, 0, 0]);
  assert.deepEqual(rows[2], [0, 1, 0]);
  assert.deepEqual(rows[4], [0, 0, 1]);
});

test("cube texture dimensions pack a 3D LUT into one 2D shader input", () => {
  assert.deepEqual(cubeTextureDimensions(33), {width: 1089, height: 33});
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

test("cubeLutFilename uses the sanitized look name and size", () => {
  assert.equal(cubeLutFilename("Warm Soft Contrast!", 33), "warm-soft-contrast-33.cube");
});

test("cube-lut utilities do not maintain a CPU-side copy of shader color math", async () => {
  const source = await readFile(new URL("../src/cube-lut.js", import.meta.url), "utf8");
  assert.equal(source.includes("applyLookToSrgb"), false);
  assert.equal(source.includes("./curve-preview"), false);
  assert.equal(source.includes("./color-utils"), false);
});
