import assert from 'node:assert/strict'
import test from 'node:test'

import { fetchWithRetry } from './netRequest.js'

test('caller cancellation reaches the fetch and is not retried', async () => {
  const caller = new AbortController()
  let attempts = 0
  let downstreamSignal
  const pending = fetchWithRetry('https://example.test/audio', { signal: caller.signal }, {
    attempts: 3,
    timeoutMs: 5000,
    retryDelayMs: 0,
    fetchImpl: (_url, options) => {
      attempts += 1
      downstreamSignal = options.signal
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      })
    },
  })

  await Promise.resolve()
  assert.equal(downstreamSignal.aborted, false)
  caller.abort(Object.assign(new Error('client left'), { name: 'AbortError' }))
  await assert.rejects(pending, { name: 'AbortError', message: 'client left' })
  assert.equal(attempts, 1)
})

test('timeout is combined with rather than substituted for the caller signal', async () => {
  let downstreamSignal
  const pending = fetchWithRetry('https://example.test/audio', { signal: new AbortController().signal }, {
    attempts: 1,
    timeoutMs: 15,
    fetchImpl: (_url, options) => {
      downstreamSignal = options.signal
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      })
    },
  })

  await assert.rejects(pending, { name: 'TimeoutError' })
  assert.equal(downstreamSignal.aborted, true)
})
