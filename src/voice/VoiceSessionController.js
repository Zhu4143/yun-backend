import { createInitialVoiceState, reduceVoiceState, VOICE_EVENT } from './VoiceStateMachine.js'
import { VoiceTelemetry } from './voiceTelemetry.js'

function makeId(prefix, sequence) {
  return `${prefix}-${Date.now().toString(36)}-${sequence}`
}

export class VoiceSessionController {
  constructor({ onStateChange = () => {}, telemetry = new VoiceTelemetry() } = {}) {
    this.onStateChange = onStateChange
    this.telemetry = telemetry
    this.state = createInitialVoiceState()
    this.idSequence = 0
    this.cancellations = new Map()
    this.sessionCancellations = new Set()
  }

  dispatch(type, payload = {}) {
    const event = { type, ...payload, at: Date.now() }
    this.state = reduceVoiceState(this.state, event)
    this.onStateChange(this.state, event)
    return this.state
  }

  getSnapshot = () => this.state

  wakeDetected() {
    this.telemetry.mark('wake_detected')
    const sessionId = this.state.sessionId || this.beginSession()
    this.dispatch(VOICE_EVENT.WAKE_WORD_DETECTED, { sessionId })
    return sessionId
  }

  beginSession() {
    if (this.state.sessionId) return this.state.sessionId
    const sessionId = makeId('session', ++this.idSequence)
    this.dispatch(VOICE_EVENT.SESSION_STARTED, { sessionId })
    return sessionId
  }

  endSession(reason = 'ended') {
    this.cancelResponse(undefined, reason)
    this.dispatch(VOICE_EVENT.SESSION_ENDED, { reason })
  }

  userSpeechStarted() {
    this.telemetry.mark('user_speech_started')
    this.dispatch(VOICE_EVENT.USER_SPEECH_STARTED)
  }

  userSpeechEnded() {
    this.telemetry.mark('user_speech_ended')
    this.dispatch(VOICE_EVENT.USER_SPEECH_ENDED)
  }

  transcriptionStarted() {
    this.dispatch(VOICE_EVENT.TRANSCRIPTION_STARTED)
  }

  startResponse() {
    const sessionId = this.beginSession()
    const responseId = makeId('response', ++this.idSequence)
    this.cancellations.set(responseId, new Set())
    this.telemetry.mark(`response:${responseId}:started`)
    this.dispatch(VOICE_EVENT.RESPONSE_STARTED, { sessionId, responseId })
    return responseId
  }

  registerCancellation(responseId, cancel) {
    if (typeof cancel !== 'function') return () => {}
    const operations = this.cancellations.get(responseId)
    if (!operations) return () => {}
    operations.add(cancel)
    return () => operations.delete(cancel)
  }

  registerSessionCancellation(cancel) {
    if (typeof cancel !== 'function') return () => {}
    this.sessionCancellations.add(cancel)
    return () => this.sessionCancellations.delete(cancel)
  }

  createAbortController(responseId) {
    const controller = new AbortController()
    this.registerCancellation(responseId, (reason) => {
      if (!controller.signal.aborted) {
        controller.abort(new DOMException(`Conversation turn cancelled: ${reason || 'interrupted'}`, 'AbortError'))
      }
    })
    return controller
  }

  outputStarted(responseId = this.state.responseId) {
    if (!responseId || responseId !== this.state.responseId) return false
    this.telemetry.measure('response_to_first_audio', `response:${responseId}:started`)
    this.dispatch(VOICE_EVENT.OUTPUT_STARTED, { responseId })
    return true
  }

  outputEnded(responseId = this.state.responseId) {
    if (!responseId || responseId !== this.state.responseId) return false
    this.dispatch(VOICE_EVENT.OUTPUT_ENDED, { responseId })
    this.cancellations.delete(responseId)
    return true
  }

  cancelResponse(responseId = this.state.responseId, reason = 'interrupted') {
    const activeResponseId = responseId || this.state.responseId
    const shouldCancelSession = !activeResponseId || activeResponseId === this.state.responseId
    let didCancel = false
    if (activeResponseId) {
      const operations = this.cancellations.get(activeResponseId)
      operations?.forEach((cancel) => {
        try { cancel(reason) } catch { /* cancellation must not block the state transition */ }
      })
      this.cancellations.delete(activeResponseId)
      this.telemetry.mark(`response:${activeResponseId}:cancelled`, { reason })
      didCancel = Boolean(operations?.size)
      if (activeResponseId === this.state.responseId) {
        this.dispatch(VOICE_EVENT.INTERRUPTED, { responseId: activeResponseId, reason })
        didCancel = true
      }
    }

    // The conversation hook can still own fetch/model work after TTS has
    // ended and the response state has been cleared. Invalidate that work at
    // the session boundary even when there is no active audio response.
    if (shouldCancelSession) {
      this.sessionCancellations.forEach((cancel) => {
        try { cancel(reason) } catch { /* cancellation must not block the state transition */ }
      })
      didCancel ||= this.sessionCancellations.size > 0
    }
    return didCancel
  }

  timeout() {
    this.endSession('idle_timeout')
    this.dispatch(VOICE_EVENT.TIMEOUT)
  }
}
