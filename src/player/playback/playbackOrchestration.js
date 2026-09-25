export function commitHardPlayTarget({
  audio,
  song,
  effectiveVolume,
  currentSongRef,
  requestedSongRef,
  setCurrentSong,
  setCurrentTime,
  setDuration,
}) {
  audio.pause()
  audio.src = song.fileUrl
  audio.currentTime = 0
  audio.volume = effectiveVolume
  currentSongRef.current = song
  requestedSongRef.current = song
  setCurrentSong(song)
  setCurrentTime(0)
  setDuration(0)
}

function trackKey(track) {
  return String(track?.id || `${track?.title || ''}-${track?.artist || ''}`)
}

export function adjacentQueueSong(songs, currentIndex, direction, wrap = false) {
  if (!songs?.length || (direction !== 1 && direction !== -1)) return null
  const index = currentIndex < 0 ? 0 : currentIndex + direction
  const target = wrap ? (index + songs.length) % songs.length : index
  return songs[target] || null
}

export function usesAutomaticNextQueue(mode) {
  return mode === 'ai_recommend' || mode === 'companion_continue'
}

export function queuedNextTrack({ mode, manualTracks, automaticTracks }) {
  if (manualTracks[0]) return { song: manualTracks[0], queue: 'manual' }
  if (automaticTracks[0] && usesAutomaticNextQueue(mode)) {
    return { song: automaticTracks[0], queue: 'automatic' }
  }
  return null
}

function normalizeMediaSource(source) {
  const value = String(source || '')
  if (!value) return ''

  try {
    return new URL(value, globalThis.location?.href || 'http://127.0.0.1/').href
  } catch {
    return value
  }
}

export function mediaSourceMatches(audio, source) {
  const target = normalizeMediaSource(source)
  if (!target) return false

  const candidates = [
    audio?.getAttribute?.('src'),
    audio?.currentSrc,
    audio?.src,
  ].filter(Boolean)

  return candidates.some((candidate) => normalizeMediaSource(candidate) === target)
}

export function shouldCommitHardPlayTarget({ audio, currentSong, song }) {
  return trackKey(currentSong) !== trackKey(song)
    || Boolean(audio?.error)
    || !mediaSourceMatches(audio, song?.fileUrl)
}

export async function toggleActivePlayback({
  audioEngine,
  currentSong,
  firstSong,
  playSong,
  pausePlayback,
  resumeOutput,
  onPlaying = () => {},
  onFailed = () => {},
}) {
  if (!currentSong) {
    return firstSong ? playSong(firstSong) : { ok: false, error: 'empty_library' }
  }

  const audio = audioEngine.getActiveDeck()
  if (!audio || audio.error || !mediaSourceMatches(audio, currentSong.fileUrl)) {
    return playSong(currentSong)
  }

  if (audio.paused) {
    try {
      await resumeOutput(audio)
      await audio.play()
      onPlaying()
      return { ok: true, song: currentSong }
    } catch (error) {
      onFailed()
      return {
        ok: false,
        song: currentSong,
        error: error instanceof Error ? error.message : 'play_failed',
      }
    }
  }

  return pausePlayback()
}

export function setPlaybackModeWithQueuePolicy({
  mode,
  validModes,
  playbackModeRef,
  setPlaybackModeState,
  persistPlaybackMode,
  clearAutomaticQueue = () => {},
  clearQueuedNext = () => {},
}) {
  if (!validModes.includes(mode)) return false

  const leavingAutomaticMode = usesAutomaticNextQueue(playbackModeRef.current)
    && !usesAutomaticNextQueue(mode)

  if (leavingAutomaticMode) {
    clearAutomaticQueue()
    clearQueuedNext()
  }

  playbackModeRef.current = mode
  setPlaybackModeState(mode)
  persistPlaybackMode(mode)
  return true
}

export function pauseActivePlayback({ audioEngine, cancelTransition }) {
  const cancellation = cancelTransition()
  const activeDeck = audioEngine.getActiveDeck()
  activeDeck?.pause()
  return { activeDeck, cancellation }
}

const browserRecoveryScheduler = Object.freeze({
  setTimer: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimer: (handle) => globalThis.clearTimeout(handle),
})

function mediaPosition(audio) {
  const position = Number(audio?.currentTime)
  return Number.isFinite(position) && position >= 0 ? position : 0
}

export function createActivePlaybackRecovery({
  scheduler = browserRecoveryScheduler,
  stallDelayMs = 1200,
  maxAttempts = 2,
} = {}) {
  const timers = { ...browserRecoveryScheduler, ...scheduler }
  let timer = 0
  let source = ''
  let attempts = 0
  let lastProgress = 0

  const clearScheduled = () => {
    if (!timer) return
    timers.clearTimer(timer)
    timer = 0
  }

  const observeProgress = (audio) => {
    const position = mediaPosition(audio)
    if (position <= lastProgress + 0.05) return false
    lastProgress = position
    attempts = 0
    clearScheduled()
    return true
  }

  const schedule = ({
    audio,
    isActive = () => true,
    resumeOutput = async () => {},
    onPlaying = () => {},
    onFailed = () => {},
    delayMs = stallDelayMs,
    force = false,
  } = {}) => {
    const nextSource = String(audio?.currentSrc || audio?.src || '')
    if (!audio || !nextSource || !isActive(audio) || audio.ended || (!force && audio.paused)) return false

    if (source !== nextSource) {
      source = nextSource
      attempts = 0
      lastProgress = mediaPosition(audio)
    }

    const stuckAt = mediaPosition(audio)
    clearScheduled()
    timer = timers.setTimer(async () => {
      timer = 0
      if (!isActive(audio) || audio.ended || (!force && audio.paused)) return
      if (!force && mediaPosition(audio) > stuckAt + 0.05) {
        observeProgress(audio)
        return
      }
      if (attempts >= Math.max(1, Number(maxAttempts) || 1)) {
        onFailed(new Error('media_stalled'))
        return
      }

      attempts += 1
      const resumeAt = stuckAt
      const restorePosition = () => {
        if (!isActive(audio)) return
        const duration = Number(audio.duration)
        const safePosition = Number.isFinite(duration) && duration > 0
          ? Math.min(resumeAt, Math.max(0, duration - 0.1))
          : resumeAt
        try { audio.currentTime = safePosition } catch { /* metadata is not seekable yet */ }
      }

      audio.addEventListener?.('loadedmetadata', restorePosition, { once: true })
      try {
        audio.load()
        await resumeOutput(audio)
        await audio.play()
        onPlaying()
      } catch (error) {
        audio.removeEventListener?.('loadedmetadata', restorePosition)
        onFailed(error)
      }
    }, Math.max(0, Number(delayMs) || 0))
    return true
  }

  return Object.freeze({
    schedule,
    observeProgress,
    cancel: clearScheduled,
    getDiagnostics: () => Object.freeze({
      pending: Boolean(timer),
      source,
      attempts,
      lastProgress,
    }),
  })
}
