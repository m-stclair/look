import { createWebgl2Context, resizeDrawingBuffer } from "./gl/context.js";
import { linkProgram } from "./gl/programs.js";
import { allocateRgbaTexture, createTexture, uploadImageTexture } from "./gl/textures.js";
import { renderViewComposite, VIEW_COMPOSITE_UNIFORM_NAMES } from "./gl/view-composite-renderer.js";
import { normalizeConfig } from "./config.js";
import { effectiveToneCenter } from "./curve-preview.js";
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

const LOOK_UNIFORM_NAMES = Object.freeze([
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

export function createLookRenderer(canvas, {vertexSource, fragmentSource, viewCompositeFragmentSource}) {
  const gl = createWebgl2Context(canvas);
  const lookProgram = linkProgram(gl, vertexSource, fragmentSource, "Failed to link Look shader.");
  const compositeProgram = linkProgram(
    gl,
    vertexSource,
    viewCompositeFragmentSource,
    "Failed to link view composite shader."
  );
  const sourceTexture = createTexture(gl);
  const processedTexture = createTexture(gl);
  const processedFramebuffer = gl.createFramebuffer();
  const vao = gl.createVertexArray();
  const lookUniforms = collectUniforms(gl, lookProgram, LOOK_UNIFORM_NAMES);
  const compositeUniforms = collectUniforms(gl, compositeProgram, VIEW_COMPOSITE_UNIFORM_NAMES);
  const processedTarget = {width: 0, height: 0};
  const compare = {enabled: false, split: 0.5};
  let config = normalizeConfig();
  let imageSource = null;
  let imageSize = {width: canvas.width || 1, height: canvas.height || 1};
  let view = defaultView();

  gl.useProgram(lookProgram);
  gl.uniform1i(lookUniforms.u_image, 0);

  function loadImage(source) {
    imageSource = source;
    imageSize = {
      width: source.naturalWidth || source.videoWidth || source.width || canvas.width,
      height: source.naturalHeight || source.videoHeight || source.height || canvas.height
    };
    view = defaultView();
    gl.activeTexture(gl.TEXTURE0);
    uploadImageTexture(gl, sourceTexture, source, {filter: gl.LINEAR});
    processedTarget.width = 0;
    processedTarget.height = 0;
    resizeToDisplay({render: false});
    render();
  }

  function setConfig(nextConfig) {
    config = normalizeConfig(nextConfig);
    render();
  }

  function setCompareEnabled(enabled) {
    compare.enabled = !!enabled;
    render();
  }

  function setCompareSplit(value) {
    compare.split = clamp01(Number.isFinite(Number(value)) ? Number(value) : 0.5);
    render();
  }

  function getCompare() {
    return {...compare};
  }

  function render() {
    if (!imageSource) return;
    const viewRect = getViewRect();
    const [spanX, spanY] = getViewSpan(viewRect.w, viewRect.h);
    const center = clampedViewCenter(view, spanX, spanY);
    view.centerX = center.centerX;
    view.centerY = center.centerY;

    renderLookPass();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.012, 0.020, 0.028, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(vao);

    renderViewComposite(gl, compositeProgram, compositeUniforms, {
      processedTexture,
      sourceTexture,
      viewport: viewRect,
      resolution: [viewRect.w, viewRect.h],
      viewportOrigin: [viewRect.x, viewRect.y],
      viewCenter: [view.centerX, view.centerY],
      viewSpan: [spanX, spanY],
      compareSplit: compare.enabled ? compare.split : -1,
      compareEnabled: compare.enabled
    });

    gl.bindVertexArray(null);
  }

  function renderLookPass() {
    ensureProcessedTarget();
    gl.bindFramebuffer(gl.FRAMEBUFFER, processedFramebuffer);
    gl.viewport(0, 0, imageSize.width, imageSize.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(lookProgram);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);

    const tint = lookTintFromHueDegrees(config.tintHue);
    gl.uniform2f(lookUniforms.u_resolution, imageSize.width, imageSize.height);
    gl.uniform2f(lookUniforms.u_viewport_origin, 0, 0);
    gl.uniform2f(lookUniforms.u_view_center, 0.5, 0.5);
    gl.uniform2f(lookUniforms.u_view_span, 1, 1);
    gl.uniform1f(lookUniforms.u_gamma, config.gamma);
    gl.uniform1f(lookUniforms.u_exposure, config.exposure);
    gl.uniform1f(lookUniforms.u_chroma_gamma, config.chromaGamma);
    gl.uniform1f(lookUniforms.u_chroma_exposure, config.chromaExposure);
    gl.uniform1f(lookUniforms.u_chroma_fade_low, config.chromaFadeLow);
    gl.uniform1f(lookUniforms.u_chroma_fade_high, config.chromaFadeHigh);
    gl.uniform1f(lookUniforms.u_chroma_fade_strength, config.chromaFadeStrength);
    gl.uniform1f(lookUniforms.u_shoulder, config.toneShoulder);
    gl.uniform1f(lookUniforms.u_center, effectiveToneCenter(config));
    gl.uniform1f(lookUniforms.u_curve_strength, config.curveStrength);
    gl.uniform3f(lookUniforms.u_tint, tint[0], tint[1], tint[2]);
    gl.uniform1f(lookUniforms.u_tint_strength, config.tintStrength);
    gl.uniform1f(lookUniforms.u_lift, config.lift);
    gl.uniform1f(lookUniforms.u_midtone, config.midtone);
    gl.uniform1f(lookUniforms.u_gain, config.gain);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function ensureProcessedTarget() {
    const width = Math.max(1, Math.round(imageSize.width || 1));
    const height = Math.max(1, Math.round(imageSize.height || 1));
    if (processedTarget.width === width && processedTarget.height === height) return;

    gl.activeTexture(gl.TEXTURE0);
    allocateRgbaTexture(gl, processedTexture, width, height, {filter: gl.LINEAR});
    gl.bindFramebuffer(gl.FRAMEBUFFER, processedFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, processedTexture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Processed render target is incomplete: ${status}`);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    processedTarget.width = width;
    processedTarget.height = height;
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
    gl.deleteTexture(sourceTexture);
    gl.deleteTexture(processedTexture);
    gl.deleteFramebuffer(processedFramebuffer);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(lookProgram);
    gl.deleteProgram(compositeProgram);
  }

  return {
    loadImage,
    setConfig,
    setCompareEnabled,
    setCompareSplit,
    getCompare,
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

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
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
