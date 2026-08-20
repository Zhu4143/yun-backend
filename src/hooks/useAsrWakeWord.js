import { useCallback, useEffect, useRef, useState } from 'react'
import { detectWakeWord, getAsrStatus, transcribeAudio } from '../api/asrApi'
import { getSharedAudioCaptureManager } from '../voice/audio/AudioCaptureManager.js'
import { BrowserAecFallback, getSharedSpeakerReferenceBuffer } from '../voice/audio/EchoCanceller.js'

const WAKE_WORD = '小昀'
const WAKE_ALIASES = ['小昀', '小云', '晓云', '小韵', '小芸', '小允', '老赢', '角蝇', 'xiaoyun']
const STORAGE_KEY = 'yun_asr_wake_word_enabled'
const NATIVE_WAKE_MIGRATION_KEY = 'yun_native_wake_default_v1'
const COOLDOWN_MS = 3500
const MAX_BUFFER_SECONDS = 6
const MAX_SPEECH_SECONDS = 3
const PRE_SPEECH_SECONDS = 0.45
const SILENCE_FRAMES = 3
const VOICE_THRESHOLD = 0.012
const SILENCE_THRESHOLD = 0.006

function normalizeTranscript(value) {
  return String(value || '').toLowerCase().replace(/[\s,，。！？、.!?]/g, '')
}

function containsWakeWord(transcript) {
  return WAKE_ALIASES.some((alias) => transcript.includes(alias))
}

function commandAfterWakeWord(transcript) {
  const text = String(transcript || '').trim()
  const match = WAKE_ALIASES
    .map((alias) => ({ alias, index: text.toLowerCase().indexOf(alias.toLowerCase()) }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index)[0]
  if (!match) return ''
  return text
    .slice(match.index + match.alias.length)
    .replace(/^[\s，,。.!！?？、:：]+/, '')
    .trim()
}

function getInitialEnabled() {
  // Move existing installs that were born with the old browser wake default
  // onto native KWS once. Subsequent explicit user-off choices are respected.
  if (window.localStorage.getItem(NATIVE_WAKE_MIGRATION_KEY) !== '1') {
    window.localStorage.setItem(NATIVE_WAKE_MIGRATION_KEY, '1')
    window.localStorage.setItem(STORAGE_KEY, 'true')
    return true
  }
  return window.localStorage.getItem(STORAGE_KEY) !== 'false'
}

function encodeWavBlob(chunks, sampleRate) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const buffer = new ArrayBuffer(44 + length * 2)
  const view = new DataView(buffer)
  const writeText = (offset, text) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)))
  writeText(0, 'RIFF')
  view.setUint32(4, 36 + length * 2, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeText(36, 'data')
  view.setUint32(40, length * 2, true)
  let offset = 44
  chunks.forEach((chunk) => chunk.forEach((value) => {
    const sample = Math.max(-1, Math.min(1, value))
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    offset += 2
  }))
  return new Blob([buffer], { type: 'audio/wav' })
}

export function useAsrWakeWord({ suspended = false, onWake } = {}) {
  const [enabled, setEnabledState] = useState(getInitialEnabled)
  const [runtimeStatus, setRuntimeStatus] = useState('starting')
  const [nativeActive, setNativeActive] = useState(false)
  const [configured, setConfigured] = useState(null)
  const managerRef = useRef(getSharedAudioCaptureManager())
  const bufferChunksRef = useRef([])
  const totalSamplesRef = useRef(0)
  const speechActiveRef = useRef(false)
  const silenceFramesRef = useRef(0)
  const speechFramesRef = useRef([])
  const recognizingRef = useRef(false)
  const lastWakeAtRef = useRef(0)
  const onWakeRef = useRef(onWake)
  const suspendedRef = useRef(suspended)
  const aecRef = useRef(new BrowserAecFallback())
  const nativeEventIdRef = useRef(0)

  useEffect(() => { onWakeRef.current = onWake }, [onWake])
  useEffect(() => { suspendedRef.current = suspended }, [suspended])

  const fireWake = useCallback((source = 'browser', inlineCommand = '') => {
    const timestamp = Date.now()
    if (timestamp - lastWakeAtRef.current < COOLDOWN_MS) return
    lastWakeAtRef.current = timestamp
    setRuntimeStatus('woken')
    onWakeRef.current?.(source, inlineCommand)
  }, [])

  const recognizeSegment = useCallback(async (chunks, sampleRate) => {
    if (recognizingRef.current || !chunks.length) return
    recognizingRef.current = true
    setRuntimeStatus('recognizing')
    try {
      const blob = encodeWavBlob(chunks, sampleRate)
      // The fallback already owns the entire utterance. Run KWS and ASR in
      // parallel so “小云我要听……” can reuse the words after the wake name
      // and does not wait for a second microphone turn.
      const [wakeResult, transcriptResult] = await Promise.allSettled([
        detectWakeWord(blob),
        transcribeAudio(blob),
      ])
      const transcript = transcriptResult.status === 'fulfilled'
        ? String(transcriptResult.value?.text || '')
        : ''
      const heardWake = containsWakeWord(normalizeTranscript(transcript))
      const detected = wakeResult.status === 'fulfilled' && wakeResult.value?.detected
      if (detected || heardWake) fireWake('browser', commandAfterWakeWord(transcript))
      else setRuntimeStatus('not-detected')
    } catch {
      setRuntimeStatus('listening')
    } finally {
      recognizingRef.current = false
      if (!speechActiveRef.current) setRuntimeStatus('listening')
    }
  }, [fireWake])

  useEffect(() => {
    if (!enabled) return undefined

    // The default path is the Windows sidecar. It owns microphone PCM and
    // runs WebRTC APM before its ported Sherpa KWS worker. Do not open a
    // second browser microphone stream when this engine is healthy.
    let cancelled = false
    let socket = null
    let reconnectTimer = 0
    let unsubscribeBrowser = null
    const manager = managerRef.current
    const startBrowserFallback = () => {
      if (cancelled) return
      setNativeActive(false)
      manager.start().then(() => setRuntimeStatus('listening')).catch(() => setRuntimeStatus('denied'))
      unsubscribeBrowser = manager.subscribe((frame) => {
        // Capture is never closed for TTS or command turns. When wake handling is
        // suspended we simply skip KWS computation while the shared stream lives on.
        if (suspendedRef.current || recognizingRef.current) return
        const reference = getSharedSpeakerReferenceBuffer().nearest(frame.timestamp)
        const processed = aecRef.current.process(frame.samples, reference?.samples).samples
        bufferChunksRef.current.push(processed)
        totalSamplesRef.current += processed.length
        const maxSamples = Math.floor(frame.sampleRate * MAX_BUFFER_SECONDS)
        while (totalSamplesRef.current > maxSamples && bufferChunksRef.current.length > 1) {
          totalSamplesRef.current -= bufferChunksRef.current.shift().length
        }
        let sum = 0
        processed.forEach((value) => { sum += value * value })
        const rms = Math.sqrt(sum / processed.length)
        if (!speechActiveRef.current) {
          if (rms > VOICE_THRESHOLD) {
            speechActiveRef.current = true
            silenceFramesRef.current = 0
            const preSamples = Math.floor(frame.sampleRate * PRE_SPEECH_SECONDS)
            let collected = 0
            speechFramesRef.current = []
            for (let index = bufferChunksRef.current.length - 1; index >= 0 && collected < preSamples; index -= 1) {
              const chunk = bufferChunksRef.current[index]
              speechFramesRef.current.unshift(chunk)
              collected += chunk.length
            }
          }
          return
        }
        speechFramesRef.current.push(processed)
        silenceFramesRef.current = rms < SILENCE_THRESHOLD ? silenceFramesRef.current + 1 : 0
        const samples = speechFramesRef.current.reduce((total, chunk) => total + chunk.length, 0)
        if (silenceFramesRef.current >= SILENCE_FRAMES || samples >= Math.floor(frame.sampleRate * (PRE_SPEECH_SECONDS + MAX_SPEECH_SECONDS))) {
          const speech = speechFramesRef.current
          speechFramesRef.current = []
          speechActiveRef.current = false
          recognizeSegment(speech, frame.sampleRate)
        }
      })
    }

    fetch('/api/native-voice/health')
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('native voice unavailable')))
      .then((health) => {
        if (cancelled || !health?.apm?.loaded || !health?.kws?.loaded || !health?.mic?.captureRunning) {
          startBrowserFallback()
          return
        }
        nativeEventIdRef.current = Math.max(0, Number(health.eventSequence) || 0)
        setNativeActive(true)
        setRuntimeStatus('native-listening')
        const connectNativeEvents = () => {
          if (cancelled) return
          socket = new WebSocket(`ws://127.0.0.1:17894/ws?after=${nativeEventIdRef.current}`)
          socket.onopen = () => {
            setNativeActive(true)
            setRuntimeStatus('native-listening')
          }
        socket.onmessage = (message) => {
          let event
          try {
            event = JSON.parse(message.data)
          } catch {
            return
          }
          const eventId = Number(event?.id)
          if (Number.isFinite(eventId)) {
            if (eventId <= nativeEventIdRef.current) return
            nativeEventIdRef.current = eventId
          }
          if (event.event === 'wake_word' && !suspendedRef.current) fireWake('native')
          if (event.event === 'asr_final') {
            window.dispatchEvent(new CustomEvent('yun-native-asr-final', { detail: event }))
          }
          if (event.event === 'asr_partial') {
            window.dispatchEvent(new CustomEvent('yun-native-asr-transcribing', { detail: event }))
          }
          if (event.event === 'barge_in') {
            window.dispatchEvent(new CustomEvent('yun-native-barge-in', { detail: event }))
          }
          if (event.event === 'playback_end') {
            window.dispatchEvent(new CustomEvent('yun-native-playback-end', { detail: event }))
          }
          if (event.event === 'voice_level') {
            window.dispatchEvent(new CustomEvent('yun-native-voice-level', { detail: event }))
          }
          if (event.event === 'voice_error') {
            window.dispatchEvent(new CustomEvent('yun-native-asr-error', { detail: event }))
          }
        }
        socket.onerror = () => {
          // `onclose` is the authoritative lifecycle signal.  Some browsers
          // emit both callbacks, so do not start a second mic pipeline here.
        }
          socket.onclose = () => {
            if (cancelled) return
            setNativeActive(false)
            setRuntimeStatus('native-reconnecting')
            reconnectTimer = window.setTimeout(connectNativeEvents, 800)
          }
        }
        connectNativeEvents()
      })
      .catch(startBrowserFallback)

    return () => {
      cancelled = true
      setNativeActive(false)
      window.clearTimeout(reconnectTimer)
      socket?.close()
      unsubscribeBrowser?.()
    }
  }, [enabled, fireWake, recognizeSegment])

  const setEnabled = useCallback((nextEnabled) => {
    const next = Boolean(nextEnabled)
    window.localStorage.setItem(STORAGE_KEY, String(next))
    setEnabledState(next)
  }, [])

  const refreshConfig = useCallback(() => {
    getAsrStatus().then((status) => setConfigured(Boolean(status.configured))).catch(() => setConfigured(false))
  }, [])

  useEffect(() => { refreshConfig() }, [refreshConfig])

  const status = !enabled ? 'off' : nativeActive ? runtimeStatus : configured === false ? 'unconfigured' : runtimeStatus
  return { enabled, nativeActive, setEnabled, status, configured, refreshConfig, wakeWord: WAKE_WORD }
}
