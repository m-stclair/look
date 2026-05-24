import { CONTROL_GROUPS, DEFAULT_CONFIG, normalizeConfig, groupControlDefinitions } from "../config.js";

export const SHADOW_LOW = 0.18;
export const SHADOW_HIGH = 0.35;
export const HIGHLIGHT_LOW = 0.65;
export const HIGHLIGHT_HIGH = 0.8;
export const TONE_PIVOT_MIN_LUMA = 1 / 256;
export const BASE_TONE_PIVOT_LUMA = 0.5;
export const CHROMA_PREVIEW_MAX = 1;
export const CHROMA_GRAPH_Y_MAX = 1;
export const CHROMA_DISPLAY_PERCENTILE = 0.99;
export const CHROMA_DEFAULT_DISPLAY_MAX = 0.25;
export const CHROMA_MIN_DISPLAY_MAX = 0.05;
export const CHROMA_FADE_GAUGE_HEIGHT = 36;
export const CHROMA_FADE_MASK_HEIGHT = 42;
export const CHROMA_FADE_LANE_BOTTOM_OFFSET = 16;
export const LUMA_REFERENCE_SAMPLES = Object.freeze([
  {label: "shadow", luma: 0.18, dash: [2, 3], alpha: 0.44},
  {label: "mid", luma: 0.5, dash: [], alpha: 0.92},
  {label: "high", luma: 0.82, dash: [7, 3], alpha: 0.62}
]);

export const TONAL_BALANCE_HANDLES = Object.freeze([
  {key: "lift", label: "Lift", symbol: "L", luma: SHADOW_HIGH / 2},
  {key: "midtone", label: "Midtone", symbol: "M", luma: (SHADOW_HIGH + HIGHLIGHT_LOW) / 2},
  {key: "gain", label: "Gain", symbol: "G", luma: (HIGHLIGHT_LOW + 1) / 2}
]);

export const CONTROL_DEFINITIONS = new Map(CONTROL_GROUPS.flatMap(group => groupControlDefinitions(group).map(control => [control.key, control])));


function configScalar(rawConfig, key) {
  return rawConfig && Object.prototype.hasOwnProperty.call(rawConfig, key)
    ? rawConfig[key]
    : DEFAULT_CONFIG[key];
}

export function chromaCurveParams(rawConfig = {}) {
  return {
    exposure: configScalar(rawConfig, "exposure"),
    gamma: configScalar(rawConfig, "gamma"),
    chromaExposure: configScalar(rawConfig, "chromaExposure"),
    chromaGamma: configScalar(rawConfig, "chromaGamma"),
    chromaFadeStrength: configScalar(rawConfig, "chromaFadeStrength"),
    chromaFadeRegion: configScalar(rawConfig, "chromaFadeRegion"),
    chromaFadeCenter: configScalar(rawConfig, "chromaFadeCenter"),
    chromaFadeSoftness: configScalar(rawConfig, "chromaFadeSoftness")
  };
}

export function adjustedLumaFromInputLumaWithParams(inputLuma, params) {
  return clamp01(gammaAdjust(exposureAdjust(inputLuma, params.exposure), params.gamma));
}

export function chromaBaseCurveSampleWithParams(inputChroma, params) {
  return Math.max(gammaAdjust(exposureAdjust(inputChroma, params.chromaExposure), params.chromaGamma), 0);
}

export function chromaCurveSampleWithParams(inputChroma, inputLuma = 0.5, params) {
  const luma = adjustedLumaFromInputLumaWithParams(inputLuma, params);
  const chroma = chromaBaseCurveSampleWithParams(inputChroma, params);
  const chromaFade = chromaFadeMask(luma, params);
  return mix(chroma, chroma * chromaFade, params.chromaFadeStrength);
}

export function normalizeSourceHistograms(nextHistogram) {
  if (!nextHistogram) return {luma: null, chroma: null, chromaByLuma: null, maxChroma: null, chromaDomainMax: null};
  if (ArrayBuffer.isView(nextHistogram) || Array.isArray(nextHistogram)) {
    return {luma: nextHistogram, chroma: null, chromaByLuma: null, maxChroma: null, chromaDomainMax: null};
  }
  return {
    luma: nextHistogram.luma || null,
    chroma: nextHistogram.chroma || nextHistogram.chromaHistogram || null,
    chromaByLuma: nextHistogram.chromaByLuma || nextHistogram.chromaJointHistogram || null,
    maxChroma: Number.isFinite(nextHistogram.maxChroma) ? nextHistogram.maxChroma : null,
    chromaDomainMax: Number.isFinite(nextHistogram.chromaDomainMax) ? nextHistogram.chromaDomainMax : null
  };
}

export function lumaToneBaseSample(inputLuma, rawConfig = {}) {
  const config = normalizeConfig(rawConfig);
  const luma = adjustedLumaFromInputLuma(inputLuma, config);
  const pivot = effectiveTonePivotLuma(config);
  const slope = toneSlopeFromControls(config.curveStrength, config.toneShoulder);
  return pivotedLogitCurve(luma, pivot, slope);
}

export function lumaCurveSample(inputLuma, rawConfig = {}) {
  const config = normalizeConfig(rawConfig);
  return applyLiftMidtoneGain(lumaToneBaseSample(inputLuma, config), config.lift, config.midtone, config.gain);
}

export function tonalBalanceHandleValue(key, inputLuma, rawConfig = {}) {
  const config = normalizeConfig(rawConfig);
  return clamp01(lumaToneBaseSample(inputLuma, config) + (config[key] || 0));
}


export function transformLumaHistogram(sourceHistogram, rawConfig = {}, outputBinCount = sourceHistogram?.length || 0) {
  if (!sourceHistogram || !sourceHistogram.length) return null;
  const binCount = Math.max(1, outputBinCount);
  const transformed = new Float32Array(binCount);

  for (let index = 0; index < sourceHistogram.length; index += 1) {
    const count = sourceHistogram[index];
    if (!count) continue;
    const inputLuma = (index + 0.5) / sourceHistogram.length;
    const outputLuma = clamp01(lumaCurveSample(inputLuma, rawConfig));
    const position = outputLuma * (binCount - 1);
    const lowIndex = Math.floor(position);
    const highIndex = Math.min(binCount - 1, lowIndex + 1);
    const highWeight = position - lowIndex;
    transformed[lowIndex] += count * (1 - highWeight);
    transformed[highIndex] += count * highWeight;
  }

  return transformed;
}

export function transformChromaHistogram(sourceHistogram, rawConfig = {}, outputBinCount = sourceHistogram?.length || 0, options = {}) {
  if (!sourceHistogram || !sourceHistogram.length) return null;
  if (options.chromaByLuma && options.chromaByLuma.length) {
    return transformChromaJointHistogram(options.chromaByLuma, rawConfig, outputBinCount, options);
  }

  const binCount = Math.max(1, outputBinCount);
  const transformed = new Float32Array(binCount);
  const outputMax = Math.max(options.outputMax ?? CHROMA_PREVIEW_MAX, 1e-6);
  const inputMax = Math.max(options.inputMax ?? CHROMA_PREVIEW_MAX, 1e-6);
  const params = chromaCurveParams(rawConfig);

  for (let index = 0; index < sourceHistogram.length; index += 1) {
    const count = sourceHistogram[index];
    if (!count) continue;
    const inputChroma = ((index + 0.5) / sourceHistogram.length) * inputMax;
    const outputChroma = clamp01(chromaBaseCurveSampleWithParams(inputChroma, params) / outputMax);
    distributeHistogramCount(transformed, outputChroma, count);
  }

  return transformed;
}

export function transformChromaJointHistogram(chromaByLuma, rawConfig = {}, outputBinCount = 0, options = {}) {
  if (!chromaByLuma || !chromaByLuma.length) return null;
  const inputBinCount = Math.round(Math.sqrt(chromaByLuma.length));
  if (inputBinCount < 1 || inputBinCount * inputBinCount !== chromaByLuma.length) return null;
  const binCount = Math.max(1, outputBinCount || inputBinCount);
  const transformed = new Float32Array(binCount);
  const outputMax = Math.max(options.outputMax ?? CHROMA_PREVIEW_MAX, 1e-6);
  const inputMax = Math.max(options.inputMax ?? CHROMA_PREVIEW_MAX, 1e-6);
  const params = chromaCurveParams(rawConfig);

  for (let lumaIndex = 0; lumaIndex < inputBinCount; lumaIndex += 1) {
    const inputLuma = (lumaIndex + 0.5) / inputBinCount;
    for (let chromaIndex = 0; chromaIndex < inputBinCount; chromaIndex += 1) {
      const count = chromaByLuma[lumaIndex * inputBinCount + chromaIndex];
      if (!count) continue;
      const inputChroma = ((chromaIndex + 0.5) / inputBinCount) * inputMax;
      const outputChroma = clamp01(chromaCurveSampleWithParams(inputChroma, inputLuma, params) / outputMax);
      distributeHistogramCount(transformed, outputChroma, count);
    }
  }

  return transformed;
}

export function maxChromaFromHistogram(histogram, domainMax = CHROMA_PREVIEW_MAX) {
  if (!histogram || !histogram.length) return null;
  for (let index = histogram.length - 1; index >= 0; index -= 1) {
    if (histogram[index] > 0) return ((index + 0.5) / histogram.length) * domainMax;
  }
  return null;
}

export function chromaPercentileFromHistogram(histogram, percentile = CHROMA_DISPLAY_PERCENTILE, domainMax = CHROMA_PREVIEW_MAX) {
  if (!histogram || !histogram.length) return null;
  const safePercentile = clamp(percentile, 0, 1);
  let total = 0;
  for (const value of histogram) total += value;
  if (total <= 0) return null;

  const threshold = total * safePercentile;
  let cumulative = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    cumulative += histogram[index];
    if (cumulative >= threshold) return ((index + 1) / histogram.length) * domainMax;
  }
  return domainMax;
}

export function chromaDisplayMaxFromHistogram(histogram, fallback = CHROMA_DEFAULT_DISPLAY_MAX) {
  const percentileValue = chromaPercentileFromHistogram(histogram, CHROMA_DISPLAY_PERCENTILE, CHROMA_PREVIEW_MAX);
  const candidate = percentileValue ?? fallback;
  return clamp(candidate, CHROMA_MIN_DISPLAY_MAX, CHROMA_PREVIEW_MAX);
}

function distributeHistogramCount(histogram, unitPosition, count) {
  const binCount = histogram.length;
  const position = clamp01(unitPosition) * (binCount - 1);
  const lowIndex = Math.floor(position);
  const highIndex = Math.min(binCount - 1, lowIndex + 1);
  const highWeight = position - lowIndex;
  histogram[lowIndex] += count * (1 - highWeight);
  histogram[highIndex] += count * highWeight;
}

export function chromaCurveSample(inputChroma, inputLuma = 0.5, rawConfig = {}) {
  return chromaCurveSampleWithParams(inputChroma, inputLuma, chromaCurveParams(rawConfig));
}

export function chromaBaseCurveSample(inputChroma, rawConfig = {}) {
  return chromaBaseCurveSampleWithParams(inputChroma, chromaCurveParams(rawConfig));
}

export const CHROMA_PLACEMENT_CHROMA = 0.18;
export const CHROMA_GAMMA_HANDLE_CHROMA = 0.24;
const CHROMA_PLACEMENT_HANDLE_UNIT = 0.46;
const CHROMA_GAMMA_HANDLE_UNIT = 0.64;

export function chromaVisibleHandleChroma(domainMax, preferredChroma, fallbackUnit) {
  const safeDomain = Math.max(domainMax || 0, 1e-6);
  return clamp(Math.min(preferredChroma, safeDomain * fallbackUnit), 1e-6, CHROMA_PREVIEW_MAX);
}

export function chromaPlacementTargetChromaForDomain(domainMax) {
  return chromaVisibleHandleChroma(domainMax, CHROMA_PLACEMENT_CHROMA, CHROMA_PLACEMENT_HANDLE_UNIT);
}

export function chromaGammaHandleChromaForDomain(domainMax) {
  return chromaVisibleHandleChroma(domainMax, CHROMA_GAMMA_HANDLE_CHROMA, CHROMA_GAMMA_HANDLE_UNIT);
}

export function chromaPlacementInputChroma(rawConfig = {}, targetChroma = CHROMA_PLACEMENT_CHROMA) {
  const config = normalizeConfig(rawConfig);
  const gamma = Math.max(config.chromaGamma, 1e-4);
  const exposureScale = Math.max(Math.pow(2, config.chromaExposure), 1e-9);
  const target = clamp(targetChroma, 1e-6, CHROMA_PREVIEW_MAX);
  return clamp(Math.pow(target, gamma) / exposureScale, 0, CHROMA_PREVIEW_MAX);
}

export function chromaExposureValueFromPlacementInputChroma(inputChroma, rawConfig = {}, targetChroma = CHROMA_PLACEMENT_CHROMA) {
  const config = normalizeConfig(rawConfig);
  const gamma = Math.max(config.chromaGamma, 1e-4);
  const target = clamp(targetChroma, 1e-6, CHROMA_PREVIEW_MAX);
  const targetPreGamma = Math.pow(target, gamma);
  const safeInput = Math.max(1e-6, clamp(inputChroma, 0, CHROMA_PREVIEW_MAX));
  return sanitizeControlValue("chromaExposure", Math.log2(targetPreGamma / safeInput));
}

export function chromaExposureValueFromHorizontalPosition(clientX, left, width, rawConfig = {}, domainMax = CHROMA_PREVIEW_MAX) {
  const local = width > 0 ? clamp01((clientX - left) / width) : 0;
  const targetChroma = chromaPlacementTargetChromaForDomain(domainMax);
  return chromaExposureValueFromPlacementInputChroma(local * Math.max(domainMax, 1e-6), rawConfig, targetChroma);
}

export function chromaGammaValueFromVerticalDrag(startValue, deltaClientY, plotHeight) {
  const height = Math.max(1, plotHeight || 1);
  const octaves = -2.4 * deltaClientY / height;
  return sanitizeControlValue("chromaGamma", startValue * Math.pow(2, octaves));
}

export function chromaFadeWindow(rawConfig = {}) {
  const config = normalizeConfig(rawConfig);
  const center = sanitizeControlValue("chromaFadeCenter", config.chromaFadeCenter);
  const softness = sanitizeControlValue("chromaFadeSoftness", config.chromaFadeSoftness);
  const half = softness / 2;
  return {
    center,
    softness,
    low: center - half,
    high: center + half
  };
}

export function chromaFadeMask(adjustedLuma, rawConfig = {}) {
  const config = normalizeConfig(rawConfig);
  const {low, high} = chromaFadeWindow(config);
  const ramp = smoothstep(low, high, adjustedLuma);
  return config.chromaFadeRegion >= 0.5 ? 1 - ramp : ramp;
}

export function chromaFadeRegionLabel(value) {
  return sanitizeControlValue("chromaFadeRegion", value) >= 0.5 ? "Highlights" : "Shadows";
}

export function chromaFadeCenterUnitFromValue(value) {
  return clamp01(sanitizeControlValue("chromaFadeCenter", value));
}

export function chromaFadeCenterValueFromUnit(unit) {
  return sanitizeControlValue("chromaFadeCenter", clamp01(unit));
}

export function chromaFadeCenterValueFromHorizontalPosition(clientX, left, width) {
  const unit = width > 0 ? (clientX - left) / width : 0;
  return chromaFadeCenterValueFromUnit(unit);
}

export function chromaFadeSoftnessUnitFromValue(value) {
  const control = CONTROL_DEFINITIONS.get("chromaFadeSoftness");
  const min = control?.min ?? 0.02;
  const max = control?.max ?? 1;
  return clamp01((sanitizeControlValue("chromaFadeSoftness", value) - min) / Math.max(1e-9, max - min));
}

export function chromaFadeSoftnessEdgeUnit(rawConfig = {}) {
  const {center, softness} = chromaFadeWindow(rawConfig);
  return clamp01(center + softness / 2);
}

export function chromaFadeSoftnessFromHorizontalPosition(clientX, left, width, rawConfig = {}) {
  const center = chromaFadeWindow(rawConfig).center;
  const pointerUnit = width > 0 ? clamp01((clientX - left) / width) : center;
  return sanitizeControlValue("chromaFadeSoftness", Math.abs(pointerUnit - center) * 2);
}

export function chromaFadeStrengthUnitFromValue(value) {
  return clamp01(sanitizeControlValue("chromaFadeStrength", value));
}

export function chromaFadeStrengthFromGaugePointer(clientY, top, height) {
  const local = height > 0 ? (clientY - top) / height : 1;
  return sanitizeControlValue("chromaFadeStrength", 1 - local);
}

export function gammaAdjust(value, gammaValue) {
  return Math.pow(Math.max(value, 0), 1 / Math.max(gammaValue, 1e-4));
}

export function exposureAdjust(value, exposureValue) {
  return value * Math.pow(2, exposureValue);
}

export function adjustedLumaFromInputLuma(inputLuma, rawConfig = {}) {
  return adjustedLumaFromInputLumaWithParams(inputLuma, chromaCurveParams(rawConfig));
}

export function inputLumaFromAdjustedLuma(adjustedLuma, rawConfig = {}) {
  const config = normalizeConfig(rawConfig);
  const gamma = Math.max(config.gamma, 1e-4);
  const exposureScale = Math.max(Math.pow(2, config.exposure), 1e-9);
  return clamp01(Math.pow(clamp01(adjustedLuma), gamma) / exposureScale);
}

export const EXPOSURE_PLACEMENT_LUMA = 0.18;

export function exposurePlacementInputLuma(rawConfig = {}) {
  return inputLumaFromAdjustedLuma(EXPOSURE_PLACEMENT_LUMA, rawConfig);
}

export function exposureValueFromPlacementInputLuma(inputLuma, rawConfig = {}) {
  const config = normalizeConfig(rawConfig);
  const gamma = Math.max(config.gamma, 1e-4);
  const targetPreGamma = Math.pow(EXPOSURE_PLACEMENT_LUMA, gamma);
  const safeInput = Math.max(1e-6, clamp01(inputLuma));
  return sanitizeControlValue("exposure", Math.log2(targetPreGamma / safeInput));
}

export function exposureValueFromHorizontalPosition(clientX, left, width, rawConfig = {}) {
  const local = width > 0 ? (clientX - left) / width : 0;
  return exposureValueFromPlacementInputLuma(local, rawConfig);
}

export function toneSlopeFromControls(curveStrength, toneShoulder) {
  const amount = clamp01(Number.isFinite(curveStrength) ? curveStrength : 0);
  const shoulder = Math.max(Number.isFinite(toneShoulder) ? toneShoulder : 1, 1e-4);
  return 1 + amount * (shoulder - 1);
}

export function pivotedLogitCurve(inputLuma, pivotLuma, slope = 1) {
  const x = clamp01(inputLuma);
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const pivot = clamp(pivotLuma, 1e-6, 1 - 1e-6);
  const safeSlope = Math.max(Number.isFinite(slope) ? slope : 1, 1e-4);
  if (Math.abs(safeSlope - 1) < 1e-12) return x;
  const t = logit(pivot) + safeSlope * (logit(x) - logit(pivot));
  return clamp01(invLogit(t));
}

export function applyLiftMidtoneGain(luma, lift, midtone, gain) {
  const shadow = 1 - smoothstep(SHADOW_LOW, SHADOW_HIGH, luma);
  const mid = smoothstep(SHADOW_LOW, SHADOW_HIGH, luma) * (1 - smoothstep(HIGHLIGHT_LOW, HIGHLIGHT_HIGH, luma));
  const highlight = smoothstep(HIGHLIGHT_LOW, HIGHLIGHT_HIGH, luma);
  const delta = lift * shadow + midtone * mid + gain * highlight;
  return clamp01(luma + delta);
}

export function tonalBalanceValueFromVerticalDrag(key, startValue, deltaClientY, plotHeight) {
  const height = Math.max(1, plotHeight || 1);
  return sanitizeControlValue(key, startValue - deltaClientY / height);
}

export function gammaValueFromVerticalDrag(startValue, deltaClientY, plotHeight) {
  const height = Math.max(1, plotHeight || 1);
  const octaves = -2.4 * deltaClientY / height;
  return sanitizeControlValue("gamma", startValue * Math.pow(2, octaves));
}

export function curveStrengthValueFromVerticalDrag(startValue, deltaClientY, plotHeight) {
  const height = Math.max(1, plotHeight || 1);
  return sanitizeControlValue("curveStrength", startValue - 1.25 * deltaClientY / height);
}

export function pivotLumaFromToneCenter(toneCenter) {
  if (!Number.isFinite(toneCenter)) return pivotLumaFromToneCenter(0);
  return clamp01(Math.pow(2, toneCenter));
}

export function toneCenterFromPivotLuma(pivotLuma) {
  return Math.log2(Math.max(TONE_PIVOT_MIN_LUMA, clamp01(pivotLuma)));
}

export function inputLumaFromToneCenter(toneCenter, rawConfig = {}) {
  return inputLumaFromAdjustedLuma(pivotLumaFromToneCenter(toneCenter), rawConfig);
}

export function toneCenterFromInputLuma(inputLuma, rawConfig = {}) {
  return toneCenterFromPivotLuma(adjustedLumaFromInputLuma(inputLuma, rawConfig));
}

export function baseTonePivotInputLuma(rawConfig = {}) {
  return inputLumaFromAdjustedLuma(BASE_TONE_PIVOT_LUMA, rawConfig);
}

export function tonePivotInputLuma(rawConfig = {}) {
  const config = normalizeConfig(rawConfig);
  return clamp01(baseTonePivotInputLuma(config) + config.tonePivotNudge);
}

export function effectiveTonePivotLuma(rawConfig = {}) {
  return adjustedLumaFromInputLuma(tonePivotInputLuma(rawConfig), rawConfig);
}

export function effectiveToneCenter(rawConfig = {}) {
  return toneCenterFromPivotLuma(effectiveTonePivotLuma(rawConfig));
}

export function tonePivotNudgeFromInputLuma(inputLuma, rawConfig = {}) {
  const config = normalizeConfig(rawConfig);
  return sanitizeControlValue("tonePivotNudge", clamp01(inputLuma) - baseTonePivotInputLuma(config));
}

export function tonePivotNudgeFromSlopeHandleInputLuma(inputLuma, rawConfig = {}) {
  return tonePivotNudgeFromInputLuma(inputLuma, rawConfig);
}

export function tonePivotNudgeFromHorizontalPosition(clientX, left, width, rawConfig = {}) {
  const local = width > 0 ? (clientX - left) / width : 0;
  return tonePivotNudgeFromInputLuma(local, rawConfig);
}

export function clampFloatingWindowPosition(left, top, width, height, viewportWidth, viewportHeight, options = {}) {
  const margin = options.margin ?? 6;
  const topSpace = options.topSpace ?? 0;
  const bottomSpace = options.bottomSpace ?? 34;
  const safeWidth = Math.max(1, width || 1);
  const safeHeight = Math.max(1, height || 1);
  const minTop = margin + topSpace;
  const maxLeft = Math.max(margin, viewportWidth - safeWidth - margin);
  const maxTop = Math.max(minTop, viewportHeight - safeHeight - margin - bottomSpace);
  return {
    left: Math.min(maxLeft, Math.max(margin, left)),
    top: Math.min(maxTop, Math.max(minTop, top))
  };
}

export function histogramDensityAtLuma(histogram, luma, radius = 0.045) {
  if (!histogram || !histogram.length) return 1;
  let total = 0;
  for (const value of histogram) total += value;
  if (total <= 0) return 0;

  const low = Math.max(0, Math.floor((luma - radius) * histogram.length));
  const high = Math.min(histogram.length - 1, Math.ceil((luma + radius) * histogram.length));
  let local = 0;
  for (let index = low; index <= high; index += 1) local += histogram[index];

  const windowFraction = (high - low + 1) / histogram.length;
  const uniformExpectation = total * windowFraction;
  return clamp01(local / Math.max(uniformExpectation, 1));
}

export function histogramDisplayProfile(histogram, options = {}) {
  if (!histogram || !histogram.length) return null;
  const clipFraction = options.clipFraction ?? 0.035;
  let total = 0;
  let maxValue = 0;
  for (const value of histogram) {
    total += value;
    maxValue = Math.max(maxValue, value);
  }
  if (total <= 0 || maxValue <= 0) return null;

  const capValue = Math.max(1e-9, total * clipFraction);
  const normalizationValue = Math.min(maxValue, capValue);
  return Array.from(histogram, value => {
    const clipped = value > capValue;
    const cappedValue = Math.min(value, capValue);
    return {
      value,
      clipped,
      scaled: Math.sqrt(cappedValue / normalizationValue)
    };
  });
}

export function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function safeLog2(value) {
  return Math.log2(Math.max(value, 1e-6));
}

export function logit(value) {
  const x = clamp(value, 1e-6, 1 - 1e-6);
  return Math.log(x / (1 - x));
}

export function invLogit(value) {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

export function mix(a, b, weight) {
  return a * (1 - weight) + b * weight;
}

export function sanitizeControlValue(key, value) {
  const definition = CONTROL_DEFINITIONS.get(key);
  const fallback = definition?.min ?? -Infinity;
  if (!Number.isFinite(value)) return fallback;
  if (!definition) return value;
  return Math.min(definition.max, Math.max(definition.min, value));
}

export function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

export function clamp01(value) {
  return clamp(value, 0, 1);
}

export function formatCompact(value) {
  if (Math.abs(value) >= 10) return value.toFixed(0);
  if (Math.abs(value) >= 1) return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function formatSigned(value) {
  const text = formatCompact(value);
  return value > 0 ? `+${text}` : text;
}

export function devicePixelRatioSafe() {
  return typeof window === "undefined" ? 1 : Math.max(1, window.devicePixelRatio || 1);
}
