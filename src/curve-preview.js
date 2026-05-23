import { CHROMA_MAP_CONTROL_KEYS, CONTROL_GROUPS, TONE_MAP_CONTROL_KEYS, normalizeConfig, groupControlDefinitions, resetChromaMapConfig, resetToneMapConfig } from "./config.js";

const SHADOW_LOW = 0.18;
const SHADOW_HIGH = 0.35;
const HIGHLIGHT_LOW = 0.65;
const HIGHLIGHT_HIGH = 0.8;
const TONE_PIVOT_MIN_LUMA = 1 / 256;
const BASE_TONE_PIVOT_LUMA = 0.5;
export const CHROMA_PREVIEW_MAX = 1;
const CHROMA_GRAPH_Y_MAX = 1;
const CHROMA_DISPLAY_PERCENTILE = 0.99;
const CHROMA_DEFAULT_DISPLAY_MAX = 0.25;
const CHROMA_MIN_DISPLAY_MAX = 0.05;
export const CHROMA_FADE_GAUGE_HEIGHT = 36;
const CHROMA_FADE_LANE_BOTTOM_OFFSET = 18;
const LUMA_REFERENCE_SAMPLES = Object.freeze([
  {label: "shadow", luma: 0.18, dash: [2, 3], alpha: 0.44},
  {label: "mid", luma: 0.5, dash: [], alpha: 0.92},
  {label: "high", luma: 0.82, dash: [7, 3], alpha: 0.62}
]);

export const TONAL_BALANCE_HANDLES = Object.freeze([
  {key: "lift", label: "Lift", symbol: "L", luma: SHADOW_HIGH / 2},
  {key: "midtone", label: "Midtone", symbol: "M", luma: (SHADOW_HIGH + HIGHLIGHT_LOW) / 2},
  {key: "gain", label: "Gain", symbol: "G", luma: (HIGHLIGHT_LOW + 1) / 2}
]);

const CONTROL_DEFINITIONS = new Map(CONTROL_GROUPS.flatMap(group => groupControlDefinitions(group).map(control => [control.key, control])));

export function createCurvePreviews(root, initialConfig, options = {}) {
  root.textContent = "";
  const lumaCanvas = createPreviewCard(root, {
    title: "Tone Map",
    className: "tone-map-card"
  });
  lumaCanvas.classList.add("luma-curve-canvas");
  lumaCanvas.setAttribute("aria-label", "Tone Map with exposure, gamma, slope, shoulder, and trim handles");

  const chromaCanvas = createPreviewCard(root, {
    title: "Chroma Response",
  });
  chromaCanvas.classList.add("chroma-curve-canvas");

  let config = normalizeConfig(initialConfig);
  let sourceHistogram = null;
  let sourceChromaHistogram = null;
  let sourceChromaByLuma = null;
  let sourceMaxChroma = null;
  let sourceChromaDomainMax = null;
  let rafId = 0;
  let activeBalanceHandle = null;
  let hoverBalanceHandle = null;
  let activeShapeHandle = null;
  let hoverShapeHandle = null;
  let activeChromaHandle = null;
  let hoverChromaHandle = null;
  let toneControls = null;
  let chromaControls = null;

  function setConfigValue(key, value) {
    setConfigValues({[key]: sanitizeControlValue(key, value)});
  }

  function setConfigValues(patch) {
    const nextConfig = normalizeConfig({...config});
    for (const [key, value] of Object.entries(patch || {})) {
      nextConfig[key] = sanitizeControlValue(key, value);
    }
    config = nextConfig;
    toneControls?.sync(nextConfig);
    chromaControls?.sync(nextConfig);
    scheduleRender(nextConfig);
    options.onConfigChange?.(nextConfig);
  }

  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => scheduleRender());
  resizeObserver?.observe(lumaCanvas);
  resizeObserver?.observe(chromaCanvas);

  toneControls = createToneMapControls(lumaCanvas, {
    getConfig: () => config,
    setConfigValue,
    setConfigValues,
    requestRender: () => scheduleRender(config)
  });

  chromaControls = createChromaMapControls(chromaCanvas, {
    getConfig: () => config,
    setConfigValue,
    setConfigValues,
    requestRender: () => scheduleRender(config)
  });

  const unbindShapeHandles = bindToneShapeHandles(lumaCanvas, {
    getConfig: () => config,
    getActiveKey: () => activeShapeHandle?.key || null,
    getHoverKey: () => hoverShapeHandle,
    setActiveHandle: handle => {
      activeShapeHandle = handle;
      scheduleRender(config);
    },
    setHoverKey: key => {
      if (hoverShapeHandle === key) return;
      hoverShapeHandle = key;
      scheduleRender(config);
    },
    setConfigValue
  });

  const unbindLumaHandles = bindTonalBalanceHandles(lumaCanvas, {
    getConfig: () => config,
    getActiveKey: () => activeBalanceHandle?.key || null,
    getHoverKey: () => hoverBalanceHandle,
    setActiveHandle: handle => {
      activeBalanceHandle = handle;
      scheduleRender(config);
    },
    setHoverKey: key => {
      if (hoverBalanceHandle === key) return;
      hoverBalanceHandle = key;
      scheduleRender(config);
    },
    setConfigValue
  });

  const unbindChromaHandles = bindChromaMapHandles(chromaCanvas, {
    getConfig: () => config,
    getDisplayMax: () => computeChromaGraphMetrics(config, {
      sourceChromaHistogram,
      sourceChromaByLuma,
      sourceMaxChroma,
      sourceChromaDomainMax
    }).displayMax,
    getActiveKey: () => activeChromaHandle?.key || null,
    getHoverKey: () => hoverChromaHandle,
    setActiveHandle: handle => {
      activeChromaHandle = handle;
      scheduleRender(config);
    },
    setHoverKey: key => {
      if (hoverChromaHandle === key) return;
      hoverChromaHandle = key;
      scheduleRender(config);
    },
    setConfigValue
  });

  function scheduleRender(nextConfig = config) {
    config = normalizeConfig(nextConfig);
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      renderNow();
    });
  }

  function renderNow(nextConfig = config) {
    config = normalizeConfig(nextConfig);
    toneControls?.sync(config);
    chromaControls?.sync(config);
    drawLumaPreview(lumaCanvas, config, sourceHistogram, {
      activeKey: activeBalanceHandle?.key || null,
      hoverKey: hoverBalanceHandle,
      showTonePivot: true,
      activeShapeKey: activeShapeHandle?.key || null,
      hoverShapeKey: hoverShapeHandle,
      pivotActive: toneControls?.isDraggingPivot() || activeShapeHandle?.key === "curveStrength" || hoverShapeHandle === "curveStrength",
      pivotExposed: toneControls?.isExpanded()
    });
    drawChromaPreview(chromaCanvas, config, {
      activeChromaKey: activeChromaHandle?.key || null,
      hoverChromaKey: hoverChromaHandle,
      sourceChromaHistogram,
      sourceChromaByLuma,
      sourceMaxChroma,
      sourceChromaDomainMax
    });
  }

  renderNow(config);

  return {
    render: scheduleRender,
    setHistogram(nextHistogram) {
      const histograms = normalizeSourceHistograms(nextHistogram);
      sourceHistogram = histograms.luma;
      sourceChromaHistogram = histograms.chroma;
      sourceChromaByLuma = histograms.chromaByLuma;
      sourceMaxChroma = histograms.maxChroma;
      sourceChromaDomainMax = histograms.chromaDomainMax;
      scheduleRender(config);
    },
    destroy() {
      if (rafId) cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      unbindShapeHandles();
      unbindLumaHandles();
      unbindChromaHandles();
      toneControls?.destroy();
      chromaControls?.destroy();
    }
  };
}

function normalizeSourceHistograms(nextHistogram) {
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

  for (let index = 0; index < sourceHistogram.length; index += 1) {
    const count = sourceHistogram[index];
    if (!count) continue;
    const inputChroma = ((index + 0.5) / sourceHistogram.length) * inputMax;
    const outputChroma = clamp01(chromaBaseCurveSample(inputChroma, rawConfig) / outputMax);
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

  for (let lumaIndex = 0; lumaIndex < inputBinCount; lumaIndex += 1) {
    const inputLuma = (lumaIndex + 0.5) / inputBinCount;
    for (let chromaIndex = 0; chromaIndex < inputBinCount; chromaIndex += 1) {
      const count = chromaByLuma[lumaIndex * inputBinCount + chromaIndex];
      if (!count) continue;
      const inputChroma = ((chromaIndex + 0.5) / inputBinCount) * inputMax;
      const outputChroma = clamp01(chromaCurveSample(inputChroma, inputLuma, rawConfig) / outputMax);
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
  const config = normalizeConfig(rawConfig);
  const luma = adjustedLumaFromInputLuma(inputLuma, config);
  const chroma = chromaBaseCurveSample(inputChroma, config);
  const chromaFade = smoothstep(config.chromaFadeLow, config.chromaFadeHigh, luma);
  return mix(chroma, chroma * chromaFade, config.chromaFadeStrength);
}

export function chromaBaseCurveSample(inputChroma, rawConfig = {}) {
  const config = normalizeConfig(rawConfig);
  return Math.max(gammaAdjust(exposureAdjust(inputChroma, config.chromaExposure), config.chromaGamma), 0);
}

export const CHROMA_PLACEMENT_CHROMA = 0.18;
export const CHROMA_GAMMA_HANDLE_CHROMA = 0.24;
const CHROMA_PLACEMENT_HANDLE_UNIT = 0.46;
const CHROMA_GAMMA_HANDLE_UNIT = 0.64;

function chromaVisibleHandleChroma(domainMax, preferredChroma, fallbackUnit) {
  const safeDomain = Math.max(domainMax || 0, 1e-6);
  return clamp(Math.min(preferredChroma, safeDomain * fallbackUnit), 1e-6, CHROMA_PREVIEW_MAX);
}

function chromaPlacementTargetChromaForDomain(domainMax) {
  return chromaVisibleHandleChroma(domainMax, CHROMA_PLACEMENT_CHROMA, CHROMA_PLACEMENT_HANDLE_UNIT);
}

function chromaGammaHandleChromaForDomain(domainMax) {
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

export function chromaFadeBoundaryUnitFromValue(value) {
  const control = CONTROL_DEFINITIONS.get("chromaFadeLow");
  const min = control?.min ?? -6;
  const max = control?.max ?? 6;
  return clamp01((sanitizeControlValue("chromaFadeLow", value) - min) / Math.max(1e-9, max - min));
}

export function chromaFadeBoundaryValueFromUnit(unit) {
  const control = CONTROL_DEFINITIONS.get("chromaFadeLow");
  const min = control?.min ?? -6;
  const max = control?.max ?? 6;
  return sanitizeControlValue("chromaFadeLow", mix(min, max, clamp01(unit)));
}

export function chromaFadeBoundaryValueFromHorizontalPosition(clientX, left, width) {
  const unit = width > 0 ? (clientX - left) / width : 0;
  return chromaFadeBoundaryValueFromUnit(unit);
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
  const config = normalizeConfig(rawConfig);
  return clamp01(gammaAdjust(exposureAdjust(inputLuma, config.exposure), config.gamma));
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


function drawTonePivotMarker(frame, config, {active = false, exposed = false} = {}) {
  const {ctx} = frame;
  const plot = plotRect(frame);
  const dpr = devicePixelRatioSafe();
  const pivotInput = tonePivotInputLuma(config);
  const x = plot.x + pivotInput * plot.w;
  const strength = clamp01(config.curveStrength || 0);
  const railAlpha = active ? 0.62 : exposed ? Math.max(0.26, 0.13 + 0.36 * strength) : 0.1 + 0.36 * strength;

  ctx.save();
  ctx.globalAlpha = railAlpha;
  ctx.strokeStyle = frame.text.trim();
  ctx.lineWidth = 1 * dpr;
  ctx.setLineDash([4 * dpr, 3 * dpr]);
  line(ctx, x, plot.y, x, plot.y + plot.h);
  ctx.setLineDash([]);

  ctx.globalAlpha = Math.min(0.86, railAlpha + 0.18);
  ctx.fillStyle = frame.bg.trim();
  ctx.strokeStyle = active ? frame.accent.trim() : frame.text.trim();
  ctx.lineWidth = 1 * dpr;
  ctx.beginPath();
  ctx.moveTo(x, plot.y + plot.h + 1 * dpr);
  ctx.lineTo(x - 5 * dpr, plot.y + plot.h - 6 * dpr);
  ctx.lineTo(x + 5 * dpr, plot.y + plot.h - 6 * dpr);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}


const GAMMA_HANDLE_LUMA = 0.42;
const NEGLIGIBLE_CURVE_STRENGTH = 0.015;
const SHOULDER_GAUGE_OFFSET_X = 30;
export const CURVE_STRENGTH_MAST_HEIGHT = 44;
export const SHOULDER_GAUGE_HEIGHT = 44;
const SHOULDER_GAUGE_EDGE_PAD = 10;
const TRIM_LANE_BOTTOM_OFFSET = 18;
const TRIM_LANE_HALF_RANGE = 15;

const TONE_SHAPE_HANDLES = Object.freeze([
  {key: "exposure", label: "Exposure Placement", symbol: "E", shape: "pin"},
  {key: "gamma", label: "Gamma", symbol: "γ", shape: "diamond"},
  {key: "curveStrength", label: "Curve Slope", symbol: "S", shape: "square"},
  {key: "toneShoulder", label: "Shoulder Gauge", symbol: "", shape: "knob"}
]);


function drawToneShapeHandles(frame, config, {activeShapeKey = null, hoverShapeKey = null} = {}) {
  const {ctx} = frame;
  const dpr = devicePixelRatioSafe();
  ctx.save();
  for (const handle of TONE_SHAPE_HANDLES) {
    const point = toneShapeHandlePoint(frame, config, handle);
    const active = activeShapeKey === handle.key;
    const hover = hoverShapeKey === handle.key;
    const size = (active ? 7.5 : hover ? 7 : 6) * dpr;
    const strength = clamp01(config.curveStrength || 0);
    const dormant = handle.key === "toneShoulder" && strength <= NEGLIGIBLE_CURVE_STRENGTH;
    const handleAlpha = active ? 0.96 : hover ? 0.82 : dormant ? 0.22 : 0.68;

    if (handle.key === "exposure") {
      drawExposurePlacementGuide(frame, point, {active, hover});
    }

    if (handle.key === "curveStrength") {
      drawCurveStrengthMast(frame, config, point, {active, hover});
    }

    if (handle.key === "toneShoulder") {
      drawShoulderHandleGuide(frame, config, point, {active, hover});
    }

    ctx.globalAlpha = handleAlpha;
    ctx.fillStyle = frame.bg.trim();
    ctx.strokeStyle = dormant && !active && !hover ? frame.muted.trim() : frame.accent.trim();
    ctx.lineWidth = (active ? 2 : 1.45) * dpr;
    ctx.beginPath();
    if (handle.shape === "square") {
      ctx.rect(point.x - size * 0.78, point.y - size * 0.78, size * 1.56, size * 1.56);
    } else if (handle.shape === "pin") {
      ctx.arc(point.x, point.y, size * 0.9, 0, Math.PI * 2);
    } else if (handle.shape === "knob") {
      ctx.arc(point.x, point.y, size * 0.78, 0, Math.PI * 2);
    } else {
      ctx.moveTo(point.x, point.y - size);
      ctx.lineTo(point.x + size, point.y);
      ctx.lineTo(point.x, point.y + size);
      ctx.lineTo(point.x - size, point.y);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();

    if (handle.symbol) {
      ctx.globalAlpha = active ? 1 : hover ? 0.92 : dormant ? 0.38 : 0.72;
      ctx.fillStyle = dormant && !active && !hover ? frame.muted.trim() : frame.text.trim();
      ctx.font = `${8.5 * dpr}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(handle.symbol, point.x, point.y - size - 3 * dpr);
    }
  }
  ctx.restore();
}

function drawExposurePlacementGuide(frame, point, {active = false, hover = false} = {}) {
  const {ctx} = frame;
  const plot = plotRect(frame);
  const dpr = devicePixelRatioSafe();
  const y = plot.y + (1 - EXPOSURE_PLACEMENT_LUMA) * plot.h;
  ctx.save();
  ctx.globalAlpha = active ? 0.4 : hover ? 0.3 : 0.16;
  ctx.strokeStyle = frame.accent.trim();
  ctx.lineWidth = 1 * dpr;
  ctx.setLineDash([3 * dpr, 3 * dpr]);
  line(ctx, plot.x, y, plot.x + plot.w, y);
  ctx.setLineDash([]);
  ctx.globalAlpha = active ? 0.58 : hover ? 0.44 : 0.22;
  line(ctx, point.x, y - 7 * dpr, point.x, y + 7 * dpr);
  ctx.restore();
}

function drawCurveStrengthMast(frame, config, point, {active = false, hover = false} = {}) {
  const {ctx} = frame;
  const dpr = devicePixelRatioSafe();
  const mast = curveStrengthMastGeometry(frame, config);
  const unit = curveStrengthUnitFromValue(config.curveStrength);
  const alpha = active ? 0.72 : hover ? 0.54 : 0.2 + 0.38 * unit;
  const fillAlpha = active ? 0.82 : hover ? 0.64 : 0.22 + 0.46 * unit;

  ctx.save();
  ctx.strokeStyle = frame.accent.trim();
  ctx.lineWidth = (active ? 1.45 : 1) * dpr;

  ctx.globalAlpha = Math.max(0.16, alpha * 0.54);
  line(ctx, mast.x, mast.top, mast.x, mast.zeroY);

  ctx.globalAlpha = alpha;
  line(ctx, mast.x - 6 * dpr, mast.zeroY, mast.x + 6 * dpr, mast.zeroY);

  if (Math.abs(point.y - mast.zeroY) > 0.5 * dpr) {
    ctx.globalAlpha = fillAlpha;
    ctx.lineWidth = (active ? 2.1 : 1.65) * dpr;
    line(ctx, mast.x, mast.zeroY, mast.x, point.y);
  }


  ctx.globalAlpha = active ? 0.86 : hover ? 0.68 : 0.18 + 0.32 * unit;
  ctx.fillStyle = frame.bg.trim();
  ctx.strokeStyle = frame.accent.trim();
  ctx.lineWidth = 1 * dpr;
  ctx.beginPath();
  ctx.arc(mast.x, mast.zeroY, 2.6 * dpr, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawShoulderHandleGuide(frame, config, point, {active = false, hover = false} = {}) {
  const {ctx} = frame;
  const dpr = devicePixelRatioSafe();
  const strength = clamp01(config.curveStrength || 0);
  const dormant = strength <= NEGLIGIBLE_CURVE_STRENGTH;
  const pivotPoint = curveStrengthHandlePoint(frame, config);
  const gauge = shoulderGaugeGeometry(frame, config);
  const alpha = active ? 0.72 : hover ? 0.54 : dormant ? 0.1 : 0.18 + 0.32 * strength;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = dormant && !active && !hover ? frame.muted.trim() : frame.accent.trim();
  ctx.lineWidth = (active ? 1.45 : 1) * dpr;

  const elbowX = Math.min(gauge.x - 7 * dpr, pivotPoint.x + 9 * dpr);
  ctx.beginPath();
  ctx.moveTo(pivotPoint.x, pivotPoint.y);
  ctx.lineTo(elbowX, pivotPoint.y);
  ctx.lineTo(gauge.x, gauge.centerY);
  ctx.stroke();

  ctx.globalAlpha = Math.min(0.82, alpha + 0.08);
  line(ctx, gauge.x, gauge.top, gauge.x, gauge.bottom);
  line(ctx, gauge.x - 4 * dpr, gauge.top, gauge.x + 4 * dpr, gauge.top);
  line(ctx, gauge.x - 4 * dpr, gauge.centerY, gauge.x + 4 * dpr, gauge.centerY);
  line(ctx, gauge.x - 4 * dpr, gauge.bottom, gauge.x + 4 * dpr, gauge.bottom);

  ctx.globalAlpha = Math.min(0.76, alpha + 0.18);
  ctx.fillStyle = dormant && !active && !hover ? frame.muted.trim() : frame.text.trim();
  ctx.font = `${7.5 * dpr}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText("Sh", gauge.x, gauge.top - 4 * dpr);
  ctx.restore();
}

export function curveStrengthUnitFromValue(curveStrength) {
  return clamp01(sanitizeControlValue("curveStrength", curveStrength));
}

function curveStrengthMastGeometry(frame, config) {
  const plot = plotRect(frame);
  const dpr = devicePixelRatioSafe();
  const anchor = toneShapePivotPoint(frame, config);
  const pad = 8 * dpr;
  const desiredHeight = CURVE_STRENGTH_MAST_HEIGHT * dpr;
  const availableAbove = Math.max(12 * dpr, anchor.y - plot.y - pad);
  const height = Math.min(desiredHeight, availableAbove);
  return {
    x: anchor.x,
    zeroY: anchor.y,
    top: anchor.y - height,
    height
  };
}

function curveStrengthHandlePoint(frame, config) {
  const mast = curveStrengthMastGeometry(frame, config);
  const unit = curveStrengthUnitFromValue(config.curveStrength);
  return {
    x: mast.x,
    y: mix(mast.zeroY, mast.top, unit)
  };
}

function shoulderGaugeGeometry(frame, config) {
  const plot = plotRect(frame);
  const dpr = devicePixelRatioSafe();
  const pivotPoint = curveStrengthHandlePoint(frame, config);
  const height = SHOULDER_GAUGE_HEIGHT * dpr;
  const halfHeight = height / 2;
  const pad = SHOULDER_GAUGE_EDGE_PAD * dpr;
  const desiredX = pivotPoint.x + SHOULDER_GAUGE_OFFSET_X * dpr;
  const x = clamp(desiredX, plot.x + pad, plot.x + plot.w - pad);
  const centerY = clamp(pivotPoint.y, plot.y + halfHeight + pad, plot.y + plot.h - halfHeight - pad);
  return {
    x,
    top: centerY - halfHeight,
    bottom: centerY + halfHeight,
    centerY,
    height
  };
}

export function shoulderGaugeUnitFromToneShoulder(toneShoulder) {
  const control = CONTROL_DEFINITIONS.get("toneShoulder");
  const min = control?.min ?? 1;
  const max = control?.max ?? 6;
  return clamp01((sanitizeControlValue("toneShoulder", toneShoulder) - min) / Math.max(1e-9, max - min));
}

export function toneShoulderFromGaugeUnit(unit) {
  const control = CONTROL_DEFINITIONS.get("toneShoulder");
  const min = control?.min ?? 1;
  const max = control?.max ?? 6;
  return sanitizeControlValue("toneShoulder", mix(min, max, clamp01(unit)));
}

export function toneShoulderFromGaugePointer(clientY, top, height) {
  const local = height > 0 ? (clientY - top) / height : 1;
  return toneShoulderFromGaugeUnit(1 - local);
}

function shoulderGaugePoint(frame, config) {
  const gauge = shoulderGaugeGeometry(frame, config);
  const unit = shoulderGaugeUnitFromToneShoulder(config.toneShoulder);
  return {
    x: gauge.x,
    y: mix(gauge.bottom, gauge.top, unit)
  };
}

function toneShapeHandlePoint(frame, config, handle) {
  const plot = plotRect(frame);
  if (handle.key === "exposure") {
    const inputLuma = exposurePlacementInputLuma(config);
    return {
      x: plot.x + inputLuma * plot.w,
      y: plot.y + (1 - EXPOSURE_PLACEMENT_LUMA) * plot.h
    };
  }
  if (handle.key === "gamma") {
    return {
      x: plot.x + GAMMA_HANDLE_LUMA * plot.w,
      y: plot.y + (1 - lumaToneBaseSample(GAMMA_HANDLE_LUMA, config)) * plot.h
    };
  }
  if (handle.key === "curveStrength") {
    return curveStrengthHandlePoint(frame, config);
  }
  if (handle.key === "toneShoulder") {
    return shoulderGaugePoint(frame, config);
  }
  return {x: plot.x, y: plot.y + plot.h};
}


function toneShapePivotPoint(frame, config) {
  const plot = plotRect(frame);
  const pivotInput = tonePivotInputLuma(config);
  return {
    x: plot.x + pivotInput * plot.w,
    y: plot.y + (1 - lumaToneBaseSample(pivotInput, config)) * plot.h
  };
}

function drawTonalBalanceHandles(frame, config, transformedHistogram, {activeKey = null, hoverKey = null} = {}) {
  const {ctx} = frame;
  const plot = plotRect(frame);
  const dpr = devicePixelRatioSafe();
  const laneY = tonalBalanceLaneY(frame);

  ctx.save();
  ctx.globalAlpha = activeKey || hoverKey ? 0.28 : 0.16;
  ctx.strokeStyle = frame.accent.trim();
  ctx.lineWidth = 1 * dpr;
  ctx.setLineDash([4 * dpr, 5 * dpr]);
  line(ctx, plot.x, laneY, plot.x + plot.w, laneY);
  ctx.setLineDash([]);

  ctx.globalAlpha = activeKey || hoverKey ? 0.42 : 0.22;
  ctx.fillStyle = frame.text.trim();
  ctx.font = `${7.8 * dpr}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText("TRIM", plot.x + plot.w - 4 * dpr, laneY - 9 * dpr);

  for (const handle of TONAL_BALANCE_HANDLES) {
    const point = tonalBalanceHandlePoint(frame, config, handle);
    const density = histogramDensityAtLuma(transformedHistogram, handle.luma);
    const active = handle.key === activeKey;
    const hover = handle.key === hoverKey;
    const dormant = density < 0.18;
    const radius = (active ? 6.2 : hover ? 5.7 : 5) * dpr;
    const tickHeight = active || hover ? 13 * dpr : 8 * dpr;
    const alpha = active ? 0.95 : hover ? 0.78 : 0.34 + 0.34 * density;

    ctx.globalAlpha = active ? 0.5 : hover ? 0.38 : 0.14 + 0.16 * density;
    ctx.strokeStyle = frame.accent.trim();
    ctx.lineWidth = 1 * dpr;
    ctx.setLineDash([2 * dpr, 4 * dpr]);
    line(ctx, point.x, laneY - tickHeight, point.x, laneY + tickHeight);
    ctx.setLineDash([]);

    if (Math.abs(point.y - laneY) > 1 * dpr) {
      ctx.globalAlpha = active ? 0.55 : hover ? 0.42 : 0.18 + 0.16 * density;
      ctx.strokeStyle = frame.accent.trim();
      ctx.lineWidth = 1.15 * dpr;
      line(ctx, point.x, laneY, point.x, point.y);
    }

    ctx.globalAlpha = 1;
    ctx.fillStyle = frame.bg.trim();
    ctx.beginPath();
    ctx.roundRect?.(point.x - radius - 2 * dpr, point.y - radius - 1.5 * dpr, radius * 2 + 4 * dpr, radius * 2 + 3 * dpr, 4 * dpr);
    if (!ctx.roundRect) ctx.rect(point.x - radius - 2 * dpr, point.y - radius - 1.5 * dpr, radius * 2 + 4 * dpr, radius * 2 + 3 * dpr);
    ctx.fill();

    ctx.globalAlpha = alpha;
    ctx.strokeStyle = frame.accent.trim();
    ctx.fillStyle = dormant && !active ? frame.bg.trim() : frame.accent.trim();
    ctx.lineWidth = (active ? 1.8 : dormant ? 1.55 : 1.2) * dpr;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.globalAlpha = active ? 1 : hover ? 0.92 : 0.64 + 0.22 * density;
    ctx.fillStyle = dormant && !active ? frame.accent.trim() : frame.bg.trim();
    ctx.font = `${7.5 * dpr}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(handle.symbol || handle.key[0].toUpperCase(), point.x, point.y + 0.3 * dpr);
  }
  ctx.restore();
}

function tonalBalanceLaneY(frame) {
  const plot = plotRect(frame);
  return plot.y + plot.h - TRIM_LANE_BOTTOM_OFFSET * devicePixelRatioSafe();
}

function tonalBalanceHandlePoint(frame, config, handle) {
  const plot = plotRect(frame);
  const dpr = devicePixelRatioSafe();
  const control = CONTROL_DEFINITIONS.get(handle.key);
  const value = config[handle.key] || 0;
  const maxAbs = Math.max(Math.abs(control?.min ?? -0.2), Math.abs(control?.max ?? 0.2), 0.001);
  return {
    x: plot.x + handle.luma * plot.w,
    y: tonalBalanceLaneY(frame) - (value / maxAbs) * TRIM_LANE_HALF_RANGE * dpr
  };
}

function tonalBalanceActualCurvePoint(frame, config, handle) {
  const plot = plotRect(frame);
  return {
    x: plot.x + handle.luma * plot.w,
    y: plot.y + (1 - lumaCurveSample(handle.luma, config)) * plot.h
  };
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

function bindDraggableFloatingWindow(root, canvas) {
  if (!root || !root.classList?.contains("floating-luma-window")) return () => {};
  const card = canvas.closest?.(".curve-preview-card");
  const handle = card?.querySelector?.(".curve-preview-header");
  if (!handle) return () => {};

  const drag = {pointerId: null, startClientX: 0, startClientY: 0, startLeft: 0, startTop: 0};

  function viewport() {
    return {
      width: window.innerWidth || document.documentElement.clientWidth || 1,
      height: window.innerHeight || document.documentElement.clientHeight || 1
    };
  }

  function pinToCurrentRect() {
    const rect = root.getBoundingClientRect();
    root.style.left = `${rect.left}px`;
    root.style.top = `${rect.top}px`;
    root.style.right = "auto";
    root.style.bottom = "auto";
    root.style.width = `${rect.width}px`;
    return rect;
  }

  function applyPosition(left, top, rect = root.getBoundingClientRect()) {
    const size = viewport();
    const next = clampFloatingWindowPosition(left, top, rect.width, rect.height, size.width, size.height);
    root.style.left = `${next.left}px`;
    root.style.top = `${next.top}px`;
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    const rect = pinToCurrentRect();
    drag.pointerId = event.pointerId;
    drag.startClientX = event.clientX;
    drag.startClientY = event.clientY;
    drag.startLeft = rect.left;
    drag.startTop = rect.top;
    handle.setPointerCapture?.(event.pointerId);
    root.classList.add("is-dragging-window");
  }

  function onPointerMove(event) {
    if (drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    applyPosition(
      drag.startLeft + event.clientX - drag.startClientX,
      drag.startTop + event.clientY - drag.startClientY
    );
  }

  function stopDrag(event) {
    if (event && drag.pointerId !== null && event.pointerId !== drag.pointerId) return;
    drag.pointerId = null;
    root.classList.remove("is-dragging-window");
  }

  function onWindowResize() {
    const rect = root.getBoundingClientRect();
    applyPosition(rect.left, rect.top, rect);
  }

  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", stopDrag);
  handle.addEventListener("pointercancel", stopDrag);
  handle.addEventListener("lostpointercapture", stopDrag);
  window.addEventListener("resize", onWindowResize);

  return () => {
    handle.removeEventListener("pointerdown", onPointerDown);
    handle.removeEventListener("pointermove", onPointerMove);
    handle.removeEventListener("pointerup", stopDrag);
    handle.removeEventListener("pointercancel", stopDrag);
    handle.removeEventListener("lostpointercapture", stopDrag);
    window.removeEventListener("resize", onWindowResize);
  };
}

function createToneMapControls(canvas, bindings) {
  const card = canvas.closest?.(".curve-preview-card") || canvas.parentElement;
  if (!card) {
    return {sync() {}, destroy() {}, isExpanded: () => false, isDraggingPivot: () => false};
  }

  card.classList.add("tone-map-card");
  const header = card.querySelector?.(".curve-preview-header");
  const title = header?.querySelector?.("h2");
  if (title) title.textContent = "Tone Map";

  const actions = document.createElement("div");
  actions.className = "tone-map-actions";

  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "tone-map-action tone-map-reset";
  resetButton.textContent = "Reset";
  resetButton.setAttribute("aria-label", "Reset Tone Map");

  const detailsButton = document.createElement("button");
  detailsButton.type = "button";
  detailsButton.className = "tone-map-action";
  detailsButton.textContent = "Details";
  detailsButton.setAttribute("aria-expanded", "false");

  const expandButton = document.createElement("button");
  expandButton.type = "button";
  expandButton.className = "tone-map-action tone-map-expand";
  expandButton.textContent = "Expand";
  expandButton.setAttribute("aria-expanded", "false");

  actions.append(resetButton, detailsButton, expandButton);
  header?.append(actions);

  const readouts = document.createElement("div");
  readouts.className = "tone-map-readouts";
  const readoutChips = new Map();
  for (const item of [
    ["exposure", "E"],
    ["gamma", "γ"],
    ["curveStrength", "S"],
    ["toneShoulder", "Sh"],
    ["pivot", "P"],
    ["lift", "L"],
    ["midtone", "M"],
    ["gain", "G"]
  ]) {
    const chip = document.createElement("span");
    chip.className = "tone-map-chip";
    chip.dataset.key = item[0];
    chip.textContent = `${item[1]} 0`;
    readouts.append(chip);
    readoutChips.set(item[0], chip);
  }

  const details = document.createElement("div");
  details.className = "tone-map-details";
  const detailControls = [
    createDockRange("Exposure", "exposure", -5, 5, 0.05),
    createDockRange("Gamma", "gamma", 0.1, 4, 0.01),
    createDockRange("Strength", "curveStrength", 0, 1, 0.01),
    createDockRange("Shoulder", "toneShoulder", 1, 6, 0.02),
    createDockRange("Lift", "lift", -0.2, 0.2, 0.01),
    createDockRange("Mid", "midtone", -0.2, 0.2, 0.01),
    createDockRange("Gain", "gain", -0.2, 0.2, 0.01)
  ];
  for (const control of detailControls) details.append(control.wrapper);
  card.append(readouts, details);

  const state = {expanded: false, details: false};
  const workbench = document.getElementById("workbench");

  resetButton.addEventListener("click", () => {
    const nextConfig = resetToneMapConfig(normalizeConfig(bindings.getConfig()));
    const patch = Object.fromEntries(TONE_MAP_CONTROL_KEYS.map(key => [key, nextConfig[key]]));
    bindings.setConfigValues?.(patch);
  });

  expandButton.addEventListener("click", () => {
    state.expanded = !state.expanded;
    syncExpansion();
    bindings.requestRender?.();
  });

  detailsButton.addEventListener("click", () => {
    state.details = !state.details;
    syncExpansion();
    bindings.requestRender?.();
  });

  for (const control of detailControls) {
    control.input.addEventListener("input", () => bindings.setConfigValue(control.key, control.input.valueAsNumber));
  }

  function syncExpansion() {
    card.classList.toggle("is-expanded", state.expanded);
    card.classList.toggle("is-details-open", state.details);
    workbench?.classList.toggle("is-tone-map-expanded", state.expanded);
    expandButton.textContent = state.expanded ? "Shrink" : "Expand";
    expandButton.setAttribute("aria-expanded", state.expanded ? "true" : "false");
    expandButton.setAttribute("aria-label", `${state.expanded ? "Shrink" : "Expand"} Tone Map`);
    detailsButton.setAttribute("aria-expanded", state.details ? "true" : "false");
    detailsButton.setAttribute("aria-label", `${state.details ? "Hide" : "Show"} Tone Map details`);
  }

  syncExpansion();
  sync(bindings.getConfig());

  return {
    sync,
    isExpanded: () => state.expanded || state.details,
    isDraggingPivot: () => false,
    destroy() {
      workbench?.classList.remove("is-tone-map-expanded");
      actions.remove();
      readouts.remove();
      details.remove();
    }
  };

  function sync(nextConfig) {
    const config = normalizeConfig(nextConfig);
    for (const control of detailControls) {
      control.input.value = String(config[control.key]);
      control.value.textContent = formatCompact(config[control.key]);
    }

    setReadout("exposure", `E ${formatSigned(config.exposure)}`);
    setReadout("gamma", `γ ${formatCompact(config.gamma)}`);
    setReadout("curveStrength", `S ${formatCompact(config.curveStrength)}`);
    setReadout("toneShoulder", `Sh ${formatCompact(config.toneShoulder)}`);
    setReadout("pivot", `P ${Math.round(tonePivotInputLuma(config) * 100)}%`);
    setReadout("lift", `L ${formatSigned(config.lift)}`);
    setReadout("midtone", `M ${formatSigned(config.midtone)}`);
    setReadout("gain", `G ${formatSigned(config.gain)}`);
  }

  function setReadout(key, text) {
    const chip = readoutChips.get(key);
    if (chip) chip.textContent = text;
  }
}


function createChromaMapControls(canvas, bindings) {
  const card = canvas.closest?.(".curve-preview-card") || canvas.parentElement;
  if (!card) {
    return {sync() {}, destroy() {}, isExpanded: () => false};
  }

  card.classList.add("chroma-map-card");
  const header = card.querySelector?.(".curve-preview-header");
  const title = header?.querySelector?.("h2");
  if (title) title.textContent = "Chroma Map";

  const actions = document.createElement("div");
  actions.className = "tone-map-actions chroma-map-actions";

  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "tone-map-action chroma-map-reset";
  resetButton.textContent = "Reset";
  resetButton.setAttribute("aria-label", "Reset Chroma Map");

  const detailsButton = document.createElement("button");
  detailsButton.type = "button";
  detailsButton.className = "tone-map-action";
  detailsButton.textContent = "Details";
  detailsButton.setAttribute("aria-expanded", "false");

  const expandButton = document.createElement("button");
  expandButton.type = "button";
  expandButton.className = "tone-map-action chroma-map-expand";
  expandButton.textContent = "Expand";
  expandButton.setAttribute("aria-expanded", "false");

  actions.append(resetButton, detailsButton, expandButton);
  header?.append(actions);

  const readouts = document.createElement("div");
  readouts.className = "tone-map-readouts chroma-map-readouts";
  const readoutChips = new Map();
  for (const item of [
    ["chromaExposure", "C"],
    ["chromaGamma", "γC"],
    ["chromaFadeStrength", "F"],
    ["chromaFadeLow", "Lo"],
    ["chromaFadeHigh", "Hi"]
  ]) {
    const chip = document.createElement("span");
    chip.className = "tone-map-chip chroma-map-chip";
    chip.dataset.key = item[0];
    chip.textContent = `${item[1]} 0`;
    readouts.append(chip);
    readoutChips.set(item[0], chip);
  }

  const details = document.createElement("div");
  details.className = "tone-map-details chroma-map-details";
  const detailControls = [
    createDockRange("C Exposure", "chromaExposure", -5, 5, 0.05),
    createDockRange("C Gamma", "chromaGamma", 0.1, 4, 0.01),
    createDockRange("Fade", "chromaFadeStrength", 0, 1, 0.01),
    createDockRange("Fade Low", "chromaFadeLow", -6, 6, 0.1),
    createDockRange("Fade High", "chromaFadeHigh", -6, 6, 0.1)
  ];
  for (const control of detailControls) details.append(control.wrapper);
  card.append(readouts, details);

  const state = {expanded: false, details: false};
  const workbench = document.getElementById("workbench");

  resetButton.addEventListener("click", () => {
    const nextConfig = resetChromaMapConfig(normalizeConfig(bindings.getConfig()));
    const patch = Object.fromEntries(CHROMA_MAP_CONTROL_KEYS.map(key => [key, nextConfig[key]]));
    bindings.setConfigValues?.(patch);
  });

  expandButton.addEventListener("click", () => {
    state.expanded = !state.expanded;
    syncExpansion();
    bindings.requestRender?.();
  });

  detailsButton.addEventListener("click", () => {
    state.details = !state.details;
    syncExpansion();
    bindings.requestRender?.();
  });

  for (const control of detailControls) {
    control.input.addEventListener("input", () => bindings.setConfigValue(control.key, control.input.valueAsNumber));
  }

  function syncExpansion() {
    card.classList.toggle("is-expanded", state.expanded);
    card.classList.toggle("is-details-open", state.details);
    workbench?.classList.toggle("is-chroma-map-expanded", state.expanded);
    expandButton.textContent = state.expanded ? "Shrink" : "Expand";
    expandButton.setAttribute("aria-expanded", state.expanded ? "true" : "false");
    expandButton.setAttribute("aria-label", `${state.expanded ? "Shrink" : "Expand"} Chroma Map`);
    detailsButton.setAttribute("aria-expanded", state.details ? "true" : "false");
    detailsButton.setAttribute("aria-label", `${state.details ? "Hide" : "Show"} Chroma Map details`);
  }

  syncExpansion();
  sync(bindings.getConfig());

  return {
    sync,
    isExpanded: () => state.expanded || state.details,
    destroy() {
      workbench?.classList.remove("is-chroma-map-expanded");
      actions.remove();
      readouts.remove();
      details.remove();
    }
  };

  function sync(nextConfig) {
    const config = normalizeConfig(nextConfig);
    for (const control of detailControls) {
      control.input.value = String(config[control.key]);
      control.value.textContent = formatCompact(config[control.key]);
    }

    setReadout("chromaExposure", `C ${formatSigned(config.chromaExposure)}`);
    setReadout("chromaGamma", `γC ${formatCompact(config.chromaGamma)}`);
    setReadout("chromaFadeStrength", `F ${formatCompact(config.chromaFadeStrength)}`);
    setReadout("chromaFadeLow", `Lo ${formatCompact(config.chromaFadeLow)}`);
    setReadout("chromaFadeHigh", `Hi ${formatCompact(config.chromaFadeHigh)}`);
  }

  function setReadout(key, text) {
    const chip = readoutChips.get(key);
    if (chip) chip.textContent = text;
  }
}

function createDockIcon(content, label, options = {}) {
  const icon = document.createElement("span");
  icon.className = `tone-dock-icon${options.className ? ` ${options.className}` : ""}`;
  icon.setAttribute("role", "img");
  icon.setAttribute("aria-label", label);
  icon.title = label;
  if (options.html) icon.innerHTML = content;
  else icon.textContent = content;
  return icon;
}

function createDockRange(label, key, min, max, step, options = {}) {
  const wrapper = document.createElement("label");
  wrapper.className = "tone-dock-range";
  wrapper.setAttribute("data-key", key);
  if (options.showLabel === false) wrapper.classList.add("is-label-hidden");

  const name = document.createElement("span");
  name.className = "tone-dock-label";
  name.textContent = label;

  const value = document.createElement("span");
  value.className = "tone-dock-value";

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.setAttribute("aria-label", label);

  wrapper.append(name, input, value);
  return {wrapper, input, value, key};
}



function bindChromaMapHandles(canvas, bindings) {
  const drag = {
    pointerId: null,
    key: null,
    startClientY: 0,
    startValue: 1,
    plotHeight: 1,
    plotLeft: 0,
    plotWidth: 1,
    fadeGaugeTop: 0,
    fadeGaugeHeight: 1,
    domainMax: CHROMA_GRAPH_Y_MAX
  };

  function currentYMax() {
    return bindings.getDisplayMax?.() ?? CHROMA_GRAPH_Y_MAX;
  }

  function handleAtClientPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const frame = frameFromClientRect(canvas, rect);
    if (!frame) return null;
    const dpr = devicePixelRatioSafe();
    const localX = (clientX - rect.left) * dpr;
    const localY = (clientY - rect.top) * dpr;
    const hitRadius = 14 * dpr;
    let nearest = null;
    let nearestDistance = Infinity;
    const config = bindings.getConfig();
    const yMax = currentYMax(config);
    const plot = plotRect(frame);

    for (const handle of CHROMA_MAP_HANDLES) {
      const point = chromaMapHandlePoint(frame, config, handle, yMax, yMax);
      let distance = Math.hypot(localX - point.x, localY - point.y);
      if (handle.key === "chromaFadeLow" || handle.key === "chromaFadeHigh") {
        const railDistance = Math.abs(localX - point.x);
        const inVerticalRange = localY >= plot.y - hitRadius && localY <= plot.y + plot.h + hitRadius;
        if (inVerticalRange && railDistance <= hitRadius) distance = Math.min(distance, railDistance);
      }
      if (handle.key === "chromaFadeStrength") {
        const gauge = chromaFadeGaugeGeometry(frame, config);
        const railDistance = Math.abs(localX - gauge.x);
        const inVerticalRange = localY >= gauge.top - hitRadius && localY <= gauge.bottom + hitRadius;
        if (inVerticalRange && railDistance <= hitRadius) distance = Math.min(distance, railDistance);
      }
      if (distance <= hitRadius && distance < nearestDistance) {
        nearest = handle;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  function updateHover(event) {
    if (drag.pointerId !== null) return;
    const handle = handleAtClientPoint(event.clientX, event.clientY);
    bindings.setHoverKey(handle?.key || null);
    canvas.classList.toggle("is-over-chroma-handle", Boolean(handle));
    canvas.classList.toggle("is-over-chroma-placement", handle?.key === "chromaExposure");
    canvas.classList.toggle("is-over-chroma-gamma", handle?.key === "chromaGamma");
    canvas.classList.toggle("is-over-chroma-fade-rail", handle?.key === "chromaFadeLow" || handle?.key === "chromaFadeHigh");
    canvas.classList.toggle("is-over-chroma-fade-strength", handle?.key === "chromaFadeStrength");
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    const handle = handleAtClientPoint(event.clientX, event.clientY);
    if (!handle) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const rect = canvas.getBoundingClientRect();
    const frame = frameFromClientRect(canvas, rect);
    const plot = frame ? plotRect(frame) : {h: 1, x: 0, w: 1};
    drag.pointerId = event.pointerId;
    drag.key = handle.key;
    drag.startClientY = event.clientY;
    drag.startValue = bindings.getConfig()[handle.key] ?? 0;
    const dpr = devicePixelRatioSafe();
    drag.plotHeight = Math.max(1, plot.h / dpr);
    drag.plotLeft = rect.left + plot.x / dpr;
    drag.plotWidth = Math.max(1, plot.w / dpr);
    drag.domainMax = currentYMax();
    if (handle.key === "chromaFadeStrength" && frame) {
      const gauge = chromaFadeGaugeGeometry(frame, bindings.getConfig());
      drag.fadeGaugeTop = rect.top + gauge.top / dpr;
      drag.fadeGaugeHeight = Math.max(1, gauge.height / dpr);
    }
    canvas.setPointerCapture?.(event.pointerId);
    canvas.classList.add("is-dragging-chroma-handle");
    canvas.classList.toggle("is-dragging-chroma-placement", handle.key === "chromaExposure");
    canvas.classList.toggle("is-dragging-chroma-gamma", handle.key === "chromaGamma");
    canvas.classList.toggle("is-dragging-chroma-fade-rail", handle.key === "chromaFadeLow" || handle.key === "chromaFadeHigh");
    canvas.classList.toggle("is-dragging-chroma-fade-strength", handle.key === "chromaFadeStrength");
    bindings.setActiveHandle({...handle});
  }

  function onPointerMove(event) {
    if (drag.pointerId !== event.pointerId) {
      updateHover(event);
      return;
    }
    event.preventDefault();
    if (drag.key === "chromaExposure") {
      bindings.setConfigValue("chromaExposure", chromaExposureValueFromHorizontalPosition(event.clientX, drag.plotLeft, drag.plotWidth, bindings.getConfig(), drag.domainMax));
    } else if (drag.key === "chromaGamma") {
      bindings.setConfigValue("chromaGamma", chromaGammaValueFromVerticalDrag(drag.startValue, event.clientY - drag.startClientY, drag.plotHeight));
    } else if (drag.key === "chromaFadeLow" || drag.key === "chromaFadeHigh") {
      bindings.setConfigValue(drag.key, chromaFadeBoundaryValueFromHorizontalPosition(event.clientX, drag.plotLeft, drag.plotWidth));
    } else if (drag.key === "chromaFadeStrength") {
      bindings.setConfigValue("chromaFadeStrength", chromaFadeStrengthFromGaugePointer(event.clientY, drag.fadeGaugeTop, drag.fadeGaugeHeight));
    }
  }

  function stopDrag(event) {
    if (event && drag.pointerId !== null && event.pointerId !== drag.pointerId) return;
    drag.pointerId = null;
    drag.key = null;
    canvas.classList.remove("is-dragging-chroma-handle");
    canvas.classList.remove("is-dragging-chroma-placement");
    canvas.classList.remove("is-dragging-chroma-gamma");
    canvas.classList.remove("is-dragging-chroma-fade-rail");
    canvas.classList.remove("is-dragging-chroma-fade-strength");
    bindings.setActiveHandle(null);
    if (event) updateHover(event);
  }

  function onPointerLeave() {
    if (drag.pointerId !== null) return;
    bindings.setHoverKey(null);
    canvas.classList.remove("is-over-chroma-handle");
    canvas.classList.remove("is-over-chroma-placement");
    canvas.classList.remove("is-over-chroma-gamma");
    canvas.classList.remove("is-over-chroma-fade-rail");
    canvas.classList.remove("is-over-chroma-fade-strength");
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", stopDrag);
  canvas.addEventListener("pointercancel", stopDrag);
  canvas.addEventListener("lostpointercapture", stopDrag);
  canvas.addEventListener("pointerleave", onPointerLeave);

  return () => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", stopDrag);
    canvas.removeEventListener("pointercancel", stopDrag);
    canvas.removeEventListener("lostpointercapture", stopDrag);
    canvas.removeEventListener("pointerleave", onPointerLeave);
  };
}

function bindToneShapeHandles(canvas, bindings) {
  const drag = {pointerId: null, key: null, startClientY: 0, startValue: 1, plotHeight: 1, plotLeft: 0, plotTop: 0, plotWidth: 1, shoulderGaugeTop: 0, shoulderGaugeHeight: 1};

  function handleAtClientPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const frame = frameFromClientRect(canvas, rect);
    if (!frame) return null;
    const dpr = devicePixelRatioSafe();
    const localX = (clientX - rect.left) * dpr;
    const localY = (clientY - rect.top) * dpr;
    const hitRadius = 14 * dpr;
    let nearest = null;
    let nearestDistance = Infinity;
    const config = bindings.getConfig();
    for (const handle of TONE_SHAPE_HANDLES) {
      const point = toneShapeHandlePoint(frame, config, handle);
      let distance = Math.hypot(localX - point.x, localY - point.y);
      if (handle.key === "curveStrength") {
        const mast = curveStrengthMastGeometry(frame, config);
        const railDistance = Math.abs(localX - mast.x);
        const lowY = Math.min(mast.top, mast.zeroY);
        const highY = Math.max(mast.top, mast.zeroY);
        const inVerticalRange = localY >= lowY - hitRadius && localY <= highY + hitRadius;
        if (inVerticalRange && railDistance <= hitRadius) distance = Math.min(distance, railDistance);
      }
      if (handle.key === "toneShoulder") {
        const gauge = shoulderGaugeGeometry(frame, config);
        const railDistance = Math.abs(localX - gauge.x);
        const inVerticalRange = localY >= gauge.top - hitRadius && localY <= gauge.bottom + hitRadius;
        if (inVerticalRange && railDistance <= hitRadius) distance = Math.min(distance, railDistance);
      }
      if (distance <= hitRadius && distance < nearestDistance) {
        nearest = handle;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  function updateHover(event) {
    if (drag.pointerId !== null) return;
    const handle = handleAtClientPoint(event.clientX, event.clientY);
    bindings.setHoverKey(handle?.key || null);
    canvas.classList.toggle("is-over-shape-handle", Boolean(handle));
    canvas.classList.toggle("is-over-exposure-handle", handle?.key === "exposure");
    canvas.classList.toggle("is-over-slope-handle", handle?.key === "curveStrength");
    canvas.classList.toggle("is-over-shoulder-gauge", handle?.key === "toneShoulder");
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    const handle = handleAtClientPoint(event.clientX, event.clientY);
    if (!handle) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const frame = frameFromClientRect(canvas, canvas.getBoundingClientRect());
    const plot = frame ? plotRect(frame) : {h: 1};
    drag.pointerId = event.pointerId;
    drag.key = handle.key;
    const rect = canvas.getBoundingClientRect();
    const dpr = devicePixelRatioSafe();
    drag.startClientY = event.clientY;
    drag.startValue = bindings.getConfig()[handle.key] ?? (handle.key === "gamma" ? 1 : 0);
    drag.plotHeight = Math.max(1, plot.h / dpr);
    drag.plotLeft = rect.left + plot.x / dpr;
    drag.plotTop = rect.top + plot.y / dpr;
    drag.plotWidth = Math.max(1, plot.w / dpr);
    if (handle.key === "toneShoulder" && frame) {
      const gauge = shoulderGaugeGeometry(frame, bindings.getConfig());
      drag.shoulderGaugeTop = rect.top + gauge.top / dpr;
      drag.shoulderGaugeHeight = Math.max(1, gauge.height / dpr);
    }
    canvas.setPointerCapture?.(event.pointerId);
    canvas.classList.add("is-dragging-shape-handle");
    canvas.classList.toggle("is-dragging-exposure-handle", handle.key === "exposure");
    canvas.classList.toggle("is-dragging-slope-handle", handle.key === "curveStrength");
    canvas.classList.toggle("is-dragging-shoulder-gauge", handle.key === "toneShoulder");
    bindings.setActiveHandle({...handle});
  }

  function onPointerMove(event) {
    if (drag.pointerId !== event.pointerId) {
      updateHover(event);
      return;
    }
    event.preventDefault();
    if (drag.key === "exposure") {
      bindings.setConfigValue("exposure", exposureValueFromHorizontalPosition(event.clientX, drag.plotLeft, drag.plotWidth, bindings.getConfig()));
    } else if (drag.key === "gamma") {
      bindings.setConfigValue("gamma", gammaValueFromVerticalDrag(drag.startValue, event.clientY - drag.startClientY, drag.plotHeight));
    } else if (drag.key === "curveStrength") {
      const slopeHandleInput = (event.clientX - drag.plotLeft) / drag.plotWidth;
      bindings.setConfigValue("tonePivotNudge", tonePivotNudgeFromSlopeHandleInputLuma(slopeHandleInput, bindings.getConfig()));
      bindings.setConfigValue("curveStrength", curveStrengthValueFromVerticalDrag(drag.startValue, event.clientY - drag.startClientY, drag.plotHeight));
    } else if (drag.key === "toneShoulder") {
      bindings.setConfigValue("toneShoulder", toneShoulderFromGaugePointer(event.clientY, drag.shoulderGaugeTop, drag.shoulderGaugeHeight));
    }
  }

  function stopDrag(event) {
    if (event && drag.pointerId !== null && event.pointerId !== drag.pointerId) return;
    drag.pointerId = null;
    drag.key = null;
    canvas.classList.remove("is-dragging-shape-handle");
    canvas.classList.remove("is-dragging-exposure-handle");
    canvas.classList.remove("is-dragging-slope-handle");
    canvas.classList.remove("is-dragging-shoulder-gauge");
    bindings.setActiveHandle(null);
    if (event) updateHover(event);
  }

  function onPointerLeave() {
    if (drag.pointerId !== null) return;
    bindings.setHoverKey(null);
    canvas.classList.remove("is-over-shape-handle");
    canvas.classList.remove("is-over-exposure-handle");
    canvas.classList.remove("is-over-slope-handle");
    canvas.classList.remove("is-over-shoulder-gauge");
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", stopDrag);
  canvas.addEventListener("pointercancel", stopDrag);
  canvas.addEventListener("lostpointercapture", stopDrag);
  canvas.addEventListener("pointerleave", onPointerLeave);

  return () => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", stopDrag);
    canvas.removeEventListener("pointercancel", stopDrag);
    canvas.removeEventListener("lostpointercapture", stopDrag);
    canvas.removeEventListener("pointerleave", onPointerLeave);
  };
}

function bindTonalBalanceHandles(canvas, bindings) {
  const drag = {pointerId: null, key: null, startClientY: 0, startValue: 0, plotHeight: 1};

  function handleAtClientPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const frame = frameFromClientRect(canvas, rect);
    if (!frame) return null;
    const dpr = devicePixelRatioSafe();
    const localX = (clientX - rect.left) * dpr;
    const localY = (clientY - rect.top) * dpr;
    const hitRadius = 12 * dpr;
    let nearest = null;
    let nearestDistance = Infinity;
    for (const handle of TONAL_BALANCE_HANDLES) {
      const point = tonalBalanceHandlePoint(frame, bindings.getConfig(), handle);
      const distance = Math.hypot(localX - point.x, localY - point.y);
      if (distance <= hitRadius && distance < nearestDistance) {
        nearest = handle;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  function updateHover(event) {
    if (drag.pointerId !== null) return;
    const handle = handleAtClientPoint(event.clientX, event.clientY);
    bindings.setHoverKey(handle?.key || null);
    canvas.classList.toggle("is-over-tonal-handle", Boolean(handle));
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    const handle = handleAtClientPoint(event.clientX, event.clientY);
    if (!handle) return;
    event.preventDefault();
    const frame = frameFromClientRect(canvas, canvas.getBoundingClientRect());
    const plot = frame ? plotRect(frame) : {h: 1};
    drag.pointerId = event.pointerId;
    drag.key = handle.key;
    drag.startClientY = event.clientY;
    drag.startValue = bindings.getConfig()[handle.key] || 0;
    drag.plotHeight = Math.max(1, plot.h / devicePixelRatioSafe());
    canvas.setPointerCapture?.(event.pointerId);
    canvas.classList.add("is-dragging-tonal-handle");
    bindings.setActiveHandle({...handle});
  }

  function onPointerMove(event) {
    if (drag.pointerId !== event.pointerId) {
      updateHover(event);
      return;
    }
    event.preventDefault();
    bindings.setConfigValue(
      drag.key,
      tonalBalanceValueFromVerticalDrag(drag.key, drag.startValue, event.clientY - drag.startClientY, drag.plotHeight)
    );
  }

  function stopDrag(event) {
    if (event && drag.pointerId !== null && event.pointerId !== drag.pointerId) return;
    drag.pointerId = null;
    drag.key = null;
    canvas.classList.remove("is-dragging-tonal-handle");
    bindings.setActiveHandle(null);
    if (event) updateHover(event);
  }

  function onPointerLeave() {
    if (drag.pointerId !== null) return;
    bindings.setHoverKey(null);
    canvas.classList.remove("is-over-tonal-handle");
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", stopDrag);
  canvas.addEventListener("pointercancel", stopDrag);
  canvas.addEventListener("lostpointercapture", stopDrag);
  canvas.addEventListener("pointerleave", onPointerLeave);

  return () => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", stopDrag);
    canvas.removeEventListener("pointercancel", stopDrag);
    canvas.removeEventListener("lostpointercapture", stopDrag);
    canvas.removeEventListener("pointerleave", onPointerLeave);
  };
}

function frameFromClientRect(canvas, rect) {
  if (!rect.width || !rect.height) return null;
  const dpr = devicePixelRatioSafe();
  const css = getComputedStyle(canvas);
  const rootCss = getComputedStyle(document.documentElement);
  return {
    canvas,
    ctx: null,
    width: rect.width * dpr,
    height: rect.height * dpr,
    padLeft: 12 * dpr,
    padRight: 12 * dpr,
    padTop: 12 * dpr,
    padBottom: 12 * dpr,
    bg: css.getPropertyValue("--panel2") || "#0c1015",
    line: css.getPropertyValue("--line") || "rgba(184,196,214,.16)",
    lineStrong: css.getPropertyValue("--line-strong") || "rgba(184,196,214,.28)",
    accent: css.getPropertyValue("--accent") || "#8fb4df",
    muted: rootCss.getPropertyValue("--muted") || "#89929f",
    text: rootCss.getPropertyValue("--soft") || "#b6beca"
  };
}

function drawLumaPreview(canvas, config, sourceHistogram, handleState = {}) {
  const frame = beginFrame(canvas);
  if (!frame) return;
  const transformedHistogram = transformLumaHistogram(sourceHistogram, config);
  drawFrame(frame, {yMax: 1, labels: false});
  drawHistogramUnderlay(frame, transformedHistogram);
  if (handleState.showTonePivot) {
    drawTonePivotMarker(frame, config, {
      active: handleState.pivotActive,
      exposed: handleState.pivotExposed
    });
  }
  drawCurve(frame, sampleCurve(x => x, 160), {alpha: 0.22, dash: [2, 3], width: 1, yMax: 1});
  drawCurve(frame, sampleCurve(x => lumaToneBaseSample(x, config), 160), {alpha: 0.54, dash: [5, 3], width: 1.4, yMax: 1});
  drawCurve(frame, sampleCurve(x => lumaCurveSample(x, config), 160), {alpha: 0.98, width: 2.2, yMax: 1});
  drawTonalBalanceHandles(frame, config, transformedHistogram, handleState);
  drawToneShapeHandles(frame, config, handleState);
}


const CHROMA_MAP_HANDLES = Object.freeze([
  {key: "chromaExposure", label: "Chroma Placement", symbol: "C", shape: "pin"},
  {key: "chromaGamma", label: "Chroma Gamma", symbol: "γC", shape: "diamond"},
  {key: "chromaFadeLow", label: "Fade Low", symbol: "Lo", shape: "rail"},
  {key: "chromaFadeHigh", label: "Fade High", symbol: "Hi", shape: "rail"},
  {key: "chromaFadeStrength", label: "Fade Strength", symbol: "F", shape: "knob"}
]);

function drawChromaMapHandles(frame, config, yMax, {activeChromaKey = null, hoverChromaKey = null} = {}) {
  const {ctx} = frame;
  const dpr = devicePixelRatioSafe();
  ctx.save();
  drawChromaFadeLane(frame, config, {activeKey: activeChromaKey, hoverKey: hoverChromaKey});
  for (const handle of CHROMA_MAP_HANDLES) {
    const point = chromaMapHandlePoint(frame, config, handle, yMax, yMax);
    const active = activeChromaKey === handle.key;
    const hover = hoverChromaKey === handle.key;
    const size = (active ? 7.2 : hover ? 6.7 : 5.8) * dpr;
    const alpha = active ? 0.96 : hover ? 0.82 : handle.key === "chromaFadeStrength" && config.chromaFadeStrength <= 0.01 ? 0.42 : 0.68;

    if (handle.key === "chromaExposure") {
      drawChromaPlacementGuide(frame, point, yMax, {active, hover});
    }

    ctx.globalAlpha = alpha;
    ctx.fillStyle = frame.bg.trim();
    ctx.strokeStyle = frame.accent.trim();
    ctx.lineWidth = (active ? 2 : 1.45) * dpr;
    ctx.beginPath();
    if (handle.shape === "pin") {
      ctx.arc(point.x, point.y, size * 0.9, 0, Math.PI * 2);
    } else if (handle.shape === "diamond") {
      ctx.moveTo(point.x, point.y - size);
      ctx.lineTo(point.x + size, point.y);
      ctx.lineTo(point.x, point.y + size);
      ctx.lineTo(point.x - size, point.y);
      ctx.closePath();
    } else if (handle.shape === "knob") {
      ctx.arc(point.x, point.y, size * 0.82, 0, Math.PI * 2);
    } else {
      ctx.roundRect?.(point.x - size * 1.15, point.y - size * 0.72, size * 2.3, size * 1.44, 3 * dpr);
      if (!ctx.roundRect) ctx.rect(point.x - size * 1.15, point.y - size * 0.72, size * 2.3, size * 1.44);
    }
    ctx.fill();
    ctx.stroke();

    ctx.globalAlpha = active ? 1 : hover ? 0.92 : 0.72;
    ctx.fillStyle = frame.text.trim();
    ctx.font = `${handle.symbol.length > 1 ? 7.2 * dpr : 8.5 * dpr}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = handle.shape === "rail" || handle.shape === "knob" ? "middle" : "bottom";
    const labelY = handle.shape === "rail" || handle.shape === "knob" ? point.y + 0.2 * dpr : point.y - size - 3 * dpr;
    ctx.fillText(handle.symbol, point.x, labelY);
  }
  ctx.restore();
}

function drawChromaPlacementGuide(frame, point, yMax, {active = false, hover = false} = {}) {
  const {ctx} = frame;
  const plot = plotRect(frame);
  const dpr = devicePixelRatioSafe();
  const targetChroma = chromaPlacementTargetChromaForDomain(yMax);
  const y = plot.y + (1 - clamp01(targetChroma / Math.max(yMax, 1e-6))) * plot.h;
  ctx.save();
  ctx.globalAlpha = active ? 0.4 : hover ? 0.3 : 0.14;
  ctx.strokeStyle = frame.accent.trim();
  ctx.lineWidth = 1 * dpr;
  ctx.setLineDash([3 * dpr, 3 * dpr]);
  line(ctx, plot.x, y, plot.x + plot.w, y);
  ctx.setLineDash([]);
  ctx.globalAlpha = active ? 0.58 : hover ? 0.44 : 0.22;
  line(ctx, point.x, y - 7 * dpr, point.x, y + 7 * dpr);
  ctx.restore();
}

function drawChromaFadeLane(frame, config, {activeKey = null, hoverKey = null} = {}) {
  const {ctx} = frame;
  const plot = plotRect(frame);
  const dpr = devicePixelRatioSafe();
  const lane = chromaFadeLaneGeometry(frame, config);
  const lowX = plot.x + chromaFadeBoundaryUnitFromValue(config.chromaFadeLow) * plot.w;
  const highX = plot.x + chromaFadeBoundaryUnitFromValue(config.chromaFadeHigh) * plot.w;
  const left = Math.min(lowX, highX);
  const right = Math.max(lowX, highX);
  const strength = chromaFadeStrengthUnitFromValue(config.chromaFadeStrength);
  const active = activeKey || hoverKey;

  ctx.save();
  ctx.strokeStyle = frame.accent.trim();
  ctx.lineWidth = 1 * dpr;
  ctx.globalAlpha = active ? 0.34 : 0.18;
  ctx.setLineDash([4 * dpr, 5 * dpr]);
  line(ctx, plot.x, lane.y, plot.x + plot.w, lane.y);
  ctx.setLineDash([]);

  ctx.globalAlpha = active ? 0.2 : 0.1 + 0.18 * strength;
  ctx.fillStyle = frame.accent.trim();
  ctx.fillRect(left, lane.y - 7 * dpr, Math.max(1 * dpr, right - left), 14 * dpr);

  for (const x of [lowX, highX]) {
    ctx.globalAlpha = active ? 0.5 : 0.22;
    ctx.strokeStyle = frame.accent.trim();
    ctx.setLineDash([2 * dpr, 4 * dpr]);
    line(ctx, x, plot.y, x, plot.y + plot.h);
    ctx.setLineDash([]);
  }

  ctx.globalAlpha = active ? 0.44 : 0.22;
  ctx.fillStyle = frame.text.trim();
  ctx.font = `${7.8 * dpr}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText("FADE", plot.x + plot.w - 4 * dpr, lane.y - 10 * dpr);

  const gauge = chromaFadeGaugeGeometry(frame, config);
  ctx.globalAlpha = active ? 0.52 : 0.18 + 0.28 * strength;
  ctx.strokeStyle = frame.accent.trim();
  line(ctx, gauge.x, gauge.bottom, gauge.x, gauge.top);
  line(ctx, gauge.x - 5 * dpr, gauge.bottom, gauge.x + 5 * dpr, gauge.bottom);
  if (strength > 0.005) {
    ctx.globalAlpha = active ? 0.7 : 0.26 + 0.36 * strength;
    ctx.lineWidth = 1.6 * dpr;
    line(ctx, gauge.x, gauge.bottom, gauge.x, mix(gauge.bottom, gauge.top, strength));
  }
  ctx.restore();
}

function chromaFadeLaneGeometry(frame) {
  const plot = plotRect(frame);
  return {y: plot.y + plot.h - CHROMA_FADE_LANE_BOTTOM_OFFSET * devicePixelRatioSafe()};
}

function chromaFadeGaugeGeometry(frame, config) {
  const plot = plotRect(frame);
  const dpr = devicePixelRatioSafe();
  const lane = chromaFadeLaneGeometry(frame, config);
  const lowX = plot.x + chromaFadeBoundaryUnitFromValue(config.chromaFadeLow) * plot.w;
  const highX = plot.x + chromaFadeBoundaryUnitFromValue(config.chromaFadeHigh) * plot.w;
  const x = clamp((lowX + highX) / 2, plot.x + 10 * dpr, plot.x + plot.w - 10 * dpr);
  const height = Math.min(CHROMA_FADE_GAUGE_HEIGHT * dpr, Math.max(14 * dpr, lane.y - plot.y - 8 * dpr));
  return {x, top: lane.y - height, bottom: lane.y, height};
}

function chromaMapHandlePoint(frame, config, handle, yMax = 1, xMax = yMax) {
  const plot = plotRect(frame);
  const lane = chromaFadeLaneGeometry(frame, config);
  if (handle.key === "chromaExposure") {
    const targetChroma = chromaPlacementTargetChromaForDomain(yMax);
    const inputChroma = chromaPlacementInputChroma(config, targetChroma);
    return {
      x: plot.x + clamp01(inputChroma / Math.max(xMax, 1e-6)) * plot.w,
      y: plot.y + (1 - clamp01(targetChroma / Math.max(yMax, 1e-6))) * plot.h
    };
  }
  if (handle.key === "chromaGamma") {
    const handleChroma = chromaGammaHandleChromaForDomain(xMax);
    return {
      x: plot.x + clamp01(handleChroma / Math.max(xMax, 1e-6)) * plot.w,
      y: plot.y + (1 - clamp01(chromaBaseCurveSample(handleChroma, config) / Math.max(yMax, 1e-6))) * plot.h
    };
  }
  if (handle.key === "chromaFadeLow" || handle.key === "chromaFadeHigh") {
    const value = handle.key === "chromaFadeLow" ? config.chromaFadeLow : config.chromaFadeHigh;
    return {
      x: plot.x + chromaFadeBoundaryUnitFromValue(value) * plot.w,
      y: lane.y
    };
  }
  if (handle.key === "chromaFadeStrength") {
    const gauge = chromaFadeGaugeGeometry(frame, config);
    const unit = chromaFadeStrengthUnitFromValue(config.chromaFadeStrength);
    return {x: gauge.x, y: mix(gauge.bottom, gauge.top, unit)};
  }
  return {x: plot.x, y: plot.y + plot.h};
}

function computeChromaGraphMetrics(config, handleState = {}) {
  const inputMax = handleState.sourceChromaDomainMax ?? CHROMA_PREVIEW_MAX;
  const absoluteHistogram = transformChromaHistogram(
    handleState.sourceChromaHistogram,
    config,
    handleState.sourceChromaHistogram?.length || 0,
    {chromaByLuma: handleState.sourceChromaByLuma, inputMax, outputMax: CHROMA_PREVIEW_MAX}
  );
  const p99Chroma = chromaPercentileFromHistogram(absoluteHistogram, CHROMA_DISPLAY_PERCENTILE, CHROMA_PREVIEW_MAX)
    ?? handleState.sourceMaxChroma
    ?? inputMax
    ?? CHROMA_DEFAULT_DISPLAY_MAX;
  const displayMax = chromaDisplayMaxFromHistogram(absoluteHistogram, handleState.sourceMaxChroma ?? inputMax ?? CHROMA_DEFAULT_DISPLAY_MAX);
  const displayedHistogram = transformChromaHistogram(
    handleState.sourceChromaHistogram,
    config,
    handleState.sourceChromaHistogram?.length || 0,
    {chromaByLuma: handleState.sourceChromaByLuma, inputMax, outputMax: displayMax}
  );
  return {displayMax, p99Chroma, histogram: displayedHistogram};
}

function drawChromaPreview(canvas, config, handleState = {}) {
  const frame = beginFrame(canvas);
  if (!frame) return;

  const metrics = computeChromaGraphMetrics(config, handleState);
  const yMax = metrics.displayMax || CHROMA_GRAPH_Y_MAX;
  const curves = LUMA_REFERENCE_SAMPLES.map(sample => ({
    ...sample,
    points: sampleCurve(x => chromaCurveSample(x * yMax, sample.luma, config))
  }));

  drawFrame(frame, {yMax, labels: false});
  drawChromaHistogramUnderlay(frame, metrics.histogram);
  drawChromaPercentileIndicator(frame, metrics.p99Chroma, yMax);
  drawCurve(frame, sampleCurve(x => x * yMax), {alpha: 0.22, dash: [2, 3], width: 1, yMax});
  for (const curve of curves) {
    drawCurve(frame, curve.points, {alpha: curve.alpha, dash: curve.dash, width: curve.label === "mid" ? 2 : 1.25, yMax});
  }
  drawChromaLegend(frame, curves);
  drawChromaMapHandles(frame, config, yMax, handleState);
}

function createPreviewCard(root, {title, note = "", className = ""}) {
  const card = document.createElement("section");
  card.className = `curve-preview-card${className ? ` ${className}` : ""}`;

  const header = document.createElement("div");
  header.className = "curve-preview-header";

  const titleNode = document.createElement("h2");
  titleNode.textContent = title;

  const canvas = document.createElement("canvas");
  canvas.width = 288;
  canvas.height = 94;
  canvas.setAttribute("aria-label", note ? `${title}: ${note}` : title);

  header.append(titleNode);
  if (note) {
    const noteNode = document.createElement("span");
    noteNode.textContent = note;
    header.append(noteNode);
  }
  card.append(header, canvas);
  root.append(card);
  return canvas;
}

function beginFrame(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(120, Math.round((rect.width || canvas.width) * devicePixelRatioSafe()));
  const height = Math.max(64, Math.round((rect.height || canvas.height) * devicePixelRatioSafe()));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const css = getComputedStyle(canvas);
  const rootCss = getComputedStyle(document.documentElement);
  const compactAxes = canvas.classList.contains("luma-curve-canvas") || canvas.classList.contains("chroma-curve-canvas");
  const frame = {
    canvas,
    ctx,
    width,
    height,
    padLeft: (compactAxes ? 12 : 24) * devicePixelRatioSafe(),
    padRight: 12 * devicePixelRatioSafe(),
    padTop: 12 * devicePixelRatioSafe(),
    padBottom: (compactAxes ? 12 : 20) * devicePixelRatioSafe(),
    bg: css.getPropertyValue("--panel2") || "#0c1015",
    line: css.getPropertyValue("--line") || "rgba(184,196,214,.16)",
    lineStrong: css.getPropertyValue("--line-strong") || "rgba(184,196,214,.28)",
    accent: css.getPropertyValue("--accent") || "#8fb4df",
    muted: rootCss.getPropertyValue("--muted") || "#89929f",
    text: rootCss.getPropertyValue("--soft") || "#b6beca"
  };

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = frame.bg.trim();
  ctx.fillRect(0, 0, width, height);
  return frame;
}

function drawFrame(frame, {yMax, labels = true}) {
  const {ctx} = frame;
  const plot = plotRect(frame);
  ctx.save();
  ctx.strokeStyle = frame.line.trim();
  ctx.lineWidth = 1 * devicePixelRatioSafe();

  for (const stop of [0, 0.25, 0.5, 0.75, 1]) {
    const x = plot.x + plot.w * stop;
    const y = plot.y + plot.h * stop;
    line(ctx, x, plot.y, x, plot.y + plot.h);
    line(ctx, plot.x, y, plot.x + plot.w, y);
  }

  ctx.strokeStyle = frame.lineStrong.trim();
  ctx.strokeRect(plot.x, plot.y, plot.w, plot.h);

  if (labels) {
    ctx.fillStyle = frame.muted.trim();
    ctx.font = `${9 * devicePixelRatioSafe()}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(formatCompact(yMax), plot.x - 5 * devicePixelRatioSafe(), plot.y);
    ctx.fillText("0", plot.x - 5 * devicePixelRatioSafe(), plot.y + plot.h);
  }
  ctx.restore();
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

function drawHistogramUnderlay(frame, histogram) {
  const profile = histogramDisplayProfile(histogram);
  if (!profile) return;
  const {ctx} = frame;
  const plot = plotRect(frame);
  const dpr = devicePixelRatioSafe();
  const binWidth = plot.w / profile.length;

  ctx.save();
  for (let index = 0; index < profile.length; index += 1) {
    const bin = profile[index];
    if (!bin.value) continue;
    const height = clamp01(bin.scaled) * plot.h;
    const width = bin.clipped ? Math.max(binWidth * 1.85, 2.4 * dpr) : Math.max(binWidth + 0.35 * dpr, 1 * dpr);
    const x = plot.x + index * binWidth + (binWidth - width) / 2;
    const y = plot.y + plot.h - height;
    ctx.globalAlpha = bin.clipped ? 0.68 : 0.22;
    ctx.fillStyle = bin.clipped ? "#ff5c57" : frame.accent.trim();
    ctx.fillRect(x, y, width, height);
  }
  ctx.restore();
}


function drawChromaHistogramUnderlay(frame, histogram) {
  const profile = histogramDisplayProfile(histogram, {clipFraction: 0.045});
  if (!profile) return;
  const {ctx} = frame;
  const plot = plotRect(frame);
  const dpr = devicePixelRatioSafe();
  const binWidth = plot.w / profile.length;

  ctx.save();
  for (let index = 0; index < profile.length; index += 1) {
    const bin = profile[index];
    if (!bin.value) continue;
    const height = clamp01(bin.scaled) * plot.h * 0.82;
    const width = bin.clipped ? Math.max(binWidth * 1.85, 2.4 * dpr) : Math.max(binWidth + 0.35 * dpr, 1 * dpr);
    const x = plot.x + index * binWidth + (binWidth - width) / 2;
    const y = plot.y + plot.h - height;
    ctx.globalAlpha = bin.clipped ? 0.46 : 0.16;
    ctx.fillStyle = bin.clipped ? "#ff5c57" : frame.accent.trim();
    ctx.fillRect(x, y, width, height);
  }
  ctx.restore();
}

function drawChromaPercentileIndicator(frame, percentileChroma, displayMax) {
  if (!Number.isFinite(percentileChroma) || percentileChroma <= 0 || !Number.isFinite(displayMax) || displayMax <= 0) return;
  const {ctx} = frame;
  const plot = plotRect(frame);
  const dpr = devicePixelRatioSafe();
  const unit = clamp01(percentileChroma / displayMax);
  const x = unit >= 0.995 ? plot.x + plot.w - 1.5 * dpr : plot.x + unit * plot.w;
  const label = `P99 C ${formatCompact(percentileChroma)}`;

  ctx.save();
  ctx.strokeStyle = frame.text.trim();
  ctx.fillStyle = frame.text.trim();
  ctx.lineWidth = 1 * dpr;
  ctx.globalAlpha = 0.38;
  ctx.setLineDash([3 * dpr, 3 * dpr]);
  line(ctx, x, plot.y, x, plot.y + plot.h);
  ctx.setLineDash([]);

  ctx.globalAlpha = 0.82;
  ctx.font = `${8.5 * dpr}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textBaseline = "top";
  const labelWidth = ctx.measureText(label).width;
  const inset = 5 * dpr;
  let labelX = x + inset;
  ctx.textAlign = "left";
  if (labelX + labelWidth > plot.x + plot.w - 3 * dpr) {
    labelX = plot.x + plot.w - labelWidth - 3 * dpr;
  }
  if (labelX < plot.x + 3 * dpr) labelX = plot.x + 3 * dpr;
  ctx.fillText(label, labelX, plot.y + 4 * dpr);
  ctx.restore();
}

function drawCurve(frame, points, {alpha, dash = [], width, yMax}) {
  const {ctx} = frame;
  const plot = plotRect(frame);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = frame.accent.trim();
  ctx.lineWidth = width * devicePixelRatioSafe();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash(dash.map(value => value * devicePixelRatioSafe()));
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = plot.x + clamp01(point.x) * plot.w;
    const y = plot.y + (1 - clamp01(point.y / yMax)) * plot.h;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.restore();
}

function drawAxisLabels(frame, left, right) {
  const {ctx} = frame;
  const plot = plotRect(frame);
  ctx.save();
  ctx.fillStyle = frame.muted.trim();
  ctx.font = `${9 * devicePixelRatioSafe()}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(left, plot.x, plot.y + plot.h + 4 * devicePixelRatioSafe());
  ctx.textAlign = "right";
  ctx.fillText(right, plot.x + plot.w, plot.y + plot.h + 4 * devicePixelRatioSafe());
  ctx.restore();
}

function drawChromaLegend(frame, curves) {
  const {ctx} = frame;
  const plot = plotRect(frame);
  const dpr = devicePixelRatioSafe();
  let x = plot.x + 4 * dpr;
  const y = plot.y + 6 * dpr;

  ctx.save();
  ctx.font = `${8.5 * dpr}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textBaseline = "middle";
  for (const curve of curves) {
    ctx.globalAlpha = curve.alpha;
    ctx.strokeStyle = frame.accent.trim();
    ctx.lineWidth = (curve.label === "mid" ? 2 : 1.25) * dpr;
    ctx.setLineDash(curve.dash.map(value => value * dpr));
    line(ctx, x, y, x + 14 * dpr, y);
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = frame.text.trim();
    ctx.fillText(curve.label, x + 18 * dpr, y);
    x += ctx.measureText(curve.label).width + 31 * dpr;
  }
  ctx.restore();
}

function sampleCurve(fn, sampleCount = 96) {
  return Array.from({length: sampleCount}, (_, index) => {
    const x = index / (sampleCount - 1);
    return {x, y: fn(x)};
  });
}

function plotRect(frame) {
  return {
    x: frame.padLeft,
    y: frame.padTop,
    w: frame.width - frame.padLeft - frame.padRight,
    h: frame.height - frame.padTop - frame.padBottom
  };
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function safeLog2(value) {
  return Math.log2(Math.max(value, 1e-6));
}

function logit(value) {
  const x = clamp(value, 1e-6, 1 - 1e-6);
  return Math.log(x / (1 - x));
}

function invLogit(value) {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

function mix(a, b, weight) {
  return a * (1 - weight) + b * weight;
}

function sanitizeControlValue(key, value) {
  const definition = CONTROL_DEFINITIONS.get(key);
  const fallback = definition?.min ?? -Infinity;
  if (!Number.isFinite(value)) return fallback;
  if (!definition) return value;
  return Math.min(definition.max, Math.max(definition.min, value));
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function formatCompact(value) {
  if (Math.abs(value) >= 10) return value.toFixed(0);
  if (Math.abs(value) >= 1) return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function formatSigned(value) {
  const text = formatCompact(value);
  return value > 0 ? `+${text}` : text;
}

function devicePixelRatioSafe() {
  return typeof window === "undefined" ? 1 : Math.max(1, window.devicePixelRatio || 1);
}
