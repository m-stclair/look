import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shaderPath = new URL("../src/shaders/look.frag", import.meta.url);
const compositeShaderPath = new URL("../src/shaders/view-composite.frag", import.meta.url);

const requiredUniforms = [
  "u_resolution",
  "u_gamma",
  "u_exposure",
  "u_chroma_gamma",
  "u_chroma_exposure",
  "u_chroma_fade_strength",
  "u_tone_center",
  "u_shoulder",
  "u_lift",
  "u_midtone",
  "u_gain",
  "u_chroma_fade_low",
  "u_chroma_fade_high",
  "u_tint_low",
  "u_tint_high",
  "u_tint_strength",
  "u_tint_center",
  "u_curve_strength"
];


test("look shader requests high precision floats for color math", async () => {
  const source = await readFile(shaderPath, "utf8");
  assert.match(source, /precision\s+highp\s+float/);
});

test("look shader has no external include dependency", async () => {
  const source = await readFile(shaderPath, "utf8");
  assert.equal(source.includes("#include"), false);
});

test("look shader inlines palette-synth style OKLab helpers", async () => {
  const source = await readFile(shaderPath, "utf8");
  assert.match(source, /vec3\s+srgb2linear/);
  assert.match(source, /vec3\s+linear2srgb/);
  assert.match(source, /vec3\s+linearRgbToOklab/);
  assert.match(source, /vec3\s+oklabToLinearRgb/);
  assert.match(source, /vec3\s+srgbToOklch/);
  assert.match(source, /vec3\s+oklchToSrgb/);
});

test("look shader keeps uniform surface and adjustment uniforms", async () => {
  const source = await readFile(shaderPath, "utf8");
  for (const uniform of requiredUniforms) {
    assert.ok(source.includes(uniform), `Missing ${uniform}`);
  }
});

test("look shader includes gamma and exposure shaping helpers", async () => {
  const source = await readFile(shaderPath, "utf8");
  assert.match(source, /float\s+gammaAdjust\s*\(/);
  assert.match(source, /float\s+exposureAdjust\s*\(/);
  assert.match(source, /gammaAdjust\(exposureAdjust\(lch\.x, u_exposure\), u_gamma\)/);
  assert.match(source, /gammaAdjust\(exposureAdjust\(lch\.y, u_chroma_exposure\), u_chroma_gamma\)/);
});


test("look shader applies tint as luma-neutral RGB dye scaled against tint headroom", async () => {
  const source = await readFile(shaderPath, "utf8");
  assert.match(source, /const\s+vec3\s+rgbLuma\s*=\s*vec3\(0\.2126,\s*0\.7152,\s*0\.0722\)/);
  assert.match(source, /vec3\s+lumaNeutralDye\s*\(/);
  assert.match(source, /float\s+tintHeadroomScale\s*\(/);
  assert.match(source, /vec3\s+applyLumaNeutralTint\s*\(/);
  assert.match(source, /float\s+tint_low_weight\s*=\s*max\(-tint_side,\s*0\.0\)/);
  assert.match(source, /float\s+tint_high_weight\s*=\s*max\(tint_side,\s*0\.0\)/);
  assert.match(source, /lumaNeutralDye\(u_tint_low\)/);
  assert.match(source, /lumaNeutralDye\(u_tint_high\)/);
  assert.match(source, /applyLumaNeutralTint\(rgb_base,\s*tint_vec\)/);
  assert.doesNotMatch(source, /vec3\s+tint_axis\s*=/);
  assert.doesNotMatch(source, /oklchToSrgb\(lch_out\)\s*\+\s*tint_vec/);
  assert.doesNotMatch(source, /ab_tinted/);
});


test("view composite shader handles before/after compare in a final pass", async () => {
  const source = await readFile(compositeShaderPath, "utf8");
  assert.match(source, /uniform\s+sampler2D\s+u_image/);
  assert.match(source, /uniform\s+sampler2D\s+u_source/);
  assert.match(source, /uniform\s+float\s+u_compareSplit/);
  assert.match(source, /uniform\s+int\s+u_compareEnabled/);
  assert.match(source, /screenUv\.x\s*<\s*u_compareSplit/);
});
