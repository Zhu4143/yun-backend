import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AudioEngine } from '../player/audio/AudioEngine.js'
import {
  adjacentQueueSong,
  commitHardPlayTarget,
  createActivePlaybackRecovery,
  pauseActivePlayback,
  queuedNextTrack,
  setPlaybackModeWithQueuePolicy,
  shouldCommitHardPlayTarget,
  toggleActivePlayback,
  usesAutomaticNextQueue,
} from '../player/playback/playbackOrchestration.js'
import { CROSSFADE_DURATION, CrossfadeController } from '../player/transition/CrossfadeController.js'
import { createCrossfadeTimeline } from '../player/playback/crossfadeTimeline.js'
import { prefetchSongLyrics } from '../services/songLyrics.js'

const PLAYBACK_MODE_KEY = 'yun_playback_mode'
const PLAYBACK_MODES = ['sequence', 'loop_one', 'shuffle', 'ai_recommend', 'companion_continue']
const DEFAULT_AUTO_TAIL_SILENCE_SECONDS = 4
const SILENCE_DETECTION_LOOKAHEAD = 18000
const SILENCE_HOLD_DURATION = 900
const SILENCE_RMS_THRESHOLD = 0.006
const TAIL_SILENCE_CACHE_KEY = 'yun_tail_silence_seconds'

function getSongId(song) {
  return song?.id || `${song?.title || ''}-${song?.artist || ''}`
}

function getRecommendationKey(song) {
  return String(song?.providerId || getSongId(song) || '').replace(/^netease-/, '')
}

function getSafeDuration(audio) {
  return Number.isFinite(audio.duration) ? audio.duration : 0
}

function clampVolume(volume) {
  const value = Number(volume)

  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1
}

function getSongTailSilenceSeconds(song) {
  const value = Number(song?.tailSilenceSeconds)

  return Number.isFinite(value) && value > 0 ? value : 0
}

function getSongAudibleEndTime(song) {
  const value = Number(song?.audibleEndTime)

  return Number.isFinite(value) && value > 0 ? value : 0
}

function sameSong(a, b) {
  return Boolean(a && b && getSongId(a) === getSongId(b))
}

function getInitialPlaybackMode() {
  const savedMode = localStorage.getItem(PLAYBACK_MODE_KEY)

  return PLAYBACK_MODES.includes(savedMode) ? savedMode : 'sequence'
}

function randomSong(songs, currentSong) {
  if (!songs.length) return null
  if (songs.length === 1) return songs[0]

  const currentId = getSongId(currentSong)
  const pool = songs.filter((song) => getSongId(song) !== currentId)

  return pool[Math.floor(Math.random() * pool.length)] || songs[0]
}

function scoreRecommendedSong(song, currentSong) {
  if (!song) return 0

  const currentTags = new Set([...(currentSong?.moodTags || []), ...(currentSong?.sceneTags || [])])
  const songTags = [...(song.moodTags || []), ...(song.sceneTags || [])]
  const tagScore = songTags.reduce((score, tag) => score + (currentTags.has(tag) ? 6 : 0), 0)
  const energyGap = Math.abs((Number(song.energy) || 50) - (Number(currentSong?.energy) || 50))
  const energyScore = Math.max(0, 12 - energyGap / 5)
  const memoryScore = Math.min(10, Number(song.memoryWeight) || 0) / 2

  return tagScore + energyScore + memoryScore + Math.random() * 3
}

function recommendedSong(songs, currentSong) {
  const currentId = getSongId(currentSong)
  const pool = songs.filter((song) => getSongId(song) !== currentId)

  if (!pool.length) return songs[0] || null

  return [...pool].sort((a, b) => scoreRecommendedSong(b, currentSong) - scoreRecommendedSong(a, currentSong))[0]
}

function getInitialTailSilenceCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TAIL_SILENCE_CACHE_KEY) || '{}')

    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function useLocalPlayer(playlist, { restoreState = null } = {}) {
  const [audioEngine] = useState(() => new AudioEngine())
  const [crossfadeController] = useState(() => new CrossfadeController({ audioEngine }))
  const [activePlaybackRecovery] = useState(() => createActivePlaybackRecovery())
  const [restoreSnapshot] = useState(() => {
    const queue = Array.isArray(restoreState?.queue) ? restoreState.queue.filter((song) => song?.fileUrl) : []
    const currentTrackId = String(restoreState?.currentTrackId || '')
    const song = playlist.find((item) => getSongId(item) === currentTrackId)
      || queue.find((item) => getSongId(item) === currentTrackId)
      || (restoreState?.currentTrack?.fileUrl ? restoreState.currentTrack : null)
    return {
      queue,
      song,
      position: Math.max(0, Number(restoreState?.position) || 0),
      duration: Math.max(0, Number(restoreState?.duration) || 0),
    }
  })
  const playlistRef = useRef(playlist)
  const externalQueueRef = useRef(restoreSnapshot.queue.length ? restoreSnapshot.queue : null)
  const currentSongRef = useRef(restoreSnapshot.song)
  const requestedSongRef = useRef(restoreSnapshot.song)
  const queuedNextSongRef = useRef(null)
  const upNextTracksRef = useRef([])
  const autoUpNextTracksRef = useRef([])
  const duckTokensRef = useRef(new Map())
  const silenceStartedAtRef = useRef(0)
  const tailSilenceBySongRef = useRef(getInitialTailSilenceCache())
  const initialPlaybackMode = getInitialPlaybackMode()
  const playbackModeRef = useRef(initialPlaybackMode)

  const [currentSong, setCurrentSong] = useState(restoreSnapshot.song)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(restoreSnapshot.position)
  const [duration, setDuration] = useState(restoreSnapshot.duration)
  const [crossfadeTimeline] = useState(() => createCrossfadeTimeline({
    onTime: setCurrentTime,
    onDuration: setDuration,
  }))
  const [volume, setVolumeState] = useState(1)
  const [playbackMode, setPlaybackModeState] = useState(initialPlaybackMode)
  const [lastAutoNextSong, setLastAutoNextSong] = useState(null)
  const [upNextTracks, setUpNextTracks] = useState([])
  const [autoUpNextTracks, setAutoUpNextTracks] = useState([])
  const [audioVersion, setAudioVersion] = useState(0)

  useEffect(() => {
    playlistRef.current = playlist
  }, [playlist])

  useLayoutEffect(() => {
    const song = restoreSnapshot.song
    if (!song?.fileUrl) return undefined

    const audio = audioEngine.ensureActiveDeck()
    const restorePosition = () => {
      const safeDuration = getSafeDuration(audio)
      audio.currentTime = safeDuration
        ? Math.min(restoreSnapshot.position, safeDuration)
        : restoreSnapshot.position
      setDuration(safeDuration || restoreSnapshot.duration)
      setCurrentTime(audio.currentTime || restoreSnapshot.position)
    }
    audio.preload = 'metadata'
    audio.src = song.fileUrl
    audio.addEventListener('loadedmetadata', restorePosition, { once: true })
    audio.load()

    return () => audio.removeEventListener('loadedmetadata', restorePosition)
  }, [audioEngine, restoreSnapshot])

  const getActiveQueue = useCallback(() => (
    externalQueueRef.current?.length ? externalQueueRef.current : playlistRef.current
  ), [])

  const setPlaybackQueue = useCallback((songs) => {
    const queue = Array.isArray(songs) ? songs.filter((song) => song?.fileUrl) : []
    externalQueueRef.current = queue.length ? queue : null
  }, [])

  const clearPlaybackQueue = useCallback(() => {
    externalQueueRef.current = null
  }, [])

  const ensureActiveAudio = useCallback(() => {
    const existingDeck = audioEngine.getActiveDeck()
    const activeDeck = audioEngine.ensureActiveDeck()
    if (!existingDeck && activeDeck) setAudioVersion((version) => version + 1)
    return activeDeck
  }, [audioEngine])

  const ensureStandbyAudio = useCallback(() => {
    return audioEngine.ensureStandbyDeck()
  }, [audioEngine])

  const ensureMusicAudioGraph = useCallback((audio) => {
    return audioEngine.ensureGraphFor(audio)
  }, [audioEngine])

  // A MediaElementSource only reaches the speakers through its AudioContext.
  // `HTMLAudioElement.play()` may still resolve while that context is
  // suspended, which looks like playback in the UI but is completely silent.
  // Resume it from the same user-triggered path that starts the song.
  const resumeMusicOutput = useCallback(async (audio) => {
    return audioEngine.resumeOutput(audio)
  }, [audioEngine])

  const preloadTrack = useCallback((song) => {
    if (!song?.fileUrl || crossfadeController.isCrossfading() || sameSong(song, currentSongRef.current)) return false
    const deck = ensureStandbyAudio()
    if (deck.src !== song.fileUrl) {
      deck.pause()
      deck.src = song.fileUrl
      deck.currentTime = 0
      deck.preload = 'auto'
      deck.load()
    }
    deck.volume = 0
    ensureMusicAudioGraph(deck)
    return true
  }, [crossfadeController, ensureMusicAudioGraph, ensureStandbyAudio])

  const getEffectiveVolume = useCallback(() => (
    // Deck volumes control user volume and crossfade only. Ducking lives on
    // the shared Web Audio musicGain so it never fights deck transitions.
    clampVolume(audioEngine.getUserVolume())
  ), [audioEngine])

  const applyTransactionVolumes = useCallback(() => {
    crossfadeController.applyVolumes()
  }, [crossfadeController])

  const cancelCrossfade = useCallback(() => {
    crossfadeTimeline.clear()
    const result = crossfadeController.cancel()
    if (result.shouldRefreshActiveDeck) setAudioVersion((version) => version + 1)
    if (result.hadTransaction) {
      const activeDeck = audioEngine.getActiveDeck()
      setCurrentTime(activeDeck?.currentTime || 0)
      setDuration(getSafeDuration(activeDeck))
    }
    return result
  }, [audioEngine, crossfadeController, crossfadeTimeline])

  const setVolume = useCallback((nextVolume) => {
    const safeVolume = clampVolume(nextVolume)
    audioEngine.setUserVolume(safeVolume)
    setVolumeState(safeVolume)
    applyTransactionVolumes()
  }, [applyTransactionVolumes, audioEngine])

  const applyDuckingFactor = useCallback((targetFactor, timeConstant = 0.08) => {
    const safeTarget = clampVolume(targetFactor)
    return audioEngine.setDuckingFactor(safeTarget, timeConstant)
  }, [audioEngine])

  const musicDuckingController = useMemo(() => {
    const acquire = (token, targetFactor = 0.25, timeConstant = 0.08) => {
      if (!token) return Promise.resolve()
      duckTokensRef.current.set(token, clampVolume(targetFactor))
      return applyDuckingFactor(Math.min(...duckTokensRef.current.values()), timeConstant)
    }
    const release = (token, timeConstant = 0.5) => {
      if (token) duckTokensRef.current.delete(token)
      const next = duckTokensRef.current.size ? Math.min(...duckTokensRef.current.values()) : 1
      return applyDuckingFactor(next, timeConstant)
    }
    return {
      acquire,
      release,
      start: (targetFactor, duration = 500) => acquire('__legacy_voice_input__', targetFactor, Math.max(0.01, duration / 1000)),
      stop: (duration = 800) => release('__legacy_voice_input__', Math.max(0.01, duration / 1000)),
      cancel: async () => {
        duckTokensRef.current.clear()
        await applyDuckingFactor(1, 0.03)
        // A MediaElementSource remains routed through the AudioContext even
        // after TTS ends. If Windows suspended that context during native
        // voice playback, changing songs can look successful while the shared
        // music bus is still silent. Recovery is deliberately idempotent so
        // every TTS exit path may call it safely.
        await resumeMusicOutput(audioEngine.getActiveDeck())
        applyTransactionVolumes()
      },
      // Unlike cancel(), this preserves any newer duck token. It is used by
      // an older TTS turn finishing while another turn is already preparing.
      recoverOutput: async () => {
        await resumeMusicOutput(audioEngine.getActiveDeck())
        applyTransactionVolumes()
      },
      getUserVolume: () => audioEngine.getUserVolume(),
      getActiveTokenCount: () => duckTokensRef.current.size,
    }
  }, [applyDuckingFactor, applyTransactionVolumes, audioEngine, resumeMusicOutput])

  const resetSilenceDetection = useCallback(() => {
    silenceStartedAtRef.current = 0
  }, [])

  const rememberTailSilence = useCallback((song, seconds) => {
    const songId = getSongId(song)
    const value = Number(seconds)

    if (!songId || !Number.isFinite(value) || value < 1) {
      return
    }

    tailSilenceBySongRef.current = {
      ...tailSilenceBySongRef.current,
      [songId]: Math.min(30, value),
    }
    localStorage.setItem(TAIL_SILENCE_CACHE_KEY, JSON.stringify(tailSilenceBySongRef.current))
  }, [])

  const getTailSilenceSeconds = useCallback((song) => {
    const analyzedValue = getSongTailSilenceSeconds(song)

    if (analyzedValue > 0) {
      return analyzedValue
    }

    const value = Number(tailSilenceBySongRef.current[getSongId(song)])

    return Number.isFinite(value) && value > 0 ? value : 0
  }, [])

  const readAudioRms = useCallback((audio) => {
    if (!audio) return null

    try {
      const timeBuffer = audioEngine.readTimeDomainData(audio)
      if (!timeBuffer) return null

      let sum = 0
      for (const value of timeBuffer) {
        const centered = (value - 128) / 128
        sum += centered * centered
      }

      return Math.sqrt(sum / timeBuffer.length)
    } catch {
      return null
    }
  }, [audioEngine])

  const readAudioFrequencyData = useCallback(() => {
    const audio = audioEngine.getActiveDeck()
    if (!audio || audio.paused) {
      return null
    }

    readAudioRms(audio)
    return audioEngine.readFrequencyData(audio)
  }, [audioEngine, readAudioRms])

  const shouldStartSilenceCrossfade = useCallback((audio, safeDuration) => {
    if (!audio || !safeDuration || playbackModeRef.current === 'loop_one') {
      resetSilenceDetection()
      return false
    }

    const remainingSeconds = safeDuration - (audio.currentTime || 0)

    if (remainingSeconds <= 0 || remainingSeconds * 1000 > SILENCE_DETECTION_LOOKAHEAD) {
      resetSilenceDetection()
      return false
    }

    const rms = readAudioRms(audio)
    if (rms == null || rms > SILENCE_RMS_THRESHOLD) {
      resetSilenceDetection()
      return false
    }

    const now = performance.now()
    if (!silenceStartedAtRef.current) {
      silenceStartedAtRef.current = now
      return false
    }

    return now - silenceStartedAtRef.current >= SILENCE_HOLD_DURATION
  }, [readAudioRms, resetSilenceDetection])

  const shouldStartAudibleEndCrossfade = useCallback((audio, safeDuration) => {
    if (!audio || !safeDuration || playbackModeRef.current === 'loop_one') {
      return false
    }

    const currentSong = currentSongRef.current
    const analyzedAudibleEndTime = getSongAudibleEndTime(currentSong)
    const learnedTailSilenceSeconds = getTailSilenceSeconds(currentSong)
    const tailSilenceSeconds = learnedTailSilenceSeconds || DEFAULT_AUTO_TAIL_SILENCE_SECONDS
    const remainingSeconds = safeDuration - (audio.currentTime || 0)
    const fadeSeconds = CROSSFADE_DURATION / 1000

    if (analyzedAudibleEndTime > 0) {
      const audibleRemaining = analyzedAudibleEndTime - (audio.currentTime || 0)

      return analyzedAudibleEndTime > fadeSeconds + 1
        && audibleRemaining > 0
        && audibleRemaining <= fadeSeconds
    }

    if (tailSilenceSeconds > 0) {
      const audibleEndTime = Math.max(0, safeDuration - tailSilenceSeconds)
      const audibleRemaining = audibleEndTime - (audio.currentTime || 0)

      return audibleEndTime > fadeSeconds + 1
        && audibleRemaining > 0
        && audibleRemaining <= fadeSeconds
    }

    if (remainingSeconds > fadeSeconds || remainingSeconds <= 0) {
      return false
    }

    const rms = readAudioRms(audio)

    return rms == null || rms > SILENCE_RMS_THRESHOLD
  }, [getTailSilenceSeconds, readAudioRms])

  const playSongHard = useCallback(async (song) => {
    if (!song?.fileUrl) {
      return { ok: false, error: 'missing_file_url' }
    }

    prefetchSongLyrics(song)
    cancelCrossfade()
    const audio = ensureActiveAudio()
    const outputReady = await resumeMusicOutput(audio)
    const standbyAudio = audioEngine.getStandbyDeck()
    if (standbyAudio) {
      standbyAudio.pause()
      standbyAudio.volume = 0
      standbyAudio.removeAttribute('src')
      standbyAudio.load()
    }
    if (shouldCommitHardPlayTarget({ audio, currentSong: currentSongRef.current, song })) {
      resetSilenceDetection()
      commitHardPlayTarget({
        audio,
        song,
        effectiveVolume: getEffectiveVolume(),
        currentSongRef,
        requestedSongRef,
        setCurrentSong,
        setCurrentTime,
        setDuration,
      })
    }

    try {
      // A previous failed Range request can leave a media element in an error
      // state even though calling play() resolves. Reloading the same proxied
      // source forces a fresh request, which lets the server refresh expired
      // NetEase stream URLs.
      if (audio.error) {
        audio.load()
      }
      await audio.play()
      // Some Chromium builds defer AudioContext activation until after the
      // media element begins. Retry once here before declaring success.
      if (!outputReady) await resumeMusicOutput(audio)
      setIsPlaying(true)
      return { ok: true, song }
    } catch (error) {
      setIsPlaying(false)
      return {
        ok: false,
        song,
        error: error instanceof Error ? error.message : 'play_failed',
      }
    }
  }, [audioEngine, cancelCrossfade, ensureActiveAudio, getEffectiveVolume, resetSilenceDetection, resumeMusicOutput])

  const crossfadeToSong = useCallback(async (song, options = {}) => {
    if (!song?.fileUrl) {
      return { ok: false, error: 'missing_file_url' }
    }

    prefetchSongLyrics(song)
    cancelCrossfade()
    const fromAudio = audioEngine.getActiveDeck()
    const previousSong = currentSongRef.current

    if (!fromAudio || fromAudio.paused || !previousSong || sameSong(previousSong, song)) {
      return playSongHard(song)
    }

    resetSilenceDetection()
    const requestedTransition = playbackModeRef.current === 'companion_continue'
      ? song.transitionPlan
      : null
    const plannedTrackId = String(requestedTransition?.selectedTrackId || '').replace(/^netease-/, '')
    const songTrackId = String(song.providerId || song.id || '').replace(/^netease-/, '')
    const transitionPlan = requestedTransition && (!plannedTrackId || plannedTrackId === songTrackId)
      ? requestedTransition
      : null
    const result = await crossfadeController.startTransition({
      source: song.fileUrl,
      transitionPlan,
      shouldPromoteTarget: () => sameSong(currentSongRef.current, song),
      onPrepared: () => {
        requestedSongRef.current = song
      },
      onTargetPlaying: ({ toDeck }) => {
        currentSongRef.current = song
        crossfadeTimeline.follow(toDeck)
        setCurrentSong(song)
        setIsPlaying(true)
        if (options.autoTransition && playbackModeRef.current === 'companion_continue') {
          setLastAutoNextSong({
            id: `${getSongId(song)}-${Date.now()}`,
            song,
            previousSong,
          })
        }
      },
      onCommitted: ({ activeDeck }) => {
        crossfadeTimeline.clear()
        setCurrentTime(activeDeck.currentTime || 0)
        setDuration(getSafeDuration(activeDeck))
        resetSilenceDetection()
        setIsPlaying(true)
        setAudioVersion((version) => version + 1)
      },
      onFailed: () => {
        crossfadeTimeline.clear()
        requestedSongRef.current = currentSongRef.current
      },
    })

    return result.ok
      ? { ok: true, song }
      : { ok: false, song, error: result.error }
  }, [audioEngine, cancelCrossfade, crossfadeController, crossfadeTimeline, playSongHard, resetSilenceDetection])

  const playSong = useCallback((song, options = {}) => {
    if (!options.fromRadioQueue) queuedNextSongRef.current = null
    return options.crossfade ? crossfadeToSong(song, options) : playSongHard(song)
  }, [crossfadeToSong, playSongHard])

  const playSongFromQueue = useCallback((song, songs, options = {}) => {
    setPlaybackQueue(songs)
    return playSong(song, options)
  }, [playSong, setPlaybackQueue])

  const pausePlayback = useCallback(() => {
    pauseActivePlayback({ audioEngine, cancelTransition: cancelCrossfade })
    resetSilenceDetection()
    setIsPlaying(false)

    return { ok: true, song: currentSongRef.current }
  }, [audioEngine, cancelCrossfade, resetSilenceDetection])

  const togglePlayPause = useCallback(async () => {
    return toggleActivePlayback({
      audioEngine,
      currentSong: currentSongRef.current,
      firstSong: playlistRef.current[0],
      playSong,
      pausePlayback,
      resumeOutput: resumeMusicOutput,
      onPlaying: () => setIsPlaying(true),
      onFailed: () => setIsPlaying(false),
    })
  }, [audioEngine, pausePlayback, playSong, resumeMusicOutput])

  const getCurrentIndex = useCallback(() => {
    const currentId = getSongId(requestedSongRef.current || currentSongRef.current)
    return getActiveQueue().findIndex((song) => getSongId(song) === currentId)
  }, [getActiveQueue])

  const setQueuedNextSong = useCallback((song) => {
    queuedNextSongRef.current = song?.fileUrl ? song : null
    if (queuedNextSongRef.current) preloadTrack(queuedNextSongRef.current)
  }, [preloadTrack])

  const updateUpNextTracks = useCallback((updater) => {
    setUpNextTracks((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater
      upNextTracksRef.current = next
      return next
    })
  }, [])

  const enqueueUpNext = useCallback((song) => {
    if (!song?.fileUrl || sameSong(song, currentSongRef.current)) return
    updateUpNextTracks((current) => {
      if (current.some((item) => sameSong(item, song))) return current
      return [...current, song]
    })
  }, [updateUpNextTracks])

  const removeUpNext = useCallback((song) => {
    const key = getSongId(song)
    if (!key) return
    updateUpNextTracks((current) => current.filter((item) => getSongId(item) !== key))
  }, [updateUpNextTracks])

  const clearUpNext = useCallback(() => {
    updateUpNextTracks([])
  }, [updateUpNextTracks])

  const setAutoUpNext = useCallback((songs, options = {}) => {
    if (!usesAutomaticNextQueue(playbackModeRef.current)) return
    const manualKeys = new Set(upNextTracksRef.current.map(getRecommendationKey))
    const existingKeys = new Set(options.replace ? [] : autoUpNextTracksRef.current.map(getRecommendationKey))
    const excludedKeys = new Set([
      ...manualKeys,
      ...existingKeys,
      ...new Set(Array.isArray(options.excludeSongIds) ? options.excludeSongIds : []),
      getRecommendationKey(currentSongRef.current),
    ])
    const fresh = (Array.isArray(songs) ? songs : [])
      .filter((song) => song?.fileUrl && !sameSong(song, currentSongRef.current))
      .filter((song, index, array) => !excludedKeys.has(getRecommendationKey(song)) && array.findIndex((item) => sameSong(item, song)) === index)
    const next = [...(options.replace ? [] : autoUpNextTracksRef.current), ...fresh]
      .filter((song, index, array) => array.findIndex((item) => sameSong(item, song)) === index)
      .slice(0, Math.max(1, Number(options.maxItems) || 6))
    autoUpNextTracksRef.current = next
    setAutoUpNextTracks(next)
  }, [])

  const removeAutoUpNext = useCallback((song) => {
    const key = getSongId(song)
    if (!key) return
    setAutoUpNextTracks((current) => {
      const next = current.filter((item) => getSongId(item) !== key)
      autoUpNextTracksRef.current = next
      return next
    })
  }, [])

  const clearAutoUpNext = useCallback(() => {
    autoUpNextTracksRef.current = []
    setAutoUpNextTracks([])
  }, [])

  const playNext = useCallback(async (options = {}) => {
    const auto = options?.auto === true
    const earlyCrossfade = options?.earlyCrossfade === true
    const songs = getActiveQueue()

    if (!songs.length) {
      return { ok: false, error: 'empty_library' }
    }

    const mode = playbackModeRef.current

    if (mode === 'loop_one' && auto && currentSongRef.current) {
      return playSongHard(currentSongRef.current)
    }

    const queuedTrack = queuedNextTrack({
      mode,
      manualTracks: upNextTracksRef.current,
      automaticTracks: autoUpNextTracksRef.current,
    })
    if (queuedTrack?.queue === 'manual') {
      updateUpNextTracks((current) => current.slice(1))
      return playSong(queuedTrack.song, { crossfade: true, fromRadioQueue: true, autoTransition: auto })
    }

    if (queuedTrack?.queue === 'automatic') {
      setAutoUpNextTracks((current) => {
        const next = current.slice(1)
        autoUpNextTracksRef.current = next
        return next
      })
      return playSong(queuedTrack.song, { crossfade: true, fromRadioQueue: true, autoTransition: auto })
    }

    if (mode === 'shuffle') {
      const nextSong = randomSong(songs, currentSongRef.current)
      return nextSong ? playSong(nextSong, { crossfade: true }) : { ok: false, error: 'no_next' }
    }

    if (mode === 'ai_recommend' || mode === 'companion_continue') {
      const queuedSong = queuedNextSongRef.current
      queuedNextSongRef.current = null
      const nextSong = (queuedSong && !sameSong(queuedSong, currentSongRef.current) ? queuedSong : null)
        || recommendedSong(songs, currentSongRef.current)
        || randomSong(songs, currentSongRef.current)

      return nextSong ? playSong(nextSong, { crossfade: true, fromRadioQueue: Boolean(queuedSong), autoTransition: auto }) : { ok: false, error: 'no_next' }
    }

    const nextSong = adjacentQueueSong(songs, getCurrentIndex(), 1, mode === 'loop_one')

    if (!nextSong) {
      if (auto && !earlyCrossfade && audioEngine.getActiveDeck()) {
        const audio = audioEngine.getActiveDeck()
        audio.pause()
        audio.currentTime = getSafeDuration(audio) || audio.currentTime
      }

      return { ok: false, error: 'no_next' }
    }

    return playSong(nextSong, { crossfade: true })
  }, [audioEngine, getActiveQueue, getCurrentIndex, playSong, playSongHard, updateUpNextTracks])

  const playPrevious = useCallback(async () => {
    const songs = getActiveQueue()

    if (!songs.length) {
      return { ok: false, error: 'empty_library' }
    }

    if (playbackModeRef.current === 'shuffle' || playbackModeRef.current === 'ai_recommend' || playbackModeRef.current === 'companion_continue') {
      const previousRandomSong = randomSong(songs, currentSongRef.current)
      return previousRandomSong ? playSongHard(previousRandomSong) : { ok: false, error: 'no_previous' }
    }

    const previousSong = adjacentQueueSong(songs, getCurrentIndex(), -1, playbackModeRef.current === 'loop_one')

    if (!previousSong) {
      return { ok: false, error: 'no_previous' }
    }

    return playSongHard(previousSong)
  }, [getActiveQueue, getCurrentIndex, playSongHard])

  const seekTo = useCallback((time) => {
    cancelCrossfade()
    const audio = audioEngine.getActiveDeck()

    if (!audio) {
      return
    }

    const nextTime = Math.max(0, Math.min(time, getSafeDuration(audio)))
    audio.currentTime = nextTime
    resetSilenceDetection()
    setCurrentTime(nextTime)
  }, [audioEngine, cancelCrossfade, resetSilenceDetection])

  const setPlaybackMode = useCallback((mode) => {
    setPlaybackModeWithQueuePolicy({
      mode,
      validModes: PLAYBACK_MODES,
      playbackModeRef,
      setPlaybackModeState,
      persistPlaybackMode: (nextMode) => localStorage.setItem(PLAYBACK_MODE_KEY, nextMode),
      clearAutomaticQueue: clearAutoUpNext,
      clearQueuedNext: () => setQueuedNextSong(null),
    })
  }, [clearAutoUpNext, setQueuedNextSong])

  useEffect(() => {
    const audio = audioEngine.getActiveDeck()

    if (!audio) {
      return undefined
    }

    const handleTimeUpdate = () => {
      if (audio !== audioEngine.getActiveDeck() || crossfadeTimeline.ignores(audio)) {
        return
      }

      activePlaybackRecovery.observeProgress(audio)
      setCurrentTime(audio.currentTime || 0)
      const safeDuration = getSafeDuration(audio)
      setDuration(safeDuration)

      if (!crossfadeController.isCrossfading() && shouldStartAudibleEndCrossfade(audio, safeDuration)) {
        resetSilenceDetection()
        playNext({ auto: true, earlyCrossfade: true }).then((result) => {
          if (result?.ok && result.song && playbackModeRef.current !== 'companion_continue') {
            setLastAutoNextSong({
              id: `${getSongId(result.song)}-${Date.now()}`,
              song: result.song,
            })
          }
        })
        return
      }

      if (!crossfadeController.isCrossfading() && shouldStartSilenceCrossfade(audio, safeDuration)) {
        rememberTailSilence(currentSongRef.current, safeDuration - (audio.currentTime || 0))
        resetSilenceDetection()
        playNext({ auto: true, earlyCrossfade: true }).then((result) => {
          if (result?.ok && result.song && playbackModeRef.current !== 'companion_continue') {
            setLastAutoNextSong({
              id: `${getSongId(result.song)}-${Date.now()}`,
              song: result.song,
            })
          }
        })
      }
    }

    const handleLoadedMetadata = () => {
      if (audio !== audioEngine.getActiveDeck() || crossfadeTimeline.ignores(audio)) {
        return
      }

      setDuration(getSafeDuration(audio))
    }

    const handlePlay = () => {
      if (audio !== audioEngine.getActiveDeck()) {
        return
      }

      setIsPlaying(true)
    }

    const handlePause = () => {
      if (audio !== audioEngine.getActiveDeck()) {
        return
      }

      setIsPlaying(false)
    }

    const handleEnded = async () => {
      if (audio !== audioEngine.getActiveDeck() || crossfadeController.isCrossfading()) {
        return
      }

      setIsPlaying(false)
      const result = await playNext({ auto: true })

      if (result?.ok && result.song && playbackModeRef.current !== 'companion_continue') {
        setLastAutoNextSong({
          id: `${getSongId(result.song)}-${Date.now()}`,
          song: result.song,
        })
      }
    }

    const recoverActivePlayback = ({ force = false, delayMs } = {}) => (
      activePlaybackRecovery.schedule({
        audio,
        isActive: (candidate) => candidate === audioEngine.getActiveDeck(),
        resumeOutput: resumeMusicOutput,
        onPlaying: () => setIsPlaying(true),
        onFailed: () => setIsPlaying(false),
        force,
        delayMs,
      })
    )

    const handlePlaybackStall = () => {
      if (audio !== audioEngine.getActiveDeck() || !currentSongRef.current?.fileUrl) return
      recoverActivePlayback()
    }

    const handleError = () => {
      if (audio !== audioEngine.getActiveDeck() || !currentSongRef.current?.fileUrl) return
      setIsPlaying(false)
      recoverActivePlayback({ force: true, delayMs: 220 })
    }

    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('waiting', handlePlaybackStall)
    audio.addEventListener('stalled', handlePlaybackStall)
    audio.addEventListener('error', handleError)

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('waiting', handlePlaybackStall)
      audio.removeEventListener('stalled', handlePlaybackStall)
      audio.removeEventListener('error', handleError)
    }
  }, [activePlaybackRecovery, audioEngine, crossfadeController, crossfadeTimeline, playNext, currentSong, audioVersion, rememberTailSilence, resetSilenceDetection, resumeMusicOutput, shouldStartAudibleEndCrossfade, shouldStartSilenceCrossfade])

  useEffect(() => {
    const duckTokens = duckTokensRef.current
    // React StrictMode replays setup -> cleanup -> setup while preserving the
    // lazy controller instance. Reactivate it on every committed setup so the
    // replay cleanup cannot leave first-play cancellation permanently inert.
    crossfadeController.reactivate()

    return () => {
      crossfadeTimeline.clear()
      crossfadeController.dispose()
      duckTokens.clear()
      resetSilenceDetection()
      activePlaybackRecovery.cancel()
      audioEngine.dispose().catch(() => {})
    }
  }, [activePlaybackRecovery, audioEngine, crossfadeController, crossfadeTimeline, resetSilenceDetection])

  return {
    audioRef: audioEngine.getActiveDeckRef(),
    currentSong,
    isPlaying,
    currentTime,
    duration,
    volume,
    playbackMode,
    lastAutoNextSong,
    upNextTracks,
    autoUpNextTracks,
    playSong,
    playSongFromQueue,
    pausePlayback,
    togglePlayPause,
    playNext,
    playPrevious,
    seekTo,
    setVolume,
    musicDuckingController,
    getPlaybackDiagnostics: () => {
      const resources = audioEngine.getDiagnostics()
      const transition = crossfadeController.getDiagnostics()
      return {
        isCrossfading: transition.isCrossfading,
        activePaused: resources.activePaused,
        activeVolume: resources.activeVolume,
        standbyPaused: resources.standbyPaused,
        standbyVolume: resources.standbyVolume,
        hasCrossfadeFrame: transition.hasCrossfadeFrame,
        hasRecoveryTimer: transition.hasRecoveryTimer,
        userVolume: resources.userVolume,
        duckingFactor: resources.duckingFactor,
        audioContextState: resources.audioContextState,
        effectiveVolume: getEffectiveVolume(),
        currentTrackId: getSongId(currentSongRef.current),
        requestedTrackId: getSongId(requestedSongRef.current),
        activeSource: resources.activeSource,
        standbySource: resources.standbySource,
      }
    },
    setPlaybackMode,
    setPlaybackQueue,
    clearPlaybackQueue,
    getActiveQueue,
    setQueuedNextSong,
    enqueueUpNext,
    removeUpNext,
    clearUpNext,
    setAutoUpNext,
    removeAutoUpNext,
    clearAutoUpNext,
    preloadTrack,
    readAudioFrequencyData,
  }
}
