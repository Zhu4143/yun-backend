import { lyricFont } from '../../server/visuals/lyricFontCatalog.js'
const clamp = value => Math.max(0, Math.min(1, value))

// Timestamps are line-level. Equal-time translation lines share the next
// distinct boundary; no wall-clock animation can run ahead of stalled audio.
export function lyricInterval(lines, index, duration) {
  const start = lines[index]?.time || 0
  const next = lines.slice(index + 1).find(line => line.time > start)
  return { start, end: Math.max(start + .1, next?.time ?? (duration > start ? duration : start + 5)) }
}
export function lyricProgress(time, interval, offset = 0, mode = 'sweep') {
  if (mode === 'line') return time + offset >= interval.start ? 1 : 0
  return clamp((time + offset - interval.start) / (interval.end - interval.start))
}
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
export function lyricGlyphs(text) {
  return segmenter ? Array.from(segmenter.segment(text), item => item.segment) : Array.from(text)
}

function readable(color) {
  if (!Array.isArray(color) || color.length !== 3 || !color.every(Number.isFinite)) return '#ffffff'
  const rgb = color.map(channel => Math.max(0, Math.min(255, channel)))
  const linear = channel => { const s = channel / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4 }
  let mix = 0
  const brightness = values => values.map(linear).reduce((total, channel, i) => total + channel * [.2126, .7152, .0722][i], 0)
  while (brightness(rgb.map(channel => channel + (255 - channel) * mix)) < .62 && mix < .85) mix += .025
  return `#${rgb.map(channel => Math.round(channel + (255 - channel) * mix).toString(16).padStart(2, '0')).join('')}`
}
export function lyricColors(settings, palette) {
  return settings.colorMode === 'custom' ? [settings.colorA, settings.colorB] : [readable(palette?.primary), readable(palette?.accent)]
}
export function lyricEffectStyle(settings, colors, font = lyricFont(settings.font)) {
  return {
    '--lyric-color-a': colors[0], '--lyric-color-b': colors[1],
    '--lyric-font': font.family, '--lyric-scale': settings.fontScale,
    '--lyric-weight': settings.weight, '--lyric-leading': settings.lineHeight,
    '--lyric-dim': settings.inactiveOpacity, '--lyric-glow': `${settings.glow * 16}px`,
    '--lyric-glow-alpha': settings.glow / 1.5, '--lyric-ghost': settings.ghost,
    '--lyric-ghost-x': `${settings.ghostDistance}px`, '--lyric-ghost-y': `${settings.ghostDistance * .45}px`,
    '--lyric-overlay': settings.overlay,
  }
}

// One active line only, capped at 20 updates/s; no React state on animation frames.
export function createLyricPainter({ nodes, media, readMedia = () => media, readTime, interval, offset, mode, visible = () => true,
  requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame }) {
  let frame = 0, last = -Infinity, disposed = false, activeMedia = null
  const events = ['timeupdate', 'seeking', 'seeked', 'play', 'pause', 'ended', 'loadedmetadata', 'ratechange']
  const bindMedia = () => {
    const next = readMedia()
    if (next === activeMedia) return
    events.forEach(event => activeMedia?.removeEventListener(event, refresh))
    activeMedia = next
    events.forEach(event => activeMedia?.addEventListener(event, refresh))
  }
  const paint = () => {
    const progress = lyricProgress(activeMedia && Number.isFinite(activeMedia.currentTime) ? activeMedia.currentTime : readTime(), interval, offset, mode)
    nodes.forEach((node, index) => node.style.setProperty('--glyph-progress', `${clamp(progress * nodes.length - index) * 100}%`))
  }
  const tick = now => {
    frame = 0
    if (disposed || !visible()) return
    bindMedia()
    if (now - last >= 50) { paint(); last = now }
    if (activeMedia && !activeMedia.paused && !activeMedia.ended) frame = requestFrame(tick)
  }
  const refresh = () => {
    cancelFrame(frame); frame = 0
    if (disposed || !visible()) return
    bindMedia()
    paint(); last = -Infinity
    if (activeMedia && !activeMedia.paused && !activeMedia.ended) frame = requestFrame(tick)
  }
  refresh()
  return { refresh, dispose() { disposed = true; cancelFrame(frame); events.forEach(event => activeMedia?.removeEventListener(event, refresh)) } }
}
