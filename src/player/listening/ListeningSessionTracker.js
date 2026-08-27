const SEEK_THRESHOLD_MS = 1500

function randomId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function value(value, fallback = null) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function trackKey(track) {
  return String(track?.providerId || track?.id || `${track?.title || ''}-${track?.artist || ''}`)
}

function canonicalTrack(track = {}) {
  const trackId = String(track.id || track.trackId || track.providerId || '').trim()
  return {
    trackId,
    providerId: String(track.providerId || '').trim() || null,
    source: String(track.source || 'local').trim() || 'local',
    title: String(track.title || track.name || '').trim() || null,
    artist: String(track.artist || '').trim() || null,
    album: String(track.album || '').trim() || null,
    durationMs: value(track.durationMs ?? track.duration, null),
  }
}

// Owns only one logical listening lifecycle. Media elements and PlayerCore
// remain the playback authorities; callers feed this tracker confirmed media
// transitions and explicit user intent.
export class ListeningSessionTracker {
  constructor({ reporter, now = () => Date.now(), idFactory = randomId, device = 'web' } = {}) {
    if (!reporter?.report) throw new Error('listening_event_reporter_required')
    this.reporter = reporter
    this.now = now
    this.idFactory = idFactory
    this.device = device
    this.session = null
    this.pendingTransition = null
    this.lastCompleted = null
    this.ignoreNextPause = false
  }

  transitionIntent(type, reason = type === 'previous' ? 'user_previous' : 'user_next') {
    if (!this.session || !['next', 'previous'].includes(type)) return
    this.pendingTransition = { type, reason }
  }

  naturalCrossfade() {
    if (this.session) this.pendingTransition = { type: null, reason: 'natural_end' }
  }

  suppressNextPause() {
    this.ignoreNextPause = true
  }

  actualPlay(track, { positionMs = 0, durationMs = null, metadata = {} } = {}) {
    const nextKey = trackKey(track)
    if (!nextKey) return null
    const now = this.now()
    // A synchronous media pause from replacing the prior source may not fire
    // in every browser; never let that one-shot guard leak into this session.
    this.ignoreNextPause = false
    if (this.session && this.session.trackKey === nextKey) {
      if (!this.session.playing) {
        this.session.playing = true
        this.session.playingSince = now
        this.session.positionMs = value(positionMs, this.session.positionMs)
        this.emit('resume', { positionMs: this.session.positionMs, durationMs, metadata })
      }
      return this.session.sessionId
    }

    const previous = this.session
    const transition = this.pendingTransition
    this.pendingTransition = null
    if (previous) {
      this.finishInterval(now)
      if (transition?.type) this.emit(transition.type, { metadata: { reason: transition.reason } })
      this.emit(transition?.reason === 'natural_end' ? 'complete' : 'skip', {
        positionMs: previous.positionMs,
        durationMs: previous.track.durationMs,
        metadata: this.terminalMetadata(transition?.reason || 'track_replaced'),
      })
      if (transition?.reason === 'natural_end') this.lastCompleted = { sessionId: previous.sessionId, trackKey: previous.trackKey }
      this.session = null
    }

    this.session = {
      sessionId: `listening-${this.idFactory()}`,
      sequence: 0,
      track: canonicalTrack({ ...track, durationMs: durationMs ?? track.durationMs }),
      trackKey: nextKey,
      positionMs: value(positionMs, 0),
      playing: true,
      playingSince: now,
      listenDurationMs: 0,
    }
    this.emit('play', { positionMs: this.session.positionMs, durationMs, metadata })
    if (this.lastCompleted?.trackKey === nextKey) {
      this.emit('repeat', { metadata: { previousSessionId: this.lastCompleted.sessionId, newSessionId: this.session.sessionId } })
    }
    this.lastCompleted = null
    return this.session.sessionId
  }

  actualPause({ positionMs = null, durationMs = null } = {}) {
    if (this.ignoreNextPause) {
      this.ignoreNextPause = false
      return
    }
    if (!this.session || !this.session.playing) return
    const now = this.now()
    this.finishInterval(now)
    this.session.playing = false
    this.session.positionMs = value(positionMs, this.session.positionMs)
    this.emit('pause', { positionMs: this.session.positionMs, durationMs })
  }

  position(positionMs) {
    if (this.session) this.session.positionMs = value(positionMs, this.session.positionMs)
  }

  seek(fromMs, toMs, durationMs = null) {
    if (!this.session) return
    const from = value(fromMs, this.session.positionMs)
    const to = value(toMs, from)
    if (Math.abs(to - from) < SEEK_THRESHOLD_MS) return this.position(to)
    const now = this.now()
    this.finishInterval(now)
    this.session.positionMs = to
    if (this.session.playing) this.session.playingSince = now
    this.emit('seek', { positionMs: to, durationMs, metadata: { fromMs: from, toMs: to, direction: to >= from ? 'forward' : 'backward' } })
  }

  actualEnded({ positionMs = null, durationMs = null } = {}) {
    if (!this.session) return
    const now = this.now()
    this.finishInterval(now)
    this.session.positionMs = value(positionMs, this.session.track.durationMs ?? durationMs)
    this.emit('complete', { positionMs: this.session.positionMs, durationMs, metadata: this.terminalMetadata('natural_end') })
    this.lastCompleted = { sessionId: this.session.sessionId, trackKey: this.session.trackKey }
    this.session = null
    this.pendingTransition = null
  }

  terminalMetadata(reason) {
    const duration = this.session?.track.durationMs
    const position = this.session?.positionMs || 0
    return {
      reason,
      listenDurationMs: Math.max(0, Math.round(this.session?.listenDurationMs || 0)),
      completionRatio: duration && duration > 0 ? Math.max(0, Math.min(1, position / duration)) : null,
    }
  }

  finishInterval(now) {
    if (!this.session?.playing || this.session.playingSince == null) return
    this.session.listenDurationMs += Math.max(0, now - this.session.playingSince)
    this.session.playingSince = null
  }

  emit(type, { positionMs = null, durationMs = null, metadata = {} } = {}) {
    if (!this.session) return
    const track = this.session.track
    if (!track.trackId) return
    const sequence = ++this.session.sequence
    this.reporter.report({
      id: `${this.session.sessionId}:${sequence}`,
      type,
      ...track,
      positionMs: value(positionMs, this.session.positionMs),
      durationMs: value(durationMs, track.durationMs),
      timestamp: new Date(this.now()).toISOString(),
      device: this.device,
      sessionId: this.session.sessionId,
      metadata,
    })
  }
}
