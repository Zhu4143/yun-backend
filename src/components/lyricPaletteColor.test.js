import test from 'node:test'
import assert from 'node:assert/strict'
import { lyricPaletteColor } from './lyricPaletteColor.js'

test('cover theme HSL reaches Three.js as its actual color', () => {
  assert.equal(lyricPaletteColor('hsl(34 48% 58%)').getHexString(), 'c79b60')
  assert.equal(lyricPaletteColor('#f4f7ff').getHexString(), 'f4f7ff')
})
