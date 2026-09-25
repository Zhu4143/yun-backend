import test from 'node:test'
import assert from 'node:assert/strict'
import { LYRIC_3D_DEFAULTS, loadLyric3DSettings, normalizeLyric3DSettings } from './lyric3DSettings.js'

test('lyric controls clamp large adjustments and reject invalid colors', () => {
  const settings = normalizeLyric3DSettings({ color: 'bad', offsetX: 999, depth: -1, rotateY: -90 })
  assert.equal(settings.color, LYRIC_3D_DEFAULTS.color)
  assert.equal(settings.offsetX, 50)
  assert.equal(settings.depth, 0)
  assert.equal(settings.rotateY, -65)
  assert.equal(loadLyric3DSettings({ getItem: () => '{bad' }).glow, LYRIC_3D_DEFAULTS.glow)
})
