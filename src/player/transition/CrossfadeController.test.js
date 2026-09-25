import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CROSSFADE_DURATION,
  CROSSFADE_START_VOLUME,
  CrossfadeController,
  equalPowerFadeIn,
  equalPowerFadeOut,
} from './CrossfadeController.js'

class FakeDeck {
  constructor(id) {
    this.id = id
    this.paused = false
    this.volume = 1
    this.duration = 180
    this.currentTime = 30
    this.playbackRate = 1
    this.src = `${id}.mp3`
    this.playCalls = 0
    this.pauseCalls = 0
    this.playQueue = []
  }

  play() {
    this.playCalls += 1
    const result = this.playQueue.length ? this.playQueue.shift() : Promise.resolve()
    return Promise.resolve(result).then(() => {
      this.paused = false
    })
  }

  pause() {
    this.paused = true
    this.pauseCalls += 1
  }
}

class FakeAudioEngine {
  constructor() {
    this.activeDeck = new FakeDeck('active')
    this.standbyDeck = new FakeDeck('standby')
    this.standbyDeck.paused = true
    this.standbyDeck.volume = 0
    this.userVolume = 1
    this.swapCalls = 0
    this.resumeCalls = []
    this.crossfadeEnvelopeCalls = []
    this.audioThreadEnvelopes = false
  }

  getActiveDeck() {
    return this.activeDeck
  }

  getStandbyDeck() {
    return this.standbyDeck
  }

  ensureStandbyDeck() {
    return this.standbyDeck
  }

  getUserVolume() {
    return this.userVolume
  }

  async resumeOutput(deck) {
    this.resumeCalls.push(deck)
    return true
  }

  scheduleCrossfadeEnvelopes(options) {
    this.crossfadeEnvelopeCalls.push(options)
    return this.audioThreadEnvelopes
  }

  swapDecks() {
    const activeDeck = this.activeDeck
    this.activeDeck = this.standbyDeck
    this.standbyDeck = activeDeck
    this.swapCalls += 1
    return this.activeDeck
  }
}

class FakeScheduler {
  constructor() {
    this.time = 0
    this.nextHandle = 1
    this.frames = new Map()
    this.timers = new Map()
    this.cancelledFrames = []
    this.clearedTimers = []
  }

  now = () => this.time

  requestFrame = (callback) => {
    const handle = this.nextHandle++
    this.frames.set(handle, callback)
    return handle
  }

  cancelFrame = (handle) => {
    this.cancelledFrames.push(handle)
    this.frames.delete(handle)
  }

  setTimer = (callback, delay) => {
    const handle = this.nextHandle++
    this.timers.set(handle, { callback, dueAt: this.time + delay })
    return handle
  }

  clearTimer = (handle) => {
    this.clearedTimers.push(handle)
    this.timers.delete(handle)
  }

  runFramesAt(time) {
    this.time = time
    const callbacks = [...this.frames.entries()]
    this.frames.clear()
    callbacks.forEach(([, callback]) => callback(time))
  }

  runTimersAt(time) {
    this.time = time
    const due = [...this.timers.entries()].filter(([, timer]) => timer.dueAt <= time)
    due.forEach(([handle]) => this.timers.delete(handle))
    due.forEach(([, timer]) => timer.callback())
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function flushMicrotasks(count = 8) {
  for (let index = 0; index < count; index += 1) await Promise.resolve()
}

function makeHarness(overrides = {}) {
  const audioEngine = overrides.audioEngine || new FakeAudioEngine()
  const scheduler = overrides.scheduler || new FakeScheduler()
  const controller = new CrossfadeController({
    audioEngine,
    scheduler,
    getEffectiveVolume: () => audioEngine.userVolume,
    debug: true,
    logger: { error: () => {} },
  })
  return { audioEngine, scheduler, controller }
}

async function startPreparedTransition(harness, options = {}) {
  const promise = harness.controller.startTransition({
    source: options.source || 'next.mp3',
    metadata: options.metadata || { id: 'next' },
    transitionPlan: options.transitionPlan || null,
    shouldPromoteTarget: options.shouldPromoteTarget || (() => true),
    onPrepared: options.onPrepared,
    onTargetPlaying: options.onTargetPlaying,
    onCommitted: options.onCommitted,
    onFailed: options.onFailed,
  })
  await flushMicrotasks()
  return { promise }
}

test('start creates one 7000ms imperative transaction at progress zero', async () => {
  const harness = makeHarness()
  const { promise } = await startPreparedTransition(harness)
  const diagnostics = harness.controller.getDiagnostics()

  assert.equal(CROSSFADE_DURATION, 7000)
  assert.equal(diagnostics.isCrossfading, true)
  assert.equal(diagnostics.duration, 7000)
  assert.equal(diagnostics.progress, 0)
  assert.equal(diagnostics.phase, 'fading')
  assert.equal(harness.audioEngine.standbyDeck.volume, CROSSFADE_START_VOLUME)

  harness.controller.cancel()
  await promise
})

test('equal-power envelope remains mathematically equivalent at 0, 0.5 and 1', async () => {
  assert.equal(equalPowerFadeIn(0), 0)
  assert.equal(equalPowerFadeOut(0), 1)
  assert.ok(Math.abs(equalPowerFadeIn(0.5) - Math.SQRT1_2) < 1e-12)
  assert.ok(Math.abs(equalPowerFadeOut(0.5) - Math.SQRT1_2) < 1e-12)
  assert.equal(equalPowerFadeIn(1), 1)
  assert.ok(Math.abs(equalPowerFadeOut(1)) < 1e-12)

  const harness = makeHarness()
  const fromDeck = harness.audioEngine.activeDeck
  const toDeck = harness.audioEngine.standbyDeck
  const { promise } = await startPreparedTransition(harness)
  harness.scheduler.runFramesAt(3500)

  assert.equal(harness.controller.getDiagnostics().progress, 0.5)
  assert.ok(Math.abs(fromDeck.volume - Math.SQRT1_2) < 1e-12)
  const expectedIncoming = CROSSFADE_START_VOLUME + (1 - CROSSFADE_START_VOLUME) * Math.SQRT1_2
  assert.ok(Math.abs(toDeck.volume - expectedIncoming) < 1e-12)

  harness.scheduler.runFramesAt(7000)
  await promise
})

test('audio-thread envelopes start before RAF so background throttling cannot hard-cut', async () => {
  const harness = makeHarness()
  harness.audioEngine.audioThreadEnvelopes = true
  const { promise } = await startPreparedTransition(harness)
  const [scheduled] = harness.audioEngine.crossfadeEnvelopeCalls

  assert.equal(harness.scheduler.frames.size, 1)
  assert.equal(scheduled.durationMs, 7000)
  assert.equal(scheduled.fromDeck, harness.audioEngine.activeDeck)
  assert.equal(scheduled.toDeck, harness.audioEngine.standbyDeck)
  assert.equal(scheduled.fadeOutCurve[0], 1)
  assert.ok(Math.abs(scheduled.fadeOutCurve[64] - Math.SQRT1_2) < 0.02)
  assert.ok(scheduled.fadeOutCurve.at(-1) < 1e-6)
  assert.ok(Math.abs(scheduled.fadeInCurve[0] - CROSSFADE_START_VOLUME) < 1e-6)
  assert.ok(scheduled.fadeInCurve.at(-1) > 0.999)

  // Simulate a background tab whose visual RAF does not run until the end.
  // The Web Audio curves above are already owned by the audio thread.
  harness.scheduler.runFramesAt(7000)
  const result = await promise
  assert.equal(result.ok, true)
})

test('successful transition swaps once and leaves old Deck stopped and silent', async () => {
  const harness = makeHarness()
  const fromDeck = harness.audioEngine.activeDeck
  const toDeck = harness.audioEngine.standbyDeck
  let commits = 0
  const { promise } = await startPreparedTransition(harness, { onCommitted: () => { commits += 1 } })

  harness.scheduler.runFramesAt(7000)
  const result = await promise

  assert.equal(result.ok, true)
  assert.equal(harness.audioEngine.swapCalls, 1)
  assert.equal(commits, 1)
  assert.equal(harness.audioEngine.getActiveDeck(), toDeck)
  assert.equal(toDeck.volume, 1)
  assert.equal(fromDeck.paused, true)
  assert.equal(fromDeck.currentTime, 0)
  assert.equal(fromDeck.volume, 0)
  assert.equal(harness.audioEngine.getStandbyDeck().volume, 0)
  assert.equal(harness.controller.getDiagnostics().isCrossfading, false)
})

test('cancel stops RAF, clears recovery, invalidates transaction and restores stable Decks', async () => {
  const harness = makeHarness()
  const { promise } = await startPreparedTransition(harness, { shouldPromoteTarget: () => false })
  const transactionId = harness.controller.getDiagnostics().transactionId
  assert.equal(harness.scheduler.frames.size, 1)
  assert.equal(harness.scheduler.timers.size, 1)

  const cancellation = harness.controller.cancel()
  const result = await promise

  assert.equal(cancellation.hadTransaction, true)
  assert.equal(result.error, 'crossfade_cancelled')
  assert.equal(harness.scheduler.frames.size, 0)
  assert.equal(harness.scheduler.timers.size, 0)
  assert.equal(harness.scheduler.cancelledFrames.length, 1)
  assert.equal(harness.scheduler.clearedTimers.length, 1)
  assert.equal(harness.audioEngine.getActiveDeck().volume, 1)
  assert.equal(harness.audioEngine.getStandbyDeck().volume, 0)
  assert.equal(harness.audioEngine.getStandbyDeck().paused, true)

  const nextPromise = harness.controller.startTransition({ source: 'later.mp3' })
  assert.notEqual(harness.controller.getDiagnostics().transactionId, transactionId)
  harness.controller.cancel()
  await nextPromise
})

test('superseded pending play cannot pause or commit the reused standby Deck', async () => {
  const harness = makeHarness()
  const oldPlay = deferred()
  harness.audioEngine.standbyDeck.playQueue.push(oldPlay.promise, Promise.resolve())

  const oldPromise = harness.controller.startTransition({
    source: 'b.mp3',
    metadata: { id: 'b' },
    shouldPromoteTarget: () => true,
  })
  await flushMicrotasks()
  const nextPromise = harness.controller.startTransition({
    source: 'c.mp3',
    metadata: { id: 'c' },
    shouldPromoteTarget: () => true,
  })
  await flushMicrotasks()

  oldPlay.resolve()
  await flushMicrotasks()
  assert.equal(harness.audioEngine.standbyDeck.paused, false)
  assert.equal(harness.audioEngine.swapCalls, 0)

  harness.scheduler.runFramesAt(7000)
  const [oldResult, nextResult] = await Promise.all([oldPromise, nextPromise])
  assert.equal(oldResult.error, 'crossfade_cancelled')
  assert.equal(nextResult.ok, true)
  assert.equal(harness.audioEngine.swapCalls, 1)
  assert.equal(harness.audioEngine.activeDeck.src, 'c.mp3')
})

test('rapid B then C then D supersede sequence never allows a stale double swap', async () => {
  const harness = makeHarness()
  const { promise: first } = await startPreparedTransition(harness, { source: 'b.mp3', metadata: { id: 'b' } })
  const { promise: second } = await startPreparedTransition(harness, { source: 'c.mp3', metadata: { id: 'c' } })
  const { promise: third } = await startPreparedTransition(harness, { source: 'd.mp3', metadata: { id: 'd' } })

  harness.scheduler.runFramesAt(7000)
  const results = await Promise.all([first, second, third])

  assert.deepEqual(results.map((result) => result.ok), [false, false, true])
  assert.equal(harness.audioEngine.swapCalls, 3)
  assert.equal(harness.audioEngine.activeDeck.src, 'd.mp3')
  assert.equal(harness.audioEngine.activeDeck.volume, 1)
  assert.equal(harness.audioEngine.standbyDeck.volume, 0)
  assert.equal(harness.audioEngine.standbyDeck.paused, true)
  assert.equal(harness.controller.getDiagnostics().phase, 'idle')
})

test('next at 20% and 80% promotes the audible target before starting the replacement transition', async () => {
  for (const progress of [0.2, 0.8]) {
    const harness = makeHarness()
    const { promise: first } = await startPreparedTransition(harness, {
      source: 'b.mp3',
      metadata: { id: 'b' },
    })
    const supersededAt = 7000 * progress
    harness.scheduler.runFramesAt(supersededAt)

    const { promise: second } = await startPreparedTransition(harness, {
      source: 'c.mp3',
      metadata: { id: 'c' },
    })
    assert.equal(harness.audioEngine.swapCalls, 1)
    assert.equal(harness.audioEngine.activeDeck.src, 'b.mp3')

    harness.scheduler.runFramesAt(supersededAt + 7000)
    const results = await Promise.all([first, second])
    assert.deepEqual(results.map((result) => result.ok), [false, true])
    assert.equal(harness.audioEngine.swapCalls, 2)
    assert.equal(harness.audioEngine.activeDeck.src, 'c.mp3')
    assert.equal(harness.audioEngine.activeDeck.volume, 1)
    assert.equal(harness.audioEngine.standbyDeck.volume, 0)
    assert.equal(harness.audioEngine.standbyDeck.paused, true)
  }
})

test('cancel at 20% and 80% always restores volume and playbackRate invariants', async () => {
  for (const progress of [0.2, 0.8]) {
    const harness = makeHarness()
    const { promise } = await startPreparedTransition(harness, {
      transitionPlan: { crossfadeMs: 7000, fromRate: 0.95, toRate: 1.05 },
      shouldPromoteTarget: () => false,
    })
    harness.scheduler.runFramesAt(7000 * progress)
    harness.controller.cancel()
    await promise

    assert.equal(harness.audioEngine.activeDeck.volume, 1)
    assert.equal(harness.audioEngine.standbyDeck.volume, 0)
    assert.equal(harness.audioEngine.standbyDeck.paused, true)
    assert.equal(harness.audioEngine.activeDeck.playbackRate, 1)
    assert.equal(harness.audioEngine.standbyDeck.playbackRate, 1)
    assert.equal(harness.scheduler.frames.size, 0)
    assert.equal(harness.scheduler.timers.size, 0)
  }
})

test('transition playbackRate ramps and returns both Decks to stable rate after finish', async () => {
  const harness = makeHarness()
  const fromDeck = harness.audioEngine.activeDeck
  const toDeck = harness.audioEngine.standbyDeck
  const { promise } = await startPreparedTransition(harness, {
    transitionPlan: {
      crossfadeMs: 7000,
      fromRate: 0.5,
      toRate: 1.5,
      restoreDurationMs: 9000,
    },
  })

  assert.equal(toDeck.playbackRate, 1.05)
  harness.scheduler.runFramesAt(1800)
  assert.equal(fromDeck.playbackRate, 0.95)
  harness.scheduler.runFramesAt(7000)
  await promise
  assert.equal(fromDeck.playbackRate, 1)
  assert.equal(toDeck.playbackRate, 1.05)

  harness.scheduler.runFramesAt(16000)
  assert.equal(toDeck.playbackRate, 1)
  assert.equal(harness.controller.getDiagnostics().hasTempoRampFrame, false)
})

test('real play failure is reported and leaves no transition or rate residue', async () => {
  const harness = makeHarness()
  harness.audioEngine.standbyDeck.playQueue.push(Promise.reject(new Error('media_failed')))
  let failure
  const resultPromise = harness.controller.startTransition({
    source: 'broken.mp3',
    transitionPlan: { fromRate: 0.95, toRate: 1.05 },
    onFailed: (error) => { failure = error },
  })
  await flushMicrotasks()
  const result = await resultPromise

  assert.equal(result.ok, false)
  assert.equal(result.error, 'media_failed')
  assert.equal(failure.message, 'media_failed')
  assert.equal(harness.audioEngine.swapCalls, 0)
  assert.equal(harness.audioEngine.activeDeck.volume, 1)
  assert.equal(harness.audioEngine.activeDeck.playbackRate, 1)
  assert.equal(harness.audioEngine.standbyDeck.volume, 0)
  assert.equal(harness.audioEngine.standbyDeck.playbackRate, 1)
  assert.equal(harness.controller.getDiagnostics().isCrossfading, false)
})

test('an unavailable AudioContext resume keeps the existing media play path', async () => {
  const harness = makeHarness()
  harness.audioEngine.resumeOutput = async (deck) => {
    harness.audioEngine.resumeCalls.push(deck)
    return false
  }

  const { promise } = await startPreparedTransition(harness)
  harness.scheduler.runFramesAt(7000)
  const result = await promise

  assert.equal(result.ok, true)
  assert.equal(harness.audioEngine.resumeCalls.length, 2)
  assert.equal(harness.audioEngine.swapCalls, 1)
  assert.equal(harness.audioEngine.getActiveDeck().src, 'next.mp3')
})

test('recovery timer commits once and does not leak RAF or timer handles', async () => {
  const harness = makeHarness()
  const { promise } = await startPreparedTransition(harness)

  harness.scheduler.runTimersAt(7350)
  const result = await promise

  assert.equal(result.ok, true)
  assert.equal(harness.audioEngine.swapCalls, 1)
  assert.equal(harness.scheduler.frames.size, 0)
  assert.equal(harness.scheduler.timers.size, 0)
  assert.equal(harness.controller.getDiagnostics().hasRecoveryTimer, false)
})

test('volume changes reapply the current envelope without taking ducking ownership', async () => {
  const harness = makeHarness()
  const fromDeck = harness.audioEngine.activeDeck
  const toDeck = harness.audioEngine.standbyDeck
  const { promise } = await startPreparedTransition(harness)
  harness.scheduler.runFramesAt(3500)

  harness.audioEngine.userVolume = 0.4
  harness.controller.applyVolumes()

  assert.ok(Math.abs(fromDeck.volume - 0.4 * Math.SQRT1_2) < 1e-12)
  const expectedIncoming = 0.4 * (CROSSFADE_START_VOLUME + (1 - CROSSFADE_START_VOLUME) * Math.SQRT1_2)
  assert.ok(Math.abs(toDeck.volume - expectedIncoming) < 1e-12)
  assert.equal('duckingFactor' in harness.controller, false)

  harness.controller.cancel()
  await promise
})

test('dispose is idempotent and safely cancels an in-flight transition', async () => {
  const harness = makeHarness()
  const { promise } = await startPreparedTransition(harness, { shouldPromoteTarget: () => false })

  harness.controller.dispose()
  harness.controller.dispose()
  const result = await promise

  assert.equal(result.error, 'crossfade_cancelled')
  assert.equal(harness.scheduler.frames.size, 0)
  assert.equal(harness.scheduler.timers.size, 0)
  assert.equal(harness.audioEngine.activeDeck.volume, 1)
  assert.equal(harness.audioEngine.standbyDeck.volume, 0)
  assert.equal(harness.audioEngine.standbyDeck.paused, true)
})

test('diagnostics are immutable primitives and controller owns no player business or audio resources', () => {
  const harness = makeHarness()
  const diagnostics = harness.controller.getDiagnostics()
  const source = readFileSync(new URL('./CrossfadeController.js', import.meta.url), 'utf8')

  assert.equal(Object.isFrozen(diagnostics), true)
  assert.equal('fromDeck' in diagnostics, false)
  assert.equal('toDeck' in diagnostics, false)
  assert.equal('transaction' in diagnostics, false)
  assert.equal('currentSong' in harness.controller, false)
  assert.equal('queue' in harness.controller, false)
  assert.equal('playbackMode' in harness.controller, false)
  assert.doesNotMatch(source, /new\s+Audio\s*\(/)
  assert.doesNotMatch(source, /new\s+AudioContext\s*\(/)
  assert.doesNotMatch(source, /createMediaElementSource|createAnalyser|createGain/)
})
