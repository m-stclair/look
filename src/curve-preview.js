import { CONTROL_GROUPS, normalizeConfig } from "./config.js";

const SHADOW_LOW = 0.18;
const SHADOW_HIGH = 0.35;
const HIGHLIGHT_LOW = 0.65;
const HIGHLIGHT_HIGH = 0.8;
const TONE_PIVOT_MIN_LUMA = 1 / 256;
const CHROMA_PREVIEW_MAX = 0.5;
const LUMA_REFERENCE_SAMPLES = Object.freeze([
  {label: "shadow", luma: 0.18, dash: [2, 3], alpha: 0.44},
  {label: "mid", luma: 0.5, dash: [], alpha: 0.92},
  {label: "high", luma: 0.82, dash: [7, 3], alpha: 0.62}
]);

export const TONAL_BALANCE_HANDLES = Object.freeze([
  {key: "lift", label: "Lift", luma: SHADOW_HIGH / 2},
  {key: "midtone", label: "Midtone", luma: (SHADOW_HIGH + HIGHLIGHT_LOW) / 2},
  {key: "gain", label: "Gain", luma: (HIGHLIGHT_LOW + 1) / 2}
]);

const CONTROL_DEFINITIONS = new Map(CONTROL_GROUPS.flatMap(group => group.controls.map(control => [control.key, control])));

export function createCurvePreviews(root, initialConfig, options = {}) {
  root.textContent = "";
  const lumaRoot = options.lumaRoot || root;
  if (lumaRoot !== root) lumaRoot.textContent = "";

  const lumaCanvas = createPreviewCard(lumaRoot, {
    title: "Luma"
  });
  lumaCanvas.classList.add("luma-curve-canvas");
  lumaCanvas.setAttribute("aria-label", "Luma Curve with post-curve lift, midtone, and gain handles");

  const chromaCanvas = createPreviewCard(root, {
    title: "Chroma Response",
    note: "C in → C out · lightness-aware"
  });

  let config = normalizeConfig(initialConfig);
  let sourceHistogram = null;
  let rafId = 0;
  let activeBalanceHandle = null;
  let hoverBalanceHandle = null;
  let toneControls = null;
  let unbindFloatingLumaWindow = null;

  function setConfigValue(key, value) {
    const nextConfig = normalizeConfig({...config, [key]: sanitizeControlValue(key, value)});
    config = nextConfig;
    toneControls?.sync(nextConfig);
    scheduleRender(nextConfig);
    options.onConfigChange?.(nextConfig);
  }

  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => scheduleRender());
  resizeObserver?.observe(lumaCanvas);
  resizeObserver?.observe(chromaCanvas);

  toneControls = createAttachedToneControls(lumaCanvas, {
    getConfig: () => config,
    setConfigValue,
    requestRender: () => scheduleRender(config)
  });
  unbindFloatingLumaWindow = bindDraggableFloatingWindow(lumaRoot, lumaCanvas);

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
    drawLumaPreview(lumaCanvas, config, sourceHistogram, {
      activeKey: activeBalanceHandle?.key || null,
      hoverKey: hoverBalanceHandle,
      showTonePivot: toneControls?.isExpanded() || toneControls?.isDraggingPivot()
    });
    drawChromaPreview(chromaCanvas, config);
  }

  renderNow(config);

  return {
    render: scheduleRender,
    setHistogram(nextHistogram) {
      sourceHistogram = nextHistogram;
      scheduleRender(config);
    },
    destroy() {
      if (rafId) cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      unbindLumaHandles();
      unbindFloatingLumaWindow?.();
      toneControls?.destroy();
    }
  };
}

export function lumaToneBaseSample(inputLuma, rawConfig = {}) {
  const config = normalizeConfig(rawConfig);
  const luma = clamp01(gammaAdjust(exposureAdjust(inputLuma, config.exposure), config.gamma));
  const logL = safeLog2(luma);
  const curve = sigmoid(config.toneShoulder * (logL - config.toneCenter));
  return mix(luma, curve, config.curveStrength);
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

export function chromaCurveSample(inputChroma, inputLuma = 0.5, rawConfig = {}) {
  const config = normalizeConfig(rawConfig);
  const luma = clamp01(gammaAdjust(exposureAdjust(inputLuma, config.exposure), config.gamma));
  const chroma = Math.max(gammaAdjust(exposureAdjust(inputChroma, config.chromaExposure), config.chromaGamma), 0);
  const chromaFade = smoothstep(config.chromaFadeLow, config.chromaFadeHigh, luma);
  return mix(chroma, chroma * chromaFade, config.chromaFadeStrength);
}

export function gammaAdjust(value, gammaValue) {
  return Math.pow(Math.max(value, 0), 1 / Math.max(gammaValue, 1e-4));
}

export function exposureAdjust(value, exposureValue) {
  return value * Math.pow(2, exposureValue);
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

export function pivotLumaFromToneCenter(toneCenter) {
  if (!Number.isFinite(toneCenter)) return pivotLumaFromToneCenter(0);
  return clamp01(Math.pow(2, toneCenter));
}

export function toneCenterFromPivotLuma(pivotLuma) {
  return sanitizeControlValue("toneCenter", Math.log2(Math.max(TONE_PIVOT_MIN_LUMA, clamp01(pivotLuma))));
}

export function toneCenterFromHorizontalPosition(clientX, left, width) {
  const local = width > 0 ? (clientX - left) / width : 0;
  return toneCenterFromPivotLuma(local);
}


function drawTonePivotMarker(frame, config) {
  const {ctx} = frame;
  const plot = plotRect(frame);
  const dpr = devicePixelRatioSafe();
  const pivot = pivotLumaFromToneCenter(config.toneCenter);
  const x = plot.x + pivot * plot.w;

  ctx.save();
  ctx.globalAlpha = 0.48;
  ctx.strokeStyle = frame.text.trim();
  ctx.lineWidth = 1 * dpr;
  ctx.setLineDash([4 * dpr, 3 * dpr]);
  line(ctx, x, plot.y, x, plot.y + plot.h);
  ctx.setLineDash([]);

  ctx.globalAlpha = 0.78;
  ctx.fillStyle = frame.bg.trim();
  ctx.strokeStyle = frame.text.trim();
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

function drawTonalBalanceHandles(frame, config, transformedHistogram, {activeKey = null, hoverKey = null} = {}) {
  const {ctx} = frame;
  const plot = plotRect(frame);
  const dpr = devicePixelRatioSafe();

  ctx.save();
  for (const handle of TONAL_BALANCE_HANDLES) {
    const point = tonalBalanceHandlePoint(frame, config, handle);
    const actualPoint = tonalBalanceActualCurvePoint(frame, config, handle);
    const density = histogramDensityAtLuma(transformedHistogram, handle.luma);
    const active = handle.key === activeKey;
    const hover = handle.key === hoverKey;
    const dormant = density < 0.18;
    const radius = (active ? 6.5 : hover ? 5.8 : 5) * dpr;

    ctx.globalAlpha = active ? 0.72 : hover ? 0.52 : 0.16 + 0.22 * density;
    ctx.strokeStyle = frame.accent.trim();
    ctx.lineWidth = (active ? 1.8 : 1.2) * dpr;
    ctx.setLineDash([2 * dpr, 4 * dpr]);
    line(ctx, point.x, plot.y, point.x, plot.y + plot.h);
    ctx.setLineDash([]);

    if (Math.abs(actualPoint.y - point.y) > 2 * dpr) {
      ctx.globalAlpha = active ? 0.58 : hover ? 0.44 : 0.16 + 0.16 * density;
      ctx.strokeStyle = frame.accent.trim();
      ctx.lineWidth = 1 * dpr;
      ctx.setLineDash([1.5 * dpr, 3 * dpr]);
      line(ctx, point.x, actualPoint.y, point.x, point.y);
      ctx.setLineDash([]);
    }

    ctx.globalAlpha = 1;
    ctx.fillStyle = frame.bg.trim();
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius + 2 * dpr, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = active ? 1 : hover ? 0.88 : 0.48 + 0.34 * density;
    ctx.strokeStyle = frame.accent.trim();
    ctx.lineWidth = (dormant ? 1.8 : 1.2) * dpr;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    if (dormant && !active) {
      ctx.stroke();
    } else {
      ctx.fillStyle = frame.accent.trim();
      ctx.fill();
    }

    ctx.globalAlpha = active ? 1 : hover ? 0.9 : 0.6 + 0.25 * density;
    ctx.strokeStyle = dormant && !active ? frame.accent.trim() : frame.bg.trim();
    ctx.lineWidth = 1.4 * dpr;
    line(ctx, point.x - radius * 0.65, point.y, point.x + radius * 0.65, point.y);
  }
  ctx.restore();
}

function tonalBalanceHandlePoint(frame, config, handle) {
  const plot = plotRect(frame);
  return {
    x: plot.x + handle.luma * plot.w,
    y: plot.y + (1 - tonalBalanceHandleValue(handle.key, handle.luma, config)) * plot.h
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

function createAttachedToneControls(canvas, bindings) {
  const card = canvas.closest?.(".curve-preview-card") || canvas.parentElement;
  if (!card) {
    return {sync() {}, destroy() {}, isExpanded: () => false, isDraggingPivot: () => false};
  }

  const dock = document.createElement("div");
  dock.className = "tone-curve-dock";

  const mainRow = document.createElement("div");
  mainRow.className = "tone-dock-main-row";

  const exposureIcon = createDockIcon("E", "Exposure");
  const exposure = createDockRange("Exposure", "exposure", -5, 5, 0.05, {showLabel: false});
  exposure.wrapper.classList.add("tone-exposure-control");

  const gammaIcon = createDockIcon(
    '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M4 26 C11 25.5 14.5 16 18.5 9.5 C21.6 4.7 24.8 4 28 4"/></svg>',
    "Gamma",
    {html: true, className: "tone-gamma-icon"}
  );
  const gamma = createDockRange("Gamma", "gamma", 0.1, 4, 0.01, {showLabel: false});
  gamma.wrapper.classList.add("tone-gamma-control");

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "tone-sigmoid-button";
  toggle.setAttribute("aria-label", "Expand tone curve controls");
  toggle.setAttribute("aria-expanded", "false");
  toggle.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M4 25 C10 25 11.5 16.5 16 16 C20.5 15.5 22 7 28 7"/></svg>';

  const amount = createDockRange("Tone Amount", "curveStrength", 0, 1, 0.01, {showLabel: false});
  amount.wrapper.classList.add("tone-amount-control");

  const panel = document.createElement("div");
  panel.className = "tone-curve-foldout";

  const shoulder = createDockRange("Shoulder", "toneShoulder", 1, 6, 0.02);
  panel.append(shoulder.wrapper);

  const pivotRail = document.createElement("div");
  pivotRail.className = "tone-pivot-rail";
  pivotRail.setAttribute("role", "slider");
  pivotRail.setAttribute("tabindex", "0");
  pivotRail.setAttribute("aria-label", "Pivot");
  pivotRail.setAttribute("aria-valuemin", "0");
  pivotRail.setAttribute("aria-valuemax", "1");
  pivotRail.hidden = true;

  const pivotTrack = document.createElement("span");
  pivotTrack.className = "tone-pivot-track";
  const pivotHandle = document.createElement("span");
  pivotHandle.className = "tone-pivot-handle";
  pivotRail.append(pivotTrack, pivotHandle);

  mainRow.append(exposureIcon, exposure.wrapper, gammaIcon, gamma.wrapper, toggle, amount.wrapper);
  dock.append(mainRow, panel);
  const host = card.closest?.(".floating-luma-window") || card;
  host.append(dock);
  card.append(pivotRail);

  const state = {expanded: false, pivotPointerId: null};

  toggle.addEventListener("click", () => {
    state.expanded = !state.expanded;
    syncExpansion();
    bindings.requestRender?.();
  });

  exposure.input.addEventListener("input", () => bindings.setConfigValue("exposure", exposure.input.valueAsNumber));
  gamma.input.addEventListener("input", () => bindings.setConfigValue("gamma", gamma.input.valueAsNumber));
  amount.input.addEventListener("input", () => bindings.setConfigValue("curveStrength", amount.input.valueAsNumber));
  shoulder.input.addEventListener("input", () => bindings.setConfigValue("toneShoulder", shoulder.input.valueAsNumber));

  function syncExpansion() {
    dock.classList.toggle("is-expanded", state.expanded);
    pivotRail.hidden = !state.expanded;
    toggle.setAttribute("aria-expanded", state.expanded ? "true" : "false");
    toggle.setAttribute("aria-label", `${state.expanded ? "Collapse" : "Expand"} tone curve controls`);
  }

  function setPivotFromClientX(clientX) {
    const rect = pivotRail.getBoundingClientRect();
    bindings.setConfigValue("toneCenter", toneCenterFromHorizontalPosition(clientX, rect.left, rect.width));
  }

  function onPivotPointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    state.pivotPointerId = event.pointerId;
    pivotRail.setPointerCapture?.(event.pointerId);
    pivotRail.classList.add("is-dragging");
    setPivotFromClientX(event.clientX);
    bindings.requestRender?.();
  }

  function onPivotPointerMove(event) {
    if (state.pivotPointerId !== event.pointerId) return;
    event.preventDefault();
    setPivotFromClientX(event.clientX);
  }

  function stopPivotDrag(event) {
    if (event && state.pivotPointerId !== null && event.pointerId !== state.pivotPointerId) return;
    state.pivotPointerId = null;
    pivotRail.classList.remove("is-dragging");
    bindings.requestRender?.();
  }

  pivotRail.addEventListener("pointerdown", onPivotPointerDown);
  pivotRail.addEventListener("pointermove", onPivotPointerMove);
  pivotRail.addEventListener("pointerup", stopPivotDrag);
  pivotRail.addEventListener("pointercancel", stopPivotDrag);
  pivotRail.addEventListener("lostpointercapture", stopPivotDrag);
  pivotRail.addEventListener("keydown", event => {
    const config = bindings.getConfig();
    const current = pivotLumaFromToneCenter(config.toneCenter);
    const step = event.shiftKey ? 0.05 : 0.01;
    let next = current;
    if (event.key === "ArrowLeft") next = current - step;
    else if (event.key === "ArrowRight") next = current + step;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 1;
    else return;
    event.preventDefault();
    bindings.setConfigValue("toneCenter", toneCenterFromPivotLuma(next));
  });

  syncExpansion();
  sync(bindings.getConfig());

  return {
    sync,
    isExpanded: () => state.expanded,
    isDraggingPivot: () => state.pivotPointerId !== null,
    destroy() {
      dock.remove();
      pivotRail.remove();
    }
  };

  function sync(nextConfig) {
    const config = normalizeConfig(nextConfig);
    exposure.input.value = String(config.exposure);
    exposure.value.textContent = formatCompact(config.exposure);
    gamma.input.value = String(config.gamma);
    gamma.value.textContent = formatCompact(config.gamma);
    amount.input.value = String(config.curveStrength);
    amount.value.textContent = formatCompact(config.curveStrength);
    shoulder.input.value = String(config.toneShoulder);
    shoulder.value.textContent = formatCompact(config.toneShoulder);
    const pivot = pivotLumaFromToneCenter(config.toneCenter);
    pivotHandle.style.left = `${pivot * 100}%`;
    pivotRail.setAttribute("aria-valuenow", pivot.toFixed(3));
    pivotRail.setAttribute("aria-valuetext", `${Math.round(pivot * 100)}% luma`);
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
  return {wrapper, input, value};
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
  if (handleState.showTonePivot) drawTonePivotMarker(frame, config);
  drawCurve(frame, sampleCurve(x => x, 160), {alpha: 0.28, dash: [2, 3], width: 1, yMax: 1});
  drawCurve(frame, sampleCurve(x => lumaCurveSample(x, config), 160), {alpha: 0.98, width: 2, yMax: 1});
  drawTonalBalanceHandles(frame, config, transformedHistogram, handleState);
}

function drawChromaPreview(canvas, config) {
  const frame = beginFrame(canvas);
  if (!frame) return;

  const curves = LUMA_REFERENCE_SAMPLES.map(sample => ({
    ...sample,
    points: sampleCurve(x => chromaCurveSample(x * CHROMA_PREVIEW_MAX, sample.luma, config) / CHROMA_PREVIEW_MAX)
  }));
  const yMax = Math.max(1, ...curves.flatMap(curve => curve.points.map(point => point.y))) * 1.05;

  drawFrame(frame, {yMax});
  drawCurve(frame, sampleCurve(x => x), {alpha: 0.22, dash: [2, 3], width: 1, yMax});
  for (const curve of curves) {
    drawCurve(frame, curve.points, {alpha: curve.alpha, dash: curve.dash, width: curve.label === "mid" ? 2 : 1.25, yMax});
  }
  drawChromaLegend(frame, curves);
  drawAxisLabels(frame, "0", formatCompact(CHROMA_PREVIEW_MAX));
}

function createPreviewCard(root, {title, note = ""}) {
  const card = document.createElement("section");
  card.className = "curve-preview-card";

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
  const compactAxes = canvas.classList.contains("luma-curve-canvas");
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

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
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

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function formatCompact(value) {
  if (Math.abs(value) >= 10) return value.toFixed(0);
  if (Math.abs(value) >= 1) return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function devicePixelRatioSafe() {
  return typeof window === "undefined" ? 1 : Math.max(1, window.devicePixelRatio || 1);
}
