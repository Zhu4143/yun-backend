function trackKey(track) {
  return String(track?.providerId || track?.id || `${track?.title || ''}-${track?.artist || ''}`)
}

// One epoch for every logical track replacement, regardless of whether the
// physical transition is hard or crossfaded.
export class PlaybackRequestGate {
  constructor() {
    this.sequence = 0
    this.current = null
  }

  begin(kind, track) {
    const request = { id: ++this.sequence, kind, trackKey: trackKey(track) }
    this.current = request
    return request
  }

  beginHard(track) {
    return this.begin('hard', track)
  }

  beginCrossfade(track) {
    return this.begin('crossfade', track)
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
