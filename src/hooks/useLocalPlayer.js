import { useCallback, useEffect, useRef, useState } from 'react'

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

function getSongId(song) {
  return song?.id || `${song?.title || ''}-${song?.artist || ''}`
}

function getSafeDuration(audio) {
  return Number.isFinite(audio.duration) ? audio.duration : 0
}

function getSafeVolume(audio) {
  const volume = Number(audio?.volume)

  return Number.isFinite(volume) && volume > 0 ? Math.min(1, volume) : 1
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
  const currentSongRef = useRef(null)
  const crossfadeFrameRef = useRef(0)
  const crossfadeTokenRef = useRef(0)
  const isCrossfadingRef = useRef(false)
  const audioContextRef = useRef(null)
  const analyserByAudioRef = useRef(new WeakMap())
  const silenceStartedAtRef = useRef(0)
  const tailSilenceBySongRef = useRef(getInitialTailSilenceCache())
  const initialPlaybackMode = getInitialPlaybackMode()
  const playbackModeRef = useRef(initialPlaybackMode)

  const [currentSong, setCurrentSong] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playbackMode, setPlaybackModeState] = useState(initialPlaybackMode)
  const [lastAutoNextSong, setLastAutoNextSong] = useState(null)
  const [audioVersion, setAudioVersion] = useState(0)

  useEffect(() => {
    playlistRef.current = playlist
  }, [playlist])

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

  const cancelCrossfade = useCallback(() => {
    crossfadeTokenRef.current += 1
    isCrossfadingRef.current = false

    if (crossfadeFrameRef.current) {
      cancelAnimationFrame(crossfadeFrameRef.current)
      crossfadeFrameRef.current = 0
    }
  }, [])

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
      if (!audioContextRef.current) {
        audioContextRef.current = getAudioContext()
      }

      const audioContext = audioContextRef.current
      if (!audioContext) {
        return null
      }

      if (audioContext.state === 'suspended') {
        audioContext.resume?.()
      }

      let entry = analyserByAudioRef.current.get(audio)
      if (!entry) {
        const analyser = audioContext.createAnalyser()
        analyser.fftSize = 1024
        analyser.smoothingTimeConstant = 0.72
        const source = audioContext.createMediaElementSource(audio)
        source.connect(analyser)
        analyser.connect(audioContext.destination)
        entry = {
          analyser,
          frequencyBuffer: new Uint8Array(analyser.frequencyBinCount),
          timeBuffer: new Uint8Array(analyser.fftSize),
        }
        analyserByAudioRef.current.set(audio, entry)
      }

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
  }, [])

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
    const standbyAudio = standbyAudioRef.current
    if (standbyAudio) {
      standbyAudio.pause()
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
      audio.volume = getSafeVolume(audio)
      currentSongRef.current = song
      setCurrentSong(song)
      setCurrentTime(0)
      setDuration(0)
    }

    try {
      await audio.play()
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
  }, [cancelCrossfade, ensureActiveAudio, resetSilenceDetection])

  const crossfadeToSong = useCallback(async (song) => {
    if (!song?.fileUrl) {
      return { ok: false, error: 'missing_file_url' }
    }

    const fromAudio = audioRef.current
    const previousSong = currentSongRef.current

    if (!fromAudio || fromAudio.paused || !previousSong || sameSong(previousSong, song)) {
      return playSongHard(song)
    }

    cancelCrossfade()
    resetSilenceDetection()
    isCrossfadingRef.current = true
    const token = crossfadeTokenRef.current
    const toAudio = ensureStandbyAudio()
    const targetVolume = getSafeVolume(fromAudio)
    const fadeDuration = Math.max(
      MIN_CROSSFADE_DURATION,
      Math.min(CROSSFADE_DURATION, (getSafeDuration(fromAudio) - fromAudio.currentTime) * 1000 || CROSSFADE_DURATION),
    )

    toAudio.pause()
    if (toAudio.src !== song.fileUrl) {
      toAudio.src = song.fileUrl
    }
    toAudio.currentTime = 0
    toAudio.volume = Math.min(targetVolume, targetVolume * CROSSFADE_START_VOLUME)

    try {
      await toAudio.play()
    } catch (error) {
      isCrossfadingRef.current = false
      return {
        ok: false,
        song,
        error: error instanceof Error ? error.message : 'play_failed',
      }
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
      let recoveryTimer = 0

      const finish = () => {
        if (finished) return
        resetSilenceDetection()
        finished = true
        if (recoveryTimer) {
          window.clearTimeout(recoveryTimer)
          recoveryTimer = 0
        }
        crossfadeFrameRef.current = 0
        isCrossfadingRef.current = false
        fromAudio.pause()
        fromAudio.currentTime = 0
        fromAudio.volume = targetVolume
        toAudio.volume = targetVolume
        audioRef.current = toAudio
        standbyAudioRef.current = fromAudio
        setAudioVersion((version) => version + 1)
        resolve({ ok: true, song })
      }

      const step = (now) => {
        if (token !== crossfadeTokenRef.current) {
          if (recoveryTimer) {
            window.clearTimeout(recoveryTimer)
          }
          resolve({ ok: false, song, error: 'crossfade_cancelled' })
          return
        }

        const progress = Math.min(1, (now - startedAt) / fadeDuration)
        const fadeOut = equalPowerFadeOut(progress)
        const fadeIn = equalPowerFadeIn(progress)
        const audibleFadeIn = CROSSFADE_START_VOLUME + (1 - CROSSFADE_START_VOLUME) * fadeIn
        fromAudio.volume = targetVolume * fadeOut
        toAudio.volume = Math.min(targetVolume, targetVolume * audibleFadeIn)

        if (progress < 1) {
          crossfadeFrameRef.current = requestAnimationFrame(step)
          return
        }

        finish()
      }

      recoveryTimer = window.setTimeout(() => {
        if (token === crossfadeTokenRef.current && standbyAudioRef.current === toAudio) {
          finish()
        }
      }, fadeDuration + 350)

      crossfadeFrameRef.current = requestAnimationFrame(step)
    })
  }, [cancelCrossfade, ensureStandbyAudio, playSongHard, resetSilenceDetection])

  const playSong = useCallback((song, options = {}) => {
    return options.crossfade ? crossfadeToSong(song) : playSongHard(song)
  }, [crossfadeToSong, playSongHard])

  const pausePlayback = useCallback(() => {
    cancelCrossfade()
    resetSilenceDetection()
    standbyAudioRef.current?.pause()
    audioRef.current?.pause()
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
  }, [pausePlayback, playSong])

  const getCurrentIndex = useCallback(() => {
    const currentId = getSongId(currentSongRef.current)
    return playlistRef.current.findIndex((song) => getSongId(song) === currentId)
  }, [])

  const playNext = useCallback(async (options = {}) => {
    const auto = options?.auto === true
    const earlyCrossfade = options?.earlyCrossfade === true
    const songs = playlistRef.current

    if (!songs.length) {
      return { ok: false, error: 'empty_library' }
    }

    const mode = playbackModeRef.current

    if (mode === 'loop_one' && currentSongRef.current) {
      return playSongHard(currentSongRef.current)
    }

    if (mode === 'shuffle') {
      const nextSong = randomSong(songs, currentSongRef.current)
      return nextSong ? playSong(nextSong, { crossfade: true }) : { ok: false, error: 'no_next' }
    }

    if (mode === 'ai_recommend' || mode === 'companion_continue') {
      const nextSong = recommendedSong(songs, currentSongRef.current)
        || randomSong(songs, currentSongRef.current)

      return nextSong ? playSong(nextSong, { crossfade: true }) : { ok: false, error: 'no_next' }
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
  }, [getCurrentIndex, playSong, playSongHard])

  const playPrevious = useCallback(async () => {
    const songs = playlistRef.current

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
  }, [getCurrentIndex, playSongHard])

  const seekTo = useCallback((time) => {
    const audio = audioRef.current

    if (!audio) {
      return
    }

    const nextTime = Math.max(0, Math.min(time, getSafeDuration(audio)))
    audio.currentTime = nextTime
    resetSilenceDetection()
    setCurrentTime(nextTime)
  }, [resetSilenceDetection])

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

    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('ended', handleEnded)

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('ended', handleEnded)
    }
  }, [playNext, currentSong, audioVersion, rememberTailSilence, resetSilenceDetection, shouldStartAudibleEndCrossfade, shouldStartSilenceCrossfade])

  useEffect(() => () => {
    cancelCrossfade()
    resetSilenceDetection()
    audioRef.current?.pause()
    standbyAudioRef.current?.pause()
  }, [cancelCrossfade, resetSilenceDetection])

  return {
    audioRef,
    currentSong,
    isPlaying,
    currentTime,
    duration,
    playbackMode,
    lastAutoNextSong,
    playSong,
    pausePlayback,
    togglePlayPause,
    playNext,
    playPrevious,
    seekTo,
    setPlaybackMode,
    readAudioFrequencyData,
  }
}
