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
})

// Reserved for later phases: queue, lyrics, dominantColor, audioFeatures,
// and trackChangeProgress. They intentionally do not exist in Phase 1 state.

