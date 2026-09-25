import test from 'node:test'
import assert from 'node:assert/strict'
import { createCrossfadeTimeline } from './crossfadeTimeline.js'

test('new track timeline follows its deck during crossfade and releases it at commit', () => {
  const oldDeck = new EventTarget()
  const targetDeck = new EventTarget()
  oldDeck.currentTime = 45
  oldDeck.duration = 240
  targetDeck.currentTime = 0
  targetDeck.duration = NaN
  const times = []
  const durations = []
  const timeline = createCrossfadeTimeline({
    onTime: (value) => times.push(value),
    onDuration: (value) => durations.push(value),
  })

  timeline.follow(targetDeck)
  assert.equal(timeline.ignores(oldDeck), true)
  assert.deepEqual(times, [0])
  assert.deepEqual(durations, [0])

  oldDeck.currentTime = 46
  oldDeck.dispatchEvent(new Event('timeupdate'))
  targetDeck.duration = 210
  targetDeck.dispatchEvent(new Event('loadedmetadata'))
  targetDeck.currentTime = 1.5
  targetDeck.dispatchEvent(new Event('timeupdate'))
  assert.deepEqual(times, [0, 0, 1.5])
  assert.deepEqual(durations, [0, 210, 210])

  timeline.clear()
  targetDeck.currentTime = 2
  targetDeck.dispatchEvent(new Event('timeupdate'))
  assert.equal(timeline.ignores(oldDeck), false)
  assert.deepEqual(times, [0, 0, 1.5])
})
