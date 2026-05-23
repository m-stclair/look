import { createWebgl2Context, resizeDrawingBuffer } from "./gl/context.js";
import { linkProgram } from "./gl/programs.js";
import { createTexture, uploadImageTexture } from "./gl/textures.js";
import { normalizeConfig } from "./config.js";
import { lookTintFromHueDegrees } from "./color-utils.js";
import {
  canvasRenderSize,
  clampedViewCenter,
  displayViewRect,
  fitViewRect,
  normalizePointerToRect,
  panCenterByClientDelta,
  viewSpan,
  zoomViewAtPointer
} from "./viewport.js";

const UNIFORM_NAMES = Object.freeze([
  "u_image",
  "u_resolution",
  "u_viewport_origin",
  "u_view_center",
  "u_view_span",
  "u_gamma",
  "u_exposure",
  "u_chroma_gamma",
  "u_chroma_exposure",
  "u_chroma_fade_strength",
  "u_chroma_fade_low",
  "u_chroma_fade_high",
  "u_shoulder",
  "u_center",
  "u_curve_strength",
  "u_tint",
  "u_tint_strength",
  "u_lift",
  "u_midtone",
  "u_gain"
]);

export function createLookRenderer(canvas, {vertexSource, fragmentSource}) {
  const gl = createWebgl2Context(canvas);
  const program = linkProgram(gl, vertexSource, fragmentSource, "Failed to link Look shader.");
  const texture = createTexture(gl);
  const vao = gl.createVertexArray();
  const uniforms = collectUniforms(gl, program, UNIFORM_NAMES);
  let config = normalizeConfig();
  let imageSource = null;
  let imageSize = {width: canvas.width || 1, height: canvas.height || 1};
  let view = defaultView();

  gl.useProgram(program);
  gl.uniform1i(uniforms.u_image, 0);

  function loadImage(source) {
    imageSource = source;
    imageSize = {
      width: source.naturalWidth || source.videoWidth || source.width || canvas.width,
      height: source.naturalHeight || source.videoHeight || source.height || canvas.height
    };
    view = defaultView();
    gl.activeTexture(gl.TEXTURE0);
    uploadImageTexture(gl, texture, source, {filter: gl.LINEAR});
    resizeToDisplay({render: false});
    render();
  }

  function setConfig(nextConfig) {
    config = normalizeConfig(nextConfig);
    render();
  }

  function render() {
    if (!imageSource) return;
    const viewRect = getViewRect();
    const [spanX, spanY] = getViewSpan(viewRect.w, viewRect.h);
    const center = clampedViewCenter(view, spanX, spanY);
    view.centerX = center.centerX;
    view.centerY = center.centerY;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.012, 0.020, 0.028, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.viewport(viewRect.x, viewRect.y, viewRect.w, viewRect.h);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    const tint = lookTintFromHueDegrees(config.tintHue);
    gl.uniform2f(uniforms.u_resolution, viewRect.w, viewRect.h);
    gl.uniform2f(uniforms.u_viewport_origin, viewRect.x, viewRect.y);
    gl.uniform2f(uniforms.u_view_center, view.centerX, view.centerY);
    gl.uniform2f(uniforms.u_view_span, spanX, spanY);
    gl.uniform1f(uniforms.u_gamma, config.gamma);
    gl.uniform1f(uniforms.u_exposure, config.exposure);
    gl.uniform1f(uniforms.u_chroma_gamma, config.chromaGamma);
    gl.uniform1f(uniforms.u_chroma_exposure, config.chromaExposure);
    gl.uniform1f(uniforms.u_chroma_fade_low, config.chromaFadeLow);
    gl.uniform1f(uniforms.u_chroma_fade_high, config.chromaFadeHigh);
    gl.uniform1f(uniforms.u_chroma_fade_strength, config.chromaFadeStrength);
    gl.uniform1f(uniforms.u_shoulder, config.toneShoulder);
    gl.uniform1f(uniforms.u_center, config.toneCenter);
    gl.uniform1f(uniforms.u_curve_strength, config.curveStrength);
    gl.uniform3f(uniforms.u_tint, tint[0], tint[1], tint[2]);
    gl.uniform1f(uniforms.u_tint_strength, config.tintStrength);
    gl.uniform1f(uniforms.u_lift, config.lift);
    gl.uniform1f(uniforms.u_midtone, config.midtone);
    gl.uniform1f(uniforms.u_gain, config.gain);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  function exportPng(filename = "look.png") {
    return new Promise((resolve, reject) => {
      if (!imageSource) {
        reject(new Error("No image is loaded."));
        return;
      }

      const previousSize = {width: canvas.width, height: canvas.height};
      const previousView = {...view};
      resizeDrawingBuffer(canvas, imageSize.width, imageSize.height);
      view = defaultView();
      render();

      canvas.toBlob(blob => {
        resizeDrawingBuffer(canvas, previousSize.width, previousSize.height);
        view = previousView;
        render();

        if (!blob) {
          reject(new Error("PNG export failed."));
          return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        resolve(blob);
      }, "image/png");
    });
  }

  function resizeToDisplay({render: shouldRender = true} = {}) {
    const target = canvasRenderSize({
      canvas,
      fallbackWidth: imageSize.width,
      fallbackHeight: imageSize.height
    });
    const changed = canvas.width !== target.width || canvas.height !== target.height;
    resizeDrawingBuffer(canvas, target.width, target.height);
    if (changed && shouldRender) render();
    return changed;
  }

  function getViewRect(width = canvas.width, height = canvas.height) {
    return fitViewRect(width, height, imageSize.width, imageSize.height, view.zoom);
  }

  function getDisplayViewRect() {
    const rect = canvas.getBoundingClientRect();
    const renderSize = canvasRenderSize({
      canvas,
      fallbackWidth: imageSize.width,
      fallbackHeight: imageSize.height
    });
    return displayViewRect(rect, renderSize, getViewRect(renderSize.width, renderSize.height));
  }

  function getViewSpan(viewW, viewH) {
    return viewSpan(viewW, viewH, imageSize.width, imageSize.height, view.zoom);
  }

  function clampViewCenter() {
    const rect = getViewRect();
    const [spanX, spanY] = getViewSpan(rect.w, rect.h);
    const center = clampedViewCenter(view, spanX, spanY);
    view.centerX = center.centerX;
    view.centerY = center.centerY;
  }

  function panByClientDelta(dx, dy) {
    if (!imageSource) return;
    const displayRect = getDisplayViewRect();
    const viewRect = getViewRect();
    const [spanX, spanY] = getViewSpan(viewRect.w, viewRect.h);
    view = {...view, ...panCenterByClientDelta(view, dx, dy, displayRect, spanX, spanY)};
    clampViewCenter();
    render();
  }

  function zoomBy(deltaY, clientX, clientY) {
    if (!imageSource) return;
    const pointer = normalizePointerToRect(clientX, clientY, getDisplayViewRect());
    const currentViewRect = getViewRect();
    const next = zoomViewAtPointer({
      view,
      deltaY,
      pointer,
      viewRect: currentViewRect,
      imageW: imageSize.width,
      imageH: imageSize.height
    });
    view.zoom = next.zoom;

    const nextViewRect = getViewRect();
    const [newSpanX, newSpanY] = getViewSpan(nextViewRect.w, nextViewRect.h);
    view.centerX = next.anchorX - (pointer.nx - 0.5) * newSpanX;
    view.centerY = next.anchorY - (pointer.ny - 0.5) * newSpanY;
    clampViewCenter();
    render();
  }

  function resetView() {
    view = defaultView();
    render();
  }

  function getView() {
    return {...view};
  }

  function dispose() {
    gl.deleteTexture(texture);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(program);
  }

  return {
    loadImage,
    setConfig,
    render,
    exportPng,
    resizeToDisplay,
    panByClientDelta,
    zoomBy,
    resetView,
    getView,
    getDisplayViewRect,
    dispose
  };
}

function defaultView() {
  return {zoom: 1, centerX: 0.5, centerY: 0.5};
}

function collectUniforms(gl, program, names) {
  const uniforms = {};
  for (const name of names) {
    const location = gl.getUniformLocation(program, name);
    if (location === null) throw new Error(`Missing shader uniform: ${name}`);
    uniforms[name] = location;
  }
  return uniforms;
}
