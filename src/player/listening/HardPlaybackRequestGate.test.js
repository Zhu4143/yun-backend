import assert from 'node:assert/strict'
import test from 'node:test'
import { PlaybackRequestGate } from './HardPlaybackRequestGate.js'

const trackB = { id: 'netease-2', providerId: '2', title: 'B' }
const trackC = { id: 'netease-3', providerId: '3', title: 'C' }

test('a crossfade request supersedes every completion path of an older hard request', () => {
  const gate = new PlaybackRequestGate()
  const first = gate.beginHard(trackB)
  const second = gate.beginCrossfade(trackC)
  assert.equal(gate.isCurrent(first, trackB), false)
  assert.equal(gate.isCurrent(second, trackC), true)
  gate.clear(first)
  assert.equal(gate.isCurrent(second, trackC), true)
  gate.clear(second)
  assert.equal(gate.isCurrent(second, trackC), false)
})
