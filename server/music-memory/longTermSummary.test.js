import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildMusicLongTermSummary,
  mergeExplicitAndInferredMusicPreferences,
  MUSIC_LONG_TERM_SUMMARY_VERSION,
} from './longTermSummary.js'
import { MUSIC_PREFERENCE_SNAPSHOT_VERSION } from './preferenceAggregator.js'
import { createMusicMemoryRepository } from './repository.js'
import { createMusicMemoryService } from './service.js'

const AS_OF = '2026-08-28T00:00:00.000Z'

function preferenceTrack(id, options = {}) {
  const playCount = options.playCount ?? 0
  const completeCount = options.completeCount ?? 0
  const repeatCount = options.repeatCount ?? 0
  const skipCount = options.skipCount ?? 0
  const skipRate = playCount ? skipCount / playCount : null
  const directScore = playCount + completeCount * 1.8 + repeatCount * 1.6 - skipCount * 2.4
  const providerReportedCount = options.providerReportedCount ?? null
  const observedCount = options.observedCount ?? 0
  return {
    trackId: id,
    providerId: options.providerId || id,
    title: options.title || `Track ${id}`,
    artist: options.artist || 'Artist',
    directListening: {
      playCount, completeCount, repeatCount, skipCount,
      lastDirectPlayedAt: options.lastDirectPlayedAt || AS_OF,
    },
    providerObservation: {
      observedCount,
      providerReportedCount,
      lastObservedAt: options.lastObservedAt || (observedCount ? AS_OF : null),
      lastProviderPlayedAt: options.lastProviderPlayedAt || null,
      provenance: observedCount || providerReportedCount !== null ? ['netease_history_sync'] : [],
    },
    derived: {
      skipRate,
      recentAffinity: options.recentAffinity ?? directScore,
      longTermAffinity: options.longTermAffinity ?? directScore + observedCount * 0.35 + Math.log1p(providerReportedCount || 0) * 0.18,
      confidence: playCount || completeCount || repeatCount || skipCount ? 'high' : observedCount ? 'medium' : 'low',
    },
  }
}

function snapshot(tracks, options = {}) {
  return {
    version: MUSIC_PREFERENCE_SNAPSHOT_VERSION,
    generatedAt: options.generatedAt || AS_OF,
    asOfAt: options.asOfAt || AS_OF,
    tracks: Object.fromEntries(tracks.map((track) => [track.trackId, track])),
    artists: {},
  }
}

function strongPositive(id = 'A', options = {}) {
  return preferenceTrack(id, { playCount: 8, completeCount: 6, repeatCount: 2, skipCount: 1, ...options })
}

function stableNegative(id = 'A', options = {}) {
  return preferenceTrack(id, { playCount: 6, completeCount: 0, repeatCount: 0, skipCount: 5, ...options })
}

test('strong direct positive promotes a high-confidence long-term track preference', () => {
  const result = buildMusicLongTermSummary(snapshot([strongPositive('A')]))
  assert.deepEqual({ signal: result.tracks.A.signal, confidence: result.tracks.A.confidence, strength: result.tracks.A.strength }, { signal: 'positive', confidence: 'high', strength: 'strong' })
  assert.equal(result.tracks.A.source, 'inferred_behavior')
  assert.equal(result.tracks.A.evidenceType, 'direct_player')
  assert.deepEqual(result.tracks.A.provenance, ['direct_player'])
  assert.equal(result.tracks.A.firstPromotedAt, AS_OF)
  assert.equal(result.tracks.A.lastConfirmedAt, AS_OF)
})

test('a single direct play does not promote a stable long-term preference', () => {
  const result = buildMusicLongTermSummary(snapshot([preferenceTrack('A', { playCount: 1, completeCount: 1, longTermAffinity: 20 })]))
  assert.deepEqual(result.tracks, {})
})

test('a single skip does not promote a negative long-term preference', () => {
  const result = buildMusicLongTermSummary(snapshot([preferenceTrack('A', { playCount: 1, skipCount: 1 })]))
  assert.deepEqual(result.tracks, {})
})

test('stable direct high-skip behavior promotes a negative inferred preference', () => {
  const result = buildMusicLongTermSummary(snapshot([stableNegative('A')]))
  assert.equal(result.tracks.A.signal, 'negative')
  assert.equal(result.tracks.A.strength, 'strong')
  assert.equal(result.tracks.A.evidence.skipCount, 5)
})

test('provider-only high count produces weak exposure and never a strong positive preference', () => {
  const result = buildMusicLongTermSummary(snapshot([preferenceTrack('A', { observedCount: 5, providerReportedCount: 500 })]))
  assert.equal(result.tracks.A.signal, 'exposure')
  assert.equal(result.tracks.A.evidenceType, 'provider_exposure')
  assert.equal(result.tracks.A.source, 'provider_history')
  assert.equal(result.tracks.A.strength, 'weak')
  assert.notEqual(result.tracks.A.signal, 'positive')
})

test('stable direct negative wins over high provider-reported exposure', () => {
  const result = buildMusicLongTermSummary(snapshot([stableNegative('A', { observedCount: 8, providerReportedCount: 1_000_000_000 })]))
  assert.equal(result.tracks.A.signal, 'negative')
  assert.equal(result.tracks.A.source, 'inferred_behavior')
  assert.deepEqual(result.tracks.A.provenance, ['direct_player'])
})

test('a recent affinity spike without long-term direct support is not promoted', () => {
  const result = buildMusicLongTermSummary(snapshot([preferenceTrack('A', { playCount: 2, completeCount: 2, recentAffinity: 100, longTermAffinity: 100 })]))
  assert.deepEqual(result.tracks, {})
})

test('artist promotion requires multiple stable tracks and sufficient direct plays', () => {
  const promoted = buildMusicLongTermSummary(snapshot([
    strongPositive('A', { artist: 'Shared Artist' }),
    strongPositive('B', { artist: 'Shared Artist' }),
  ]))
  assert.equal(promoted.artists['Shared Artist'].signal, 'positive')
  assert.equal(promoted.artists['Shared Artist'].evidence.trackCount, 2)
  const oneTrack = buildMusicLongTermSummary(snapshot([strongPositive('A', { artist: 'Solo Evidence' })]))
  assert.deepEqual(oneTrack.artists, {})
})

test('long-term promotion is deterministic for identical snapshots', () => {
  const input = snapshot([strongPositive('B'), stableNegative('A'), preferenceTrack('C', { observedCount: 3, providerReportedCount: 20 })])
  assert.deepEqual(buildMusicLongTermSummary(input), buildMusicLongTermSummary(input))
})

test('stale strength decays deterministically from snapshot asOfAt without wall-clock time', () => {
  const old = '2025-01-01T00:00:00.000Z'
  const input = snapshot([strongPositive('A', { lastDirectPlayedAt: old })], { asOfAt: '2026-08-28T00:00:00.000Z' })
  const result = buildMusicLongTermSummary(input)
  assert.equal(result.tracks.A.stale, true)
  assert.equal(result.tracks.A.strength, 'weak')
  assert.equal(result.tracks.A.staleDays, 604)
})

test('first promotion time remains stable while later evidence advances confirmation time', () => {
  const first = buildMusicLongTermSummary(snapshot([strongPositive('A', { lastDirectPlayedAt: '2026-01-01T00:00:00.000Z' })], { asOfAt: '2026-01-01T00:00:00.000Z', generatedAt: '2026-01-01T00:00:00.000Z' }))
  const later = buildMusicLongTermSummary(snapshot([strongPositive('A', { playCount: 10, completeCount: 8, lastDirectPlayedAt: AS_OF })]), { previousSummary: first })
  assert.equal(later.tracks.A.firstPromotedAt, '2026-01-01T00:00:00.000Z')
  assert.equal(later.tracks.A.lastConfirmedAt, AS_OF)
})

test('a stable inferred signal change starts a new promotion interval', () => {
  const first = buildMusicLongTermSummary(snapshot([strongPositive('A', { lastDirectPlayedAt: '2026-01-01T00:00:00.000Z' })], { asOfAt: '2026-01-01T00:00:00.000Z', generatedAt: '2026-01-01T00:00:00.000Z' }))
  const changed = buildMusicLongTermSummary(snapshot([stableNegative('A', { lastDirectPlayedAt: AS_OF })]), { previousSummary: first })
  assert.equal(changed.tracks.A.signal, 'negative')
  assert.equal(changed.tracks.A.firstPromotedAt, AS_OF)
})

test('explicit track preferences override contrary inferred signals without mutating either source', () => {
  const inferred = buildMusicLongTermSummary(snapshot([strongPositive('A'), stableNegative('B')]))
  const before = structuredClone(inferred)
  const effective = mergeExplicitAndInferredMusicPreferences({ tracks: {
    A: { trackId: 'A', signal: 'negative', statement: '我讨厌 A' },
    B: { trackId: 'B', signal: 'positive', statement: '我喜欢 B' },
  } }, inferred)
  assert.equal(effective.tracks.A.signal, 'negative')
  assert.equal(effective.tracks.B.signal, 'positive')
  assert.equal(effective.tracks.A.source, 'explicit_user')
  assert.equal(effective.tracks.B.evidenceType, 'explicit_statement')
  assert.equal(effective.tracks.A.behavioralMismatch.inferredSignal, 'positive')
  assert.equal(effective.tracks.B.behavioralMismatch.inferredSignal, 'negative')
  assert.deepEqual(inferred, before)
})

test('corrupt derived long-term summary rebuilds from the intact preference snapshot', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'yun-long-term-corrupt-'))
  const repository = createMusicMemoryRepository({ dataDir })
  const service = createMusicMemoryService({ repository })
  try {
    await repository.writePreferenceSnapshot(snapshot([strongPositive('A')]))
    await mkdir(path.dirname(repository.paths.longTermSummary), { recursive: true })
    await writeFile(repository.paths.longTermSummary, '{broken', 'utf8')
    const result = await service.getLongTermSummary()
    assert.equal(result.version, MUSIC_LONG_TERM_SUMMARY_VERSION)
    assert.equal(result.tracks.A.signal, 'positive')
  } finally { await rm(dataDir, { recursive: true, force: true }) }
})

test('long-term summary version mismatch triggers an atomic rebuild', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'yun-long-term-version-'))
  const repository = createMusicMemoryRepository({ dataDir })
  const service = createMusicMemoryService({ repository })
  try {
    await repository.writePreferenceSnapshot(snapshot([stableNegative('A')]))
    await repository.writeLongTermSummary({ version: 'music-long-term-preferences/obsolete' })
    const result = await service.getLongTermSummary()
    assert.equal(result.version, MUSIC_LONG_TERM_SUMMARY_VERSION)
    assert.equal(JSON.parse(await readFile(repository.paths.longTermSummary, 'utf8')).tracks.A.signal, 'negative')
  } finally { await rm(dataDir, { recursive: true, force: true }) }
})

test('source preference corruption is never hidden by long-term summary recovery', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'yun-long-term-source-corrupt-'))
  const repository = createMusicMemoryRepository({ dataDir })
  const service = createMusicMemoryService({ repository })
  try {
    await mkdir(path.dirname(repository.paths.preferenceSnapshot), { recursive: true })
    await writeFile(repository.paths.preferenceSnapshot, '{broken', 'utf8')
    await writeFile(repository.paths.listeningEvents, '{broken\n', 'utf8')
    await assert.rejects(service.getLongTermSummary(), { code: 'music_memory_corruption' })
  } finally { await rm(dataDir, { recursive: true, force: true }) }
})

test('promotion rebuild never appends ListeningEvent or MusicObservation feedback', async () => {
  const writes = []
  const source = snapshot([strongPositive('A')])
  const repository = {
    readPreferenceSnapshot: async () => source,
    writePreferenceSnapshot: async () => { throw new Error('unexpected_preference_rebuild') },
    readLongTermSummary: async () => null,
    writeLongTermSummary: async (value) => { writes.push(value); return value },
    appendListeningEvent: async () => { throw new Error('feedback_listening_event') },
    appendMusicObservation: async () => { throw new Error('feedback_music_observation') },
    listListeningEvents: async () => { throw new Error('unexpected_raw_read') },
    listMusicObservations: async () => { throw new Error('unexpected_raw_read') },
  }
  const result = await createMusicMemoryService({ repository }).getLongTermSummary()
  assert.equal(result.tracks.A.signal, 'positive')
  assert.equal(writes.length, 1)
})

test('inferred summary persists only in music-memory and never pollutes yunMemory', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'yun-long-term-isolated-'))
  const repository = createMusicMemoryRepository({ dataDir })
  const service = createMusicMemoryService({ repository })
  try {
    await repository.writePreferenceSnapshot(snapshot([strongPositive('A')]))
    await service.rebuildLongTermSummary()
    assert.match(repository.paths.longTermSummary, /music-memory[\\/]music-long-term-summary\.json$/)
    assert.doesNotMatch(repository.paths.longTermSummary, /yunMemory/i)
    assert.deepEqual(await repository.listListeningEvents(), [])
    assert.deepEqual(await repository.listMusicObservations(), [])
  } finally { await rm(dataDir, { recursive: true, force: true }) }
})
