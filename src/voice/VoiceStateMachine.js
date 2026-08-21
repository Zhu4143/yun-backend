export const INPUT_STATE = Object.freeze({
  IDLE: 'idle',
  LISTENING: 'listening',
  USER_SPEAKING: 'user_speaking',
  TRANSCRIBING: 'transcribing',
})

export const OUTPUT_STATE = Object.freeze({
  IDLE: 'idle',
  GENERATING: 'generating',
  PLAYING: 'playing',
})

export const VOICE_EVENT = Object.freeze({
  WAKE_WORD_DETECTED: 'wake_word_detected',
  SESSION_STARTED: 'session_started',
  SESSION_ENDED: 'session_ended',
  USER_SPEECH_STARTED: 'user_speech_started',
  USER_SPEECH_ENDED: 'user_speech_ended',
  TRANSCRIPTION_STARTED: 'transcription_started',
  RESPONSE_STARTED: 'response_started',
  OUTPUT_STARTED: 'output_started',
  OUTPUT_ENDED: 'output_ended',
  INTERRUPTED: 'interrupted',
  TIMEOUT: 'timeout',
})

export function createInitialVoiceState() {
  return {
    input: INPUT_STATE.IDLE,
    output: OUTPUT_STATE.IDLE,
    sessionId: null,
    responseId: null,
    sequence: 0,
  }
}

export function reduceVoiceState(current, event) {
  const next = { ...current, sequence: current.sequence + 1 }

  switch (event.type) {
    case VOICE_EVENT.WAKE_WORD_DETECTED:
    case VOICE_EVENT.SESSION_STARTED:
      return { ...next, input: INPUT_STATE.LISTENING, sessionId: event.sessionId ?? current.sessionId }
    case VOICE_EVENT.SESSION_ENDED:
    case VOICE_EVENT.TIMEOUT:
      return { ...next, input: INPUT_STATE.IDLE, output: OUTPUT_STATE.IDLE, sessionId: null, responseId: null }
    case VOICE_EVENT.USER_SPEECH_STARTED:
      return { ...next, input: INPUT_STATE.USER_SPEAKING }
    case VOICE_EVENT.USER_SPEECH_ENDED:
      return { ...next, input: INPUT_STATE.LISTENING }
    case VOICE_EVENT.TRANSCRIPTION_STARTED:
      return { ...next, input: INPUT_STATE.TRANSCRIBING }
    case VOICE_EVENT.RESPONSE_STARTED:
      return { ...next, output: OUTPUT_STATE.GENERATING, responseId: event.responseId }
    case VOICE_EVENT.OUTPUT_STARTED:
      return { ...next, output: OUTPUT_STATE.PLAYING, responseId: event.responseId ?? current.responseId }
    case VOICE_EVENT.OUTPUT_ENDED:
    case VOICE_EVENT.INTERRUPTED:
      return { ...next, output: OUTPUT_STATE.IDLE, responseId: null }
    default:
      return next
  }
}
