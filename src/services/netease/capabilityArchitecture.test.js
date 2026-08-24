import test from 'node:test'
import assert from 'node:assert/strict'
import { NeteaseApiAdapter } from './apiAdapter.js'
import { NeteaseCapabilityExecutor, formatCapabilityExecutionReply } from './capabilityExecutor.js'
import { planNeteaseCapability, selectNeteaseSongCandidate } from './capabilityPlanner.js'
import { getCapability, listCapabilities, NETEASE_CAPABILITIES } from './capabilityRegistry.js'
import { NeteaseDesktopAdapter } from './desktopAdapter.js'
import { YunPlayerAdapter } from './playerAdapter.js'
import { getNeteaseStateSnapshot } from './stateSnapshot.js'

const rainLove = { providerId: 'rain-love', title: '雨爱', artist: '杨丞琳' }
const otherLove = { providerId: 'other-love', title: '爱', artist: '测试歌手' }
const rainyDay = { providerId: 'rainy-day', title: '雨天', artist: '孙燕姿' }
const underRain = { providerId: 'under-rain', title: '下雨天', artist: '南拳妈妈' }

test('registry ids are unique', () => {
  const ids = NETEASE_CAPABILITIES.map((item) => item.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('every executable capability has one explicit transport', () => {
  const executable = listCapabilities({ executableOnly: true })
  assert.ok(executable.length > 0)
  for (const item of executable) assert.ok(['api', 'player', 'desktop'].includes(item.transport), item.id)
})

test('capability discovery can expose only the relevant domain', () => {
  const audio = listCapabilities({ domain: 'audio' })
  assert.ok(audio.length >= 5)
  assert.ok(audio.every((item) => item.domain === 'audio'))
})

test('API capability always uses API even when desktop is present', async () => {
  const calls = []
  const executor = new NeteaseCapabilityExecutor({
    apiAdapter: { execute: async () => { calls.push('api'); return ['song'] } },
    desktopAdapter: { execute: async () => { calls.push('desktop'); return { ok: true } } },
  })
  const result = await executor.execute({ capability: 'netease.search.song', action: 'search', args: { query: '晴天' } })
  assert.equal(result.ok, true)
  assert.deepEqual(calls, ['api'])
})

test('API-supported capability cannot be routed to desktop by the caller', async () => {
  let desktopCalls = 0
  const executor = new NeteaseCapabilityExecutor({
    apiAdapter: { execute: async () => [] },
    desktopAdapter: { execute: async () => { desktopCalls += 1 } },
  })
  const result = await executor.execute({ capability: 'netease.song.comments', action: 'list' })
  assert.equal(result.transport, 'api')
  assert.equal(desktopCalls, 0)
})

test('API timeout never falls back to desktop', async () => {
  let desktopCalls = 0
  const executor = new NeteaseCapabilityExecutor({
    apiAdapter: { execute: async () => { throw new Error('timeout') } },
    desktopAdapter: { execute: async () => { desktopCalls += 1 } },
  })
  const result = await executor.execute({ capability: 'netease.search.song', action: 'search' })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'timeout')
  assert.equal(result.transport, 'api')
  assert.equal(desktopCalls, 0)
})

test('an explicitly desktop-owned capability routes to desktop', async () => {
  const calls = []
  const desktopAdapter = new NeteaseDesktopAdapter({ invoke: async (request) => { calls.push(request); return { ok: true, verified: true } } })
  const executor = new NeteaseCapabilityExecutor({ desktopAdapter })
  const result = await executor.execute({ capability: 'netease.client.open', action: 'open' })
  assert.equal(result.ok, true)
  assert.equal(result.transport, 'desktop')
  assert.equal(calls[0].args.application, 'cloudmusic')
})

test('default desktop adapter uses the narrow semantic bridge', async () => {
  const originalFetch = globalThis.fetch
  let request = null
  globalThis.fetch = async (url, options) => {
    request = { url, body: JSON.parse(options.body) }
    return { ok: true, json: async () => ({ ok: true, verified: true }) }
  }

  try {
    const executor = new NeteaseCapabilityExecutor({ desktopAdapter: new NeteaseDesktopAdapter() })
    const result = await executor.execute({ capability: 'netease.client.open', action: 'open' })
    assert.equal(result.ok, true)
    assert.equal(request.url, '/api/netease/desktop-capability')
    assert.equal(request.body.capability, 'netease.client.open')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('unsupported capability reports unsupported without invoking an adapter', async () => {
  let calls = 0
  const executor = new NeteaseCapabilityExecutor({ desktopAdapter: { execute: async () => { calls += 1 } } })
  const result = await executor.execute({ capability: 'netease.audio.eq', action: 'open' })
  assert.equal(result.ok, false)
  assert.equal(result.unsupported, true)
  assert.equal(calls, 0)
})

test('player capability invokes only the PlayerCore canonical method', async () => {
  const calls = []
  const player = { next: async () => { calls.push('next'); return { ok: true } } }
  const executor = new NeteaseCapabilityExecutor({ playerAdapter: new YunPlayerAdapter(player) })
  const result = await executor.execute({ capability: 'yun.player.transport', action: 'next' })
  assert.equal(result.ok, true)
  assert.deepEqual(calls, ['next'])
})

test('voice ASR 与爱 can select real NetEase candidate 雨爱', async () => {
  const result = await selectNeteaseSongCandidate({
    candidates: [rainLove, otherLove],
    requestedTitle: '与爱',
    transcript: '播放与爱',
    inputMode: 'voice',
    resolveVoiceCandidate: async () => 'rain-love',
  })
  assert.equal(result.status, 'selected')
  assert.equal(result.track, rainLove)
  assert.equal(result.evidence, 'constrained_resolver')
})

test('typed 与爱 does not silently substitute 雨爱', async () => {
  const result = await selectNeteaseSongCandidate({ candidates: [rainLove], requestedTitle: '与爱', inputMode: 'text' })
  assert.equal(result.status, 'not_found')
  assert.equal(result.track, null)
})

test('voice 雨天 prefers exact 雨天 over 下雨天', async () => {
  let resolverCalls = 0
  const result = await selectNeteaseSongCandidate({
    candidates: [underRain, rainyDay],
    requestedTitle: '雨天',
    inputMode: 'voice',
    resolveVoiceCandidate: async () => { resolverCalls += 1; return 'under-rain' },
  })
  assert.equal(result.track, rainyDay)
  assert.equal(result.evidence, 'exact_title')
  assert.equal(resolverCalls, 0)
})

test('ambiguous voice candidates request clarification', async () => {
  const result = await selectNeteaseSongCandidate({
    candidates: [rainLove, otherLove],
    requestedTitle: '语爱',
    inputMode: 'voice',
    resolveVoiceCandidate: async () => '',
  })
  assert.equal(result.status, 'clarify')
  assert.equal(result.candidates.length, 2)
})

test('a resolver cannot invent a provider id outside API candidates', async () => {
  const result = await selectNeteaseSongCandidate({
    candidates: [rainLove, otherLove],
    requestedTitle: '语爱',
    inputMode: 'voice',
    resolveVoiceCandidate: async () => 'invented-id',
  })
  assert.equal(result.status, 'clarify')
  assert.equal(result.track, null)
})

test('lyric lookup plans the lyric capability directly', () => {
  const plan = planNeteaseCapability({ message: '我记得有一句歌词是夜空中最亮的星，帮我找一下' })
  assert.equal(plan.capability, 'netease.search.lyrics')
  assert.equal(plan.action, 'resolve')
})

test('类似这首 plans the similar-song capability', () => {
  const currentTrack = { providerId: 'current' }
  const plan = planNeteaseCapability({ message: '来点和这首类似的', currentTrack })
  assert.equal(plan.capability, 'netease.recommend.similar')
  assert.equal(plan.action, 'play')
  assert.equal(plan.args.currentSong, currentTrack)
  assert.ok(getCapability(plan.capability).actions.includes('play'))
})

test('这首收藏一下 plans the liked capability', () => {
  const currentTrack = { providerId: 'current' }
  const plan = planNeteaseCapability({ message: '这首收藏一下', currentTrack })
  assert.equal(plan.capability, 'netease.library.liked')
  assert.equal(plan.action, 'add')
})

test('声音有点奇怪 does not auto-change an effect', () => {
  const plan = planNeteaseCapability({ message: '声音有点奇怪' })
  assert.equal(plan.kind, 'analysis')
  assert.equal(plan.capability, null)
  assert.equal(plan.automatic, false)
})

test('声音有点怪 also remains analysis-only', () => {
  const plan = planNeteaseCapability({ message: '声音有点怪' })
  assert.equal(plan.detectedIntent, 'analysis.audio_anomaly')
  assert.equal(plan.capability, null)
  assert.equal(plan.automatic, false)
})

test('把8D关掉 plans an explicit audio-effect request', () => {
  const plan = planNeteaseCapability({ message: '把8D环绕关了' })
  assert.equal(plan.capability, 'netease.audio.effect')
  assert.deepEqual(plan.args, { effect: '8d', enabled: false })
})

test('把音质调到无损 remains a desktop default-quality request', () => {
  const plan = planNeteaseCapability({ message: '把音质调到无损' })
  assert.equal(plan.capability, 'netease.desktop.default_quality')
  assert.equal(plan.args.quality, 'lossless')
})

test('打开我的播客 maps to the API podcast list', () => {
  const plan = planNeteaseCapability({ message: '打开我的播客' })
  assert.equal(plan.capability, 'netease.library.podcasts')
  assert.equal(plan.action, 'list')
  assert.equal(getCapability(plan.capability).supportStatus, 'available')
  assert.equal(getCapability(plan.capability).transport, 'api')
})

test('explicit NetEase desktop podcast-page navigation remains unavailable', () => {
  const plan = planNeteaseCapability({ message: '打开网易云客户端里的我的播客页面' })
  assert.equal(plan.capability, 'netease.client.podcast.open')
  assert.equal(getCapability(plan.capability).supportStatus, 'unavailable')
})

test('destructive plan requires confirmation', () => {
  const plan = planNeteaseCapability({ message: '删除歌单《旧歌单》' })
  assert.equal(plan.capability, 'netease.library.playlist_delete')
  assert.equal(plan.requiresConfirmation, true)
  assert.equal(getCapability(plan.capability).risk, 'high')
})

test('executor blocks destructive operation before transport', async () => {
  let apiCalls = 0
  const executor = new NeteaseCapabilityExecutor({ apiAdapter: { execute: async () => { apiCalls += 1 } } })
  const result = await executor.execute({ capability: 'netease.library.playlist_delete', action: 'delete' })
  assert.equal(result.needsConfirmation, true)
  assert.equal(apiCalls, 0)
})

test('unavailable state never fabricates a value', async () => {
  const snapshot = await getNeteaseStateSnapshot({ now: () => new Date('2026-08-24T00:00:00.000Z') })
  assert.deepEqual(snapshot.audio.quality, {
    available: false,
    value: null,
    source: 'desktop',
    updatedAt: '2026-08-24T00:00:00.000Z',
  })
  assert.equal(snapshot.account.loggedIn.available, false)
})

test('state snapshot marks known sources without guessing unknown fields', async () => {
  const snapshot = await getNeteaseStateSnapshot({
    apiAdapter: { getState: async () => ({ account: { loggedIn: true }, library: { playlists: [] } }) },
    playerAdapter: { getState: async () => ({ playback: { currentTrack: rainLove, isPlaying: true, volume: 0.6 } }) },
    desktopAdapter: { getState: async () => ({ audio: { quality: 'lossless' } }) },
    now: () => new Date('2026-08-24T01:02:03.000Z'),
  })
  assert.deepEqual(snapshot.account.loggedIn.value, true)
  assert.equal(snapshot.account.loggedIn.source, 'api')
  assert.equal(snapshot.playback.currentTrack.source, 'player')
  assert.equal(snapshot.audio.quality.source, 'desktop')
  assert.equal(snapshot.audio.outputDevice.available, false)
})

test('executor failure cannot be formatted as success', () => {
  const reply = formatCapabilityExecutionReply({ ok: false, error: 'timeout' }, { success: '已经成功', failure: '没有完成' })
  assert.equal(reply, '没有完成')
  assert.doesNotMatch(reply, /成功/)
})

test('API adapter delegates song search to its injected operation', async () => {
  const calls = []
  const adapter = new NeteaseApiAdapter({ searchSongs: async (...args) => { calls.push(args); return [rainLove] } })
  const result = await adapter.execute('netease.search.song', 'search', { query: '雨爱', limit: 5 })
  assert.deepEqual(result, [rainLove])
  assert.deepEqual(calls, [['雨爱', { limit: 5 }]])
})

test('P0 API intent catalog prioritizes real recommendation and personal-library sources', () => {
  const cases = [
    ['今天网易云给我推荐什么', 'netease.recommend.daily', 'list'],
    ['打开每日推荐', 'netease.recommend.daily', 'list'],
    ['放私人FM', 'netease.recommend.personal_fm', 'play'],
    ['推荐几个歌单', 'netease.recommend.playlist', 'list'],
    ['最近歌曲', 'netease.library.recent', 'list'],
    ['看看我最近听了什么', 'netease.library.recent', 'list'],
    ['看看我最近常听什么', 'netease.library.user_record', 'list'],
    ['最近最常听什么', 'netease.library.user_record', 'list'],
    ['看看我的播客', 'netease.library.podcasts', 'list'],
    ['播放我的播客', 'netease.library.podcasts', 'play'],
    ['看看我的云盘', 'netease.library.cloud', 'list'],
  ]
  for (const [message, capability, action] of cases) {
    const plan = planNeteaseCapability({ message })
    assert.equal(plan?.capability, capability, message)
    assert.equal(plan?.action, action, message)
  }
})

test('recent playback and listening-rank language remain distinct', () => {
  assert.deepEqual(planNeteaseCapability({ message: '最近歌曲' }).args, { type: 'song' })
  assert.deepEqual(planNeteaseCapability({ message: '看看我最近常听什么' }).args, { type: 'week' })
  assert.deepEqual(planNeteaseCapability({ message: '我历史上听最多的歌' }).args, { type: 'all' })
  assert.equal(planNeteaseCapability({ message: '最近有什么新歌' }), null)
})

test('这首用无损播放 resolves an API stream while generic quality remains desktop-owned', () => {
  const currentTrack = { providerId: '123', title: '当前歌曲' }
  const plan = planNeteaseCapability({ message: '这首用无损播放', currentTrack })
  assert.equal(plan.capability, 'yun.player.stream_quality')
  assert.equal(plan.action, 'resolve')
  assert.equal(plan.args.level, 'lossless')
  assert.equal(plan.args.song, currentTrack)
  assert.equal(getCapability(plan.capability).transport, 'api')
})

test('这首用hires resolves current-track stream while standard 品质 remains a desktop setting', () => {
  const currentTrack = { providerId: '123', title: '当前歌曲' }
  const streamPlan = planNeteaseCapability({ message: '这首用hires', currentTrack })
  const desktopPlan = planNeteaseCapability({ message: '换回标准品质', currentTrack })
  assert.equal(streamPlan.capability, 'yun.player.stream_quality')
  assert.equal(streamPlan.args.level, 'hires')
  assert.equal(desktopPlan.capability, 'netease.desktop.default_quality')
  assert.equal(desktopPlan.args.quality, 'standard')
})

test('every P0 read capability delegates to its API adapter contract', async (t) => {
  const cases = [
    { capability: 'netease.recommend.daily', action: 'list', operation: 'fetchDailySongs', args: {}, expected: ['daily'] },
    { capability: 'netease.recommend.playlist', action: 'list', operation: 'fetchRecommendedPlaylists', args: {}, expected: ['playlist'] },
    { capability: 'netease.recommend.personal_fm', action: 'list', operation: 'fetchPersonalFm', args: {}, expected: ['fm'] },
    { capability: 'netease.library.recent', action: 'list', operation: 'fetchRecentHistory', args: { type: 'song', limit: 5 }, expected: { songs: ['recent'] } },
    { capability: 'netease.library.user_record', action: 'list', operation: 'fetchUserRecord', args: { type: 'week', limit: 5 }, expected: { songs: ['record'] } },
    { capability: 'netease.library.podcasts', action: 'list', operation: 'fetchPodcasts', args: { source: 'subscribed', limit: 5 }, expected: { podcasts: ['podcast'] } },
    { capability: 'netease.library.cloud', action: 'list', operation: 'fetchCloud', args: { limit: 5 }, expected: { songs: ['cloud'] } },
    { capability: 'netease.search.suggest', action: 'suggest', operation: 'fetchSearchSuggestions', args: { query: '雨爱' }, expected: { songs: ['suggestion'] } },
    { capability: 'netease.song.detail', action: 'get', operation: 'fetchSongDetails', args: { songId: '123' }, expected: ['detail'] },
    { capability: 'netease.song.playability', action: 'check', operation: 'checkSongPlayable', args: { songId: '123' }, expected: { playable: true } },
    { capability: 'yun.player.stream_quality', action: 'resolve', operation: 'resolveStreamQuality', args: { song: rainLove, level: 'lossless' }, expected: { ...rainLove, streamLevel: 'lossless' } },
    { capability: 'netease.library.liked', action: 'status', operation: 'fetchLikedStatus', args: { songId: '123' }, expected: { statuses: [{ providerId: '123', liked: true }] } },
    { capability: 'netease.library.subscription_counts', action: 'get', operation: 'fetchSubscriptionCounts', args: {}, expected: { playlists: 9 } },
    { capability: 'netease.library.subscribed_albums', action: 'list', operation: 'fetchSubscribedAlbums', args: { limit: 5 }, expected: { albums: [] } },
    { capability: 'netease.library.subscribed_artists', action: 'list', operation: 'fetchSubscribedArtists', args: { limit: 5 }, expected: { artists: [] } },
    { capability: 'netease.account.membership', action: 'get', operation: 'fetchMembership', args: {}, expected: { redVipLevel: 7 } },
    { capability: 'netease.library.playlists', action: 'detail', operation: 'fetchPlaylistDetail', args: { playlistId: '91' }, expected: { playlist: { id: '91' } } },
  ]

  for (const item of cases) {
    await t.test(`${item.capability}:${item.action}`, async () => {
      const calls = []
      const adapter = new NeteaseApiAdapter({
        [item.operation]: async (...args) => { calls.push(args); return item.expected },
      })
      const result = await adapter.execute(item.capability, item.action, item.args)
      assert.deepEqual(result, item.expected)
      assert.equal(calls.length, 1)
    })
  }
})

test('podcast and cloud playback resolve API tracks without invoking PlayerCore or Desktop', async () => {
  let desktopCalls = 0
  let playerCalls = 0
  const track = { providerId: '123', title: '节目音频' }
  const adapter = new NeteaseApiAdapter({
    fetchPodcasts: async () => ({ podcasts: [{ id: '21', name: '订阅播客' }] }),
    fetchPodcastPrograms: async () => ({ programs: [{ song: track }] }),
    checkSongPlayable: async () => ({ playable: true }),
  })
  const executor = new NeteaseCapabilityExecutor({
    apiAdapter: adapter,
    desktopAdapter: { execute: async () => { desktopCalls += 1 } },
    playerAdapter: { execute: async () => { playerCalls += 1 } },
  })
  const result = await executor.execute({ capability: 'netease.library.podcasts', action: 'play', args: {} })
  assert.equal(result.ok, true)
  assert.equal(result.value, track)
  assert.equal(desktopCalls, 0)
  assert.equal(playerCalls, 0)
})

test('typed API errors keep unified semantics and never fall back to desktop', async () => {
  let desktopCalls = 0
  const error = new Error('请先登录网易云')
  error.code = 'not_logged_in'
  const executor = new NeteaseCapabilityExecutor({
    apiAdapter: { execute: async () => { throw error } },
    desktopAdapter: { execute: async () => { desktopCalls += 1 } },
  })
  const result = await executor.execute({ capability: 'netease.recommend.daily', action: 'list' })
  assert.equal(result.errorCode, 'not_logged_in')
  assert.equal(result.transport, 'api')
  assert.equal(desktopCalls, 0)
})

test('snapshot exposes counts and recommendation availability without large lists', async () => {
  const snapshot = await getNeteaseStateSnapshot({
    apiAdapter: {
      getState: async () => ({
        account: { loggedIn: true, membership: { redVipLevel: 7 } },
        library: { playlistsCount: 9, recentCount: 10, cloudCount: 11, podcastCount: 12, likedCount: 13 },
        recommendation: { dailySongs: true, dailyPlaylists: true, personalFm: true },
      }),
    },
    now: () => new Date('2026-08-24T02:00:00.000Z'),
  })
  assert.equal(snapshot.library.recentCount.value, 10)
  assert.equal(snapshot.library.cloudCount.value, 11)
  assert.equal(snapshot.library.podcastCount.value, 12)
  assert.equal(snapshot.recommendation.personalFmAvailable.value, true)
  assert.equal(snapshot.library.recentCount.source, 'api')
})
