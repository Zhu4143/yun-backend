import { useEffect, useMemo, useRef } from 'react'
import { createLyricPainter, lyricGlyphs } from './lyricEffects.js'

export default function ImmersiveLyricText({ text, interval, settings, audioRef, time, visible }) {
  const root = useRef(null), painter = useRef(null), currentTime = useRef(time)
  const { start, end } = interval
  useEffect(() => { currentTime.current = time; painter.current?.refresh() }, [time])
  const glyphs = useMemo(() => lyricGlyphs(text), [text])
  useEffect(() => {
    const controller = createLyricPainter({
      nodes: Array.from(root.current.querySelectorAll('.lyric-glyph')), readMedia: () => audioRef?.current,
      readTime: () => currentTime.current, interval: { start, end }, offset: settings.timeOffset, mode: settings.highlight,
      visible: () => visible && !document.hidden,
    })
    painter.current = controller
    document.addEventListener('visibilitychange', controller.refresh)
    return () => { controller.dispose(); document.removeEventListener('visibilitychange', controller.refresh); painter.current = null }
  }, [audioRef, start, end, settings.highlight, settings.timeOffset, visible])
  // Keep Latin words intact while allowing CJK and emoji to wrap naturally.
  const groups = []
  glyphs.forEach((glyph, index) => {
    const word = /^[\p{Script=Latin}\p{Number}'’_-]+$/u.test(glyph)
    if (word && groups.at(-1)?.word) groups.at(-1).items.push({ glyph, index })
    else groups.push({ word, items: [{ glyph, index }] })
  })
  return <span ref={root} aria-hidden="true" className="lyric-painted-text">{groups.map((group, groupIndex) => <span key={groupIndex} className={group.word ? 'lyric-word' : undefined}>{group.items.map(({ glyph, index }) => {
    const blend = glyphs.length > 1 ? index / (glyphs.length - 1) * settings.gradient * 100 : 0
    return <span key={index} className="lyric-glyph" data-char={glyph} style={{ '--glyph-color': `color-mix(in srgb, var(--lyric-color-a) ${100 - blend}%, var(--lyric-color-b))` }}>{glyph}<span className="lyric-glyph-fill">{glyph}</span></span>
  })}</span>)}</span>
}
