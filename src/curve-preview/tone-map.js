import { TONE_MAP_CONTROL_KEYS, normalizeConfig, resetToneMapConfig } from "../config.js";
import { createDockRange } from "./dom-controls.js";
import { beginFrame, drawCurve, drawFrame, drawHistogramUnderlay, frameFromClientRect, line, plotRect, sampleCurve } from "./canvas.js";
import {
  CONTROL_DEFINITIONS,
  EXPOSURE_PLACEMENT_LUMA,
  TONAL_BALANCE_HANDLES,
  clamp,
  clamp01,
  curveStrengthValueFromVerticalDrag,
  devicePixelRatioSafe,
  exposurePlacementInputLuma,
  exposureValueFromHorizontalPosition,
  formatCompact,
  formatSigned,
  gammaValueFromVerticalDrag,
  histogramDensityAtLuma,
  lumaCurveSample,
  lumaToneBaseSample,
  mix,
  sanitizeControlValue,
  tonePivotInputLuma,
  tonePivotNudgeFromSlopeHandleInputLuma,
  tonalBalanceValueFromVerticalDrag,
  transformLumaHistogram
} from "./shared.js";

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
const TONE_SHOULDER_GAUGE_NEUTRAL = 1;
const TONE_SHOULDER_GAUGE_NEUTRAL_UNIT = 0.5;
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
  const shoulder = sanitizeControlValue("toneShoulder", toneShoulder);
  const neutral = clamp(TONE_SHOULDER_GAUGE_NEUTRAL, min, max);
  const neutralUnit = clamp01(TONE_SHOULDER_GAUGE_NEUTRAL_UNIT);
  if (shoulder <= neutral) {
    return neutralUnit * (shoulder - min) / Math.max(1e-9, neutral - min);
  }
  return neutralUnit + (1 - neutralUnit) * (shoulder - neutral) / Math.max(1e-9, max - neutral);
}

export function toneShoulderFromGaugeUnit(unit) {
  const control = CONTROL_DEFINITIONS.get("toneShoulder");
  const min = control?.min ?? 1;
  const max = control?.max ?? 6;
  const neutral = clamp(TONE_SHOULDER_GAUGE_NEUTRAL, min, max);
  const neutralUnit = clamp01(TONE_SHOULDER_GAUGE_NEUTRAL_UNIT);
  const gaugeUnit = clamp01(unit);
  if (gaugeUnit <= neutralUnit) {
    return sanitizeControlValue("toneShoulder", mix(min, neutral, gaugeUnit / Math.max(1e-9, neutralUnit)));
  }
  return sanitizeControlValue("toneShoulder", mix(neutral, max, (gaugeUnit - neutralUnit) / Math.max(1e-9, 1 - neutralUnit)));
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

export function createToneMapControls(canvas, bindings) {
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

  const zoomButton = document.createElement("button");
  zoomButton.type = "button";
  zoomButton.className = "tone-map-action tone-map-zoom";
  zoomButton.textContent = "Zoom";
  zoomButton.setAttribute("aria-pressed", "false");

  actions.append(resetButton, detailsButton, expandButton, zoomButton);
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
    const nextConfig = resetToneMapConfig(normalizeConfig(bindings.getConfig()));
    const patch = Object.fromEntries(TONE_MAP_CONTROL_KEYS.map(key => [key, nextConfig[key]]));
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
    control.input.addEventListener("input", () => bindings.setConfigValue(control.key, control.input.valueAsNumber));
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
    workbench?.classList.toggle("is-tone-map-expanded", state.expanded);
    workbench?.classList.toggle("is-tone-map-zoomed", state.zoomed);
    expandButton.hidden = state.zoomed;
    expandButton.disabled = state.zoomed;
    expandButton.textContent = state.expanded ? "Shrink" : "Expand";
    expandButton.setAttribute("aria-expanded", state.expanded ? "true" : "false");
    expandButton.setAttribute("aria-label", `${state.expanded ? "Shrink" : "Expand"} Tone Map`);
    zoomButton.textContent = state.zoomed ? "Dock" : "Zoom";
    zoomButton.setAttribute("aria-pressed", state.zoomed ? "true" : "false");
    zoomButton.setAttribute("aria-label", `${state.zoomed ? "Dock" : "Zoom"} Tone Map`);
    detailsButton.setAttribute("aria-expanded", state.details ? "true" : "false");
    detailsButton.setAttribute("aria-label", `${state.details ? "Hide" : "Show"} Tone Map details`);
  }

  syncExpansion();
  sync(bindings.getConfig());

  return {
    sync,
    isExpanded: () => state.expanded || state.details || state.zoomed,
    isZoomed: () => state.zoomed,
    setZoomed,
    toggleZoom,
    isDraggingPivot: () => false,
    destroy() {
      document.removeEventListener("curve-preview-zoom-request", handleExternalZoomRequest);
      workbench?.classList.remove("is-tone-map-expanded");
      workbench?.classList.remove("is-tone-map-zoomed");
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


export function bindToneShapeHandles(canvas, bindings) {
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

export function bindTonalBalanceHandles(canvas, bindings) {
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


export function drawLumaPreview(canvas, config, sourceHistogram, handleState = {}) {
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

