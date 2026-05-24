import { CHROMA_MAP_CONTROL_KEYS, TINT_CONTROL_KEYS, TONE_MAP_CONTROL_KEYS, normalizeConfig } from "./config.js";
import { createPreviewCard } from "./curve-preview/canvas.js";
import { createChromaMapControls, bindChromaMapHandles, computeChromaGraphMetrics, drawChromaPreview } from "./curve-preview/chroma-map.js";
import { createTintControls, bindTintHandles, drawTintPreview } from "./curve-preview/tint.js";
import { createToneMapControls, bindToneShapeHandles, bindTonalBalanceHandles, drawLumaPreview } from "./curve-preview/tone-map.js";
import { normalizeSourceHistograms, sanitizeControlValue } from "./curve-preview/shared.js";

const PREVIEW_SCOPES = Object.freeze(["luma", "chroma", "tint"]);
const CHROMA_PREVIEW_CONTROL_KEYS = Object.freeze([
  ...CHROMA_MAP_CONTROL_KEYS,
  "exposure",
  "gamma"
]);
const LUMA_PREVIEW_KEY_SET = new Set(TONE_MAP_CONTROL_KEYS);
const CHROMA_PREVIEW_KEY_SET = new Set(CHROMA_PREVIEW_CONTROL_KEYS);
const TINT_PREVIEW_KEY_SET = new Set(TINT_CONTROL_KEYS);

export function previewScopesForConfigKeys(keys = []) {
  const scopes = new Set();
  for (const key of keys) {
    if (LUMA_PREVIEW_KEY_SET.has(key)) scopes.add("luma");
    if (CHROMA_PREVIEW_KEY_SET.has(key)) scopes.add("chroma");
    if (TINT_PREVIEW_KEY_SET.has(key)) scopes.add("tint");
  }
  return Array.from(scopes);
}

export function changedConfigKeys(previousConfig = {}, nextConfig = {}) {
  const keys = new Set([...Object.keys(previousConfig || {}), ...Object.keys(nextConfig || {})]);
  return Array.from(keys).filter(key => previousConfig?.[key] !== nextConfig?.[key]);
}

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

  const tintCanvas = createPreviewCard(root, {
    title: "Tint",
    note: "Low / High · Strength",
    className: "tint-card"
  });
  tintCanvas.classList.add("tint-curve-canvas");
  tintCanvas.setAttribute("aria-label", "Tint: drag low or high handle to set hue (X) and strength (Y); drag C to set crossover; use graph locks to link hue rotation or tint strength");

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
  let activeTintHandle = null;
  let hoverTintHandle = null;
  let toneControls = null;
  let chromaControls = null;
  let tintControls = null;
  const dirtyPreviews = {luma: true, chroma: true, tint: true};

  function setConfigValue(key, value) {
    setConfigValues({[key]: sanitizeControlValue(key, value)});
  }

  function setConfigValues(patch) {
    const previousConfig = config;
    const nextConfig = normalizeConfig({...config});
    for (const [key, value] of Object.entries(patch || {})) {
      nextConfig[key] = sanitizeControlValue(key, value);
    }
    const normalizedNextConfig = normalizeConfig(nextConfig);
    const changedKeys = changedConfigKeys(previousConfig, normalizedNextConfig);
    if (!changedKeys.length) return;

    config = normalizedNextConfig;
    toneControls?.sync(normalizedNextConfig);
    chromaControls?.sync(normalizedNextConfig);
    tintControls?.sync(normalizedNextConfig);
    scheduleRender(normalizedNextConfig, previewScopesForConfigKeys(changedKeys));
    options.onConfigChange?.(normalizedNextConfig);
  }

  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(entries => {
    const scopes = new Set();
    for (const entry of entries || []) {
      if (entry.target === lumaCanvas) scopes.add("luma");
      if (entry.target === chromaCanvas) scopes.add("chroma");
      if (entry.target === tintCanvas) scopes.add("tint");
    }
    scheduleRender(config, scopes.size ? Array.from(scopes) : PREVIEW_SCOPES);
  });
  resizeObserver?.observe(lumaCanvas);
  resizeObserver?.observe(chromaCanvas);
  resizeObserver?.observe(tintCanvas);

  toneControls = createToneMapControls(lumaCanvas, {
    getConfig: () => config,
    setConfigValue,
    setConfigValues,
    requestRender: () => scheduleRender(config, "luma")
  });

  chromaControls = createChromaMapControls(chromaCanvas, {
    getConfig: () => config,
    setConfigValue,
    setConfigValues,
    requestRender: () => scheduleRender(config, "chroma")
  });

  tintControls = createTintControls(tintCanvas, {
    getConfig: () => config,
    setConfigValue,
    setConfigValues,
    requestRender: () => scheduleRender(config, "tint")
  });

  const unbindShapeHandles = bindToneShapeHandles(lumaCanvas, {
    getConfig: () => config,
    getActiveKey: () => activeShapeHandle?.key || null,
    getHoverKey: () => hoverShapeHandle,
    setActiveHandle: handle => {
      activeShapeHandle = handle;
      scheduleRender(config, "luma");
    },
    setHoverKey: key => {
      if (hoverShapeHandle === key) return;
      hoverShapeHandle = key;
      scheduleRender(config, "luma");
    },
    setConfigValue
  });

  const unbindLumaHandles = bindTonalBalanceHandles(lumaCanvas, {
    getConfig: () => config,
    getActiveKey: () => activeBalanceHandle?.key || null,
    getHoverKey: () => hoverBalanceHandle,
    setActiveHandle: handle => {
      activeBalanceHandle = handle;
      scheduleRender(config, "luma");
    },
    setHoverKey: key => {
      if (hoverBalanceHandle === key) return;
      hoverBalanceHandle = key;
      scheduleRender(config, "luma");
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
      scheduleRender(config, "chroma");
    },
    setHoverKey: key => {
      if (hoverChromaHandle === key) return;
      hoverChromaHandle = key;
      scheduleRender(config, "chroma");
    },
    setConfigValue
  });

  const unbindTintHandles = bindTintHandles(tintCanvas, {
    getConfig: () => config,
    setActiveHandle: handle => {
      activeTintHandle = handle;
      scheduleRender(config, "tint");
    },
    setHoverKey: key => {
      if (hoverTintHandle === key) return;
      hoverTintHandle = key;
      scheduleRender(config, "tint");
    },
    setConfigValue,
    setConfigValues,
    toggleTintLink: () => tintControls?.toggleLinked?.(),
    toggleTintStrengthLink: () => tintControls?.toggleStrengthLinked?.(),
    setTintCrossoverValue: value => tintControls?.setTintCrossoverValue?.(value),
    setTintHandleValue: (key, hue, strength) => tintControls?.setTintHandleValue?.(key, hue, strength)
  });

  function normalizeScopes(scopes) {
    if (!scopes) return [];
    return Array.isArray(scopes) ? scopes : [scopes];
  }

  function markDirty(scopes) {
    for (const scope of normalizeScopes(scopes)) {
      if (scope === "all") {
        for (const preview of PREVIEW_SCOPES) dirtyPreviews[preview] = true;
      } else if (scope in dirtyPreviews) {
        dirtyPreviews[scope] = true;
      }
    }
  }

  function hasDirtyPreview() {
    return PREVIEW_SCOPES.some(scope => dirtyPreviews[scope]);
  }

  function scheduleRender(nextConfig = config, scopes = null) {
    config = normalizeConfig(nextConfig);
    markDirty(scopes);
    if (!hasDirtyPreview()) return;
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      renderNow();
    });
  }

  function renderConfig(nextConfig = config) {
    const normalized = normalizeConfig(nextConfig);
    const changedKeys = changedConfigKeys(config, normalized);
    config = normalized;
    markDirty(previewScopesForConfigKeys(changedKeys));
    scheduleRender(config);
  }

  function renderNow(nextConfig = config) {
    config = normalizeConfig(nextConfig);
    const shouldDraw = {...dirtyPreviews};
    for (const scope of PREVIEW_SCOPES) dirtyPreviews[scope] = false;

    toneControls?.sync(config);
    chromaControls?.sync(config);
    tintControls?.sync(config);

    if (shouldDraw.luma) {
      drawLumaPreview(lumaCanvas, config, sourceHistogram, {
        activeKey: activeBalanceHandle?.key || null,
        hoverKey: hoverBalanceHandle,
        showTonePivot: true,
        activeShapeKey: activeShapeHandle?.key || null,
        hoverShapeKey: hoverShapeHandle,
        pivotActive: toneControls?.isDraggingPivot() || activeShapeHandle?.key === "curveStrength" || hoverShapeHandle === "curveStrength",
        pivotExposed: toneControls?.isExpanded()
      });
    }

    if (shouldDraw.chroma) {
      drawChromaPreview(chromaCanvas, config, {
        activeChromaKey: activeChromaHandle?.key || null,
        hoverChromaKey: hoverChromaHandle,
        sourceChromaHistogram,
        sourceChromaByLuma,
        sourceMaxChroma,
        sourceChromaDomainMax
      });
    }

    if (shouldDraw.tint) {
      drawTintPreview(tintCanvas, config, {
        activeTintHandle,
        hoverTintHandle,
        tintLinked: tintControls?.isLinked?.() !== false,
        tintStrengthLinked: tintControls?.isStrengthLinked?.() !== false
      });
    }
  }

  renderNow(config);

  return {
    render: renderConfig,
    toggleToneMapZoom: () => toneControls?.toggleZoom?.(),
    toggleChromaMapZoom: () => chromaControls?.toggleZoom?.(),
    dockZoomedMaps() {
      toneControls?.setZoomed?.(false);
      chromaControls?.setZoomed?.(false);
    },
    setHistogram(nextHistogram) {
      const histograms = normalizeSourceHistograms(nextHistogram);
      sourceHistogram = histograms.luma;
      sourceChromaHistogram = histograms.chroma;
      sourceChromaByLuma = histograms.chromaByLuma;
      sourceMaxChroma = histograms.maxChroma;
      sourceChromaDomainMax = histograms.chromaDomainMax;
      scheduleRender(config, ["luma", "chroma"]);
    },
    destroy() {
      if (rafId) cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      unbindShapeHandles();
      unbindLumaHandles();
      unbindChromaHandles();
      unbindTintHandles();
      toneControls?.destroy();
      chromaControls?.destroy();
      tintControls?.destroy();
    }
  };
}

export {
  CHROMA_FADE_GAUGE_HEIGHT,
  CHROMA_PLACEMENT_CHROMA,
  CHROMA_PREVIEW_MAX,
  EXPOSURE_PLACEMENT_LUMA,
  TONAL_BALANCE_HANDLES,
  adjustedLumaFromInputLuma,
  applyLiftMidtoneGain,
  baseTonePivotInputLuma,
  chromaBaseCurveSample,
  chromaCurveSample,
  chromaDisplayMaxFromHistogram,
  chromaExposureValueFromHorizontalPosition,
  chromaExposureValueFromPlacementInputChroma,
  chromaFadeCenterUnitFromValue,
  chromaFadeCenterValueFromUnit,
  chromaFadeCenterValueFromHorizontalPosition,
  chromaFadeMask,
  chromaFadeRegionLabel,
  chromaFadeSoftnessEdgeUnit,
  chromaFadeSoftnessFromHorizontalPosition,
  chromaFadeSoftnessUnitFromValue,
  chromaFadeStrengthFromGaugePointer,
  chromaFadeStrengthUnitFromValue,
  chromaFadeWindow,
  chromaGammaValueFromVerticalDrag,
  chromaPercentileFromHistogram,
  chromaPlacementInputChroma,
  clampFloatingWindowPosition,
  curveStrengthValueFromVerticalDrag,
  effectiveToneCenter,
  effectiveTonePivotLuma,
  exposurePlacementInputLuma,
  exposureValueFromHorizontalPosition,
  exposureValueFromPlacementInputLuma,
  gammaAdjust,
  gammaValueFromVerticalDrag,
  histogramDensityAtLuma,
  histogramDisplayProfile,
  inputLumaFromAdjustedLuma,
  inputLumaFromToneCenter,
  lumaCurveSample,
  lumaToneBaseSample,
  maxChromaFromHistogram,
  pivotedLogitCurve,
  pivotLumaFromToneCenter,
  toneCenterFromInputLuma,
  toneCenterFromPivotLuma,
  tonePivotInputLuma,
  tonePivotNudgeFromHorizontalPosition,
  tonePivotNudgeFromInputLuma,
  tonePivotNudgeFromSlopeHandleInputLuma,
  tonalBalanceHandleValue,
  tonalBalanceValueFromVerticalDrag,
  toneSlopeFromControls,
  transformChromaHistogram,
  transformChromaJointHistogram,
  transformLumaHistogram
} from "./curve-preview/shared.js";

export {
  CURVE_STRENGTH_MAST_HEIGHT,
  SHOULDER_GAUGE_HEIGHT,
  curveStrengthUnitFromValue,
  shoulderGaugeUnitFromToneShoulder,
  toneShoulderFromGaugePointer,
  toneShoulderFromGaugeUnit
} from "./curve-preview/tone-map.js";
