import { createWebgl2Context, resizeDrawingBuffer } from "./gl/context.js";
import { linkProgram } from "./gl/programs.js";
import {
  allocateRgbaTexture,
  createTexture,
  resolveFloatReadbackTextureFormat,
  resolveRenderTextureFormat,
  uploadImageTexture,
  uploadRgbaFloatTexture
} from "./gl/textures.js";
import { renderViewComposite, VIEW_COMPOSITE_UNIFORM_NAMES } from "./gl/view-composite-renderer.js";
import { cloneDefaultConfig } from "./config.js";
import {
  createCubeInputPixels,
  createCubeLutText,
  cubeTextureDimensions,
  DEFAULT_LUT_SIZE,
  downloadCubeLutText,
  normalizeLutSize
} from "./cube-lut.js";
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
  "u_chroma_fade_region",
  "u_chroma_fade_center",
  "u_chroma_fade_softness",
  "u_shoulder",
  "u_tone_center",
  "u_curve_strength",
  "u_tint_low",
  "u_tint_high",
  "u_tint_low_strength",
  "u_tint_high_strength",
  "u_tint_center",
  "u_hue_window_center",
  "u_hue_window_chroma",
  "u_hue_window_width",
  "u_hue_window_softness",
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
  let processedTextureFormat = resolveRenderTextureFormat(gl);
  const compare = {enabled: false, split: 0.5};
  let config = cloneDefaultConfig();
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
    config = nextConfig || config;
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
    renderLookPassToTarget({
      inputTexture: sourceTexture,
      framebuffer: processedFramebuffer,
      width: imageSize.width,
      height: imageSize.height
    });
  }

  function renderLookPassToTarget({inputTexture, framebuffer, width, height}) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(lookProgram);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    setLookUniforms(width, height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  function setLookUniforms(width, height) {
    const tintLow = lookTintFromHueDegrees(config.tintLowHue);
    const tintHigh = lookTintFromHueDegrees(config.tintHighHue);
    gl.uniform2f(lookUniforms.u_resolution, width, height);
    gl.uniform2f(lookUniforms.u_viewport_origin, 0, 0);
    gl.uniform2f(lookUniforms.u_view_center, 0.5, 0.5);
    gl.uniform2f(lookUniforms.u_view_span, 1, 1);
    gl.uniform1f(lookUniforms.u_gamma, config.gamma);
    gl.uniform1f(lookUniforms.u_exposure, config.exposure);
    gl.uniform1f(lookUniforms.u_chroma_gamma, config.chromaGamma);
    gl.uniform1f(lookUniforms.u_chroma_exposure, config.chromaExposure);
    gl.uniform1f(lookUniforms.u_chroma_fade_strength, config.chromaFadeStrength);
    gl.uniform1f(lookUniforms.u_chroma_fade_region, config.chromaFadeRegion);
    gl.uniform1f(lookUniforms.u_chroma_fade_center, config.chromaFadeCenter);
    gl.uniform1f(lookUniforms.u_chroma_fade_softness, config.chromaFadeSoftness);
    gl.uniform1f(lookUniforms.u_shoulder, config.toneShoulder);
    gl.uniform1f(lookUniforms.u_tone_center, effectiveToneCenter(config));
    gl.uniform1f(lookUniforms.u_curve_strength, config.curveStrength);
    gl.uniform3f(lookUniforms.u_tint_low, tintLow[0], tintLow[1], tintLow[2]);
    gl.uniform3f(lookUniforms.u_tint_high, tintHigh[0], tintHigh[1], tintHigh[2]);
    gl.uniform1f(lookUniforms.u_tint_low_strength, config.tintLowStrength);
    gl.uniform1f(lookUniforms.u_tint_high_strength, config.tintHighStrength);
    gl.uniform1f(lookUniforms.u_tint_center, config.tintAxisCenter);
    gl.uniform1f(lookUniforms.u_hue_window_center, config.hueWindowCenter);
    gl.uniform1f(lookUniforms.u_hue_window_chroma, config.hueWindowChroma);
    gl.uniform1f(lookUniforms.u_hue_window_width, config.hueWindowWidth);
    gl.uniform1f(lookUniforms.u_hue_window_softness, config.hueWindowSoftness);
    gl.uniform1f(lookUniforms.u_lift, config.lift);
    gl.uniform1f(lookUniforms.u_midtone, config.midtone);
    gl.uniform1f(lookUniforms.u_gain, config.gain);
  }

  function ensureProcessedTarget() {
    const width = Math.max(1, Math.round(imageSize.width || 1));
    const height = Math.max(1, Math.round(imageSize.height || 1));
    if (processedTarget.width === width && processedTarget.height === height) return;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, processedFramebuffer);

    let status = allocateProcessedTarget(width, height, processedTextureFormat);
    if (status !== gl.FRAMEBUFFER_COMPLETE && processedTextureFormat.halfFloat) {
      processedTextureFormat = resolveRenderTextureFormat(gl, {preferHalfFloat: false});
      status = allocateProcessedTarget(width, height, processedTextureFormat);
    }

    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      throw new Error(`Processed render target is incomplete: ${status}`);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    processedTarget.width = width;
    processedTarget.height = height;
  }

  function allocateProcessedTarget(width, height, pixelFormat) {
    allocateRgbaTexture(gl, processedTexture, width, height, {
      filter: gl.LINEAR,
      pixelFormat
    });
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, processedTexture, 0);
    return gl.checkFramebufferStatus(gl.FRAMEBUFFER);
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

  function exportCubeLut({name = "Look", size = DEFAULT_LUT_SIZE} = {}) {
    const lutSize = normalizeLutSize(size);
    const readbackPixels = renderCubeLutPixels(lutSize);
    const text = createCubeLutText(readbackPixels, {size: lutSize, title: name});
    downloadCubeLutText({name, size: lutSize, text});
    return text;
  }

  function renderCubeLutPixels(size) {
    const lutSize = normalizeLutSize(size);
    const {width, height} = cubeTextureDimensions(lutSize);
    assertCanRenderCubeTexture(width, height, lutSize);

    const outputFormat = resolveFloatReadbackTextureFormat(gl);
    const lutSourceTexture = createTexture(gl);
    const lutOutputTexture = createTexture(gl);
    const lutFramebuffer = gl.createFramebuffer();
    const readbackPixels = new Float32Array(width * height * 4);

    try {
      gl.activeTexture(gl.TEXTURE0);
      uploadRgbaFloatTexture(gl, lutSourceTexture, width, height, createCubeInputPixels(lutSize), {filter: gl.NEAREST});
      gl.bindFramebuffer(gl.FRAMEBUFFER, lutFramebuffer);
      allocateRgbaTexture(gl, lutOutputTexture, width, height, {filter: gl.NEAREST, pixelFormat: outputFormat});
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lutOutputTexture, 0);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`CUBE LUT render target is incomplete: ${status}`);
      }

      renderLookPassToTarget({
        inputTexture: lutSourceTexture,
        framebuffer: lutFramebuffer,
        width,
        height
      });
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, readbackPixels);
      assertNoGlError("CUBE LUT readback failed");
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindVertexArray(null);
      gl.deleteTexture(lutSourceTexture);
      gl.deleteTexture(lutOutputTexture);
      gl.deleteFramebuffer(lutFramebuffer);
      if (imageSource) render();
    }

    return readbackPixels;
  }

  function assertCanRenderCubeTexture(width, height, size) {
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const maxViewportDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    const maxWidth = Math.min(maxTextureSize, maxViewportDims[0]);
    const maxHeight = Math.min(maxTextureSize, maxViewportDims[1]);
    if (width <= maxWidth && height <= maxHeight) return;

    const maxSize = Math.min(maxHeight, Math.floor(Math.sqrt(Math.max(1, maxWidth))));
    throw new Error(
      `A ${size}-point CUBE LUT needs a ${width}×${height} shader readback target, but this WebGL context supports up to ${maxWidth}×${maxHeight}. Try ${maxSize}-point or smaller.`
    );
  }

  function assertNoGlError(message) {
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error(`${message}: WebGL error ${error}`);
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
    exportCubeLut,
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
