import test from 'node:test'
import assert from 'node:assert/strict'
import { advanceRecordSpin, createRecordArtwork } from './recordArtwork.js'

function fixture() {
  const jobs = new Map(), released = [], frames = [], errors = []
  const controller = createRecordArtwork({
    load: key => new Promise((resolve, reject) => jobs.set(key, { resolve, reject })),
    release: value => released.push(value), publish: frame => frames.push(frame),
    onError: (...args) => errors.push(args), duration: 2,
  })
  return { controller, jobs, released, frames, errors }
}

test('older image completion cannot replace the latest requested disc', async () => {
  const f = fixture(), a = f.controller.set('a'), b = f.controller.set('b')
  f.jobs.get('b').resolve('texture-b'); await b
  f.jobs.get('a').resolve('texture-a'); await a
  assert.equal(f.frames.at(-1).current.source, 'b')
  assert.deepEqual(f.released, ['texture-a'])
  f.controller.dispose()
})

test('rapid changes finish the visible fade and retain only the latest pending cover', async () => {
  const f = fixture()
  for (const key of ['a', 'b', 'c', 'd']) { const job = f.controller.set(key); f.jobs.get(key).resolve(key); await job }
  assert.deepEqual(f.released, ['c'])
  f.controller.step(1)
  assert.equal(f.frames.at(-1).mix, .5)
  assert.equal(f.frames.at(-1).current.source, 'a')
  f.controller.step(1)
  assert.equal(f.frames.at(-1).current.source, 'b')
  assert.equal(f.frames.at(-1).incoming.source, 'd')
  assert.equal(f.frames.at(-1).mix, 0)
  f.controller.step(2)
  assert.equal(f.frames.at(-1).current.source, 'd')
  f.controller.dispose()
  assert.deepEqual(f.released.sort(), ['a', 'b', 'c', 'd'])
})

test('a failed next artwork preserves the displayed disc and allows retry', async () => {
  const f = fixture(), a = f.controller.set('a')
  f.jobs.get('a').resolve('a'); await a
  const b = f.controller.set('b'); f.jobs.get('b').reject(new Error('offline')); await b
  assert.equal(f.frames.at(-1).current.source, 'a')
  assert.equal(f.errors[0][1], true)
  const retry = f.controller.set('b'); f.jobs.get('b').resolve('b'); await retry
  f.controller.step(0, true)
  assert.equal(f.frames.at(-1).current.source, 'b')
  f.controller.dispose()
})

test('same-cover metadata changes do not reload a texture or restart its transition', async () => {
  const f = fixture(), a = f.controller.set('a', 'first-track')
  f.jobs.get('a').resolve('a'); await a
  await f.controller.set('a', 'second-track')
  assert.equal(f.frames.length, 1)
  assert.equal(f.jobs.size, 1)
  f.controller.dispose()
  assert.deepEqual(f.released, ['a'])
})

test('reduced motion settles both the visible fade and its newest pending image', async () => {
  const f = fixture()
  for (const key of ['a', 'b', 'c']) { const job = f.controller.set(key); f.jobs.get(key).resolve(key); await job }
  f.controller.step(.5)
  f.controller.step(0, true)
  assert.equal(f.frames.at(-1).current.source, 'c')
  assert.equal(f.frames.at(-1).incoming, null)
  assert.deepEqual(f.released, ['a', 'b'])
  f.controller.dispose()
  assert.deepEqual(f.released, ['a', 'b', 'c'])
})

test('unmount releases visible and queued images and rejects a late decode', async () => {
  const f = fixture(), a = f.controller.set('a')
  f.jobs.get('a').resolve('a'); await a
  const b = f.controller.set('b')
  f.controller.dispose(); f.controller.dispose()
  f.jobs.get('b').resolve('b'); await b
  assert.deepEqual(f.released, ['a', 'b'])
  assert.equal(f.frames.length, 1)
})

test('pause and resume keep the current angle and smoothly reverse the speed target', () => {
  let state = { angle: 1.2, speed: 0 }
  for (let i = 0; i < 60; i++) state = advanceRecordSpin(state, true, 1 / 60)
  const before = state
  state = advanceRecordSpin(state, false, 1 / 60)
  assert.ok(state.angle > before.angle)
  assert.ok(state.speed > 0 && state.speed < before.speed)
  const paused = state
  state = advanceRecordSpin(state, true, 1 / 60)
  assert.ok(state.angle > paused.angle && state.speed > paused.speed)
  assert.deepEqual(advanceRecordSpin(state, true, 1, true), { angle: state.angle, speed: 0 })
})

test('spin integration is independent of frame subdivision', () => {
  const start = { angle: 2, speed: .12 }
  const one = advanceRecordSpin(start, true, .1)
  let many = start
  for (let i = 0; i < 10; i++) many = advanceRecordSpin(many, true, .01)
  assert.ok(Math.abs(one.angle - many.angle) < 1e-12)
  assert.ok(Math.abs(one.speed - many.speed) < 1e-12)
})
