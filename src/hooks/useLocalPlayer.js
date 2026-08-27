import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AudioEngine } from '../player/audio/AudioEngine.js'
import { createListeningEventReporter } from '../player/listening/ListeningEventReporter.js'
import { ListeningSessionTracker } from '../player/listening/ListeningSessionTracker.js'
import { createCrossfadeListeningOwnership } from '../player/listening/CrossfadeListeningOwnership.js'
import { PauseSuppressionGate } from '../player/listening/PauseSuppressionGate.js'
import { PlaybackRequestGate } from '../player/listening/HardPlaybackRequestGate.js'
import {
  beginFreshCrossfadeRequest,
  cancelCrossfadeRequest,
  finalizeCrossfadeRequest,
} from '../player/listening/CrossfadeRequestLifecycle.js'

const PLAYBACK_MODE_KEY = 'yun_playback_mode'
const PLAYBACK_MODES = ['sequence', 'loop_one', 'shuffle', 'ai_recommend', 'companion_continue']
const CROSSFADE_DURATION = 7000
const CROSSFADE_START_VOLUME = 0.03
const MIN_CROSSFADE_DURATION = 1200
const DEFAULT_AUTO_TAIL_SILENCE_SECONDS = 4
const SILENCE_DETECTION_LOOKAHEAD = 18000
const SILENCE_HOLD_DURATION = 900
const SILENCE_RMS_THRESHOLD = 0.006
const TAIL_SILENCE_CACHE_KEY = 'yun_tail_silence_seconds'
const MIN_TRANSITION_RATE = 0.95
const MAX_TRANSITION_RATE = 1.05

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

function equalPowerFadeIn(progress) {
  return Math.sin((Math.PI / 2) * progress)
}

function equalPowerFadeOut(progress) {
  return Math.cos((Math.PI / 2) * progress)
}

function sameSong(a, b) {
  return Boolean(a && b && getSongId(a) === getSongId(b))
}

function clampTransitionRate(rate) {
  const value = Number(rate)
  return Number.isFinite(value) ? Math.max(MIN_TRANSITION_RATE, Math.min(MAX_TRANSITION_RATE, value)) : 1
}

function setDeckPlaybackRate(audio, rate) {
  if (!audio) return
  audio.preservesPitch = true
  audio.mozPreservesPitch = true
  audio.webkitPreservesPitch = true
  audio.playbackRate = clampTransitionRate(rate)
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

export function useLocalPlayer(playlist) {
  const [audioEngine] = useState(() => new AudioEngine())
  const playlistRef = useRef([])
  const externalQueueRef = useRef(null)
  const currentSongRef = useRef(null)
  const requestedSongRef = useRef(null)
  const queuedNextSongRef = useRef(null)
  const upNextTracksRef = useRef([])
  const autoUpNextTracksRef = useRef([])
  const crossfadeFrameRef = useRef(0)
  const crossfadeRecoveryTimerRef = useRef(0)
  const tempoRampFrameRef = useRef(0)
  const crossfadeTokenRef = useRef(0)
  const crossfadeTransactionRef = useRef(null)
  const crossfadePlaybackRequestRef = useRef(null)
  const standbyPlayTokenRef = useRef(0)
  const isCrossfadingRef = useRef(false)
  const duckTokensRef = useRef(new Map())
  const silenceStartedAtRef = useRef(0)
  const tailSilenceBySongRef = useRef(getInitialTailSilenceCache())
  const initialPlaybackMode = getInitialPlaybackMode()
  const playbackModeRef = useRef(initialPlaybackMode)

  const [currentSong, setCurrentSong] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState(1)
  const [playbackMode, setPlaybackModeState] = useState(initialPlaybackMode)
  const [lastAutoNextSong, setLastAutoNextSong] = useState(null)
  const [upNextTracks, setUpNextTracks] = useState([])
  const [autoUpNextTracks, setAutoUpNextTracks] = useState([])
  const [audioVersion, setAudioVersion] = useState(0)
  const mediaRecoveryRef = useRef({ source: '', attempts: 0, timer: 0 })
  const [listeningTracker] = useState(() => new ListeningSessionTracker({ reporter: createListeningEventReporter(), device: 'web' }))
  const [listeningOwnership] = useState(() => createCrossfadeListeningOwnership({ tracker: listeningTracker }))
  const [pauseSuppressionGate] = useState(() => new PauseSuppressionGate())
  const [playbackRequestGate] = useState(() => new PlaybackRequestGate())
  const listeningTrackerRef = useRef(listeningTracker)
  const listeningOwnershipRef = useRef(listeningOwnership)

  useEffect(() => {
    playlistRef.current = playlist
  }, [playlist])

  const getActiveQueue = useCallback(() => (
    externalQueueRef.current?.length ? externalQueueRef.current : playlistRef.current
  ), [])

  const setPlaybackQueue = useCallback((songs) => {
    const queue = Array.isArray(songs) ? songs.filter((song) => song?.fileUrl) : []
    externalQueueRef.current = queue.length ? queue : null
  }, [])

  const recordActualPlay = useCallback((song, audio, options = {}) => {
    if (!song || !audio) return null
    const sessionId = listeningTrackerRef.current.actualPlay(song, {
      positionMs: Math.round((audio.currentTime || 0) * 1000),
      durationMs: Math.round(getSafeDuration(audio) * 1000) || null,
      metadata: { playbackMode: playbackModeRef.current },
      ...options,
    })
    if (sessionId) listeningOwnershipRef.current.activate(audio, song)
    return sessionId
  }, [])

  const recordActualPause = useCallback((audio) => {
    if (!audio) return
    listeningTrackerRef.current.actualPause({
      positionMs: Math.round((audio.currentTime || 0) * 1000),
      durationMs: Math.round(getSafeDuration(audio) * 1000) || null,
    })
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
    if (!song?.fileUrl || isCrossfadingRef.current || sameSong(song, currentSongRef.current)) return false
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
  }, [ensureMusicAudioGraph, ensureStandbyAudio])

  const getEffectiveVolume = useCallback(() => (
    // Deck volumes control user volume and crossfade only. Ducking lives on
    // the shared Web Audio musicGain so it never fights deck transitions.
    clampVolume(audioEngine.getUserVolume())
  ), [audioEngine])

  const applyTransactionVolumes = useCallback(() => {
    const effectiveVolume = getEffectiveVolume()
    const transaction = crossfadeTransactionRef.current

    if (transaction && isCrossfadingRef.current) {
      transaction.fromAudio.volume = effectiveVolume * equalPowerFadeOut(transaction.progress)
      transaction.toAudio.volume = effectiveVolume * (
        CROSSFADE_START_VOLUME
        + (1 - CROSSFADE_START_VOLUME) * equalPowerFadeIn(transaction.progress)
      )
      return
    }

    const activeAudio = audioEngine.getActiveDeck()
    const standbyAudio = audioEngine.getStandbyDeck()
    if (activeAudio) activeAudio.volume = effectiveVolume
    if (standbyAudio) standbyAudio.volume = 0
  }, [audioEngine, getEffectiveVolume])

  const assertStableDeckState = useCallback((label) => {
    if (!import.meta.env.DEV) return
    const activeAudio = audioEngine.getActiveDeck()
    const standbyAudio = audioEngine.getStandbyDeck()
    const expectedVolume = getEffectiveVolume()
    const violations = []

    if (isCrossfadingRef.current) violations.push('crossfade flag still set')
    if (crossfadeFrameRef.current) violations.push('crossfade RAF still active')
    if (crossfadeRecoveryTimerRef.current) violations.push('recovery timer still active')
    if (activeAudio && Math.abs(activeAudio.volume - expectedVolume) > 0.001) {
      violations.push(`active volume ${activeAudio.volume} != ${expectedVolume}`)
    }
    if (standbyAudio && (!standbyAudio.paused || standbyAudio.volume !== 0)) {
      violations.push(`standby is not silent/paused (${standbyAudio.paused}, ${standbyAudio.volume})`)
    }

    if (violations.length) {
      console.error(`[player:${label}] unstable deck state`, violations)
    }
  }, [audioEngine, getEffectiveVolume])

  const cancelTempoRamp = useCallback(({ resetDecks = false } = {}) => {
    if (tempoRampFrameRef.current) {
      cancelAnimationFrame(tempoRampFrameRef.current)
      tempoRampFrameRef.current = 0
    }
    if (resetDecks) {
      setDeckPlaybackRate(audioEngine.getActiveDeck(), 1)
      setDeckPlaybackRate(audioEngine.getStandbyDeck(), 1)
    }
  }, [audioEngine])

  const rampPlaybackRate = useCallback((audio, targetRate, durationMs = 1200) => {
    if (!audio) return
    cancelTempoRamp()
    const fromRate = clampTransitionRate(audio.playbackRate)
    const toRate = clampTransitionRate(targetRate)
    const startedAt = performance.now()
    const step = (now) => {
      const progress = Math.min(1, (now - startedAt) / Math.max(160, durationMs))
      const eased = 1 - Math.pow(1 - progress, 3)
      setDeckPlaybackRate(audio, fromRate + (toRate - fromRate) * eased)
      if (progress < 1) tempoRampFrameRef.current = requestAnimationFrame(step)
      else tempoRampFrameRef.current = 0
    }
    tempoRampFrameRef.current = requestAnimationFrame(step)
  }, [cancelTempoRamp])

  const finalizePlaybackRequest = useCallback((request) => {
    finalizeCrossfadeRequest({
      request,
      playbackRequestGate,
      requestRef: crossfadePlaybackRequestRef,
    })
  }, [playbackRequestGate])

  const cancelCrossfade = useCallback(({ pauseActive = false } = {}) => {
    crossfadeTokenRef.current += 1
    cancelTempoRamp({ resetDecks: true })

    if (crossfadeFrameRef.current) {
      cancelAnimationFrame(crossfadeFrameRef.current)
      crossfadeFrameRef.current = 0
    }

    if (crossfadeRecoveryTimerRef.current) {
      window.clearTimeout(crossfadeRecoveryTimerRef.current)
      crossfadeRecoveryTimerRef.current = 0
    }

    const transaction = crossfadeTransactionRef.current
    if (transaction) {
      const { fromAudio, toAudio, song, resolve, listeningHandoff } = transaction
      const promoteTarget = sameSong(currentSongRef.current, song) && !toAudio.paused
      const activeAudio = promoteTarget ? toAudio : fromAudio
      const inactiveAudio = promoteTarget ? fromAudio : toAudio

      inactiveAudio.pause()
      inactiveAudio.volume = 0
      activeAudio.volume = getEffectiveVolume()
      if (pauseActive) activeAudio.pause()
      if (audioEngine.getActiveDeck() !== activeAudio) audioEngine.swapDecks()
      crossfadeTransactionRef.current = null
      listeningOwnershipRef.current.rollback(listeningHandoff)
      setAudioVersion((version) => version + 1)
      resolve?.({ ok: false, song, error: 'crossfade_cancelled' })
    } else {
      const activeAudio = audioEngine.getActiveDeck()
      const standbyAudio = audioEngine.getStandbyDeck()
      if (activeAudio) {
        activeAudio.volume = getEffectiveVolume()
        if (pauseActive) activeAudio.pause()
      }
      if (standbyAudio) {
        standbyAudio.volume = 0
        standbyAudio.pause()
      }
    }

    cancelCrossfadeRequest({
      transaction,
      playbackRequestGate,
      requestRef: crossfadePlaybackRequestRef,
      isCrossfadingRef,
    })
    assertStableDeckState('cancel')
  }, [assertStableDeckState, audioEngine, cancelTempoRamp, getEffectiveVolume, playbackRequestGate])

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

  const playSongHard = useCallback(async (song, options = {}) => {
    if (!song?.fileUrl) {
      return { ok: false, error: 'missing_file_url' }
    }

    const request = playbackRequestGate.beginHard(song)
    let transition = null
    const superseded = () => {
      listeningTrackerRef.current.rollbackTransition(transition || options.listeningTransition)
      playbackRequestGate.clear(request)
      return { ok: false, song, error: 'play_superseded' }
    }
    cancelCrossfade()
    const audio = ensureActiveAudio()
    let outputReady
    try {
      outputReady = await resumeMusicOutput(audio)
    } catch (error) {
      if (!playbackRequestGate.isCurrent(request, song)) return superseded()
      listeningTrackerRef.current.rollbackTransition(options.listeningTransition)
      playbackRequestGate.clear(request)
      return { ok: false, song, error: error instanceof Error ? error.message : 'play_failed' }
    }
    if (!playbackRequestGate.isCurrent(request, song)) return superseded()
    const standbyAudio = audioEngine.getStandbyDeck()
    if (standbyAudio) {
      standbyAudio.pause()
      standbyAudio.volume = 0
      standbyAudio.removeAttribute('src')
      standbyAudio.load()
    }
    const currentId = getSongId(currentSongRef.current)
    const nextId = getSongId(song)
    transition = currentId !== nextId
      ? (options.listeningTransition || listeningTrackerRef.current.prepareTransition({
        type: options.transitionType || null,
        reason: options.transitionReason || 'track_replaced',
      }))
      : null

    if (currentId === nextId && options.listeningTransition) {
      listeningTrackerRef.current.rollbackTransition(options.listeningTransition)
    }

    if (currentId !== nextId) {
      resetSilenceDetection()
      pauseSuppressionGate.arm(audio)
      audio.pause()
      listeningTrackerRef.current.freezeForReplacement(transition, {
        positionMs: Math.round((audio.currentTime || 0) * 1000),
        durationMs: Math.round(getSafeDuration(audio) * 1000) || null,
      })
      audio.src = song.fileUrl
      audio.currentTime = 0
      audio.volume = getEffectiveVolume()
      currentSongRef.current = song
      requestedSongRef.current = song
      setCurrentSong(song)
      setCurrentTime(0)
      setDuration(0)
    }

    try {
      // A previous failed Range request can leave a media element in an error
      // state even though calling play() resolves. Reloading the same proxied
      // source forces a fresh request, which lets the server refresh expired
      // NetEase stream URLs.
      if (audio.error && audio.src === song.fileUrl) {
        audio.load()
      }
      await audio.play()
      if (!playbackRequestGate.isCurrent(request, song) || audioEngine.getActiveDeck() !== audio || !sameSong(requestedSongRef.current, song) || audio.paused) return superseded()
      // Some Chromium builds defer AudioContext activation until after the
      // media element begins. Retry once here before declaring success.
      if (!outputReady) await resumeMusicOutput(audio)
      if (!playbackRequestGate.isCurrent(request, song) || audioEngine.getActiveDeck() !== audio || !sameSong(requestedSongRef.current, song)) return superseded()
      if (audio.paused) {
        if (transition) listeningTrackerRef.current.failReplacement(transition, { reason: 'replacement_interrupted' })
        playbackRequestGate.clear(request)
        setIsPlaying(false)
        return { ok: false, song, error: 'play_interrupted' }
      }
      const evidence = {
        positionMs: Math.round((audio.currentTime || 0) * 1000),
        durationMs: Math.round(getSafeDuration(audio) * 1000) || null,
        metadata: { playbackMode: playbackModeRef.current },
      }
      const sessionId = transition
        ? listeningTrackerRef.current.commitTransition(transition, song, evidence)
        : recordActualPlay(song, audio)
      if (!sessionId) return superseded()
      if (transition) listeningOwnershipRef.current.activate(audio, song)
      playbackRequestGate.clear(request)
      setIsPlaying(true)
      return { ok: true, song }
    } catch (error) {
      if (!playbackRequestGate.isCurrent(request, song)) return superseded()
      pauseSuppressionGate.arm(audio)
      audio.pause()
      if (transition) {
        listeningTrackerRef.current.failReplacement(transition)
      }
      playbackRequestGate.clear(request)
      setIsPlaying(false)
      return {
        ok: false,
        song,
        error: error instanceof Error ? error.message : 'play_failed',
      }
    }
  }, [audioEngine, cancelCrossfade, ensureActiveAudio, getEffectiveVolume, pauseSuppressionGate, playbackRequestGate, recordActualPlay, resetSilenceDetection, resumeMusicOutput])

  const crossfadeToSong = useCallback(async (song, options = {}) => {
    if (!song?.fileUrl) {
      return { ok: false, error: 'missing_file_url' }
    }

    const playbackRequest = beginFreshCrossfadeRequest({
      song,
      cancelOldCrossfade: cancelCrossfade,
      playbackRequestGate,
      requestRef: crossfadePlaybackRequestRef,
    })
    const fromAudio = audioEngine.getActiveDeck()
    const previousSong = currentSongRef.current

    if (!fromAudio || fromAudio.paused || !previousSong || sameSong(previousSong, song)) {
      return playSongHard(song, options)
    }

    resetSilenceDetection()
    isCrossfadingRef.current = true
    const token = crossfadeTokenRef.current
    const toAudio = ensureStandbyAudio()
    const requestedTransition = playbackModeRef.current === 'companion_continue'
      ? song.transitionPlan
      : null
    const plannedTrackId = String(requestedTransition?.selectedTrackId || '').replace(/^netease-/, '')
    const songTrackId = String(song.providerId || song.id || '').replace(/^netease-/, '')
    const transitionPlan = requestedTransition && (!plannedTrackId || plannedTrackId === songTrackId)
      ? requestedTransition
      : null
    try {
      await resumeMusicOutput(fromAudio)
      if (!playbackRequestGate.isCurrent(playbackRequest, song)) return { ok: false, song, error: 'crossfade_cancelled' }
      await resumeMusicOutput(toAudio)
      if (!playbackRequestGate.isCurrent(playbackRequest, song)) return { ok: false, song, error: 'crossfade_cancelled' }
    } catch (error) {
      finalizePlaybackRequest(playbackRequest)
      isCrossfadingRef.current = false
      requestedSongRef.current = currentSongRef.current
      toAudio.pause()
      toAudio.volume = 0
      return { ok: false, song, error: error instanceof Error ? error.message : 'play_failed' }
    }
    const targetVolume = getEffectiveVolume()
    const naturalFadeDuration = Math.max(
      MIN_CROSSFADE_DURATION,
      Math.min(CROSSFADE_DURATION, (getSafeDuration(fromAudio) - fromAudio.currentTime) * 1000 || CROSSFADE_DURATION),
    )
    const fadeDuration = transitionPlan
      ? Math.max(MIN_CROSSFADE_DURATION, Math.min(Number(transitionPlan.crossfadeMs) || naturalFadeDuration, naturalFadeDuration + 1800))
      : naturalFadeDuration

    toAudio.pause()
    if (toAudio.src !== song.fileUrl) {
      toAudio.src = song.fileUrl
    }
    toAudio.currentTime = transitionPlan ? Math.max(0, Math.min(0.75, Number(transitionPlan.startOffsetSec) || 0)) : 0
    if (transitionPlan) {
      setDeckPlaybackRate(toAudio, transitionPlan.toRate)
      rampPlaybackRate(fromAudio, transitionPlan.fromRate, Math.min(1800, fadeDuration * 0.36))
    } else {
      setDeckPlaybackRate(fromAudio, 1)
      setDeckPlaybackRate(toAudio, 1)
    }
    toAudio.volume = Math.min(targetVolume, targetVolume * CROSSFADE_START_VOLUME)
    requestedSongRef.current = song
    standbyPlayTokenRef.current = token
    const listeningTransition = options.listeningTransition || listeningTrackerRef.current.prepareTransition({
      type: options.transitionType || null,
      reason: options.transitionReason || 'track_replaced',
      deferUntilCommit: true,
    })
    const listeningHandoff = listeningOwnershipRef.current.prepare({
      fromDeck: fromAudio,
      toDeck: toAudio,
      track: song,
      transition: listeningTransition,
    })

    try {
      await toAudio.play()
    } catch (error) {
      listeningOwnershipRef.current.rollback(listeningHandoff)
      if (token === crossfadeTokenRef.current) {
        isCrossfadingRef.current = false
        requestedSongRef.current = currentSongRef.current
        toAudio.volume = 0
        toAudio.pause()
      }
      finalizePlaybackRequest(playbackRequest)
      return {
        ok: false,
        song,
        error: error instanceof Error ? error.message : 'play_failed',
      }
    }

    if (token !== crossfadeTokenRef.current || !playbackRequestGate.isCurrent(playbackRequest, song)) {
      listeningOwnershipRef.current.rollback(listeningHandoff)
      if (audioEngine.getStandbyDeck() === toAudio && standbyPlayTokenRef.current === token) {
        toAudio.volume = 0
        toAudio.pause()
      }
      return { ok: false, song, error: 'crossfade_cancelled' }
    }

    return new Promise((resolve) => {
      const startedAt = performance.now()
      let finished = false
      const finish = () => {
        if (finished || token !== crossfadeTokenRef.current || !playbackRequestGate.isCurrent(playbackRequest, song)) return
        resetSilenceDetection()
        finished = true
        if (crossfadeRecoveryTimerRef.current) {
          window.clearTimeout(crossfadeRecoveryTimerRef.current)
          crossfadeRecoveryTimerRef.current = 0
        }
        crossfadeFrameRef.current = 0
        isCrossfadingRef.current = false
        pauseSuppressionGate.arm(fromAudio)
        fromAudio.pause()
        fromAudio.currentTime = 0
        fromAudio.volume = 0
        setDeckPlaybackRate(fromAudio, 1)
        toAudio.volume = getEffectiveVolume()
        audioEngine.swapDecks()
        crossfadeTransactionRef.current = null
        currentSongRef.current = song
        setCurrentSong(song)
        setCurrentTime(toAudio.currentTime || 0)
        setDuration(getSafeDuration(toAudio))
        listeningOwnershipRef.current.commit(listeningHandoff, {
          positionMs: Math.round((toAudio.currentTime || 0) * 1000),
          durationMs: Math.round(getSafeDuration(toAudio) * 1000) || null,
          metadata: { playbackMode: playbackModeRef.current },
        })
        finalizePlaybackRequest(playbackRequest)
        setIsPlaying(true)
        setAudioVersion((version) => version + 1)
        if (transitionPlan) {
          // Hold the beat match through the blend, then return imperceptibly
          // to the song's native tempo. The ramp is interruptible by any user
          // skip, pause, or later transition.
          rampPlaybackRate(toAudio, 1, Number(transitionPlan.restoreDurationMs) || 9000)
        } else {
          setDeckPlaybackRate(toAudio, 1)
        }
        assertStableDeckState('finish')
        resolve({ ok: true, song })
      }

      const step = (now) => {
        if (token !== crossfadeTokenRef.current) {
          return
        }

        const progress = Math.min(1, (now - startedAt) / fadeDuration)
        const fadeOut = equalPowerFadeOut(progress)
        const fadeIn = equalPowerFadeIn(progress)
        const audibleFadeIn = CROSSFADE_START_VOLUME + (1 - CROSSFADE_START_VOLUME) * fadeIn
        const transaction = crossfadeTransactionRef.current
        if (!transaction || transaction.token !== token) return
        transaction.progress = progress
        const effectiveVolume = getEffectiveVolume()
        fromAudio.volume = effectiveVolume * fadeOut
        toAudio.volume = Math.min(effectiveVolume, effectiveVolume * audibleFadeIn)

        if (progress < 1) {
          crossfadeFrameRef.current = requestAnimationFrame(step)
          return
        }

        finish()
      }

      crossfadeTransactionRef.current = {
        token,
        fromAudio,
        toAudio,
        song,
        progress: 0,
        listeningHandoff,
        playbackRequest,
        resolve,
      }
      crossfadeRecoveryTimerRef.current = window.setTimeout(() => {
        if (token === crossfadeTokenRef.current && audioEngine.getStandbyDeck() === toAudio) {
          finish()
        }
      }, fadeDuration + 350)

      crossfadeFrameRef.current = requestAnimationFrame(step)
    })
  }, [assertStableDeckState, audioEngine, cancelCrossfade, ensureStandbyAudio, finalizePlaybackRequest, getEffectiveVolume, pauseSuppressionGate, playbackRequestGate, playSongHard, rampPlaybackRate, resetSilenceDetection, resumeMusicOutput])

  const playSong = useCallback((song, options = {}) => {
    if (!options.fromRadioQueue) queuedNextSongRef.current = null
    return options.crossfade ? crossfadeToSong(song, options) : playSongHard(song, options)
  }, [crossfadeToSong, playSongHard])

  const playSongFromQueue = useCallback((song, songs, options = {}) => {
    setPlaybackQueue(songs)
    return playSong(song, options)
  }, [playSong, setPlaybackQueue])

  const pausePlayback = useCallback(() => {
    cancelCrossfade({ pauseActive: true })
    resetSilenceDetection()
    recordActualPause(audioEngine.getActiveDeck())
    setIsPlaying(false)

    return { ok: true, song: currentSongRef.current }
  }, [audioEngine, cancelCrossfade, recordActualPause, resetSilenceDetection])

  const togglePlayPause = useCallback(async () => {
    const audio = audioEngine.getActiveDeck()

    if (!currentSongRef.current) {
      const firstSong = playlistRef.current[0]
      return firstSong ? playSong(firstSong) : { ok: false, error: 'empty_library' }
    }

    if (!audio) {
      return { ok: false, error: 'missing_audio' }
    }

    if (audio.paused) {
      try {
        await resumeMusicOutput(audio)
        await audio.play()
        recordActualPlay(currentSongRef.current, audio)
        setIsPlaying(true)
        return { ok: true, song: currentSongRef.current }
      } catch (error) {
        setIsPlaying(false)
        return {
          ok: false,
          song: currentSongRef.current,
          error: error instanceof Error ? error.message : 'play_failed',
        }
      }
    }

    return pausePlayback()
  }, [audioEngine, pausePlayback, playSong, recordActualPlay, resumeMusicOutput])

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
    const transitionForNext = () => listeningTrackerRef.current.prepareTransition({
      type: auto ? null : 'next',
      reason: auto ? 'natural_end' : 'user_next',
      deferUntilCommit: true,
    })
    const songs = getActiveQueue()

    if (!songs.length) {
      return { ok: false, error: 'empty_library' }
    }

    const mode = playbackModeRef.current

    if (mode === 'loop_one' && currentSongRef.current) {
      return playSongHard(currentSongRef.current)
    }

    const manualQueuedSong = upNextTracksRef.current[0]
    if (manualQueuedSong) {
      updateUpNextTracks((current) => current.slice(1))
      return playSong(manualQueuedSong, { crossfade: true, fromRadioQueue: true, transitionReason: auto ? 'natural_end' : 'user_next', listeningTransition: transitionForNext() })
    }

    const automaticQueuedSong = autoUpNextTracksRef.current[0]
    if (automaticQueuedSong) {
      setAutoUpNextTracks((current) => {
        const next = current.slice(1)
        autoUpNextTracksRef.current = next
        return next
      })
      return playSong(automaticQueuedSong, { crossfade: true, fromRadioQueue: true, transitionReason: auto ? 'natural_end' : 'user_next', listeningTransition: transitionForNext() })
    }

    if (mode === 'shuffle') {
      const nextSong = randomSong(songs, currentSongRef.current)
      return nextSong ? playSong(nextSong, { crossfade: true, transitionReason: auto ? 'natural_end' : 'user_next', listeningTransition: transitionForNext() }) : { ok: false, error: 'no_next' }
    }

    if (mode === 'ai_recommend' || mode === 'companion_continue') {
      const queuedSong = queuedNextSongRef.current
      queuedNextSongRef.current = null
      const nextSong = (queuedSong && !sameSong(queuedSong, currentSongRef.current) ? queuedSong : null)
        || recommendedSong(songs, currentSongRef.current)
        || randomSong(songs, currentSongRef.current)

      return nextSong ? playSong(nextSong, { crossfade: true, fromRadioQueue: Boolean(queuedSong), transitionReason: auto ? 'natural_end' : 'user_next', listeningTransition: transitionForNext() }) : { ok: false, error: 'no_next' }
    }

    const currentIndex = getCurrentIndex()
    const nextIndex = currentIndex < 0 ? 0 : currentIndex + 1

    if (nextIndex >= songs.length) {
      if (auto && !earlyCrossfade && audioEngine.getActiveDeck()) {
        const audio = audioEngine.getActiveDeck()
        audio.pause()
        audio.currentTime = getSafeDuration(audio) || audio.currentTime
      }

      return { ok: false, error: 'no_next' }
    }

    return playSong(songs[nextIndex], { crossfade: true, transitionReason: auto ? 'natural_end' : 'user_next', listeningTransition: transitionForNext() })
  }, [audioEngine, getActiveQueue, getCurrentIndex, playSong, playSongHard, updateUpNextTracks])

  const playPrevious = useCallback(async () => {
    const songs = getActiveQueue()

    if (!songs.length) {
      return { ok: false, error: 'empty_library' }
    }

    if (playbackModeRef.current === 'shuffle' || playbackModeRef.current === 'ai_recommend' || playbackModeRef.current === 'companion_continue') {
      const previousRandomSong = randomSong(songs, currentSongRef.current)
      const listeningTransition = previousRandomSong
        ? listeningTrackerRef.current.prepareTransition({ type: 'previous', reason: 'user_previous' })
        : null
      return previousRandomSong ? playSongHard(previousRandomSong, { transitionType: 'previous', transitionReason: 'user_previous', listeningTransition }) : { ok: false, error: 'no_previous' }
    }

    const currentIndex = getCurrentIndex()
    const previousIndex =
      currentIndex < 0 ? 0 : currentIndex - 1

    if (previousIndex < 0) {
      return { ok: false, error: 'no_previous' }
    }

    const listeningTransition = listeningTrackerRef.current.prepareTransition({ type: 'previous', reason: 'user_previous' })
    return playSongHard(songs[previousIndex], { transitionType: 'previous', transitionReason: 'user_previous', listeningTransition })
  }, [getActiveQueue, getCurrentIndex, playSongHard])

  const seekTo = useCallback((time) => {
    cancelCrossfade()
    const audio = audioEngine.getActiveDeck()

    if (!audio) {
      return
    }

    const previousTime = audio.currentTime || 0
    const nextTime = Math.max(0, Math.min(time, getSafeDuration(audio)))
    audio.currentTime = nextTime
    listeningTrackerRef.current.seek(previousTime * 1000, nextTime * 1000, getSafeDuration(audio) * 1000)
    resetSilenceDetection()
    setCurrentTime(nextTime)
  }, [audioEngine, cancelCrossfade, resetSilenceDetection])

  const setPlaybackMode = useCallback((mode) => {
    if (!PLAYBACK_MODES.includes(mode)) {
      return
    }

    playbackModeRef.current = mode
    setPlaybackModeState(mode)
    localStorage.setItem(PLAYBACK_MODE_KEY, mode)
  }, [])

  useEffect(() => {
    const audio = audioEngine.getActiveDeck()

    if (!audio) {
      return undefined
    }

    const handleTimeUpdate = () => {
      if (audio !== audioEngine.getActiveDeck()) {
        return
      }

      setCurrentTime(audio.currentTime || 0)
      const safeDuration = getSafeDuration(audio)
      setDuration(safeDuration)
      listeningOwnershipRef.current.position(audio, (audio.currentTime || 0) * 1000)

      if (!isCrossfadingRef.current && shouldStartAudibleEndCrossfade(audio, safeDuration)) {
        resetSilenceDetection()
        playNext({ auto: true, earlyCrossfade: true }).then((result) => {
          if (result?.ok && result.song) {
            setLastAutoNextSong({
              id: `${getSongId(result.song)}-${Date.now()}`,
              song: result.song,
            })
          }
        })
        return
      }

      if (!isCrossfadingRef.current && shouldStartSilenceCrossfade(audio, safeDuration)) {
        rememberTailSilence(currentSongRef.current, safeDuration - (audio.currentTime || 0))
        resetSilenceDetection()
        playNext({ auto: true, earlyCrossfade: true }).then((result) => {
          if (result?.ok && result.song) {
            setLastAutoNextSong({
              id: `${getSongId(result.song)}-${Date.now()}`,
              song: result.song,
            })
          }
        })
      }
    }

    const handleLoadedMetadata = () => {
      if (audio !== audioEngine.getActiveDeck()) {
        return
      }

      setDuration(getSafeDuration(audio))
    }

    const handlePlay = () => {
      if (audio !== audioEngine.getActiveDeck()) {
        return
      }

      // The hard-play call commits the exact transition after its promise and
      // target guards settle. Do not let the media event consume a pending
      // transition before then.
      if (playbackRequestGate.hasCurrent()) return

      setIsPlaying(true)
      recordActualPlay(currentSongRef.current, audio)
    }

    const handlePause = () => {
      if (pauseSuppressionGate.consume(audio)) return
      if (audio !== audioEngine.getActiveDeck()) {
        return
      }

      setIsPlaying(false)
      recordActualPause(audio)
    }

    const handleEnded = async () => {
      if (audio !== audioEngine.getActiveDeck() || isCrossfadingRef.current) {
        return
      }

      listeningTrackerRef.current.actualEnded({
        positionMs: Math.round((audio.currentTime || 0) * 1000),
        durationMs: Math.round(getSafeDuration(audio) * 1000) || null,
      })
      setIsPlaying(false)
      const result = await playNext({ auto: true })

      if (result?.ok && result.song) {
        setLastAutoNextSong({
          id: `${getSongId(result.song)}-${Date.now()}`,
          song: result.song,
        })
      }
    }

    const handleError = () => {
      if (audio !== audioEngine.getActiveDeck() || !currentSongRef.current?.fileUrl) return
      setIsPlaying(false)
      const source = audio.currentSrc || audio.src || ''
      const recovery = mediaRecoveryRef.current
      if (recovery.source !== source) {
        recovery.source = source
        recovery.attempts = 0
      }
      if (recovery.attempts >= 1) return
      recovery.attempts += 1
      window.clearTimeout(recovery.timer)
      recovery.timer = window.setTimeout(() => {
        if (audio !== audioEngine.getActiveDeck() || !audio.paused) return
        audio.load()
        resumeMusicOutput(audio).then(() => audio.play()).then(() => setIsPlaying(true)).catch(() => setIsPlaying(false))
      }, 220)
    }

    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('error', handleError)

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('error', handleError)
    }
  }, [audioEngine, pauseSuppressionGate, playbackRequestGate, playNext, currentSong, audioVersion, rememberTailSilence, recordActualPause, recordActualPlay, resetSilenceDetection, resumeMusicOutput, shouldStartAudibleEndCrossfade, shouldStartSilenceCrossfade])

  useEffect(() => () => {
    cancelCrossfade()
    cancelTempoRamp({ resetDecks: true })
    duckTokensRef.current.clear()
    resetSilenceDetection()
    audioEngine.dispose().catch(() => {})
    window.clearTimeout(mediaRecoveryRef.current.timer)
  }, [audioEngine, cancelCrossfade, cancelTempoRamp, resetSilenceDetection])

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
      return {
        isCrossfading: isCrossfadingRef.current,
        activePaused: resources.activePaused,
        activeVolume: resources.activeVolume,
        standbyPaused: resources.standbyPaused,
        standbyVolume: resources.standbyVolume,
        hasCrossfadeFrame: Boolean(crossfadeFrameRef.current),
        hasRecoveryTimer: Boolean(crossfadeRecoveryTimerRef.current),
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
