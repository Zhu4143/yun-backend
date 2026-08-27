import assert from 'node:assert/strict'
import test from 'node:test'
import { createCrossfadeListeningOwnership } from './CrossfadeListeningOwnership.js'
import {
  beginFreshCrossfadeRequest,
  cancelCrossfadeRequest,
  finalizeCrossfadeRequest,
} from './CrossfadeRequestLifecycle.js'
import { PlaybackRequestGate } from './HardPlaybackRequestGate.js'
import { ListeningSessionTracker } from './ListeningSessionTracker.js'

const trackA = { id: 'netease-1', providerId: '1', source: 'netease', title: 'A', artist: 'Artist', durationMs: 100000 }
const trackB = { id: 'netease-2', providerId: '2', source: 'netease', title: 'B', artist: 'Artist', durationMs: 100000 }
const trackC = { id: 'netease-3', providerId: '3', source: 'netease', title: 'C', artist: 'Artist', durationMs: 100000 }

function lifecycleFixture() {
  const events = []
  let id = 0
  const tracker = new ListeningSessionTracker({
    reporter: { report: (event) => events.push(event) },
    now: () => Date.parse('2026-08-29T12:00:00.000Z'),
    idFactory: () => `session-${++id}`,
  })
  return {
    events,
    tracker,
    ownership: createCrossfadeListeningOwnership({ tracker }),
    gate: new PlaybackRequestGate(),
    requestRef: { current: null },
    isCrossfadingRef: { current: false },
  }
}

test('fresh crossfade lifecycle cancels old state before registering B and commits A to B once', () => {
  const context = lifecycleFixture()
  const deckA = {}
  const deckB = {}
  context.tracker.actualPlay(trackA, { positionMs: 93000, durationMs: 100000 })
  context.ownership.activate(deckA, trackA)
  let cancelledOld = 0
  const request = beginFreshCrossfadeRequest({
    song: trackB,
    cancelOldCrossfade: () => {
      cancelledOld += 1
      cancelCrossfadeRequest({
        transaction: null,
        playbackRequestGate: context.gate,
        requestRef: context.requestRef,
        isCrossfadingRef: context.isCrossfadingRef,
      })
    },
    playbackRequestGate: context.gate,
    requestRef: context.requestRef,
  })

  assert.equal(cancelledOld, 1)
  assert.equal(context.requestRef.current, request)
  assert.equal(context.gate.isCurrent(request, trackB), true)
  context.isCrossfadingRef.current = true
  const transition = context.tracker.prepareTransition({ reason: 'natural_end', deferUntilCommit: true })
  const handoff = context.ownership.prepare({ fromDeck: deckA, toDeck: deckB, track: trackB, transition })
  context.ownership.commit(handoff, { positionMs: 7000, durationMs: 100000 })
  context.isCrossfadingRef.current = false
  finalizeCrossfadeRequest({ request, playbackRequestGate: context.gate, requestRef: context.requestRef })

  assert.equal(context.isCrossfadingRef.current, false)
  assert.equal(context.requestRef.current, null)
  assert.equal(context.gate.isCurrent(request, trackB), false)
  assert.deepEqual(context.events.map((event) => `${event.trackId}:${event.type}`), [
    'netease-1:play', 'netease-1:complete', 'netease-2:play',
  ])
  assert.equal(context.tracker.getCurrentSession().trackId, 'netease-2')
})

test('crossfade cancel paths clear only their request, reset the flag, and leave A as logical owner', () => {
  for (const reason of ['pause', 'seek', 'resume_output_failed']) {
    const context = lifecycleFixture()
    const deckA = {}
    const deckB = { paused: false, volume: 0.7, pause() { this.paused = true } }
    context.tracker.actualPlay(trackA, { positionMs: 30000, durationMs: 100000 })
    context.ownership.activate(deckA, trackA)
    const request = beginFreshCrossfadeRequest({
      song: trackB,
      cancelOldCrossfade: () => {},
      playbackRequestGate: context.gate,
      requestRef: context.requestRef,
    })
    context.isCrossfadingRef.current = true
    const transition = context.tracker.prepareTransition({ reason: 'track_replaced', deferUntilCommit: true })
    const handoff = context.ownership.prepare({ fromDeck: deckA, toDeck: deckB, track: trackB, transition })
    context.ownership.rollback(handoff)
    deckB.pause()
    deckB.volume = 0
    const cancelled = cancelCrossfadeRequest({
      transaction: { playbackRequest: request },
      playbackRequestGate: context.gate,
      requestRef: context.requestRef,
      isCrossfadingRef: context.isCrossfadingRef,
    })

    assert.equal(cancelled, request, reason)
    assert.equal(context.requestRef.current, null, reason)
    assert.equal(context.gate.hasCurrent(), false, reason)
    assert.equal(context.isCrossfadingRef.current, false, reason)
    assert.equal(deckB.paused, true, reason)
    assert.equal(deckB.volume, 0, reason)
    assert.equal(context.tracker.getCurrentSession().trackId, 'netease-1', reason)
    assert.equal(context.events.some((event) => event.trackId === 'netease-2' && event.type === 'play'), false, reason)
    const resumed = context.gate.beginHard(trackC)
    assert.equal(context.gate.isCurrent(resumed, trackC), true, reason)
  }
})

test('a stale hard request and old crossfade cleanup cannot clear a newer crossfade request', () => {
  const context = lifecycleFixture()
  const hardT1 = context.gate.beginHard(trackB)
  const crossfadeT2 = beginFreshCrossfadeRequest({
    song: trackC,
    cancelOldCrossfade: () => {},
    playbackRequestGate: context.gate,
    requestRef: context.requestRef,
  })
  assert.equal(context.gate.isCurrent(hardT1, trackB), false)
  finalizeCrossfadeRequest({ request: hardT1, playbackRequestGate: context.gate, requestRef: context.requestRef })
  assert.equal(context.gate.isCurrent(crossfadeT2, trackC), true)
  assert.equal(context.requestRef.current, crossfadeT2)

  const newerHardT3 = context.gate.beginHard(trackB)
  finalizeCrossfadeRequest({ request: crossfadeT2, playbackRequestGate: context.gate, requestRef: context.requestRef })
  assert.equal(context.gate.isCurrent(newerHardT3, trackB), true)
  assert.equal(context.requestRef.current, null)
})

test('a resume-output failure finalizes its own fresh request without poisoning a later play', () => {
  const context = lifecycleFixture()
  const failed = beginFreshCrossfadeRequest({
    song: trackB,
    cancelOldCrossfade: () => {},
    playbackRequestGate: context.gate,
    requestRef: context.requestRef,
  })
  context.isCrossfadingRef.current = true
  finalizeCrossfadeRequest({ request: failed, playbackRequestGate: context.gate, requestRef: context.requestRef })
  context.isCrossfadingRef.current = false
  const next = context.gate.beginHard(trackC)

  assert.equal(context.requestRef.current, null)
  assert.equal(context.isCrossfadingRef.current, false)
  assert.equal(context.gate.isCurrent(next, trackC), true)
})
