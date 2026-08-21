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
    getState: () => ({ currentTrack: null }),
    setPlaybackMode: () => {},
    playTrackFromQueue: async (song, queue) => {
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

test('ordinary music actions use canonical PlayerCore commands', async () => {
  const calls = []
  const diagnostics = { isCrossfading: false }
  const player = {
    next: async () => { calls.push(['next']); return { ok: true } },
    pause: async () => { calls.push(['pause']); return { ok: true } },
    seek: (seconds) => calls.push(['seek', seconds]),
    setPlaybackMode: (mode) => calls.push(['setPlaybackMode', mode]),
    getPlaybackDiagnostics: () => diagnostics,
  }
  let responseMode = ''

  const results = await executeYunAgentActions([
    { type: 'music.next' },
    { type: 'music.pause' },
    { type: 'music.seek', payload: { seconds: 18 } },
    { type: 'music.set_mode', payload: { mode: 'single' } },
    { type: 'music.set_response_mode', payload: { mode: 'silent' } },
    { type: 'music.get_state' },
  ], { player, setResponseMode: (mode) => { responseMode = mode } })

  assert.deepEqual(calls, [['next'], ['pause'], ['seek', 18], ['setPlaybackMode', 'single']])
  assert.equal(responseMode, 'silent')
  assert.equal(results.at(-1).diagnostics, diagnostics)
})
