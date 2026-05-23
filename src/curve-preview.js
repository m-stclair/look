import { normalizeConfig } from "./config.js";

const SHADOW_LOW = 0.18;
const SHADOW_HIGH = 0.35;
const HIGHLIGHT_LOW = 0.65;
const HIGHLIGHT_HIGH = 0.8;
const CHROMA_PREVIEW_MAX = 0.5;
const LUMA_REFERENCE_SAMPLES = Object.freeze([
  {label: "shadow", luma: 0.18, dash: [2, 3], alpha: 0.44},
  {label: "mid", luma: 0.5, dash: [], alpha: 0.92},
  {label: "high", luma: 0.82, dash: [7, 3], alpha: 0.62}
]);

export function createCurvePreviews(root, initialConfig) {
  root.textContent = "";

  const lumaCanvas = createPreviewCard(root, {
    title: "Luma Curve",
    note: "L in → tone out"
  });
  const chromaCanvas = createPreviewCard(root, {
    title: "Chroma Response",
    note: "C in → C out · lightness-aware"
  });

  let config = normalizeConfig(initialConfig);
  let rafId = 0;

  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => scheduleRender());
  resizeObserver?.observe(lumaCanvas);
  resizeObserver?.observe(chromaCanvas);

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
    drawLumaPreview(lumaCanvas, config);
    drawChromaPreview(chromaCanvas, config);
  }

  renderNow(config);

  return {
    render: scheduleRender,
    destroy() {
      if (rafId) cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
    }
  };
}

export function lumaCurveSample(inputLuma, rawConfig = {}) {
  const config = normalizeConfig(rawConfig);
  const luma = clamp01(gammaAdjust(exposureAdjust(inputLuma, config.exposure), config.gamma));
  const toneBase = applyLiftMidtoneGain(luma, config.lift, config.midtone, config.gain);
  const logL = safeLog2(toneBase);
  const curve = sigmoid(config.toneShoulder * (logL - config.toneCenter));
  return mix(toneBase, curve, config.curveStrength);
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

function drawLumaPreview(canvas, config) {
  const frame = beginFrame(canvas);
  if (!frame) return;
  drawFrame(frame, {yMax: 1});
  drawCurve(frame, sampleCurve(x => x), {alpha: 0.28, dash: [2, 3], width: 1, yMax: 1});
  drawCurve(frame, sampleCurve(x => lumaCurveSample(x, config)), {alpha: 0.98, width: 2, yMax: 1});
  drawAxisLabels(frame, "0", "1");
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

function createPreviewCard(root, {title, note}) {
  const card = document.createElement("section");
  card.className = "curve-preview-card";

  const header = document.createElement("div");
  header.className = "curve-preview-header";

  const titleNode = document.createElement("h2");
  titleNode.textContent = title;

  const noteNode = document.createElement("span");
  noteNode.textContent = note;

  const canvas = document.createElement("canvas");
  canvas.width = 288;
  canvas.height = 94;
  canvas.setAttribute("aria-label", `${title}: ${note}`);

  header.append(titleNode, noteNode);
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
  const frame = {
    canvas,
    ctx,
    width,
    height,
    padLeft: 18 * devicePixelRatioSafe(),
    padRight: 8 * devicePixelRatioSafe(),
    padTop: 8 * devicePixelRatioSafe(),
    padBottom: 16 * devicePixelRatioSafe(),
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

function drawFrame(frame, {yMax}) {
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

  ctx.fillStyle = frame.muted.trim();
  ctx.font = `${9 * devicePixelRatioSafe()}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(formatCompact(yMax), plot.x - 5 * devicePixelRatioSafe(), plot.y);
  ctx.fillText("0", plot.x - 5 * devicePixelRatioSafe(), plot.y + plot.h);
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
