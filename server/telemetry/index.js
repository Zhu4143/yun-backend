// Yun Telemetry receiver, NDJSON storage, and a minimal aggregator.
//
// Self-contained (no dependency on server.js internals beyond `dataDir`).
// Events are validated, sanitized, size-limited, and appended to an NDJSON
// file; a small in-memory aggregator turns them into a coarse signal snapshot.

import { appendFile, mkdir, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const MAX_BODY_BYTES = 256 * 1024 // 256 KB
const MAX_EVENTS_PER_REQUEST = 500
const MAX_EVENT_BYTES = 4096 // 4 KB per normalized event
const MAX_FIELD_LENGTH = 200 // chars
const MAX_ARRAY_ITEMS = 50
const MAX_DEPTH = 4
const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_SEEN_IDS = 2000
const SIGNAL_WRITE_INTERVAL = 50

// Fields that commonly carry raw user/AI text. They are stripped by default
// and kept only when the debug-text flag is explicitly enabled.
const REDACT_KEYS = new Set([
  'text',
  'rawtext',
  'content',
  'reply',
  'transcript',
  'query',
  'interpretation',
  'message',
  'prompt',
  'answer',
  'usertext',
])

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(body)
}

async function readJsonBody(req, maxBytes) {
  const declared = Number(req.headers?.['content-length'] || 0)
  if (declared > maxBytes) {
    const error = new Error('payload_too_large')
    error.code = 'PAYLOAD_TOO_LARGE'
    throw error
  }
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > maxBytes) {
      const error = new Error('payload_too_large')
      error.code = 'PAYLOAD_TOO_LARGE'
      throw error
    }
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    const error = new Error('invalid_json')
    error.code = 'INVALID_JSON'
    throw error
  }
}

function sanitizeValue(value, depth, debugText) {
  if (value == null) return value
  if (typeof value === 'string') return value.slice(0, MAX_FIELD_LENGTH)
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return []
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth + 1, debugText))
  }
  if (typeof value === 'object') {
    if (depth >= MAX_DEPTH) return {}
    const output = {}
    for (const [key, val] of Object.entries(value)) {
      const safeKey = String(key).slice(0, 64)
      if (!debugText && REDACT_KEYS.has(safeKey.toLowerCase())) continue
      output[safeKey] = sanitizeValue(val, depth + 1, debugText)
    }
    return output
  }
  return null
}

function normalizeEvent(event, debugText) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null
  if (typeof event.type !== 'string') return null
  const type = event.type.trim()
  if (!type || type.length > 120) return null

  const normalized = {
    id: String(event.id || randomUUID()).slice(0, 80),
    ts: String(event.ts || new Date().toISOString()).slice(0, 64),
    sessionId: String(event.sessionId || '').slice(0, 80),
    turnId: event.turnId == null ? null : String(event.turnId).slice(0, 80),
    domain: String(event.domain || type.split('.')[0] || 'unknown').slice(0, 40),
    type,
    actor: String(event.actor || 'system').slice(0, 20),
    source: String(event.source || 'unknown').slice(0, 40),
    payload: sanitizeValue(event.payload && typeof event.payload === 'object' ? event.payload : {}, 0, debugText),
    context: sanitizeValue(event.context && typeof event.context === 'object' ? event.context : {}, 0, debugText),
    meta: sanitizeValue(event.meta && typeof event.meta === 'object' ? event.meta : {}, 0, debugText),
  }

  try {
    if (Buffer.byteLength(JSON.stringify(normalized)) > MAX_EVENT_BYTES) return null
  } catch {
    return null
  }
  return normalized
}

export function createYunTelemetry({
  dataDir,
  enabled = process.env.YUN_TELEMETRY_ENABLED !== '0',
  debugText = process.env.YUN_TELEMETRY_DEBUG_TEXT === '1',
}) {
  const filePath = path.join(dataDir, 'yun_telemetry.ndjson')
  const signalsPath = path.join(dataDir, 'yun_signals.json')

  const seenIds = new Set()
  const counters = new Map()
  const domainCounters = new Map()
  let sinceSnapshot = 0
  let writing = null

  async function ensureDir() {
    await mkdir(dataDir, { recursive: true })
  }

  async function rotateIfNeeded() {
    try {
      const info = await stat(filePath)
      if (info.size >= MAX_FILE_BYTES) {
        await rename(filePath, `${filePath}.${Date.now()}.rotated`)
      }
    } catch {
      // The file may not exist yet; that is normal.
    }
  }

  function computeSignals() {
    const count = (type) => counters.get(type) || 0
    const started = count('tts.started')
    const interrupted = count('tts.interrupted')
    const plays = count('playback.play_started') + count('playback.auto_advanced') + count('playback.skip_manual')
    return {
      updatedAt: new Date().toISOString(),
      totals: Object.fromEntries(counters),
      domains: Object.fromEntries(domainCounters),
      rates: {
        manualSkip: count('playback.skip_manual'),
        autoAdvanced: count('playback.auto_advanced'),
        replay: count('playback.replay'),
        seek: count('playback.seek'),
        pause: count('playback.pause'),
        resume: count('playback.resume'),
        recommendationAccepted: count('recommendation.accepted'),
        recommendationRejected: count('recommendation.rejected'),
        ttsStarted: started,
        ttsCompleted: count('tts.completed'),
        ttsInterrupted: interrupted,
        ttsInterruptRate: started ? interrupted / started : 0,
        commandRepeated: count('command.repeated'),
        commandCorrected: count('command.corrected'),
        commandFailed: count('command.failed'),
        toolFailed: count('tool.failed'),
        naturalFullPlay: count('playback.play_ended_natural'),
        totalPlays: plays,
      },
    }
  }

  async function writeSignals() {
    try {
      await ensureDir()
      await writeFile(signalsPath, `${JSON.stringify(computeSignals(), null, 2)}\n`, 'utf8')
    } catch {
      // Signals are best-effort; the NDJSON remains the source of truth.
    }
  }

  function scheduleSnapshot() {
    if (writing) return writing
    writing = writeSignals().finally(() => {
      writing = null
    })
    return writing
  }

  function aggregate(event) {
    counters.set(event.type, (counters.get(event.type) || 0) + 1)
    domainCounters.set(event.domain, (domainCounters.get(event.domain) || 0) + 1)
    sinceSnapshot += 1
    if (sinceSnapshot >= SIGNAL_WRITE_INTERVAL) {
      sinceSnapshot = 0
      scheduleSnapshot()
    }
  }

  async function flush() {
    // Await any in-flight snapshot, then persist the tail counts so cleanup can
    // remove the directory without racing a background write.
    if (writing) await writing
    if (sinceSnapshot > 0) {
      sinceSnapshot = 0
      await scheduleSnapshot()
    }
  }

  async function handleTelemetry(req, res) {
    if (!enabled) {
      return sendJson(res, 200, { ok: true, accepted: 0, disabled: true })
    }

    let body
    try {
      body = await readJsonBody(req, MAX_BODY_BYTES)
    } catch (error) {
      if (error?.code === 'PAYLOAD_TOO_LARGE') {
        return sendJson(res, 413, { ok: false, error: 'payload_too_large' })
      }
      return sendJson(res, 400, { ok: false, error: 'invalid_json' })
    }

    const rawEvents = Array.isArray(body?.events) ? body.events : Array.isArray(body) ? body : []
    const events = []
    for (const raw of rawEvents.slice(0, MAX_EVENTS_PER_REQUEST)) {
      const event = normalizeEvent(raw, debugText)
      if (!event) continue
      if (seenIds.has(event.id)) continue
      seenIds.add(event.id)
      events.push(event)
    }
    if (seenIds.size > MAX_SEEN_IDS) {
      const excess = [...seenIds].slice(0, seenIds.size - MAX_SEEN_IDS)
      excess.forEach((id) => seenIds.delete(id))
    }

    if (events.length) {
      try {
        await ensureDir()
        await rotateIfNeeded()
        const lines = `${events.map((event) => JSON.stringify(event)).join('\n')}\n`
        await appendFile(filePath, lines, 'utf8')
        events.forEach(aggregate)
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : 'storage_failed' })
      }
    }

    return sendJson(res, 200, { ok: true, accepted: events.length })
  }

  return {
    handleTelemetry,
    flush,
    getSignals: () => computeSignals(),
  }
}
