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

test('music.recommend fetches preferences once, reranks production candidates, falls back safely, and never writes memory', async () => {
  const originalFetch = globalThis.fetch
  const candidates = [
    { id: 'A', name: 'A', ar: [{ name: 'Artist' }] },
    { id: 'B', name: 'B', ar: [{ name: 'Artist' }] },
  ]
  const played = []
  const player = { getState: () => ({ currentTrack: null }), playTrackFromQueue: async (track, queue) => { played.push({ track, queue }); return { ok: true } }, setAutoUpNext: () => {} }
  let recommendationCalls = 0
  globalThis.fetch = async (url) => {
    if (url === '/api/netease/recommendations') { recommendationCalls += 1; return { ok: true, json: async () => ({ songs: candidates }) } }
    throw new Error(`unexpected fetch ${url}`)
  }
  const preferenceSnapshot = { tracks: { B: { directListening: { playCount: 4, skipCount: 0 }, derived: { recentAffinity: 3, longTermAffinity: 5, skipRate: 0, confidence: 'high' } } }, artists: {} }
  let preferenceCalls = 0
  try {
    await executeYunAgentActions([{ type: 'music.recommend', payload: {} }], { player, preferenceLoader: async () => { preferenceCalls += 1; return { snapshot: preferenceSnapshot } } })
    assert.equal(preferenceCalls, 1); assert.equal(recommendationCalls, 1); assert.equal(played[0].track.providerId, 'B')
    played.length = 0
    await executeYunAgentActions([{ type: 'music.recommend', payload: {} }], { player, preferenceLoader: async () => { throw new Error('offline') } })
    assert.equal(played[0].track.providerId, 'A')
    played.length = 0
    await executeYunAgentActions([{ type: 'music.recommend', payload: {} }], { player: { ...player, getState: () => ({ currentTrack: { id: 'A', providerId: 'A' } }) }, context: { currentSong: { id: 'A', providerId: 'A' } }, preferenceLoader: async () => ({ snapshot: { tracks: { A: preferenceSnapshot.tracks.B }, artists: {} } }) })
    assert.equal(played[0].track.providerId, 'B')
  } finally { globalThis.fetch = originalFetch }
})
