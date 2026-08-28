import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

function parseJsonLines(raw) {
  return raw.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return []
    try { return [JSON.parse(line)] } catch (cause) {
      const error = new Error(`music_memory_corruption: malformed JSONL at line ${index + 1}`, { cause })
      error.code = 'music_memory_corruption'
      throw error
    }
  })
}

async function readEvents(filePath) {
  try {
    return parseJsonLines(await readFile(filePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

export function createMusicMemoryRepository({ dataDir }) {
  if (!dataDir) throw new Error('music_memory_data_dir_required')
  const directory = path.join(dataDir, 'music-memory')
  const files = {
    listeningEvents: path.join(directory, 'listening-events.jsonl'),
    musicObservations: path.join(directory, 'music-observations.jsonl'),
    preferenceSnapshot: path.join(directory, 'music-preference-snapshot.json'),
  }
  const ids = { listeningEvents: null, musicObservations: null }
  const queues = { listeningEvents: Promise.resolve(), musicObservations: Promise.resolve() }

  async function loadIds(kind) {
    if (ids[kind]) return ids[kind]
    ids[kind] = new Set((await readEvents(files[kind])).map((event) => event.id).filter(Boolean))
    return ids[kind]
  }

  async function append(kind, event) {
    const operation = async () => {
      const knownIds = await loadIds(kind)
      if (knownIds.has(event.id)) return { written: false, duplicate: true, event }
      await mkdir(directory, { recursive: true })
      await appendFile(files[kind], `${JSON.stringify(event)}\n`, 'utf8')
      knownIds.add(event.id)
      return { written: true, duplicate: false, event }
    }
    const result = queues[kind].then(operation, operation)
    // A failed write must not poison the queue; later callers still need a
    // chance to surface their own filesystem or corruption error.
    queues[kind] = result.catch(() => {})
    return result
  }

  return {
    appendListeningEvent: (event) => append('listeningEvents', event),
    appendMusicObservation: (event) => append('musicObservations', event),
    listListeningEvents: () => readEvents(files.listeningEvents),
    listMusicObservations: () => readEvents(files.musicObservations),
    async readPreferenceSnapshot() {
      try { return JSON.parse(await readFile(files.preferenceSnapshot, 'utf8')) } catch (error) {
        if (error?.code === 'ENOENT') return null
        const corruption = new Error('music_preference_snapshot_corruption', { cause: error }); corruption.code = 'music_preference_snapshot_corruption'; throw corruption
      }
    },
    async writePreferenceSnapshot(snapshot) {
      await mkdir(directory, { recursive: true })
      const temporary = `${files.preferenceSnapshot}.${randomUUID()}.tmp`
      await writeFile(temporary, JSON.stringify(snapshot, null, 2), 'utf8')
      await rename(temporary, files.preferenceSnapshot)
      return snapshot
    },
    paths: Object.freeze({ ...files }),
  }
}
