import { useEffect, useState } from 'react'
import { LYRIC_FONTS } from '../../server/visuals/lyricFontCatalog.js'

// Adding the stylesheet is enough: native unicode-range selection fetches only
// subsets containing displayed lyrics. No whole CJK font is preloaded.
const sheets = new Map()
function loadSheet(font) {
  if (!font?.name) return Promise.resolve()
  if (!sheets.has(font.id)) sheets.set(font.id, new Promise((resolve, reject) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'; link.href = `/fonts/lyrics/${font.id}/font.css`; link.dataset.lyricFont = font.id
    link.onload = resolve
    link.onerror = () => { sheets.delete(font.id); link.remove(); reject(new Error('字体暂不可用')) }
    document.head.appendChild(link)
  }))
  return sheets.get(font.id)
}
export function useLyricFont(font) {
  const [failed, setFailed] = useState('')
  useEffect(() => {
    let active = true
    Promise.all([font, LYRIC_FONTS.find(item => item.id === font.companion)].filter(Boolean).map(loadSheet))
      .then(() => { if (active) setFailed('') })
      .catch(() => { if (active) setFailed(font.id) })
    return () => { active = false }
  }, [font])
  return failed === font.id
}
