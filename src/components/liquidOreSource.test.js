import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LIQUID_ORE_GLASS_DEFAULTS,
  LIQUID_ORE_STORAGE_KEY,
  applyLiquidOreGlassSettings,
  liquidOreGlassState,
  loadLiquidOreGlassSettings,
  resetLiquidOreGlassSettings,
  saveLiquidOreGlassSettings,
  stepLiquidOreHover,
} from './liquidOreSource.js'

test('liquid ore controls clamp values to the source panel ranges', () => {
  resetLiquidOreGlassSettings()
  applyLiquidOreGlassSettings({ frost: 99, chromatic: -1, refractionAmount: 54 })

  assert.equal(liquidOreGlassState.frost, 20)
  assert.equal(liquidOreGlassState.chromatic, 0)
  assert.equal(liquidOreGlassState.refractionAmount, 54)
  resetLiquidOreGlassSettings()
})

test('liquid ore settings save and reload with the source storage key', () => {
  const storage = new Map()
  globalThis.window = {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  }

  resetLiquidOreGlassSettings()
  applyLiquidOreGlassSettings({ frost: 15, hoverScale: 0.075 })
  saveLiquidOreGlassSettings()
  assert.ok(storage.has(LIQUID_ORE_STORAGE_KEY))

  resetLiquidOreGlassSettings()
  loadLiquidOreGlassSettings()
  assert.equal(liquidOreGlassState.frost, 15)
  assert.equal(liquidOreGlassState.hoverScale, 0.075)

  delete globalThis.window
  resetLiquidOreGlassSettings()
})

test('source hover spring moves toward its target', () => {
  const next = stepLiquidOreHover({ progress: 0, velocity: 0 }, 1 / 60, 1)
  assert.ok(next.progress > 0)
  assert.ok(next.velocity > 0)
  assert.equal(LIQUID_ORE_GLASS_DEFAULTS.frost, 4)
})
