import { useEffect, useRef, useState } from 'react'
import { getSharedAudioCaptureManager } from '../voice/audio/AudioCaptureManager.js'
import { BrowserAecFallback, getSharedSpeakerReferenceBuffer } from '../voice/audio/EchoCanceller.js'

const CANDIDATE_MS = 320
const COOLDOWN_MS = 1200
const VOICE_THRESHOLD = 0.024

export function useYunBargeIn({ enabled = false, onCandidate } = {}) {
  const [status, setStatus] = useState('off')
  const callbackRef = useRef(onCandidate)
  const lastCandidateRef = useRef(0)
  const speechStartedAtRef = useRef(0)
  const [aec] = useState(() => new BrowserAecFallback())

  useEffect(() => { callbackRef.current = onCandidate }, [onCandidate])

  useEffect(() => {
    if (!enabled) return undefined
    const manager = getSharedAudioCaptureManager()
    manager.start().then(() => setStatus('listening')).catch(() => setStatus('denied'))
    return manager.subscribe((frame) => {
      const reference = getSharedSpeakerReferenceBuffer().nearest(frame.timestamp)
      const startedAt = performance.now()
      const output = aec.process(frame.samples, reference?.samples)
      let sum = 0
      output.samples.forEach((value) => { sum += value * value })
      const rms = Math.sqrt(sum / output.samples.length)
      const now = performance.now()
      if (rms >= VOICE_THRESHOLD) {
        if (!speechStartedAtRef.current) speechStartedAtRef.current = now
        if (now - speechStartedAtRef.current >= CANDIDATE_MS && now - lastCandidateRef.current >= COOLDOWN_MS) {
          lastCandidateRef.current = now
          setStatus('candidate')
          callbackRef.current?.({ rms, aecMode: output.mode, processingMs: performance.now() - startedAt })
        }
      } else {
        speechStartedAtRef.current = 0
      }
    })
  }, [aec, enabled])

  return { status: !enabled ? 'off' : status, aecMode: aec.mode }
}
