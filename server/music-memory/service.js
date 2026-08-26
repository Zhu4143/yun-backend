import { randomUUID } from 'node:crypto'
import { normalizeListeningEvent, normalizeMusicObservation } from './schema.js'

export function createMusicMemoryService({ repository, now = () => new Date(), idFactory = randomUUID } = {}) {
  if (!repository) throw new Error('music_memory_repository_required')

  async function persistListeningEvent(input = {}) {
    const event = normalizeListeningEvent({
      ...input,
      id: input.id || `listening-${idFactory()}`,
      timestamp: input.timestamp || now().toISOString(),
    })
    if (!event) return { written: false, invalid: true }
    return repository.appendListeningEvent(event)
  }

  async function persistMusicObservation(input = {}) {
    const observation = normalizeMusicObservation({
      ...input,
      id: input.id || `observation-${idFactory()}`,
      observedAt: input.observedAt || now().toISOString(),
    })
    if (!observation) return { written: false, invalid: true }
    return repository.appendMusicObservation(observation)
  }

  return { persistListeningEvent, persistMusicObservation }
}
