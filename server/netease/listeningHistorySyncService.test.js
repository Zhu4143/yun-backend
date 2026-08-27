import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createMusicMemoryRepository } from '../music-memory/repository.js'
import { createMusicMemoryService } from '../music-memory/service.js'
import { createFileNetEaseHistorySyncStateStore, createMemoryNetEaseHistorySyncStateStore } from './historySyncStateStore.js'
import { createNetEaseListeningHistorySyncService } from './listeningHistorySyncService.js'

function song(id) {
  return { id: `netease-${id}`, providerId: String(id), source: 'netease', title: `Song ${id}`, artist: 'Test Artist', album: 'Test Album', fileUrl: `/api/netease/audio?id=${id}`, coverUrl: '', duration: 180000 }
}

function records(counts = {}) {
  return Object.entries(counts).map(([id, playCount]) => ({ song: song(id), playCount }))
}

function history({ recent = [], week = {}, all = {} } = {}) {
  return {
    recent: { items: recent.map(({ id, playedAt }) => ({ song: song(id), playedAt })) },
    week: { records: records(week) },
    all: { records: records(all) },
  }
}

async function createContext({ stateStore = createMemoryNetEaseHistorySyncStateStore(), currentHistory = history(), accountId = '42', nowMs: initialNowMs = Date.parse('2026-08-27T00:00:00.000Z') } = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'yun-netease-history-sync-'))
  const repository = createMusicMemoryRepository({ dataDir })
  let account = accountId
  let status = 'logged_in'
  let revision = 0
  let failure = null
  let onFetch = null
  let fetchHistorySequence = []
  const calls = []
  const sessionService = {
    async validateSession() {
      return status === 'logged_in'
        ? { loggedIn: true, status, user: { userId: account } }
        : { loggedIn: false, status }
    },
    getRevision() { return revision },
  }
  const capabilityService = {
    async recent() {
      calls.push('recent')
      if (fetchHistorySequence.length) currentHistory = fetchHistorySequence.shift()
      if (failure) throw failure
      await onFetch?.()
      return currentHistory.recent
    },
    async userRecord({ type }) { calls.push(`userRecord:${type}`); if (failure) throw failure; return type === 'all' ? currentHistory.all : currentHistory.week },
  }
  let nowMs = initialNowMs
  const service = createNetEaseListeningHistorySyncService({
    sessionService,
    capabilityService,
    musicMemoryService: createMusicMemoryService({ repository }),
    stateStore,
    now: () => new Date(nowMs),
  })
  return {
    dataDir, repository, stateStore, service, calls,
    setHistory(next) { currentHistory = next },
    setAccount(next) { account = String(next); revision += 1 },
    setStatus(next) { status = next },
    setRevision(next) { revision = Number(next) },
    setFailure(next) { failure = next },
    setOnFetch(next) { onFetch = next },
    setFetchHistorySequence(next) { fetchHistorySequence = [...next] },
    advanceTime() { nowMs += 1000 },
  }
}

test('first sync establishes a baseline without inventing cumulative history observations', async () => {
  const context = await createContext({ currentHistory: history({ all: { A: 12, B: 3 }, week: { A: 4 } }) })
  try {
    const result = await context.service.sync()
    assert.deepEqual(result, { synced: true, baselineEstablished: true, observationsWritten: 0, lastSuccessfulSyncAt: '2026-08-27T00:00:00.000Z' })
    assert.deepEqual(await context.repository.listMusicObservations(), [])
    const snapshot = await context.stateStore.get()
    assert.equal(snapshot.accountId, '42')
    assert.equal(snapshot.schemaVersion, 'netease-history-sync/v1')
  } finally { await rm(context.dataDir, { recursive: true, force: true }) }
})

test('positive all-time count changes create one canonical NetEase observation and repeated sync is idempotent', async () => {
  const context = await createContext({ currentHistory: history({ all: { A: 12 } }) })
  try {
    await context.service.sync()
    context.setHistory(history({ all: { A: 15 } }))
    context.advanceTime()
    assert.equal((await context.service.sync()).observationsWritten, 1)
    const [observation] = await context.repository.listMusicObservations()
    assert.equal(observation.source, 'netease')
    assert.equal(observation.provenance, 'netease_history_sync')
    assert.equal(observation.playCount, 15)
    assert.equal(observation.playCountDelta, 3)
    assert.equal((await context.service.sync()).observationsWritten, 0)
    assert.equal((await context.repository.listMusicObservations()).length, 1)
  } finally { await rm(context.dataDir, { recursive: true, force: true }) }
})

test('a crash after observation persistence deduplicates the deterministic transition on retry', async () => {
  const backingStore = createMemoryNetEaseHistorySyncStateStore()
  let failNextSet = false
  const stateStore = {
    get: () => backingStore.get(),
    async set(value) {
      if (failNextSet) { failNextSet = false; throw new Error('snapshot_write_failed') }
      return backingStore.set(value)
    },
  }
  const context = await createContext({ stateStore, currentHistory: history({ all: { A: 12 } }) })
  try {
    await context.service.sync()
    context.setHistory(history({ all: { A: 15 } }))
    failNextSet = true
    await assert.rejects(() => context.service.sync(), /snapshot_write_failed/)
    assert.equal((await context.repository.listMusicObservations()).length, 1)
    assert.equal((await backingStore.get()).history.all.A.playCount, 12)
    assert.equal((await context.service.sync()).observationsWritten, 0)
    assert.equal((await context.repository.listMusicObservations()).length, 1)
    assert.equal((await backingStore.get()).history.all.A.playCount, 15)
  } finally { await rm(context.dataDir, { recursive: true, force: true }) }
})

test('account switches establish a new baseline without cross-account observations', async () => {
  const context = await createContext({ currentHistory: history({ all: { A: 12 } }) })
  try {
    await context.service.sync()
    context.setAccount('99')
    context.setHistory(history({ all: { A: 99 } }))
    assert.equal((await context.service.sync()).baselineEstablished, true)
    assert.deepEqual(await context.repository.listMusicObservations(), [])
    assert.equal((await context.stateStore.get()).accountId, '99')
  } finally { await rm(context.dataDir, { recursive: true, force: true }) }
})

test('an account change during fetch aborts before observations or a snapshot are written', async () => {
  const context = await createContext({ currentHistory: history({ all: { A: 12 } }) })
  try {
    context.setOnFetch(async () => context.setAccount('99'))
    assert.deepEqual(await context.service.sync(), { synced: false, reason: 'account_changed' })
    assert.equal(await context.stateStore.get(), null)
    assert.deepEqual(await context.repository.listMusicObservations(), [])
  } finally { await rm(context.dataDir, { recursive: true, force: true }) }
})

test('a session revision change during fetch aborts before observation or snapshot persistence', async () => {
  const context = await createContext({ currentHistory: history({ all: { A: 12 } }) })
  try {
    await context.service.sync()
    const baseline = await context.stateStore.get()
    context.setHistory(history({ all: { A: 15 } }))
    context.setOnFetch(async () => context.setRevision(1))
    assert.deepEqual(await context.service.sync(), { synced: false, reason: 'account_changed' })
    assert.deepEqual(await context.stateStore.get(), baseline)
    assert.deepEqual(await context.repository.listMusicObservations(), [])
  } finally { await rm(context.dataDir, { recursive: true, force: true }) }
})

test('network, not_logged_in, expired and invalid outcomes do not overwrite a successful snapshot', async () => {
  const context = await createContext({ currentHistory: history({ all: { A: 12 } }) })
  try {
    await context.service.sync()
    const baseline = await context.stateStore.get()
    const networkError = new Error('socket timeout'); networkError.code = 'network_error'
    context.setFailure(networkError)
    assert.deepEqual(await context.service.sync(), { synced: false, reason: 'network_error' })
    assert.deepEqual(await context.stateStore.get(), baseline)
    context.setFailure(null)
    for (const state of ['not_logged_in', 'expired', 'invalid']) {
      context.setStatus(state)
      const callsBefore = context.calls.length
      assert.deepEqual(await context.service.sync(), { synced: false, reason: state })
      assert.equal(context.calls.length, callsBefore)
      assert.deepEqual(await context.stateStore.get(), baseline)
    }
  } finally { await rm(context.dataDir, { recursive: true, force: true }) }
})

test('week count decreases and top-list disappearance never create negative or absence observations', async () => {
  const context = await createContext({ currentHistory: history({ week: { A: 12, B: 3 }, all: { A: 12, B: 3 } }) })
  try {
    await context.service.sync()
    context.setHistory(history({ week: { A: 8 }, all: { A: 12 } }))
    assert.equal((await context.service.sync()).observationsWritten, 0)
    assert.deepEqual(await context.repository.listMusicObservations(), [])
  } finally { await rm(context.dataDir, { recursive: true, force: true }) }
})

test('a newly observed top-list song is conservative and history serialization contains no credentials', async () => {
  const context = await createContext({ currentHistory: history({ all: { A: 12 } }) })
  try {
    await context.service.sync()
    context.setHistory(history({ all: { A: 12, C: 4 }, recent: [{ id: 'C', playedAt: 1760000000000 }] }))
    await context.service.sync()
    const observations = await context.repository.listMusicObservations()
    const newlyObserved = observations.find((item) => item.providerId === 'C' && item.metadata.scope === 'all')
    assert.equal(newlyObserved.playCount, 4)
    assert.equal(newlyObserved.playCountDelta, null)
    assert.equal(newlyObserved.confidence, 'medium')
    assert.equal(observations.some((item) => item.metadata.scope === 'recent' && item.metadata.providerPlayedAt), true)
    assert.doesNotMatch(JSON.stringify({ snapshot: await context.stateStore.get(), observations }), /MUSIC_U|cookie|token/i)
  } finally { await rm(context.dataDir, { recursive: true, force: true }) }
})

test('providerPlayedAt stays provider evidence and never becomes an observation timestamp', async () => {
  const syncTime = Date.parse('2026-08-28T18:00:00.000Z')
  const providerPlayedAt = Date.parse('2026-08-27T01:00:00.000Z')
  const context = await createContext({ currentHistory: history({ all: { A: 12 } }), nowMs: syncTime })
  try {
    await context.service.sync()
    context.setHistory(history({ all: { A: 12 }, recent: [{ id: 'A', playedAt: providerPlayedAt }] }))
    await context.service.sync()
    const observation = (await context.repository.listMusicObservations()).find((item) => item.metadata.scope === 'recent')
    assert.equal(observation.observedAt, '2026-08-28T18:00:00.000Z')
    assert.equal(observation.metadata.providerPlayedAt, '2026-08-27T01:00:00.000Z')
    assert.notEqual(observation.observedAt, observation.metadata.providerPlayedAt)
    assert.equal(observation.firstObservedAt, null)
    assert.equal(observation.lastObservedAt, null)
  } finally { await rm(context.dataDir, { recursive: true, force: true }) }
})

test('observations retain non-sensitive account provenance across account changes', async () => {
  const context = await createContext({ currentHistory: history({ all: { A: 12 } }) })
  try {
    await context.service.sync()
    context.setHistory(history({ all: { A: 15 } }))
    await context.service.sync()
    assert.equal((await context.repository.listMusicObservations())[0].metadata.accountId, '42')
    context.setAccount('99')
    context.setHistory(history({ all: { B: 4 } }))
    await context.service.sync()
    context.setHistory(history({ all: { B: 5 } }))
    await context.service.sync()
    const observations = await context.repository.listMusicObservations()
    assert.equal(observations.find((item) => item.providerId === 'B').metadata.accountId, '99')
    assert.doesNotMatch(JSON.stringify(observations), /MUSIC_U|cookie|token/i)
  } finally { await rm(context.dataDir, { recursive: true, force: true }) }
})

test('concurrent sync calls serialize complete transitions without snapshot rollback or overlapping deltas', async () => {
  const context = await createContext({ currentHistory: history({ all: { A: 12 } }) })
  try {
    await context.service.sync()
    context.setFetchHistorySequence([
      history({ all: { A: 15 } }),
      history({ all: { A: 16 } }),
    ])
    const [first, second] = await Promise.all([context.service.sync(), context.service.sync()])
    assert.equal(first.observationsWritten, 1)
    assert.equal(second.observationsWritten, 1)
    assert.equal((await context.stateStore.get()).history.all.A.playCount, 16)
    const deltas = (await context.repository.listMusicObservations()).map((item) => ({ playCount: item.playCount, playCountDelta: item.playCountDelta, previous: item.metadata.previousPlayCount }))
    assert.deepEqual(deltas, [
      { playCount: 15, playCountDelta: 3, previous: 12 },
      { playCount: 16, playCountDelta: 1, previous: 15 },
    ])
  } finally { await rm(context.dataDir, { recursive: true, force: true }) }
})

test('a failed sync does not poison the serialized sync queue', async () => {
  const context = await createContext({ currentHistory: history({ all: { A: 12 } }) })
  try {
    await context.service.sync()
    const networkError = new Error('socket timeout'); networkError.code = 'network_error'
    context.setFailure(networkError)
    assert.deepEqual(await context.service.sync(), { synced: false, reason: 'network_error' })
    context.setFailure(null)
    context.setHistory(history({ all: { A: 15 } }))
    assert.equal((await context.service.sync()).observationsWritten, 1)
    assert.equal((await context.stateStore.get()).history.all.A.playCount, 15)
  } finally { await rm(context.dataDir, { recursive: true, force: true }) }
})

test('the same sync service works with the file-backed state store', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'yun-netease-history-state-'))
  const stateStore = createFileNetEaseHistorySyncStateStore({ filePath: path.join(dataDir, 'netease-history-sync-state.json') })
  const context = await createContext({ stateStore, currentHistory: history({ all: { A: 12 } }) })
  try {
    assert.equal((await context.service.sync()).baselineEstablished, true)
    assert.equal((await stateStore.get()).accountId, '42')
  } finally {
    await rm(context.dataDir, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  }
})
