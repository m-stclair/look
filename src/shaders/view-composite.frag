#version 300 es
precision highp float;

// Final viewport blit used for before/after comparison.
// The Look pass renders the adjusted image at source resolution. This pass
// applies zoom/pan and, when compare is enabled, samples the original source
// texture on the left side of the split with a crisp divider overlay.

uniform sampler2D u_image;   // adjusted image, source resolution
uniform sampler2D u_source;  // original source image, source resolution
uniform vec2 u_resolution;
uniform vec2 u_viewportOrigin;
uniform vec2 u_viewCenter;
uniform vec2 u_viewSpan;
uniform float u_compareSplit;
uniform int u_compareEnabled;

out vec4 outColor;

void main() {
    vec2 localFragCoord = gl_FragCoord.xy - u_viewportOrigin;
    vec2 screenUv = localFragCoord / max(u_resolution, vec2(1.0));
    vec2 uv = clamp(u_viewCenter + (screenUv - 0.5) * u_viewSpan, vec2(0.0), vec2(1.0));

    vec4 adjusted = texture(u_image, uv);
    vec4 source = texture(u_source, uv);

    if (u_compareEnabled == 1 && u_compareSplit >= 0.0) {
        float lineWidth = max(1.5 / max(u_resolution.x, 1.0), 0.0015);
        float distToSplit = abs(screenUv.x - u_compareSplit);

        if (distToSplit <= lineWidth) {
            float core = step(distToSplit, lineWidth * 0.45);
            vec3 lineColor = mix(vec3(0.02), vec3(1.0), core);
            outColor = vec4(lineColor, 1.0);
            return;
        }

        if (screenUv.x < u_compareSplit) {
            outColor = source;
            return;
        }
    }

    outColor = adjusted;
}
