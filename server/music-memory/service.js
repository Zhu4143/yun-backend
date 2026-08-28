import { randomUUID } from 'node:crypto'
import { normalizeListeningEvent, normalizeMusicObservation } from './schema.js'
import { buildMusicPreferenceSnapshot } from './preferenceAggregator.js'

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
    if (result.written) await rebuildPreferences()
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
    if (result.written) await rebuildPreferences()
    return result
  }

  async function rebuildPreferences() {
    const snapshot = buildMusicPreferenceSnapshot({ listeningEvents: await repository.listListeningEvents(), musicObservations: await repository.listMusicObservations(), generatedAt: now().toISOString() })
    return repository.writePreferenceSnapshot(snapshot)
  }
  async function getPreferences() { return (await repository.readPreferenceSnapshot()) || rebuildPreferences() }

  return { persistListeningEvent, persistMusicObservation, rebuildPreferences, getPreferences }
}
