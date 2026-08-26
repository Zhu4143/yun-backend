import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

function parseJsonLines(raw) {
  return raw.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)] } catch { return [] }
  })
}

async function readEvents(filePath) {
  try { return parseJsonLines(await readFile(filePath, 'utf8')) } catch { return [] }
}

export function createMusicMemoryRepository({ dataDir }) {
  if (!dataDir) throw new Error('music_memory_data_dir_required')
  const directory = path.join(dataDir, 'music-memory')
  const files = {
    listeningEvents: path.join(directory, 'listening-events.jsonl'),
    musicObservations: path.join(directory, 'music-observations.jsonl'),
  }
  const ids = { listeningEvents: null, musicObservations: null }

  async function loadIds(kind) {
    if (ids[kind]) return ids[kind]
    ids[kind] = new Set((await readEvents(files[kind])).map((event) => event.id).filter(Boolean))
    return ids[kind]
  }

  async function append(kind, event) {
    const knownIds = await loadIds(kind)
    if (knownIds.has(event.id)) return { written: false, duplicate: true, event }
    await mkdir(directory, { recursive: true })
    await appendFile(files[kind], `${JSON.stringify(event)}\n`, 'utf8')
    knownIds.add(event.id)
    return { written: true, duplicate: false, event }
  }

  return {
    appendListeningEvent: (event) => append('listeningEvents', event),
    appendMusicObservation: (event) => append('musicObservations', event),
    listListeningEvents: () => readEvents(files.listeningEvents),
    listMusicObservations: () => readEvents(files.musicObservations),
    paths: Object.freeze({ ...files }),
  }
}
