// Shared, browser-safe schema. Keep saved backgrounds independent of the
// archived global VFX settings and the main workspace's colour currents.
import { RELEASE_BACKGROUND_DEFAULTS } from './releaseDefaults.js'
export const IMMERSIVE_BACKGROUND_GROUPS = [
  { id: 'flow', label: '流动', controls: [
    { key: 'flowSpeed', label: '流动速度', min: 0, max: .06, step: .001, default: .016, digits: 3 },
    { key: 'scale', label: '矿脉尺度', min: .65, max: 2.1, step: .01, default: 1.2 },
    { key: 'warpStrength', label: '液态扭曲', min: .04, max: .32, step: .005, default: .14, digits: 3 },
    { key: 'breathAmount', label: '呼吸起伏', min: 0, max: .12, step: .001, default: .045, digits: 3 },
    { key: 'detail', label: '流纹细节', min: 0, max: 1, step: .02, default: .24 },
  ] },
  { id: 'surface', label: '光影', controls: [
    { key: 'metal', label: '金属高光', min: 0, max: 1.4, step: .02, default: .3 },
    { key: 'contrast', label: '明暗对比', min: .8, max: 4, step: .05, default: 2 },
    { key: 'bias', label: '明暗偏移', min: -.3, max: .3, step: .01, default: .08 },
    { key: 'grain', label: '表面颗粒', min: 0, max: .08, step: .002, default: 0, digits: 3 },
    { key: 'flowStrength', label: '整体亮度', min: .4, max: 1.6, step: .02, default: 1 },
    { key: 'leftDarkness', label: '局部压暗', min: 0, max: .8, step: .02, default: .08 },
    { key: 'vignetteStrength', label: '边缘暗角', min: 0, max: .75, step: .02, default: .12 },
  ] },
  { id: 'color', label: '颜色', controls: [
    { key: 'paletteFidelity', label: '保留封面原色', min: 0, max: 1, step: .02, default: .72 },
    { key: 'colorSaturation', label: '色彩浓度', min: .35, max: 2, step: .01, default: 1 },
    { key: 'colorExposure', label: '颜色亮度', min: .5, max: 1.6, step: .02, default: 1 },
    { key: 'hueShift', label: '色相偏移', min: -180, max: 180, step: 1, default: 0, digits: 0, suffix: '°' },
    { key: 'rampShift', label: '色带位置', min: -.1, max: .55, step: .01, default: .14 },
    { key: 'tintColor', label: '自定义染色', type: 'color', default: '#ffffff' },
    { key: 'tintStrength', label: '染色强度', min: 0, max: 1, step: .02, default: 0 },
  ] },
  { id: 'transition', label: '换歌', controls: [
    { key: 'transitionDuration', label: '背景渐变时长', min: .8, max: 6, step: .1, default: 2.4, digits: 1, suffix: ' 秒' },
    { key: 'transitionGlint', label: '换歌流光', min: 0, max: 2, step: .02, default: .22 },
  ] },
].map(group => ({ ...group, controls: group.controls.map(control => ({ ...control, default: RELEASE_BACKGROUND_DEFAULTS[control.key] ?? control.default })) }))
const controls = IMMERSIVE_BACKGROUND_GROUPS.flatMap(group => group.controls)
export const IMMERSIVE_BACKGROUND_DEFAULTS = Object.freeze(Object.fromEntries(controls.map(control => [control.key, control.default])))

export function normalizeImmersiveBackground(value) {
  return Object.fromEntries(controls.map(control => {
    const raw = value?.[control.key]
    if (control.type === 'color') return [control.key, typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : control.default]
    return [control.key, typeof raw === 'number' && Number.isFinite(raw)
      ? Number(Math.max(control.min, Math.min(control.max, raw)).toFixed(4)) : control.default]
  }))
}
