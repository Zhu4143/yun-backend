import test from 'node:test'
import assert from 'node:assert/strict'
import { routeChatIntent } from './chatIntentRouter.js'
import { formatYunChatErrorReply } from './yunChatReply.js'

function idlePlayer() {
  return {
    getState: () => ({ currentTrack: null }),
  }
}

test('打开我的播客 reads the API and is not confused with Yun podcast response mode', async () => {
  const originalFetch = globalThis.fetch
  let responseModeChanges = 0
  let requestedUrl = ''
  globalThis.fetch = async (url) => {
    requestedUrl = String(url)
    return { ok: true, json: async () => ({ ok: true, podcasts: [{ id: '21', name: '订阅播客' }], total: 1 }) }
  }

  try {
    const result = await routeChatIntent({
      message: '打开我的播客',
      player: idlePlayer(),
      setResponseMode: () => { responseModeChanges += 1 },
    })

    assert.equal(result.handled, true)
    assert.equal(result.capabilityPlan.capability, 'netease.library.podcasts')
    assert.equal(result.capabilityResult.ok, true)
    assert.equal(responseModeChanges, 0)
    assert.match(requestedUrl, /\/api\/netease\/podcasts/)
    assert.match(result.reply, /订阅播客/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('explicit 8D request reports unsupported and does not claim success', async () => {
  const result = await routeChatIntent({ message: '把8D环绕关了', player: idlePlayer() })

  assert.equal(result.handled, true)
  assert.equal(result.capabilityPlan.capability, 'netease.audio.effect')
  assert.equal(result.capabilityResult.unsupported, true)
  assert.match(result.reply, /没有可验证的控制通道/)
  assert.doesNotMatch(result.reply, /已经.*完成/)
})

test('daily recommendation candidates are fetched by API and played only through PlayerCore', async () => {
  const originalFetch = globalThis.fetch
  const playerCalls = []
  const player = {
    getState: () => ({ currentTrack: null }),
    playTrackFromQueue: async (track, queue) => { playerCalls.push({ track, queue }); return { ok: true } },
  }
  globalThis.fetch = async (url) => {
    assert.equal(url, '/api/netease/recommend/daily-songs')
    return {
      ok: true,
      json: async () => ({
        ok: true,
        songs: [
          { id: '1', title: '真实推荐一', artist: '歌手一' },
          { id: '2', title: '真实推荐二', artist: '歌手二' },
          { id: '3', title: '真实推荐三', artist: '歌手三' },
        ],
      }),
    }
  }

  try {
    const result = await routeChatIntent({ message: '给我推荐一首', player, playHistory: [{ providerId: '1' }] })
    assert.equal(result.handled, true)
    assert.equal(result.capabilityPlan.capability, 'netease.recommend.daily')
    assert.equal(playerCalls.length, 1)
    assert.equal(playerCalls[0].track.providerId, '2')
    assert.deepEqual(playerCalls[0].queue.map((song) => song.providerId), ['2', '3'])
    assert.equal(result.song.providerId, '2')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('current-song lossless command resolves API URL then calls PlayerCore once', async () => {
  const originalFetch = globalThis.fetch
  const playerCalls = []
  const currentTrack = { id: 'netease-123', providerId: '123', source: 'netease', title: '当前歌曲', artist: '歌手', fileUrl: '/api/netease/audio?id=123' }
  const player = {
    getState: () => ({ currentTrack }),
    playTrack: async (track) => { playerCalls.push(track); return { ok: true } },
  }
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/api\/netease\/song\/stream\?id=123&level=lossless/)
    return { ok: true, json: async () => ({ ok: true, providerId: '123', requestedLevel: 'lossless', level: 'lossless', fileUrl: '/api/netease/audio?id=123&level=lossless' }) }
  }

  try {
    const result = await routeChatIntent({ message: '这首用无损播放', currentSong: currentTrack, player })
    assert.equal(result.handled, true)
    assert.equal(result.capabilityPlan.capability, 'yun.player.stream_quality')
    assert.equal(playerCalls.length, 1)
    assert.equal(playerCalls[0].fileUrl, '/api/netease/audio?id=123&level=lossless')
    assert.equal(playerCalls[0].streamLevel, 'lossless')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('最近歌曲 executes recent history and trace cannot claim the capability is missing', async () => {
  const originalFetch = globalThis.fetch
  const trace = {}
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/api\/netease\/history\/recent/)
    return { ok: true, json: async () => ({ ok: true, songs: [{ id: '9', title: '最近听过', artist: '歌手' }], items: [], total: 1 }) }
  }
  try {
    const result = await routeChatIntent({ message: '最近歌曲', player: idlePlayer(), debugTrace: trace })
    assert.equal(result.capabilityResult.ok, true)
    assert.equal(trace.plannedCapability, 'netease.library.recent')
    assert.equal(trace.executorResult.ok, true)
    assert.match(trace.finalReply, /最近播放/)
    assert.doesNotMatch(trace.finalReply, /没有.*(?:功能|能力)|不支持|无法读取历史/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('相似歌曲 executes API then PlayerCore before producing its success reply', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  const currentTrack = { id: 'netease-1', providerId: '1', source: 'netease', title: '当前歌曲', artist: '歌手' }
  const player = {
    getState: () => ({ currentTrack }),
    setPlaybackMode: (mode) => calls.push(['setPlaybackMode', mode]),
    playTrackFromQueue: async (track, queue) => { calls.push(['playTrackFromQueue', track.providerId, queue.length]); return { ok: true } },
    setAutoUpNext: (tracks) => calls.push(['setAutoUpNext', tracks.length]),
    setQueuedNextTrack: (track) => calls.push(['setQueuedNextTrack', track]),
  }
  globalThis.fetch = async (url) => {
    assert.equal(url, '/api/netease/recommendations')
    return { ok: true, json: async () => ({ ok: true, songs: [{ id: '2', title: '相似一', artist: '歌手二' }, { id: '3', title: '相似二', artist: '歌手三' }] }) }
  }
  try {
    const trace = {}
    const result = await routeChatIntent({ message: '来点和这首相似的', currentSong: currentTrack, player, debugTrace: trace })
    assert.equal(result.capabilityPlan.capability, 'netease.recommend.similar')
    assert.equal(result.capabilityPlan.action, 'play')
    assert.deepEqual(calls.map(([name]) => name), ['setPlaybackMode', 'playTrackFromQueue', 'setAutoUpNext', 'setQueuedNextTrack'])
    assert.equal(result.playbackResult.ok, true)
    assert.match(result.reply, /先接上《相似一》/)
    assert.doesNotMatch(result.reply, /准备好执行/)
    assert.equal(trace.executorResult.ok, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('personal FM provider_error is not mislabeled as network_error', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 502, json: async () => ({ ok: false, code: 'provider_error', error: 'provider failed', details: { method: 'personal_fm', providerCode: 500 } }) })
  try {
    const result = await routeChatIntent({ message: '私人FM连续播放', player: idlePlayer() })
    assert.equal(result.capabilityResult.errorCode, 'provider_error')
    assert.deepEqual(result.capabilityResult.errorDetails, { method: 'personal_fm', providerCode: 500 })
    assert.match(result.reply, /没把私人 FM 列表返回/)
    assert.doesNotMatch(result.reply, /连接.*失败|网络/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('similar-song trace reflects PlayerCore failure instead of API fetch success', async () => {
  const originalFetch = globalThis.fetch
  const currentTrack = { id: 'netease-1', providerId: '1', source: 'netease', title: '当前歌曲', artist: '歌手' }
  const player = {
    getState: () => ({ currentTrack }),
    setPlaybackMode: () => {},
    playTrack: async () => ({ ok: false, error: 'play_failed' }),
  }
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, songs: [{ id: '2', title: '相似一', artist: '歌手二' }] }) })
  try {
    const trace = {}
    const result = await routeChatIntent({ message: '来点和这首相似的', currentSong: currentTrack, player, debugTrace: trace })
    assert.equal(result.capabilityResult.ok, true)
    assert.equal(result.playbackResult.ok, false)
    assert.equal(trace.capabilityExecutorResult.ok, true)
    assert.equal(trace.executorResult.ok, false)
    assert.match(result.reply, /没有开始播放/)
    assert.doesNotMatch(result.reply, /先接上《/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('similar-song network failure keeps network_error through executor and reply', async () => {
  const originalFetch = globalThis.fetch
  const currentTrack = { id: 'netease-1', providerId: '1', source: 'netease', title: '当前歌曲', artist: '歌手' }
  globalThis.fetch = async () => { throw new TypeError('fetch failed') }
  try {
    const trace = {}
    const result = await routeChatIntent({ message: '来点和这首相似的', currentSong: currentTrack, player: idlePlayer(), debugTrace: trace })
    assert.equal(result.capabilityResult.errorCode, 'network_error')
    assert.equal(trace.executorResult.errorCode, 'network_error')
    assert.match(result.reply, /连接暂时不可用/)
    assert.doesNotMatch(result.reply, /暂时无法完成相似歌曲|fetch failed/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('lyric network failure returns typed trace and never leaks raw fetch error', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new TypeError('fetch failed') }
  try {
    const trace = {}
    const result = await routeChatIntent({ message: '有首歌歌词是夜空中最亮的星，帮我找', player: idlePlayer(), debugTrace: trace })
    assert.equal(result.capabilityResult.errorCode, 'network_error')
    assert.equal(trace.executorResult.errorCode, 'network_error')
    assert.match(result.reply, /连接暂时不可用/)
    assert.doesNotMatch(result.reply, /fetch failed/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('named-song search network failure returns typed trace and a user-safe reply', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new TypeError('fetch failed') }
  try {
    const trace = {}
    const result = await routeChatIntent({ message: '播放杨丞琳的雨爱', player: idlePlayer(), debugTrace: trace })
    assert.equal(result.capabilityResult.errorCode, 'network_error')
    assert.equal(trace.executorResult.errorCode, 'network_error')
    assert.match(result.reply, /连接暂时不可用/)
    assert.doesNotMatch(result.reply, /fetch failed/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('top-level chat error formatting never exposes raw fetch failures', () => {
  const error = new Error('fetch failed')
  error.code = 'network_error'
  const reply = formatYunChatErrorReply(error)
  assert.match(reply, /没能连接上服务/)
  assert.doesNotMatch(reply, /fetch failed/)
})
