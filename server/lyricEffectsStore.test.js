import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createLyricEffectsStore } from './lyricEffectsStore.js'
import { LYRIC_EFFECT_DEFAULTS, normalizeLyricEffects } from './visuals/lyricEffectsSchema.js'

test('lyric preview does not save; explicit save survives reopen without touching the mineral preset', async t => {
  const folder = await mkdtemp(path.join(tmpdir(), 'yun-lyric-preset-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const file = path.join(folder, 'lyric-effects.json'), mineral = path.join(folder, 'immersive-background.json')
  const protectedContent = '{"settings":{"flowSpeed":0.013},"savedAt":"keep"}'
  await writeFile(mineral, protectedContent)
  const store = createLyricEffectsStore(file)
  assert.deepEqual((await store.read()).settings, LYRIC_EFFECT_DEFAULTS)
  await assert.rejects(stat(file), { code: 'ENOENT' })
  const desired = { ...LYRIC_EFFECT_DEFAULTS, glow: .8, colorMode: 'custom', colorA: '#aabbcc', font: 'serif', timeOffset: .3,
    genreFonts: { ...LYRIC_EFFECT_DEFAULTS.genreFonts, phonk: 'condensed' }, trackGenres: { 'netease:10': 'guofeng' } }
  const saved = await store.save(desired)
  assert.ok(Number.isFinite(Date.parse(saved.savedAt)))
  assert.deepEqual((await createLyricEffectsStore(file).read()).settings, desired)
  await assert.rejects(store.save([]), TypeError)
  assert.deepEqual(await store.read(), saved)
  assert.equal(await readFile(mineral, 'utf8'), protectedContent)
})

test('saved lyric effects reject injected CSS and clamp costly or invalid values', () => {
  const result = normalizeLyricEffects({ font: 'url(secret)', colorA: 'red; color: black', colorMode: 'other',
    glow: Infinity, ghostDistance: 200, fontScale: -1, timeOffset: '10', unexpected: 10 })
  assert.equal(result.font, LYRIC_EFFECT_DEFAULTS.font)
  assert.equal(result.colorA, LYRIC_EFFECT_DEFAULTS.colorA)
  assert.equal(result.colorMode, 'cover')
  assert.equal(result.glow, LYRIC_EFFECT_DEFAULTS.glow)
  assert.equal(result.ghostDistance, 8)
  assert.equal(result.fontScale, .75)
  assert.equal(result.timeOffset, 0)
  assert.equal('unexpected' in result, false)
})
