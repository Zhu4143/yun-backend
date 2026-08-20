function monotonicNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export class VoiceTelemetry {
  constructor({ enabled = false, logger = console } = {}) {
    this.enabled = enabled
    this.logger = logger
    this.marks = new Map()
  }

  mark(name, metadata = {}) {
    const timestamp = monotonicNow()
    this.marks.set(name, timestamp)
    if (this.enabled) this.logger.debug('[VOICE PERF]', name, metadata)
    return timestamp
  }

  measure(name, from, to = monotonicNow(), metadata = {}) {
    const startedAt = typeof from === 'number' ? from : this.marks.get(from)
    if (startedAt == null) return null
    const durationMs = Math.max(0, to - startedAt)
    const result = { name, durationMs, ...metadata }
    if (this.enabled) this.logger.debug('[VOICE PERF]', result)
    return result
  }
}
