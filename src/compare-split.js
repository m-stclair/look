function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

export function compareSplitFromClientX(clientX, rect) {
  return clamp01((clientX - rect.left) / Math.max(rect.width, 1));
}

export function clientNearCompareSplit({clientX, clientY, rect, split, enabled, threshold = 12}) {
  if (!enabled) return false;
  const withinY = clientY >= rect.top && clientY <= rect.top + rect.height;
  if (!withinY) return false;
  const splitX = rect.left + rect.width * clamp01(split);
  return Math.abs(clientX - splitX) <= threshold;
}
