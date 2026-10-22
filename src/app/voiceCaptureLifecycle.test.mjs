import assert from 'node:assert/strict'
import test from 'node:test'
import { createCaptureOperationQueue } from './voiceCaptureLifecycle.js'

test('rapid second capture waits for the previous asynchronous microphone close', async () => {
  const operations = createCaptureOperationQueue()
  const events = []
  let releaseClose
  const closed = new Promise((resolve) => { releaseClose = resolve })
  const first = operations.run(async () => {
    events.push('closing old stream')
    await closed
    events.push('closed old stream')
  })
  const second = operations.run(() => { events.push('started new stream') })
  await Promise.resolve()
  assert.deepEqual(events, ['closing old stream'])
  releaseClose()
  await Promise.all([first, second])
  assert.deepEqual(events, ['closing old stream', 'closed old stream', 'started new stream'])
})

test('a denied capture can still release ownership and allow a later retry', async () => {
  const operations = createCaptureOperationQueue()
  const denied = operations.run(() => { throw new Error('permission denied') })
  let released = false
  const cleanup = operations.run(() => { released = true })
  await assert.rejects(denied, /permission denied/)
  await cleanup
  assert.equal(released, true)
  assert.equal(await operations.run(() => 'retry started'), 'retry started')
  await operations.idle()
})
