import { clamp01, devicePixelRatioSafe, formatCompact, histogramDisplayProfile } from "./shared.js";

export function frameFromClientRect(canvas, rect) {
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


export function createPreviewCard(root, {title, note = "", className = ""}) {
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

export function beginFrame(canvas) {
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
  const compactAxes = canvas.classList.contains("luma-curve-canvas") || canvas.classList.contains("chroma-curve-canvas") || canvas.classList.contains("tint-curve-canvas");
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

export function drawFrame(frame, {yMax, labels = true}) {
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



export function drawHistogramUnderlay(frame, histogram) {
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


export function drawChromaHistogramUnderlay(frame, histogram) {
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

export function drawChromaPercentileIndicator(frame, percentileChroma, displayMax) {
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

export function drawCurve(frame, points, {alpha, dash = [], width, yMax}) {
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

export function drawAxisLabels(frame, left, right) {
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

export function drawChromaLegend(frame, curves) {
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

export function sampleCurve(fn, sampleCount = 96) {
  return Array.from({length: sampleCount}, (_, index) => {
    const x = index / (sampleCount - 1);
    return {x, y: fn(x)};
  });
}

export function plotRect(frame) {
  return {
    x: frame.padLeft,
    y: frame.padTop,
    w: frame.width - frame.padLeft - frame.padRight,
    h: frame.height - frame.padTop - frame.padBottom
  };
}

export function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
