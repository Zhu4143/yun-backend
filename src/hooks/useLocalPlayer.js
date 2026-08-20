import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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

function getAudioContext() {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext

  return AudioContextConstructor ? new AudioContextConstructor() : null
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
  const audioRef = useRef(null)
  const standbyAudioRef = useRef(null)
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
  const standbyPlayTokenRef = useRef(0)
  const isCrossfadingRef = useRef(false)
  const userVolumeRef = useRef(1)
  const duckingFactorRef = useRef(1)
  const analyserByAudioRef = useRef(new WeakMap())
  const audioGraphRef = useRef(null)
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

  const clearPlaybackQueue = useCallback(() => {
    externalQueueRef.current = null
  }, [])

  const ensureActiveAudio = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio()
      setAudioVersion((version) => version + 1)
    }

    return audioRef.current
  }, [])

  const ensureStandbyAudio = useCallback(() => {
    if (!standbyAudioRef.current) {
      standbyAudioRef.current = new Audio()
    }

    return standbyAudioRef.current
  }, [])

  const ensureMusicAudioGraph = useCallback((audio) => {
    if (!audio || typeof window === 'undefined') return null

    try {
      if (!audioGraphRef.current) {
        const context = getAudioContext()
        if (!context) return null
        const masterGain = context.createGain()
        const musicGain = context.createGain()
        musicGain.gain.value = duckingFactorRef.current
        musicGain.connect(masterGain)
        masterGain.connect(context.destination)
        audioGraphRef.current = { context, masterGain, musicGain }
      }

      const graph = audioGraphRef.current
      let entry = analyserByAudioRef.current.get(audio)
      if (!entry) {
        const source = graph.context.createMediaElementSource(audio)
        const analyser = graph.context.createAnalyser()
        analyser.fftSize = 1024
        analyser.smoothingTimeConstant = 0.72
        source.connect(analyser)
        analyser.connect(graph.musicGain)
        entry = {
          source,
          analyser,
          frequencyBuffer: new Uint8Array(analyser.frequencyBinCount),
          timeBuffer: new Uint8Array(analyser.fftSize),
        }
        analyserByAudioRef.current.set(audio, entry)
      }
      return { graph, entry }
    } catch {
      // Playback must keep working even if an embedded Chromium build rejects
      // MediaElementSource for a particular element.
      return null
    }
  }, [])

  // A MediaElementSource only reaches the speakers through its AudioContext.
  // `HTMLAudioElement.play()` may still resolve while that context is
  // suspended, which looks like playback in the UI but is completely silent.
  // Resume it from the same user-triggered path that starts the song.
  const resumeMusicOutput = useCallback(async (audio) => {
    const attached = ensureMusicAudioGraph(audio)
    const graph = attached?.graph
    if (!graph?.context) return true

    try {
      if (graph.context.state !== 'running') await graph.context.resume()
      const now = graph.context.currentTime
      graph.musicGain.gain.cancelScheduledValues(now)
      graph.musicGain.gain.setValueAtTime(duckingFactorRef.current, now)
      return graph.context.state === 'running'
    } catch (error) {
      console.warn('[player] unable to resume music output', error)
      return false
    }
  }, [ensureMusicAudioGraph])

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
    clampVolume(userVolumeRef.current)
  ), [])

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

    if (audioRef.current) audioRef.current.volume = effectiveVolume
    if (standbyAudioRef.current) standbyAudioRef.current.volume = 0
  }, [getEffectiveVolume])

  const assertStableDeckState = useCallback((label) => {
    if (!import.meta.env.DEV) return
    const activeAudio = audioRef.current
    const standbyAudio = standbyAudioRef.current
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
  }, [getEffectiveVolume])

  const cancelTempoRamp = useCallback(({ resetDecks = false } = {}) => {
    if (tempoRampFrameRef.current) {
      cancelAnimationFrame(tempoRampFrameRef.current)
      tempoRampFrameRef.current = 0
    }
    if (resetDecks) {
      setDeckPlaybackRate(audioRef.current, 1)
      setDeckPlaybackRate(standbyAudioRef.current, 1)
    }
  }, [])

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
      const { fromAudio, toAudio, song, resolve } = transaction
      const promoteTarget = sameSong(currentSongRef.current, song) && !toAudio.paused
      const activeAudio = promoteTarget ? toAudio : fromAudio
      const inactiveAudio = promoteTarget ? fromAudio : toAudio

      inactiveAudio.pause()
      inactiveAudio.volume = 0
      activeAudio.volume = getEffectiveVolume()
      if (pauseActive) activeAudio.pause()
      audioRef.current = activeAudio
      standbyAudioRef.current = inactiveAudio
      crossfadeTransactionRef.current = null
      setAudioVersion((version) => version + 1)
      resolve?.({ ok: false, song, error: 'crossfade_cancelled' })
    } else {
      if (audioRef.current) {
        audioRef.current.volume = getEffectiveVolume()
        if (pauseActive) audioRef.current.pause()
      }
      if (standbyAudioRef.current) {
        standbyAudioRef.current.volume = 0
        standbyAudioRef.current.pause()
      }
    }

    isCrossfadingRef.current = false
    assertStableDeckState('cancel')
  }, [assertStableDeckState, cancelTempoRamp, getEffectiveVolume])

  const setVolume = useCallback((nextVolume) => {
    const safeVolume = clampVolume(nextVolume)
    userVolumeRef.current = safeVolume
    setVolumeState(safeVolume)
    applyTransactionVolumes()
  }, [applyTransactionVolumes])

  const applyDuckingFactor = useCallback((targetFactor, timeConstant = 0.08) => {
    const safeTarget = clampVolume(targetFactor)
    duckingFactorRef.current = safeTarget
    const attached = ensureMusicAudioGraph(audioRef.current)
    const gain = attached?.graph?.musicGain?.gain
    const context = attached?.graph?.context
    if (gain && context) {
      gain.cancelScheduledValues(context.currentTime)
      gain.setTargetAtTime(safeTarget, context.currentTime, Math.max(0.01, timeConstant))
    }
    return Promise.resolve()
  }, [ensureMusicAudioGraph])

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
        await resumeMusicOutput(audioRef.current)
        applyTransactionVolumes()
      },
      // Unlike cancel(), this preserves any newer duck token. It is used by
      // an older TTS turn finishing while another turn is already preparing.
      recoverOutput: async () => {
        await resumeMusicOutput(audioRef.current)
        applyTransactionVolumes()
      },
      getUserVolume: () => userVolumeRef.current,
      getActiveTokenCount: () => duckTokensRef.current.size,
    }
  }, [applyDuckingFactor, applyTransactionVolumes, resumeMusicOutput])

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
    if (!audio || typeof window === 'undefined') {
      return null
    }

    try {
      const entry = ensureMusicAudioGraph(audio)?.entry
      if (!entry) return null

      entry.analyser.getByteTimeDomainData(entry.timeBuffer)

      let sum = 0
      for (const value of entry.timeBuffer) {
        const centered = (value - 128) / 128
        sum += centered * centered
      }

      return Math.sqrt(sum / entry.timeBuffer.length)
    } catch {
      return null
    }
  }, [ensureMusicAudioGraph])

  const readAudioFrequencyData = useCallback(() => {
    const audio = audioRef.current
    if (!audio || audio.paused) {
      return null
    }

    readAudioRms(audio)

    const entry = analyserByAudioRef.current.get(audio)
    if (!entry) {
      return null
    }

    entry.analyser.getByteFrequencyData(entry.frequencyBuffer)

    return entry.frequencyBuffer
  }, [readAudioRms])

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

    cancelCrossfade()
    const audio = ensureActiveAudio()
    const outputReady = await resumeMusicOutput(audio)
    const standbyAudio = standbyAudioRef.current
    if (standbyAudio) {
      standbyAudio.pause()
      standbyAudio.volume = 0
      standbyAudio.removeAttribute('src')
      standbyAudio.load()
    }
    const currentId = getSongId(currentSongRef.current)
    const nextId = getSongId(song)

    if (currentId !== nextId) {
      resetSilenceDetection()
      audio.pause()
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
  }, [cancelCrossfade, ensureActiveAudio, getEffectiveVolume, resetSilenceDetection, resumeMusicOutput])

  const crossfadeToSong = useCallback(async (song) => {
    if (!song?.fileUrl) {
      return { ok: false, error: 'missing_file_url' }
    }

    cancelCrossfade()
    const fromAudio = audioRef.current
    const previousSong = currentSongRef.current

    if (!fromAudio || fromAudio.paused || !previousSong || sameSong(previousSong, song)) {
      return playSongHard(song)
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
    await resumeMusicOutput(fromAudio)
    await resumeMusicOutput(toAudio)
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

    try {
      await toAudio.play()
    } catch (error) {
      if (token === crossfadeTokenRef.current) {
        isCrossfadingRef.current = false
        requestedSongRef.current = currentSongRef.current
        toAudio.volume = 0
        toAudio.pause()
      }
      return {
        ok: false,
        song,
        error: error instanceof Error ? error.message : 'play_failed',
      }
    }

    if (token !== crossfadeTokenRef.current) {
      if (standbyAudioRef.current === toAudio && standbyPlayTokenRef.current === token) {
        toAudio.volume = 0
        toAudio.pause()
      }
      return { ok: false, song, error: 'crossfade_cancelled' }
    }

    standbyAudioRef.current = toAudio
    currentSongRef.current = song
    setCurrentSong(song)
    setCurrentTime(0)
    setDuration(getSafeDuration(toAudio))
    setIsPlaying(true)

    return new Promise((resolve) => {
      const startedAt = performance.now()
      let finished = false
      const finish = () => {
        if (finished || token !== crossfadeTokenRef.current) return
        resetSilenceDetection()
        finished = true
        if (crossfadeRecoveryTimerRef.current) {
          window.clearTimeout(crossfadeRecoveryTimerRef.current)
          crossfadeRecoveryTimerRef.current = 0
        }
        crossfadeFrameRef.current = 0
        isCrossfadingRef.current = false
        fromAudio.pause()
        fromAudio.currentTime = 0
        fromAudio.volume = 0
        setDeckPlaybackRate(fromAudio, 1)
        toAudio.volume = getEffectiveVolume()
        audioRef.current = toAudio
        standbyAudioRef.current = fromAudio
        crossfadeTransactionRef.current = null
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
        resolve,
      }
      crossfadeRecoveryTimerRef.current = window.setTimeout(() => {
        if (token === crossfadeTokenRef.current && standbyAudioRef.current === toAudio) {
          finish()
        }
      }, fadeDuration + 350)

      crossfadeFrameRef.current = requestAnimationFrame(step)
    })
  }, [assertStableDeckState, cancelCrossfade, ensureStandbyAudio, getEffectiveVolume, playSongHard, rampPlaybackRate, resetSilenceDetection, resumeMusicOutput])

  const playSong = useCallback((song, options = {}) => {
    if (!options.fromRadioQueue) queuedNextSongRef.current = null
    return options.crossfade ? crossfadeToSong(song) : playSongHard(song)
  }, [crossfadeToSong, playSongHard])

  const playSongFromQueue = useCallback((song, songs, options = {}) => {
    setPlaybackQueue(songs)
    return playSong(song, options)
  }, [playSong, setPlaybackQueue])

  const pausePlayback = useCallback(() => {
    cancelCrossfade({ pauseActive: true })
    resetSilenceDetection()
    setIsPlaying(false)

    return { ok: true, song: currentSongRef.current }
  }, [cancelCrossfade, resetSilenceDetection])

  const togglePlayPause = useCallback(async () => {
    const audio = audioRef.current

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
  }, [pausePlayback, playSong, resumeMusicOutput])

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
      return playSong(manualQueuedSong, { crossfade: true, fromRadioQueue: true })
    }

    const automaticQueuedSong = autoUpNextTracksRef.current[0]
    if (automaticQueuedSong) {
      setAutoUpNextTracks((current) => {
        const next = current.slice(1)
        autoUpNextTracksRef.current = next
        return next
      })
      return playSong(automaticQueuedSong, { crossfade: true, fromRadioQueue: true })
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

      return nextSong ? playSong(nextSong, { crossfade: true, fromRadioQueue: Boolean(queuedSong) }) : { ok: false, error: 'no_next' }
    }

    const currentIndex = getCurrentIndex()
    const nextIndex = currentIndex < 0 ? 0 : currentIndex + 1

    if (nextIndex >= songs.length) {
      if (auto && !earlyCrossfade && audioRef.current) {
        const audio = audioRef.current
        audio.pause()
        audio.currentTime = getSafeDuration(audio) || audio.currentTime
      }

      return { ok: false, error: 'no_next' }
    }

    return playSong(songs[nextIndex], { crossfade: true })
  }, [getActiveQueue, getCurrentIndex, playSong, playSongHard, updateUpNextTracks])

  const playPrevious = useCallback(async () => {
    const songs = getActiveQueue()

    if (!songs.length) {
      return { ok: false, error: 'empty_library' }
    }

    if (playbackModeRef.current === 'shuffle' || playbackModeRef.current === 'ai_recommend' || playbackModeRef.current === 'companion_continue') {
      const previousRandomSong = randomSong(songs, currentSongRef.current)
      return previousRandomSong ? playSongHard(previousRandomSong) : { ok: false, error: 'no_previous' }
    }

    const currentIndex = getCurrentIndex()
    const previousIndex =
      currentIndex < 0 ? 0 : currentIndex - 1

    if (previousIndex < 0) {
      return { ok: false, error: 'no_previous' }
    }

    return playSongHard(songs[previousIndex])
  }, [getActiveQueue, getCurrentIndex, playSongHard])

  const seekTo = useCallback((time) => {
    cancelCrossfade()
    const audio = audioRef.current

    if (!audio) {
      return
    }

    const nextTime = Math.max(0, Math.min(time, getSafeDuration(audio)))
    audio.currentTime = nextTime
    resetSilenceDetection()
    setCurrentTime(nextTime)
  }, [cancelCrossfade, resetSilenceDetection])

  const setPlaybackMode = useCallback((mode) => {
    if (!PLAYBACK_MODES.includes(mode)) {
      return
    }

    playbackModeRef.current = mode
    setPlaybackModeState(mode)
    localStorage.setItem(PLAYBACK_MODE_KEY, mode)
  }, [])

  useEffect(() => {
    const audio = audioRef.current

    if (!audio) {
      return undefined
    }

    const handleTimeUpdate = () => {
      if (audio !== audioRef.current) {
        return
      }

      setCurrentTime(audio.currentTime || 0)
      const safeDuration = getSafeDuration(audio)
      setDuration(safeDuration)

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
      if (audio !== audioRef.current) {
        return
      }

      setDuration(getSafeDuration(audio))
    }

    const handlePlay = () => {
      if (audio !== audioRef.current) {
        return
      }

      setIsPlaying(true)
    }

    const handlePause = () => {
      if (audio !== audioRef.current) {
        return
      }

      setIsPlaying(false)
    }

    const handleEnded = async () => {
      if (audio !== audioRef.current || isCrossfadingRef.current) {
        return
      }

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
      if (audio !== audioRef.current || !currentSongRef.current?.fileUrl) return
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
        if (audio !== audioRef.current || !audio.paused) return
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
  }, [playNext, currentSong, audioVersion, rememberTailSilence, resetSilenceDetection, resumeMusicOutput, shouldStartAudibleEndCrossfade, shouldStartSilenceCrossfade])

  useEffect(() => () => {
    cancelCrossfade()
    cancelTempoRamp({ resetDecks: true })
    duckTokensRef.current.clear()
    const graph = audioGraphRef.current
    if (graph?.musicGain && graph?.context) {
      graph.musicGain.gain.cancelScheduledValues(graph.context.currentTime)
      graph.musicGain.gain.setValueAtTime(1, graph.context.currentTime)
    }
    graph?.context?.close?.().catch?.(() => {})
    resetSilenceDetection()
    audioRef.current?.pause()
    standbyAudioRef.current?.pause()
    window.clearTimeout(mediaRecoveryRef.current.timer)
  }, [cancelCrossfade, cancelTempoRamp, resetSilenceDetection])

  return {
    audioRef,
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
    getPlaybackDiagnostics: () => ({
      isCrossfading: isCrossfadingRef.current,
      activePaused: audioRef.current?.paused ?? true,
      activeVolume: audioRef.current?.volume ?? 0,
      standbyPaused: standbyAudioRef.current?.paused ?? true,
      standbyVolume: standbyAudioRef.current?.volume ?? 0,
      hasCrossfadeFrame: Boolean(crossfadeFrameRef.current),
      hasRecoveryTimer: Boolean(crossfadeRecoveryTimerRef.current),
      userVolume: userVolumeRef.current,
      duckingFactor: duckingFactorRef.current,
      audioContextState: audioGraphRef.current?.context?.state || 'not_attached',
      effectiveVolume: getEffectiveVolume(),
      currentTrackId: getSongId(currentSongRef.current),
      requestedTrackId: getSongId(requestedSongRef.current),
      activeSource: audioRef.current?.currentSrc || audioRef.current?.src || '',
      standbySource: standbyAudioRef.current?.currentSrc || standbyAudioRef.current?.src || '',
    }),
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
