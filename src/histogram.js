const DEFAULT_BIN_COUNT = 256;
const MAX_SAMPLE_EDGE = 360;

export function createLumaHistogramFromImage(source, {binCount = DEFAULT_BIN_COUNT, maxSampleEdge = MAX_SAMPLE_EDGE} = {}) {
  if (!source) return null;
  const width = source.naturalWidth || source.videoWidth || source.width || 0;
  const height = source.naturalHeight || source.videoHeight || source.height || 0;
  if (!width || !height) return null;

  const scale = Math.min(1, maxSampleEdge / Math.max(width, height));
  const sampleWidth = Math.max(1, Math.round(width * scale));
  const sampleHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const ctx = canvas.getContext("2d", {willReadFrequently: true});
  if (!ctx) return null;

  ctx.drawImage(source, 0, 0, sampleWidth, sampleHeight);
  const {data} = ctx.getImageData(0, 0, sampleWidth, sampleHeight);
  return createLumaHistogramFromRgba(data, {binCount});
}

export function createLumaHistogramFromRgba(rgba, {binCount = DEFAULT_BIN_COUNT} = {}) {
  const bins = new Float32Array(binCount);
  for (let index = 0; index < rgba.length; index += 4) {
    const alpha = rgba[index + 3] / 255;
    if (alpha <= 0) continue;
    const luma = oklabLumaFromSrgb(rgba[index] / 255, rgba[index + 1] / 255, rgba[index + 2] / 255);
    const bin = Math.min(binCount - 1, Math.max(0, Math.floor(luma * binCount)));
    bins[bin] += alpha;
  }
  return bins;
}

export function oklabLumaFromSrgb(red, green, blue) {
  const [r, g, b] = srgbToLinearRgb(red, green, blue);
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const lRoot = Math.cbrt(Math.max(l, 0));
  const mRoot = Math.cbrt(Math.max(m, 0));
  const sRoot = Math.cbrt(Math.max(s, 0));
  return clamp01(0.2104542553 * lRoot + 0.7936177850 * mRoot - 0.0040720468 * sRoot);
}

function srgbToLinearRgb(red, green, blue) {
  return [srgbToLinear(red), srgbToLinear(green), srgbToLinear(blue)];
}

function srgbToLinear(channel) {
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}
