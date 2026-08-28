import { randomUUID } from 'node:crypto'
import { normalizeListeningEvent, normalizeMusicObservation } from './schema.js'
import { buildMusicPreferenceSnapshot, MUSIC_PREFERENCE_SNAPSHOT_VERSION } from './preferenceAggregator.js'
import { buildMusicLongTermSummary, MUSIC_LONG_TERM_SUMMARY_VERSION } from './longTermSummary.js'

export function createMusicMemoryService({ repository, now = () => new Date(), idFactory = randomUUID } = {}) {
  if (!repository) throw new Error('music_memory_repository_required')

  async function persistListeningEvent(input = {}) {
    const event = normalizeListeningEvent({
      ...input,
      id: input.id || `listening-${idFactory()}`,
      timestamp: input.timestamp || now().toISOString(),
    })
    if (!event) return { written: false, invalid: true }
    const result = await repository.appendListeningEvent(event)
    if (result.written) {
      const snapshot = await rebuildPreferences()
      await rebuildLongTermSummary(snapshot)
    }
    return result
  }

  async function persistMusicObservation(input = {}) {
    const observation = normalizeMusicObservation({
      ...input,
      id: input.id || `observation-${idFactory()}`,
      observedAt: input.observedAt || now().toISOString(),
    })
    if (!observation) return { written: false, invalid: true }
    const result = await repository.appendMusicObservation(observation)
    if (result.written) {
      const snapshot = await rebuildPreferences()
      await rebuildLongTermSummary(snapshot)
    }
    return result
  }

  let preferenceQueue = Promise.resolve()
  function rebuildPreferences() {
    const operation = async () => {
      const snapshot = buildMusicPreferenceSnapshot({ listeningEvents: await repository.listListeningEvents(), musicObservations: await repository.listMusicObservations(), generatedAt: now().toISOString() })
      return repository.writePreferenceSnapshot(snapshot)
    }
    const result = preferenceQueue.then(operation, operation)
    preferenceQueue = result.catch(() => {})
    return result
  }
  async function getPreferences() {
    try {
      const snapshot = await repository.readPreferenceSnapshot()
      return !snapshot || snapshot.version !== MUSIC_PREFERENCE_SNAPSHOT_VERSION ? rebuildPreferences() : snapshot
    } catch (error) {
      if (error?.code === 'music_preference_snapshot_corruption') return rebuildPreferences()
      throw error
    }
  }

  let longTermQueue = Promise.resolve()
  function rebuildLongTermSummary(snapshotInput) {
    const operation = async () => {
      const snapshot = snapshotInput || await getPreferences()
      let previousSummary = null
      try {
        const existing = await repository.readLongTermSummary()
        if (existing?.version === MUSIC_LONG_TERM_SUMMARY_VERSION) previousSummary = existing
      } catch (error) {
        if (error?.code !== 'music_long_term_summary_corruption') throw error
      }
      return repository.writeLongTermSummary(buildMusicLongTermSummary(snapshot, { previousSummary }))
    }
    const result = longTermQueue.then(operation, operation)
    longTermQueue = result.catch(() => {})
    return result
  }
  async function getLongTermSummary() {
    const snapshot = await getPreferences()
    try {
      const summary = await repository.readLongTermSummary()
      const source = summary?.sourceSnapshot || {}
      const current = summary?.version === MUSIC_LONG_TERM_SUMMARY_VERSION
        && source.version === snapshot.version
        && source.generatedAt === snapshot.generatedAt
        && source.asOfAt === snapshot.asOfAt
      return current ? summary : rebuildLongTermSummary(snapshot)
    } catch (error) {
      if (error?.code === 'music_long_term_summary_corruption') return rebuildLongTermSummary(snapshot)
      throw error
    }
  }

  return { persistListeningEvent, persistMusicObservation, rebuildPreferences, getPreferences, rebuildLongTermSummary, getLongTermSummary }
}
