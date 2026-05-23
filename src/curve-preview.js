import { normalizeConfig } from "./config.js";
import { createPreviewCard } from "./curve-preview/canvas.js";
import { createChromaMapControls, bindChromaMapHandles, computeChromaGraphMetrics, drawChromaPreview } from "./curve-preview/chroma-map.js";
import { createTintControls, bindTintHandles, drawTintPreview } from "./curve-preview/tint.js";
import { createToneMapControls, bindToneShapeHandles, bindTonalBalanceHandles, drawLumaPreview } from "./curve-preview/tone-map.js";
import { normalizeSourceHistograms, sanitizeControlValue } from "./curve-preview/shared.js";

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
    note: "Hue \u00b7 Strength",
    className: "tint-card"
  });
  tintCanvas.classList.add("tint-curve-canvas");
  tintCanvas.setAttribute("aria-label", "Tint: drag handle to set hue (X) and strength (Y)");

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
    tintControls?.sync(nextConfig);
    scheduleRender(nextConfig);
    options.onConfigChange?.(nextConfig);
  }

  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => scheduleRender());
  resizeObserver?.observe(lumaCanvas);
  resizeObserver?.observe(chromaCanvas);
  resizeObserver?.observe(tintCanvas);

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

  tintControls = createTintControls(tintCanvas, {
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

  const unbindTintHandles = bindTintHandles(tintCanvas, {
    getConfig: () => config,
    setActiveHandle: handle => {
      activeTintHandle = handle;
      scheduleRender(config);
    },
    setHoverKey: key => {
      if (hoverTintHandle === key) return;
      hoverTintHandle = key;
      scheduleRender(config);
    },
    setConfigValues
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
    tintControls?.sync(config);
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
    drawTintPreview(tintCanvas, config, {activeTintHandle, hoverTintHandle});
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
  chromaFadeBoundaryUnitFromValue,
  chromaFadeBoundaryValueFromUnit,
  chromaFadeBoundaryValueFromHorizontalPosition,
  chromaFadeStrengthFromGaugePointer,
  chromaFadeStrengthUnitFromValue,
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
