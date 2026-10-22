import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { matchLyricGenre, resolveLyricFont } from './lyricFontMatching.js'
import { LYRIC_FONTS, lyricTrackKey } from '../../server/visuals/lyricFontCatalog.js'
import { LYRIC_EFFECT_DEFAULTS, normalizeLyricEffects } from '../../server/visuals/lyricEffectsSchema.js'

test('real tags take precedence over title hints; manual track classification wins over both', () => {
  const song = { source: 'netease', id: '1', title: '九万字', tags: [{ name: 'Phonk' }] }
  assert.deepEqual(matchLyricGenre(song), { id: 'phonk', source: '歌曲标签' })
  assert.deepEqual(matchLyricGenre(song, { [lyricTrackKey(song)]: 'guofeng' }), { id: 'guofeng', source: '手动分类' })
  assert.equal(matchLyricGenre({ ...song, source: 'local' }, { [lyricTrackKey(song)]: 'folk' }).id, 'phonk', 'provider identities are independent')
})

test('examples select brush, gothic and other categories, without treating unknown songs as recognized', () => {
  for (const [song, genre, font] of [
    [{ title: '九万字', artist: '黄诗扶' }, 'guofeng', 'brush'],
    [{ title: '牵丝戏', artist: '银临 / Aki阿杰' }, 'guofeng', 'brush'],
    [{ title: 'MONTAGEM PARA (Slowed)' }, 'phonk', 'gothic'],
    [{ genre: ['Techno'], title: 'Track' }, 'electronic', 'cyber'],
    [{ genre: '摇滚' }, 'rock', 'condensed'],
    [{ artist: '陈粒' }, 'folk', 'handwritten'],
    [{ tags: ['轻快'] }, 'playful', 'playful'],
    [{ genre: 'Jazz' }, 'classical', 'elegant'],
    [{ genre: 'Pop' }, 'ballad', 'songti'],
  ]) {
    const result = resolveLyricFont(LYRIC_EFFECT_DEFAULTS, song)
    assert.equal(result.id, genre)
    assert.equal(result.font.id, font)
  }
  const fallback = resolveLyricFont({ ...LYRIC_EFFECT_DEFAULTS, font: 'serif' }, { title: '从前', artist: '未知歌手' })
  assert.equal(fallback.id, 'unknown')
  assert.equal(fallback.font.id, 'serif')
})

test('manual typefaces remain stable across songs; custom mappings apply in automatic mode only', () => {
  const settings = normalizeLyricEffects({ font: 'serif', genreFonts: { phonk: 'condensed' } })
  assert.equal(resolveLyricFont(settings, { title: 'Drift Phonk' }).font.id, 'condensed')
  assert.equal(resolveLyricFont({ ...settings, fontMode: 'manual' }, { title: 'Drift Phonk' }).font.id, 'serif')
  assert.equal(resolveLyricFont({ ...settings, fontMode: 'manual' }, { genre: '古风' }).font.id, 'serif')
})

test('preset validation bounds track corrections and rejects injected font names or invalid categories', () => {
  const trackGenres = Object.fromEntries(Array.from({ length: 240 }, (_, index) => [`netease:${index}`, 'guofeng']))
  const settings = normalizeLyricEffects({ genreFonts: { phonk: 'url(secret)' }, trackGenres: { ...trackGenres, 'local:x': 'unknown-kind', 'external:y': 'folk' } })
  assert.equal(settings.genreFonts.phonk, 'gothic')
  assert.equal(Object.keys(settings.trackGenres).length, 200)
  assert.equal('local:x' in settings.trackGenres, false)
  assert.equal('external:y' in settings.trackGenres, false)
})

test('all nine local font families have valid licensed, checksummed WOFF2 data and local-only CSS', async () => {
  const root = new URL('../../public/fonts/lyrics/', import.meta.url)
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'))
  assert.equal(manifest.fonts.length, 9)
  assert.equal(LYRIC_FONTS.length, 12)
  for (const font of manifest.fonts) {
    const css = await readFile(new URL(`${font.id}/font.css`, root), 'utf8')
    assert.doesNotMatch(css, /https?:\/\//)
    assert.match(css, /font-display: swap/)
    assert.match(await readFile(new URL(`${font.id}/OFL.txt`, root), 'utf8'), /SIL OPEN FONT LICENSE/)
    assert.ok(font.files.length)
    for (const file of font.files) {
      const bytes = await readFile(new URL(`${font.id}/${file.filename}`, root))
      assert.equal(bytes.subarray(0, 4).toString(), 'wOF2')
      assert.equal(bytes.length, file.bytes)
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256)
    }
  }
})
