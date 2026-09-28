import test from 'node:test'
import assert from 'node:assert/strict'
import { requestSongReaction } from './songReactionApi.js'

test('companion transition sends both tracks and the selected speaking length', async () => {
  const originalFetch = globalThis.fetch
  let request
  let fetchOptions
  globalThis.fetch = async (_url, options) => {
    fetchOptions = options
    request = JSON.parse(options.body)
    return { ok: true, json: async () => ({ reply: '下一首。', shouldSpeak: true }) }
  }
  try {
    const controller = new AbortController()
    await requestSongReaction({
      song: { id: 'next', title: '下一首', artist: '歌手' },
      previousSong: { id: 'previous', title: '上一首', artist: '前一位', moodTags: ['平静'], energy: 36 },
      trigger: 'companion_transition',
      responseMode: 'podcast',
      announcementLength: 'long',
      responseId: 'response-123',
      signal: controller.signal,
    })
    assert.equal(request.trigger, 'companion_transition')
    assert.equal(request.responseMode, 'podcast')
    assert.equal(request.announcementLength, 'long')
    assert.equal(request.responseId, 'response-123')
    assert.equal(fetchOptions.headers['X-Yun-Response-Id'], 'response-123')
    assert.equal(fetchOptions.signal, controller.signal)
    assert.deepEqual(request.previousSong, { title: '上一首', artist: '前一位', moodTags: ['平静'], energy: 36 })
  } finally {
    globalThis.fetch = originalFetch
  }
})
