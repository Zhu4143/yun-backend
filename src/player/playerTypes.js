export const PLAYER_STATUS = Object.freeze({
  IDLE: 'idle',
  READY: 'ready',
  PLAYING: 'playing',
  PAUSED: 'paused',
  ERROR: 'error',
})

export const INITIAL_PLAYER_STATE = Object.freeze({
  currentTrack: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  playbackMode: 'sequence',
  status: PLAYER_STATUS.IDLE,
  error: null,
  queue: [],
  upNext: [],
  autoUpNext: [],
  lyrics: null,
  dominantColor: null,
  audioFeatures: null,
  trackChangeProgress: 0,
})

// Reference-equal comparison of two PlayerState snapshots. Arrays (`queue`,
// `upNext`, `autoUpNext`) are compared by identity, which is valid because the
// adapter bridges them straight from React/ref state that keeps a stable
// reference until it actually changes.
export function playerStateEquals(a, b) {
  return a.currentTrack === b.currentTrack
    && a.isPlaying === b.isPlaying
    && a.currentTime === b.currentTime
    && a.duration === b.duration
    && a.volume === b.volume
    && a.playbackMode === b.playbackMode
    && a.status === b.status
    && a.error === b.error
    && a.queue === b.queue
    && a.upNext === b.upNext
    && a.autoUpNext === b.autoUpNext
    && a.lyrics === b.lyrics
    && a.dominantColor === b.dominantColor
    && a.audioFeatures === b.audioFeatures
    && a.trackChangeProgress === b.trackChangeProgress
}
