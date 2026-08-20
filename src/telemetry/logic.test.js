import test from 'node:test'
import assert from 'node:assert/strict'
import { autoAdvanceOutcome, commandIntent, compactCommand, shouldMarkRepeated, ttsTransitionOutcome } from './logic.js'

test('natural-end advance reports reason natural_end', () => {
  const outcome = autoAdvanceOutcome({ naturalEndPending: true, playbackMode: 'sequence' })
  assert.equal(outcome.reason, 'natural_end')
})

test('early-skip advance reports reason early_skip', () => {
  const outcome = autoAdvanceOutcome({ naturalEndPending: false, playbackMode: 'sequence' })
  assert.equal(outcome.reason, 'early_skip')
})

test('recommendation is accepted only in AI/companion modes', () => {
  assert.equal(autoAdvanceOutcome({ naturalEndPending: false, playbackMode: 'ai_recommend' }).recommendAccepted, true)
  assert.equal(autoAdvanceOutcome({ naturalEndPending: false, playbackMode: 'companion_continue' }).recommendAccepted, true)
  assert.equal(autoAdvanceOutcome({ naturalEndPending: false, playbackMode: 'sequence' }).recommendAccepted, false)
})

test('commandIntent maps synonyms to the same intent', () => {
  assert.equal(commandIntent('下一首'), 'next')
  assert.equal(commandIntent('换一首'), 'next')
  assert.equal(commandIntent('声音小一点'), 'volume')
})

test('compactCommand normalizes punctuation and whitespace', () => {
  assert.equal(compactCommand('下一首！'), '下一首')
})

test('shouldMarkRepeated requires same intent or same normalized text within window', () => {
  const now = 1000000
  assert.equal(shouldMarkRepeated({ prevText: '下一首', prevAt: now - 1000, currentText: '换一首', now, windowMs: 5000 }), true)
  assert.equal(shouldMarkRepeated({ prevText: '下一首', prevAt: now - 1000, currentText: '声音小一点', now, windowMs: 5000 }), false)
  assert.equal(shouldMarkRepeated({ prevText: '下一首', prevAt: now - 1000, currentText: '下一首', now, windowMs: 5000 }), true)
  assert.equal(shouldMarkRepeated({ prevText: '下一首', prevAt: now - 6000, currentText: '下一首', now, windowMs: 5000 }), false)
})

test('tts speaking start emits tts.started', () => {
  const outcome = ttsTransitionOutcome({ prevIsSpeaking: false, isSpeaking: true, isPreparingSpeech: false, interrupted: false })
  assert.equal(outcome.type, 'tts.started')
})

test('tts natural completion emits tts.completed', () => {
  const outcome = ttsTransitionOutcome({ prevIsSpeaking: true, isSpeaking: false, isPreparingSpeech: false, interrupted: false })
  assert.equal(outcome.type, 'tts.completed')
  assert.equal(outcome.reason, 'completed')
})

test('tts explicit stop emits tts.interrupted', () => {
  const outcome = ttsTransitionOutcome({ prevIsSpeaking: true, isSpeaking: false, isPreparingSpeech: false, interrupted: true })
  assert.equal(outcome.type, 'tts.interrupted')
  assert.equal(outcome.reason, 'interrupted')
})

test('tts replaced by a new utterance emits tts.interrupted (replaced), not completed', () => {
  const outcome = ttsTransitionOutcome({ prevIsSpeaking: true, isSpeaking: false, isPreparingSpeech: true, interrupted: false })
  assert.equal(outcome.type, 'tts.interrupted')
  assert.equal(outcome.reason, 'replaced')
})
