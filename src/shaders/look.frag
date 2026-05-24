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
uniform float u_chroma_fade_region;
uniform float u_chroma_fade_center;
uniform float u_chroma_fade_softness;
uniform float u_shoulder;
uniform float u_tone_center;
uniform float u_curve_strength;
uniform vec3 u_tint_low;
uniform vec3 u_tint_high;
uniform float u_tint_strength;
uniform float u_tint_center;
uniform float u_lift;
uniform float u_midtone;
uniform float u_gain;

const float PI = 3.141592653589793;
const float sLow = 0.18;
const float sHigh = 0.35;
const float hLow = 0.65;
const float hHigh = 0.8;
const vec3 rgbLuma = vec3(0.2126, 0.7152, 0.0722);
const float tintRgbScale = 0.22;

out vec4 outColor;

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

float logit(float x) {
    float safe_x = clamp(x, 1e-6, 1.0 - 1e-6);
    return log(safe_x / (1.0 - safe_x));
}

float invLogit(float x) {
    if (x >= 0.0) {
        float z = exp(-x);
        return 1.0 / (1.0 + z);
    }
    float z = exp(x);
    return z / (1.0 + z);
}

float toneSlopeFromControls(float strength, float shoulder) {
    return mix(1.0, max(shoulder, 1e-4), clamp(strength, 0.0, 1.0));
}

float pivotedLogitCurve(float L, float pivot, float slope) {
    if (L <= 0.0) return 0.0;
    if (L >= 1.0) return 1.0;
    float safe_pivot = clamp(pivot, 1e-6, 1.0 - 1e-6);
    float safe_slope = max(slope, 1e-4);
    if (abs(safe_slope - 1.0) < 1e-6) return L;
    float t = logit(safe_pivot) + safe_slope * (logit(L) - logit(safe_pivot));
    return clamp(invLogit(t), 0.0, 1.0);
}

float applyLiftMidtoneGain(float L, float lift, float midtone, float gain) {
    float shadow = 1.0 - smoothstep(sLow, sHigh, L);
    float mid = smoothstep(sLow, sHigh, L) * (1.0 - smoothstep(hLow, hHigh, L));
    float highlight = smoothstep(hLow, hHigh, L);
    float delta = lift * shadow + midtone * mid + gain * highlight;
    return clamp(L + delta, 0.0, 1.0);
}

vec3 lumaNeutralDye(vec3 rgb) {
    float y = dot(rgb, rgbLuma);
    vec3 dye = rgb - vec3(y);
    float m = max(max(abs(dye.r), abs(dye.g)), abs(dye.b));
    return m > 1e-6 ? dye / m : vec3(0.0);
}

float tintHeadroomScale(vec3 base, vec3 delta) {
    float scale = 1.0;

    if (delta.r > 1e-6) scale = min(scale, base.r < 1.0 ? (1.0 - base.r) / delta.r : 0.0);
    else if (delta.r < -1e-6) scale = min(scale, base.r > 0.0 ? -base.r / delta.r : 0.0);

    if (delta.g > 1e-6) scale = min(scale, base.g < 1.0 ? (1.0 - base.g) / delta.g : 0.0);
    else if (delta.g < -1e-6) scale = min(scale, base.g > 0.0 ? -base.g / delta.g : 0.0);

    if (delta.b > 1e-6) scale = min(scale, base.b < 1.0 ? (1.0 - base.b) / delta.b : 0.0);
    else if (delta.b < -1e-6) scale = min(scale, base.b > 0.0 ? -base.b / delta.b : 0.0);

    return clamp(scale, 0.0, 1.0);
}

vec3 applyLumaNeutralTint(vec3 rgb_base, vec3 tint_vec) {
    float tint_mag = max(max(abs(tint_vec.r), abs(tint_vec.g)), abs(tint_vec.b));
    if (tint_mag <= 1e-8) return rgb_base;

    // Keep existing tone/chroma exactly as the base path produced it.
    // Only scale the added dye when the dye itself would create new gamut damage.
    return rgb_base + tint_vec * tintHeadroomScale(rgb_base, tint_vec);
}

vec3 applyLook(vec3 srgb) {
    vec3 lch = srgbToOklch(srgb);

    float luma = clamp(gammaAdjust(exposureAdjust(lch.x, u_exposure), u_gamma), 0.0, 1.0);
    float chroma = max(gammaAdjust(exposureAdjust(lch.y, u_chroma_exposure), u_chroma_gamma), 0.0);
    float hue = lch.z;

    vec2 ab = chroma * vec2(cos(hue), sin(hue));

    float logL = safeLog2(luma);
    float pivot = exp2(u_tone_center);
    float tone_slope = toneSlopeFromControls(u_curve_strength, u_shoulder);
    float tone_base = pivotedLogitCurve(luma, pivot, tone_slope);
    float tone = applyLiftMidtoneGain(tone_base, u_lift, u_midtone, u_gain);

    float chroma_fade_low = u_chroma_fade_center - u_chroma_fade_softness * 0.5;
    float chroma_fade_high = u_chroma_fade_center + u_chroma_fade_softness * 0.5;
    float chroma_fade_ramp = smoothstep(chroma_fade_low, chroma_fade_high, luma);
    float chroma_fade = mix(chroma_fade_ramp, 1.0 - chroma_fade_ramp, step(0.5, u_chroma_fade_region));
    float chroma_base = mix(chroma, chroma * chroma_fade, u_chroma_fade_strength);

    vec2 ab_base = vec2(0.0);
    if (chroma_base > 1e-5) {
        ab_base = chroma_base * normalize(ab);
    }

    float tint_side = clamp(logL - u_tint_center, -2.0, 2.0);
    float tint_low_weight = max(-tint_side, 0.0);
    float tint_high_weight = max(tint_side, 0.0);
    vec3 tint_low_dye = lumaNeutralDye(u_tint_low);
    vec3 tint_high_dye = lumaNeutralDye(u_tint_high);
    vec3 tint_vec = (tint_low_dye * tint_low_weight + tint_high_dye * tint_high_weight) * u_tint_strength * tintRgbScale;

    float chroma_out = length(ab_base);
    float hue_out = atan(ab_base.y, ab_base.x);
    vec3 lch_out = vec3(tone, chroma_out, hue_out);
    vec3 rgb_base = oklchToSrgb(lch_out);
    if (u_tint_strength <= 0.0) return rgb_base;
    return applyLumaNeutralTint(rgb_base, tint_vec);
}

void main() {
    vec2 local_frag_coord = gl_FragCoord.xy - u_viewport_origin;
    vec2 screen_uv = local_frag_coord / max(u_resolution, vec2(1.0));
    vec2 uv = clamp(u_view_center + (screen_uv - 0.5) * u_view_span, vec2(0.0), vec2(1.0));
    vec4 pix = texture(u_image, uv);
    vec3 looked = applyLook(pix.rgb);
    outColor = vec4(clamp(looked, 0.0, 1.0), pix.a);
}
