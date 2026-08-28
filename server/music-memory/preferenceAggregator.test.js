import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMusicPreferenceSnapshot } from './preferenceAggregator.js'
import { ListeningSessionTracker } from '../../src/player/listening/ListeningSessionTracker.js'

const now = '2026-08-28T00:00:00.000Z'
const track = (id, artist = 'Artist') => ({ trackId: id, providerId: id, source: 'netease', title: id, artist })
const event = (id, type, idTrack, timestamp = now, metadata = {}) => ({ id, type, ...track(idTrack), timestamp, metadata })
const observation = (id, idTrack, values = {}) => ({ id, ...track(idTrack, values.artist || 'Artist'), provenance: 'netease_history_sync', observedAt: values.observedAt || now, playCount: values.playCount ?? null, metadata: values.metadata || {} })
const aggregate = (events, observations) => buildMusicPreferenceSnapshot({ listeningEvents: events, musicObservations: observations, generatedAt: now })

test('direct complete and repeat outrank a direct skip', () => {
  const snapshot = aggregate([event('a1', 'play', 'A'), event('a2', 'complete', 'A'), event('a3', 'repeat', 'A'), event('b1', 'play', 'B'), event('b2', 'skip', 'B')], [])
  assert.ok(snapshot.tracks.A.derived.longTermAffinity > snapshot.tracks.B.derived.longTermAffinity)
})
test('provider-only evidence never invents direct behavior', () => {
  const value = aggregate([], [observation('p1', 'A', { playCount: 20 })]).tracks.A
  assert.equal(value.providerObservation.providerReportedCount, 20); assert.equal(value.directListening.completeCount, 0); assert.equal(value.directListening.skipCount, 0); assert.equal(value.directListening.seekCount, 0)
})
test('provider history cannot erase direct skip tendency', () => {
  const value = aggregate([event('d1', 'play', 'A'), event('d2', 'skip', 'A')], [observation('p1', 'A', { playCount: 100 })]).tracks.A
  assert.equal(value.directListening.skipCount, 1); assert.equal(value.providerObservation.providerReportedCount, 100); assert.ok(value.derived.longTermAffinity < 0)
})
test('high-confidence direct completion and repeat dominate a small provider observation', () => {
  const snapshot = aggregate([event('b1', 'play', 'B'), event('b2', 'complete', 'B'), event('b3', 'repeat', 'B')], [observation('p1', 'B', { playCount: 1 })])
  assert.equal(snapshot.tracks.B.derived.confidence, 'high'); assert.ok(snapshot.tracks.B.derived.longTermAffinity > 3)
})
test('rebuilding same evidence is idempotent and input order independent', () => {
  const events = [event('a2', 'complete', 'A'), event('a1', 'play', 'A')]; const observations = [observation('p1', 'A', { playCount: 2 })]
  assert.deepEqual(aggregate(events, observations), aggregate([...events].reverse(), observations))
})
test('duplicate raw evidence ids are not double-counted when repository has deduped them', () => {
  const snapshot = aggregate([event('unique', 'play', 'A')], [])
  assert.equal(snapshot.tracks.A.directListening.playCount, 1)
})
test('provider played time stays provider provenance and observed time stays observation time', () => {
  const value = aggregate([], [observation('p1', 'A', { observedAt: now, metadata: { providerPlayedAt: '2026-08-01T00:00:00.000Z' } })]).tracks.A.providerObservation
  assert.equal(value.lastObservedAt, now); assert.equal(value.lastProviderPlayedAt, '2026-08-01T00:00:00.000Z')
})
test('nullish and empty provider counts remain unknown rather than zero evidence', () => {
  const value = aggregate([], [observation('p1', 'A', { playCount: null }), observation('p2', 'B', { playCount: '' })])
  assert.equal(value.tracks.A.providerObservation.providerReportedCount, null); assert.equal(value.tracks.B.providerObservation.providerReportedCount, null)
})
test('artist aggregates two tracks deterministically', () => {
  const snapshot = aggregate([event('a1', 'play', 'A'), { ...event('b1', 'complete', 'B'), artist: 'Artist' }], [])
  assert.equal(snapshot.artists.Artist.trackCount, 2); assert.equal(snapshot.artists.Artist.directPlayCount, 1); assert.equal(snapshot.artists.Artist.directCompleteCount, 1)
})
test('recent affinity decays while long-term affinity retains older behavior', () => {
  const old = '2025-08-28T00:00:00.000Z'; const snapshot = aggregate([event('old', 'play', 'A', old), event('new', 'play', 'B', now)], [])
  assert.ok(snapshot.tracks.B.derived.recentAffinity > snapshot.tracks.A.derived.recentAffinity); assert.equal(snapshot.tracks.A.derived.longTermAffinity, snapshot.tracks.B.derived.longTermAffinity)
})
test('real ListeningSessionTracker next plus terminal skip is one navigation and one skip tendency', () => {
  const events = []; const tracker = new ListeningSessionTracker({ reporter: { report: (value) => events.push(value) }, now: () => new Date(now), idFactory: () => 'session' })
  tracker.actualPlay({ id: 'A', source: 'netease', title: 'A', artist: 'Artist' }); tracker.prepareTransition({ type: 'next', reason: 'user_next' }); tracker.actualPlay({ id: 'B', source: 'netease', title: 'B', artist: 'Artist' })
  const snapshot = aggregate(events, []); const a = snapshot.tracks.A
  assert.deepEqual(events.map((value) => value.type), ['play', 'next', 'skip', 'play']); assert.equal(a.directListening.nextCount, 1); assert.equal(a.directListening.skipCount, 1); assert.equal(a.derived.skipRate, 1); assert.equal(a.derived.recentAffinity, -1.4)
})
test('real ListeningSessionTracker previous plus terminal skip is not double counted', () => {
  const events = []; const tracker = new ListeningSessionTracker({ reporter: { report: (value) => events.push(value) }, now: () => new Date(now), idFactory: () => 'session' })
  tracker.actualPlay({ id: 'A', source: 'netease', title: 'A', artist: 'Artist' }); tracker.prepareTransition({ type: 'previous', reason: 'user_previous' }); tracker.actualPlay({ id: 'B', source: 'netease', title: 'B', artist: 'Artist' })
  const a = aggregate(events, []).tracks.A; assert.equal(a.directListening.previousCount, 1); assert.equal(a.directListening.skipCount, 1); assert.equal(a.derived.skipRate, 1)
})
test('empty evidence has no invented asOfAt frontier', () => { assert.equal(aggregate([], []).asOfAt, null) })
