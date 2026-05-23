import { TINT_CONTROL_KEYS, normalizeConfig, resetTintConfig } from "../config.js";
import { lookTintFromHueDegrees } from "../color-utils.js";
import { createDockRange } from "./dom-controls.js";
import { beginFrame, drawFrame, frameFromClientRect, line, plotRect } from "./canvas.js";
import { clamp01, devicePixelRatioSafe, formatCompact, mix } from "./shared.js";

export function drawTintPreview(canvas, config, handleState = {}) {
  const frame = beginFrame(canvas);
  if (!frame) return;

  const {ctx} = frame;
  const dpr = devicePixelRatioSafe();
  const plot = plotRect(frame);

  drawFrame(frame, {yMax: 1, labels: false});

  // Hue reference strip along the bottom edge of the plot
  const stripH = Math.max(3 * dpr, Math.round(plot.h * 0.1));
  const hueGrad = ctx.createLinearGradient(plot.x, 0, plot.x + plot.w, 0);
  for (let i = 0; i <= 24; i++) {
    const [r, g, b] = lookTintFromHueDegrees((i / 24) * 360);
    hueGrad.addColorStop(i / 24, `rgb(${Math.round(r * 210)} ${Math.round(g * 210)} ${Math.round(b * 210)})`);
  }
  ctx.save();
  ctx.fillStyle = hueGrad;
  ctx.globalAlpha = 0.5;
  ctx.fillRect(plot.x, plot.y + plot.h - stripH, plot.w, stripH);
  ctx.restore();

  // Handle position in plot coords
  const hueNorm = clamp01(((config.tintHue || 0) % 360) / 360);
  const strength = clamp01(config.tintStrength || 0);
  const hx = plot.x + hueNorm * plot.w;
  const hy = plot.y + (1 - strength) * plot.h;

  // Dashed vertical stem from hue strip to handle
  if (strength > 0.02) {
    ctx.save();
    ctx.strokeStyle = frame.accent.trim();
    ctx.lineWidth = 1 * dpr;
    ctx.globalAlpha = 0.28;
    ctx.setLineDash([3 * dpr, 3 * dpr]);
    line(ctx, hx, plot.y + plot.h - stripH, hx, hy);
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Handle circle — tinted toward the actual hue color
  const [hr, hg, hb] = lookTintFromHueDegrees(config.tintHue);
  const handleAlpha = handleState.activeTintHandle ? 1 : handleState.hoverTintHandle ? 0.95 : strength < 0.02 ? 0.52 : 0.84;

  ctx.save();
  ctx.beginPath();
  ctx.arc(hx, hy, 7 * dpr, 0, Math.PI * 2);
  ctx.fillStyle = `rgb(${Math.round(mix(hr, 0.56, 0.18) * 255)} ${Math.round(mix(hg, 0.71, 0.18) * 255)} ${Math.round(mix(hb, 0.87, 0.18) * 255)})`;
  ctx.globalAlpha = handleAlpha;
  ctx.fill();
  ctx.strokeStyle = handleState.activeTintHandle ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1.5 * dpr;
  ctx.stroke();
  ctx.restore();
}

export function createTintControls(canvas, bindings) {
  const card = canvas.closest?.(".curve-preview-card") || canvas.parentElement;
  if (!card) return {sync() {}, destroy() {}};

  card.classList.add("tint-map-card", "tone-map-card");
  const header = card.querySelector?.(".curve-preview-header");
  const title = header?.querySelector?.("h2");
  if (title) title.textContent = "Tint";

  const actions = document.createElement("div");
  actions.className = "tone-map-actions tint-map-actions";

  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "tone-map-action tint-map-reset";
  resetButton.textContent = "Reset";
  resetButton.setAttribute("aria-label", "Reset Tint");

  const detailsButton = document.createElement("button");
  detailsButton.type = "button";
  detailsButton.className = "tone-map-action";
  detailsButton.textContent = "Details";
  detailsButton.setAttribute("aria-expanded", "false");

  actions.append(resetButton, detailsButton);
  header?.append(actions);

  const readouts = document.createElement("div");
  readouts.className = "tone-map-readouts tint-map-readouts";
  const readoutChips = new Map();
  for (const [key, symbol] of [["tintHue", "H"], ["tintStrength", "S"]]) {
    const chip = document.createElement("span");
    chip.className = "tone-map-chip tint-map-chip";
    chip.dataset.key = key;
    chip.textContent = `${symbol} 0`;
    readouts.append(chip);
    readoutChips.set(key, chip);
  }

  const details = document.createElement("div");
  details.className = "tone-map-details tint-map-details";
  const detailControls = [
    createDockRange("Hue", "tintHue", 0, 360, 0.01),
    createDockRange("Strength", "tintStrength", 0, 1, 0.01)
  ];
  for (const control of detailControls) details.append(control.wrapper);
  card.append(readouts, details);

  const state = {details: false};

  resetButton.addEventListener("click", () => {
    const nextConfig = resetTintConfig(normalizeConfig(bindings.getConfig()));
    const patch = Object.fromEntries(TINT_CONTROL_KEYS.map(key => [key, nextConfig[key]]));
    bindings.setConfigValues?.(patch);
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
    card.classList.toggle("is-details-open", state.details);
    detailsButton.setAttribute("aria-expanded", state.details ? "true" : "false");
    detailsButton.setAttribute("aria-label", `${state.details ? "Hide" : "Show"} Tint details`);
  }

  syncExpansion();
  sync(bindings.getConfig());

  return {
    sync,
    destroy() {
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
    setReadout("tintHue", `H ${Math.round(config.tintHue)}\u00b0`);
    setReadout("tintStrength", `S ${formatCompact(config.tintStrength)}`);
  }

  function setReadout(key, text) {
    const chip = readoutChips.get(key);
    if (chip) chip.textContent = text;
  }
}

export function bindTintHandles(canvas, bindings) {
  let drag = null;

  function tintHandlePoint(frame) {
    const plot = plotRect(frame);
    const config = bindings.getConfig();
    const hueNorm = clamp01(((config.tintHue || 0) % 360) / 360);
    const strength = clamp01(config.tintStrength || 0);
    // DPR-scaled coords matching frameFromClientRect space
    return {
      x: plot.x + hueNorm * plot.w,
      y: plot.y + (1 - strength) * plot.h
    };
  }

  function nearHandle(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const frame = frameFromClientRect(canvas, rect);
    if (!frame) return false;
    const dpr = devicePixelRatioSafe();
    const localX = (clientX - rect.left) * dpr;
    const localY = (clientY - rect.top) * dpr;
    const pt = tintHandlePoint(frame);
    return Math.hypot(localX - pt.x, localY - pt.y) <= 14 * dpr;
  }

  function updateConfigFromPointer(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const frame = frameFromClientRect(canvas, rect);
    if (!frame) return;
    const dpr = devicePixelRatioSafe();
    const plot = plotRect(frame);
    const localX = (clientX - rect.left) * dpr;
    const localY = (clientY - rect.top) * dpr;
    const hueNorm = clamp01((localX - plot.x) / Math.max(plot.w, 1));
    const strengthNorm = clamp01(1 - (localY - plot.y) / Math.max(plot.h, 1));
    bindings.setConfigValues({tintHue: hueNorm * 360, tintStrength: strengthNorm});
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    if (!nearHandle(event.clientX, event.clientY)) return;
    event.preventDefault();
    drag = {pointerId: event.pointerId};
    canvas.setPointerCapture?.(event.pointerId);
    bindings.setActiveHandle({key: "tint"});
    updateConfigFromPointer(event.clientX, event.clientY);
  }

  function onPointerMove(event) {
    if (drag && drag.pointerId === event.pointerId) {
      event.preventDefault();
      updateConfigFromPointer(event.clientX, event.clientY);
      return;
    }
    bindings.setHoverKey(nearHandle(event.clientX, event.clientY) ? "tint" : null);
  }

  function onPointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    bindings.setActiveHandle(null);
    bindings.setHoverKey(nearHandle(event.clientX, event.clientY) ? "tint" : null);
  }

  function onPointerLeave() {
    if (!drag) bindings.setHoverKey(null);
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);

  return function unbind() {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("pointerleave", onPointerLeave);
  };
}
