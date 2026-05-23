import assert from "node:assert/strict";
import test from "node:test";
import { computeChromaGraphMetrics, chromaGraphMetricsSignature, resetChromaPreviewCaches } from "../src/curve-preview/chroma-map.js";

test("chroma graph signature ignores tint-only changes", () => {
  const histogram = Float32Array.from([0, 2, 4, 1]);
  const base = {chromaGamma: 1.2, tintStrength: 0};
  const movedTint = {...base, tintStrength: 0.8, tintHighHue: 120};
  assert.equal(
    chromaGraphMetricsSignature(base, {sourceChromaHistogram: histogram}),
    chromaGraphMetricsSignature(movedTint, {sourceChromaHistogram: histogram})
  );
});

test("chroma graph signature includes luma exposure and gamma because fade uses adjusted luma", () => {
  const histogram = Float32Array.from([0, 2, 4, 1]);
  const base = {exposure: 0, gamma: 1};
  assert.notEqual(
    chromaGraphMetricsSignature(base, {sourceChromaHistogram: histogram}),
    chromaGraphMetricsSignature({...base, exposure: 0.5}, {sourceChromaHistogram: histogram})
  );
  assert.notEqual(
    chromaGraphMetricsSignature(base, {sourceChromaHistogram: histogram}),
    chromaGraphMetricsSignature({...base, gamma: 1.5}, {sourceChromaHistogram: histogram})
  );
});

test("chroma graph metrics are cached for repeated hover/display queries", () => {
  resetChromaPreviewCaches();
  const histogram = Float32Array.from([0, 2, 4, 1]);
  const state = {sourceChromaHistogram: histogram, sourceChromaDomainMax: 1};
  const first = computeChromaGraphMetrics({chromaGamma: 1.1}, state);
  const second = computeChromaGraphMetrics({chromaGamma: 1.1}, state);
  assert.equal(second, first);

  const changed = computeChromaGraphMetrics({chromaGamma: 1.2}, state);
  assert.notEqual(changed, first);
});


test("chroma graph metrics cache reuses non-consecutive exact signatures", () => {
  resetChromaPreviewCaches();
  const histogram = Float32Array.from([0, 2, 4, 1]);
  const state = {sourceChromaHistogram: histogram, sourceChromaDomainMax: 1};
  const first = computeChromaGraphMetrics({chromaGamma: 1.1}, state);
  computeChromaGraphMetrics({chromaGamma: 1.2}, state);
  const repeated = computeChromaGraphMetrics({chromaGamma: 1.1}, state);
  assert.equal(repeated, first);
});
