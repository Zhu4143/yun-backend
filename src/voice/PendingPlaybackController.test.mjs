import assert from 'node:assert/strict'
import test from 'node:test'

import { PendingPlaybackController } from './PendingPlaybackController.mjs'

test('native playback settles successfully when the end event arrives', async () => {
  const playback = new PendingPlaybackController()
  const pending = playback.begin({ timeoutMs: 60_000 })

  assert.equal(pending.finish(true), true)
  assert.equal(await pending.promise, true)
  assert.equal(playback.hasPending(), false)
})

test('stopping native playback settles its pending promise as interrupted', async () => {
  const playback = new PendingPlaybackController()
  const pending = playback.begin({ timeoutMs: 60_000 })

  assert.equal(playback.stop(), true)
  assert.equal(await pending.promise, false)
  assert.equal(playback.hasPending(), false)
})

test('rapid replacement and preview-to-speech transitions settle every prior play', async () => {
  const playback = new PendingPlaybackController()
  const preview = playback.begin({ timeoutMs: 60_000 })
  const firstSpeech = playback.begin({ timeoutMs: 60_000 })
  const secondSpeech = playback.begin({ timeoutMs: 60_000 })

  assert.deepEqual(await Promise.all([preview.promise, firstSpeech.promise]), [false, false])
  assert.equal(playback.stop(), true)
  assert.equal(await secondSpeech.promise, false)
  assert.equal(playback.hasPending(), false)
})

test('timeout completes a native playback that lost its end event', async () => {
  const playback = new PendingPlaybackController()
  const pending = playback.begin({ timeoutMs: 5 })

  assert.equal(await pending.promise, true)
  assert.equal(playback.hasPending(), false)
})

test('browser playback timeout settles as interrupted instead of hanging', async () => {
  const playback = new PendingPlaybackController()
  const pending = playback.begin({ timeoutMs: 5, timeoutResult: false })

  assert.equal(await pending.promise, false)
  assert.equal(playback.hasPending(), false)
})
