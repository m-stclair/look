export function createTexture(gl) {
  return gl.createTexture();
}

export function configureTexture(gl, texture, {filter = gl.NEAREST} = {}) {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

export function uploadImageTexture(gl, texture, imageSource, {filter = gl.NEAREST} = {}) {
  configureTexture(gl, texture, {filter});
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageSource);
}

export function supportsFloatRenderTargets(gl) {
  return !!gl?.getExtension?.("EXT_color_buffer_float");
}

export function supportsHalfFloatRenderTargets(gl) {
  return supportsFloatRenderTargets(gl);
}

export function resolveRenderTextureFormat(gl, {preferHalfFloat = true} = {}) {
  if (preferHalfFloat && supportsHalfFloatRenderTargets(gl) && Number.isFinite(gl?.RGBA16F) && Number.isFinite(gl?.HALF_FLOAT)) {
    return {
      internalFormat: gl.RGBA16F,
      format: gl.RGBA,
      type: gl.HALF_FLOAT,
      halfFloat: true,
      label: "RGBA16F"
    };
  }

  return {
    internalFormat: gl.RGBA,
    format: gl.RGBA,
    type: gl.UNSIGNED_BYTE,
    halfFloat: false,
    label: "RGBA8"
  };
}

export function resolveFloatReadbackTextureFormat(gl) {
  if (!supportsFloatRenderTargets(gl) || !Number.isFinite(gl?.RGBA32F) || !Number.isFinite(gl?.FLOAT)) {
    throw new Error("Floating-point render target readback is required for shader-based CUBE LUT export.");
  }

  return {
    internalFormat: gl.RGBA32F,
    format: gl.RGBA,
    type: gl.FLOAT,
    float: true,
    label: "RGBA32F"
  };
}

export function uploadRgbaFloatTexture(gl, texture, width, height, pixels, {filter = gl.NEAREST} = {}) {
  configureTexture(gl, texture, {filter});
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA32F,
    Math.max(1, Math.round(width)),
    Math.max(1, Math.round(height)),
    0,
    gl.RGBA,
    gl.FLOAT,
    pixels
  );
}

export function allocateRgbaTexture(gl, texture, width, height, {
  filter = gl.LINEAR,
  pixelFormat = resolveRenderTextureFormat(gl)
} = {}) {
  configureTexture(gl, texture, {filter});
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    pixelFormat.internalFormat,
    Math.max(1, Math.round(width)),
    Math.max(1, Math.round(height)),
    0,
    pixelFormat.format,
    pixelFormat.type,
    null
  );
  return pixelFormat;
}
