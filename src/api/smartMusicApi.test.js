import test from 'node:test'
import assert from 'node:assert/strict'
import { requestSmartMusicCommand } from './smartMusicApi.js'

test('retries one transient smart-music failure before rejecting', async () => {
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  let calls = 0
  globalThis.window = { setTimeout: (callback) => { callback(); return 0 } }
  globalThis.fetch = async () => {
    calls += 1
    return calls === 1
      ? { ok: false, json: async () => ({ error: 'temporary failure' }) }
      : { ok: true, json: async () => ({ should_execute: true, command: { type: 'play_search' } }) }
  }

  try {
    const result = await requestSmartMusicCommand({ message: '播放《情歌》' })
    assert.equal(calls, 2)
    assert.equal(result.should_execute, true)
  } finally {
    globalThis.fetch = originalFetch
    globalThis.window = originalWindow
  }
})

test('forwards explicit voice input mode to the intent service', async () => {
  const originalFetch = globalThis.fetch
  let requestBody = null
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body)
    return { ok: true, json: async () => ({ should_execute: false, command: { type: 'none' } }) }
  }

  try {
    await requestSmartMusicCommand({ message: '播放与爱', inputMode: 'voice' })
    assert.equal(requestBody.inputMode, 'voice')
  } finally {
    globalThis.fetch = originalFetch
  }
})
