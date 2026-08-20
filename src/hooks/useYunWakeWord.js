import { useCallback, useEffect, useRef, useState } from 'react'
import { createWavBlob, verifyVoiceprint } from '../services/voiceprintApi'

const WAKE_WORD = '小昀'
// Speech recognition commonly writes the name with a different but identical-sounding character.
const WAKE_ALIASES = ['小昀', '小云', '晓云', '小韵', '小芸', '小允', '老赢', '角蝇', 'xiaoyun']
const STORAGE_KEY = 'yun_wake_word_enabled'
const RESTART_DELAY_MS = 280
const WAKE_COOLDOWN_MS = 3500

function getInitialEnabled() {
  return window.localStorage.getItem(STORAGE_KEY) === 'true'
}

function normalizeTranscript(value) {
  return String(value || '').toLowerCase().replace(/[\s,，。！？!?]/g, '')
}

function containsWakeWord(transcript) {
  return WAKE_ALIASES.some((alias) => transcript.includes(alias))
}

export function useYunWakeWord({ suspended = false, onWake, voiceprintEnabled = false } = {}) {
  const [enabled, setEnabledState] = useState(getInitialEnabled)
  const [runtimeStatus, setRuntimeStatus] = useState('starting')
  const recognitionRef = useRef(null)
  const restartTimerRef = useRef(0)
  const shouldListenRef = useRef(false)
  const onWakeRef = useRef(onWake)
  const lastWakeAtRef = useRef(0)
  const voiceprintStreamRef = useRef(null)
  const voiceprintContextRef = useRef(null)
  const voiceprintProcessorRef = useRef(null)
  const voiceprintSourceRef = useRef(null)
  const voiceprintChunksRef = useRef([])
  const voiceprintSampleRateRef = useRef(16_000)

  useEffect(() => {
    onWakeRef.current = onWake
  }, [onWake])

  const stopRecognition = useCallback(() => {
    window.clearTimeout(restartTimerRef.current)
    restartTimerRef.current = 0
    shouldListenRef.current = false
    const recognition = recognitionRef.current
    recognitionRef.current = null
    if (!recognition) return
    recognition.onresult = null
    recognition.onerror = null
    recognition.onend = null
    try {
      recognition.abort()
    } catch {
      // The browser may have already stopped recognition.
    }
  }, [])

  const stopVoiceprintCapture = useCallback(() => {
    voiceprintProcessorRef.current?.disconnect?.()
    voiceprintSourceRef.current?.disconnect?.()
    voiceprintStreamRef.current?.getTracks().forEach((track) => track.stop())
    voiceprintProcessorRef.current = null
    voiceprintSourceRef.current = null
    voiceprintStreamRef.current = null
    voiceprintChunksRef.current = []
    if (voiceprintContextRef.current?.state !== 'closed') voiceprintContextRef.current?.close?.()
    voiceprintContextRef.current = null
  }, [])

  useEffect(() => {
    if (!enabled || suspended || !voiceprintEnabled || !navigator.mediaDevices?.getUserMedia) {
      stopVoiceprintCapture()
      return undefined
    }

    let cancelled = false
    navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    }).then(async (stream) => {
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      const AudioContext = window.AudioContext || window.webkitAudioContext
      const context = new AudioContext()
      const source = context.createMediaStreamSource(stream)
      const processor = context.createScriptProcessor(4096, 1, 1)
      const maxSamples = Math.ceil(context.sampleRate * 4.5)
      processor.onaudioprocess = (event) => {
        const next = new Float32Array(event.inputBuffer.getChannelData(0))
        const chunks = [...voiceprintChunksRef.current, next]
        let count = chunks.reduce((total, chunk) => total + chunk.length, 0)
        while (count > maxSamples && chunks.length > 1) count -= chunks.shift().length
        voiceprintChunksRef.current = chunks
      }
      source.connect(processor)
      processor.connect(context.destination)
      voiceprintStreamRef.current = stream
      voiceprintContextRef.current = context
      voiceprintSourceRef.current = source
      voiceprintProcessorRef.current = processor
      voiceprintSampleRateRef.current = context.sampleRate
      await context.resume?.()
    }).catch(() => {
      setRuntimeStatus('voiceprint-denied')
    })

    return () => {
      cancelled = true
      stopVoiceprintCapture()
    }
  }, [enabled, stopVoiceprintCapture, suspended, voiceprintEnabled])

  const verifyAndWake = useCallback(async () => {
    if (!voiceprintEnabled) {
      onWakeRef.current?.()
      return
    }
    const chunks = voiceprintChunksRef.current
    if (!chunks.length) {
      // Voice recognition can be ready before the parallel local PCM buffer.
      // Keep the wake word usable; only reject when a completed verification
      // explicitly says that the speaker does not match.
      setRuntimeStatus('voiceprint-bypassed')
      onWakeRef.current?.()
      return
    }
    setRuntimeStatus('verifying')
    try {
      const result = await verifyVoiceprint(createWavBlob(chunks, voiceprintSampleRateRef.current))
      if (!result.verified) {
        setRuntimeStatus('voiceprint-rejected')
        return
      }
      setRuntimeStatus('woken')
      onWakeRef.current?.()
    } catch {
      setRuntimeStatus('voiceprint-bypassed')
      onWakeRef.current?.()
    }
  }, [voiceprintEnabled])

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    const canListen = enabled && !suspended && Boolean(SpeechRecognition)

    stopRecognition()
    if (!enabled) {
      return undefined
    }
    if (!SpeechRecognition) {
      return undefined
    }
    if (suspended) {
      return undefined
    }

    shouldListenRef.current = true
    const startRecognition = () => {
      if (!shouldListenRef.current || recognitionRef.current) return
      const recognition = new SpeechRecognition()
      recognition.lang = 'zh-CN'
      recognition.continuous = true
      recognition.interimResults = true
      recognition.maxAlternatives = 1

      recognition.onstart = () => setRuntimeStatus('listening')
      recognition.onresult = (event) => {
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const transcript = normalizeTranscript(event.results[index][0]?.transcript)
          if (!containsWakeWord(transcript)) continue
          const now = Date.now()
          if (now - lastWakeAtRef.current < WAKE_COOLDOWN_MS) return
          lastWakeAtRef.current = now
           verifyAndWake()
          return
        }
      }
      recognition.onerror = (event) => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          shouldListenRef.current = false
          setRuntimeStatus('denied')
          return
        }
        if (event.error !== 'aborted') setRuntimeStatus('error')
      }
      recognition.onend = () => {
        if (recognitionRef.current === recognition) recognitionRef.current = null
        if (!shouldListenRef.current) return
        restartTimerRef.current = window.setTimeout(startRecognition, RESTART_DELAY_MS)
      }

      recognitionRef.current = recognition
      try {
        recognition.start()
      } catch {
        recognitionRef.current = null
        restartTimerRef.current = window.setTimeout(startRecognition, RESTART_DELAY_MS)
      }
    }

    if (canListen) startRecognition()
    return stopRecognition
   }, [enabled, stopRecognition, suspended, verifyAndWake])

  const setEnabled = useCallback((nextEnabled) => {
    const next = Boolean(nextEnabled)
    window.localStorage.setItem(STORAGE_KEY, String(next))
    setEnabledState(next)
  }, [])

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
  const status = !enabled
    ? 'off'
    : !SpeechRecognition
      ? 'unsupported'
      : suspended
        ? 'paused'
         : runtimeStatus

  return { enabled, setEnabled, status, wakeWord: WAKE_WORD }
}
