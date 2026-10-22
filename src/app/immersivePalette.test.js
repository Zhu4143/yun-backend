import test from 'node:test'
import assert from 'node:assert/strict'
import { extractImmersivePalette } from './immersivePalette.js'

const pixels = (...areas) => Uint8ClampedArray.from(areas.flatMap(([count, rgb, alpha = 255]) =>
  Array.from({ length: count }, () => [...rgb, alpha]).flat()))
const luma = rgb => rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722

test('white cover paper does not wash a small coloured motif into grey', () => {
  const palette = extractImmersivePalette(pixels([900, [248, 247, 246]], [100, [187, 43, 106]]))
  assert.ok(palette.primary[0] > palette.primary[1] * 3)
  assert.ok(palette.primary[2] > palette.primary[1] * 1.5)
  const levels = [palette.base, palette.secondary, palette.primary, palette.accent].map(luma)
  assert.ok(levels.every((value, index) => index === 0 || value > levels[index - 1]))
})

test('opposing cover colours remain separate stops rather than a muddy average', () => {
  const palette = extractImmersivePalette(pixels([600, [26, 113, 189]], [400, [231, 163, 38]]))
  assert.ok(palette.primary[2] > palette.primary[0] * 2)
  assert.ok(palette.accent[0] > palette.accent[2] * 2)
})

test('a blue accent stays brighter than a dominant yellow without losing its hue', () => {
  const palette = extractImmersivePalette(pixels([800, [231, 163, 38]], [200, [26, 113, 189]]))
  assert.ok(luma(palette.accent) > luma(palette.primary))
  assert.ok(palette.accent[2] > palette.accent[0])
})

test('monochrome covers use a stable blue mineral palette, ignoring tiny colour fringes', () => {
  const neutral = extractImmersivePalette(pixels([800, [44, 44, 44]], [200, [234, 234, 234]]))
  const fringe = extractImmersivePalette(pixels([800, [44, 44, 44]], [199, [234, 234, 234]], [1, [255, 20, 40]]))
  assert.deepEqual(fringe, neutral)
  assert.ok(neutral.primary[2] > neutral.primary[0] * 2)
})

test('transparent artwork and unreadable pixels have a usable bounded fallback', () => {
  const fallback = extractImmersivePalette([])
  assert.deepEqual(extractImmersivePalette(pixels([100, [255, 0, 0], 0])), fallback)
  for (const rgb of Object.values(fallback)) for (const value of rgb) assert.ok(value >= 0 && value <= 255)
})

test('single-colour immersive covers keep their hue without invented supporting colours', () => {
  const hue = rgb => {
    const low = Math.min(...rgb), range = Math.max(...rgb) - low
    return rgb.map(channel => (channel - low) / range)
  }
  for (const rgb of [[181, 97, 45], [187, 43, 106], [26, 113, 189]]) {
    const palette = extractImmersivePalette(pixels([100, rgb]))
    for (const stop of [palette.secondary, palette.primary, palette.accent]) {
      assert.ok(Math.hypot(...hue(rgb).map((value, index) => value - hue(stop)[index])) < .03)
    }
  }
})

test('main workspace explicitly opts into distinct supporting hues', () => {
  const chroma = rgb => rgb.map(channel => channel / Math.max(...rgb))
  const distance = (a, b) => Math.hypot(...chroma(a).map((value, index) => value - chroma(b)[index]))
  for (const rgb of [[181, 97, 45], [187, 43, 106], [26, 113, 189]]) {
    const palette = extractImmersivePalette(pixels([100, rgb]), { multicolor: true })
    assert.ok(distance(palette.primary, palette.secondary) > .5)
    assert.ok(distance(palette.primary, palette.accent) > .5)
    assert.ok(distance(palette.secondary, palette.accent) > .25)
  }
})
