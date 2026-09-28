import assert from 'node:assert/strict'
import test from 'node:test'

import { awaitConversationMemoryWrites } from './conversationMemoryWrites.js'

test('disabled persisted memory policy skips all turn writes', async () => {
  let writes = 0
  const result = await awaitConversationMemoryWrites({
    policy: { enabled: false },
    writes: [async () => { writes += 1 }],
  })

  assert.equal(result.written, false)
  assert.equal(writes, 0)
})

test('a turn waits for its memory writes and passes the turn AbortSignal', async () => {
  let release
  let writeSignal
  let settled = false
  const signal = new AbortController().signal
  const pending = awaitConversationMemoryWrites({
    policy: { enabled: true },
    signal,
    writes: [({ signal: receivedSignal }) => {
      writeSignal = receivedSignal
      return new Promise((resolve) => { release = resolve })
    }],
  }).then((result) => {
    settled = true
    return result
  })

  await Promise.resolve()
  assert.equal(writeSignal, signal)
  assert.equal(settled, false)
  release()
  assert.equal((await pending).written, true)
  assert.equal(settled, true)
})

test('a cancelled turn cannot begin memory writes', async () => {
  const controller = new AbortController()
  controller.abort(Object.assign(new Error('old turn'), { name: 'AbortError' }))
  let writes = 0

  await assert.rejects(
    awaitConversationMemoryWrites({
      policy: { enabled: true },
      signal: controller.signal,
      writes: [async () => { writes += 1 }],
    }),
    { name: 'AbortError' },
  )
  assert.equal(writes, 0)
})
