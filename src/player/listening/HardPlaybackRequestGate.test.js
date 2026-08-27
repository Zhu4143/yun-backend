import assert from 'node:assert/strict'
import test from 'node:test'
import { HardPlaybackRequestGate } from './HardPlaybackRequestGate.js'

const trackB = { id: 'netease-2', providerId: '2', title: 'B' }
const trackC = { id: 'netease-3', providerId: '3', title: 'C' }

test('a newer hard playback request supersedes every completion path of the older request', () => {
  const gate = new HardPlaybackRequestGate()
  const first = gate.begin(trackB)
  const second = gate.begin(trackC)
  assert.equal(gate.isCurrent(first, trackB), false)
  assert.equal(gate.isCurrent(second, trackC), true)
  gate.clear(first)
  assert.equal(gate.isCurrent(second, trackC), true)
  gate.clear(second)
  assert.equal(gate.isCurrent(second, trackC), false)
})
