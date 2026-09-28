import assert from 'node:assert/strict'
import test from 'node:test'

import { fetchLocalApi } from './requestApi.js'

test('a caller abort reaches fetch and stays distinguishable from a timeout', async () => {
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  globalThis.window = globalThis
  const caller = new AbortController()
  let receivedSignal
  globalThis.fetch = (_url, options) => {
    receivedSignal = options.signal
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        reject(new DOMException('request cancelled', 'AbortError'))
      }, { once: true })
    })
  }

  try {
    const request = fetchLocalApi('/api/companion-chat', { signal: caller.signal }, { timeoutMs: 1000 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.ok(receivedSignal)
    caller.abort()
    await assert.rejects(request, (error) => error?.name === 'AbortError')
  } finally {
    globalThis.fetch = originalFetch
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
  }
})

test('request timeout still becomes the local service timeout message', async () => {
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  globalThis.window = globalThis
  globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')), { once: true })
  })

  try {
    await assert.rejects(
      fetchLocalApi('/api/companion-chat', {}, { timeoutMs: 5 }),
      /本地服务响应超时/,
    )
  } finally {
    globalThis.fetch = originalFetch
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
  }
})
