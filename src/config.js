export const DEFAULT_CONFIG = Object.freeze({
  gamma: 1,
  exposure: 0,
  chromaGamma: 1,
  chromaExposure: 0,
  toneShoulder: 2.5,
  tonePivotNudge: 0,
  curveStrength: 0,
  chromaFadeStrength: 0,
  chromaFadeLow: -3,
  chromaFadeHigh: 2,
  tintHue: 68,
  tintStrength: 0,
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
  "chromaFadeLow",
  "chromaFadeHigh"
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
      {key: "toneShoulder", label: "Shoulder", min: 1, max: 6, step: 0.02}
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
    description: "Saturation scale with a lightness-based rolloff window.",
    controls: [
      {key: "chromaFadeStrength", label: "Fade Strength", min: 0, max: 1, step: 0.01},
      {key: "chromaFadeLow", label: "Fade Low", min: -6, max: 6, step: 0.1},
      {key: "chromaFadeHigh", label: "Fade High", min: -6, max: 6, step: 0.1}
    ]
  },
  {
    id: "tint",
    label: "Tint",
    description: "Bipolar hue push around the tone curve center.",
    controls: [
      {key: "tintStrength", label: "Tint Strength", min: 0, max: 1, step: 0.01},
      {key: "tintHue", label: "Tint Hue", min: 0, max: 360, step: 0.01, suffix: "°"}
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

export function normalizeConfig(config = {}) {
  return {...DEFAULT_CONFIG, ...config};
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
