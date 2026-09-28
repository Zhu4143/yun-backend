import assert from 'node:assert/strict'
import test from 'node:test'

import { saveYunSettings } from './memoryApi.js'

test('memory enabled is persisted through the server settings endpoint', async () => {
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return new Response(JSON.stringify({ memoryEnabled: false, memoryMode: 'deep' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const settings = await saveYunSettings({ memoryEnabled: false, memoryMode: 'deep' })
    assert.equal(request.url, '/api/yun-settings')
    assert.deepEqual(JSON.parse(request.options.body), { memoryEnabled: false, memoryMode: 'deep' })
    assert.equal(settings.memoryEnabled, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})
