export const DEFAULT_CONFIG = Object.freeze({
  gamma: 1,
  exposure: 0,
  chromaGamma: 1,
  chromaExposure: 0,
  toneShoulder: 2.5,
  tonePivotNudge: 0,
  curveStrength: 0,
  chromaFadeStrength: 0,
  chromaFadeRegion: 0,
  chromaFadeCenter: 0.5,
  chromaFadeSoftness: 1,
  tintLowHue: 248,
  tintHighHue: 68,
  tintLowStrength: 0,
  tintHighStrength: 0,
  tintAxisCenter: 0.5,
  tintStrength: 0,
  hueWindowCenter: 0,
  hueWindowChroma: 0,
  hueWindowWidth: 50,
  hueWindowSoftness: 0.45,
  lift: 0,
  midtone: 0,
  gain: 0
});

export const TONE_MAP_CONTROL_KEYS = Object.freeze([
  "exposure",
  "gamma",
  "curveStrength",
  "toneShoulder",
  "tonePivotNudge",
  "lift",
  "midtone",
  "gain"
]);

export const CHROMA_MAP_CONTROL_KEYS = Object.freeze([
  "chromaExposure",
  "chromaGamma",
  "chromaFadeStrength",
  "chromaFadeRegion",
  "chromaFadeCenter",
  "chromaFadeSoftness"
]);

export const HUE_WINDOW_CONTROL_KEYS = Object.freeze([
  "hueWindowCenter",
  "hueWindowChroma",
  "hueWindowWidth",
  "hueWindowSoftness"
]);

export const CONTROL_GROUPS = Object.freeze([
  {
    id: "adjustments",
    label: "Adjustments",
    description: "Primary gamma and exposure shaping for lightness and chroma.",
    controls: [
      {key: "gamma", label: "Gamma", min: 0.1, max: 4, step: 0.01},
      {key: "exposure", label: "Exposure", min: -5, max: 5, step: 0.05},
      {key: "chromaGamma", label: "Chroma Gamma", min: 0.1, max: 4, step: 0.01},
      {key: "chromaExposure", label: "Chroma Exposure", min: -5, max: 5, step: 0.05}
    ]
  },
  {
    id: "tone",
    label: "Tone Curve",
    description: "Pivoted S-curve character: slope and shoulder; the S handle nudges the anchor horizontally.",
    controls: [
      {key: "curveStrength", label: "Tone Amount", min: 0, max: 1, step: 0.01},
      {key: "toneShoulder", label: "Shoulder", min: 0.3, max: 6, step: 0.02}
    ],
    hiddenControls: [
      {key: "tonePivotNudge", label: "Pivot Nudge", min: -1, max: 1, step: 0.001}
    ]
  },
  {
    id: "tonal-balance",
    label: "Tonal Balance",
    description: "Post-curve lift, midtone, and gain trim.",
    controls: [
      {key: "lift", label: "Lift", min: -0.2, max: 0.2, step: 0.01},
      {key: "midtone", label: "Midtone", min: -0.2, max: 0.2, step: 0.01},
      {key: "gain", label: "Gain", min: -0.2, max: 0.2, step: 0.01}
    ]
  },
  {
    id: "chroma",
    label: "Chroma Fade",
    description: "A luma mask that scales chroma by brightness.",
    controls: [
      {key: "chromaFadeStrength", label: "Amount", min: 0, max: 1, step: 0.01},
      {key: "chromaFadeCenter", label: "Center", min: 0, max: 1, step: 0.01},
      {key: "chromaFadeSoftness", label: "Softness", min: 0.02, max: 1, step: 0.01}
    ],
    hiddenControls: [
      {key: "chromaFadeRegion", label: "Region", min: 0, max: 1, step: 1}
    ]
  },
  {
    id: "hue-window",
    label: "Hue Window",
    description: "A single hue notch that boosts or cuts chroma inside a soft hue window.",
    controls: [
      {key: "hueWindowCenter", label: "Center Hue", min: 0, max: 360, step: 0.01, suffix: "°"},
      {key: "hueWindowChroma", label: "Chroma", min: -1, max: 1, step: 0.01},
      {key: "hueWindowWidth", label: "Width", min: 1, max: 325, step: 0.5, suffix: "°"},
      {key: "hueWindowSoftness", label: "Softness", min: 0, max: 1, step: 0.01}
    ]
  },
  {
    id: "tint",
    label: "Tint",
    description: "Two-ended luma-neutral RGB dye with an independent crossover point.",
    controls: [
      {key: "tintLowHue", label: "Low Hue", min: 0, max: 360, step: 0.01, suffix: "°"},
      {key: "tintHighHue", label: "High Hue", min: 0, max: 360, step: 0.01, suffix: "°"},
      {key: "tintLowStrength", label: "Low Strength", min: 0, max: 1, step: 0.01},
      {key: "tintHighStrength", label: "High Strength", min: 0, max: 1, step: 0.01},
      {key: "tintAxisCenter", label: "Crossover Luma", min: 0, max: 1, step: 0.01}
    ],
    hiddenControls: [
      {key: "tintStrength", label: "Legacy Tint Strength", min: 0, max: 1, step: 0.01}
    ]
  }
]);

export function groupControlDefinitions(group) {
  return [...(group.controls || []), ...(group.hiddenControls || [])];
}

export function visibleControlDefinitions(group) {
  return [...(group.controls || [])];
}

export function cloneDefaultConfig() {
  return {...DEFAULT_CONFIG};
}

export function resetControlGroup(config, groupId) {
  const group = CONTROL_GROUPS.find(candidate => candidate.id === groupId);
  if (!group) throw new Error(`Unknown control group: ${groupId}`);
  for (const control of groupControlDefinitions(group)) {
    config[control.key] = DEFAULT_CONFIG[control.key];
  }
  return config;
}

export function resetToneMapConfig(config) {
  for (const key of TONE_MAP_CONTROL_KEYS) {
    config[key] = DEFAULT_CONFIG[key];
  }
  return config;
}

export function resetChromaMapConfig(config) {
  for (const key of CHROMA_MAP_CONTROL_KEYS) {
    config[key] = DEFAULT_CONFIG[key];
  }
  return config;
}

export function resetHueWindowConfig(config) {
  for (const key of HUE_WINDOW_CONTROL_KEYS) {
    config[key] = DEFAULT_CONFIG[key];
  }
  return config;
}

export const TINT_CONTROL_KEYS = Object.freeze(["tintLowHue", "tintHighHue", "tintLowStrength", "tintHighStrength", "tintAxisCenter", "tintStrength"]);

export function resetTintConfig(config) {
  for (const key of TINT_CONTROL_KEYS) {
    config[key] = DEFAULT_CONFIG[key];
  }
  return config;
}
