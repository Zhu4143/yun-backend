import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeRhythmWindow, createSeamlessTransitionPlan } from './transitionPlanner.js'

function pulseTrain(bpm, seconds = 16, sampleRate = 8000) {
  const samples = new Int16Array(seconds * sampleRate)
  const interval = Math.round(sampleRate * 60 / bpm)
  for (let start = 0; start < samples.length; start += interval) {
    for (let offset = 0; offset < 180 && start + offset < samples.length; offset += 1) {
      samples[start + offset] = Math.round(22000 * Math.exp(-offset / 38))
    }
  }
  return samples
}

test('detects a stable beat from PCM', () => {
  const analysis = analyzeRhythmWindow(pulseTrain(120), 8000)
  assert.ok(Math.abs(analysis.bpm - 120) < 3, `detected ${analysis.bpm}`)
})

test('prefers the closer transition and bounds time stretch', () => {
  const plan = createSeamlessTransitionPlan(
    { bpm: 124, energy: 0.6, confidence: 0.8 },
    [
      { track: { id: 'far' }, analysis: { bpm: 82, energy: 0.2, confidence: 0.8 } },
      { track: { id: 'near' }, analysis: { bpm: 128, energy: 0.58, confidence: 0.8 } },
    ],
  )
  assert.equal(plan.selectedTrackId, 'near')
  assert.ok(plan.fromRate >= 0.95 && plan.fromRate <= 1.05)
  assert.ok(plan.toRate >= 0.95 && plan.toRate <= 1.05)
  assert.ok(plan.crossfadeMs >= 5200 && plan.crossfadeMs <= 9000)
})
