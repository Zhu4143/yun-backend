export const LIQUID_METAL_BACKGROUND_STORAGE_KEY = 'vfx-params:liquid-metal/background'

export const LIQUID_METAL_BACKGROUND_DEFAULTS = Object.freeze({
  flowSpeed: 0.022,
  scale: 1.2,
  warpStrength: 0.14,
  breathAmount: 0.045,
  detail: 0.24,
  metal: 0.3,
  contrast: 2.4,
  bias: 0.08,
  rampShift: 0.28,
  grain: 0.02,
  flowStrength: 1,
  leftDarkness: 0.38,
  vignetteStrength: 0.32,
  audioReactiveAmount: 0.24,
  transitionDuration: 2.35,
  transitionGlint: 1,
  paletteFidelity: 0.72,
  colorSaturation: 1,
  colorExposure: 1,
  hueShift: 0,
  tintColor: '#ffffff',
  tintStrength: 0,
})

export const LIQUID_METAL_BACKGROUND_CONTROL_GROUPS = Object.freeze([
  {
    id: 'flow',
    label: '流体形态',
    controls: [
      { key: 'flowSpeed', label: '流动速度', min: 0, max: 0.06, step: 0.001, digits: 3 },
      { key: 'scale', label: '纹理尺度', min: 0.65, max: 2.1, step: 0.01, digits: 2 },
      { key: 'warpStrength', label: '液态扭曲', min: 0.04, max: 0.32, step: 0.005, digits: 3 },
      { key: 'breathAmount', label: '呼吸起伏', min: 0, max: 0.12, step: 0.002, digits: 3 },
      { key: 'detail', label: '流纹细节', min: 0, max: 1, step: 0.02, digits: 2 },
    ],
  },
  {
    id: 'color',
    label: '颜色校准',
    controls: [
      { key: 'paletteFidelity', label: '唱片原色占比', min: 0, max: 1, step: 0.02, digits: 2 },
      { key: 'colorSaturation', label: '色彩浓度', min: 0.35, max: 2, step: 0.02, digits: 2 },
      { key: 'colorExposure', label: '颜色亮度', min: 0.5, max: 1.6, step: 0.02, digits: 2 },
      { key: 'hueShift', label: '色相偏移', min: -180, max: 180, step: 1, digits: 0, suffix: '°' },
      { key: 'tintColor', label: '自定义染色', type: 'color' },
      { key: 'tintStrength', label: '染色强度', min: 0, max: 1, step: 0.02, digits: 2 },
    ],
  },
  {
    id: 'surface',
    label: '金属表面',
    controls: [
      { key: 'metal', label: '金属高光', min: 0, max: 1.4, step: 0.02, digits: 2 },
      { key: 'contrast', label: '金属对比', min: 0.8, max: 4, step: 0.05, digits: 2 },
      { key: 'bias', label: '明暗偏移', min: -0.3, max: 0.3, step: 0.01, digits: 2 },
      { key: 'rampShift', label: '色带位置', min: -0.1, max: 0.55, step: 0.01, digits: 2 },
      { key: 'grain', label: '金属颗粒', min: 0, max: 0.08, step: 0.002, digits: 3 },
      { key: 'flowStrength', label: '整体亮度', min: 0.4, max: 1.6, step: 0.02, digits: 2 },
    ],
  },
  {
    id: 'lighting',
    label: '空间明暗',
    controls: [
      { key: 'leftDarkness', label: '歌词区压暗', min: 0, max: 0.8, step: 0.02, digits: 2 },
      { key: 'vignetteStrength', label: '边缘暗角', min: 0, max: 0.75, step: 0.02, digits: 2 },
    ],
  },
  {
    id: 'music',
    label: '音乐与换歌',
    controls: [
      { key: 'audioReactiveAmount', label: '音乐响应', min: 0, max: 0.8, step: 0.02, digits: 2 },
      { key: 'transitionDuration', label: '换色时长', min: 0.8, max: 6, step: 0.05, digits: 2, suffix: ' s' },
      { key: 'transitionGlint', label: '换歌流光', min: 0, max: 2, step: 0.02, digits: 2 },
    ],
  },
])

const controlByKey = new Map(
  LIQUID_METAL_BACKGROUND_CONTROL_GROUPS
    .flatMap((group) => group.controls)
    .map((control) => [control.key, control]),
)

const clampSetting = (value, min, max) => Math.max(min, Math.min(max, Number(value)))
const normalizeColor = (value) => /^#[0-9a-f]{6}$/i.test(String(value))
  ? String(value).toLowerCase()
  : null

export const liquidMetalBackgroundState = { ...LIQUID_METAL_BACKGROUND_DEFAULTS }

export function applyLiquidMetalBackgroundSettings(settings) {
  for (const [key, value] of Object.entries(settings || {})) {
    const control = controlByKey.get(key)
    if (!control) continue
    if (control.type === 'color') {
      const color = normalizeColor(value)
      if (color) liquidMetalBackgroundState[key] = color
      continue
    }
    if (!Number.isFinite(Number(value))) continue
    liquidMetalBackgroundState[key] = clampSetting(value, control.min, control.max)
  }
  return { ...liquidMetalBackgroundState }
}

export function loadLiquidMetalBackgroundSettings() {
  if (typeof window === 'undefined') return { ...liquidMetalBackgroundState }
  try {
    const stored = JSON.parse(window.localStorage.getItem(LIQUID_METAL_BACKGROUND_STORAGE_KEY) || 'null')
    if (stored) applyLiquidMetalBackgroundSettings(stored)
  } catch {
    // Invalid or unavailable local storage must not block the WebGL background.
  }
  return { ...liquidMetalBackgroundState }
}

export function saveLiquidMetalBackgroundSettings() {
  const snapshot = { ...liquidMetalBackgroundState }
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LIQUID_METAL_BACKGROUND_STORAGE_KEY, JSON.stringify(snapshot))
    } catch {
      // Preview remains usable even when the browser refuses persistence.
    }
  }
  return snapshot
}

export function resetLiquidMetalBackgroundSettings() {
  return applyLiquidMetalBackgroundSettings(LIQUID_METAL_BACKGROUND_DEFAULTS)
}

export function resolveLiquidMetalBackgroundSettings({
  settings = liquidMetalBackgroundState,
  quality = 'high',
  active = false,
  debugMode = false,
  debugFlowStrength = 1,
  debugBurstStrength = 1,
  showBaseFlow = true,
  showTransitionBurst = true,
  debugView = 0,
} = {}) {
  const current = { ...LIQUID_METAL_BACKGROUND_DEFAULTS, ...settings }
  const lowQuality = quality === 'low'
  return {
    baseFlowSpeed: lowQuality ? current.flowSpeed * (0.012 / 0.022) : debugMode ? Math.max(current.flowSpeed, 0.036) : current.flowSpeed,
    baseWarpStrength: lowQuality ? current.warpStrength * 0.5 : debugMode ? Math.max(current.warpStrength, 0.22) : current.warpStrength,
    baseBreathAmount: lowQuality ? current.breathAmount * 0.4 : current.breathAmount,
    scale: current.scale,
    detail: current.detail,
    metal: current.metal,
    contrast: current.contrast,
    bias: current.bias,
    rampShift: current.rampShift,
    grain: current.grain,
    flowStrength: current.flowStrength,
    leftDarkness: current.leftDarkness,
    vignetteStrength: current.vignetteStrength,
    audioReactiveAmount: active && !lowQuality ? current.audioReactiveAmount : 0,
    transitionDuration: current.transitionDuration,
    transitionGlint: current.transitionGlint,
    paletteFidelity: current.paletteFidelity,
    colorSaturation: current.colorSaturation,
    colorExposure: current.colorExposure,
    hueShift: current.hueShift,
    tintColor: current.tintColor,
    tintStrength: current.tintStrength,
    debugFlowStrength,
    debugBurstStrength,
    showBaseFlow,
    showTransitionBurst,
    debugView,
  }
}

loadLiquidMetalBackgroundSettings()
