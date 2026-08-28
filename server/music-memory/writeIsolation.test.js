import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyOrdinaryCompanionMemoryWrites,
  explicitMusicPreferenceStatement,
  prepareCompanionMemoryWrites,
} from './writeIsolation.js'

test('ordinary companion inference query filters music_taste and blocks background promotion', () => {
  const writes = prepareCompanionMemoryWrites([
    { category: 'music_taste', content: '用户明确喜欢 A' },
    { category: 'session_memory', content: '用户正在询问最近听歌偏好' },
  ], { musicMemoryAvailable: true, userText: '我最近喜欢听什么？' })
  assert.deepEqual(writes.updates, [{ category: 'session_memory', content: '用户正在询问最近听歌偏好' }])
  assert.equal(writes.explicitMusicPreference, false)
  assert.equal(writes.allowBackgroundUpdate, false)
})

test('explicit companion music preference keeps music_taste and background memory capability', () => {
  assert.equal(explicitMusicPreferenceStatement('我喜欢 A，记住。'), true)
  const updates = [{ category: 'music_taste', content: '用户喜欢 A' }]
  const writes = prepareCompanionMemoryWrites(updates, { musicMemoryAvailable: true, userText: '我喜欢 A，记住。' })
  assert.equal(writes.updates, updates)
  assert.equal(writes.allowBackgroundUpdate, true)
})

test('ordinary companion main path applies isolation before production memory writes', async () => {
  const received = []
  const writes = await applyOrdinaryCompanionMemoryWrites([
    { category: 'music_taste', content: '用户明确喜欢 A' },
    { category: 'session_memory', content: '用户询问最近的音乐偏好' },
  ], { musicMemoryAvailable: true, userText: '我最近喜欢听什么？' }, async (updates) => {
    received.push(updates)
    return updates.map((update) => ({ ...update, stored: true }))
  })

  assert.deepEqual(received, [[{ category: 'session_memory', content: '用户询问最近的音乐偏好' }]])
  assert.deepEqual(writes.appliedUpdates, [{ category: 'session_memory', content: '用户询问最近的音乐偏好', stored: true }])
  assert.equal(writes.allowBackgroundUpdate, false)
})

async function applyConversationBoundary(userText, updates) {
  const received = []
  const writes = await applyOrdinaryCompanionMemoryWrites(updates, { musicMemoryAvailable: true, userText }, async (isolatedUpdates) => {
    received.push(...isolatedUpdates)
    return isolatedUpdates
  })
  return { received, writes }
}

test('weak companion song feedback does not promote long term music taste', async () => {
  const musicTaste = { category: 'music_taste', content: '用户长期喜欢当前歌曲' }
  const sessionFeedback = { category: 'session_memory', content: '用户觉得当前歌曲挺好听' }
  const { received, writes } = await applyConversationBoundary('这首挺好听的', [musicTaste, sessionFeedback])

  assert.deepEqual(received, [sessionFeedback])
  assert.equal(writes.explicitMusicPreference, false)
  assert.equal(writes.allowBackgroundUpdate, false)
})

test('explicit piano female vocal preference keeps music taste writes', async () => {
  const musicTaste = { category: 'music_taste', content: '用户喜欢钢琴加女声的歌曲' }
  const { received, writes } = await applyConversationBoundary('我喜欢这种钢琴加女声的歌', [musicTaste])

  assert.deepEqual(received, [musicTaste])
  assert.equal(writes.explicitMusicPreference, true)
  assert.equal(writes.allowBackgroundUpdate, true)
})

test('temporary quiet mood request stays session scoped', async () => {
  const musicTaste = { category: 'music_taste', content: '用户长期喜欢安静音乐' }
  const sessionNeed = { category: 'session_memory', content: '用户今天想听安静的音乐' }
  const { received, writes } = await applyConversationBoundary('今天想听点安静的', [musicTaste, sessionNeed])

  assert.deepEqual(received, [sessionNeed])
  assert.equal(writes.explicitMusicPreference, false)
  assert.equal(writes.allowBackgroundUpdate, false)
})

test('future bedtime listening habit can promote stable preference', async () => {
  const musicTaste = { category: 'music_taste', content: '用户以后睡前想听这种音乐' }
  const { received, writes } = await applyConversationBoundary('以后我睡前都想听这种', [musicTaste])

  assert.deepEqual(received, [musicTaste])
  assert.equal(writes.explicitMusicPreference, true)
  assert.equal(writes.allowBackgroundUpdate, true)
})

test('explicit noisy music dislike writes negative music taste', async () => {
  const negativeMusicTaste = { category: 'music_taste', content: '避免推荐这种吵的歌', preference: 'negative' }
  const { received, writes } = await applyConversationBoundary('别再给我推这种吵的歌', [negativeMusicTaste])

  assert.deepEqual(received, [negativeMusicTaste])
  assert.equal(writes.explicitMusicPreference, true)
  assert.equal(writes.allowBackgroundUpdate, true)
})
