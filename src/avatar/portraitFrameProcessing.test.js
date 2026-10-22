import test from 'node:test'
import assert from 'node:assert/strict'
import { createPortraitFrameQueue, createPortraitFrameProcessor } from './portraitFrameProcessing.js'

function setup() {
  const sent = [], frames = [], errors = []
  const worker = { postMessage: (...args) => sent.push(args), terminate() { this.terminated = true } }
  const queue = createPortraitFrameQueue({ worker, onFrame: (...args) => frames.push(args), onError: error => errors.push(error) })
  const frame = () => ({ rgba: new Uint8ClampedArray(64), width: 4, height: 4, pointCount: 16 })
  const finish = () => worker.onmessage({ data: { id: sent.at(-1)[0].id, result: { uvs: new Float32Array(32), colors: new Float32Array(48) } } })
  return { queue, worker, sent, frames, errors, frame, finish }
}

test('frame submission transfers work without computing pixels on the UI thread and bounds backlog to one', () => {
  const s = setup()
  const frame = s.frame()
  assert.equal(s.queue.submit(frame, { clip: 'listening' }), true)
  assert.equal(s.sent.length, 1)
  assert.equal(s.sent[0][1][0], frame.rgba.buffer)
  assert.equal(s.frames.length, 0)
  for (let i = 0; i < 100; i++) assert.equal(s.queue.submit(s.frame(), {}), false)
  assert.equal(s.sent.length, 1)
  s.finish()
  assert.equal(s.frames.length, 1)
  assert.deepEqual(s.frames[0][1], { clip: 'listening' })
  assert.equal(s.queue.submit(s.frame(), {}), true)
})

test('clip invalidation drops the previous result and releases the next frame', () => {
  const s = setup()
  s.queue.submit(s.frame(), { clip: 'wake' })
  s.queue.invalidate()
  assert.equal(s.queue.submit(s.frame(), { clip: 'speaking' }), false)
  s.finish()
  assert.equal(s.frames.length, 0)
  s.queue.submit(s.frame(), { clip: 'speaking' })
  s.finish()
  assert.equal(s.frames[0][1].clip, 'speaking')
})

test('draining an invalidated frame retries a paused new clip without another video callback', () => {
  const sent = [], published = []
  const worker = { postMessage: message => sent.push(message), terminate() {} }
  const frame = () => ({ rgba: new Uint8ClampedArray(64), width: 4, height: 4, pointCount: 16 })
  let nextClip = null
  const queue = createPortraitFrameQueue({ worker, onFrame: (_frame, clip) => published.push(clip), onError: assert.fail,
    onIdle: () => { if (nextClip) { const clip = nextClip; nextClip = null; queue.submit(frame(), clip) } },
  })
  queue.submit(frame(), 'wake')
  queue.invalidate()
  nextClip = 'thinking'
  assert.equal(queue.submit(frame(), nextClip), false)
  worker.onmessage({ data: { id: sent[0].id, result: {} } })
  assert.equal(sent.length, 2)
  worker.onmessage({ data: { id: sent[1].id, result: {} } })
  assert.deepEqual(published, ['thinking'])
})

test('disposed work cannot publish or accept new frames; worker failure is surfaced for fallback', () => {
  const s = setup()
  s.queue.submit(s.frame(), {})
  const lateReply = s.worker.onmessage
  s.queue.dispose()
  lateReply({ data: { id: 1, result: {} } })
  assert.equal(s.frames.length, 0)
  assert.equal(s.worker.terminated, true)
  assert.equal(s.queue.submit(s.frame(), {}), false)
  const failed = setup()
  failed.worker.onerror(new Error('worker unavailable'))
  assert.equal(failed.errors.length, 1)
  assert.equal(failed.queue.submit(failed.frame(), {}), false)
})

test('frame processor retains stable assignments and owns published buffers across frames', () => {
  const process = createPortraitFrameProcessor()
  const rgba = new Uint8ClampedArray(16 * 16 * 4).fill(240)
  for (let y = 3; y < 14; y++) for (let x = 4; x < 12; x++) rgba.set([120, 60, 30, 255], (y * 16 + x) * 4)
  const first = process({ rgba, width: 16, height: 16, pointCount: 100 })
  const saved = first.uvs.slice()
  const second = process({ rgba, width: 16, height: 16, pointCount: 100 })
  assert.deepEqual(second.uvs, saved)
  assert.deepEqual(second.colors, first.colors)
  second.uvs.fill(0)
  assert.deepEqual(first.uvs, saved)
})
