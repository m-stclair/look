function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finitePositive(value, fallback = 1) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function canvasRenderSize({canvas, dpr = globalThis.window?.devicePixelRatio || 1, fallbackWidth = 1, fallbackHeight = 1}) {
  const safeDpr = finitePositive(dpr, 1);
  const rect = canvas.getBoundingClientRect?.() || {width: 0, height: 0};
  const width = Math.max(1, Math.round((rect.width || fallbackWidth) * safeDpr));
  const height = Math.max(1, Math.round((rect.height || fallbackHeight) * safeDpr));
  return {
    width,
    height,
    dpr: safeDpr,
    cssWidth: rect.width || width / safeDpr,
    cssHeight: rect.height || height / safeDpr
  };
}

export function fitViewRect(canvasW, canvasH, imageW, imageH, zoom = 1) {
  const safeCanvasW = finitePositive(canvasW, 1);
  const safeCanvasH = finitePositive(canvasH, 1);
  const safeImageW = finitePositive(imageW, 1);
  const safeImageH = finitePositive(imageH, 1);
  const imageAspect = safeImageW / safeImageH;
  const canvasAspect = safeCanvasW / safeCanvasH;
  const safeZoom = Math.max(1, Number(zoom) || 1);

  if (canvasAspect > imageAspect) {
    const fitH = safeCanvasH;
    const fitW = Math.round(fitH * imageAspect);
    const w = Math.min(safeCanvasW, Math.round(fitW * safeZoom));
    const h = fitH;
    const x = Math.floor((safeCanvasW - w) / 2);
    return {x, y: 0, w, h};
  }

  const fitW = safeCanvasW;
  const fitH = Math.round(fitW / imageAspect);
  const w = fitW;
  const h = Math.min(safeCanvasH, Math.round(fitH * safeZoom));
  const y = Math.floor((safeCanvasH - h) / 2);
  return {x: 0, y, w, h};
}

export function displayViewRect(canvasClientRect, renderSize, viewRect) {
  const dpr = finitePositive(renderSize.dpr, 1);
  return {
    left: canvasClientRect.left + viewRect.x / dpr,
    top: canvasClientRect.top + viewRect.y / dpr,
    width: viewRect.w / dpr,
    height: viewRect.h / dpr
  };
}

export function viewSpan(viewW, viewH, imageW, imageH, zoom = 1) {
  if (!imageW || !imageH) return [1, 1];
  const safeViewW = finitePositive(viewW, 1);
  const safeViewH = finitePositive(viewH, 1);
  const imageAspect = imageW / imageH;
  const viewAspect = safeViewW / safeViewH;
  const base = 1 / Math.max(1, Number(zoom) || 1);

  if (viewAspect > imageAspect) {
    return [Math.min(base * (viewAspect / imageAspect), 1), Math.min(base, 1)];
  }

  return [Math.min(base, 1), Math.min(base * (imageAspect / viewAspect), 1)];
}

export function clampedViewCenter(view, spanX, spanY) {
  const halfW = 0.5 * spanX;
  const halfH = 0.5 * spanY;
  return {
    centerX: clamp(view.centerX, halfW, 1 - halfW),
    centerY: clamp(view.centerY, halfH, 1 - halfH)
  };
}

export function normalizePointerToRect(clientX, clientY, rect) {
  const nx = clamp((clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
  const ny = clamp(1 - ((clientY - rect.top) / Math.max(rect.height, 1)), 0, 1);
  return {rect, nx, ny};
}

export function panCenterByClientDelta(view, dx, dy, rect, spanX, spanY) {
  return {
    centerX: view.centerX - (dx / Math.max(rect.width, 1)) * spanX,
    centerY: view.centerY + (dy / Math.max(rect.height, 1)) * spanY
  };
}

export function zoomViewAtPointer({view, deltaY, pointer, viewRect: currentViewRect, imageW, imageH, minZoom = 1, maxZoom = 32}) {
  const [oldSpanX, oldSpanY] = viewSpan(currentViewRect.w, currentViewRect.h, imageW, imageH, view.zoom);
  const anchorX = view.centerX + (pointer.nx - 0.5) * oldSpanX;
  const anchorY = view.centerY + (pointer.ny - 0.5) * oldSpanY;
  const factor = Math.exp(-deltaY * 0.001);
  const zoom = clamp(view.zoom * factor, minZoom, maxZoom);
  return {anchorX, anchorY, zoom};
}
