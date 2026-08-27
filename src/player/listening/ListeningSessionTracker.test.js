import assert from 'node:assert/strict'
import test from 'node:test'
import { ListeningSessionTracker } from './ListeningSessionTracker.js'

const trackA = { id: 'netease-1', providerId: '1', source: 'netease', title: 'A', artist: 'Artist', durationMs: 100000 }
const trackB = { id: 'netease-2', providerId: '2', source: 'netease', title: 'B', artist: 'Artist', durationMs: 100000 }

function fixture() {
  const events = []
  let time = Date.parse('2026-08-28T18:00:00.000Z')
  let id = 0
  return {
    events,
    tracker: new ListeningSessionTracker({ reporter: { report: (event) => events.push(event) }, now: () => time, idFactory: () => `session-${++id}` }),
    advance(ms) { time += ms },
  }
}

test('actual play/pause/resume transitions are emitted once and accrue only playing intervals', () => {
  const context = fixture()
  context.tracker.actualPlay(trackA, { positionMs: 0 })
  context.tracker.actualPlay(trackA, { positionMs: 0 })
  context.advance(30000)
  context.tracker.actualPause({ positionMs: 30000 })
  context.tracker.actualPause({ positionMs: 30000 })
  context.advance(10 * 60 * 1000)
  context.tracker.actualPlay(trackA, { positionMs: 30000 })
  context.advance(20000)
  context.tracker.transitionIntent('next')
  context.tracker.actualPlay(trackB, { positionMs: 0 })
  assert.deepEqual(context.events.map((event) => event.type), ['play', 'pause', 'resume', 'next', 'skip', 'play'])
  assert.equal(context.events[4].metadata.listenDurationMs, 50000)
  assert.equal(context.events[4].metadata.completionRatio, 0.3)
  assert.equal(context.events[0].source, 'netease')
  assert.equal(context.events[0].providerId, '1')
})

test('only material position jumps generate seek evidence', () => {
  const context = fixture()
  context.tracker.actualPlay(trackA)
  context.tracker.position(12000)
  context.tracker.seek(12000, 12100, 100000)
  context.tracker.seek(12100, 60000, 100000)
  assert.deepEqual(context.events.map((event) => event.type), ['play', 'seek'])
  assert.deepEqual(context.events[1].metadata, { fromMs: 12100, toMs: 60000, direction: 'forward' })
})

test('natural ended completes a session and replay of the same track starts a new repeat session', () => {
  const context = fixture()
  context.tracker.actualPlay(trackA)
  context.advance(90000)
  context.tracker.actualEnded({ positionMs: 100000, durationMs: 100000 })
  context.tracker.actualPlay(trackA)
  assert.deepEqual(context.events.map((event) => event.type), ['play', 'complete', 'play', 'repeat'])
  assert.notEqual(context.events[0].sessionId, context.events[2].sessionId)
  assert.equal(context.events[1].metadata.reason, 'natural_end')
  assert.equal(context.events[3].metadata.previousSessionId, context.events[0].sessionId)
})

test('natural crossfade completes A and starts B once without a user next or skip', () => {
  const context = fixture()
  context.tracker.actualPlay(trackA, { positionMs: 93000 })
  context.advance(7000)
  context.tracker.naturalCrossfade()
  context.tracker.actualPlay(trackB)
  assert.deepEqual(context.events.map((event) => event.type), ['play', 'complete', 'play'])
  assert.equal(context.events[1].metadata.reason, 'natural_end')
})

test('previous intent is attached to the old session only after the replacement actually plays', () => {
  const context = fixture()
  context.tracker.actualPlay(trackA)
  context.tracker.transitionIntent('previous')
  context.tracker.actualPlay(trackB)
  assert.deepEqual(context.events.map((event) => event.type), ['play', 'previous', 'skip', 'play'])
  assert.equal(context.events[1].metadata.reason, 'user_previous')
  assert.equal(context.events[2].metadata.reason, 'user_previous')
})

test('event ids are monotonic per session and rerender-style duplicate play does not create another event', () => {
  const context = fixture()
  context.tracker.actualPlay(trackA)
  context.tracker.actualPlay(trackA)
  context.tracker.position(100)
  context.tracker.actualPause({ positionMs: 100 })
  assert.deepEqual(context.events.map((event) => event.id), [
    'listening-session-1:1',
    'listening-session-1:2',
  ])
})
