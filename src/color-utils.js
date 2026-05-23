export function normalizeHueDegrees(hueDegrees) {
  const hue = Number(hueDegrees);
  if (!Number.isFinite(hue)) return 0;
  return ((hue % 360) + 360) % 360;
}

export function hueDeltaDegrees(fromHue, toHue) {
  return normalizeHueDegrees(Number(toHue) - Number(fromHue));
}

export function hsv2Rgb(h, s, v) {
  let r;
  let g;
  let b;

  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  switch (i % 6) {
    case 0:
      [r, g, b] = [v, t, p];
      break;
    case 1:
      [r, g, b] = [q, v, p];
      break;
    case 2:
      [r, g, b] = [p, v, t];
      break;
    case 3:
      [r, g, b] = [p, q, v];
      break;
    case 4:
      [r, g, b] = [t, p, v];
      break;
    case 5:
      [r, g, b] = [v, p, q];
      break;
    default:
      [r, g, b] = [v, t, p];
      break;
  }

  return [r, g, b];
}

export function lookTintFromHueDegrees(hueDegrees) {
  return hsv2Rgb(normalizeHueDegrees(hueDegrees) / 360, 1, 1);
}

export function tintCssColor(hueDegrees) {
  const [r, g, b] = lookTintFromHueDegrees(hueDegrees).map(channel => Math.round(channel * 255));
  return `rgb(${r} ${g} ${b})`;
}
