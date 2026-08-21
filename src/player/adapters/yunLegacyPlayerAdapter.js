import { PlayerCore } from '../PlayerCore.js'
import { createPlayerStore } from '../playerStore.js'
import { INITIAL_PLAYER_STATE, PLAYER_STATUS, playerStateEquals } from '../playerTypes.js'

function deriveStatus(legacy, error) {
  if (error) return PLAYER_STATUS.ERROR
  if (!legacy.currentSong) return PLAYER_STATUS.IDLE
  if (legacy.isPlaying) return PLAYER_STATUS.PLAYING
  return legacy.duration > 0 ? PLAYER_STATUS.PAUSED : PLAYER_STATUS.READY
}

function normalizeError(result) {
  if (!result || result.ok !== false) return null
  return result.error instanceof Error
    ? result.error
    : new Error(String(result.error || 'player_action_failed'))
}

export function createYunLegacyPlayerAdapter() {
  const store = createPlayerStore(INITIAL_PLAYER_STATE)
  let legacy = null
  let pendingNotification = false
  let lastError = null

  const run = async (action) => {
    try {
      const result = await action()
      lastError = normalizeError(result)
      return result
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      throw error
    }
  }

  const controls = {
    play: () => legacy.isPlaying
      ? Promise.resolve({ ok: true, song: legacy.currentSong })
      : run(() => legacy.togglePlayPause()),
    pause: () => legacy.isPlaying
      ? run(() => legacy.pausePlayback())
      : Promise.resolve({ ok: true, song: legacy.currentSong }),
    togglePlay: () => run(() => legacy.togglePlayPause()),
    next: (options) => run(() => legacy.playNext(options)),
    previous: () => run(() => legacy.playPrevious()),
    seek: (seconds) => legacy.seekTo(seconds),
    playTrack: (track, options) => run(() => legacy.playSong(track, options)),
    playTrackFromQueue: (track, queue, options) => run(() => legacy.playSongFromQueue(track, queue, options)),
    setPlaybackQueue: (queue) => legacy.setPlaybackQueue(queue),
    clearPlaybackQueue: () => legacy.clearPlaybackQueue(),
    setQueuedNextTrack: (track) => legacy.setQueuedNextSong(track),
    enqueueUpNext: (track) => legacy.enqueueUpNext(track),
    removeUpNext: (track) => legacy.removeUpNext(track),
    clearUpNext: () => legacy.clearUpNext(),
    setAutoUpNext: (tracks, options) => legacy.setAutoUpNext(tracks, options),
    removeAutoUpNext: (track) => legacy.removeAutoUpNext(track),
    clearAutoUpNext: () => legacy.clearAutoUpNext(),
    getPlaybackDiagnostics: () => legacy.getPlaybackDiagnostics(),
    setVolume: (value) => legacy.setVolume(value),
    setPlaybackMode: (mode) => legacy.setPlaybackMode(mode),
  }

  const core = new PlayerCore({ store, controls })

  // Render-safe: derive the current legacy snapshot without rebinding controls,
  // replacing the external-store state, or notifying subscribers.
  core.projectLegacy = (nextLegacy) => {
    const userVolume = Number(nextLegacy.volume)
    const previousState = store.getState()
    const isCrossfading = Boolean(nextLegacy.getPlaybackDiagnostics?.()?.isCrossfading)
    return {
      currentTrack: nextLegacy.currentSong,
      isPlaying: nextLegacy.isPlaying,
      currentTime: nextLegacy.currentTime,
      duration: nextLegacy.duration,
      volume: Number.isFinite(userVolume) ? userVolume : previousState.volume,
      playbackMode: nextLegacy.playbackMode,
      status: deriveStatus(nextLegacy, lastError),
      error: lastError,
      queue: typeof nextLegacy.getActiveQueue === 'function' ? nextLegacy.getActiveQueue() : [],
      upNext: Array.isArray(nextLegacy.upNextTracks) ? nextLegacy.upNextTracks : [],
      autoUpNext: Array.isArray(nextLegacy.autoUpNextTracks) ? nextLegacy.autoUpNextTracks : [],
      lyrics: null,
      dominantColor: null,
      audioFeatures: null,
      trackChangeProgress: isCrossfading ? 1 : 0,
    }
  }

  // Commit-phase bridge: App calls this from a layout effect after React has
  // accepted the render that consumed the matching projected snapshot.
  core.updateLegacy = (nextLegacy, projectedState = core.projectLegacy(nextLegacy)) => {
    legacy = nextLegacy
    const previousState = store.getState()

    if (!playerStateEquals(previousState, projectedState)) {
      store.replaceState(projectedState)
      pendingNotification = true
    }

    return store.getState()
  }

  core.flush = () => {
    if (!pendingNotification) return
    pendingNotification = false
    store.emit()
  }

  core.dispose = () => {
    store.clear()
  }

  return core
}
