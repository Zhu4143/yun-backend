import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlaybackPlan, executePlaybackPlan } from './radioEngine.js'

const lettingGo = { id: 'letting-go', title: 'Letting Go', artist: '蔡健雅', source: 'netease' }
const redHeels = { id: 'red-heels', title: '红色高跟鞋', artist: '蔡健雅', source: 'netease' }
const sunnyDay = { id: 'sunny-day', title: '晴天', artist: '周杰伦', source: 'netease' }
const rainyDay = { id: 'rainy-day', title: '雨天', artist: '孙燕姿', source: 'netease' }
const underRain = { id: 'under-rain', title: '下雨天', artist: '与少年他', source: 'netease' }
const rainLove = { id: 'rain-love', title: '雨爱', artist: '杨丞琳', source: 'netease' }

function installNeteaseMock(songs, resolvedId = lettingGo.id) {
  const requests = []
  globalThis.fetch = async (url) => {
    requests.push(String(url))
    if (String(url).startsWith('/api/netease/search')) {
      return { ok: true, json: async () => ({ ok: true, songs }) }
    }
    if (String(url) === '/api/netease/resolve-voice-song') {
      return { ok: true, json: async () => ({ ok: true, providerId: resolvedId, confidence: 1 }) }
    }
    throw new Error(`unexpected request: ${url}`)
  }
  return requests
}

test('an explicit foreign title outranks other songs by the same artist', async () => {
  const requests = installNeteaseMock([redHeels, lettingGo])
  const plan = await createPlaybackPlan({
    message: '给我播放蔡健雅的letting go。',
    smartResult: { should_execute: true, command: { type: 'play_search', query: '蔡健雅', artist: '蔡健雅' } },
  })

  assert.equal(plan.action, 'play')
  assert.equal(plan.track.providerId, lettingGo.id)
  assert.equal(plan.reply, '嗯，给你放《Letting Go》。')
  assert.match(requests[0], /letting%20go.*%E8%94%A1%E5%81%A5%E9%9B%85/i)
})

test('an explicit title never falls back to a different song by the artist', async () => {
  installNeteaseMock([redHeels])
  const plan = await createPlaybackPlan({
    message: '给我播放蔡健雅的letting go。',
    smartResult: { should_execute: true, command: { type: 'play_search', query: '蔡健雅', artist: '蔡健雅' } },
  })

  assert.equal(plan.action, 'none')
  assert.match(plan.reply, /可靠确认/)
})

test('an explicit Chinese artist-and-title request preserves both constraints', async () => {
  const requests = installNeteaseMock([redHeels, sunnyDay], sunnyDay.id)
  const plan = await createPlaybackPlan({
    message: '播放周杰伦的晴天。',
    smartResult: { should_execute: true, command: { type: 'play_search', query: '周杰伦的晴天' } },
  })

  assert.equal(plan.action, 'play')
  assert.equal(plan.track.providerId, sunnyDay.id)
  assert.match(requests[0], /%E5%91%A8%E6%9D%B0%E4%BC%A6.*%E6%99%B4%E5%A4%A9/i)
})

test('a short exact title does not get replaced by a longer local lookalike', async () => {
  installNeteaseMock([underRain, rainyDay], rainyDay.id)
  const plan = await createPlaybackPlan({
    message: '播放雨天。',
    libraryTracks: [underRain],
    smartResult: {
      should_execute: true,
      command: { type: 'play_search', query: '下雨天' },
      matches: [{ song: underRain }],
    },
  })

  assert.equal(plan.action, 'play')
  assert.equal(plan.source, 'netease')
  assert.equal(plan.track.providerId, rainyDay.id)
  assert.equal(plan.reply, '嗯，给你放《雨天》。')
})

test('voice mode keeps fuzzy NetEase candidates until constrained resolution', async () => {
  const requests = installNeteaseMock([rainLove, redHeels], rainLove.id)
  const plan = await createPlaybackPlan({
    message: '播放与爱',
    inputMode: 'voice',
    smartResult: { should_execute: true, command: { type: 'play_search', query: '与爱' } },
  })

  assert.equal(plan.action, 'play')
  assert.equal(plan.track.providerId, rainLove.id)
  assert.ok(requests.includes('/api/netease/resolve-voice-song'))
})

test('text mode keeps exact identity and never resolves 与爱 to 雨爱', async () => {
  const requests = installNeteaseMock([rainLove], rainLove.id)
  const plan = await createPlaybackPlan({
    message: '播放《与爱》',
    inputMode: 'text',
    smartResult: { should_execute: true, command: { type: 'play_search', query: '与爱' } },
  })

  assert.equal(plan.action, 'none')
  assert.equal(requests.includes('/api/netease/resolve-voice-song'), false)
})

test('voice ambiguity becomes a clarification instead of random playback', async () => {
  installNeteaseMock([rainLove, redHeels], '')
  const plan = await createPlaybackPlan({
    message: '播放语爱',
    inputMode: 'voice',
    smartResult: { should_execute: true, command: { type: 'play_search', query: '语爱' } },
  })

  assert.equal(plan.action, 'none')
  assert.equal(plan.needsClarification, true)
  assert.match(plan.reply, /你想听的是/)
})

test('online search failure preserves the executor error code', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new TypeError('fetch failed') }
  try {
    await assert.rejects(
      () => createPlaybackPlan({
        message: '播放雨爱',
        smartResult: { should_execute: true, command: { type: 'play_search', query: '雨爱' } },
      }),
      (error) => error.code === 'network_error',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('playback execution uses the canonical PlayerCore queue contract', async () => {
  const calls = []
  const player = {
    getState: () => ({ currentTrack: lettingGo }),
    playTrackFromQueue: async (...args) => { calls.push(args); return { ok: true } },
  }

  const result = await executePlaybackPlan({
    action: 'play',
    source: 'netease',
    track: rainyDay,
    candidates: [rainyDay, sunnyDay],
  }, player)

  assert.equal(result.ok, true)
  assert.deepEqual(calls, [[rainyDay, [rainyDay, sunnyDay], { crossfade: true }]])
})
