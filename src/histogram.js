const DEFAULT_BIN_COUNT = 256;
const MAX_SAMPLE_EDGE = 360;
const DEFAULT_CHROMA_DOMAIN_PERCENTILE = 0.99;
const MIN_CHROMA_DOMAIN_MAX = 0.05;

export function createLumaHistogramFromImage(source, {binCount = DEFAULT_BIN_COUNT, maxSampleEdge = MAX_SAMPLE_EDGE} = {}) {
  const histograms = createImageHistogramsFromImage(source, {binCount, maxSampleEdge});
  return histograms?.luma || null;
}

export function createChromaHistogramFromImage(source, {binCount = DEFAULT_BIN_COUNT, maxSampleEdge = MAX_SAMPLE_EDGE} = {}) {
  const histograms = createImageHistogramsFromImage(source, {binCount, maxSampleEdge});
  return histograms ? {histogram: histograms.chroma, chromaByLuma: histograms.chromaByLuma, maxChroma: histograms.maxChroma, chromaDomainMax: histograms.chromaDomainMax} : null;
}

export function createImageHistogramsFromImage(source, {binCount = DEFAULT_BIN_COUNT, maxSampleEdge = MAX_SAMPLE_EDGE} = {}) {
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
  return createImageHistogramsFromRgba(data, {binCount});
}

export function createLumaHistogramFromRgba(rgba, {binCount = DEFAULT_BIN_COUNT} = {}) {
  return createImageHistogramsFromRgba(rgba, {binCount}).luma;
}

export function createChromaHistogramFromRgba(rgba, {binCount = DEFAULT_BIN_COUNT} = {}) {
  const {chroma, chromaByLuma, maxChroma, chromaDomainMax} = createImageHistogramsFromRgba(rgba, {binCount});
  return {histogram: chroma, chromaByLuma, maxChroma, chromaDomainMax};
}

export function createImageHistogramsFromRgba(rgba, {binCount = DEFAULT_BIN_COUNT} = {}) {
  const luma = new Float32Array(binCount);
  const chroma = new Float32Array(binCount);
  const chromaByLuma = new Float32Array(binCount * binCount);
  const sampleCount = Math.floor((rgba?.length || 0) / 4);
  const lightnessSamples = new Float32Array(sampleCount);
  const chromaSamples = new Float32Array(sampleCount);
  const alphaSamples = new Float32Array(sampleCount);
  let usedSamples = 0;
  let maxChroma = 0;

  for (let index = 0; index < rgba.length; index += 4) {
    const alpha = rgba[index + 3] / 255;
    if (alpha <= 0) continue;

    const lab = oklabFromSrgb(rgba[index] / 255, rgba[index + 1] / 255, rgba[index + 2] / 255);
    const lightness = clamp01(lab.l);
    const chromaValue = Math.hypot(lab.a, lab.b);
    maxChroma = Math.max(maxChroma, chromaValue);

    lightnessSamples[usedSamples] = lightness;
    chromaSamples[usedSamples] = chromaValue;
    alphaSamples[usedSamples] = alpha;
    usedSamples += 1;
  }

  const chromaDomainMax = chromaDomainMaxFromSamples(chromaSamples, alphaSamples, usedSamples, maxChroma);

  for (let index = 0; index < usedSamples; index += 1) {
    const lightness = lightnessSamples[index];
    const chromaValue = chromaSamples[index];
    const alpha = alphaSamples[index];
    const lumaBin = Math.min(binCount - 1, Math.max(0, Math.floor(lightness * binCount)));
    const chromaUnit = chromaDomainMax > 0 ? Math.min(chromaValue / chromaDomainMax, 1) : 0;
    const chromaBin = Math.min(binCount - 1, Math.max(0, Math.floor(chromaUnit * binCount)));
    luma[lumaBin] += alpha;
    chroma[chromaBin] += alpha;
    chromaByLuma[lumaBin * binCount + chromaBin] += alpha;
  }

  return {luma, chroma, chromaByLuma, maxChroma, chromaDomainMax};
}

export function oklabLumaFromSrgb(red, green, blue) {
  return clamp01(oklabFromSrgb(red, green, blue).l);
}

export function oklabChromaFromSrgb(red, green, blue) {
  const lab = oklabFromSrgb(red, green, blue);
  return Math.hypot(lab.a, lab.b);
}

export function oklabFromSrgb(red, green, blue) {
  const [r, g, b] = srgbToLinearRgb(red, green, blue);
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const lRoot = Math.cbrt(Math.max(l, 0));
  const mRoot = Math.cbrt(Math.max(m, 0));
  const sRoot = Math.cbrt(Math.max(s, 0));
  return {
    l: 0.2104542553 * lRoot + 0.7936177850 * mRoot - 0.0040720468 * sRoot,
    a: 1.9779984951 * lRoot - 2.4285922050 * mRoot + 0.4505937099 * sRoot,
    b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.8086757660 * sRoot
  };
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

function chromaDomainMaxFromSamples(chromaSamples, alphaSamples, usedSamples, maxChroma) {
  if (!usedSamples || maxChroma <= 0) return 1;
  const entries = new Array(usedSamples);
  let totalWeight = 0;
  for (let index = 0; index < usedSamples; index += 1) {
    const value = chromaSamples[index];
    const weight = alphaSamples[index];
    entries[index] = [value, weight];
    totalWeight += weight;
  }
  if (totalWeight <= 0) return Math.max(MIN_CHROMA_DOMAIN_MAX, maxChroma, 1e-6);
  entries.sort((left, right) => left[0] - right[0]);
  const threshold = totalWeight * DEFAULT_CHROMA_DOMAIN_PERCENTILE;
  let cumulative = 0;
  let percentileValue = maxChroma;
  for (const [value, weight] of entries) {
    cumulative += weight;
    if (cumulative >= threshold) {
      percentileValue = value;
      break;
    }
  }
  return Math.max(MIN_CHROMA_DOMAIN_MAX, percentileValue, 1e-6);
}
