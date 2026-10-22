// Visual design only: no account state, saved timestamps or per-track history.
// Existing saved presets always take precedence over these first-run defaults.
export const RELEASE_BACKGROUND_DEFAULTS = Object.freeze({
  flowSpeed: .013, scale: 1.89, warpStrength: .16, breathAmount: .106, detail: .84,
  metal: 1.36, contrast: 2, bias: -.01, grain: .038, flowStrength: 1.22,
  leftDarkness: .8, vignetteStrength: .74, paletteFidelity: 1,
  colorSaturation: 1.84, colorExposure: 1.22, hueShift: 0, rampShift: .08,
  tintColor: '#ffffff', tintStrength: .34, transitionDuration: 4.3, transitionGlint: .22,
})

export const RELEASE_LYRIC_DEFAULTS = Object.freeze({
  glow: .68, ghost: .68, ghostDistance: 2, overlay: .18,
  font: 'serif', fontScale: .85, weight: 700, lineHeight: 1.9,
})
