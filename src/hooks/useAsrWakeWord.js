import { useCallback, useEffect, useRef, useState } from 'react'
import { detectWakeWord, getAsrStatus, transcribeAudio } from '../api/asrApi'
import { getSharedAudioCaptureManager } from '../voice/audio/AudioCaptureManager.js'
import { BrowserAecFallback, getSharedSpeakerReferenceBuffer } from '../voice/audio/EchoCanceller.js'
import { MicrophoneOwnerStateMachine } from '../voice/MicrophoneOwnerStateMachine.js'
import { BrowserRecognitionQueue } from '../voice/BrowserRecognitionQueue.js'

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
const MAX_NATIVE_RETRIES = 3
const NATIVE_RECOVERY_INTERVAL_MS = 15_000
const NATIVE_STABLE_MS = 15_000
const DIAGNOSTIC_PUBLISH_INTERVAL_MS = 500

const INITIAL_DIAGNOSTICS = {
  source: 'none',
  captureOwner: 'none',
  sampleRate: 0,
  frameSize: 1024,
  queueDepth: 0,
  droppedFrames: 0,
  vadRms: 0,
  vadThreshold: VOICE_THRESHOLD,
  silenceThreshold: SILENCE_THRESHOLD,
  wakeScore: null,
  wakeConfidence: null,
  missedWakeCount: 0,
  falseWakeCount: 0,
  cooldownSuppressions: 0,
  cooldownRemainingMs: 0,
  commandSuppressedFrames: 0,
  ttsActiveFrames: 0,
  validWakeCount: 0,
  reconnectAttempts: 0,
  lastWakeAt: 0,
  lastWakeReportedAt: 0,
}

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

export function useAsrWakeWord({ suspended = false, speaking = false, onWake } = {}) {
  const [enabled, setEnabledState] = useState(getInitialEnabled)
  const [runtimeStatus, setRuntimeStatus] = useState('starting')
  const [nativeActive, setNativeActive] = useState(false)
  const [commandCaptureActive, setCommandCaptureActive] = useState(false)
  const [configured, setConfigured] = useState(null)
  const [diagnostics, setDiagnostics] = useState(INITIAL_DIAGNOSTICS)
  const managerRef = useRef(getSharedAudioCaptureManager())
  const ownerStateRef = useRef(null)
  if (ownerStateRef.current == null) ownerStateRef.current = new MicrophoneOwnerStateMachine({ maxNativeRetries: MAX_NATIVE_RETRIES })
  const bufferChunksRef = useRef([])
  const totalSamplesRef = useRef(0)
  const speechActiveRef = useRef(false)
  const silenceFramesRef = useRef(0)
  const speechFramesRef = useRef([])
  const recognizingRef = useRef(false)
  const recognitionQueueRef = useRef(new BrowserRecognitionQueue())
  const segmentAbortControllerRef = useRef(null)
  const commandCaptureRef = useRef(false)
  const commandCaptureTimerRef = useRef(0)
  const lastWakeAtRef = useRef(0)
  const onWakeRef = useRef(onWake)
  const suspendedRef = useRef(suspended)
  const speakingRef = useRef(speaking)
  const aecRef = useRef(new BrowserAecFallback())
  const nativeEventIdRef = useRef(0)
  const diagnosticsRef = useRef(INITIAL_DIAGNOSTICS)
  const lastDiagnosticsPublishAtRef = useRef(0)

  const publishDiagnostics = useCallback((patch, force = false) => {
    diagnosticsRef.current = { ...diagnosticsRef.current, ...patch }
    const now = Date.now()
    if (!force && now - lastDiagnosticsPublishAtRef.current < DIAGNOSTIC_PUBLISH_INTERVAL_MS) return
    lastDiagnosticsPublishAtRef.current = now
    setDiagnostics({ ...diagnosticsRef.current })
  }, [])

  useEffect(() => { onWakeRef.current = onWake }, [onWake])
  useEffect(() => { suspendedRef.current = suspended }, [suspended])
  useEffect(() => { speakingRef.current = speaking }, [speaking])

  const fireWake = useCallback((source = 'browser', inlineCommand = '') => {
    const timestamp = Date.now()
    const cooldownRemainingMs = COOLDOWN_MS - (timestamp - lastWakeAtRef.current)
    if (cooldownRemainingMs > 0) {
      publishDiagnostics({
        cooldownSuppressions: diagnosticsRef.current.cooldownSuppressions + 1,
        cooldownRemainingMs,
      })
      return
    }
    lastWakeAtRef.current = timestamp
    publishDiagnostics({ source, lastWakeAt: timestamp, cooldownRemainingMs: 0 }, true)
    setRuntimeStatus('woken')
    onWakeRef.current?.(source, inlineCommand)
  }, [publishDiagnostics])

  const finishCommandCapture = useCallback((status = 'listening') => {
    segmentAbortControllerRef.current?.abort(new DOMException('Browser command capture finished', 'AbortError'))
    commandCaptureRef.current = false
    window.clearTimeout(commandCaptureTimerRef.current)
    commandCaptureTimerRef.current = 0
    setCommandCaptureActive(false)
    setRuntimeStatus(status)
  }, [])

  const beginCommandCapture = useCallback(() => {
    if (ownerStateRef.current.getSnapshot().owner !== 'browser') return false
    window.clearTimeout(commandCaptureTimerRef.current)
    commandCaptureRef.current = true
    setCommandCaptureActive(true)
    setRuntimeStatus('command-listening')
    commandCaptureTimerRef.current = window.setTimeout(() => {
      finishCommandCapture('browser-fallback')
      window.dispatchEvent(new CustomEvent('yun-browser-command-timeout'))
    }, 7500)
    return true
  }, [finishCommandCapture])

  const reportWakeOutcome = useCallback((outcome) => {
    const lastWakeAt = diagnosticsRef.current.lastWakeAt
    if (!lastWakeAt || diagnosticsRef.current.lastWakeReportedAt === lastWakeAt) return
    publishDiagnostics({
      lastWakeReportedAt: lastWakeAt,
      falseWakeCount: diagnosticsRef.current.falseWakeCount + (outcome === 'false' ? 1 : 0),
      validWakeCount: diagnosticsRef.current.validWakeCount + (outcome === 'valid' ? 1 : 0),
    }, true)
  }, [publishDiagnostics])

  const recognizeSegment = useCallback((chunks, sampleRate) => {
    if (!chunks.length) return
    recognitionQueueRef.current.enqueue({ chunks, sampleRate })
    void recognitionQueueRef.current.drain(async ({ chunks: segmentChunks, sampleRate: segmentSampleRate }) => {
    recognizingRef.current = true
    const requestController = new AbortController()
    segmentAbortControllerRef.current = requestController
    setRuntimeStatus('recognizing')
    try {
      const blob = encodeWavBlob(segmentChunks, segmentSampleRate)
      if (commandCaptureRef.current) {
        const transcriptResult = await transcribeAudio(blob, { signal: requestController.signal }).catch(() => null)
        if (requestController.signal.aborted || !commandCaptureRef.current) return
        const transcript = String(transcriptResult?.text || '').trim()
        if (transcript) {
          finishCommandCapture('browser-fallback')
          window.dispatchEvent(new CustomEvent('yun-browser-command-final', { detail: { text: transcript } }))
        } else {
          setRuntimeStatus('command-listening')
        }
        return
      }
      // The fallback already owns the entire utterance. Run KWS and ASR in
      // parallel so “小云我要听……” can reuse the words after the wake name
      // and does not wait for a second microphone turn.
      const [wakeResult, transcriptResult] = await Promise.allSettled([
        detectWakeWord(blob, { signal: requestController.signal }),
        transcribeAudio(blob, { signal: requestController.signal }),
      ])
      if (requestController.signal.aborted) return
      const transcript = transcriptResult.status === 'fulfilled'
        ? String(transcriptResult.value?.text || '')
        : ''
      const heardWake = containsWakeWord(normalizeTranscript(transcript))
      const detected = wakeResult.status === 'fulfilled' && wakeResult.value?.detected
      const wakeDetails = wakeResult.status === 'fulfilled' ? wakeResult.value : null
      publishDiagnostics({
        wakeScore: Number.isFinite(Number(wakeDetails?.score)) ? Number(wakeDetails.score) : null,
        wakeConfidence: Number.isFinite(Number(wakeDetails?.confidence)) ? Number(wakeDetails.confidence) : null,
        missedWakeCount: diagnosticsRef.current.missedWakeCount + (heardWake && !detected ? 1 : 0),
      }, true)
      if (detected || heardWake) fireWake('browser', commandAfterWakeWord(transcript))
      else setRuntimeStatus('not-detected')
    } catch {
      setRuntimeStatus(commandCaptureRef.current ? 'command-listening' : 'listening')
    } finally {
      recognizingRef.current = false
      if (segmentAbortControllerRef.current === requestController) segmentAbortControllerRef.current = null
      if (!speechActiveRef.current) setRuntimeStatus(commandCaptureRef.current ? 'command-listening' : 'listening')
    }
    })
  }, [finishCommandCapture, fireWake, publishDiagnostics])

  useEffect(() => {
    if (!enabled) return undefined

    let cancelled = false
    let socket = null
    let reconnectTimer = 0
    let recoveryTimer = 0
    let stableTimer = 0
    let browserFallbackActive = false
    let nativeStartRequested = false
    let unsubscribeBrowser = null
    const recognitionQueue = recognitionQueueRef.current
    const manager = managerRef.current
    const ownerState = ownerStateRef.current
    const publishOwner = () => {
      const snapshot = ownerState.getSnapshot()
      setNativeActive(snapshot.owner === 'native')
      setRuntimeStatus(snapshot.status)
      publishDiagnostics({
        captureOwner: snapshot.owner,
        source: snapshot.owner === 'native' ? 'native' : snapshot.owner === 'browser' ? 'browser-fallback' : 'none',
        reconnectAttempts: snapshot.retryCount,
      }, true)
    }
    const getNativeHealth = () => fetch('/api/native-voice/health', {
      signal: AbortSignal.timeout(2500),
    })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('native voice unavailable')))

    const onBrowserFrame = (frame) => {
      if (suspendedRef.current) {
        publishDiagnostics({
          commandSuppressedFrames: diagnosticsRef.current.commandSuppressedFrames + 1,
        })
        return
      }
      if (speakingRef.current) {
        publishDiagnostics({ ttsActiveFrames: diagnosticsRef.current.ttsActiveFrames + 1 })
      }
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
      const metrics = manager.getMetrics()
      publishDiagnostics({
        source: 'browser-fallback',
        captureOwner: 'browser',
        sampleRate: frame.sampleRate,
        frameSize: processed.length,
        queueDepth: metrics.queueDepth,
        droppedFrames: metrics.droppedFrames,
        vadRms: rms,
        cooldownRemainingMs: Math.max(0, COOLDOWN_MS - (Date.now() - lastWakeAtRef.current)),
      })
      if (!speechActiveRef.current) {
        if (rms > VOICE_THRESHOLD) {
          speechActiveRef.current = true
          if (commandCaptureRef.current) window.dispatchEvent(new CustomEvent('yun-browser-command-speech-start'))
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
        if (commandCaptureRef.current) window.dispatchEvent(new CustomEvent('yun-browser-command-transcribing'))
        recognizeSegment(speech, frame.sampleRate)
      }
    }

    const attachBrowserListener = () => {
      if (unsubscribeBrowser) return
      unsubscribeBrowser = manager.subscribe(onBrowserFrame)
    }
    const stopNativeCapture = async () => {
      try {
        const response = await fetch('/api/native-voice/stop', {
          method: 'POST',
          signal: AbortSignal.timeout(3000),
        })
        const payload = await response.json().catch(() => ({}))
        return (response.ok && payload?.ok !== false) || payload?.code === 'ECONNREFUSED'
      } catch {
        return false
      }
    }

    let connectNativeEvents
    const scheduleNativeRecovery = () => {
      window.clearTimeout(recoveryTimer)
      recoveryTimer = window.setTimeout(() => { void attemptNativeRecovery() }, NATIVE_RECOVERY_INTERVAL_MS)
    }
    const attemptNativeRecovery = async () => {
      if (cancelled || !browserFallbackActive) return
      const health = await getNativeHealth().catch(() => null)
      if (!health?.apm?.loaded || !health?.kws?.loaded) {
        scheduleNativeRecovery()
        return
      }
      if (health?.mic?.captureRunning && !await stopNativeCapture()) {
        scheduleNativeRecovery()
        return
      }
      if (!ownerState.beginNativeRecovery()) return
      publishOwner()
      browserFallbackActive = false
      unsubscribeBrowser?.()
      unsubscribeBrowser = null
      try {
        await manager.setOwner('none')
        if (cancelled) return
        const started = await fetch('/api/native-voice/start', {
          method: 'POST',
          signal: AbortSignal.timeout(5000),
        })
        const recoveredHealth = started.ok ? await started.json() : null
        if (!recoveredHealth?.mic?.captureRunning) throw new Error('native microphone recovery failed')
        await manager.setOwner('native')
        ownerState.nativeRecovered()
        nativeEventIdRef.current = Math.max(0, Number(recoveredHealth.eventSequence) || 0)
        publishOwner()
        publishDiagnostics({
          source: 'native',
          sampleRate: Number(recoveredHealth.mic?.sampleRate) || diagnosticsRef.current.sampleRate,
          frameSize: Number(recoveredHealth.mic?.frameSize) || diagnosticsRef.current.frameSize,
          queueDepth: Number(recoveredHealth.mic?.queueDepth) || 0,
          droppedFrames: Number(recoveredHealth.mic?.droppedFrames) || 0,
        }, true)
        connectNativeEvents()
      } catch {
        if (cancelled) return
        try {
          await manager.setOwner('browser')
          await manager.start()
          ownerState.nativeRecoveryFailed()
          browserFallbackActive = true
          attachBrowserListener()
          publishOwner()
          scheduleNativeRecovery()
        } catch {
          ownerState.nativeRecoveryFailed()
          setRuntimeStatus('denied')
          publishDiagnostics({ captureOwner: 'browser', source: 'browser-fallback-denied' }, true)
        }
      }
    }

    const startBrowserFallback = async () => {
      if (cancelled || browserFallbackActive) return false
      const stopped = await stopNativeCapture()
      if (cancelled) return false
      if (!stopped) {
        setNativeActive(false)
        setRuntimeStatus('native-stop-unconfirmed')
        publishDiagnostics({ source: 'native-stop-unconfirmed', captureOwner: ownerState.getSnapshot().owner }, true)
        return false
      }
      try {
        await manager.setOwner('none')
        await manager.setOwner('browser')
        await manager.start()
        if (cancelled) {
          await manager.setOwner('none')
          return false
        }
        ownerState.browserFallbackStarted()
        browserFallbackActive = true
        attachBrowserListener()
        publishOwner()
        publishDiagnostics({ source: 'browser-fallback' }, true)
        scheduleNativeRecovery()
        return true
      } catch {
        setNativeActive(false)
        setRuntimeStatus('denied')
        publishDiagnostics({ source: 'browser-fallback-denied', captureOwner: 'browser' }, true)
        return false
      }
    }

    connectNativeEvents = () => {
      if (cancelled) return
      let nextSocket
      try {
        nextSocket = new WebSocket(`ws://127.0.0.1:17894/ws?after=${nativeEventIdRef.current}`)
      } catch {
        handleNativeSocketClose(null)
        return
      }
      socket = nextSocket
      nextSocket.onopen = () => {
        if (cancelled || browserFallbackActive) {
          nextSocket.close()
          return
        }
        ownerState.nativeReady()
        publishOwner()
        window.clearTimeout(stableTimer)
        stableTimer = window.setTimeout(() => {
          ownerState.markNativeStable()
          publishOwner()
        }, NATIVE_STABLE_MS)
      }
      nextSocket.onmessage = (message) => {
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
        if (event.event === 'wake_word') {
          publishDiagnostics({
            wakeScore: Number.isFinite(Number(event.score)) ? Number(event.score) : null,
            wakeConfidence: Number.isFinite(Number(event.confidence)) ? Number(event.confidence) : null,
          }, true)
          fireWake('native')
        }
        if (event.event === 'asr_final') window.dispatchEvent(new CustomEvent('yun-native-asr-final', { detail: event }))
        if (event.event === 'asr_partial') window.dispatchEvent(new CustomEvent('yun-native-asr-transcribing', { detail: event }))
        if (event.event === 'barge_in') window.dispatchEvent(new CustomEvent('yun-native-barge-in', { detail: event }))
        if (event.event === 'playback_end') window.dispatchEvent(new CustomEvent('yun-native-playback-end', { detail: event }))
        if (event.event === 'voice_level') window.dispatchEvent(new CustomEvent('yun-native-voice-level', { detail: event }))
        if (event.event === 'voice_error') window.dispatchEvent(new CustomEvent('yun-native-asr-error', { detail: event }))
      }
      nextSocket.onerror = () => {}
      nextSocket.onclose = () => handleNativeSocketClose(nextSocket)
    }

    const handleNativeSocketClose = (closedSocket) => {
      if (cancelled || (closedSocket && socket !== closedSocket)) return
      socket = null
      window.clearTimeout(stableTimer)
      if (ownerState.getSnapshot().owner !== 'native') return
      ownerState.nativeDisconnected()
      const action = ownerState.reconnectFailed()
      publishOwner()
      if (action === 'retry') {
        reconnectTimer = window.setTimeout(connectNativeEvents, 800)
      } else {
        void startBrowserFallback()
      }
    }

    getNativeHealth()
      .then(async (health) => {
        if (health?.apm?.loaded && health?.kws?.loaded && !health?.mic?.captureRunning) {
          nativeStartRequested = true
          const started = await fetch('/api/native-voice/start', {
            method: 'POST',
            signal: AbortSignal.timeout(5000),
          })
          health = started.ok ? await started.json() : health
        }
        if (cancelled) {
          if (nativeStartRequested) fetch('/api/native-voice/stop', { method: 'POST' }).catch(() => {})
          return
        }
        if (!health?.apm?.loaded || !health?.kws?.loaded || !health?.mic?.captureRunning) {
          void startBrowserFallback()
          return
        }
        await manager.setOwner('native')
        if (cancelled) return
        nativeEventIdRef.current = Math.max(0, Number(health.eventSequence) || 0)
        ownerState.nativeReady()
        publishOwner()
        publishDiagnostics({
          source: 'native',
          sampleRate: Number(health.mic?.sampleRate) || diagnosticsRef.current.sampleRate,
          frameSize: Number(health.mic?.frameSize) || diagnosticsRef.current.frameSize,
          queueDepth: Number(health.mic?.queueDepth) || 0,
          droppedFrames: Number(health.mic?.droppedFrames) || 0,
        }, true)
        connectNativeEvents()
      })
      .catch(() => { void startBrowserFallback() })

    return () => {
      cancelled = true
      segmentAbortControllerRef.current?.abort(new DOMException('Wake capture stopped', 'AbortError'))
      segmentAbortControllerRef.current = null
      recognitionQueue.clear()
      commandCaptureRef.current = false
      window.clearTimeout(commandCaptureTimerRef.current)
      commandCaptureTimerRef.current = 0
      const previousOwner = ownerState.getSnapshot().owner
      ownerState.disable()
      setNativeActive(false)
      window.clearTimeout(reconnectTimer)
      window.clearTimeout(recoveryTimer)
      window.clearTimeout(stableTimer)
      socket?.close()
      unsubscribeBrowser?.()
      if (previousOwner === 'native' || previousOwner === 'handoff' || nativeStartRequested) {
        fetch('/api/native-voice/stop', { method: 'POST' }).catch(() => {})
      }
      manager.setOwner('none').catch(() => {})
      publishDiagnostics({ captureOwner: 'none', source: 'none', reconnectAttempts: 0 }, true)
    }
  }, [enabled, fireWake, publishDiagnostics, recognizeSegment])

  const setEnabled = useCallback((nextEnabled) => {
    const next = Boolean(nextEnabled)
    if (!next && commandCaptureRef.current) {
      finishCommandCapture('off')
      window.dispatchEvent(new CustomEvent('yun-browser-command-cancelled'))
    }
    window.localStorage.setItem(STORAGE_KEY, String(next))
    setEnabledState(next)
  }, [finishCommandCapture])

  const refreshConfig = useCallback(() => {
    getAsrStatus().then((status) => setConfigured(Boolean(status.configured))).catch(() => setConfigured(false))
  }, [])

  useEffect(() => { refreshConfig() }, [refreshConfig])

  const status = !enabled ? 'off' : nativeActive ? runtimeStatus : configured === false ? 'unconfigured' : runtimeStatus
  return { enabled, nativeActive, commandCaptureActive, diagnostics, reportWakeOutcome, setEnabled, beginCommandCapture, finishCommandCapture, status, configured, refreshConfig, wakeWord: WAKE_WORD }
}
