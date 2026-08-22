import test from 'node:test'
import assert from 'node:assert/strict'
import { AudioEngine } from './AudioEngine.js'
import { INITIAL_PLAYER_STATE } from '../playerTypes.js'

class FakeAudio {
  constructor(id) {
    this.id = id
    this.paused = true
    this.volume = 1
    this.src = ''
    this.currentSrc = ''
    this.pauseCalls = 0
  }

  pause() {
    this.paused = true
    this.pauseCalls += 1
  }
}

class FakeAudioParam {
  constructor() {
    this.value = 1
    this.cancelCalls = []
    this.valueCalls = []
    this.targetCalls = []
  }

  cancelScheduledValues(time) {
    this.cancelCalls.push(time)
  }

  setValueAtTime(value, time) {
    this.value = value
    this.valueCalls.push({ value, time })
  }

  setTargetAtTime(value, time, timeConstant) {
    this.value = value
    this.targetCalls.push({ value, time, timeConstant })
  }
}

class FakeNode {
  constructor() {
    this.connections = []
    this.disconnectCalls = 0
  }

  connect(node) {
    this.connections.push(node)
    return node
  }

  disconnect() {
    this.disconnectCalls += 1
  }
}

class FakeGainNode extends FakeNode {
  constructor() {
    super()
    this.gain = new FakeAudioParam()
  }
}

class FakeAnalyserNode extends FakeNode {
  constructor(id) {
    super()
    this.id = id
    this.frequencyBinCount = 0
    this.smoothingTimeConstant = 0
    this._fftSize = 0
  }

  set fftSize(value) {
    this._fftSize = value
    this.frequencyBinCount = value / 2
  }

  get fftSize() {
    return this._fftSize
  }

  getByteFrequencyData(buffer) {
    buffer.fill(this.id)
  }

  getByteTimeDomainData(buffer) {
    buffer.fill(128 + this.id)
  }
}

class FakeMediaElementSourceNode extends FakeNode {
  constructor(deck) {
    super()
    this.deck = deck
  }
}

class FakeAudioContext {
  constructor(initialState = 'running') {
    this.state = initialState
    this.currentTime = 12
    this.destination = new FakeNode()
    this.gains = []
    this.sources = []
    this.analysers = []
    this.resumeCalls = 0
    this.closeCalls = 0
  }

  createGain() {
    const gain = new FakeGainNode()
    this.gains.push(gain)
    return gain
  }

  createMediaElementSource(deck) {
    const source = new FakeMediaElementSourceNode(deck)
    this.sources.push(source)
    return source
  }

  createAnalyser() {
    const analyser = new FakeAnalyserNode(this.analysers.length + 1)
    this.analysers.push(analyser)
    return analyser
  }

  async resume() {
    this.resumeCalls += 1
    this.state = 'running'
  }

  async close() {
    this.closeCalls += 1
    this.state = 'closed'
  }
}

function makeHarness({ contextState = 'running' } = {}) {
  const audios = []
  const contexts = []
  const engine = new AudioEngine({
    audioFactory: () => {
      const audio = new FakeAudio(audios.length + 1)
      audios.push(audio)
      return audio
    },
    audioContextFactory: () => {
      const context = new FakeAudioContext(contextState)
      contexts.push(context)
      return context
    },
  })
  return { engine, audios, contexts }
}

test('AudioEngine lazily creates exactly one active and one standby deck', () => {
  const { engine, audios, contexts } = makeHarness()
  assert.equal(audios.length, 0)
  assert.equal(contexts.length, 0)

  const active = engine.ensureActiveDeck()
  const standby = engine.ensureStandbyDeck()

  assert.equal(engine.ensureActiveDeck(), active)
  assert.equal(engine.ensureStandbyDeck(), standby)
  assert.equal(audios.length, 2)
  assert.equal(engine.getActiveDeckRef().current, active)
})

test('one graph is shared and a deck is bound to MediaElementSource only once', () => {
  const { engine, contexts } = makeHarness()
  const active = engine.ensureActiveDeck()
  const standby = engine.ensureStandbyDeck()

  const firstActive = engine.ensureGraphFor(active)
  const secondActive = engine.ensureGraphFor(active)
  const standbyEntry = engine.ensureGraphFor(standby)
  const context = contexts[0]

  assert.equal(contexts.length, 1)
  assert.equal(context.gains.length, 2)
  assert.equal(context.sources.length, 2)
  assert.equal(context.analysers.length, 2)
  assert.equal(firstActive.entry.source, secondActive.entry.source)
  assert.notEqual(firstActive.entry.analyser, standbyEntry.entry.analyser)
  assert.equal(firstActive.entry.analyser.fftSize, 1024)
  assert.equal(firstActive.entry.analyser.smoothingTimeConstant, 0.72)
})

test('frequency and time-domain reads use the analyser for the requested active deck', () => {
  const { engine } = makeHarness()
  const firstDeck = engine.ensureActiveDeck()
  const secondDeck = engine.ensureStandbyDeck()
  firstDeck.paused = false
  secondDeck.paused = false
  engine.ensureGraphFor(firstDeck)
  engine.ensureGraphFor(secondDeck)

  assert.equal(engine.readFrequencyData()[0], 1)
  assert.equal(engine.readTimeDomainData()[0], 129)

  engine.swapDecks()
  assert.equal(engine.getActiveDeck(), secondDeck)
  assert.equal(engine.getActiveDeckRef().current, secondDeck)
  assert.equal(engine.readFrequencyData()[0], 2)
  assert.equal(engine.readTimeDomainData()[0], 130)
})

test('user volume stays on deck volume while ducking stays on musicGain', async () => {
  const { engine } = makeHarness()
  const active = engine.ensureActiveDeck()
  const standby = engine.ensureStandbyDeck()
  engine.setUserVolume(0.65)

  assert.equal(active.volume, 0.65)
  assert.equal(standby.volume, 0)

  const { graph } = engine.ensureGraphFor(active)
  await engine.setDuckingFactor(0.25, 0.1)

  assert.equal(active.volume, 0.65)
  assert.deepEqual(graph.musicGain.gain.targetCalls.at(-1), {
    value: 0.25,
    time: 12,
    timeConstant: 0.1,
  })
  assert.equal(engine.getDuckingFactor(), 0.25)
})

test('resumeOutput resumes the one suspended main AudioContext and restores ducking gain', async () => {
  const { engine, contexts } = makeHarness({ contextState: 'suspended' })
  const active = engine.ensureActiveDeck()
  await engine.setDuckingFactor(0.4)

  const ready = await engine.resumeOutput(active)
  const context = contexts[0]

  assert.equal(ready, true)
  assert.equal(context.resumeCalls, 1)
  assert.equal(context.state, 'running')
  assert.equal(context.gains[1].gain.valueCalls.at(-1).value, 0.4)
})

test('swapping decks changes ownership order without creating another Audio element', () => {
  const { engine, audios } = makeHarness()
  const active = engine.ensureActiveDeck()
  const standby = engine.ensureStandbyDeck()

  engine.swapDecks()

  assert.equal(audios.length, 2)
  assert.equal(engine.getActiveDeck(), standby)
  assert.equal(engine.getStandbyDeck(), active)
})

test('dispose pauses and disconnects every resource and is idempotent', async () => {
  const { engine, contexts } = makeHarness()
  const active = engine.ensureActiveDeck()
  const standby = engine.ensureStandbyDeck()
  engine.ensureGraphFor(active)
  engine.ensureGraphFor(standby)
  const context = contexts[0]

  await engine.dispose()
  await engine.dispose()

  assert.equal(active.pauseCalls, 1)
  assert.equal(standby.pauseCalls, 1)
  assert.equal(context.closeCalls, 1)
  assert.equal(context.sources.every((node) => node.disconnectCalls === 1), true)
  assert.equal(context.analysers.every((node) => node.disconnectCalls === 1), true)
  assert.equal(context.gains.every((node) => node.disconnectCalls === 1), true)
  assert.equal(engine.getActiveDeck(), null)
  assert.equal(engine.getStandbyDeck(), null)
  assert.equal(engine.getDiagnostics().audioContextState, 'not_attached')
})

test('a disposed engine can lazily reactivate without retaining the closed context', async () => {
  const { engine, audios, contexts } = makeHarness()
  engine.ensureGraphFor(engine.ensureActiveDeck())
  await engine.dispose()

  const nextDeck = engine.ensureActiveDeck()
  engine.ensureGraphFor(nextDeck)

  assert.equal(audios.length, 2)
  assert.equal(contexts.length, 2)
  assert.equal(contexts[0].state, 'closed')
  assert.notEqual(contexts[0], contexts[1])
})

test('real-time buffers stay out of PlayerState and AudioEngine owns no player business state', () => {
  const { engine } = makeHarness()

  assert.equal('frequencyBuffer' in INITIAL_PLAYER_STATE, false)
  assert.equal('timeBuffer' in INITIAL_PLAYER_STATE, false)
  assert.equal('audioContext' in INITIAL_PLAYER_STATE, false)
  assert.equal('currentSong' in engine, false)
  assert.equal('queue' in engine, false)
  assert.equal('playbackMode' in engine, false)
})
