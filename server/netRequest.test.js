import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'

import { fetchWithRetry } from './netRequest.js'

async function delayedAudioServer(t) {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'audio/mpeg' })
    res.write('first audio chunk;')
    const timer = setTimeout(() => res.end('last audio chunk'), 400)
    res.on('close', () => clearTimeout(timer))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => {
    server.close(resolve)
    server.closeAllConnections()
  }))
  return `http://127.0.0.1:${server.address().port}/audio`
}

test('streaming audio continues after its response-header timeout has elapsed', async t => {
  const url = await delayedAudioServer(t)
  const response = await fetchWithRetry(url, {}, { attempts: 1, timeoutMs: 150, timeoutScope: 'headers' })
  assert.equal(await response.text(), 'first audio chunk;last audio chunk')
})

test('ordinary API response bodies retain their deadline', async t => {
  const url = await delayedAudioServer(t)
  const response = await fetchWithRetry(url, {}, { attempts: 1, timeoutMs: 150 })
  await assert.rejects(response.text(), { name: 'TimeoutError' })
})

test('a stream that never sends headers still times out', async () => {
  await assert.rejects(fetchWithRetry('https://example.test/audio', {}, {
    attempts: 1, timeoutMs: 15, timeoutScope: 'headers',
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }),
  }), { name: 'TimeoutError' })
})

test('leaving the player still cancels an audio body after headers arrive', async t => {
  const url = await delayedAudioServer(t)
  const caller = new AbortController()
  const response = await fetchWithRetry(url, { signal: caller.signal }, {
    attempts: 1, timeoutMs: 150, timeoutScope: 'headers',
  })
  const body = response.text()
  caller.abort()
  await assert.rejects(body, { name: 'AbortError' })
})

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
