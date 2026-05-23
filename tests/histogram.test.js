import assert from "node:assert/strict";
import test from "node:test";
import { transformLumaHistogram } from "../src/curve-preview.js";
import { createLumaHistogramFromRgba, oklabLumaFromSrgb } from "../src/histogram.js";

test("RGBA histogram bins opaque pixels by OKLab lightness", () => {
  const rgba = new Uint8ClampedArray([
    0, 0, 0, 255,
    255, 255, 255, 255,
    255, 255, 255, 128,
    255, 0, 0, 0
  ]);
  const histogram = createLumaHistogramFromRgba(rgba, {binCount: 4});
  const total = [...histogram].reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - (2 + 128 / 255)) < 1e-6);
  assert.ok(histogram[0] > 0, "black should land in the low bin");
  assert.ok(histogram[3] > 0, "white should land in the high bin");
});

test("OKLab lightness follows shader endpoints", () => {
  assert.equal(oklabLumaFromSrgb(0, 0, 0), 0);
  assert.ok(Math.abs(oklabLumaFromSrgb(1, 1, 1) - 1) < 1e-7);
});

test("neutral luma histogram transform preserves total mass", () => {
  const source = Float32Array.from([0, 2, 4, 2]);
  const transformed = transformLumaHistogram(source, {});
  const sourceTotal = [...source].reduce((sum, value) => sum + value, 0);
  const transformedTotal = [...transformed].reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(sourceTotal - transformedTotal) < 1e-6);
});

test("luma histogram transform remaps bins through the tone curve", () => {
  const source = Float32Array.from([0, 0, 0, 8]);
  const transformed = transformLumaHistogram(source, {exposure: -4});
  const brightestBin = transformed.reduce((bestIndex, value, index) => value > transformed[bestIndex] ? index : bestIndex, 0);
  assert.ok(brightestBin < 3, "darkened highlights should move out of the last bin");
});
