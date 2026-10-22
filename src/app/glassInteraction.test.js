import test from 'node:test'
import assert from 'node:assert/strict'
import { advanceGlassSpring, glassSpringMoving } from './glassInteraction.js'

test('the source spring overshoots gently and settles without an idle animation', () => {
  let state = { progress: 0, velocity: 0 }, peak = 0
  for (let i = 0; i < 150; i++) { state = advanceGlassSpring(state, 1 / 60, 1); peak = Math.max(peak, state.progress) }
  assert.ok(peak > 1.02 && peak < 1.12)
  assert.deepEqual(state, { progress: 1, velocity: 0 })
  assert.equal(glassSpringMoving(state, 1), false)
})

test('leaving and re-entering carry the current position and velocity', () => {
  const rising = advanceGlassSpring({ progress: 0, velocity: 0 }, .08, 1)
  const leaving = advanceGlassSpring(rising, 1 / 120, 0)
  assert.ok(leaving.progress > rising.progress)
  assert.ok(leaving.velocity > 0 && leaving.velocity < rising.velocity)
  const reentering = advanceGlassSpring(leaving, 1 / 120, 1)
  assert.ok(reentering.progress > leaving.progress)
  assert.ok(Math.abs(reentering.progress - leaving.progress) < .1)
})

test('frame subdivision preserves the spring response', () => {
  const start = { progress: .2, velocity: .3 }
  const one = advanceGlassSpring(start, .1, 1)
  let many = start
  for (let i = 0; i < 12; i++) many = advanceGlassSpring(many, 1 / 120, 1)
  assert.ok(Math.abs(one.progress - many.progress) < 1e-12)
  assert.ok(Math.abs(one.velocity - many.velocity) < 1e-12)
})

test('reduced motion settles immediately and a long suspended gap stays bounded', () => {
  assert.deepEqual(advanceGlassSpring({ progress: .4, velocity: 2 }, .1, 0, true), { progress: 0, velocity: 0 })
  const after = advanceGlassSpring({ progress: .2, velocity: 0 }, 300, 1)
  assert.ok(Number.isFinite(after.progress) && after.progress >= 0 && after.progress < 1.12)
})
