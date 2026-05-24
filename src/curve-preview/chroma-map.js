import { CHROMA_MAP_CONTROL_KEYS, normalizeConfig, resetChromaMapConfig } from "../config.js";
import { createDockRange } from "./dom-controls.js";
import { beginFrame, drawChromaHistogramUnderlay, drawChromaLegend, drawChromaPercentileIndicator, drawCurve, drawFrame, frameFromClientRect, line, plotRect, sampleCurve } from "./canvas.js";
import {
  CHROMA_DEFAULT_DISPLAY_MAX,
  CHROMA_DISPLAY_PERCENTILE,
  CHROMA_FADE_GAUGE_HEIGHT,
  CHROMA_FADE_MASK_HEIGHT,
  CHROMA_FADE_LANE_BOTTOM_OFFSET,
  CHROMA_GRAPH_Y_MAX,
  CHROMA_PREVIEW_MAX,
  LUMA_REFERENCE_SAMPLES,
  chromaBaseCurveSample,
  chromaCurveParams,
  chromaCurveSampleWithParams,
  chromaDisplayMaxFromHistogram,
  chromaExposureValueFromHorizontalPosition,
  chromaFadeCenterUnitFromValue,
  chromaFadeCenterValueFromHorizontalPosition,
  chromaFadeMask,
  chromaFadeRegionLabel,
  chromaFadeSoftnessEdgeUnit,
  chromaFadeSoftnessFromHorizontalPosition,
  chromaFadeStrengthFromGaugePointer,
  chromaFadeStrengthUnitFromValue,
  chromaFadeWindow,
  chromaGammaHandleChromaForDomain,
  chromaGammaValueFromVerticalDrag,
  chromaPercentileFromHistogram,
  chromaPlacementInputChroma,
  chromaPlacementTargetChromaForDomain,
  clamp01,
  devicePixelRatioSafe,
  formatCompact,
  formatSigned,
  mix,
  transformChromaHistogram
} from "./shared.js";

const CHROMA_GRAPH_METRIC_KEYS = Object.freeze([
  "exposure",
  "gamma",
  "chromaExposure",
  "chromaGamma",
  "chromaFadeStrength",
  "chromaFadeRegion",
  "chromaFadeCenter",
  "chromaFadeSoftness"
]);

const CHROMA_METRICS_CACHE_LIMIT = 16;
const CHROMA_CURVE_CACHE_LIMIT = 24;
let chromaGraphMetricsCache = new Map();
let chromaCanvasCurveCaches = new WeakMap();
let nextHistogramReferenceId = 1;
const histogramReferenceIds = new WeakMap();

function lruGet(cache, key) {
  if (!cache.has(key)) return null;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function lruSet(cache, key, value, limit) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) cache.delete(cache.keys().next().value);
  return value;
}

function histogramReferenceId(value) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return "null";
  if (!histogramReferenceIds.has(value)) {
    histogramReferenceIds.set(value, nextHistogramReferenceId);
    nextHistogramReferenceId += 1;
  }
  return histogramReferenceIds.get(value);
}

export function chromaGraphMetricsSignature(config, handleState = {}) {
  const normalized = normalizeConfig(config);
  const parts = CHROMA_GRAPH_METRIC_KEYS.map(key => `${key}:${normalized[key]}`);
  parts.push(`hist:${histogramReferenceId(handleState.sourceChromaHistogram)}`);
  parts.push(`histLength:${handleState.sourceChromaHistogram?.length || 0}`);
  parts.push(`joint:${histogramReferenceId(handleState.sourceChromaByLuma)}`);
  parts.push(`jointLength:${handleState.sourceChromaByLuma?.length || 0}`);
  parts.push(`max:${handleState.sourceMaxChroma ?? ""}`);
  parts.push(`domain:${handleState.sourceChromaDomainMax ?? ""}`);
  return parts.join("|");
}

export function resetChromaPreviewCaches() {
  chromaGraphMetricsCache = new Map();
  chromaCanvasCurveCaches = new WeakMap();
}

export function createChromaMapControls(canvas, bindings) {
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

  const zoomButton = document.createElement("button");
  zoomButton.type = "button";
  zoomButton.className = "tone-map-action chroma-map-zoom";
  zoomButton.textContent = "Zoom";
  zoomButton.setAttribute("aria-pressed", "false");

  actions.append(resetButton, detailsButton, expandButton, zoomButton);
  header?.append(actions);

  const readouts = document.createElement("div");
  readouts.className = "tone-map-readouts chroma-map-readouts";
  const readoutChips = new Map();
  for (const item of [
    ["chromaExposure", "C"],
    ["chromaGamma", "γC"],
    ["chromaFadeStrength", "A"],
    ["chromaFadeRegion", "Reg"],
    ["chromaFadeCenter", "Ctr"],
    ["chromaFadeSoftness", "Soft"]
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
    createDockRange("Amount", "chromaFadeStrength", 0, 1, 0.01),
    createFadeRegionControl(bindings),
    createDockRange("Center", "chromaFadeCenter", 0, 1, 0.01),
    createDockRange("Softness", "chromaFadeSoftness", 0.02, 1, 0.01)
  ];
  for (const control of detailControls) details.append(control.wrapper);
  card.append(readouts, details);

  const state = {expanded: false, details: false, zoomed: false};
  const workbench = document.getElementById("workbench");

  const handleExternalZoomRequest = event => {
    if (!state.zoomed || event.detail?.card === card) return;
    state.zoomed = false;
    syncExpansion();
    bindings.requestRender?.();
  };
  document.addEventListener("curve-preview-zoom-request", handleExternalZoomRequest);

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

  zoomButton.addEventListener("click", () => {
    toggleZoom();
  });

  detailsButton.addEventListener("click", () => {
    state.details = !state.details;
    syncExpansion();
    bindings.requestRender?.();
  });

  for (const control of detailControls) {
    control.input?.addEventListener("input", () => bindings.setConfigValue(control.key, control.input.valueAsNumber));
  }

  function setZoomed(zoomed) {
    const nextZoomed = Boolean(zoomed);
    if (state.zoomed === nextZoomed) return state.zoomed;
    state.zoomed = nextZoomed;
    if (state.zoomed) {
      document.dispatchEvent(new CustomEvent("curve-preview-zoom-request", {detail: {card}}));
    }
    syncExpansion();
    bindings.requestRender?.();
    return state.zoomed;
  }

  function toggleZoom() {
    return setZoomed(!state.zoomed);
  }

  function syncExpansion() {
    card.classList.toggle("is-expanded", state.expanded);
    card.classList.toggle("is-details-open", state.details);
    card.classList.toggle("is-zoomed", state.zoomed);
    workbench?.classList.toggle("is-chroma-map-expanded", state.expanded);
    workbench?.classList.toggle("is-chroma-map-zoomed", state.zoomed);
    expandButton.hidden = state.zoomed;
    expandButton.disabled = state.zoomed;
    expandButton.textContent = state.expanded ? "Shrink" : "Expand";
    expandButton.setAttribute("aria-expanded", state.expanded ? "true" : "false");
    expandButton.setAttribute("aria-label", `${state.expanded ? "Shrink" : "Expand"} Chroma Map`);
    zoomButton.textContent = state.zoomed ? "Dock" : "Zoom";
    zoomButton.setAttribute("aria-pressed", state.zoomed ? "true" : "false");
    zoomButton.setAttribute("aria-label", `${state.zoomed ? "Dock" : "Zoom"} Chroma Map`);
    detailsButton.setAttribute("aria-expanded", state.details ? "true" : "false");
    detailsButton.setAttribute("aria-label", `${state.details ? "Hide" : "Show"} Chroma Map details`);
  }

  syncExpansion();
  sync(bindings.getConfig());

  return {
    sync,
    isExpanded: () => state.expanded || state.details || state.zoomed,
    isZoomed: () => state.zoomed,
    setZoomed,
    toggleZoom,
    destroy() {
      document.removeEventListener("curve-preview-zoom-request", handleExternalZoomRequest);
      workbench?.classList.remove("is-chroma-map-expanded");
      workbench?.classList.remove("is-chroma-map-zoomed");
      actions.remove();
      readouts.remove();
      details.remove();
    }
  };

  function sync(nextConfig) {
    const config = normalizeConfig(nextConfig);
    for (const control of detailControls) {
      if (control.sync) {
        control.sync(config);
        continue;
      }
      control.input.value = String(config[control.key]);
      control.value.textContent = formatCompact(config[control.key]);
    }

    setReadout("chromaExposure", `C ${formatSigned(config.chromaExposure)}`);
    setReadout("chromaGamma", `γC ${formatCompact(config.chromaGamma)}`);
    setReadout("chromaFadeStrength", `Amt ${formatCompact(config.chromaFadeStrength)}`);
    setReadout("chromaFadeRegion", config.chromaFadeRegion >= 0.5 ? "Highlights" : "Shadows");
    setReadout("chromaFadeCenter", `Ctr ${formatCompact(config.chromaFadeCenter)}`);
    setReadout("chromaFadeSoftness", `Soft ${formatCompact(config.chromaFadeSoftness)}`);
  }

  function setReadout(key, text) {
    const chip = readoutChips.get(key);
    if (chip) chip.textContent = text;
  }
}

function createFadeRegionControl(bindings) {
  const wrapper = document.createElement("div");
  wrapper.className = "tone-dock-range chroma-region-control";
  wrapper.setAttribute("data-key", "chromaFadeRegion");

  const name = document.createElement("span");
  name.className = "tone-dock-label";
  name.textContent = "Region";

  const buttons = document.createElement("div");
  buttons.className = "chroma-region-buttons";

  const shadows = document.createElement("button");
  shadows.type = "button";
  shadows.textContent = "Shadows";
  shadows.dataset.value = "0";

  const highlights = document.createElement("button");
  highlights.type = "button";
  highlights.textContent = "Highlights";
  highlights.dataset.value = "1";

  const value = document.createElement("span");
  value.className = "tone-dock-value";

  buttons.append(shadows, highlights);
  wrapper.append(name, buttons, value);

  buttons.addEventListener("click", event => {
    const button = event.target instanceof HTMLButtonElement ? event.target : null;
    if (!button) return;
    bindings.setConfigValue("chromaFadeRegion", Number(button.dataset.value));
  });

  return {
    wrapper,
    key: "chromaFadeRegion",
    value,
    sync(config) {
      const highlightMode = config.chromaFadeRegion >= 0.5;
      shadows.classList.toggle("is-active", !highlightMode);
      highlights.classList.toggle("is-active", highlightMode);
      shadows.setAttribute("aria-pressed", highlightMode ? "false" : "true");
      highlights.setAttribute("aria-pressed", highlightMode ? "true" : "false");
      value.textContent = highlightMode ? "High" : "Low";
    }
  };
}

export function bindChromaMapHandles(canvas, bindings) {
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
    const gaugeHitRadius = 9 * dpr;
    let nearest = null;
    let nearestDistance = Infinity;
    const config = bindings.getConfig();
    const yMax = currentYMax(config);
    const plot = plotRect(frame);
    const amountHandle = CHROMA_MAP_HANDLES.find(handle => handle.key === "chromaFadeStrength");

    // The amount rail is a vertical side control, not another luma-position handle.
    // Give it first pass so the bottom A knob cannot be swallowed by the center rail.
    if (amountHandle) {
      const gauge = chromaFadeGaugeGeometry(frame);
      const amountPoint = chromaMapHandlePoint(frame, config, amountHandle, yMax, yMax);
      const knobDistance = Math.hypot(localX - amountPoint.x, localY - amountPoint.y);
      const railDistance = Math.abs(localX - gauge.x);
      const inVerticalRange = localY >= gauge.top - hitRadius && localY <= gauge.bottom + hitRadius;
      if (knobDistance <= hitRadius || (inVerticalRange && railDistance <= gaugeHitRadius)) {
        return amountHandle;
      }
    }

    for (const handle of CHROMA_MAP_HANDLES) {
      if (handle.key === "chromaFadeStrength") continue;
      const point = chromaMapHandlePoint(frame, config, handle, yMax, yMax);
      let distance = Math.hypot(localX - point.x, localY - point.y);
      if (handle.key === "chromaFadeCenter" || handle.key === "chromaFadeSoftness") {
        const railDistance = Math.abs(localX - point.x);
        const inVerticalRange = localY >= plot.y - hitRadius && localY <= plot.y + plot.h + hitRadius;
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
    canvas.classList.toggle("is-over-chroma-fade-rail", handle?.key === "chromaFadeCenter" || handle?.key === "chromaFadeSoftness");
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
      const gauge = chromaFadeGaugeGeometry(frame);
      drag.fadeGaugeTop = rect.top + gauge.top / dpr;
      drag.fadeGaugeHeight = Math.max(1, gauge.height / dpr);
    }
    canvas.setPointerCapture?.(event.pointerId);
    canvas.classList.add("is-dragging-chroma-handle");
    canvas.classList.toggle("is-dragging-chroma-placement", handle.key === "chromaExposure");
    canvas.classList.toggle("is-dragging-chroma-gamma", handle.key === "chromaGamma");
    canvas.classList.toggle("is-dragging-chroma-fade-rail", handle.key === "chromaFadeCenter" || handle.key === "chromaFadeSoftness");
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
    } else if (drag.key === "chromaFadeCenter") {
      bindings.setConfigValue("chromaFadeCenter", chromaFadeCenterValueFromHorizontalPosition(event.clientX, drag.plotLeft, drag.plotWidth));
    } else if (drag.key === "chromaFadeSoftness") {
      bindings.setConfigValue("chromaFadeSoftness", chromaFadeSoftnessFromHorizontalPosition(event.clientX, drag.plotLeft, drag.plotWidth, bindings.getConfig()));
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


const CHROMA_MAP_HANDLES = Object.freeze([
  {key: "chromaExposure", label: "Chroma Placement", symbol: "C", shape: "pin"},
  {key: "chromaGamma", label: "Chroma Gamma", symbol: "γC", shape: "diamond"},
  {key: "chromaFadeCenter", label: "Fade Center", symbol: "C", shape: "rail"},
  {key: "chromaFadeSoftness", label: "Fade Softness", symbol: "S", shape: "rail"},
  {key: "chromaFadeStrength", label: "Fade Amount", symbol: "A", shape: "knob"}
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
  const mask = chromaFadeMaskGeometry(frame);
  const window = chromaFadeWindow(config);
  const lowX = plot.x + clamp01(window.low) * plot.w;
  const highX = plot.x + clamp01(window.high) * plot.w;
  const centerX = plot.x + chromaFadeCenterUnitFromValue(config.chromaFadeCenter) * plot.w;
  const softnessX = plot.x + chromaFadeSoftnessEdgeUnit(config) * plot.w;
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

  ctx.globalAlpha = active ? 0.17 : 0.08 + 0.14 * strength;
  ctx.fillStyle = frame.accent.trim();
  ctx.fillRect(left, mask.y, Math.max(1 * dpr, right - left), mask.h);

  drawChromaFadeMaskCurve(frame, mask, config, {active: Boolean(active)});

  for (const x of [lowX, highX, centerX, softnessX]) {
    ctx.globalAlpha = x === centerX || x === softnessX ? (active ? 0.55 : 0.3) : (active ? 0.38 : 0.16);
    ctx.strokeStyle = frame.accent.trim();
    ctx.setLineDash(x === centerX || x === softnessX ? [] : [2 * dpr, 4 * dpr]);
    line(ctx, x, mask.y, x, mask.y + mask.h);
    ctx.setLineDash([]);
  }

  ctx.globalAlpha = active ? 0.62 : 0.38;
  ctx.fillStyle = frame.text.trim();
  ctx.font = `${7.8 * dpr}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(`${chromaFadeRegionLabel(config.chromaFadeRegion).toUpperCase()} MASK`, plot.x + plot.w - 4 * dpr, mask.y - 7 * dpr);

  const gauge = chromaFadeGaugeGeometry(frame);
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

function drawChromaFadeMaskCurve(frame, mask, config, {active = false} = {}) {
  const {ctx} = frame;
  const dpr = devicePixelRatioSafe();
  const strength = chromaFadeStrengthUnitFromValue(config.chromaFadeStrength);

  ctx.save();
  ctx.globalAlpha = active ? 0.5 : 0.24;
  ctx.strokeStyle = frame.lineStrong.trim();
  ctx.lineWidth = 1 * dpr;
  ctx.strokeRect(mask.x, mask.y, mask.w, mask.h);

  ctx.globalAlpha = active ? 0.88 : 0.52 + 0.22 * strength;
  ctx.strokeStyle = frame.accent.trim();
  ctx.lineWidth = (active ? 1.8 : 1.35) * dpr;
  ctx.beginPath();
  const samples = 80;
  for (let index = 0; index < samples; index += 1) {
    const unit = index / (samples - 1);
    const maskValue = mix(1, chromaFadeMask(unit, config), strength);
    const x = mask.x + unit * mask.w;
    const y = mask.y + (1 - clamp01(maskValue)) * mask.h;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.globalAlpha = active ? 0.55 : 0.32;
  ctx.fillStyle = frame.text.trim();
  ctx.font = `${7.2 * dpr}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textBaseline = "bottom";
  ctx.textAlign = "left";
  ctx.fillText("LUMA", mask.x + 4 * dpr, mask.y + mask.h - 3 * dpr);
  ctx.textAlign = "right";
  ctx.fillText("×C", mask.x + mask.w - 4 * dpr, mask.y + 10 * dpr);
  ctx.restore();
}

function chromaFadeLaneGeometry(frame) {
  const mask = chromaFadeMaskGeometry(frame);
  return {y: mask.y + mask.h - CHROMA_FADE_LANE_BOTTOM_OFFSET * devicePixelRatioSafe() * 0.15};
}

function chromaFadeMaskGeometry(frame) {
  const plot = plotRect(frame);
  const dpr = devicePixelRatioSafe();
  const height = Math.min(CHROMA_FADE_MASK_HEIGHT * dpr, Math.max(24 * dpr, plot.h * 0.42));
  return {x: plot.x, y: plot.y + plot.h - height - 2 * dpr, w: plot.w, h: height};
}

function chromaFadeGaugeGeometry(frame) {
  const plot = plotRect(frame);
  const dpr = devicePixelRatioSafe();
  const mask = chromaFadeMaskGeometry(frame);
  const x = plot.x + plot.w - 10 * dpr;
  const height = Math.min(CHROMA_FADE_GAUGE_HEIGHT * dpr, Math.max(14 * dpr, mask.h - 8 * dpr));
  const bottom = mask.y + mask.h - 4 * dpr;
  return {x, top: bottom - height, bottom, height};
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
  if (handle.key === "chromaFadeCenter") {
    return {
      x: plot.x + chromaFadeCenterUnitFromValue(config.chromaFadeCenter) * plot.w,
      y: lane.y
    };
  }
  if (handle.key === "chromaFadeSoftness") {
    return {
      x: plot.x + chromaFadeSoftnessEdgeUnit(config) * plot.w,
      y: lane.y
    };
  }
  if (handle.key === "chromaFadeStrength") {
    const gauge = chromaFadeGaugeGeometry(frame);
    const unit = chromaFadeStrengthUnitFromValue(config.chromaFadeStrength);
    return {x: gauge.x, y: mix(gauge.bottom, gauge.top, unit)};
  }
  return {x: plot.x, y: plot.y + plot.h};
}

export function computeChromaGraphMetrics(config, handleState = {}) {
  const signature = chromaGraphMetricsSignature(config, handleState);
  const cached = lruGet(chromaGraphMetricsCache, signature);
  if (cached) return cached;

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
  const metrics = {displayMax, p99Chroma, histogram: displayedHistogram};
  return lruSet(chromaGraphMetricsCache, signature, metrics, CHROMA_METRICS_CACHE_LIMIT);
}

function getCachedChromaCurves(canvas, config, yMax) {
  const normalized = normalizeConfig(config);
  const signature = [
    `yMax:${yMax}`,
    ...CHROMA_GRAPH_METRIC_KEYS.map(key => `${key}:${normalized[key]}`)
  ].join("|");
  let cache = chromaCanvasCurveCaches.get(canvas);
  if (!cache) {
    cache = new Map();
    chromaCanvasCurveCaches.set(canvas, cache);
  }
  const cached = lruGet(cache, signature);
  if (cached) return cached;

  const params = chromaCurveParams(normalized);
  const curves = LUMA_REFERENCE_SAMPLES.map(sample => ({
    ...sample,
    points: sampleCurve(x => chromaCurveSampleWithParams(x * yMax, sample.luma, params))
  }));
  const identity = sampleCurve(x => x * yMax);
  const nextCurves = {reference: curves, identity};
  return lruSet(cache, signature, nextCurves, CHROMA_CURVE_CACHE_LIMIT);
}

export function drawChromaPreview(canvas, config, handleState = {}) {
  const frame = beginFrame(canvas);
  if (!frame) return;

  const metrics = computeChromaGraphMetrics(config, handleState);
  const yMax = metrics.displayMax || CHROMA_GRAPH_Y_MAX;
  const curves = getCachedChromaCurves(canvas, config, yMax);

  drawFrame(frame, {yMax, labels: false});
  drawChromaHistogramUnderlay(frame, metrics.histogram);
  drawChromaPercentileIndicator(frame, metrics.p99Chroma, yMax);
  drawCurve(frame, curves.identity, {alpha: 0.22, dash: [2, 3], width: 1, yMax});
  for (const curve of curves.reference) {
    drawCurve(frame, curve.points, {alpha: curve.alpha, dash: curve.dash, width: curve.label === "mid" ? 2 : 1.25, yMax});
  }
  drawChromaLegend(frame, curves.reference);
  drawChromaMapHandles(frame, config, yMax, handleState);
}

// ── Tint preview ─────────────────────────────────────────────────────────────

