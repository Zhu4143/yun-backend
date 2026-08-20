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
    setVolume: (value) => legacy.setVolume(value),
    setPlaybackMode: (mode) => legacy.setPlaybackMode(mode),
  }

  const core = new PlayerCore({ store, controls })

  core.updateLegacy = (nextLegacy) => {
    legacy = nextLegacy
    const userVolume = Number(nextLegacy.volume)
    const previousState = store.getState()
    const isCrossfading = Boolean(nextLegacy.getPlaybackDiagnostics?.()?.isCrossfading)
    const nextState = {
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

    if (!playerStateEquals(previousState, nextState)) {
      store.replaceState(nextState)
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
