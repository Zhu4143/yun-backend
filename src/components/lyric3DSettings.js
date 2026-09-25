export const LYRIC_3D_STORAGE_KEY = 'yun-lyric-3d-v1'

export const LYRIC_3D_DEFAULTS = Object.freeze({
  followCover: true,
  color: '#f4f7ff',
  sideColor: '#33456d',
  glowColor: '#7cbcff',
  glow: 1.1,
  lightX: -1.2,
  lightY: 1.6,
  offsetX: 0,
  offsetY: 0,
  rotateX: -5,
  rotateY: -10,
  perspective: 900,
  depth: 0.5,
  size: 1,
})

export const LYRIC_3D_CONTROLS = Object.freeze([
  { key: 'color', label: '正面颜色', type: 'color' },
  { key: 'sideColor', label: '字体侧面', type: 'color' },
  { key: 'glowColor', label: '光晕颜色', type: 'color' },
  { key: 'glow', label: '光效强度', min: 0, max: 3, step: 0.05, digits: 2 },
  { key: 'lightX', label: '光源横向', min: -3, max: 3, step: 0.1, digits: 1 },
  { key: 'lightY', label: '光源纵向', min: -3, max: 3, step: 0.1, digits: 1 },
  { key: 'offsetX', label: '歌词横向位置', min: -50, max: 50, step: 1, digits: 0, suffix: '%' },
  { key: 'offsetY', label: '歌词纵向位置', min: -35, max: 35, step: 1, digits: 0, suffix: '%' },
  { key: 'rotateX', label: '字体俯仰', min: -60, max: 60, step: 1, digits: 0, suffix: '°' },
  { key: 'rotateY', label: '字体透视旋转', min: -65, max: 65, step: 1, digits: 0, suffix: '°' },
  { key: 'perspective', label: '场景透视距离', min: 350, max: 1800, step: 10, digits: 0, suffix: 'px' },
  { key: 'depth', label: '字体厚度', min: 0, max: 1.5, step: 0.05, digits: 2 },
  { key: 'size', label: '字体大小', min: 0.65, max: 1.7, step: 0.05, digits: 2 },
])

export function normalizeLyric3DSettings(input) {
  const next = { ...LYRIC_3D_DEFAULTS }
  if (typeof input?.followCover === 'boolean') next.followCover = input.followCover
  for (const control of LYRIC_3D_CONTROLS) {
    const value = input?.[control.key]
    if (control.type === 'color') {
      if (/^#[0-9a-f]{6}$/i.test(String(value))) next[control.key] = String(value).toLowerCase()
    } else if (value != null && Number.isFinite(Number(value))) {
      next[control.key] = Math.min(control.max, Math.max(control.min, Number(value)))
    }
  }
  return next
}

export function loadLyric3DSettings(storage = globalThis.localStorage) {
  try {
    return normalizeLyric3DSettings(JSON.parse(storage?.getItem(LYRIC_3D_STORAGE_KEY) || '{}'))
  } catch {
    return { ...LYRIC_3D_DEFAULTS }
  }
}
