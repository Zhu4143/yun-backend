// Browser-safe preset schema; lyric preferences never write background settings.
import { LYRIC_FONT_OPTIONS, LYRIC_GENRES, LYRIC_GENRE_DEFAULTS } from './lyricFontCatalog.js'
import { RELEASE_LYRIC_DEFAULTS } from './releaseDefaults.js'
export const LYRIC_EFFECT_GROUPS = [
  { id: 'color', label: '颜色', controls: [
    { key: 'colorMode', label: '配色来源', type: 'select', default: 'cover', options: [['cover', '歌曲封面'], ['custom', '自定义双色']] },
    { key: 'gradient', label: '渐变强度', min: 0, max: 1, step: .02, default: .7 },
    { key: 'colorA', label: '起始颜色', type: 'color', default: '#fff0bb' },
    { key: 'colorB', label: '结束颜色', type: 'color', default: '#b2e9ff' },
    { key: 'inactiveOpacity', label: '未唱歌词亮度', min: .15, max: .8, step: .01, default: .38 },
  ] },
  { id: 'effects', label: '特效', controls: [
    { key: 'glow', label: '辉光', min: 0, max: 1.5, step: .02, default: .28 },
    { key: 'ghost', label: '重影强度', min: 0, max: 1, step: .02, default: .12 },
    { key: 'ghostDistance', label: '重影距离', min: 0, max: 8, step: .25, default: 1.5, suffix: ' px' },
    { key: 'overlay', label: '叠色强度', min: 0, max: 1, step: .02, default: .12 },
  ] },
  { id: 'font', label: '字形', controls: [
    { key: 'fontMode', label: '字体切换', type: 'select', default: 'auto', options: [['auto', '跟随歌曲风格'], ['manual', '手动固定字体']] },
    { key: 'font', label: '默认字体', type: 'select', default: 'sans', options: LYRIC_FONT_OPTIONS },
    { key: 'fontScale', label: '字号', min: .75, max: 1.4, step: .01, default: 1, suffix: ' 倍' },
    { key: 'weight', label: '字重', min: 400, max: 850, step: 50, default: 650, digits: 0 },
    { key: 'lineHeight', label: '行距', min: 1.2, max: 2, step: .05, default: 1.65 },
  ] },
  { id: 'timing', label: '同步', controls: [
    { key: 'highlight', label: '变色方式', type: 'select', default: 'sweep', options: [['sweep', '句内逐渐扫色'], ['line', '整句亮起']] },
    { key: 'timeOffset', label: '歌词提前量', min: -1.5, max: 1.5, step: .05, default: 0, suffix: ' 秒' },
  ] },
].map(group => ({ ...group, controls: group.controls.map(control => ({ ...control, default: RELEASE_LYRIC_DEFAULTS[control.key] ?? control.default })) }))
const controls = LYRIC_EFFECT_GROUPS.flatMap(group => group.controls)
export const LYRIC_EFFECT_DEFAULTS = Object.freeze({ ...Object.fromEntries(controls.map(control => [control.key, control.default])), genreFonts: LYRIC_GENRE_DEFAULTS, trackGenres: {} })
export function normalizeLyricEffects(value) {
  const settings = Object.fromEntries(controls.map(control => {
    const raw = value?.[control.key]
    if (control.type === 'color') return [control.key, typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : control.default]
    if (control.type === 'select') return [control.key, control.options.some(([key]) => key === raw) ? raw : control.default]
    return [control.key, typeof raw === 'number' && Number.isFinite(raw) ? Number(Math.max(control.min, Math.min(control.max, raw)).toFixed(4)) : control.default]
  }))
  settings.genreFonts = Object.fromEntries(LYRIC_GENRES.map(genre => [genre.id,
    LYRIC_FONT_OPTIONS.some(([id]) => id === value?.genreFonts?.[genre.id]) ? value.genreFonts[genre.id] : genre.font]))
  settings.trackGenres = Object.fromEntries(Object.entries(value?.trackGenres && typeof value.trackGenres === 'object' && !Array.isArray(value.trackGenres) ? value.trackGenres : {})
    .filter(([key, genre]) => key.length <= 240 && /^(?:netease|local):.+/.test(key) && LYRIC_GENRES.some(item => item.id === genre)).slice(-200))
  return settings
}
