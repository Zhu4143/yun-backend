import assert from 'node:assert/strict'
import test from 'node:test'

import { UpNextQueueTransaction } from './UpNextQueueTransaction.js'

test('a failed queued track remains available for the next attempt', async () => {
  const transaction = new UpNextQueueTransaction()
  const song = { id: 'net-17', fileUrl: '/api/netease/audio?id=17' }
  const queue = [song]
  let commits = 0

  const result = await transaction.run({
    candidate: song,
    source: 'manual',
    play: async () => ({ ok: false, error: 'source_unavailable' }),
    commit: () => { commits += 1; queue.shift() },
  })

  assert.equal(result.queueCommitted, false)
  assert.equal(result.queueSource, 'manual')
  assert.equal(commits, 0)
  assert.deepEqual(queue, [song])
})

test('a queued track is committed only after playback succeeds', async () => {
  const transaction = new UpNextQueueTransaction()
  const song = { id: 'local-3', fileUrl: '/api/music/file/3' }
  const queue = [song]

  const result = await transaction.run({
    candidate: song,
    source: 'automatic',
    play: async () => ({ ok: true, song }),
    commit: () => queue.shift(),
  })

  assert.equal(result.ok, true)
  assert.equal(result.queueCommitted, true)
  assert.equal(result.queueSource, 'automatic')
  assert.deepEqual(queue, [])
})

test('only one next-track transaction can run at a time', async () => {
  const transaction = new UpNextQueueTransaction()
  let resolvePlay
  const first = transaction.run({
    candidate: { id: 'first' },
    source: 'manual',
    play: () => new Promise((resolve) => { resolvePlay = resolve }),
    commit: () => {},
  })
  await new Promise((resolve) => {
    const waitUntilPlaying = () => resolvePlay ? resolve() : setTimeout(waitUntilPlaying, 0)
    waitUntilPlaying()
  })

  const second = await transaction.run({
    candidate: { id: 'second' },
    source: 'manual',
    play: async () => ({ ok: true }),
    commit: () => {},
  })
  resolvePlay({ ok: true })
  await first

  assert.equal(second.error, 'queue_transition_in_progress')
  assert.equal(second.queueCommitted, false)
})
