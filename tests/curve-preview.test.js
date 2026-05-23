import assert from "node:assert/strict";
import test from "node:test";
import {
  chromaCurveSample,
  gammaAdjust,
  lumaCurveSample
} from "../src/curve-preview.js";

test("luma curve is neutral at defaults", () => {
  for (const sample of [0, 0.18, 0.5, 0.82, 1]) {
    assert.equal(lumaCurveSample(sample), sample);
  }
});

test("chroma curve is neutral at defaults", () => {
  for (const sample of [0, 0.05, 0.25, 0.5]) {
    assert.equal(chromaCurveSample(sample, 0.5), sample);
  }
});

test("preview gamma helper matches shader gamma formula", () => {
  assert.equal(gammaAdjust(0.25, 2), 0.5);
});

test("luma lift affects shadows more than highlights", () => {
  const config = {lift: 0.1};
  const shadowDelta = lumaCurveSample(0.1, config) - 0.1;
  const highDelta = lumaCurveSample(0.9, config) - 0.9;
  assert.ok(shadowDelta > highDelta, `Expected shadow ${shadowDelta} to exceed highlight ${highDelta}`);
});
