import { createHash } from 'node:crypto'

const SNAPSHOT_SCHEMA_VERSION = 'netease-history-sync/v1'
const OBSERVATION_PROVENANCE = 'netease_history_sync'

function text(value) {
  const result = String(value ?? '').trim()
  return result || ''
}

function number(value) {
  if (value === null || value === undefined || value === '') return null
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}

function isoTime(value) {
  const valueAsNumber = number(value)
  if (!valueAsNumber || valueAsNumber <= 0) return null
  const date = new Date(valueAsNumber)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function canonicalTrack(song = {}) {
  const providerId = text(song.providerId || song.id).replace(/^netease-/, '')
  if (!providerId) return null
  return {
    id: text(song.id || providerId),
    providerId,
    source: 'netease',
    title: text(song.title || song.name) || '未知歌曲',
    artist: text(song.artist) || '未知歌手',
    album: text(song.album),
    fileUrl: text(song.fileUrl) || `/api/netease/audio?id=${encodeURIComponent(providerId)}`,
    coverUrl: text(song.coverUrl),
    duration: number(song.duration),
  }
}

function historyTracks(records = []) {
  return Object.fromEntries(records.flatMap((record) => {
    const track = canonicalTrack(record?.song)
    if (!track) return []
    return [[track.providerId, { track, playCount: number(record.playCount) }]]
  }))
}

function recentItems(items = []) {
  return items.flatMap((item) => {
    const track = canonicalTrack(item?.song)
    if (!track) return []
    return [{ track, providerPlayedAt: isoTime(item.playedAt) }]
  })
}

export function normalizeNetEaseHistory({ recent, week, all } = {}) {
  return {
    recent: recentItems(recent?.items),
    week: historyTracks(week?.records),
    all: historyTracks(all?.records),
  }
}

function observationId(evidence) {
  const encoded = JSON.stringify(evidence)
  return `netease-history-${createHash('sha256').update(encoded).digest('hex').slice(0, 32)}`
}

function accountIdFrom(status) {
  return status?.loggedIn && text(status?.user?.userId) ? text(status.user.userId) : ''
}

function safeSnapshot({ accountId, history, attemptedAt, successfulAt }) {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    accountId,
    lastAttemptAt: attemptedAt,
    lastSuccessfulSyncAt: successfulAt,
    history,
  }
}

function observationsForTransition({ accountId, previousHistory, currentHistory, observedAt }) {
  const observations = []
  const previousAll = previousHistory?.all || {}
  for (const [providerId, current] of Object.entries(currentHistory.all || {})) {
    const previous = previousAll[providerId]
    const currentCount = number(current.playCount)
    const previousCount = number(previous?.playCount)
    if (!previous) {
      observations.push({
        id: observationId({ accountId, scope: 'all', providerId, previousCount: null, currentCount, newlyObserved: true }),
        track: current.track,
        playCount: currentCount,
        playCountDelta: null,
        confidence: 'medium',
        observedAt,
        metadata: { scope: 'all', newlyObserved: true },
      })
      continue
    }
    if (currentCount !== null && previousCount !== null && currentCount > previousCount) {
      observations.push({
        id: observationId({ accountId, scope: 'all', providerId, previousCount, currentCount }),
        track: current.track,
        playCount: currentCount,
        playCountDelta: currentCount - previousCount,
        confidence: 'high',
        observedAt,
        metadata: { scope: 'all', previousPlayCount: previousCount },
      })
    }
  }

  const previousRecent = new Set((previousHistory?.recent || [])
    .filter((item) => item.providerPlayedAt)
    .map((item) => `${item.track.providerId}:${item.providerPlayedAt}`))
  for (const item of currentHistory.recent || []) {
    if (!item.providerPlayedAt) continue
    const evidenceKey = `${item.track.providerId}:${item.providerPlayedAt}`
    if (previousRecent.has(evidenceKey)) continue
    observations.push({
      id: observationId({ accountId, scope: 'recent', providerId: item.track.providerId, providerPlayedAt: item.providerPlayedAt }),
      track: item.track,
      playCount: null,
      playCountDelta: null,
      confidence: 'high',
      observedAt,
      firstObservedAt: item.providerPlayedAt,
      lastObservedAt: item.providerPlayedAt,
      metadata: { scope: 'recent', providerPlayedAt: item.providerPlayedAt },
    })
  }
  return observations
}

export function createNetEaseListeningHistorySyncService({ sessionService, capabilityService, musicMemoryService, stateStore, now = () => new Date() } = {}) {
  if (!sessionService || typeof sessionService.validateSession !== 'function') throw new Error('netease_session_service_required')
  if (!capabilityService || typeof capabilityService.recent !== 'function' || typeof capabilityService.userRecord !== 'function') throw new Error('netease_history_capability_service_required')
  if (!musicMemoryService || typeof musicMemoryService.persistMusicObservation !== 'function') throw new Error('music_memory_service_required')
  if (!stateStore || typeof stateStore.get !== 'function' || typeof stateStore.set !== 'function') throw new Error('netease_history_sync_state_store_required')

  async function activeAccount() {
    const status = await sessionService.validateSession()
    const accountId = accountIdFrom(status)
    return { status, accountId }
  }

  async function stillSameAccount(accountId) {
    const current = await activeAccount()
    return current.accountId === accountId ? current : null
  }

  async function fetchHistory() {
    const [recent, week, all] = await Promise.all([
      capabilityService.recent({ type: 'song', limit: 100 }),
      capabilityService.userRecord({ type: 'week', limit: 100 }),
      capabilityService.userRecord({ type: 'all', limit: 100 }),
    ])
    return normalizeNetEaseHistory({ recent, week, all })
  }

  async function sync() {
    const started = await activeAccount()
    if (!started.accountId) return { synced: false, reason: started.status?.status || 'not_logged_in' }

    let history
    try {
      history = await fetchHistory()
    } catch (error) {
      return { synced: false, reason: error?.code === 'network_error' ? 'network_error' : 'history_unavailable' }
    }

    if (!(await stillSameAccount(started.accountId))) return { synced: false, reason: 'account_changed' }
    const snapshot = await stateStore.get()
    const observedAt = now().toISOString()
    if (!snapshot || snapshot.accountId !== started.accountId) {
      if (!(await stillSameAccount(started.accountId))) return { synced: false, reason: 'account_changed' }
      const baseline = safeSnapshot({ accountId: started.accountId, history, attemptedAt: observedAt, successfulAt: observedAt })
      await stateStore.set(baseline)
      return { synced: true, baselineEstablished: true, observationsWritten: 0, lastSuccessfulSyncAt: observedAt }
    }

    const observations = observationsForTransition({ accountId: started.accountId, previousHistory: snapshot.history, currentHistory: history, observedAt })
    let observationsWritten = 0
    for (const observation of observations) {
      if (!(await stillSameAccount(started.accountId))) return { synced: false, reason: 'account_changed' }
      const result = await musicMemoryService.persistMusicObservation({ ...observation, provenance: OBSERVATION_PROVENANCE })
      if (result.written) observationsWritten += 1
    }
    if (!(await stillSameAccount(started.accountId))) return { synced: false, reason: 'account_changed' }
    const nextSnapshot = safeSnapshot({ accountId: started.accountId, history, attemptedAt: observedAt, successfulAt: observedAt })
    await stateStore.set(nextSnapshot)
    return { synced: true, baselineEstablished: false, observationsWritten, lastSuccessfulSyncAt: observedAt }
  }

  return { sync, fetchHistory, normalizeHistory: normalizeNetEaseHistory }
}
