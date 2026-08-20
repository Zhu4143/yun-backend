import assert from 'node:assert/strict'
import test from 'node:test'
import { VoiceSessionController } from './VoiceSessionController.js'

test('input and output can be active in parallel', () => {
  const controller = new VoiceSessionController()
  controller.wakeDetected()
  const responseId = controller.startResponse()
  controller.outputStarted(responseId)
  controller.userSpeechStarted()

  assert.equal(controller.getSnapshot().input, 'user_speaking')
  assert.equal(controller.getSnapshot().output, 'playing')
})

test('interruption cancels every response operation and clears output state', () => {
  const controller = new VoiceSessionController()
  const responseId = controller.startResponse()
  let llmCancelled = false
  let ttsCancelled = false
  let playbackFlushed = false
  controller.registerCancellation(responseId, () => { llmCancelled = true })
  controller.registerCancellation(responseId, () => { ttsCancelled = true })
  controller.registerCancellation(responseId, () => { playbackFlushed = true })
  controller.outputStarted(responseId)

  assert.equal(controller.cancelResponse(responseId, 'barge_in'), true)
  assert.equal(llmCancelled, true)
  assert.equal(ttsCancelled, true)
  assert.equal(playbackFlushed, true)
  assert.equal(controller.getSnapshot().output, 'idle')
  assert.equal(controller.getSnapshot().responseId, null)
})
