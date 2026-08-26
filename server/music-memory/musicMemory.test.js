import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createMusicMemoryRepository } from './repository.js'
import { createMusicMemoryService } from './service.js'

async function makeService() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'yun-music-memory-'))
  return { dataDir, repository: createMusicMemoryRepository({ dataDir }), service: null }
}

test('persists high-precision listening events independently from observations', async () => {
  const context = await makeService()
  context.service = createMusicMemoryService({ repository: context.repository })
  try {
    const result = await context.service.persistListeningEvent({
      id: 'event-1', type: 'play', trackId: 'netease-42', providerId: '42', source: 'netease',
      title: 'Test Song', artist: 'Test Artist', durationMs: 210000, positionMs: 0,
      sessionId: 'session-1', device: 'desktop', timestamp: '2026-08-27T00:00:00.000Z',
    })
    assert.equal(result.written, true)
    assert.equal((await context.repository.listListeningEvents())[0].kind, 'listening_event')
    assert.deepEqual(await context.repository.listMusicObservations(), [])
  } finally { await rm(context.dataDir, { recursive: true, force: true }) }
})

test('persists incomplete NetEase history as an observation, not a listening event', async () => {
  const context = await makeService()
  context.service = createMusicMemoryService({ repository: context.repository })
  try {
    const result = await context.service.persistMusicObservation({
      id: 'observation-1', source: 'netease_history_sync', trackId: '42', providerId: '42',
      title: 'Test Song', playCount: 15, playCountDelta: 3, confidence: 'medium',
      observedAt: '2026-08-27T00:00:00.000Z',
    })
    assert.equal(result.written, true)
    assert.equal((await context.repository.listMusicObservations())[0].kind, 'music_observation')
    assert.deepEqual(await context.repository.listListeningEvents(), [])
  } finally { await rm(context.dataDir, { recursive: true, force: true }) }
})

test('deduplicates ids and rejects incomplete records', async () => {
  const context = await makeService()
  context.service = createMusicMemoryService({ repository: context.repository })
  try {
    const input = { id: 'event-1', type: 'play', trackId: 'song-1', timestamp: '2026-08-27T00:00:00.000Z' }
    assert.equal((await context.service.persistListeningEvent(input)).written, true)
    assert.equal((await context.service.persistListeningEvent(input)).duplicate, true)
    assert.equal((await context.service.persistListeningEvent({ id: 'broken', type: 'play' })).invalid, true)
    assert.equal((await context.service.persistMusicObservation({ id: 'broken', source: 'netease_history_sync' })).invalid, true)
  } finally { await rm(context.dataDir, { recursive: true, force: true }) }
})

test('does not serialize credentials from metadata', async () => {
  const context = await makeService()
  context.service = createMusicMemoryService({ repository: context.repository })
  try {
    await context.service.persistListeningEvent({
      id: 'event-safe', type: 'play', trackId: 'song-1', timestamp: '2026-08-27T00:00:00.000Z',
      metadata: { queuePosition: 2, cookie: 'MUSIC_U=private', apiToken: 'secret-token' },
    })
    const raw = await readFile(context.repository.paths.listeningEvents, 'utf8')
    assert.match(raw, /queuePosition/)
    assert.doesNotMatch(raw, /MUSIC_U|secret-token|apiToken/)
  } finally { await rm(context.dataDir, { recursive: true, force: true }) }
})
