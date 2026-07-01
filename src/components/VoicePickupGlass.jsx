import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import LiquidGlass from 'liquid-glass-react'
import { opticalFieldController } from '../services/OpticalFieldController'
import './VoicePickupGlass.css'

const barCount = 18
const idleLevels = [0.18, 0.32, 0.24, 0.42, 0.28, 0.5, 0.36, 0.62, 0.44, 0.58, 0.38, 0.48, 0.3, 0.4, 0.26, 0.34, 0.2, 0.28]

function clampLevel(value) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

export default function VoicePickupGlass({
  className = '',
  label = 'VOICE PICKUP',
  title = '我在听',
  hint = '点按开始拾取你的声音',
  activeHint = '正在拾音，音乐会轻轻让出一点空间',
  disabled = false,
  headless = false,
  active = false,
  onCaptureStart,
  onCaptureStop,
  onLevelChange,
  onSilenceTimeout,
}) {
  const [isCapturing, setIsCapturing] = useState(false)
  const [permissionState, setPermissionState] = useState('idle')
  const [level, setLevel] = useState(0)
  const streamRef = useRef(null)
  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const rafRef = useRef(0)
  const dataRef = useRef(null)
  const frequencyDataRef = useRef(null)
  const readLevelRef = useRef(null)
  const captureStartedAtRef = useRef(0)
  const lastVoiceAtRef = useRef(0)
  const hasDetectedVoiceRef = useRef(false)
  const silenceNotifiedRef = useRef(false)
  const noiseFloorRef = useRef(0.018)

  const stopCapture = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }

    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    analyserRef.current = null
    dataRef.current = null
    frequencyDataRef.current = null
    captureStartedAtRef.current = 0
    lastVoiceAtRef.current = 0
    hasDetectedVoiceRef.current = false
    silenceNotifiedRef.current = false
    noiseFloorRef.current = 0.018
    opticalFieldController.setVoiceActive(false)

    if (audioContextRef.current?.state !== 'closed') {
      audioContextRef.current?.close?.()
    }
    audioContextRef.current = null

    setIsCapturing(false)
    setLevel(0)
    onCaptureStop?.()
  }, [onCaptureStop])

  const readLevel = useCallback(() => {
    const analyser = analyserRef.current
    const data = dataRef.current
    const frequencyData = frequencyDataRef.current
    if (!analyser || !data || !frequencyData) return

    analyser.getByteTimeDomainData(data)
    let sum = 0
    for (let index = 0; index < data.length; index += 1) {
      const centered = (data[index] - 128) / 128
      sum += centered * centered
    }
    const rms = Math.sqrt(sum / data.length)
    const nextLevel = clampLevel(Math.max(0, rms * 6.4 - 0.055))
    analyser.getByteFrequencyData(frequencyData)
    const nyquist = audioContextRef.current.sampleRate * 0.5
    const averageBand = (minHz, maxHz) => {
      const start = Math.max(0, Math.floor((minHz / nyquist) * frequencyData.length))
      const end = Math.min(frequencyData.length, Math.max(start + 1, Math.ceil((maxHz / nyquist) * frequencyData.length)))
      let total = 0
      for (let index = start; index < end; index += 1) total += frequencyData[index] / 255
      return clampLevel(total / Math.max(1, end - start))
    }
    const bass = averageBand(70, 320)
    const mid = averageBand(320, 2400)
    const treble = averageBand(2400, 7600)
    const now = performance.now()
    const noiseMargin = rms - noiseFloorRef.current
    const speechBandEnergy = mid * 0.66 + bass * 0.24 + treble * 0.10
    const voiceDetected = noiseMargin > 0.012 && nextLevel > 0.078 && speechBandEnergy > 0.045
    if (voiceDetected) {
      hasDetectedVoiceRef.current = true
      lastVoiceAtRef.current = now
    } else {
      noiseFloorRef.current += (rms - noiseFloorRef.current) * 0.012
      noiseFloorRef.current = Math.max(0.008, Math.min(0.075, noiseFloorRef.current))
    }
    const silenceAnchor = hasDetectedVoiceRef.current
      ? lastVoiceAtRef.current
      : captureStartedAtRef.current
    if (!silenceNotifiedRef.current && now - silenceAnchor >= 6000) {
      silenceNotifiedRef.current = true
      onSilenceTimeout?.()
    }
    setLevel((previous) => previous * 0.72 + nextLevel * 0.28)
    onLevelChange?.(nextLevel)
    opticalFieldController.setVoiceFrame({ level: nextLevel, bass, mid, treble })
    rafRef.current = requestAnimationFrame(() => readLevelRef.current?.())
  }, [onLevelChange, onSilenceTimeout])

  useEffect(() => {
    readLevelRef.current = readLevel
  }, [readLevel])

  const startCapture = useCallback(async () => {
    if (disabled || isCapturing) return

    try {
      setPermissionState('requesting')
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      const AudioContext = window.AudioContext || window.webkitAudioContext
      const audioContext = new AudioContext()
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.78

      const source = audioContext.createMediaStreamSource(stream)
      source.connect(analyser)

      streamRef.current = stream
      audioContextRef.current = audioContext
      analyserRef.current = analyser
      dataRef.current = new Uint8Array(analyser.fftSize)
      frequencyDataRef.current = new Uint8Array(analyser.frequencyBinCount)

      setIsCapturing(true)
      setPermissionState('granted')
      opticalFieldController.setVoiceActive(true)
      captureStartedAtRef.current = performance.now()
      lastVoiceAtRef.current = 0
      hasDetectedVoiceRef.current = false
      silenceNotifiedRef.current = false
      noiseFloorRef.current = 0.018
      onCaptureStart?.(stream)
      rafRef.current = requestAnimationFrame(() => readLevelRef.current?.())
    } catch {
      setPermissionState('denied')
      stopCapture()
      onSilenceTimeout?.()
    }
  }, [disabled, isCapturing, onCaptureStart, onSilenceTimeout, stopCapture])

  const toggleCapture = useCallback(() => {
    if (isCapturing) {
      stopCapture()
      return
    }
    startCapture()
  }, [isCapturing, startCapture, stopCapture])

  useEffect(() => stopCapture, [stopCapture])

  useEffect(() => {
    if (!headless) return
    const task = window.setTimeout(() => {
      if (active) startCapture()
      else stopCapture()
    }, 0)
    return () => window.clearTimeout(task)
  }, [active, headless, startCapture, stopCapture])

  const bars = useMemo(() => {
    const liveLevel = isCapturing ? Math.max(level, 0.08) : 0
    return Array.from({ length: barCount }, (_, index) => {
      const idle = idleLevels[index % idleLevels.length]
      const wave = Math.sin(index * 0.84 + liveLevel * 7) * 0.18 + 0.82
      return clampLevel(isCapturing ? idle * 0.32 + liveLevel * wave : idle * 0.34)
    })
  }, [isCapturing, level])

  const statusText = permissionState === 'requesting'
    ? '等待麦克风权限'
    : permissionState === 'denied'
      ? '麦克风未授权'
      : isCapturing
        ? '正在拾音'
        : '待机'

  return (
    headless ? null : <LiquidGlass
      displacementScale={40}
      blurAmount={0.01}
      saturation={160}
      aberrationIntensity={3}
      elasticity={0.35}
      cornerRadius={34}
      padding="18px"
      className={`voice-pickup-glass${isCapturing ? ' is-capturing' : ''}${permissionState === 'denied' ? ' is-denied' : ''}${className ? ` ${className}` : ''}`}
    >
      <div className="voice-pickup-glass__content">
        <button
          className="voice-pickup-glass__trigger"
          type="button"
          aria-label={isCapturing ? '停止拾音' : '开始拾音'}
          aria-pressed={isCapturing}
          disabled={disabled || permissionState === 'requesting'}
          onClick={toggleCapture}
        >
          <span className="voice-pickup-glass__mic" aria-hidden="true" />
        </button>

        <div className="voice-pickup-glass__body">
          <div className="voice-pickup-glass__header">
            <p>{label}</p>
            <span>{statusText}</span>
          </div>
          <h2>{title}</h2>
          <span className="voice-pickup-glass__hint">
            {isCapturing ? activeHint : hint}
          </span>
          <div className="voice-pickup-glass__meter" aria-hidden="true">
            {bars.map((bar, index) => (
              <i
                key={index}
                style={{
                  '--voice-pickup-level': bar,
                  '--voice-pickup-delay': `${index * 38}ms`,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </LiquidGlass>
  )
}
