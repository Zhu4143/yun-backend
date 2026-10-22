import assert from 'node:assert/strict'
import test from 'node:test'
import { checkNeteaseLoginQr, createNeteaseLoginQr, fetchNeteaseLoginStatus, logoutNetease } from './neteaseAuthApi.js'

test('closing login can cancel status and QR polling requests', async () => {
  const original = globalThis.fetch
  const request = new AbortController()
  request.abort()
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.signal, request.signal)
    options.signal.throwIfAborted()
  }
  try {
    await assert.rejects(fetchNeteaseLoginStatus({ signal: request.signal }), { name: 'AbortError' })
    await assert.rejects(checkNeteaseLoginQr('sample-key', { signal: request.signal }), { name: 'AbortError' })
  } finally { globalThis.fetch = original }
})

test('QR creation shares cancellation across its key and image requests', async () => {
  const original = globalThis.fetch
  const request = new AbortController()
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, signal: options.signal })
    return { ok: true, json: async () => calls.length === 1 ? { key: 'key with spaces' } : { img: 'data:image/png;base64,fixture' } }
  }
  try {
    const result = await createNeteaseLoginQr({ signal: request.signal })
    assert.equal(result.key, 'key with spaces')
    assert.equal(calls.length, 2)
    assert.ok(calls.every(call => call.signal === request.signal))
    assert.match(calls[1].url, /key=key%20with%20spaces/)
  } finally { globalThis.fetch = original }
})

test('a failed logout response never reports a successful disconnection', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: false, error: 'Connection failed' }) })
  try { await assert.rejects(logoutNetease(), /Connection failed/) }
  finally { globalThis.fetch = original }
})
