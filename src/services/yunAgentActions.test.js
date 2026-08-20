import test from 'node:test'
import assert from 'node:assert/strict'
import { executeYunAgentActions } from './yunAgentActions.js'

test('liked-song action uses the stable liked flag when the playlist was renamed', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url) => {
    if (String(url).startsWith('/api/netease/me')) {
      return { ok: true, json: async () => ({ loggedIn: true, playlists: [{ id: 'liked-id', name: '哈基蚦喜欢的音乐', liked: true }] }) }
    }
    if (String(url).startsWith('/api/netease/playlist/tracks?id=liked-id')) {
      return { ok: true, json: async () => ({ ok: true, songs: [{ id: '1', name: '雨天', ar: [{ name: '薛之谦' }] }] }) }
    }
    throw new Error(`Unexpected request: ${url}`)
  }
  const player = {
    currentSong: null,
    playSongFromQueue: async (song, queue) => {
      calls.push({ song, queue })
      return { ok: true }
    },
  }

  try {
    const [result] = await executeYunAgentActions([
      { type: 'music.play_netease_playlist', payload: { playlistName: '我喜欢的音乐' } },
    ], { player })
    assert.equal(result.ok, true)
    assert.equal(calls[0].song.title, '雨天')
  } finally {
    globalThis.fetch = originalFetch
  }
})
