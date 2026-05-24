import { HUE_WINDOW_CONTROL_KEYS, resetHueWindowConfig } from "../config.js";
import { lookTintFromHueDegrees, normalizeHueDegrees } from "../color-utils.js";
import { createDockRange } from "./dom-controls.js";
import { beginFrame, drawFrame, frameFromClientRect, line, plotRect } from "./canvas.js";
import { clamp, clamp01, configScalar, devicePixelRatioSafe, formatCompact, formatSigned, mix } from "./shared.js";

const HUE_WINDOW_HANDLE_KEY = "hueWindowHandle";
const HUE_WINDOW_CURVE_SAMPLES = 144;

export function hueWindowMaskForHue(hueDegrees, rawConfig = {}) {
  const center = normalizeHueDegrees(configScalar(rawConfig, "hueWindowCenter"));
  const width = Math.max(configScalar(rawConfig, "hueWindowWidth") || 0, 0);
  const softness = clamp01(configScalar(rawConfig, "hueWindowSoftness") || 0);
  const coreHalf = width * 0.5;
  const feather = Math.max(0.25, coreHalf * softness);
  const distance = hueDistanceDegrees(hueDegrees, center);
  return 1 - smoothstep(coreHalf, coreHalf + feather, distance);
}

export function hueWindowChromaScaleForHue(hueDegrees, rawConfig = {}) {
  return Math.max(0, 1 + configScalar(rawConfig, "hueWindowChroma") * hueWindowMaskForHue(hueDegrees, rawConfig));
}

export function hueWindowCenterFromHorizontalPosition(clientX, left, width) {
  const unit = width > 0 ? clamp01((clientX - left) / width) : 0;
  return sanitizeHueWindowValue("hueWindowCenter", unit * 360);
}

export function hueWindowChromaFromVerticalPosition(clientY, top, height) {
  const unit = height > 0 ? clamp01((clientY - top) / height) : 0.5;
  return sanitizeHueWindowValue("hueWindowChroma", 1 - unit * 2);
}

export function drawHueWindowPreview(canvas, config, handleState = {}) {
  const frame = beginFrame(canvas);
  if (!frame) return;

  const normalized = config || {};
  const activeKey = typeof handleState.activeHueWindowHandle === "string" ? handleState.activeHueWindowHandle : handleState.activeHueWindowHandle?.key || null;
  const hoverKey = handleState.hoverHueWindowHandle || null;

  drawFrame(frame, {yMax: 1, labels: false});
  drawHueBackdrop(frame);
  drawHueWindowBand(frame, normalized);
  drawHueWindowCurve(frame, normalized);
  drawHueWindowHandle(frame, normalized, {
    active: activeKey === HUE_WINDOW_HANDLE_KEY,
    hover: hoverKey === HUE_WINDOW_HANDLE_KEY
  });
}

export function createHueWindowControls(canvas, bindings) {
  const card = canvas.closest?.(".curve-preview-card") || canvas.parentElement;
  if (!card) return {sync() {}, destroy() {}};

  card.classList.add("hue-window-card");
  const header = card.querySelector?.(".curve-preview-header");
  const title = header?.querySelector?.("h2");
  if (title) title.textContent = "Hue Window";

  const actions = document.createElement("div");
  actions.className = "tone-map-actions hue-window-actions";

  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "tone-map-action hue-window-reset";
  resetButton.textContent = "Reset";
  resetButton.setAttribute("aria-label", "Reset Hue Window");
  actions.append(resetButton);
  header?.append(actions);

  const readouts = document.createElement("div");
  readouts.className = "tone-map-readouts hue-window-readouts";
  const readoutChips = new Map();
  for (const [key, label] of [
    ["hueWindowCenter", "H"],
    ["hueWindowChroma", "C"],
    ["hueWindowWidth", "W"],
    ["hueWindowSoftness", "S"]
  ]) {
    const chip = document.createElement("span");
    chip.className = "tone-map-chip hue-window-chip";
    chip.dataset.key = key;
    chip.textContent = `${label} 0`;
    readouts.append(chip);
    readoutChips.set(key, chip);
  }

  const sidecar = document.createElement("div");
  sidecar.className = "hue-window-sidecar";
  const widthControl = createDockRange("Width", "hueWindowWidth", 1, 300, 0.5);
  const softnessControl = createDockRange("Soft", "hueWindowSoftness", 0, 1, 0.01);
  sidecar.append(widthControl.wrapper, softnessControl.wrapper);
  card.append(readouts, sidecar);

  resetButton.addEventListener("click", () => {
    const nextConfig = resetHueWindowConfig({...bindings.getConfig()});
    const patch = Object.fromEntries(HUE_WINDOW_CONTROL_KEYS.map(key => [key, nextConfig[key]]));
    bindings.setConfigValues?.(patch);
  });

  widthControl.input.addEventListener("input", () => bindings.setConfigValue(widthControl.key, widthControl.input.valueAsNumber));
  softnessControl.input.addEventListener("input", () => bindings.setConfigValue(softnessControl.key, softnessControl.input.valueAsNumber));

  sync(bindings.getConfig());

  return {
    sync,
    setHueWindowHandleValue(center, chroma) {
      bindings.setConfigValues?.({
        hueWindowCenter: sanitizeHueWindowValue("hueWindowCenter", center),
        hueWindowChroma: sanitizeHueWindowValue("hueWindowChroma", chroma)
      });
    },
    destroy() {
      actions.remove();
      readouts.remove();
      sidecar.remove();
    }
  };

  function sync(nextConfig) {
    const config = nextConfig || {};
    widthControl.input.value = String(config.hueWindowWidth);
    widthControl.value.textContent = `${Math.round(config.hueWindowWidth)}°`;
    softnessControl.input.value = String(config.hueWindowSoftness);
    softnessControl.value.textContent = formatCompact(config.hueWindowSoftness);

    setReadout("hueWindowCenter", `H ${Math.round(config.hueWindowCenter)}°`);
    setReadout("hueWindowChroma", `C ${formatSigned(config.hueWindowChroma)}`);
    setReadout("hueWindowWidth", `W ${Math.round(config.hueWindowWidth)}°`);
    setReadout("hueWindowSoftness", `S ${formatCompact(config.hueWindowSoftness)}`);
    card.classList.toggle("is-hue-window-active", Math.abs(config.hueWindowChroma) > 0.001);
  }

  function setReadout(key, text) {
    const chip = readoutChips.get(key);
    if (chip) chip.textContent = text;
  }
}

export function bindHueWindowHandles(canvas, bindings) {
  let drag = null;

  function updateConfigFromPointer(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const frame = frameFromClientRect(canvas, rect);
    if (!frame) return;
    const dpr = devicePixelRatioSafe();
    const plot = plotRect(frame);
    const left = rect.left + plot.x / dpr;
    const top = rect.top + plot.y / dpr;
    const width = plot.w / dpr;
    const height = plot.h / dpr;
    const center = hueWindowCenterFromHorizontalPosition(clientX, left, width);
    const chroma = hueWindowChromaFromVerticalPosition(clientY, top, height);
    if (typeof bindings.setHueWindowHandleValue === "function") {
      bindings.setHueWindowHandleValue(center, chroma);
      return;
    }
    bindings.setConfigValues?.({hueWindowCenter: center, hueWindowChroma: chroma});
  }

  function isInPlot(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const frame = frameFromClientRect(canvas, rect);
    if (!frame) return false;
    const dpr = devicePixelRatioSafe();
    const plot = plotRect(frame);
    const localX = (clientX - rect.left) * dpr;
    const localY = (clientY - rect.top) * dpr;
    return localX >= plot.x && localX <= plot.x + plot.w && localY >= plot.y && localY <= plot.y + plot.h;
  }

  function isNearHandle(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const frame = frameFromClientRect(canvas, rect);
    if (!frame) return false;
    const dpr = devicePixelRatioSafe();
    const localX = (clientX - rect.left) * dpr;
    const localY = (clientY - rect.top) * dpr;
    const point = hueWindowHandlePoint(frame, bindings.getConfig());
    return Math.hypot(localX - point.x, localY - point.y) <= 16 * dpr;
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    if (!isInPlot(event.clientX, event.clientY)) return;
    event.preventDefault();
    drag = {pointerId: event.pointerId};
    canvas.setPointerCapture?.(event.pointerId);
    canvas.classList.add("is-dragging-hue-window-handle");
    bindings.setActiveHandle?.({key: HUE_WINDOW_HANDLE_KEY});
    updateConfigFromPointer(event.clientX, event.clientY);
  }

  function onPointerMove(event) {
    if (drag && drag.pointerId === event.pointerId) {
      event.preventDefault();
      updateConfigFromPointer(event.clientX, event.clientY);
      return;
    }
    const hover = isNearHandle(event.clientX, event.clientY) || isInPlot(event.clientX, event.clientY);
    canvas.classList.toggle("is-over-hue-window-handle", hover);
    bindings.setHoverKey?.(hover ? HUE_WINDOW_HANDLE_KEY : null);
  }

  function onPointerUp(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag = null;
    canvas.classList.remove("is-dragging-hue-window-handle");
    bindings.setActiveHandle?.(null);
    const hover = isNearHandle(event.clientX, event.clientY) || isInPlot(event.clientX, event.clientY);
    canvas.classList.toggle("is-over-hue-window-handle", hover);
    bindings.setHoverKey?.(hover ? HUE_WINDOW_HANDLE_KEY : null);
  }

  function onPointerLeave() {
    if (!drag) {
      canvas.classList.remove("is-over-hue-window-handle");
      bindings.setHoverKey?.(null);
    }
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

function drawHueBackdrop(frame) {
  const {ctx} = frame;
  const plot = plotRect(frame);
  const grad = ctx.createLinearGradient(plot.x, 0, plot.x + plot.w, 0);
  for (let i = 0; i <= 36; i += 1) {
    const [r, g, b] = lookTintFromHueDegrees((i / 36) * 360);
    grad.addColorStop(i / 36, `rgb(${Math.round(r * 210)} ${Math.round(g * 210)} ${Math.round(b * 210)})`);
  }
  ctx.save();
  ctx.fillStyle = grad;
  ctx.globalAlpha = 0.18;
  ctx.fillRect(plot.x, plot.y, plot.w, plot.h);
  ctx.restore();
}

function drawHueWindowBand(frame, config) {
  const {ctx} = frame;
  const plot = plotRect(frame);
  const dpr = devicePixelRatioSafe();
  const centerUnit = clamp01(config.hueWindowCenter / 360);
  const coreHalfUnit = Math.max(0, config.hueWindowWidth / 360 / 2);
  const softHalfUnit = coreHalfUnit * (1 + clamp01(config.hueWindowSoftness || 0));

  ctx.save();
  for (const offset of [-1, 0, 1]) {
    fillWrappedSpan(ctx, plot, centerUnit + offset - softHalfUnit, centerUnit + offset + softHalfUnit, "rgba(143,180,223,0.09)");
    fillWrappedSpan(ctx, plot, centerUnit + offset - coreHalfUnit, centerUnit + offset + coreHalfUnit, "rgba(143,180,223,0.18)");
  }

  ctx.strokeStyle = frame.accent.trim();
  ctx.lineWidth = 1 * dpr;
  for (const offset of [-1, 0, 1]) {
    const centerX = plot.x + (centerUnit + offset) * plot.w;
    if (centerX >= plot.x - 1 && centerX <= plot.x + plot.w + 1) {
      ctx.globalAlpha = 0.38;
      line(ctx, centerX, plot.y, centerX, plot.y + plot.h);
    }
    for (const unit of [centerUnit + offset - coreHalfUnit, centerUnit + offset + coreHalfUnit]) {
      const x = plot.x + unit * plot.w;
      if (x >= plot.x - 1 && x <= plot.x + plot.w + 1) {
        ctx.globalAlpha = 0.26;
        line(ctx, x, plot.y, x, plot.y + plot.h);
      }
    }
  }
  ctx.restore();
}

function fillWrappedSpan(ctx, plot, unitLow, unitHigh, fillStyle) {
  const lo = Math.max(0, unitLow);
  const hi = Math.min(1, unitHigh);
  if (hi <= lo) return;
  ctx.fillStyle = fillStyle;
  ctx.fillRect(plot.x + lo * plot.w, plot.y, (hi - lo) * plot.w, plot.h);
}

function drawHueWindowCurve(frame, config) {
  const {ctx} = frame;
  const plot = plotRect(frame);
  const dpr = devicePixelRatioSafe();
  const midY = plot.y + plot.h * 0.5;
  const amp = plot.h * 0.44;

  ctx.save();
  ctx.strokeStyle = frame.lineStrong.trim();
  ctx.lineWidth = 1 * dpr;
  ctx.globalAlpha = 0.55;
  line(ctx, plot.x, midY, plot.x + plot.w, midY);

  ctx.strokeStyle = frame.accent.trim();
  ctx.lineWidth = 2 * dpr;
  ctx.globalAlpha = Math.abs(config.hueWindowChroma) > 0.001 ? 0.86 : 0.48;
  ctx.beginPath();
  for (let i = 0; i < HUE_WINDOW_CURVE_SAMPLES; i += 1) {
    const unit = i / (HUE_WINDOW_CURVE_SAMPLES - 1);
    const mask = hueWindowMaskForHue(unit * 360, config);
    const x = plot.x + unit * plot.w;
    const y = midY - config.hueWindowChroma * mask * amp;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawHueWindowHandle(frame, config, {active, hover}) {
  const {ctx} = frame;
  const dpr = devicePixelRatioSafe();
  const point = hueWindowHandlePoint(frame, config);
  const [hr, hg, hb] = lookTintFromHueDegrees(config.hueWindowCenter);
  const alpha = active ? 1 : hover ? 0.95 : Math.abs(config.hueWindowChroma) > 0.001 ? 0.86 : 0.62;

  ctx.save();
  ctx.beginPath();
  ctx.arc(point.x, point.y, 8 * dpr, 0, Math.PI * 2);
  ctx.fillStyle = `rgb(${Math.round(mix(hr, 0.56, 0.18) * 255)} ${Math.round(mix(hg, 0.71, 0.18) * 255)} ${Math.round(mix(hb, 0.87, 0.18) * 255)})`;
  ctx.globalAlpha = alpha;
  ctx.fill();
  ctx.strokeStyle = active ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.55)";
  ctx.lineWidth = (active ? 2 : 1.5) * dpr;
  ctx.stroke();
  ctx.fillStyle = "rgba(3,5,7,0.78)";
  ctx.font = `${8.5 * dpr}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("H", point.x, point.y + 0.35 * dpr);
  ctx.restore();
}

function hueWindowHandlePoint(frame, rawConfig = {}) {
  const plot = plotRect(frame);
  return {
    x: plot.x + clamp01(configScalar(rawConfig, "hueWindowCenter") / 360) * plot.w,
    y: plot.y + (1 - (configScalar(rawConfig, "hueWindowChroma") + 1) / 2) * plot.h
  };
}

function hueDistanceDegrees(a, b) {
  const delta = Math.abs(normalizeHueDegrees(a) - normalizeHueDegrees(b));
  return Math.min(delta, 360 - delta);
}

function smoothstep(edge0, edge1, value) {
  if (edge1 <= edge0) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function sanitizeHueWindowValue(key, value) {
  if (key === "hueWindowCenter") return clamp(Number.isFinite(value) ? value : 0, 0, 360);
  if (key === "hueWindowChroma") return clamp(Number.isFinite(value) ? value : 0, -1, 1);
  if (key === "hueWindowWidth") return clamp(Number.isFinite(value) ? value : 50, 1, 180);
  if (key === "hueWindowSoftness") return clamp01(Number.isFinite(value) ? value : 0.45);
  return value;
}
