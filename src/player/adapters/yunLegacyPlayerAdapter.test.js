import test from 'node:test'
import assert from 'node:assert/strict'
import { createYunLegacyPlayerAdapter } from './yunLegacyPlayerAdapter.js'
import { PLAYER_STATUS } from '../playerTypes.js'

const QUEUE = [{ id: 'a' }, { id: 'b' }]
const UP_NEXT = [{ id: 'b' }]
const AUTO_UP_NEXT = [{ id: 'c' }]
const CURRENT_SONG = { id: 'a', title: 'Song A' }

function makeLegacy(overrides = {}) {
  return {
    currentSong: CURRENT_SONG,
    isPlaying: true,
    currentTime: 10,
    duration: 200,
    volume: 0.8,
    playbackMode: 'sequence',
    upNextTracks: UP_NEXT,
    autoUpNextTracks: AUTO_UP_NEXT,
    getActiveQueue: () => QUEUE,
    getPlaybackDiagnostics: () => ({ isCrossfading: false }),
    ...overrides,
  }
}

test('projectLegacy is render-safe and does not mutate or notify the external store', () => {
  const core = createYunLegacyPlayerAdapter()
  const initialState = core.getState()
  let notified = 0
  core.subscribe(() => { notified += 1 })

  const projectedState = core.projectLegacy(makeLegacy())

  assert.equal(projectedState.currentTrack, CURRENT_SONG)
  assert.equal(core.getState(), initialState)
  core.flush()
  assert.equal(notified, 0)
})

test('projectLegacy does not rebind command delegation before commit', async () => {
  const calls = []
  const core = createYunLegacyPlayerAdapter()
  const committedLegacy = makeLegacy({
    togglePlayPause: async () => { calls.push('committed'); return { ok: true } },
  })
  const renderedLegacy = makeLegacy({
    togglePlayPause: async () => { calls.push('rendered'); return { ok: true } },
  })

  core.updateLegacy(committedLegacy)
  core.projectLegacy(renderedLegacy)
  await core.togglePlay()
  core.updateLegacy(renderedLegacy)
  await core.togglePlay()

  assert.deepEqual(calls, ['committed', 'rendered'])
})

test('updateLegacy bridges playback fields into the store state', () => {
  const core = createYunLegacyPlayerAdapter()
  const legacy = makeLegacy()
  const projectedState = core.projectLegacy(legacy)
  const state = core.updateLegacy(legacy, projectedState)
  assert.equal(state, projectedState)
  assert.equal(state.currentTrack, CURRENT_SONG)
  assert.equal(state.isPlaying, true)
  assert.equal(state.currentTime, 10)
  assert.equal(state.duration, 200)
  assert.equal(state.volume, 0.8)
  assert.equal(state.playbackMode, 'sequence')
  assert.equal(state.status, PLAYER_STATUS.PLAYING)
  assert.equal(state.error, null)
})

test('updateLegacy bridges queue / upNext / autoUpNext / trackChangeProgress', () => {
  const core = createYunLegacyPlayerAdapter()
  const state = core.updateLegacy(makeLegacy())
  assert.equal(state.queue, QUEUE)
  assert.equal(state.upNext, UP_NEXT)
  assert.equal(state.autoUpNext, AUTO_UP_NEXT)
  assert.equal(state.trackChangeProgress, 0)
  assert.equal(state.lyrics, null)
  assert.equal(state.dominantColor, null)
  assert.equal(state.audioFeatures, null)
})

test('trackChangeProgress reflects crossfade state', () => {
  const core = createYunLegacyPlayerAdapter()
  const state = core.updateLegacy(makeLegacy({ getPlaybackDiagnostics: () => ({ isCrossfading: true }) }))
  assert.equal(state.trackChangeProgress, 1)
})

test('updateLegacy does not notify when the state is unchanged', () => {
  const core = createYunLegacyPlayerAdapter()
  const legacy = makeLegacy()
  core.updateLegacy(legacy)
  let notified = 0
  core.subscribe(() => { notified += 1 })
  core.flush()
  notified = 0
  core.updateLegacy(legacy)
  core.flush()
  assert.equal(notified, 0)
})

test('flush emits exactly once after a state change', () => {
  const core = createYunLegacyPlayerAdapter()
  core.updateLegacy(makeLegacy({ currentTime: 0 }))
  let notified = 0
  core.subscribe(() => { notified += 1 })
  core.flush()
  core.flush()
  assert.equal(notified, 1)
})
