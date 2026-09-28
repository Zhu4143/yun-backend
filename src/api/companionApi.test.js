import assert from 'node:assert/strict'
import test from 'node:test'

import { sendCompanionMessage } from './companionApi.js'

test('companion chat sends a stable turn ID and abort signal to the local backend', async () => {
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  globalThis.window = globalThis
  const caller = new AbortController()
  let requestOptions
  globalThis.fetch = async (_url, options) => {
    requestOptions = options
    return new Response(JSON.stringify({ reply: '收到' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const result = await sendCompanionMessage({
      userText: '继续',
      responseId: 'yun-turn-test-1',
      signal: caller.signal,
    })

    assert.equal(result.reply, '收到')
    assert.equal(JSON.parse(requestOptions.body).responseId, 'yun-turn-test-1')
    assert.ok(requestOptions.signal)
    assert.equal(requestOptions.signal.aborted, false)
  } finally {
    globalThis.fetch = originalFetch
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
  }
})
