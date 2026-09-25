import assert from 'node:assert/strict'
import test from 'node:test'

import { createHandGestureController } from './HandGestureController.js'

function makeHand({ x = 0.5, y = 0.55, open = true, displayRotation = 0 } = {}) {
  const points = Array.from({ length: 21 }, () => ({ x, y, z: 0 }))
  const fingerBases = [5, 9, 13, 17]

  points[0] = { x, y: y + 0.22, z: 0 }
  fingerBases.forEach((base, index) => {
    const fingerX = x + (index - 1.5) * 0.035
    points[base] = { x: fingerX, y, z: 0 }
    points[base + 1] = { x: fingerX, y: y - 0.1, z: 0 }
    points[base + 3] = open
      ? { x: fingerX, y: y - 0.3, z: 0 }
      : { x: fingerX + 0.055, y: y - 0.045, z: 0 }
  })

  const rawRotation = -displayRotation
  const cosine = Math.cos(rawRotation)
  const sine = Math.sin(rawRotation)
  points.forEach((point, index) => {
    const dx = point.x - x
    const dy = point.y - y
    points[index] = {
      ...point,
      x: x + dx * cosine - dy * sine,
      y: y + dx * sine + dy * cosine,
    }
  })

  return points
}

test('open palm disperses particles and closed fist gathers them', () => {
  const controller = createHandGestureController()

  let state = controller.update({ landmarks: makeHand({ open: true }), timestamp: 0 })
  for (let index = 1; index <= 5; index += 1) {
    state = controller.update({ landmarks: makeHand({ open: true }), timestamp: index * 50 })
  }
  assert.ok(state.scatter > 0.75)

  for (let index = 6; index <= 13; index += 1) {
    state = controller.update({ landmarks: makeHand({ open: false }), timestamp: index * 50 })
  }
  assert.ok(state.scatter < 0.25)
})

test('mirrored hand rotation maps to the vinyl direction independently from palm open and close', () => {
  const controller = createHandGestureController()

  let state
  for (let index = 0; index < 6; index += 1) {
    state = controller.update({
      landmarks: makeHand({ open: true, displayRotation: 0.7 }),
      timestamp: index * 50,
    })
  }
  assert.ok(state.rotation < -0.5)
  assert.ok(state.scatter > 0.75)
  assert.equal(state.action, null)

  for (let index = 6; index < 14; index += 1) {
    state = controller.update({
      landmarks: makeHand({ open: false, displayRotation: 0.7 }),
      timestamp: index * 50,
    })
  }
  assert.ok(state.rotation < -0.5)
  assert.ok(state.scatter < 0.25)
  assert.equal(state.action, null)
})

test('bringing two separated hands together advances exactly once until they separate again', () => {
  const controller = createHandGestureController()
  const actions = []

  for (const [leftX, rightX, timestamp] of [
    [0.24, 0.76, 0],
    [0.34, 0.66, 140],
    [0.45, 0.55, 300],
    [0.46, 0.54, 480],
  ]) {
    const state = controller.update({
      landmarks: makeHand({ x: leftX }),
      secondaryLandmarks: makeHand({ x: rightX }),
      timestamp,
    })
    if (state.action) actions.push(state.action)
  }

  assert.deepEqual(actions, ['next'])
})

test('a hand disappearing at the end of an inward join still advances the track', () => {
  const controller = createHandGestureController()
  const actions = []

  for (const [leftX, rightX, timestamp] of [
    [0.36, 0.64, 0],
    [0.4, 0.6, 140],
    [0.46, null, 230],
  ]) {
    const state = controller.update({
      landmarks: makeHand({ x: leftX }),
      secondaryLandmarks: rightX == null ? null : makeHand({ x: rightX }),
      timestamp,
    })
    if (state.action) actions.push(state.action)
  }

  assert.deepEqual(actions, ['next'])
})

test('one moving hand never changes tracks', () => {
  const controller = createHandGestureController()
  const actions = []

  for (const [x, timestamp] of [[0.75, 0], [0.58, 120], [0.4, 260], [0.25, 400]]) {
    const state = controller.update({ landmarks: makeHand({ x }), timestamp })
    if (state.action) actions.push(state.action)
  }

  assert.deepEqual(actions, [])
})

test('hands already together do not change tracks until a new separate-and-join cycle', () => {
  const controller = createHandGestureController()
  const actions = []

  for (const [leftX, rightX, timestamp] of [
    [0.45, 0.55, 0],
    [0.46, 0.54, 300],
    [0.22, 0.78, 500],
    [0.34, 0.66, 650],
    [0.45, 0.55, 820],
  ]) {
    const state = controller.update({
      landmarks: makeHand({ x: leftX }),
      secondaryLandmarks: makeHand({ x: rightX }),
      timestamp,
    })
    if (state.action) actions.push(state.action)
  }

  assert.deepEqual(actions, ['next'])
})

test('closed hands and mostly vertical motion do not change tracks', () => {
  const controller = createHandGestureController()

  controller.update({ landmarks: makeHand({ x: 0.72, open: false }), timestamp: 100 })
  assert.equal(controller.update({
    landmarks: makeHand({ x: 0.38, open: false }),
    timestamp: 300,
  }).action, null)

  controller.reset()
  controller.update({ landmarks: makeHand({ x: 0.72, y: 0.7, open: true }), timestamp: 500 })
  assert.equal(controller.update({
    landmarks: makeHand({ x: 0.38, y: 0.42, open: true }),
    timestamp: 720,
  }).action, null)
})

test('losing the tracked hand clears a pending gesture and gathers particles', () => {
  const controller = createHandGestureController()
  const open = controller.update({ landmarks: makeHand({ open: true }), timestamp: 100 })
  const missing = controller.update({ landmarks: null, timestamp: 160 })

  assert.equal(missing.tracking, false)
  assert.ok(missing.scatter < open.scatter)

  controller.update({ landmarks: makeHand({ x: 0.35, open: true }), timestamp: 220 })
  assert.equal(controller.update({
    landmarks: makeHand({ x: 0.34, open: true }),
    timestamp: 300,
  }).action, null)
})
