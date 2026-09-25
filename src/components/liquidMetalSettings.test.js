import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LIQUID_METAL_BACKGROUND_DEFAULTS,
  LIQUID_METAL_BACKGROUND_STORAGE_KEY,
  applyLiquidMetalBackgroundSettings,
  liquidMetalBackgroundState,
  loadLiquidMetalBackgroundSettings,
  resetLiquidMetalBackgroundSettings,
  resolveLiquidMetalBackgroundSettings,
  saveLiquidMetalBackgroundSettings,
} from './liquidMetalSettings.js'

test('background liquid metal controls clamp numeric values and validate tint colors', () => {
  resetLiquidMetalBackgroundSettings()
  applyLiquidMetalBackgroundSettings({
    flowSpeed: 2,
    bias: -2,
    transitionDuration: 3.4,
    tintColor: '#12AbEF',
  })
  assert.equal(liquidMetalBackgroundState.flowSpeed, 0.06)
  assert.equal(liquidMetalBackgroundState.bias, -0.3)
  assert.equal(liquidMetalBackgroundState.transitionDuration, 3.4)
  assert.equal(liquidMetalBackgroundState.tintColor, '#12abef')
  applyLiquidMetalBackgroundSettings({ tintColor: 'not-a-color' })
  assert.equal(liquidMetalBackgroundState.tintColor, '#12abef')
  resetLiquidMetalBackgroundSettings()
})

test('background liquid metal settings persist and reload independently', () => {
  const storage = new Map()
  globalThis.window = {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  }
  resetLiquidMetalBackgroundSettings()
  applyLiquidMetalBackgroundSettings({ metal: 0.76, transitionGlint: 1.24, tintColor: '#2345ab' })
  saveLiquidMetalBackgroundSettings()
  assert.ok(storage.has(LIQUID_METAL_BACKGROUND_STORAGE_KEY))
  resetLiquidMetalBackgroundSettings()
  loadLiquidMetalBackgroundSettings()
  assert.equal(liquidMetalBackgroundState.metal, 0.76)
  assert.equal(liquidMetalBackgroundState.transitionGlint, 1.24)
  assert.equal(liquidMetalBackgroundState.tintColor, '#2345ab')
  delete globalThis.window
  resetLiquidMetalBackgroundSettings()
})

test('resolved settings preserve song reactivity while honoring low quality limits', () => {
  const high = resolveLiquidMetalBackgroundSettings({
    settings: LIQUID_METAL_BACKGROUND_DEFAULTS,
    quality: 'high',
    active: true,
  })
  const low = resolveLiquidMetalBackgroundSettings({
    settings: LIQUID_METAL_BACKGROUND_DEFAULTS,
    quality: 'low',
    active: true,
  })
  assert.equal(high.audioReactiveAmount, LIQUID_METAL_BACKGROUND_DEFAULTS.audioReactiveAmount)
  assert.equal(high.transitionDuration, 2.35)
  assert.equal(high.paletteFidelity, 0.72)
  assert.equal(high.tintColor, '#ffffff')
  assert.equal(low.audioReactiveAmount, 0)
  assert.ok(low.baseFlowSpeed < high.baseFlowSpeed)
  assert.ok(low.baseWarpStrength < high.baseWarpStrength)
})
