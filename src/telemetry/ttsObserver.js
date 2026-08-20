// Non-invasive observer over the `useYunVoice` return face.
//
// It derives TTS lifecycle events (started / completed / interrupted) from the
// already-public `isSpeaking` state transitions, and marks an interruption when
// `stopSpeaking` is called while speech is active. All other fields pass
// through unchanged.
//
// Privacy: only the spoken-text length is recorded by default; the text itself
// is added only when the debug-text flag is explicitly enabled.

import { useEffect, useRef } from 'react'
import emitter, { textField } from './emitter.js'
import { ttsTransitionOutcome } from './logic.js'

function safeEmit(telemetry, type, payload, opts) {
  try {
    telemetry.emit(type, payload, opts)
  } catch {
    // noop
  }
}

export function useTtsObserver(voice, telemetry = emitter) {
  const prevRef = useRef({ isSpeaking: false, isPreparing: false })
  const interruptedRef = useRef(false)

  useEffect(() => {
    const prev = prevRef.current
    const text = String(voice?.recentSpokenText || '')
    const outcome = ttsTransitionOutcome({
      prevIsSpeaking: prev.isSpeaking,
      isSpeaking: Boolean(voice?.isSpeaking),
      isPreparingSpeech: Boolean(voice?.isPreparingSpeech),
      interrupted: interruptedRef.current,
    })

    if (outcome) {
      const payload = { ...textField(text) }
      if (outcome.reason) payload.reason = outcome.reason
      safeEmit(
        telemetry,
        outcome.type,
        payload,
        { domain: 'tts', actor: outcome.type === 'tts.interrupted' ? 'system' : 'ai' },
      )
      if (outcome.type === 'tts.completed' || outcome.type === 'tts.interrupted') {
        interruptedRef.current = false
      }
    }

    prevRef.current = { isSpeaking: Boolean(voice?.isSpeaking), isPreparing: Boolean(voice?.isPreparingSpeech) }
  }, [voice, telemetry])

  if (!voice) return voice

  return {
    ...voice,
    stopSpeaking: (...args) => {
      if (voice.isSpeaking) interruptedRef.current = true
      return voice.stopSpeaking(...args)
    },
  }
}
