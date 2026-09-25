import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { AudioEngine } from '../audio/AudioEngine.js'
import { createYunLegacyPlayerAdapter } from '../adapters/yunLegacyPlayerAdapter.js'
import { CrossfadeController } from '../transition/CrossfadeController.js'
import {
  adjacentQueueSong,
  commitHardPlayTarget,
  createActivePlaybackRecovery,
  pauseActivePlayback,
  queuedNextTrack,
  setPlaybackModeWithQueuePolicy,
  shouldCommitHardPlayTarget,
  toggleActivePlayback,
  usesAutomaticNextQueue,
} from './playbackOrchestration.js'

test('manual previous and next wrap in single-track repeat while automatic repeat stays separate', () => {
  const songs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.equal(adjacentQueueSong(songs, 2, 1, true), songs[0])
  assert.equal(adjacentQueueSong(songs, 0, -1, true), songs[2])
  assert.equal(adjacentQueueSong(songs, 2, 1, false), null)
  assert.equal(adjacentQueueSong(songs, 0, -1, false), null)
})

test('sequence playback ignores a populated AI queue for both manual next and natural end', () => {
  const automaticTracks = [{ id: 'ai-pick' }]
  for (const mode of ['sequence', 'shuffle', 'loop_one']) {
    assert.equal(usesAutomaticNextQueue(mode), false)
    for (const auto of [false, true]) {
      assert.equal(queuedNextTrack({
        mode, auto, manualTracks: [], automaticTracks,
      }), null)
    }
  }

  const manualTrack = { id: 'manual-pick' }
  assert.deepEqual(queuedNextTrack({
    mode: 'sequence', auto: true, manualTracks: [manualTrack], automaticTracks,
  }), { song: manualTrack, queue: 'manual' })

  assert.deepEqual(queuedNextTrack({
    mode: 'ai_recommend', auto: true, manualTracks: [], automaticTracks,
  }), { song: automaticTracks[0], queue: 'automatic' })
  assert.deepEqual(queuedNextTrack({
    mode: 'companion_continue', auto: true, manualTracks: [], automaticTracks,
  }), { song: automaticTracks[0], queue: 'automatic' })
  assert.equal(usesAutomaticNextQueue('ai_recommend'), true)
  assert.equal(usesAutomaticNextQueue('companion_continue'), true)
})

class FakeDeck {
  constructor() {
    this.paused = true
    this.volume = 1
    this.currentTime = 0
    this.duration = 180
    this.playbackRate = 1
    this.src = ''
    this.playCalls = 0
    this.pauseCalls = 0
  }

  async play() {
    this.playCalls += 1
    this.paused = false
  }

  pause() {
    this.pauseCalls += 1
    this.paused = true
  }
}

function createHarness() {
  const decks = []
  const audioEngine = new AudioEngine({
    audioFactory: () => {
      const deck = new FakeDeck()
      decks.push(deck)
      return deck
    },
    audioContextFactory: () => null,
  })
  const crossfadeController = new CrossfadeController({
    audioEngine,
    debug: false,
  })
  return { audioEngine, crossfadeController, decks }
}

function createLegacySnapshot(state) {
  return {
    currentSong: state.currentSong,
    isPlaying: state.isPlaying,
    currentTime: state.currentTime,
    duration: state.duration,
    volume: 1,
    playbackMode: 'sequence',
    upNextTracks: [],
    autoUpNextTracks: [],
    getActiveQueue: () => [],
    getPlaybackDiagnostics: () => ({ isCrossfading: false }),
  }
}

test('cold-start hard play commits the first song before any next transition', async () => {
  const { audioEngine, decks } = createHarness()
  const audio = audioEngine.ensureActiveDeck()
  const song = { id: 'song-a', title: 'Song A', artist: 'Yun', fileUrl: 'song-a.mp3' }
  const currentSongRef = { current: null }
  const requestedSongRef = { current: null }
  const state = { currentSong: null, currentTime: -1, duration: -1, isPlaying: false }

  commitHardPlayTarget({
    audio,
    song,
    effectiveVolume: 0.7,
    currentSongRef,
    requestedSongRef,
    setCurrentSong: (value) => { state.currentSong = value },
    setCurrentTime: (value) => { state.currentTime = value },
    setDuration: (value) => { state.duration = value },
  })
  await audio.play()
  state.isPlaying = true

  assert.equal(decks.length, 1)
  assert.equal(audioEngine.getActiveDeck(), audio)
  assert.equal(audio.src, song.fileUrl)
  assert.equal(audio.paused, false)
  assert.equal(audio.volume, 0.7)
  assert.equal(currentSongRef.current, song)
  assert.equal(requestedSongRef.current, song)
  assert.equal(state.currentSong, song)
  assert.equal(state.currentTime, 0)
  assert.equal(state.duration, 0)

  const playerCore = createYunLegacyPlayerAdapter()
  const legacy = createLegacySnapshot(state)
  const projected = playerCore.projectLegacy(legacy)
  playerCore.updateLegacy(legacy, projected)
  playerCore.flush()

  assert.equal(projected.currentTrack, song)
  assert.equal(projected.isPlaying, true)
  assert.equal(playerCore.getState().currentTrack, song)
  assert.equal(playerCore.getState().isPlaying, true)
})

test('restored current song starts on the first play click even before an active Deck exists', async () => {
  const song = { id: 'restored-song', title: 'Restored', artist: 'Yun', fileUrl: '/api/music/file/restored' }
  const playCalls = []
  const result = await toggleActivePlayback({
    audioEngine: { getActiveDeck: () => null },
    currentSong: song,
    firstSong: song,
    playSong: async (track) => {
      playCalls.push(track)
      return { ok: true, song: track }
    },
    pausePlayback: () => ({ ok: true }),
    resumeOutput: async () => true,
  })

  assert.equal(result.ok, true)
  assert.deepEqual(playCalls, [song])
})

test('same logical track rebinds when the active Deck still owns a stale source', () => {
  const song = { id: 'song-a', title: 'Song A', artist: 'Yun', fileUrl: '/api/netease/audio?id=1' }
  const audio = { src: 'http://127.0.0.1:3030/api/netease/audio?id=2', currentSrc: '' }

  assert.equal(shouldCommitHardPlayTarget({ audio, currentSong: song, song }), true)
})

test('same logical track keeps a healthy matching Deck instead of restarting it', () => {
  const song = { id: 'song-a', title: 'Song A', artist: 'Yun', fileUrl: '/api/netease/audio?id=1' }
  const audio = { src: 'http://127.0.0.1/api/netease/audio?id=1', currentSrc: '' }

  assert.equal(shouldCommitHardPlayTarget({ audio, currentSong: song, song }), false)
})

test('switching from AI recommendation to sequence clears automatic recommendations', () => {
  const playbackModeRef = { current: 'ai_recommend' }
  const stateChanges = []
  const persisted = []
  let clearedAutomaticQueue = 0
  let clearedQueuedNext = 0

  const changed = setPlaybackModeWithQueuePolicy({
    mode: 'sequence',
    validModes: ['sequence', 'ai_recommend'],
    playbackModeRef,
    setPlaybackModeState: (mode) => stateChanges.push(mode),
    persistPlaybackMode: (mode) => persisted.push(mode),
    clearAutomaticQueue: () => { clearedAutomaticQueue += 1 },
    clearQueuedNext: () => { clearedQueuedNext += 1 },
  })

  assert.equal(changed, true)
  assert.equal(playbackModeRef.current, 'sequence')
  assert.deepEqual(stateChanges, ['sequence'])
  assert.deepEqual(persisted, ['sequence'])
  assert.equal(clearedAutomaticQueue, 1)
  assert.equal(clearedQueuedNext, 1)
})

test('stable playback pause owns the real active Deck and resume reuses it', async () => {
  const { audioEngine, crossfadeController, decks } = createHarness()
  const activeDeck = audioEngine.ensureActiveDeck()
  activeDeck.src = 'song-a.mp3'
  await activeDeck.play()

  const result = pauseActivePlayback({
    audioEngine,
    cancelTransition: () => crossfadeController.cancel(),
  })

  assert.equal(result.cancellation.hadTransaction, false)
  assert.equal(result.activeDeck, activeDeck)
  assert.equal(audioEngine.getActiveDeck(), activeDeck)
  assert.equal(activeDeck.paused, true)

  await activeDeck.play()
  assert.equal(activeDeck.paused, false)
  assert.equal(audioEngine.getActiveDeck(), activeDeck)
  assert.equal(decks.length, 1)
})

test('pause resolves the active Deck after transition stabilization', async () => {
  const { audioEngine } = createHarness()
  const oldActive = audioEngine.ensureActiveDeck()
  const promotedActive = audioEngine.ensureStandbyDeck()
  await oldActive.play()
  await promotedActive.play()

  const result = pauseActivePlayback({
    audioEngine,
    cancelTransition: () => {
      oldActive.pause()
      oldActive.volume = 0
      audioEngine.swapDecks()
      return { hadTransaction: true, activeDeckChanged: true }
    },
  })

  assert.equal(result.activeDeck, promotedActive)
  assert.equal(audioEngine.getActiveDeck(), promotedActive)
  assert.equal(promotedActive.paused, true)
  assert.equal(oldActive.paused, true)
  assert.equal(oldActive.volume, 0)
})

test('StrictMode-like dispose and setup replay reactivates cancellation', async () => {
  const { audioEngine, crossfadeController } = createHarness()
  crossfadeController.reactivate()
  crossfadeController.dispose()
  crossfadeController.reactivate()

  const activeDeck = audioEngine.ensureActiveDeck()
  await activeDeck.play()
  const result = pauseActivePlayback({
    audioEngine,
    cancelTransition: () => crossfadeController.cancel(),
  })

  assert.equal(result.cancellation.hadTransaction, false)
  assert.equal(result.activeDeck, activeDeck)
  assert.equal(activeDeck.paused, true)
  assert.equal(crossfadeController.getDiagnostics().phase, 'idle')
})

test('useLocalPlayer wires replay activation and explicit active-Deck pause', () => {
  const source = readFileSync(new URL('../../hooks/useLocalPlayer.js', import.meta.url), 'utf8')
  const lifecycleStart = source.lastIndexOf('  useEffect(() => {')
  const lifecycleEnd = source.indexOf('\n\n  return {', lifecycleStart)
  const lifecycleEffect = source.slice(lifecycleStart, lifecycleEnd)

  assert.ok(lifecycleStart >= 0)
  assert.ok(lifecycleEnd > lifecycleStart)
  assert.match(lifecycleEffect, /crossfadeController\.reactivate\(\)/)
  assert.match(lifecycleEffect, /crossfadeController\.dispose\(\)/)
  assert.match(source, /pauseActivePlayback\(\{ audioEngine, cancelTransition: cancelCrossfade \}\)/)
  assert.doesNotMatch(source, /cancelCrossfade\(\{\s*pauseActive:/)
})

class RecoverableDeck extends FakeDeck {
  constructor() {
    super()
    this.src = '/api/netease/audio?id=2053420961'
    this.currentSrc = this.src
    this.currentTime = 70
    this.duration = 222
    this.paused = false
    this.loadCalls = 0
    this.listeners = new Map()
  }

  addEventListener(type, callback) {
    this.listeners.set(type, callback)
  }

  removeEventListener(type, callback) {
    if (this.listeners.get(type) === callback) this.listeners.delete(type)
  }

  load() {
    this.loadCalls += 1
    this.currentTime = 0
    this.listeners.get('loadedmetadata')?.()
  }
}

function createRecoveryScheduler() {
  let nextHandle = 1
  const timers = new Map()
  return {
    timers,
    setTimer(callback) {
      const handle = nextHandle++
      timers.set(handle, callback)
      return handle
    },
    clearTimer(handle) {
      timers.delete(handle)
    },
    async runAll() {
      const callbacks = [...timers.values()]
      timers.clear()
      callbacks.forEach((callback) => callback())
      await Promise.resolve()
      await Promise.resolve()
    },
  }
}

test('stalled active playback reloads the NetEase stream at the preserved position and resumes output', async () => {
  const audio = new RecoverableDeck()
  const scheduler = createRecoveryScheduler()
  const resumeCalls = []
  const recovery = createActivePlaybackRecovery({ scheduler, stallDelayMs: 25 })

  const scheduled = recovery.schedule({
    audio,
    isActive: (candidate) => candidate === audio,
    resumeOutput: async (candidate) => { resumeCalls.push(candidate) },
  })
  await scheduler.runAll()

  assert.equal(scheduled, true)
  assert.equal(audio.loadCalls, 1)
  assert.equal(audio.currentTime, 70)
  assert.equal(audio.playCalls, 1)
  assert.deepEqual(resumeCalls, [audio])
})

test('transient media waiting that advances playback does not reload the stream', async () => {
  const audio = new RecoverableDeck()
  const scheduler = createRecoveryScheduler()
  const recovery = createActivePlaybackRecovery({ scheduler, stallDelayMs: 25 })

  recovery.schedule({
    audio,
    isActive: (candidate) => candidate === audio,
    resumeOutput: async () => {},
  })
  audio.currentTime = 71
  await scheduler.runAll()

  assert.equal(audio.loadCalls, 0)
  assert.equal(audio.playCalls, 0)
})

test('useLocalPlayer routes waiting and stalled events through active playback recovery', () => {
  const source = readFileSync(new URL('../../hooks/useLocalPlayer.js', import.meta.url), 'utf8')

  assert.match(source, /createActivePlaybackRecovery\(/)
  assert.match(source, /addEventListener\('waiting',\s*handlePlaybackStall\)/)
  assert.match(source, /addEventListener\('stalled',\s*handlePlaybackStall\)/)
  assert.match(source, /activePlaybackRecovery\.schedule\(/)
})
