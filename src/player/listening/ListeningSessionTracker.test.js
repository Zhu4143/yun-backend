import assert from 'node:assert/strict'
import test from 'node:test'
import { ListeningSessionTracker } from './ListeningSessionTracker.js'
import { createCrossfadeListeningOwnership } from './CrossfadeListeningOwnership.js'
import { PauseSuppressionGate } from './PauseSuppressionGate.js'

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
  context.tracker.prepareTransition({ type: 'next', reason: 'user_next' })
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

test('dual-deck crossfade keeps A as logical owner until commit, then completes A and starts B once', () => {
  const context = fixture()
  const ownership = createCrossfadeListeningOwnership({ tracker: context.tracker })
  const deckA = {}
  const deckB = {}
  context.tracker.actualPlay(trackA, { positionMs: 93000 })
  ownership.activate(deckA, trackA)
  const transition = context.tracker.prepareTransition({ reason: 'natural_end', deferUntilCommit: true })
  const handoff = ownership.prepare({ fromDeck: deckA, toDeck: deckB, track: trackB, transition })
  ownership.position(deckA, 94000)
  ownership.position(deckA, 95000)
  assert.equal(context.tracker.getCurrentSession().trackId, 'netease-1')
  assert.equal(context.tracker.getCurrentSession().positionMs, 95000)
  assert.deepEqual(context.events.map((event) => event.type), ['play'])
  context.advance(7000)
  ownership.commit(handoff, { positionMs: 7000, durationMs: 100000 })
  assert.deepEqual(context.events.map((event) => event.type), ['play', 'complete', 'play'])
  assert.equal(context.events[1].metadata.reason, 'natural_end')
  assert.equal(context.events[2].positionMs, 7000)
  assert.equal(context.tracker.getCurrentSession().trackId, 'netease-2')
})

test('failed crossfades rollback their transition and do not leak a next or natural completion into later playback', () => {
  const context = fixture()
  const ownership = createCrossfadeListeningOwnership({ tracker: context.tracker })
  const deckA = {}
  const deckB = {}
  context.tracker.actualPlay(trackA)
  ownership.activate(deckA, trackA)
  const failed = context.tracker.prepareTransition({ type: 'next', reason: 'user_next', deferUntilCommit: true })
  const failedHandoff = ownership.prepare({ fromDeck: deckA, toDeck: deckB, track: trackB, transition: failed })
  ownership.rollback(failedHandoff)
  assert.equal(context.tracker.getCurrentSession().trackId, 'netease-1')
  assert.deepEqual(context.events.map((event) => event.type), ['play'])
  context.tracker.actualPlay(trackB)
  assert.deepEqual(context.events.map((event) => event.type), ['play', 'skip', 'play'])
  assert.equal(context.events[1].metadata.reason, 'track_replaced')
})

test('transition tokens are unique and a stale rollback or commit cannot replace a newer intent', () => {
  const context = fixture()
  context.tracker.actualPlay(trackA, { positionMs: 30000, durationMs: 100000 })
  const first = context.tracker.prepareTransition({ type: 'next', reason: 'user_next', deferUntilCommit: true })
  const second = context.tracker.prepareTransition({ type: 'previous', reason: 'user_previous', deferUntilCommit: true })
  assert.notEqual(first.id, second.id)
  context.tracker.rollbackTransition(first)
  assert.equal(context.tracker.commitTransition(first, trackB), null)
  assert.equal(context.tracker.getCurrentSession().trackId, 'netease-1')
  assert.ok(context.tracker.commitTransition(second, trackB, { positionMs: 0, durationMs: 100000 }))
  assert.deepEqual(context.events.map((event) => event.type), ['play', 'previous', 'skip', 'play'])
  assert.equal(context.events[2].metadata.reason, 'user_previous')
})

test('ownership commit is atomic: stale handoff keeps A owner while the valid handoff moves both tracker and owner to B', () => {
  const context = fixture()
  const ownership = createCrossfadeListeningOwnership({ tracker: context.tracker })
  const deckA = {}
  const deckB = {}
  context.tracker.actualPlay(trackA)
  ownership.activate(deckA, trackA)
  const first = context.tracker.prepareTransition({ type: 'next', reason: 'user_next', deferUntilCommit: true })
  const firstHandoff = ownership.prepare({ fromDeck: deckA, toDeck: deckB, track: trackB, transition: first })
  const second = context.tracker.prepareTransition({ type: 'previous', reason: 'user_previous', deferUntilCommit: true })
  const secondHandoff = ownership.prepare({ fromDeck: deckA, toDeck: deckB, track: trackB, transition: second })
  assert.equal(ownership.commit(firstHandoff, { positionMs: 0, durationMs: 100000 }), null)
  assert.equal(ownership.getActiveTrack().id, 'netease-1')
  assert.equal(context.tracker.getCurrentSession().trackId, 'netease-1')
  assert.ok(ownership.commit(secondHandoff, { positionMs: 0, durationMs: 100000 }))
  assert.equal(ownership.getActiveTrack().id, 'netease-2')
  assert.equal(context.tracker.getCurrentSession().trackId, 'netease-2')
})

test('deck-scoped suppression is consumed for an old crossfade deck and cannot swallow a reused deck user pause', () => {
  const context = fixture()
  const gate = new PauseSuppressionGate()
  const deck1 = { paused: false }
  const deck2 = { paused: false }
  context.tracker.actualPlay(trackA)
  assert.equal(gate.arm(deck1), true)
  // The old deck can become inactive before its pause callback arrives.
  deck1.paused = true
  assert.equal(gate.consume(deck1), true)
  context.tracker.actualPlay(trackB)
  context.tracker.actualPlay(trackA)
  deck1.paused = false
  assert.equal(gate.consume(deck1), false)
  context.tracker.actualPause({ positionMs: 1000 })
  assert.equal(context.events.at(-1).type, 'pause')
  assert.equal(deck2.paused, false)
})

test('hard source replacement consumes only its internal pause and does not leave a token when already paused', () => {
  const context = fixture()
  const gate = new PauseSuppressionGate()
  const deck = { paused: false }
  context.tracker.actualPlay(trackA)
  assert.equal(gate.arm(deck), true)
  deck.paused = true
  assert.equal(gate.consume(deck), true)
  context.tracker.actualPlay(trackB)
  deck.paused = false
  assert.equal(gate.consume(deck), false)
  context.tracker.actualPause({ positionMs: 5000 })
  assert.equal(context.events.at(-1).type, 'pause')
  deck.paused = true
  assert.equal(gate.arm(deck), false)
  assert.equal(gate.consume(deck), false)
})

test('post-commit B pause and resume accrue only B playing intervals', () => {
  const context = fixture()
  const ownership = createCrossfadeListeningOwnership({ tracker: context.tracker })
  const deckA = {}
  const deckB = {}
  context.tracker.actualPlay(trackA, { positionMs: 93000 })
  ownership.activate(deckA, trackA)
  const transition = context.tracker.prepareTransition({ reason: 'natural_end', deferUntilCommit: true })
  const handoff = ownership.prepare({ fromDeck: deckA, toDeck: deckB, track: trackB, transition })
  ownership.commit(handoff, { positionMs: 0, durationMs: 100000 })
  context.advance(20000)
  context.tracker.actualPause({ positionMs: 20000 })
  context.advance(10 * 60 * 1000)
  context.tracker.actualPlay(trackB, { positionMs: 20000 })
  context.advance(20000)
  context.tracker.prepareTransition({ type: 'next', reason: 'user_next' })
  context.tracker.actualPlay(trackA, { positionMs: 0 })
  const bSkip = context.events.find((event) => event.type === 'skip' && event.trackId === 'netease-2')
  assert.deepEqual(context.events.filter((event) => event.trackId === 'netease-2').map((event) => event.type), ['play', 'pause', 'resume', 'next', 'skip'])
  assert.equal(bSkip.metadata.listenDurationMs, 40000)
})

test('previous intent is attached to the old session only after the replacement actually plays', () => {
  const context = fixture()
  context.tracker.actualPlay(trackA, { positionMs: 30000, durationMs: 100000 })
  context.tracker.prepareTransition({ type: 'previous', reason: 'user_previous' })
  context.tracker.actualPlay(trackB)
  assert.deepEqual(context.events.map((event) => event.type), ['play', 'previous', 'skip', 'play'])
  assert.equal(context.events[1].metadata.reason, 'user_previous')
  assert.equal(context.events[2].metadata.reason, 'user_previous')
  assert.equal(context.events[1].positionMs, 30000)
  assert.equal(context.events[1].durationMs, 100000)
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

test('nullish event fields inherit session evidence instead of normalizing to zero', () => {
  const context = fixture()
  context.tracker.actualPlay(trackA, { positionMs: null, durationMs: null })
  context.tracker.position(30000)
  context.tracker.prepareTransition({ type: 'next', reason: 'user_next' })
  context.tracker.actualPlay(trackB, { positionMs: null, durationMs: '' })
  assert.equal(context.events[1].positionMs, 30000)
  assert.equal(context.events[1].durationMs, 100000)
  assert.equal(context.events[2].positionMs, 30000)
  assert.equal(context.events[2].durationMs, 100000)
  assert.equal(context.events[3].positionMs, 0)
  assert.equal(context.events[3].durationMs, 100000)
})
