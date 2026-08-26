import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createMusicMemoryRepository } from './repository.js'
import { normalizeListeningEvent, normalizeMusicObservation } from './schema.js'
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
      id: 'observation-1', provenance: 'netease_history_sync',
      track: { id: '42', providerId: '42', source: 'netease', title: 'Test Song' },
      playCount: 15, playCountDelta: 3, confidence: 'medium',
      observedAt: '2026-08-27T00:00:00.000Z',
    })
    assert.equal(result.written, true)
    const [observation] = await context.repository.listMusicObservations()
    assert.equal(observation.kind, 'music_observation')
    assert.equal(observation.source, 'netease')
    assert.equal(observation.provenance, 'netease_history_sync')
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
    assert.equal((await context.service.persistMusicObservation({ id: 'broken', provenance: 'netease_history_sync' })).invalid, true)
  } finally { await rm(context.dataDir, { recursive: true, force: true }) }
})

test('serializes concurrent duplicate writes for the same log', async () => {
  const context = await makeService()
  context.service = createMusicMemoryService({ repository: context.repository })
  try {
    const input = { id: 'event-race', type: 'play', trackId: 'song-1', timestamp: '2026-08-27T00:00:00.000Z' }
    const results = await Promise.all(Array.from({ length: 12 }, () => context.service.persistListeningEvent(input)))
    assert.equal(results.filter((result) => result.written).length, 1)
    assert.equal(results.filter((result) => result.duplicate).length, 11)
    assert.equal((await context.repository.listListeningEvents()).filter((event) => event.id === input.id).length, 1)
  } finally { await rm(context.dataDir, { recursive: true, force: true }) }
})

test('reports malformed JSONL and only treats a missing log as empty', async () => {
  const context = await makeService()
  try {
    assert.deepEqual(await context.repository.listListeningEvents(), [])
    await mkdir(path.dirname(context.repository.paths.listeningEvents), { recursive: true })
    await writeFile(context.repository.paths.listeningEvents, '{not-json}\n', 'utf8')
    await assert.rejects(context.repository.listListeningEvents(), { code: 'music_memory_corruption' })
  } finally { await rm(context.dataDir, { recursive: true, force: true }) }
})

test('does not normalize empty timestamps or numbers into epoch or zero', () => {
  assert.equal(normalizeListeningEvent({ id: 'missing-time', type: 'play', trackId: 'song-1', timestamp: null }), null)
  const event = normalizeListeningEvent({ id: 'event-null', type: 'play', trackId: 'song-1', timestamp: '2026-08-27T00:00:00.000Z', positionMs: null, durationMs: '' })
  assert.equal(event.positionMs, null)
  assert.equal(event.durationMs, null)
  assert.equal(normalizeMusicObservation({ id: 'missing-time', provenance: 'netease_history_sync', track: { id: 'song-1', source: 'netease' }, observedAt: undefined }), null)
  const observation = normalizeMusicObservation({
    id: 'observation-null', provenance: 'netease_history_sync', track: { id: 'song-1', source: 'netease' },
    observedAt: '2026-08-27T00:00:00.000Z', playCount: null, playCountDelta: '', firstObservedAt: null, lastObservedAt: '',
  })
  assert.equal(observation.playCount, null)
  assert.equal(observation.playCountDelta, null)
  assert.equal(observation.firstObservedAt, null)
  assert.equal(observation.lastObservedAt, null)
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
