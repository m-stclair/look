#version 300 es

precision highp float;

uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform vec2 u_viewport_origin;
uniform vec2 u_view_center;
uniform vec2 u_view_span;
uniform float u_gamma;
uniform float u_exposure;
uniform float u_chroma_gamma;
uniform float u_chroma_exposure;
uniform float u_chroma_fade_strength;
uniform float u_chroma_fade_low;
uniform float u_chroma_fade_high;
uniform float u_shoulder;
uniform float u_center;
uniform float u_curve_strength;
uniform vec3 u_tint;
uniform float u_tint_strength;
uniform float u_lift;
uniform float u_midtone;
uniform float u_gain;

const float PI = 3.141592653589793;
const float sLow = 0.18;
const float sHigh = 0.35;
const float hLow = 0.65;
const float hHigh = 0.8;

out vec4 outColor;

// Inline OKLab conversion code lifted from palette-synth's shader style.
// This extraction intentionally avoids Vandal's broad colorconvert.glsl include.
vec3 srgb2linear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

vec3 linear2srgb(vec3 c) {
    vec3 lo = c * 12.92;
    vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
    return mix(lo, hi, step(0.0031308, c));
}

vec3 linearRgbToOklab(vec3 rgb) {
    float l = 0.4122214708 * rgb.r + 0.5363325363 * rgb.g + 0.0514459929 * rgb.b;
    float m = 0.2119034982 * rgb.r + 0.6806995451 * rgb.g + 0.1073969566 * rgb.b;
    float s = 0.0883024619 * rgb.r + 0.2817188376 * rgb.g + 0.6299787005 * rgb.b;

    float l_ = pow(max(l, 0.0), 1.0 / 3.0);
    float m_ = pow(max(m, 0.0), 1.0 / 3.0);
    float s_ = pow(max(s, 0.0), 1.0 / 3.0);

    return vec3(
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    );
}

vec3 oklabToLinearRgb(vec3 lab) {
    float l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
    float m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
    float s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;

    float l = l_ * l_ * l_;
    float m = m_ * m_ * m_;
    float s = s_ * s_ * s_;

    return vec3(
        +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    );
}

vec3 srgbToOklch(vec3 srgb) {
    vec3 lab = linearRgbToOklab(srgb2linear(clamp(srgb, 0.0, 1.0)));
    float hue = atan(lab.z, lab.y);
    if (hue < 0.0) hue += 2.0 * PI;
    return vec3(clamp(lab.x, 0.0, 1.0), length(lab.yz), hue);
}

vec3 oklchToSrgb(vec3 lch) {
    vec2 ab = lch.y * vec2(cos(lch.z), sin(lch.z));
    return linear2srgb(oklabToLinearRgb(vec3(lch.x, ab.x, ab.y)));
}

float gammaAdjust(float x, float gammaValue) {
    return pow(max(x, 0.0), 1.0 / max(gammaValue, 1e-4));
}

float exposureAdjust(float x, float exposureValue) {
    return x * exp2(exposureValue);
}

// Prevent log2 from going negative infinity.
float safeLog2(float x) {
    return log2(max(x, 1e-6));
}

float applyLiftMidtoneGain(float L, float lift, float midtone, float gain) {
    float shadow = 1.0 - smoothstep(sLow, sHigh, L);
    float mid = smoothstep(sLow, sHigh, L) * (1.0 - smoothstep(hLow, hHigh, L));
    float highlight = smoothstep(hLow, hHigh, L);
    float delta = lift * shadow + midtone * mid + gain * highlight;
    return clamp(L + delta, 0.0, 1.0);
}

vec3 applyLook(vec3 srgb) {
    vec3 lch = srgbToOklch(srgb);

    float luma = clamp(gammaAdjust(exposureAdjust(lch.x, u_exposure), u_gamma), 0.0, 1.0);
    float chroma = max(gammaAdjust(exposureAdjust(lch.y, u_chroma_exposure), u_chroma_gamma), 0.0);
    float hue = lch.z;

    vec2 ab = chroma * vec2(cos(hue), sin(hue));

    float tone_base = applyLiftMidtoneGain(luma, u_lift, u_midtone, u_gain);

    float logL = safeLog2(tone_base);
    float curve = 1.0 / (1.0 + exp(-u_shoulder * (logL - u_center)));
    float tone = mix(tone_base, curve, u_curve_strength);

    float chroma_fade = smoothstep(u_chroma_fade_low, u_chroma_fade_high, luma);
    float chroma_base = mix(chroma, chroma * chroma_fade, u_chroma_fade_strength);

    vec2 ab_base = vec2(0.0);
    if (chroma_base > 1e-5) {
        ab_base = chroma_base * normalize(ab);
    }

    float tone_ratio = clamp(logL - u_center, -2.0, 2.0);
    float tint_lerp = tone_ratio * 0.5 + 0.5;
    vec3 tint_vec = mix(-u_tint, u_tint, tint_lerp) * u_tint_strength;

    float chroma_out = length(ab_base);
    float hue_out = atan(ab_base.y, ab_base.x);
    vec3 lch_out = vec3(tone, chroma_out, hue_out);
    vec3 rgb_out = oklchToSrgb(lch_out) + tint_vec;
    return rgb_out;
}

void main() {
    vec2 local_frag_coord = gl_FragCoord.xy - u_viewport_origin;
    vec2 screen_uv = local_frag_coord / max(u_resolution, vec2(1.0));
    vec2 uv = clamp(u_view_center + (screen_uv - 0.5) * u_view_span, vec2(0.0), vec2(1.0));
    vec4 pix = texture(u_image, uv);
    vec3 looked = applyLook(pix.rgb);
    outColor = vec4(clamp(looked, 0.0, 1.0), pix.a);
}
