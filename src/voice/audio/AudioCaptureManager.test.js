import assert from 'node:assert/strict'
import test from 'node:test'

import { AudioCaptureManager } from './AudioCaptureManager.js'

function installFakeBrowser({ getUserMedia } = {}) {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const tracks = []
  const node = () => ({ connect() {}, disconnect() {} })
  class FakeAudioContext {
    constructor() {
      this.sampleRate = 48_000
      this.state = 'running'
      this.destination = node()
    }
    createMediaStreamSource() { return node() }
    createScriptProcessor() { return { ...node(), onaudioprocess: null } }
    createGain() { return { ...node(), gain: { value: 1 } } }
    async resume() {}
    async close() { this.state = 'closed' }
  }
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async (...args) => {
      const stream = await getUserMedia(...args)
      tracks.push(...stream.getTracks())
      return stream
    } } },
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { AudioContext: FakeAudioContext, setTimeout, clearTimeout },
  })
  return {
    tracks,
    restore() {
      if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
      else delete globalThis.navigator
      if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
      else delete globalThis.window
    },
  }
}

test('native ownership prevents Chromium from requesting the physical microphone', async () => {
  const manager = new AudioCaptureManager()
  await manager.setOwner('native')

  await assert.rejects(manager.start(), /microphone_owned_by_native/)
  await assert.rejects(manager.setOwner('browser'), /microphone_owned_by_native/)
  assert.equal(manager.getMetrics().captureOwner, 'native')
})

test('concurrent browser consumers share one getUserMedia open and native handoff closes it', async () => {
  let opens = 0
  const browser = installFakeBrowser({
    getUserMedia: async () => {
      opens += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
      const track = { stop() { this.stopped = true } }
      return { getTracks: () => [track] }
    },
  })
  const manager = new AudioCaptureManager()
  try {
    await Promise.all([manager.start(), manager.start()])
    assert.equal(opens, 1)
    assert.equal(manager.getMetrics().captureOwner, 'browser')

    await manager.setOwner('native')
    assert.equal(browser.tracks[0].stopped, true)
    await assert.rejects(manager.start(), /microphone_owned_by_native/)
    assert.equal(opens, 1)
  } finally {
    await manager.setOwner('none')
    browser.restore()
  }
})
