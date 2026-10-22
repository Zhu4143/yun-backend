import test from 'node:test'
import assert from 'node:assert/strict'
import { createLiquidMetalField } from './liquidMetalField.js'
import { resolveLiquidMetalBackgroundSettings } from './liquidMetalSettings.js'

const colors = value => ({ base: [value, value, value], primary: [value, value, value], secondary: [value, value, value], accent: [value, value, value] })
const options = { settings: resolveLiquidMetalBackgroundSettings({ settings: { transitionDuration: 2 } }) }

test('the shared field initializes from real cover colors and preserves live settings', () => {
  const field = createLiquidMetalField()
  try {
    assert.equal(field.step(1 / 60, options, 1920, 1080), false)
    field.setColors(colors(0.2), 'a')
    field.step(1 / 60, options, 1920, 1080)
    const u = field.material.uniforms
    assert.ok(Math.abs(u.uCurrentC0.value.r - 0.2) < 1e-6)
    assert.deepEqual(u.uResolution.value.toArray(), [1920, 1080])
    field.step(1 / 60, { settings: { ...options.settings, metal: 0.8, colorExposure: 1.2 } }, 400, 900)
    assert.equal(u.uMetal.value, 0.8)
    assert.equal(u.uColorExposure.value, 1.2)
    assert.deepEqual(u.uResolution.value.toArray(), [400, 900])
  } finally { field.dispose() }
})

test('an interrupted cover change continues from the visible palette', () => {
  const field = createLiquidMetalField()
  try {
    field.setColors(colors(0.2), 'a')
    field.step(0.1, options, 100, 100)
    field.setColors(colors(0.8), 'b')
    field.step(1, options, 100, 100)
    assert.equal(field.material.uniforms.uTransitionProgress.value, 0.5)
    field.setColors(colors(0.1), 'c')
    field.step(0, options, 100, 100)
    assert.ok(Math.abs(field.material.uniforms.uCurrentC0.value.r - 0.5) < 1e-6)
    assert.equal(field.material.uniforms.uTransitionProgress.value, 0)
    field.step(2.1, options, 100, 100)
    assert.ok(Math.abs(field.material.uniforms.uCurrentC0.value.r - 0.1) < 1e-6)
    assert.equal(field.material.uniforms.uBurstStrength.value, 0)
  } finally { field.dispose() }
})

test('pausing the field clock holds both its flow and palette transition', () => {
  const field = createLiquidMetalField()
  try {
    field.setColors(colors(0.2), 'a')
    field.step(0.5, options, 100, 100)
    field.setColors(colors(0.8), 'b')
    field.step(0.5, options, 100, 100)
    const time = field.material.uniforms.uTime.value
    const progress = field.material.uniforms.uTransitionProgress.value
    field.step(1, { ...options, paused: true }, 100, 100)
    assert.equal(field.material.uniforms.uTime.value, time)
    assert.equal(field.material.uniforms.uTransitionProgress.value, progress)
  } finally { field.dispose() }
})
