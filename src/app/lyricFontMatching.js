import { LYRIC_GENRES, lyricFont, lyricTrackKey } from '../../server/visuals/lyricFontCatalog.js'

const rules = [
  ['phonk', /\bphonk\b|montagem|automotivo|\bdrift\b|brazilian (?:funk|bass)|bruxaria/i],
  ['guofeng', /古风|国风|中国风|戏腔|仙侠|武侠|guofeng|chinese traditional|九万字|牵丝戏|赤伶|辞九门|不谓侠|琵琶行|探窗|黄诗扶|银临|河图|双笙|等什么君|音阙诗听/i],
  ['rock', /摇滚|金属|说唱|\brock\b|\bmetal\b|hip.?hop|\brap\b|punk|grunge|eminem|linkin park/i],
  ['electronic', /电子|电音|\bedm\b|techno|\bhouse\b|dubstep|hardstyle|trance|synthwave|drum and bass|\bdnb\b/i],
  ['classical', /古典|交响|爵士|蓝调|纯音乐|classical|orchestra|symphony|\bjazz\b|\bblues\b|piano|钢琴|hans zimmer|坂本龙一|久石让/i],
  ['folk', /民谣|独立|\bfolk\b|\bindie\b|acoustic|陈粒|赵雷|陈鸿宇|房东的猫|鹿先森|程璧/i],
  ['playful', /轻快|童谣|儿歌|动漫|二次元|\banime\b|kawaii|city.?pop|cute/i],
  ['ballad', /抒情|流行|情歌|\bpop\b|ballad|r[&＆]?b|\brnb\b|\bsoul\b/i],
]
function tagText(value) {
  if (Array.isArray(value)) return value.map(tagText).join(' ')
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return tagText(value.name || value.label || value.value)
  return ''
}
export function matchLyricGenre(song, overrides = {}) {
  const chosen = overrides[lyricTrackKey(song)]
  if (LYRIC_GENRES.some(genre => genre.id === chosen)) return { id: chosen, source: '手动分类' }
  const tags = ['genre', 'genres', 'style', 'styles', 'tags', 'styleTags', 'moodTags'].map(key => tagText(song?.[key])).join(' ')
  const tagged = rules.find(([, pattern]) => pattern.test(tags))
  if (tagged) return { id: tagged[0], source: '歌曲标签' }
  const description = [song?.title, tagText(song?.artist), tagText(song?.album)].filter(value => typeof value === 'string').join(' ')
  const inferred = rules.find(([, pattern]) => pattern.test(description))
  return inferred ? { id: inferred[0], source: '曲名 / 歌手关键词' } : { id: 'unknown', source: '未识别，使用默认字体' }
}
export function resolveLyricFont(settings, song) {
  const match = matchLyricGenre(song, settings.trackGenres)
  const id = settings.fontMode === 'manual' ? settings.font : settings.genreFonts?.[match.id] || settings.font
  return { ...match, label: LYRIC_GENRES.find(genre => genre.id === match.id)?.label || '未分类', font: lyricFont(id) }
}
