import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_MEMORY_ADJUSTMENT, MIN_MEMORY_ADJUSTMENT, rankWithMusicPreferences } from './musicPreferenceRanker.js'

const song = (id, artist = 'X', baseScore = 0) => ({ id, providerId: id, title: id, artist, baseScore })
const snapshot = (tracks = {}, artists = {}) => ({ tracks, artists })
const positive = (confidence = 'high') => ({ directListening: { playCount: 4, skipCount: 0 }, derived: { recentAffinity: 3, longTermAffinity: 5, skipRate: 0, confidence } })
const negative = (confidence = 'high') => ({ directListening: { playCount: 4, skipCount: 4 }, providerObservation: { providerReportedCount: 1000000 }, derived: { recentAffinity: 3, longTermAffinity: 999, skipRate: 1, confidence } })

test('direct positive, provider weakness, artist fallback, and negative override are deterministic', () => {
  const prefs = snapshot({ A: positive(), N: negative() }, { Y: { longTermAffinity: 10 } })
  const ranked = rankWithMusicPreferences({ candidates: [song('B'), song('A'), song('N', 'Y'), song('C', 'Y')], preferenceSnapshot: prefs })
  assert.deepEqual(ranked.map((item) => item.id), ['A', 'C', 'B', 'N'])
  assert.ok(ranked[0].recommendationMemory.memoryAdjustment > ranked[2].recommendationMemory.memoryAdjustment)
  assert.ok(ranked.at(-1).recommendationMemory.memoryAdjustment < 0)
})
test('confidence scales positive and negative adjustments and caps all influence', () => {
  const prefs = snapshot({ H: positive('high'), M: positive('medium'), NH: negative('high'), NM: negative('medium') })
  const ranked = rankWithMusicPreferences({ candidates: ['H', 'M', 'NH', 'NM'].map((id) => song(id)), preferenceSnapshot: prefs })
  const values = Object.fromEntries(ranked.map((item) => [item.id, item.recommendationMemory.memoryAdjustment]))
  assert.ok(values.H > values.M); assert.ok(values.NH < values.NM)
  for (const value of Object.values(values)) assert.ok(value >= MIN_MEMORY_ADJUSTMENT && value <= MAX_MEMORY_ADJUSTMENT)
})
test('null, empty, unknown snapshots preserve canonical base-score ranking without mutation', () => {
  const candidates = [song('B', 'X', 5), song('A', 'X', 10)]; const original = structuredClone(candidates)
  assert.deepEqual(rankWithMusicPreferences({ candidates, preferenceSnapshot: null }).map((item) => item.id), ['A', 'B'])
  assert.deepEqual(rankWithMusicPreferences({ candidates: [...candidates].reverse(), preferenceSnapshot: {} }).map((item) => item.id), ['A', 'B'])
  assert.deepEqual(candidates, original)
})
