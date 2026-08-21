import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

// This adapter deliberately separates the player from analysis providers.  An
// optional All-In-One/MuQ worker can populate the same cache later; playback
// never waits for it and this conservative fallback never invents sections.
export const MUSIC_ANALYSIS_VERSION = 'yun-music-intelligence/v1'

function trackIdentity(track = {}) {
  return String(track.id || track.providerId || track.filePath || track.fileUrl || `${track.title || ''}-${track.artist || ''}`)
}

async function trackHash(track) {
  const identity = trackIdentity(track)
  let fingerprint = identity
  if (track?.filePath) {
    try {
      const info = await stat(track.filePath)
      fingerprint += `:${info.size}:${info.mtimeMs}`
    } catch {
      // Stream-only tracks are still cacheable by their stable provider id.
    }
  }
  return createHash('sha1').update(fingerprint).digest('hex')
}

function emptyAnalysis(track, hash) {
  const duration = Number(track?.duration) || 0
  return {
    trackId: trackIdentity(track),
    trackHash: hash,
    duration,
    bpm: Number(track?.bpm) || null,
    key: track?.key || null,
    meter: track?.meter || null,
    beats: [],
    downbeats: [],
    sections: [],
    vocalEntry: null,
    energyCurve: [],
    mood: [...(track?.moodTags || [])],
    genre: [...(track?.genre || [])],
    instrumentation: [...(track?.instrumentation || [])],
    valence: Number(track?.valence) || null,
    arousal: Number(track?.energy) || null,
    audioEmbedding: null,
    highlights: [],
    provider: 'metadata-fallback',
    structureAvailable: false,
    analysisVersion: MUSIC_ANALYSIS_VERSION,
  }
}

export function createMusicIntelligenceService({ cacheDir }) {
  const resolveCachePath = (hash) => path.join(cacheDir, `${hash}.json`)

  async function getAnalysis(track) {
    const hash = await trackHash(track)
    try {
      const cached = JSON.parse(await readFile(resolveCachePath(hash), 'utf8'))
      if (cached?.analysisVersion === MUSIC_ANALYSIS_VERSION) return cached
    } catch {
      // A cache miss is normal and must not touch playback.
    }
    const analysis = emptyAnalysis(track, hash)
    await mkdir(cacheDir, { recursive: true })
    await writeFile(resolveCachePath(hash), JSON.stringify(analysis, null, 2), 'utf8')
    return analysis
  }

  async function resolveSeekTarget(track, intent = {}) {
    const analysis = await getAnalysis(track)
    const target = String(intent.target || '').toLowerCase()
    const occurrence = String(intent.occurrence || 'first').toLowerCase()
    let candidates
    if (target === 'highlight') candidates = analysis.highlights || []
    else if (target === 'vocal_entry' && analysis.vocalEntry) candidates = [{ start: analysis.vocalEntry }]
    else candidates = (analysis.sections || []).filter((section) => section.type === target)
    if (!candidates.length) return { ok: false, reason: 'analysis_unavailable', analysis }
    const selected = occurrence === 'last' ? candidates.at(-1) : occurrence === 'second' ? candidates[1] : candidates[0]
    if (!selected || !Number.isFinite(Number(selected.start))) return { ok: false, reason: 'target_unavailable', analysis }
    // A small pre-roll avoids landing on a transient, never a model-generated
    // timestamp. The actual boundary comes only from cached analysis.
    return { ok: true, positionSec: Math.max(0, Number(selected.start) - 0.18), analysis }
  }

  return { getAnalysis, resolveSeekTarget }
}
