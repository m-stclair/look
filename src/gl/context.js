export const WEBGL_CONTEXT_OPTIONS = Object.freeze({
  premultipliedAlpha: false,
  preserveDrawingBuffer: true
});

export function createWebgl2Context(canvas, message = "WebGL2 is required.") {
  const gl = canvas?.getContext?.("webgl2", WEBGL_CONTEXT_OPTIONS);
  if (!gl) throw new Error(message);
  return gl;
}

export function resizeDrawingBuffer(canvas, width, height) {
  const safeWidth = Math.max(1, Math.round(Number(width) || 1));
  const safeHeight = Math.max(1, Math.round(Number(height) || 1));
  if (canvas.width !== safeWidth) canvas.width = safeWidth;
  if (canvas.height !== safeHeight) canvas.height = safeHeight;
  return {width: safeWidth, height: safeHeight};
}
