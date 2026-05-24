import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateRgbaTexture,
  resolveFloatReadbackTextureFormat,
  resolveRenderTextureFormat,
  supportsFloatRenderTargets,
  supportsHalfFloatRenderTargets,
  uploadRgbaFloatTexture
} from "../src/gl/textures.js";

function createFakeGl({floatTargets = false} = {}) {
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
    RGBA32F: 34836,
    FLOAT: 5126,
    HALF_FLOAT: 5131,
    UNSIGNED_BYTE: 5121,
    UNPACK_FLIP_Y_WEBGL: 37440,
    bindTexture() {},
    texParameteri() {},
    pixelStorei(...args) {
      calls.push(["pixelStorei", ...args]);
    },
    getExtension(name) {
      calls.push(["getExtension", name]);
      return floatTargets && name === "EXT_color_buffer_float" ? {} : null;
    },
    texImage2D(...args) {
      calls.push(["texImage2D", ...args]);
    }
  };
  return {gl, calls};
}

test("float render target support uses EXT_color_buffer_float", () => {
  const {gl: supportedGl} = createFakeGl({floatTargets: true});
  const {gl: unsupportedGl} = createFakeGl({floatTargets: false});

  assert.equal(supportsFloatRenderTargets(supportedGl), true);
  assert.equal(supportsHalfFloatRenderTargets(supportedGl), true);
  assert.equal(supportsFloatRenderTargets(unsupportedGl), false);
  assert.equal(supportsHalfFloatRenderTargets(unsupportedGl), false);
});

test("resolveRenderTextureFormat prefers RGBA16F when supported", () => {
  const {gl} = createFakeGl({floatTargets: true});
  assert.deepEqual(resolveRenderTextureFormat(gl), {
    internalFormat: gl.RGBA16F,
    format: gl.RGBA,
    type: gl.HALF_FLOAT,
    halfFloat: true,
    label: "RGBA16F"
  });
});

test("resolveRenderTextureFormat falls back to RGBA8 when half-float is unavailable", () => {
  const {gl} = createFakeGl({floatTargets: false});
  assert.deepEqual(resolveRenderTextureFormat(gl), {
    internalFormat: gl.RGBA,
    format: gl.RGBA,
    type: gl.UNSIGNED_BYTE,
    halfFloat: false,
    label: "RGBA8"
  });
});

test("resolveFloatReadbackTextureFormat requires a float render target", () => {
  const {gl: supportedGl} = createFakeGl({floatTargets: true});
  assert.deepEqual(resolveFloatReadbackTextureFormat(supportedGl), {
    internalFormat: supportedGl.RGBA32F,
    format: supportedGl.RGBA,
    type: supportedGl.FLOAT,
    float: true,
    label: "RGBA32F"
  });

  const {gl: unsupportedGl} = createFakeGl({floatTargets: false});
  assert.throws(() => resolveFloatReadbackTextureFormat(unsupportedGl), /Floating-point render target readback/);
});

test("allocateRgbaTexture uploads render targets with the selected pixel format", () => {
  const {gl, calls} = createFakeGl({floatTargets: true});
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

test("uploadRgbaFloatTexture sends unflipped RGBA32F data for shader LUT input", () => {
  const {gl, calls} = createFakeGl({floatTargets: true});
  const pixels = new Float32Array(4 * 4);

  uploadRgbaFloatTexture(gl, {}, 2, 2, pixels);

  assert.deepEqual(calls.find(([name]) => name === "pixelStorei"), ["pixelStorei", gl.UNPACK_FLIP_Y_WEBGL, false]);
  const texImageCall = calls.find(([name]) => name === "texImage2D");
  assert.deepEqual(texImageCall, [
    "texImage2D",
    gl.TEXTURE_2D,
    0,
    gl.RGBA32F,
    2,
    2,
    0,
    gl.RGBA,
    gl.FLOAT,
    pixels
  ]);
});
