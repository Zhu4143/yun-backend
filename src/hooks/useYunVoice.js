import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { synthesizeSpeech } from '../api/ttsApi'
import { cancelDucking, startDucking, stopDucking } from '../services/audioDucking'
import { getSharedSpeakerReferenceBuffer } from '../voice/audio/EchoCanceller.js'

const TTS_ENABLED_KEY = 'yun_tts_enabled'
const TTS_VOICE_KEY = 'yun_tts_voice'
const TTS_SPEED_KEY = 'yun_tts_speed'
const TTS_VOLUME_KEY = 'yun_tts_volume'
const DUCKING_VOLUME_KEY = 'yun_ducking_volume'
const MIN_DUCKING_VOLUME = 0.12

const DEFAULT_VOICE = 'zh_female_xiaohe_uranus_bigtts'
const DOUBAO_VOICES = new Set(['S_5U82YXa42', 'zh_female_xiaohe_uranus_bigtts'])
const SILENT_AUDIO_SRC = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA='
const PREVIEW_TEXT = '\u55ef\uff0c\u6211\u5728\u3002\u8fd9\u4e2a\u58f0\u97f3\u542c\u8d77\u6765\u8fd8\u884c\u5417\u3002'
const NATIVE_VOICE_URL = 'http://127.0.0.1:17894'

function clampNumber(value, min, max, fallback) {
  const number = Number(value)

  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, number))
}

function cleanTextForSpeech(text) {
  return String(text || '')
    .replace(/[（(][^（）()]{0,80}[）)]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[，。！？、,.!?~…\s]+/, '')
    .trim()
}

function getInitialVoiceSettings() {
  const savedVoice = localStorage.getItem(TTS_VOICE_KEY)

  return {
    enabled: localStorage.getItem(TTS_ENABLED_KEY) === 'true',
    // Local clone/Qwen selections cannot be sent to the restored Doubao path.
    voice: DOUBAO_VOICES.has(savedVoice) ? savedVoice : DEFAULT_VOICE,
    speed: clampNumber(localStorage.getItem(TTS_SPEED_KEY), 0.7, 1.4, 1),
    volume: clampNumber(localStorage.getItem(TTS_VOLUME_KEY), 0.4, 1.5, 1),
    duckingEnabled: true,
    duckingVolume: clampNumber(localStorage.getItem(DUCKING_VOLUME_KEY), MIN_DUCKING_VOLUME, 0.6, 0.25),
  }
}

function getWavDurationMs(buffer) {
  const view = new DataView(buffer)
  if (view.byteLength < 44 || view.getUint32(0, false) !== 0x52494646) return 0
  let offset = 12
  let byteRate = 0
  while (offset + 8 <= view.byteLength) {
    const id = view.getUint32(offset, false)
    const size = view.getUint32(offset + 4, true)
    if (id === 0x666d7420 && offset + 16 <= view.byteLength) byteRate = view.getUint32(offset + 16, true)
    if (id === 0x64617461 && byteRate > 0) return Math.ceil(size / byteRate * 1000)
    offset += 8 + size + (size % 2)
  }
  return 0
}

export function useYunVoice({
  musicAudioRef,
  musicDuckingController,
} = {}) {
  const speechAudioRef = useRef(null)
  const speechAudioContextRef = useRef(null)
  const speechSourceRef = useRef(null)
  const speechGainRef = useRef(null)
  const objectUrlRef = useRef('')
  const tokenRef = useRef(0)
  const audioUnlockedRef = useRef(false)
  const musicVolumeBeforeSpeechRef = useRef(null)
  const referenceAnimationRef = useRef(0)
  const referenceAudioBufferRef = useRef(null)
  const nativePlaybackTimerRef = useRef(0)
  const nativePlaybackEndListenerRef = useRef(null)
  const activeDuckTokenRef = useRef('')
  const duckSequenceRef = useRef(0)
  const [settings, setSettingsState] = useState(getInitialVoiceSettings)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isPreparingSpeech, setIsPreparingSpeech] = useState(false)
  const [isSpeechInterruptible, setIsSpeechInterruptible] = useState(false)
  const [recentSpokenText, setRecentSpokenText] = useState('')
  const [lastSpeechEndedAt, setLastSpeechEndedAt] = useState(0)

  const updateSettings = useCallback((patch) => {
    setSettingsState((current) => {
      const next = {
        ...current,
        ...patch,
      }

      next.speed = clampNumber(next.speed, 0.7, 1.4, 1)
      next.volume = clampNumber(next.volume, 0.4, 1.5, 1)
      next.duckingEnabled = true
      next.duckingVolume = clampNumber(next.duckingVolume, MIN_DUCKING_VOLUME, 0.6, 0.25)

      localStorage.setItem(TTS_ENABLED_KEY, String(next.enabled))
      localStorage.setItem(TTS_VOICE_KEY, next.voice || DEFAULT_VOICE)
      localStorage.setItem(TTS_SPEED_KEY, String(next.speed))
      localStorage.setItem(TTS_VOLUME_KEY, String(next.volume))
      localStorage.setItem(DUCKING_VOLUME_KEY, String(next.duckingVolume))

      return next
    })
  }, [])

  const cleanupObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = ''
    }
  }, [])

  const setSpeechOutputVolume = useCallback(async (speechAudio, volume) => {
    const safeVolume = clampNumber(volume, 0.4, 1.5, 1)
    const AudioContext = window.AudioContext || window.webkitAudioContext

    try {
      if (!speechAudioContextRef.current && AudioContext) {
        const context = new AudioContext()
        const source = context.createMediaElementSource(speechAudio)
        const gain = context.createGain()
        source.connect(gain)
        gain.connect(context.destination)
        speechAudioContextRef.current = context
        speechSourceRef.current = source
        speechGainRef.current = gain
      }

      if (speechGainRef.current && speechAudioContextRef.current) {
        const context = speechAudioContextRef.current
        const gain = speechGainRef.current.gain
        gain.cancelScheduledValues(context.currentTime)
        gain.setValueAtTime(safeVolume, context.currentTime)
        await context.resume?.()
        // The GainNode is the only volume stage when available, including
        // values above 1.0 that HTMLAudioElement.volume cannot represent.
        speechAudio.volume = 1
        return
      }
    } catch {
      // Some embedded Chromium builds reject MediaElementSource. The native
      // volume property still makes the regular 40%–100% range functional.
    }

    speechAudio.volume = Math.min(1, safeVolume)
  }, [])

  const rememberMusicVolume = useCallback(() => {
    const musicAudio = musicAudioRef?.current

    if (!musicAudio || musicAudio.paused) {
      musicVolumeBeforeSpeechRef.current = null
      return
    }

    const controllerVolume = musicDuckingController?.getUserVolume?.()
    const currentVolume = Number(controllerVolume ?? musicAudio.volume)
    musicVolumeBeforeSpeechRef.current = Number.isFinite(currentVolume) && currentVolume > 0
      ? currentVolume
      : 1
  }, [musicAudioRef, musicDuckingController])

  const restoreMusicVolume = useCallback(() => {
    const musicAudio = musicAudioRef?.current
    const restoreVolume = musicVolumeBeforeSpeechRef.current

    if (musicDuckingController) {
      musicDuckingController.cancel?.()
      musicVolumeBeforeSpeechRef.current = null
      return
    }

    stopDucking(musicAudio).then(() => {
      if (musicAudio && restoreVolume != null) {
        musicAudio.volume = restoreVolume
      }
    })

    if (musicAudio && restoreVolume != null) {
      window.setTimeout(() => {
        musicAudio.volume = restoreVolume
      }, 900)
    }

    musicVolumeBeforeSpeechRef.current = null
  }, [musicAudioRef, musicDuckingController])

  const acquireMusicDuck = useCallback(() => {
    if (musicDuckingController?.acquire) {
      if (activeDuckTokenRef.current) musicDuckingController.release(activeDuckTokenRef.current, 0.03)
      const token = `tts-${++duckSequenceRef.current}`
      activeDuckTokenRef.current = token
      return musicDuckingController.acquire(token, settings.duckingVolume, 0.08)
    }
    rememberMusicVolume()
    return startDucking(musicAudioRef?.current, { targetVolume: settings.duckingVolume })
  }, [musicAudioRef, musicDuckingController, rememberMusicVolume, settings.duckingVolume])

  const releaseMusicDuck = useCallback(({ forceRestore = false } = {}) => {
    const token = activeDuckTokenRef.current
    activeDuckTokenRef.current = ''
    if (musicDuckingController?.release) {
      // TTS is the only owner of music ducking. On every terminal TTS path
      // (normal end, stop, and playback failure), reset the whole music bus
      // instead of trusting a single token release: an interrupted native
      // playback can otherwise leave an older token holding the gain down.
      if (forceRestore && musicDuckingController.cancel) {
        return musicDuckingController.cancel()
      }
      const released = musicDuckingController.release(token, forceRestore ? 0.06 : 0.5)
      return released
    }
    return restoreMusicVolume()
  }, [musicDuckingController, restoreMusicVolume])

  const unlockAudioPlayback = useCallback(async () => {
    if (audioUnlockedRef.current) return true

    if (!speechAudioRef.current) {
      speechAudioRef.current = new Audio()
    }

    const speechAudio = speechAudioRef.current
    const previousVolume = speechAudio.volume

    try {
      speechAudio.volume = 0
      speechAudio.src = SILENT_AUDIO_SRC
      await speechAudio.play()
      if (import.meta.env.DEV) console.debug('[PLAYBACK] AI audio playing')
      speechAudio.pause()
      speechAudio.currentTime = 0
      speechAudio.volume = previousVolume || 1
      audioUnlockedRef.current = true
      return true
    } catch {
      speechAudio.volume = previousVolume || 1
      return false
    }
  }, [])

  const stopSpeaking = useCallback(() => {
    tokenRef.current += 1
    window.clearTimeout(nativePlaybackTimerRef.current)
    nativePlaybackTimerRef.current = 0
    nativePlaybackEndListenerRef.current?.()
    nativePlaybackEndListenerRef.current = null
    fetch(`${NATIVE_VOICE_URL}/playback/stop`, { method: 'POST' }).catch(() => {})
    setIsSpeaking(false)
    setIsPreparingSpeech(false)
    setIsSpeechInterruptible(false)

    if (speechAudioRef.current) {
      speechAudioRef.current.pause()
      speechAudioRef.current.src = ''
    }
    window.cancelAnimationFrame(referenceAnimationRef.current)
    referenceAnimationRef.current = 0
    referenceAudioBufferRef.current = null
    getSharedSpeakerReferenceBuffer().clear()

    cleanupObjectUrl()
    if (musicDuckingController?.release) {
      releaseMusicDuck({ forceRestore: true })
    } else {
      cancelDucking(musicAudioRef?.current)
    }
    if (!musicDuckingController && musicAudioRef?.current && musicVolumeBeforeSpeechRef.current != null) {
      musicAudioRef.current.volume = musicVolumeBeforeSpeechRef.current
    }
    musicVolumeBeforeSpeechRef.current = null
  }, [cleanupObjectUrl, musicAudioRef, musicDuckingController, releaseMusicDuck])

  const speakText = useCallback(async (text, options = {}) => {
    const cleanText = cleanTextForSpeech(text)
    const force = Boolean(options.force)
    const allowBargeIn = Boolean(options.allowBargeIn)

    if (!cleanText || (!force && !settings.enabled)) {
      return false
    }

    stopSpeaking()
    const token = tokenRef.current
    setIsPreparingSpeech(true)
    setIsSpeechInterruptible(allowBargeIn)
    setRecentSpokenText(cleanText)

    try {
      const blob = await synthesizeSpeech({
        text: cleanText,
        voice: settings.voice || DEFAULT_VOICE,
        speed: settings.speed,
        volume: settings.volume,
      })

      if (token !== tokenRef.current) {
        return false
      }

      const encoded = await blob.arrayBuffer()
      let speechFinished = false
      const finishSpeech = () => {
        if (speechFinished || token !== tokenRef.current) return
        speechFinished = true
        window.clearTimeout(nativePlaybackTimerRef.current)
        nativePlaybackTimerRef.current = 0
        nativePlaybackEndListenerRef.current?.()
        nativePlaybackEndListenerRef.current = null
        window.cancelAnimationFrame(referenceAnimationRef.current)
        referenceAnimationRef.current = 0
        referenceAudioBufferRef.current = null
        getSharedSpeakerReferenceBuffer().clear()
        setIsSpeaking(false)
        setIsPreparingSpeech(false)
        setIsSpeechInterruptible(false)
        setLastSpeechEndedAt(Date.now())
        releaseMusicDuck({ forceRestore: true })
        cleanupObjectUrl()
      }

      // Native APM must receive the exact PCM that reaches the speaker. When
      // the sidecar is healthy, send the WAV to its full-duplex stream rather
      // than also playing it through Chromium.
      const nativeHealth = await fetch(`${NATIVE_VOICE_URL}/health`).then((response) => response.ok ? response.json() : null).catch(() => null)
      if (nativeHealth?.apm?.loaded && nativeHealth?.mic?.captureRunning) {
        const playback = await fetch(`${NATIVE_VOICE_URL}/playback`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: blob })
        if (playback.ok) {
          acquireMusicDuck()
          setIsPreparingSpeech(false)
          setIsSpeaking(true)
          const duration = Math.max(250, getWavDurationMs(encoded))
          return new Promise((resolve) => {
            const onNativePlaybackEnd = () => {
              finishSpeech()
              resolve(true)
            }
            window.addEventListener('yun-native-playback-end', onNativePlaybackEnd, { once: true })
            nativePlaybackEndListenerRef.current = () => window.removeEventListener('yun-native-playback-end', onNativePlaybackEnd)
            nativePlaybackTimerRef.current = window.setTimeout(() => {
              finishSpeech()
              resolve(true)
            }, duration + 800)
          })
        }
      }

      cleanupObjectUrl()
      const objectUrl = URL.createObjectURL(blob)
      objectUrlRef.current = objectUrl

      if (!speechAudioRef.current) {
        speechAudioRef.current = new Audio()
      }

      const speechAudio = speechAudioRef.current
      speechAudio.src = objectUrl
      await setSpeechOutputVolume(speechAudio, settings.volume)
      const decodeContext = speechAudioContextRef.current || new (window.AudioContext || window.webkitAudioContext)()
      referenceAudioBufferRef.current = await decodeContext.decodeAudioData(encoded.slice(0)).catch(() => null)

      const done = new Promise((resolve) => {
        speechAudio.onended = () => {
          finishSpeech()
          resolve(true)
        }
        speechAudio.onerror = () => {
          finishSpeech()
          resolve(false)
        }
        speechAudio.onpause = () => {
          if (!speechAudio.ended) {
            finishSpeech()
            resolve(false)
          }
        }
      })

      acquireMusicDuck()

      await speechAudio.play()
      const referenceBuffer = getSharedSpeakerReferenceBuffer()
      const publishReference = () => {
        const decoded = referenceAudioBufferRef.current
        if (!decoded || speechAudio.paused || speechAudio.ended) return
        const start = Math.floor(speechAudio.currentTime * decoded.sampleRate)
        const end = Math.min(decoded.length, start + 1024)
        if (end > start) referenceBuffer.push(decoded.getChannelData(0).slice(start, end))
        referenceAnimationRef.current = window.requestAnimationFrame(publishReference)
      }
      publishReference()
      setIsPreparingSpeech(false)
      setIsSpeaking(true)
      return done
    } catch {
      setIsSpeaking(false)
      setIsPreparingSpeech(false)
      setIsSpeechInterruptible(false)
      releaseMusicDuck({ forceRestore: true })
      cleanupObjectUrl()
      return false
    }
  }, [acquireMusicDuck, cleanupObjectUrl, releaseMusicDuck, setSpeechOutputVolume, settings, stopSpeaking])

  const previewVoice = useCallback(async () => {
    if (isPreviewing) return false

    setIsPreviewing(true)
    setPreviewFailed(false)

    try {
      await unlockAudioPlayback()
      const ok = await speakText(PREVIEW_TEXT, { force: true })

      if (!ok) {
        setPreviewFailed(true)
        window.setTimeout(() => setPreviewFailed(false), 1400)
      }

      return ok
    } finally {
      setIsPreviewing(false)
    }
  }, [isPreviewing, speakText, unlockAudioPlayback])

  useEffect(() => () => {
    stopSpeaking()
    speechSourceRef.current?.disconnect?.()
    speechGainRef.current?.disconnect?.()
    if (speechAudioContextRef.current?.state !== 'closed') speechAudioContextRef.current?.close?.()
  }, [stopSpeaking])

  return useMemo(() => ({
    settings,
    isSpeaking,
    isPreparingSpeech,
    isSpeechInterruptible,
    recentSpokenText,
    lastSpeechEndedAt,
    isPreviewing,
    previewFailed,
    updateSettings,
    previewVoice,
    speakText,
    stopSpeaking,
  }), [isPreparingSpeech, isPreviewing, isSpeaking, isSpeechInterruptible, lastSpeechEndedAt, previewFailed, previewVoice, recentSpokenText, settings, speakText, stopSpeaking, updateSettings])
}
