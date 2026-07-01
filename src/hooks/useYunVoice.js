import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { synthesizeSpeech } from '../api/ttsApi'
import { cancelDucking, startDucking, stopDucking } from '../services/audioDucking'

const TTS_ENABLED_KEY = 'yun_tts_enabled'
const TTS_VOICE_KEY = 'yun_tts_voice'
const TTS_SPEED_KEY = 'yun_tts_speed'
const TTS_VOLUME_KEY = 'yun_tts_volume'
const DUCKING_VOLUME_KEY = 'yun_ducking_volume'
const MIN_DUCKING_VOLUME = 0.12

const DEFAULT_VOICE = 'S_5U82YXa42'
const LEGACY_DEFAULT_VOICE = 'zh_female_xiaohe_uranus_bigtts'
const SILENT_AUDIO_SRC = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA='
const PREVIEW_TEXT = '\u55ef\uff0c\u6211\u5728\u3002\u8fd9\u4e2a\u58f0\u97f3\u542c\u8d77\u6765\u8fd8\u884c\u5417\u3002'

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
    voice: !savedVoice || savedVoice === LEGACY_DEFAULT_VOICE ? DEFAULT_VOICE : savedVoice,
    speed: clampNumber(localStorage.getItem(TTS_SPEED_KEY), 0.7, 1.4, 1),
    volume: clampNumber(localStorage.getItem(TTS_VOLUME_KEY), 0.4, 1.5, 1),
    duckingEnabled: true,
    duckingVolume: clampNumber(localStorage.getItem(DUCKING_VOLUME_KEY), MIN_DUCKING_VOLUME, 0.6, 0.25),
  }
}

export function useYunVoice({
  musicAudioRef,
} = {}) {
  const speechAudioRef = useRef(null)
  const objectUrlRef = useRef('')
  const tokenRef = useRef(0)
  const audioUnlockedRef = useRef(false)
  const musicVolumeBeforeSpeechRef = useRef(null)
  const [settings, setSettingsState] = useState(getInitialVoiceSettings)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)

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

  const rememberMusicVolume = useCallback(() => {
    const musicAudio = musicAudioRef?.current

    if (!musicAudio || musicAudio.paused) {
      musicVolumeBeforeSpeechRef.current = null
      return
    }

    const currentVolume = Number(musicAudio.volume)
    musicVolumeBeforeSpeechRef.current = Number.isFinite(currentVolume) && currentVolume > 0
      ? currentVolume
      : 1
  }, [musicAudioRef])

  const restoreMusicVolume = useCallback(() => {
    const musicAudio = musicAudioRef?.current
    const restoreVolume = musicVolumeBeforeSpeechRef.current

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
  }, [musicAudioRef])

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
    setIsSpeaking(false)

    if (speechAudioRef.current) {
      speechAudioRef.current.pause()
      speechAudioRef.current.src = ''
    }

    cleanupObjectUrl()
    cancelDucking(musicAudioRef?.current)
    if (musicAudioRef?.current && musicVolumeBeforeSpeechRef.current != null) {
      musicAudioRef.current.volume = musicVolumeBeforeSpeechRef.current
      musicVolumeBeforeSpeechRef.current = null
    }
  }, [cleanupObjectUrl, musicAudioRef])

  const speakText = useCallback(async (text, options = {}) => {
    const cleanText = cleanTextForSpeech(text)
    const force = Boolean(options.force)

    if (!cleanText || (!force && !settings.enabled)) {
      return false
    }

    stopSpeaking()
    const token = tokenRef.current

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

      cleanupObjectUrl()
      const objectUrl = URL.createObjectURL(blob)
      objectUrlRef.current = objectUrl

      if (!speechAudioRef.current) {
        speechAudioRef.current = new Audio()
      }

      const speechAudio = speechAudioRef.current
      speechAudio.src = objectUrl
      speechAudio.volume = 1

      const finishSpeech = () => {
        if (token !== tokenRef.current) return
        setIsSpeaking(false)
        restoreMusicVolume()
        cleanupObjectUrl()
      }

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

      rememberMusicVolume()
      startDucking(musicAudioRef?.current, { targetVolume: settings.duckingVolume })

      await speechAudio.play()
      setIsSpeaking(true)
      return done
    } catch {
      setIsSpeaking(false)
      restoreMusicVolume()
      cleanupObjectUrl()
      return false
    }
  }, [cleanupObjectUrl, musicAudioRef, rememberMusicVolume, restoreMusicVolume, settings, stopSpeaking])

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
  }, [stopSpeaking])

  return useMemo(() => ({
    settings,
    isSpeaking,
    isPreviewing,
    previewFailed,
    updateSettings,
    previewVoice,
    speakText,
    stopSpeaking,
  }), [isPreviewing, isSpeaking, previewFailed, previewVoice, settings, speakText, stopSpeaking, updateSettings])
}
