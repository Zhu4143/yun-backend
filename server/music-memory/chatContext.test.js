import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMusicPreferenceChatContext, isMusicMemoryRelevant } from './chatContext.js'

const track = (id, options = {}) => ({ trackId: id, title: id, artist: options.artist || 'Artist', directListening: options.direct || {}, providerObservation: options.provider || {}, derived: { confidence: options.confidence || 'high', recentAffinity: options.recent || 0, longTermAffinity: options.long || 0, ...options.derived } })

test('chat context is relevance-gated, deterministic, bounded, and contains only safe inferred evidence', () => {
  const tracks = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`T${index}`, track(`T${index}`, { recent: 20 - index, direct: { completeCount: 2, skipCount: 0, repeatCount: 1 } })]))
  tracks.P = track('P', { confidence: 'medium', provider: { providerReportedCount: 100, metadata: { cookie: 'secret' } }, recent: 30, derived: { token: 'nope' } })
  const snapshot = { tracks, accountId: 'account', cookie: 'cookie', authorization: 'auth' }
  const first = buildMusicPreferenceChatContext(snapshot, { currentSong: { id: 'T1' } })
  const second = buildMusicPreferenceChatContext(snapshot, { currentSong: { id: 'T1' } })
  assert.equal(isMusicMemoryRelevant('我最近喜欢听什么？'), true); assert.equal(isMusicMemoryRelevant('今天有点累'), false)
  assert.deepEqual(first, second); assert.equal(first.preferences.length, 5); assert.equal(first.currentTrack.title, 'T1')
  assert.match(first.prompt, /Direct player evidence is stronger/); assert.match(first.prompt, /never completion, skip, seek, pause, duration/)
  assert.doesNotMatch(JSON.stringify(first), /account|cookie|secret|auth|token/)
})

test('provider-only context never claims direct completion, skip, or repeat and empty snapshots are unavailable', () => {
  const result = buildMusicPreferenceChatContext({ tracks: { P: track('P', { confidence: 'medium', provider: { providerReportedCount: 100 } }) } })
  assert.equal(result.preferences[0].signal, 'provider exposure only'); assert.equal(result.preferences[0].direct, null)
  assert.deepEqual(buildMusicPreferenceChatContext(null), { available: false, prompt: '' })
})
