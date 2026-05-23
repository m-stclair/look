import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLiftMidtoneGain,
  chromaCurveSample,
  clampFloatingWindowPosition,
  gammaAdjust,
  histogramDensityAtLuma,
  histogramDisplayProfile,
  lumaCurveSample,
  lumaToneBaseSample,
  pivotLumaFromToneCenter,
  tonalBalanceHandleValue,
  toneCenterFromHorizontalPosition,
  toneCenterFromPivotLuma,
  tonalBalanceValueFromVerticalDrag,
  TONAL_BALANCE_HANDLES
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


test("lift/midtone/gain helper keeps tonal bands local", () => {
  assert.equal(applyLiftMidtoneGain(0.1, 0.08, 0, 0), lumaCurveSample(0.1, {lift: 0.08}));
  assert.ok(applyLiftMidtoneGain(0.5, 0, 0.08, 0) > applyLiftMidtoneGain(0.1, 0, 0.08, 0));
  assert.ok(applyLiftMidtoneGain(0.9, 0, 0, 0.08) > applyLiftMidtoneGain(0.5, 0, 0, 0.08));
});


test("lift/midtone/gain are applied after the logistic tone curve", () => {
  const input = 0.16;
  const curveOnly = lumaCurveSample(input, {curveStrength: 1});
  const withPostLift = lumaCurveSample(input, {curveStrength: 1, lift: 0.08});
  assert.equal(withPostLift, applyLiftMidtoneGain(curveOnly, 0.08, 0, 0));
});


test("tonal balance handles sit in fixed shadow, midtone, and highlight regions", () => {
  assert.deepEqual(
    TONAL_BALANCE_HANDLES.map(handle => [handle.key, Number(handle.luma.toFixed(3))]),
    [["lift", 0.175], ["midtone", 0.5], ["gain", 0.825]]
  );
});

test("tonal balance vertical drag maps upward movement to a higher trim value", () => {
  assert.equal(tonalBalanceValueFromVerticalDrag("lift", 0, -10, 100), 0.1);
  assert.equal(tonalBalanceValueFromVerticalDrag("midtone", 0, 10, 100), -0.1);
});

test("tonal balance vertical drag clamps to the control range", () => {
  assert.equal(tonalBalanceValueFromVerticalDrag("gain", 0, -1000, 100), 0.2);
  assert.equal(tonalBalanceValueFromVerticalDrag("gain", 0, 1000, 100), -0.2);
});


test("tonal balance handle value is parameter-led when the final curve has no local leverage", () => {
  const config = {exposure: -5, gain: 0.2};
  const highInput = TONAL_BALANCE_HANDLES.find(handle => handle.key === "gain").luma;
  const finalCurveValue = lumaCurveSample(highInput, config);
  const latentHandleValue = tonalBalanceHandleValue("gain", highInput, config);
  assert.equal(finalCurveValue, lumaToneBaseSample(highInput, config));
  assert.ok(latentHandleValue > finalCurveValue + 0.15);
});

test("histogram density reports dormant empty regions without disabling controls", () => {
  const histogram = new Float32Array(10);
  histogram[1] = 100;
  assert.equal(histogramDensityAtLuma(histogram, 0.85), 0);
  assert.equal(histogramDensityAtLuma(null, 0.85), 1);
});


test("tone pivot converts between log center and visible luma position", () => {
  assert.equal(pivotLumaFromToneCenter(-1), 0.5);
  assert.equal(toneCenterFromPivotLuma(0.5), -1);
  assert.equal(toneCenterFromPivotLuma(1), 0);
});

test("tone pivot rail maps horizontal drag to visible luma domain", () => {
  assert.equal(toneCenterFromHorizontalPosition(50, 0, 100), -1);
  assert.equal(toneCenterFromHorizontalPosition(120, 0, 100), 0);
  assert.equal(toneCenterFromHorizontalPosition(-20, 0, 100), -8);
});


test("floating luma window clamps inside the viewport while leaving room for the bottom dock", () => {
  assert.deepEqual(
    clampFloatingWindowPosition(-20, -20, 300, 160, 800, 600),
    {left: 6, top: 6}
  );
  assert.deepEqual(
    clampFloatingWindowPosition(760, 580, 300, 160, 800, 600),
    {left: 494, top: 400}
  );
});

test("histogram display clips oversized bins instead of normalizing everything to the spike", () => {
  const profile = histogramDisplayProfile(Float32Array.from([10, 10, 10, 70]), {clipFraction: 0.25});
  assert.equal(profile[3].clipped, true);
  assert.equal(profile[3].scaled, 1);
  assert.equal(profile[0].clipped, false);
  assert.ok(profile[0].scaled > 0.6, "unclipped bins should remain legible beside a clipped spike");
});
