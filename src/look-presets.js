import { createLook } from "./look-serialization.js";

export const BUILT_IN_LOOKS = Object.freeze([
  createLook({
    id: "builtin-default",
    name: "Base",
    builtIn: true,
    config: {}
  }),
  createLook({
    id: "builtin-warm-contrast",
    name: "Warm Contrast",
    builtIn: true,
    config: {
      exposure: 0.05,
      gamma: 0.92,
      curveStrength: 0.3,
      toneShoulder: 3.2,
      lift: 0.018,
      midtone: 0.035,
      gain: -0.02,
      chromaExposure: -0.12,
      chromaGamma: 0.94,
      tintHue: 42,
      tintStrength: 0.18
    }
  }),
  createLook({
    id: "builtin-cool-fade",
    name: "Cool Fade",
    builtIn: true,
    config: {
      exposure: -0.08,
      gamma: 1.08,
      curveStrength: 0.28,
      toneShoulder: 2.1,
      lift: 0.05,
      midtone: -0.025,
      gain: -0.02,
      chromaExposure: -0.3,
      chromaGamma: 1.08,
      tintHue: 212,
      tintStrength: 0.14,
      chromaFadeStrength: 0.8,
      chromaFadeLow: -2.2,
      chromaFadeHigh: 1.4
    }
  }),
  createLook({
    id: "builtin-chroma-pop",
    name: "Chroma Pop",
    builtIn: true,
    config: {
      exposure: 0.05,
      gamma: 0.96,
      curveStrength: 0.22,
      toneShoulder: 2.8,
      gain: 0.035,
      chromaExposure: 0.42,
      chromaGamma: 1.1,
      chromaFadeStrength: 0.12,
      chromaFadeLow: -3.4,
      chromaFadeHigh: 2.8,
      tintHue: 68,
      tintStrength: 0.05
    }
  })
]);

export const DEFAULT_LOOK = BUILT_IN_LOOKS[0];
