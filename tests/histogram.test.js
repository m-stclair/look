import assert from "node:assert/strict";
import test from "node:test";
import { transformChromaHistogram, transformChromaJointHistogram, transformLumaHistogram, maxChromaFromHistogram, chromaPercentileFromHistogram, chromaDisplayMaxFromHistogram } from "../src/curve-preview.js";
import { createChromaHistogramFromRgba, createImageHistogramsFromRgba, createLumaHistogramFromRgba, oklabChromaFromSrgb, oklabLumaFromSrgb } from "../src/histogram.js";

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


test("RGBA chroma histogram bins saturated pixels and tracks max OKLab chroma", () => {
  const rgba = new Uint8ClampedArray([
    128, 128, 128, 255,
    255, 0, 0, 255,
    0, 255, 0, 128,
    0, 0, 0, 0
  ]);
  const {histogram, maxChroma, chromaDomainMax} = createChromaHistogramFromRgba(rgba, {binCount: 8});
  const total = [...histogram].reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - (2 + 128 / 255)) < 1e-6);
  assert.ok(maxChroma > oklabChromaFromSrgb(0.5, 0.5, 0.5));
  assert.ok(maxChroma > 0.2, "saturated RGB primaries should produce visible OKLab chroma");
  assert.ok(chromaDomainMax > 0);
});

test("combined image histogram returns luma and chroma in one sampled pass", () => {
  const rgba = new Uint8ClampedArray([
    0, 0, 0, 255,
    255, 0, 0, 255
  ]);
  const histograms = createImageHistogramsFromRgba(rgba, {binCount: 8});
  assert.equal(histograms.luma.length, 8);
  assert.equal(histograms.chroma.length, 8);
  assert.equal(histograms.chromaByLuma.length, 64);
  assert.ok(histograms.maxChroma > 0);
  assert.ok(histograms.chromaDomainMax > 0);
  assert.equal([...histograms.luma].reduce((sum, value) => sum + value, 0), 2);
  assert.equal([...histograms.chroma].reduce((sum, value) => sum + value, 0), 2);
  assert.equal([...histograms.chromaByLuma].reduce((sum, value) => sum + value, 0), 2);
});

test("source chroma histogram shrinks its binning domain to the image P99", () => {
  const pixels = [];
  for (let index = 0; index < 100; index += 1) pixels.push(120, 110, 100, 255);
  pixels.push(255, 0, 0, 255);
  const histograms = createImageHistogramsFromRgba(new Uint8ClampedArray(pixels), {binCount: 16});
  assert.ok(histograms.chromaDomainMax < histograms.maxChroma, "a lone saturated outlier should not define the entire histogram domain");
  const occupiedBins = [...histograms.chroma].reduce((entries, value, index) => {
    if (value > 0) entries.push(index);
    return entries;
  }, []);
  assert.ok(occupiedBins.some(index => index > 0), "the natural-scene cluster should spread beyond the very first bin");
  assert.ok(histograms.chroma[15] > 0, "outliers beyond the P99 domain should clip into the last bin");
});

test("neutral chroma histogram transform preserves total mass", () => {
  const source = Float32Array.from([0, 2, 4, 2]);
  const transformed = transformChromaHistogram(source, {});
  const sourceTotal = [...source].reduce((sum, value) => sum + value, 0);
  const transformedTotal = [...transformed].reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(sourceTotal - transformedTotal) < 1e-6);
});

test("chroma histogram transform remaps bins through chroma exposure", () => {
  const source = Float32Array.from([0, 8, 0, 0]);
  const transformed = transformChromaHistogram(source, {chromaExposure: 2});
  const brightestBin = transformed.reduce((bestIndex, value, index) => value > transformed[bestIndex] ? index : bestIndex, 0);
  assert.ok(brightestBin > 1, "boosted chroma should move toward higher bins");
});

test("joint chroma histogram transform applies luma-aware chroma fade", () => {
  const joint = new Float32Array(16);
  joint[0 * 4 + 3] = 4;
  joint[3 * 4 + 3] = 4;
  const transformed = transformChromaJointHistogram(joint, {chromaFadeStrength: 1, chromaFadeRegion: 0, chromaFadeCenter: 0.5, chromaFadeSoftness: 1}, 4);
  assert.ok(transformed[0] > 0, "low-luma chroma should fade toward the low bins");
  assert.ok(transformed[2] + transformed[3] > 0, "high-luma chroma should retain high-bin mass");
});

test("max chroma indicator can be derived from the displayed histogram", () => {
  const histogram = Float32Array.from([0, 0, 3, 0]);
  assert.equal(maxChromaFromHistogram(histogram), 0.625);
});

test("chroma percentile derives a robust P99 domain from the displayed histogram", () => {
  const histogram = Float32Array.from([80, 15, 4, 1]);
  assert.equal(chromaPercentileFromHistogram(histogram, 0.99), 0.75);
  assert.equal(chromaPercentileFromHistogram(histogram, 0.95), 0.5);
});

test("chroma display max uses P99 with a minimum floor", () => {
  assert.equal(chromaDisplayMaxFromHistogram(Float32Array.from([100, 0, 0, 0])), 0.25);
  assert.equal(chromaDisplayMaxFromHistogram(Float32Array.from([0, 0, 3, 0])), 0.75);
});
