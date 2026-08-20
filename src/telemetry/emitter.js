// Yun Telemetry emitter.
//
// Non-blocking, failure-isolated, and fully disableable. Telemetry must never
// throw into the caller and must never interfere with music playback.

const TELEMETRY_ENDPOINT = '/api/yun/telemetry'
const FLUSH_INTERVAL_MS = 2000
const FLUSH_BATCH_SIZE = 20
const DISABLED_STORAGE_KEY = 'yun_telemetry_disabled'
const DEBUG_TEXT_STORAGE_KEY = 'yun_telemetry_debug_text'
const MAX_DEBUG_TEXT_LENGTH = 200

function makeId(prefix) {
  try {
    const raw = globalThis.crypto?.randomUUID?.()
    const value = raw || `${Date.now()}-${Math.random().toString(16).slice(2)}`
    return prefix ? `${prefix}_${value}` : value
  } catch {
    return `${prefix || 'id'}_${Date.now()}_${Math.random().toString(16).slice(2)}`
  }
}

function isDisabledByEnv() {
  try {
    const raw = import.meta.env.VITE_YUN_TELEMETRY_ENABLED
    return raw === '0' || raw === 'false' || raw === 'off'
  } catch {
    return false
  }
}

function isDisabledByStorage() {
  try {
    return globalThis.localStorage?.getItem(DISABLED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

// Raw text is persisted only when the explicit debug flag is on (default off).
export function isDebugTextEnabled() {
  try {
    if (import.meta.env.VITE_YUN_TELEMETRY_DEBUG_TEXT === '1') return true
    return globalThis.localStorage?.getItem(DEBUG_TEXT_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

// Privacy-safe text field: only the length by default, a truncated copy when
// debug is explicitly enabled.
export function textField(text, maxLength = MAX_DEBUG_TEXT_LENGTH) {
  const value = String(text || '')
  const field = { length: value.length }
  if (isDebugTextEnabled()) {
    field.text = value.slice(0, maxLength)
  }
  return field
}

const state = {
  enabled: !isDisabledByEnv() && !isDisabledByStorage(),
  sessionId: makeId('sess'),
  buffer: [],
  flushTimer: null,
  flushing: false,
}

function domainFor(type) {
  const domain = String(type || '').split('.')[0]
  return domain || 'unknown'
}

function scheduleFlush() {
  if (state.flushTimer || !state.enabled) return
  state.flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS)
}

function flush() {
  if (state.flushTimer) {
    clearTimeout(state.flushTimer)
    state.flushTimer = null
  }
  if (!state.enabled || state.flushing || !state.buffer.length) return

  state.flushing = true
  const events = state.buffer.splice(0, state.buffer.length)
  const body = JSON.stringify({ events })

  const finish = () => {
    state.flushing = false
    if (state.buffer.length) scheduleFlush()
  }

  try {
    fetch(TELEMETRY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {}).finally(finish)
  } catch {
    finish()
  }
}

function flushOnUnload() {
  if (!state.enabled || !state.buffer.length) return
  const events = state.buffer.splice(0, state.buffer.length)
  const body = JSON.stringify({ events })
  try {
    navigator.sendBeacon?.(TELEMETRY_ENDPOINT, new Blob([body], { type: 'application/json' }))
  } catch {
    // Telemetry is best-effort on unload.
  }
}

if (typeof globalThis.addEventListener === 'function') {
  globalThis.addEventListener('pagehide', flushOnUnload)
  globalThis.addEventListener('beforeunload', flushOnUnload)
}

function emit(type, payload = {}, opts = {}) {
  if (!state.enabled || !type) return
  try {
    const event = {
      id: makeId('evt'),
      ts: new Date().toISOString(),
      sessionId: state.sessionId,
      turnId: opts.turnId ?? null,
      domain: opts.domain || domainFor(type),
      type,
      actor: opts.actor || 'system',
      source: opts.source || 'unknown',
      payload: payload && typeof payload === 'object' ? payload : {},
      context: opts.context || {},
      meta: { app: 'yun', env: import.meta.env.MODE },
    }
    state.buffer.push(event)
    if (state.buffer.length >= FLUSH_BATCH_SIZE) flush()
    else scheduleFlush()
  } catch {
    // Telemetry must never break the app.
  }
}

const emitter = {
  emit,
  flush,
  get enabled() {
    return state.enabled
  },
  get sessionId() {
    return state.sessionId
  },
  enable() {
    state.enabled = true
    try {
      globalThis.localStorage?.removeItem(DISABLED_STORAGE_KEY)
    } catch {
      // noop
    }
  },
  disable() {
    state.enabled = false
    state.buffer.length = 0
    try {
      globalThis.localStorage?.setItem(DISABLED_STORAGE_KEY, '1')
    } catch {
      // noop
    }
  },
}

export default emitter
