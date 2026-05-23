import { TINT_CONTROL_KEYS, normalizeConfig, resetTintConfig } from "../config.js";
import { hueDeltaDegrees, lookTintFromHueDegrees, normalizeHueDegrees } from "../color-utils.js";
import { createDockRange } from "./dom-controls.js";
import { beginFrame, drawFrame, frameFromClientRect, line, plotRect } from "./canvas.js";
import { clamp01, devicePixelRatioSafe, formatCompact, mix } from "./shared.js";

const TINT_ROTATION_DEFAULT = 180;
const TINT_HANDLE_KEYS = Object.freeze(["tintLowHue", "tintHighHue"]);
const TINT_LINK_CONTROL_KEY = "tintLinkControl";

export function drawTintPreview(canvas, config, handleState = {}) {
  const frame = beginFrame(canvas);
  if (!frame) return;

  const {ctx} = frame;
  const dpr = devicePixelRatioSafe();
  const plot = plotRect(frame);
  const activeKey = typeof handleState.activeTintHandle === "string" ? handleState.activeTintHandle : handleState.activeTintHandle?.key || null;
  const hoverKey = handleState.hoverTintHandle || null;
  const tintLinked = handleState.tintLinked !== false;
  const normalized = normalizeConfig(config);

  drawFrame(frame, {yMax: 1, labels: false});

  // Hue reference strip along the bottom edge of the plot.
  const stripH = Math.max(3 * dpr, Math.round(plot.h * 0.1));
  const hueGrad = ctx.createLinearGradient(plot.x, 0, plot.x + plot.w, 0);
  for (let i = 0; i <= 24; i += 1) {
    const [r, g, b] = lookTintFromHueDegrees((i / 24) * 360);
    hueGrad.addColorStop(i / 24, `rgb(${Math.round(r * 210)} ${Math.round(g * 210)} ${Math.round(b * 210)})`);
  }
  ctx.save();
  ctx.fillStyle = hueGrad;
  ctx.globalAlpha = 0.5;
  ctx.fillRect(plot.x, plot.y + plot.h - stripH, plot.w, stripH);
  ctx.restore();

  const strength = clamp01(normalized.tintStrength || 0);
  const handleY = plot.y + (1 - strength) * plot.h;

  ctx.save();
  ctx.strokeStyle = frame.accent.trim();
  ctx.lineWidth = 1 * dpr;
  ctx.globalAlpha = strength < 0.02 ? 0.16 : 0.28;
  ctx.setLineDash([4 * dpr, 4 * dpr]);
  line(ctx, plot.x, handleY, plot.x + plot.w, handleY);
  ctx.setLineDash([]);
  ctx.restore();

  const handles = tintHandles(normalized);
  for (const handle of handles) {
    const hx = hueToX(handle.hue, plot);
    if (strength > 0.02) {
      ctx.save();
      ctx.strokeStyle = frame.accent.trim();
      ctx.lineWidth = 1 * dpr;
      ctx.globalAlpha = 0.24;
      ctx.setLineDash([3 * dpr, 3 * dpr]);
      line(ctx, hx, plot.y + plot.h - stripH, hx, handleY);
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // Draw low first, high second, so H stays reachable when both hues overlap.
  for (const handle of handles) {
    drawTintHandle(frame, {
      ...handle,
      x: hueToX(handle.hue, plot),
      y: handleY,
      active: activeKey === handle.key,
      hover: hoverKey === handle.key,
      dormant: strength < 0.02
    });
  }

  drawTintLinkControl(frame, normalized, {
    linked: tintLinked,
    active: activeKey === TINT_LINK_CONTROL_KEY,
    hover: hoverKey === TINT_LINK_CONTROL_KEY,
    dormant: strength < 0.02
  });
}

export function createTintControls(canvas, bindings) {
  const card = canvas.closest?.(".curve-preview-card") || canvas.parentElement;
  if (!card) return {sync() {}, destroy() {}};

  card.classList.add("tint-map-card", "tone-map-card");
  const header = card.querySelector?.(".curve-preview-header");
  const title = header?.querySelector?.("h2");
  if (title) title.textContent = "Tint";

  const initialConfig = normalizeConfig(bindings.getConfig());
  const state = {
    details: false,
    linked: isApproximatelyOpposed(initialConfig),
    rotation: hueDeltaDegrees(initialConfig.tintHighHue, initialConfig.tintLowHue) || TINT_ROTATION_DEFAULT
  };

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
  for (const [key, symbol] of [
    ["tintHighHue", "H"],
    ["tintLowHue", "L"],
    ["tintRotation", "R"],
    ["tintStrength", "S"],
    ["tintAxisCenter", "C"]
  ]) {
    const chip = document.createElement("span");
    chip.className = "tone-map-chip tint-map-chip";
    chip.dataset.key = key;
    chip.textContent = `${symbol} 0`;
    readouts.append(chip);
    readoutChips.set(key, chip);
  }

  const details = document.createElement("div");
  details.className = "tone-map-details tint-map-details";
  const highControl = createDockRange("High Hue", "tintHighHue", 0, 360, 0.01);
  const lowControl = createDockRange("Low Hue", "tintLowHue", 0, 360, 0.01);
  const rotationControl = createDockRange("Rotation", "tintRotation", 0, 360, 0.01);
  const strengthControl = createDockRange("Strength", "tintStrength", 0, 1, 0.01);
  const crossoverControl = createDockRange("Crossover", "tintAxisCenter", -6, 0, 0.01);
  const detailControls = [highControl, lowControl, rotationControl, strengthControl, crossoverControl];

  const linkRow = document.createElement("div");
  linkRow.className = "tint-link-row";

  const linkButton = document.createElement("button");
  linkButton.type = "button";
  linkButton.className = "tone-map-action tint-link-toggle";
  linkButton.setAttribute("aria-pressed", state.linked ? "true" : "false");

  const snapButton = document.createElement("button");
  snapButton.type = "button";
  snapButton.className = "tone-map-action tint-snap-opposite";
  snapButton.textContent = "Snap 180°";

  linkRow.append(linkButton, snapButton);
  for (const control of detailControls) details.append(control.wrapper);
  details.append(linkRow);
  card.append(readouts, details);

  resetButton.addEventListener("click", () => {
    state.linked = true;
    state.rotation = TINT_ROTATION_DEFAULT;
    const nextConfig = resetTintConfig(normalizeConfig(bindings.getConfig()));
    const patch = Object.fromEntries(TINT_CONTROL_KEYS.map(key => [key, nextConfig[key]]));
    bindings.setConfigValues?.(patch);
  });

  detailsButton.addEventListener("click", () => {
    state.details = !state.details;
    syncExpansion();
    bindings.requestRender?.();
  });

  highControl.input.addEventListener("input", () => setHue("tintHighHue", highControl.input.valueAsNumber));
  lowControl.input.addEventListener("input", () => setHue("tintLowHue", lowControl.input.valueAsNumber));
  rotationControl.input.addEventListener("input", () => setRotation(rotationControl.input.valueAsNumber));
  strengthControl.input.addEventListener("input", () => bindings.setConfigValue(strengthControl.key, strengthControl.input.valueAsNumber));
  crossoverControl.input.addEventListener("input", () => bindings.setConfigValue(crossoverControl.key, crossoverControl.input.valueAsNumber));

  linkButton.addEventListener("click", toggleLinked);

  snapButton.addEventListener("click", () => {
    const config = normalizeConfig(bindings.getConfig());
    state.linked = true;
    state.rotation = TINT_ROTATION_DEFAULT;
    bindings.setConfigValues?.({
      tintLowHue: normalizeHueDegrees(config.tintHighHue + TINT_ROTATION_DEFAULT)
    });
  });

  syncExpansion();
  sync(bindings.getConfig());

  return {
    sync,
    setTintHandleValue(key, hue, strength) {
      setHue(key, hue, {tintStrength: strength});
    },
    isLinked() {
      return state.linked;
    },
    toggleLinked() {
      toggleLinked();
    },
    destroy() {
      actions.remove();
      readouts.remove();
      details.remove();
    }
  };

  function toggleLinked() {
    state.linked = !state.linked;
    state.rotation = currentRotation();
    sync(bindings.getConfig());
    bindings.requestRender?.();
  }

  function setHue(key, value, extraPatch = {}) {
    const hue = normalizeHueDegrees(value);
    const patch = {...extraPatch, [key]: hue};
    if (state.linked) {
      if (key === "tintHighHue") {
        patch.tintLowHue = normalizeHueDegrees(hue + state.rotation);
      } else {
        patch.tintHighHue = normalizeHueDegrees(hue - state.rotation);
      }
    }
    bindings.setConfigValues?.(patch);
  }

  function setRotation(value) {
    state.rotation = normalizeHueDegrees(value);
    const config = normalizeConfig(bindings.getConfig());
    bindings.setConfigValues?.({
      tintLowHue: normalizeHueDegrees(config.tintHighHue + state.rotation)
    });
  }

  function currentRotation() {
    const config = normalizeConfig(bindings.getConfig());
    return hueDeltaDegrees(config.tintHighHue, config.tintLowHue);
  }

  function syncExpansion() {
    card.classList.toggle("is-details-open", state.details);
    detailsButton.setAttribute("aria-expanded", state.details ? "true" : "false");
    detailsButton.setAttribute("aria-label", `${state.details ? "Hide" : "Show"} Tint details`);
  }

  function sync(nextConfig) {
    const config = normalizeConfig(nextConfig);
    state.rotation = currentRotationFromConfig(config);

    for (const control of [highControl, lowControl, strengthControl, crossoverControl]) {
      control.input.value = String(config[control.key]);
      control.value.textContent = formatControlValue(control.key, config[control.key]);
    }
    rotationControl.input.value = String(state.rotation);
    rotationControl.value.textContent = `${Math.round(state.rotation)}°`;

    setReadout("tintHighHue", `H ${Math.round(config.tintHighHue)}°`);
    setReadout("tintLowHue", `L ${Math.round(config.tintLowHue)}°`);
    setReadout("tintRotation", `R ${Math.round(state.rotation)}°`);
    setReadout("tintStrength", `S ${formatCompact(config.tintStrength)}`);
    setReadout("tintAxisCenter", `C ${formatCompact(config.tintAxisCenter)}`);
    syncLinkState();
  }

  function syncLinkState() {
    linkButton.textContent = state.linked ? "Linked" : "Free";
    linkButton.setAttribute("aria-pressed", state.linked ? "true" : "false");
    linkButton.setAttribute("aria-label", state.linked ? "Unlink low and high tint hues" : "Link low and high tint hues");
    card.classList.toggle("is-tint-linked", state.linked);
  }

  function setReadout(key, text) {
    const chip = readoutChips.get(key);
    if (chip) chip.textContent = text;
  }
}

export function bindTintHandles(canvas, bindings) {
  let drag = null;

  function tintHandlePoint(frame, key) {
    const plot = plotRect(frame);
    const config = normalizeConfig(bindings.getConfig());
    const hue = key === "tintLowHue" ? config.tintLowHue : config.tintHighHue;
    const strength = clamp01(config.tintStrength || 0);
    return {
      x: hueToX(hue, plot),
      y: plot.y + (1 - strength) * plot.h
    };
  }

  function nearestHandle(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const frame = frameFromClientRect(canvas, rect);
    if (!frame) return null;
    const dpr = devicePixelRatioSafe();
    const localX = (clientX - rect.left) * dpr;
    const localY = (clientY - rect.top) * dpr;
    let nearest = null;
    for (const key of TINT_HANDLE_KEYS) {
      const pt = tintHandlePoint(frame, key);
      const distance = Math.hypot(localX - pt.x, localY - pt.y);
      if (distance <= 14 * dpr && (!nearest || distance < nearest.distance)) {
        nearest = {key, distance};
      }
    }
    return nearest?.key || null;
  }

  function updateConfigFromPointer(clientX, clientY, key) {
    const rect = canvas.getBoundingClientRect();
    const frame = frameFromClientRect(canvas, rect);
    if (!frame) return;
    const dpr = devicePixelRatioSafe();
    const plot = plotRect(frame);
    const localX = (clientX - rect.left) * dpr;
    const localY = (clientY - rect.top) * dpr;
    const hueNorm = clamp01((localX - plot.x) / Math.max(plot.w, 1));
    const strengthNorm = clamp01(1 - (localY - plot.y) / Math.max(plot.h, 1));
    if (typeof bindings.setTintHandleValue === "function") {
      bindings.setTintHandleValue(key, hueNorm * 360, strengthNorm);
      return;
    }
    bindings.setConfigValues({[key]: hueNorm * 360, tintStrength: strengthNorm});
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    const linkKey = nearestLinkControl(event.clientX, event.clientY);
    if (linkKey) {
      event.preventDefault();
      bindings.setActiveHandle({key: TINT_LINK_CONTROL_KEY});
      bindings.toggleTintLink?.();
      bindings.setActiveHandle(null);
      bindings.setHoverKey(TINT_LINK_CONTROL_KEY);
      return;
    }
    const key = nearestHandle(event.clientX, event.clientY);
    if (!key) return;
    event.preventDefault();
    drag = {pointerId: event.pointerId, key};
    canvas.setPointerCapture?.(event.pointerId);
    canvas.classList.add("is-dragging-tint-handle");
    bindings.setActiveHandle({key});
    updateConfigFromPointer(event.clientX, event.clientY, key);
  }

  function onPointerMove(event) {
    if (drag && drag.pointerId === event.pointerId) {
      event.preventDefault();
      updateConfigFromPointer(event.clientX, event.clientY, drag.key);
      return;
    }
    const key = nearestLinkControl(event.clientX, event.clientY) || nearestHandle(event.clientX, event.clientY);
    canvas.classList.toggle("is-over-tint-handle", !!key);
    canvas.classList.toggle("is-over-tint-link", key === TINT_LINK_CONTROL_KEY);
    bindings.setHoverKey(key);
  }

  function onPointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    canvas.classList.remove("is-dragging-tint-handle");
    bindings.setActiveHandle(null);
    const key = nearestLinkControl(event.clientX, event.clientY) || nearestHandle(event.clientX, event.clientY);
    canvas.classList.toggle("is-over-tint-handle", !!key);
    canvas.classList.toggle("is-over-tint-link", key === TINT_LINK_CONTROL_KEY);
    bindings.setHoverKey(key);
  }

  function onPointerLeave() {
    if (!drag) {
      canvas.classList.remove("is-over-tint-handle", "is-over-tint-link");
      bindings.setHoverKey(null);
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

  function nearestLinkControl(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const frame = frameFromClientRect(canvas, rect);
    if (!frame) return null;
    const dpr = devicePixelRatioSafe();
    const localX = (clientX - rect.left) * dpr;
    const localY = (clientY - rect.top) * dpr;
    const box = tintLinkControlBox(frame, normalizeConfig(bindings.getConfig()));
    const pad = 4 * dpr;
    return localX >= box.x - pad && localX <= box.x + box.w + pad && localY >= box.y - pad && localY <= box.y + box.h + pad
      ? TINT_LINK_CONTROL_KEY
      : null;
  }
}

function tintHandles(config) {
  return [
    {key: "tintLowHue", label: "L", hue: config.tintLowHue},
    {key: "tintHighHue", label: "H", hue: config.tintHighHue}
  ];
}

function drawTintHandle(frame, {label, hue, x, y, active, hover, dormant}) {
  const {ctx} = frame;
  const dpr = devicePixelRatioSafe();
  const [hr, hg, hb] = lookTintFromHueDegrees(hue);
  const handleAlpha = active ? 1 : hover ? 0.95 : dormant ? 0.54 : 0.86;

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 8 * dpr, 0, Math.PI * 2);
  ctx.fillStyle = `rgb(${Math.round(mix(hr, 0.56, 0.18) * 255)} ${Math.round(mix(hg, 0.71, 0.18) * 255)} ${Math.round(mix(hb, 0.87, 0.18) * 255)})`;
  ctx.globalAlpha = handleAlpha;
  ctx.fill();
  ctx.strokeStyle = active ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.55)";
  ctx.lineWidth = (active ? 2 : 1.5) * dpr;
  ctx.stroke();
  ctx.globalAlpha = handleAlpha;
  ctx.fillStyle = "rgba(3,5,7,0.78)";
  ctx.font = `${8.5 * dpr}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, y + 0.35 * dpr);
  ctx.restore();
}

function drawTintLinkControl(frame, config, {linked, active, hover, dormant}) {
  const {ctx} = frame;
  const dpr = devicePixelRatioSafe();
  const box = tintLinkControlBox(frame, config);
  const plot = plotRect(frame);
  const highX = hueToX(config.tintHighHue, plot);
  const highY = plot.y + (1 - clamp01(config.tintStrength || 0)) * plot.h;
  const alpha = active ? 1 : hover ? 0.95 : dormant ? 0.58 : 0.82;

  ctx.save();
  ctx.globalAlpha = Math.min(alpha, 0.7);
  ctx.strokeStyle = frame.accent.trim();
  ctx.lineWidth = 1 * dpr;
  line(ctx, highX + Math.sign(box.x - highX) * 7 * dpr, highY, box.x + box.w / 2, box.y + box.h / 2);
  ctx.restore();

  ctx.save();
  roundedRectPath(ctx, box.x, box.y, box.w, box.h, 4 * dpr);
  ctx.fillStyle = linked ? "rgba(143,180,223,0.34)" : "rgba(18,23,30,0.88)";
  ctx.globalAlpha = alpha;
  ctx.fill();
  ctx.strokeStyle = linked ? "rgba(255,255,255,0.78)" : "rgba(184,196,214,0.48)";
  ctx.lineWidth = (active ? 1.6 : 1) * dpr;
  ctx.stroke();
  drawLockGlyph(ctx, box, {linked, dpr});
  ctx.restore();
}

function tintLinkControlBox(frame, config) {
  const dpr = devicePixelRatioSafe();
  const plot = plotRect(frame);
  const x = hueToX(config.tintHighHue, plot);
  const y = plot.y + (1 - clamp01(config.tintStrength || 0)) * plot.h;
  const size = 15 * dpr;
  const gap = 9 * dpr;
  const rightX = x + gap;
  const leftX = x - gap - size;
  const useRight = rightX + size <= plot.x + plot.w + 1 * dpr;
  return {
    x: useRight ? rightX : Math.max(plot.x, leftX),
    y: Math.max(plot.y, Math.min(plot.y + plot.h - size, y - size / 2)),
    w: size,
    h: size
  };
}

function drawLockGlyph(ctx, box, {linked, dpr}) {
  const cx = box.x + box.w / 2;
  const baseY = box.y + box.h * 0.54;
  const baseW = box.w * 0.48;
  const baseH = box.h * 0.32;
  const baseX = cx - baseW / 2;

  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.fillStyle = "rgba(255,255,255,0.86)";
  ctx.lineWidth = 1.35 * dpr;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  if (linked) {
    ctx.moveTo(cx - box.w * 0.21, baseY - box.h * 0.03);
    ctx.lineTo(cx - box.w * 0.21, baseY - box.h * 0.16);
    ctx.quadraticCurveTo(cx - box.w * 0.21, baseY - box.h * 0.32, cx, baseY - box.h * 0.32);
    ctx.quadraticCurveTo(cx + box.w * 0.21, baseY - box.h * 0.32, cx + box.w * 0.21, baseY - box.h * 0.16);
    ctx.lineTo(cx + box.w * 0.21, baseY - box.h * 0.03);
  } else {
    ctx.moveTo(cx - box.w * 0.1, baseY - box.h * 0.03);
    ctx.lineTo(cx - box.w * 0.1, baseY - box.h * 0.15);
    ctx.quadraticCurveTo(cx - box.w * 0.1, baseY - box.h * 0.31, cx + box.w * 0.1, baseY - box.h * 0.31);
    ctx.quadraticCurveTo(cx + box.w * 0.28, baseY - box.h * 0.31, cx + box.w * 0.28, baseY - box.h * 0.16);
  }
  ctx.stroke();

  roundedRectPath(ctx, baseX, baseY - baseH / 2, baseW, baseH, 1.8 * dpr);
  ctx.fill();
}

function roundedRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function hueToX(hue, plot) {
  const hueNorm = clamp01(normalizeHueDegrees(hue) / 360);
  return plot.x + hueNorm * plot.w;
}

function currentRotationFromConfig(config) {
  return hueDeltaDegrees(config.tintHighHue, config.tintLowHue);
}

function isApproximatelyOpposed(config) {
  return Math.abs(currentRotationFromConfig(config) - TINT_ROTATION_DEFAULT) < 0.01;
}

function formatControlValue(key, value) {
  if (key === "tintHighHue" || key === "tintLowHue") return `${Math.round(value)}°`;
  return formatCompact(value);
}
