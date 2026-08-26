const LISTENING_EVENT_TYPES = new Set([
  'play',
  'pause',
  'resume',
  'seek',
  'skip',
  'complete',
  'previous',
  'next',
  'repeat',
])

const CONFIDENCE_LEVELS = new Set(['low', 'medium', 'high'])
const SENSITIVE_KEY = /cookie|token|secret|authorization|password|credential|api[_-]?key/i

function text(value, fallback = '') {
  const result = String(value ?? '').trim()
  return result || fallback
}

function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function timestamp(value) {
  if (value === null || value === undefined || value === '') return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function cleanMetadata(value, depth = 0) {
  if (depth > 4 || value === undefined || value === null) return null
  if (Array.isArray(value)) return value.slice(0, 32).map((item) => cleanMetadata(item, depth + 1)).filter((item) => item !== null)
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !SENSITIVE_KEY.test(key))
      .slice(0, 32)
      .map(([key, item]) => [key, cleanMetadata(item, depth + 1)])
      .filter(([, item]) => item !== null))
  }
  if (typeof value === 'string') return value.slice(0, 1000)
  return typeof value === 'number' || typeof value === 'boolean' ? value : null
}

function normalizeTrack(input = {}, { ignoreTopLevelSource = false } = {}) {
  const track = input.track && typeof input.track === 'object' ? input.track : input
  // Top-level `id` belongs to the event/observation itself. Only a nested
  // canonical track may use `id` as its track identifier.
  const trackId = text(input.trackId || track.trackId || (input.track ? track.id : ''))
  if (!trackId) return null
  return {
    trackId,
    providerId: text(input.providerId || track.providerId) || null,
    source: text(track.source || (ignoreTopLevelSource ? '' : input.source)) || null,
    title: text(track.title || track.name) || null,
    artist: text(track.artist) || null,
    album: text(track.album) || null,
    durationMs: finiteNumber(input.durationMs ?? track.durationMs ?? track.duration, null),
  }
}

export function normalizeListeningEvent(input = {}) {
  const id = text(input.id)
  const type = text(input.type)
  const occurredAt = timestamp(input.timestamp)
  const track = normalizeTrack(input)
  if (!id || !LISTENING_EVENT_TYPES.has(type) || !occurredAt || !track) return null
  return {
    kind: 'listening_event',
    id,
    type,
    ...track,
    positionMs: finiteNumber(input.positionMs, null),
    timestamp: occurredAt,
    device: text(input.device) || null,
    sessionId: text(input.sessionId) || null,
    metadata: cleanMetadata(input.metadata) || {},
  }
}

export function normalizeMusicObservation(input = {}) {
  const id = text(input.id)
  const provenance = text(input.provenance || input.observationSource || input.source)
  const observedAt = timestamp(input.observedAt)
  const track = normalizeTrack(input, { ignoreTopLevelSource: true })
  const confidence = text(input.confidence, 'medium')
  if (!id || provenance !== 'netease_history_sync' || !observedAt || !track?.source || !CONFIDENCE_LEVELS.has(confidence)) return null
  return {
    kind: 'music_observation',
    id,
    ...track,
    provenance,
    observedAt,
    playCount: finiteNumber(input.playCount, null),
    playCountDelta: finiteNumber(input.playCountDelta, null),
    firstObservedAt: timestamp(input.firstObservedAt) || null,
    lastObservedAt: timestamp(input.lastObservedAt) || null,
    confidence,
    metadata: cleanMetadata(input.metadata) || {},
  }
}

export const MUSIC_MEMORY_TYPES = Object.freeze({ LISTENING_EVENT_TYPES, CONFIDENCE_LEVELS })
