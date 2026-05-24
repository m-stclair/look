import assert from "node:assert/strict";
import test from "node:test";
import { allocateRgbaTexture, resolveRenderTextureFormat, supportsHalfFloatRenderTargets } from "../src/gl/textures.js";

function createFakeGl({halfFloat = false} = {}) {
  const calls = [];
  const gl = {
    TEXTURE_2D: 3553,
    TEXTURE_MIN_FILTER: 10241,
    TEXTURE_MAG_FILTER: 10240,
    TEXTURE_WRAP_S: 10242,
    TEXTURE_WRAP_T: 10243,
    CLAMP_TO_EDGE: 33071,
    NEAREST: 9728,
    LINEAR: 9729,
    RGBA: 6408,
    RGBA16F: 34842,
    HALF_FLOAT: 5131,
    UNSIGNED_BYTE: 5121,
    bindTexture() {},
    texParameteri() {},
    getExtension(name) {
      calls.push(["getExtension", name]);
      return halfFloat && name === "EXT_color_buffer_float" ? {} : null;
    },
    texImage2D(...args) {
      calls.push(["texImage2D", ...args]);
    }
  };
  return {gl, calls};
}

test("supportsHalfFloatRenderTargets uses EXT_color_buffer_float", () => {
  const {gl: supportedGl} = createFakeGl({halfFloat: true});
  const {gl: unsupportedGl} = createFakeGl({halfFloat: false});

  assert.equal(supportsHalfFloatRenderTargets(supportedGl), true);
  assert.equal(supportsHalfFloatRenderTargets(unsupportedGl), false);
});

test("resolveRenderTextureFormat prefers RGBA16F when supported", () => {
  const {gl} = createFakeGl({halfFloat: true});
  assert.deepEqual(resolveRenderTextureFormat(gl), {
    internalFormat: gl.RGBA16F,
    format: gl.RGBA,
    type: gl.HALF_FLOAT,
    halfFloat: true,
    label: "RGBA16F"
  });
});

test("resolveRenderTextureFormat falls back to RGBA8 when half-float is unavailable", () => {
  const {gl} = createFakeGl({halfFloat: false});
  assert.deepEqual(resolveRenderTextureFormat(gl), {
    internalFormat: gl.RGBA,
    format: gl.RGBA,
    type: gl.UNSIGNED_BYTE,
    halfFloat: false,
    label: "RGBA8"
  });
});

test("allocateRgbaTexture uploads render targets with the selected pixel format", () => {
  const {gl, calls} = createFakeGl({halfFloat: true});
  const pixelFormat = resolveRenderTextureFormat(gl);

  allocateRgbaTexture(gl, {}, 1920.4, 1080.6, {pixelFormat});

  const texImageCall = calls.find(([name]) => name === "texImage2D");
  assert.deepEqual(texImageCall, [
    "texImage2D",
    gl.TEXTURE_2D,
    0,
    gl.RGBA16F,
    1920,
    1081,
    0,
    gl.RGBA,
    gl.HALF_FLOAT,
    null
  ]);
});
