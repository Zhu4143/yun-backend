import test from 'node:test'
import assert from 'node:assert/strict'
import {
  checkNeteaseSongPlayable,
  fetchNeteaseCloud,
  fetchNeteaseAiRecommendations,
  fetchNeteaseDailySongs,
  fetchNeteaseLikedStatus,
  fetchNeteaseMembership,
  fetchNeteasePersonalFm,
  fetchNeteasePodcastPrograms,
  fetchNeteasePodcasts,
  fetchNeteaseRecentHistory,
  fetchNeteaseRecommendedPlaylists,
  fetchNeteaseSearchSuggestions,
  fetchNeteaseSongDetails,
  fetchNeteaseStateSummary,
  fetchNeteaseSubscribedAlbums,
  fetchNeteaseSubscribedArtists,
  fetchNeteaseSubscriptionCounts,
  fetchNeteasePlaylistDetail,
  fetchNeteaseUserRecord,
  NeteaseApiError,
  normalizeNeteaseSong,
  resolveNeteaseSongCandidate,
  resolveNeteaseSongFromLyrics,
  resolveNeteaseStreamQuality,
  searchNeteaseSongs,
} from './neteaseApi.js'

const rawSong = { id: '123', title: '真实歌曲', artist: '真实歌手', album: '真实专辑', coverUrl: 'https://img.example/cover.jpg', duration: 123000 }

async function captureRequest(payload, callback, { ok = true, status = 200 } = {}) {
  const originalFetch = globalThis.fetch
  let request = null
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options }
    return { ok, status, json: async () => payload }
  }
  try {
    return { request: () => request, value: await callback() }
  } finally {
    globalThis.fetch = originalFetch
  }
}

test('canonical frontend normalization stabilizes every PlayerCore field', () => {
  assert.deepEqual(normalizeNeteaseSong(rawSong), {
    ...rawSong,
    id: 'netease-123',
    providerId: '123',
    source: 'netease',
    title: '真实歌曲',
    name: '真实歌曲',
    artist: '真实歌手',
    album: '真实专辑',
    fileUrl: '/api/netease/audio?id=123',
    coverUrl: '/api/netease/cover?url=https%3A%2F%2Fimg.example%2Fcover.jpg',
    duration: 123000,
    moodTags: ['online'],
    sceneTags: ['netease'],
    energy: 50,
    memoryWeight: 40,
  })
})

test('P1 read methods use explicit non-mutating endpoints', async (t) => {
  const cases = [
    { name: 'liked status', run: () => fetchNeteaseLikedStatus('123'), payload: { ok: true, statuses: [] }, path: '/api/netease/library/liked-status?ids=123' },
    { name: 'subscription counts', run: fetchNeteaseSubscriptionCounts, payload: { ok: true, playlists: 2 }, path: '/api/netease/library/subscription-counts' },
    { name: 'subscribed albums', run: () => fetchNeteaseSubscribedAlbums({ limit: 5 }), payload: { ok: true, albums: [] }, path: '/api/netease/library/subscribed-albums?limit=5&offset=0' },
    { name: 'subscribed artists', run: () => fetchNeteaseSubscribedArtists({ limit: 5 }), payload: { ok: true, artists: [] }, path: '/api/netease/library/subscribed-artists?limit=5&offset=0' },
    { name: 'membership', run: fetchNeteaseMembership, payload: { ok: true, redVipLevel: 7 }, path: '/api/netease/account/membership' },
    { name: 'playlist detail', run: () => fetchNeteasePlaylistDetail('91'), payload: { ok: true, playlist: { id: '91' }, songs: [rawSong] }, path: '/api/netease/playlist/detail?id=91' },
  ]

  for (const item of cases) {
    await t.test(item.name, async () => {
      const captured = await captureRequest(item.payload, item.run)
      assert.equal(captured.request().url, item.path)
    })
  }
})

test('P0 frontend API methods use their declared backend endpoints', async (t) => {
  const cases = [
    { name: 'daily songs', run: fetchNeteaseDailySongs, payload: { ok: true, songs: [rawSong] }, path: '/api/netease/recommend/daily-songs' },
    { name: 'recommended playlists', run: fetchNeteaseRecommendedPlaylists, payload: { ok: true, playlists: [{ id: '9' }] }, path: '/api/netease/recommend/playlists' },
    { name: 'personal FM', run: fetchNeteasePersonalFm, payload: { ok: true, songs: [rawSong] }, path: '/api/netease/recommend/personal-fm' },
    { name: 'recent history', run: () => fetchNeteaseRecentHistory({ type: 'song', limit: 5 }), payload: { ok: true, songs: [rawSong], items: [{ song: rawSong }] }, path: '/api/netease/history/recent?type=song&limit=5' },
    { name: 'user record', run: () => fetchNeteaseUserRecord({ type: 'week', limit: 5 }), payload: { ok: true, songs: [rawSong], records: [{ song: rawSong }] }, path: '/api/netease/history/user-record?type=week&limit=5' },
    { name: 'podcast list', run: () => fetchNeteasePodcasts({ limit: 5 }), payload: { ok: true, podcasts: [] }, path: '/api/netease/podcasts?source=subscribed&limit=5&offset=0' },
    { name: 'podcast programs', run: () => fetchNeteasePodcastPrograms('21', { limit: 5 }), payload: { ok: true, programs: [{ song: rawSong }] }, path: '/api/netease/podcast/programs?id=21&limit=5&offset=0&asc=false' },
    { name: 'cloud', run: () => fetchNeteaseCloud({ limit: 5 }), payload: { ok: true, songs: [rawSong], items: [{ song: rawSong }] }, path: '/api/netease/cloud?limit=5&offset=0' },
    { name: 'search suggestions', run: () => fetchNeteaseSearchSuggestions('真实'), payload: { ok: true, songs: [rawSong] }, path: '/api/netease/search/suggest?keywords=%E7%9C%9F%E5%AE%9E&type=web' },
    { name: 'song detail', run: () => fetchNeteaseSongDetails('123'), payload: { ok: true, songs: [rawSong] }, path: '/api/netease/song/detail?ids=123' },
    { name: 'playability', run: () => checkNeteaseSongPlayable('123'), payload: { ok: true, playable: true }, path: '/api/netease/song/playability?id=123&br=999000' },
    { name: 'state summary', run: fetchNeteaseStateSummary, payload: { ok: true, account: { loggedIn: true } }, path: '/api/netease/state-summary' },
  ]

  for (const item of cases) {
    await t.test(item.name, async () => {
      const captured = await captureRequest(item.payload, item.run)
      assert.equal(captured.request().url, item.path)
    })
  }
})

test('all song-bearing P0 responses converge on the same canonical shape', async () => {
  const results = []
  results.push((await captureRequest({ ok: true, songs: [rawSong] }, fetchNeteaseDailySongs)).value[0])
  results.push((await captureRequest({ ok: true, songs: [rawSong] }, fetchNeteasePersonalFm)).value[0])
  results.push((await captureRequest({ ok: true, songs: [rawSong], items: [] }, () => fetchNeteaseRecentHistory())).value.songs[0])
  results.push((await captureRequest({ ok: true, songs: [rawSong], records: [] }, () => fetchNeteaseUserRecord())).value.songs[0])
  results.push((await captureRequest({ ok: true, songs: [rawSong], items: [] }, () => fetchNeteaseCloud())).value.songs[0])
  results.push((await captureRequest({ ok: true, songs: [rawSong] }, () => fetchNeteaseSongDetails('123'))).value[0])
  for (const song of results) {
    assert.deepEqual(
      Object.fromEntries(['id', 'providerId', 'source', 'title', 'artist', 'album', 'fileUrl', 'coverUrl', 'duration'].map((key) => [key, song[key]])),
      Object.fromEntries(['id', 'providerId', 'source', 'title', 'artist', 'album', 'fileUrl', 'coverUrl', 'duration'].map((key) => [key, results[0][key]])),
    )
  }
})

test('stream quality returns a canonical track with a level-specific proxy URL', async () => {
  const captured = await captureRequest({ ok: true, requestedLevel: 'lossless', level: 'lossless', encodeType: 'flac', fileUrl: '/api/netease/audio?id=123&level=lossless' }, () => resolveNeteaseStreamQuality(normalizeNeteaseSong(rawSong), 'lossless'))
  assert.equal(captured.request().url, '/api/netease/song/stream?id=123&level=lossless')
  assert.equal(captured.value.id, 'netease-123')
  assert.equal(captured.value.streamLevel, 'lossless')
  assert.equal(captured.value.fileUrl, '/api/netease/audio?id=123&level=lossless')
})

test('typed backend API errors survive the frontend boundary', async () => {
  await assert.rejects(
    () => captureRequest({ ok: false, code: 'vip_required', error: '需要会员权限' }, () => resolveNeteaseStreamQuality(normalizeNeteaseSong(rawSong), 'jymaster'), { ok: false, status: 403 }),
    (error) => error instanceof NeteaseApiError && error.code === 'vip_required',
  )
})

test('search, voice resolution, lyric resolution and recommendations preserve network_error', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new TypeError('fetch failed') }
  const cases = [
    () => searchNeteaseSongs('雨爱'),
    () => resolveNeteaseSongCandidate({ transcript: '与爱', interpretation: '雨爱', candidates: [rawSong] }),
    () => resolveNeteaseSongFromLyrics('夜空中最亮的星'),
    () => fetchNeteaseAiRecommendations({ currentSong: rawSong }),
  ]
  try {
    for (const run of cases) {
      await assert.rejects(run, (error) => error instanceof NeteaseApiError && error.code === 'network_error')
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('personal FM empty success payload becomes empty_result', async () => {
  await assert.rejects(
    () => captureRequest({ ok: true, songs: [] }, fetchNeteasePersonalFm),
    (error) => error instanceof NeteaseApiError && error.code === 'empty_result',
  )
})
