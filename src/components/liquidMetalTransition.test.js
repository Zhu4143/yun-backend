import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LIQUID_METAL_PALETTE_SIZE,
  easeLiquidMetalPalette,
  liquidMetalPaletteState,
  mixLiquidMetalPalette,
  publishLiquidMetalPalette,
  writeLiquidMetalPalette,
} from './liquidMetalTransition.js'

test('cover colors are ordered as the four-stage Liquid Ore metal ramp', () => {
  const palette = new Float32Array(LIQUID_METAL_PALETTE_SIZE)
  writeLiquidMetalPalette(palette, {
    base: [0.01, 0.02, 0.03],
    secondary: [0.11, 0.12, 0.13],
    primary: [0.21, 0.22, 0.23],
    accent: [0.91, 0.92, 0.93],
  })

  assert.deepEqual(Array.from(palette), [
    0.01, 0.02, 0.03,
    0.11, 0.12, 0.13,
    0.21, 0.22, 0.23,
    0.91, 0.92, 0.93,
  ].map((value) => Math.fround(value)))
})

test('an interrupted song change can continue from the visible palette', () => {
  const from = new Float32Array(LIQUID_METAL_PALETTE_SIZE).fill(0.1)
  const to = new Float32Array(LIQUID_METAL_PALETTE_SIZE).fill(0.9)
  const visible = new Float32Array(LIQUID_METAL_PALETTE_SIZE)
  const eased = easeLiquidMetalPalette(0.35)
  mixLiquidMetalPalette(visible, from, to, eased)

  const expected = 0.1 + (0.9 - 0.1) * eased
  for (const channel of visible) assert.ok(Math.abs(channel - expected) < 1e-6)
  assert.ok(visible[0] > from[0] && visible[0] < to[0])
})

test('Liquid Ore palette easing has stationary ends', () => {
  assert.equal(easeLiquidMetalPalette(0), 0)
  assert.equal(easeLiquidMetalPalette(1), 1)
  assert.ok(easeLiquidMetalPalette(0.01) < 0.00001)
  assert.ok(1 - easeLiquidMetalPalette(0.99) < 0.00001)
})

test('the record and background share one published visible palette', () => {
  const visible = new Float32Array(LIQUID_METAL_PALETTE_SIZE)
    .map((_, index) => index / LIQUID_METAL_PALETTE_SIZE)
  const published = publishLiquidMetalPalette(visible)

  assert.equal(liquidMetalPaletteState.initialized, true)
  assert.deepEqual(Array.from(published), Array.from(visible))
  assert.notEqual(published, visible)
})
