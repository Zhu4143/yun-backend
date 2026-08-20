import test from 'node:test'
import assert from 'node:assert/strict'
import { INITIAL_PLAYER_STATE, PLAYER_STATUS, playerStateEquals } from './playerTypes.js'

test('INITIAL_PLAYER_STATE contains all Phase 2 fields', () => {
  assert.equal(INITIAL_PLAYER_STATE.currentTrack, null)
  assert.equal(INITIAL_PLAYER_STATE.isPlaying, false)
  assert.equal(INITIAL_PLAYER_STATE.status, PLAYER_STATUS.IDLE)
  assert.deepEqual(INITIAL_PLAYER_STATE.queue, [])
  assert.deepEqual(INITIAL_PLAYER_STATE.upNext, [])
  assert.deepEqual(INITIAL_PLAYER_STATE.autoUpNext, [])
  assert.equal(INITIAL_PLAYER_STATE.lyrics, null)
  assert.equal(INITIAL_PLAYER_STATE.dominantColor, null)
  assert.equal(INITIAL_PLAYER_STATE.audioFeatures, null)
  assert.equal(INITIAL_PLAYER_STATE.trackChangeProgress, 0)
})

test('playerStateEquals compares every Phase 2 field by identity', () => {
  const base = { ...INITIAL_PLAYER_STATE }
  assert.equal(playerStateEquals(base, { ...base }), true)
  assert.equal(playerStateEquals(base, { ...base, currentTime: 1 }), false)
  assert.equal(playerStateEquals(base, { ...base, queue: [{ id: 'x' }] }), false)
  assert.equal(playerStateEquals(base, { ...base, trackChangeProgress: 1 }), false)
  assert.equal(playerStateEquals(base, { ...base, lyrics: { lines: [] } }), false)
})
