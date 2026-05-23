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

export function allocateRgbaTexture(gl, texture, width, height, {filter = gl.LINEAR} = {}) {
  configureTexture(gl, texture, {filter});
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    Math.max(1, Math.round(width)),
    Math.max(1, Math.round(height)),
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null
  );
}
