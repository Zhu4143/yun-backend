function trackKey(track) {
  return String(track?.providerId || track?.id || `${track?.title || ''}-${track?.artist || ''}`)
}

// Keeps asynchronous hard-play completion scoped to the most recent request.
export class HardPlaybackRequestGate {
  constructor() {
    this.sequence = 0
    this.current = null
  }

  begin(track) {
    const request = { id: ++this.sequence, trackKey: trackKey(track) }
    this.current = request
    return request
  }

  isCurrent(request, track) {
    return this.current === request && request?.trackKey === trackKey(track)
  }

  hasCurrent() {
    return this.current !== null
  }

  clear(request) {
    if (this.current === request) this.current = null
  }
}
