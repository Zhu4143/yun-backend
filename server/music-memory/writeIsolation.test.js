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
