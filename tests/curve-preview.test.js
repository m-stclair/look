import assert from "node:assert/strict";
import test from "node:test";
import {
  adjustedLumaFromInputLuma,
  applyLiftMidtoneGain,
  baseTonePivotInputLuma,
  CHROMA_FADE_GAUGE_HEIGHT,
  CHROMA_PLACEMENT_CHROMA,
  chromaBaseCurveSample,
  chromaCurveSample,
  chromaExposureValueFromHorizontalPosition,
  chromaExposureValueFromPlacementInputChroma,
  chromaFadeCenterUnitFromValue,
  chromaFadeCenterValueFromUnit,
  chromaFadeMask,
  chromaFadeSoftnessFromHorizontalPosition,
  chromaFadeSoftnessUnitFromValue,
  chromaFadeStrengthFromGaugePointer,
  chromaFadeStrengthUnitFromValue,
  chromaGammaValueFromVerticalDrag,
  chromaPlacementInputChroma,
  clampFloatingWindowPosition,
  effectiveToneCenter,
  effectiveTonePivotLuma,
  EXPOSURE_PLACEMENT_LUMA,
  exposurePlacementInputLuma,
  exposureValueFromHorizontalPosition,
  exposureValueFromPlacementInputLuma,
  gammaAdjust,
  CURVE_STRENGTH_MAST_HEIGHT,
  curveStrengthUnitFromValue,
  curveStrengthValueFromVerticalDrag,
  histogramDensityAtLuma,
  hueWindowCenterFromHorizontalPosition,
  hueWindowChromaFromVerticalPosition,
  hueWindowChromaScaleForHue,
  hueWindowMaskForHue,
  histogramDisplayProfile,
  inputLumaFromAdjustedLuma,
  lumaCurveSample,
  lumaToneBaseSample,
  pivotedLogitCurve,
  pivotLumaFromToneCenter,
  tonalBalanceHandleValue,
  toneSlopeFromControls,
  shoulderGaugeUnitFromToneShoulder,
  SHOULDER_GAUGE_HEIGHT,
  toneShoulderFromGaugePointer,
  toneShoulderFromGaugeUnit,
  toneCenterFromPivotLuma,
  tonePivotInputLuma,
  tonePivotNudgeFromHorizontalPosition,
  tonePivotNudgeFromInputLuma,
  tonePivotNudgeFromSlopeHandleInputLuma,
  tonalBalanceValueFromVerticalDrag,
  gammaValueFromVerticalDrag,
  previewScopesForConfigKeys,
  changedConfigKeys,
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

test("pivoted logit curve fixes its pivot", () => {
  const pivot = 0.35;
  assert.ok(Math.abs(pivotedLogitCurve(pivot, pivot, 4) - pivot) < 1e-12);
});

test("tone curve strength zero makes the pivot algebraically dormant", () => {
  const sample = 0.37;
  assert.ok(Math.abs(lumaToneBaseSample(sample, {curveStrength: 0, tonePivotNudge: -1, toneShoulder: 6}) - sample) < 1e-12);
  assert.ok(Math.abs(lumaToneBaseSample(sample, {curveStrength: 0, tonePivotNudge: 1, toneShoulder: 6}) - sample) < 1e-12);
});

test("tone slope interpolates from identity to the shoulder control", () => {
  assert.equal(toneSlopeFromControls(0, 4), 1);
  assert.equal(toneSlopeFromControls(1, 4), 4);
  assert.equal(toneSlopeFromControls(0.5, 5), 3);
});

test("pivoted tone curve darkens below the pivot and lifts above it", () => {
  const config = {curveStrength: 1, tonePivotNudge: 0, toneShoulder: 4};
  assert.ok(lumaToneBaseSample(0.25, config) < 0.25);
  assert.ok(lumaToneBaseSample(0.75, config) > 0.75);
  assert.ok(Math.abs(lumaToneBaseSample(0.5, config) - 0.5) < 1e-12);
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


test("lift/midtone/gain are applied after the pivoted tone curve", () => {
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

test("tone nudge maps horizontal drag to visible luma offset", () => {
  assert.equal(tonePivotNudgeFromHorizontalPosition(50, 0, 100), 0);
  assert.equal(tonePivotNudgeFromHorizontalPosition(120, 0, 100), 0.5);
  assert.equal(tonePivotNudgeFromHorizontalPosition(-20, 0, 100), -0.5);
});

test("tone nudge solves through gamma and exposure before deriving the shader center", () => {
  const config = {gamma: 2, exposure: 1};
  const baseInput = baseTonePivotInputLuma(config);
  assert.ok(Math.abs(adjustedLumaFromInputLuma(baseInput, config) - 0.5) < 1e-12);

  const nudge = tonePivotNudgeFromInputLuma(0.125, config);
  const nudgedConfig = {...config, tonePivotNudge: nudge};
  assert.ok(Math.abs(tonePivotInputLuma(nudgedConfig) - 0.125) < 1e-12);
  assert.ok(Math.abs(effectiveTonePivotLuma(nudgedConfig) - adjustedLumaFromInputLuma(0.125, config)) < 1e-12);
  assert.ok(Math.abs(pivotLumaFromToneCenter(effectiveToneCenter(nudgedConfig)) - effectiveTonePivotLuma(nudgedConfig)) < 1e-12);
});

test("S handle horizontal drag places the pivot directly in input luma space", () => {
  const config = {curveStrength: 1, toneShoulder: 4};
  const nudge = tonePivotNudgeFromSlopeHandleInputLuma(0.74, config);
  const shifted = {...config, tonePivotNudge: nudge};
  assert.ok(Math.abs(tonePivotInputLuma(shifted) - 0.74) < 1e-12);
  assert.ok(tonePivotInputLuma(shifted) > tonePivotInputLuma(config));
});

test("adjusted luma inverse maps curve-stage anchors back to input luma", () => {
  const config = {gamma: 2, exposure: 1};
  const adjusted = 0.5;
  const input = inputLumaFromAdjustedLuma(adjusted, config);
  assert.ok(Math.abs(adjustedLumaFromInputLuma(input, config) - adjusted) < 1e-12);
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


test("gamma shape handle drag maps upward motion to brighter midtones", () => {
  const start = 1;
  assert.ok(gammaValueFromVerticalDrag(start, -50, 100) > start);
  assert.ok(gammaValueFromVerticalDrag(start, 50, 100) < start);
});



test("exposure placement handle maps stops to an 18% luma reference", () => {
  assert.equal(EXPOSURE_PLACEMENT_LUMA, 0.18);
  assert.ok(Math.abs(exposurePlacementInputLuma({exposure: 1}) - 0.09) < 1e-12);
  assert.ok(Math.abs(exposurePlacementInputLuma({exposure: -1}) - 0.36) < 1e-12);
  assert.ok(Math.abs(exposureValueFromPlacementInputLuma(0.09) - 1) < 1e-12);
  assert.ok(Math.abs(exposureValueFromPlacementInputLuma(0.36) + 1) < 1e-12);
});

test("exposure placement solves through gamma before setting exposure", () => {
  const config = {gamma: 2, exposure: 1};
  const placement = exposurePlacementInputLuma(config);
  assert.ok(Math.abs(adjustedLumaFromInputLuma(placement, config) - EXPOSURE_PLACEMENT_LUMA) < 1e-12);
  assert.ok(Math.abs(exposureValueFromPlacementInputLuma(placement, config) - config.exposure) < 1e-12);
});

test("exposure placement horizontal drag clamps to exposure control range", () => {
  assert.equal(exposureValueFromHorizontalPosition(0, 0, 100), 5);
  assert.equal(exposureValueFromHorizontalPosition(100, 0, 100).toFixed(3), Math.log2(0.18).toFixed(3));
});

test("curve slope handle drag maps upward motion to stronger tone shape", () => {
  assert.equal(curveStrengthValueFromVerticalDrag(0.2, -40, 100), 0.7);
  assert.equal(curveStrengthValueFromVerticalDrag(0.2, 40, 100), 0);
});

test("curve strength mast maps the strength range to a visible vertical amount", () => {
  assert.equal(CURVE_STRENGTH_MAST_HEIGHT, 44);
  assert.equal(curveStrengthUnitFromValue(0), 0);
  assert.equal(curveStrengthUnitFromValue(1), 1);
  assert.equal(curveStrengthUnitFromValue(-1), 0);
  assert.equal(curveStrengthUnitFromValue(2), 1);
});


test("shoulder gauge maps the shoulder range to a vertical amount", () => {
  assert.equal(SHOULDER_GAUGE_HEIGHT, 44);
  assert.equal(shoulderGaugeUnitFromToneShoulder(0.3), 0);
  assert.equal(shoulderGaugeUnitFromToneShoulder(1), 0.5);
  assert.equal(shoulderGaugeUnitFromToneShoulder(6), 1);
  assert.equal(toneShoulderFromGaugeUnit(0), 0.3);
  assert.equal(toneShoulderFromGaugeUnit(0.5), 1);
  assert.equal(toneShoulderFromGaugeUnit(1), 6);
});

test("shoulder gauge pointer drag is y-inverted so upward means stronger shoulder", () => {
  const top = 50;
  const height = 100;
  assert.equal(toneShoulderFromGaugePointer(top, top, height), 6);
  assert.equal(toneShoulderFromGaugePointer(top + 50, top, height), 1);
  assert.equal(toneShoulderFromGaugePointer(top + height, top, height), 0.3);
});

test("shoulder remains algebraically dormant when curve strength is zero", () => {
  const sample = 0.82;
  assert.equal(lumaToneBaseSample(sample, {curveStrength: 0, toneShoulder: 1}), sample);
  assert.equal(lumaToneBaseSample(sample, {curveStrength: 0, toneShoulder: 6}), sample);
});


test("chroma exposure placement maps stops to a chroma reference", () => {
  assert.equal(CHROMA_PLACEMENT_CHROMA, 0.18);
  assert.ok(Math.abs(chromaPlacementInputChroma({chromaExposure: 1}) - 0.09) < 1e-12);
  assert.ok(Math.abs(chromaPlacementInputChroma({chromaExposure: -1}) - 0.36) < 1e-12);
  assert.ok(Math.abs(chromaExposureValueFromPlacementInputChroma(0.09) - 1) < 1e-12);
  assert.ok(Math.abs(chromaExposureValueFromPlacementInputChroma(0.36) + 1) < 1e-12);
});

test("chroma exposure placement solves through chroma gamma", () => {
  const config = {chromaGamma: 2, chromaExposure: 1};
  const placement = chromaPlacementInputChroma(config);
  assert.ok(Math.abs(chromaBaseCurveSample(placement, config) - CHROMA_PLACEMENT_CHROMA) < 1e-12);
  assert.ok(Math.abs(chromaExposureValueFromPlacementInputChroma(placement, config) - config.chromaExposure) < 1e-12);
});

test("chroma exposure horizontal drag clamps to the control range", () => {
  assert.equal(chromaExposureValueFromHorizontalPosition(0, 0, 100), 5);
  assert.equal(chromaExposureValueFromHorizontalPosition(100, 0, 100).toFixed(3), Math.log2(0.18).toFixed(3));
});

test("chroma gamma shape handle drag maps upward motion to stronger bend", () => {
  const start = 1;
  assert.ok(chromaGammaValueFromVerticalDrag(start, -50, 100) > start);
  assert.ok(chromaGammaValueFromVerticalDrag(start, 50, 100) < start);
});

test("chroma fade center and softness map onto the luma mask lane", () => {
  assert.equal(chromaFadeCenterUnitFromValue(0), 0);
  assert.equal(chromaFadeCenterUnitFromValue(0.5), 0.5);
  assert.equal(chromaFadeCenterUnitFromValue(1), 1);
  assert.equal(chromaFadeCenterValueFromUnit(0), 0);
  assert.equal(chromaFadeCenterValueFromUnit(1), 1);
  assert.equal(chromaFadeSoftnessUnitFromValue(0.02), 0);
  assert.equal(chromaFadeSoftnessUnitFromValue(1), 1);
  assert.ok(Math.abs(chromaFadeSoftnessFromHorizontalPosition(80, 0, 100, {chromaFadeCenter: 0.5}) - 0.6) < 1e-12);
});

test("chroma fade mask can target shadows or highlights", () => {
  const base = {chromaFadeCenter: 0.5, chromaFadeSoftness: 0.4};
  assert.equal(chromaFadeMask(0, {...base, chromaFadeRegion: 0}), 0);
  assert.equal(chromaFadeMask(1, {...base, chromaFadeRegion: 0}), 1);
  assert.equal(chromaFadeMask(0, {...base, chromaFadeRegion: 1}), 1);
  assert.equal(chromaFadeMask(1, {...base, chromaFadeRegion: 1}), 0);
});

test("chroma fade strength gauge is y-inverted so upward means more fade", () => {
  assert.equal(CHROMA_FADE_GAUGE_HEIGHT, 36);
  assert.equal(chromaFadeStrengthUnitFromValue(0), 0);
  assert.equal(chromaFadeStrengthUnitFromValue(1), 1);
  assert.equal(chromaFadeStrengthFromGaugePointer(50, 50, 100), 1);
  assert.equal(chromaFadeStrengthFromGaugePointer(100, 50, 100), 0.5);
  assert.equal(chromaFadeStrengthFromGaugePointer(150, 50, 100), 0);
});


test("hue window mask wraps around the red seam", () => {
  const config = {hueWindowCenter: 350, hueWindowWidth: 20, hueWindowSoftness: 0.5};
  assert.equal(hueWindowMaskForHue(350, config), 1);
  assert.ok(hueWindowMaskForHue(0, config) > 0.95);
  assert.equal(hueWindowMaskForHue(180, config), 0);
});

test("hue window chroma scale boosts or cuts only the selected hue", () => {
  const boost = {hueWindowCenter: 120, hueWindowChroma: 0.5, hueWindowWidth: 30, hueWindowSoftness: 0.2};
  assert.ok(hueWindowChromaScaleForHue(120, boost) > 1.49);
  assert.equal(hueWindowChromaScaleForHue(300, boost), 1);

  const cut = {...boost, hueWindowChroma: -1};
  assert.equal(hueWindowChromaScaleForHue(120, cut), 0);
});

test("hue window drag maps x to hue and y to signed chroma", () => {
  assert.equal(hueWindowCenterFromHorizontalPosition(50, 0, 100), 180);
  assert.equal(hueWindowCenterFromHorizontalPosition(-50, 0, 100), 0);
  assert.equal(hueWindowCenterFromHorizontalPosition(150, 0, 100), 360);
  assert.equal(hueWindowChromaFromVerticalPosition(0, 0, 100), 1);
  assert.equal(hueWindowChromaFromVerticalPosition(50, 0, 100), 0);
  assert.equal(hueWindowChromaFromVerticalPosition(100, 0, 100), -1);
});

test("preview dirty scopes keep chroma redraws away from unrelated controls", () => {
  assert.deepEqual(previewScopesForConfigKeys(["tintStrength"]), ["tint"]);
  assert.deepEqual(previewScopesForConfigKeys(["hueWindowChroma"]), ["hue"]);
  assert.deepEqual(previewScopesForConfigKeys(["lift"]), ["luma"]);
  assert.deepEqual(previewScopesForConfigKeys(["chromaGamma"]), ["chroma"]);
  assert.deepEqual(previewScopesForConfigKeys(["exposure"]).sort(), ["chroma", "luma"]);
  assert.deepEqual(previewScopesForConfigKeys(["gamma"]).sort(), ["chroma", "luma"]);
  assert.deepEqual(previewScopesForConfigKeys(["tintHighHue", "curveStrength"]).sort(), ["luma", "tint"]);
  assert.deepEqual(previewScopesForConfigKeys(["hueWindowWidth", "curveStrength"]).sort(), ["hue", "luma"]);
});

test("changedConfigKeys reports only actual config changes", () => {
  assert.deepEqual(changedConfigKeys({gamma: 1, tintStrength: 0}, {gamma: 1, tintStrength: 0}), []);
  assert.deepEqual(changedConfigKeys({gamma: 1, tintStrength: 0}, {gamma: 1.2, tintStrength: 0}), ["gamma"]);
  assert.deepEqual(changedConfigKeys({gamma: 1}, {gamma: 1, chromaGamma: 1}), ["chromaGamma"]);
});
