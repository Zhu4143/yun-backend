function clampUnit(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 1
}

function createBrowserAudio() {
  const AudioConstructor = globalThis.Audio
  if (typeof AudioConstructor !== 'function') return null
  return new AudioConstructor()
}

function createBrowserAudioContext() {
  const AudioContextConstructor = globalThis.AudioContext || globalThis.webkitAudioContext
  return typeof AudioContextConstructor === 'function' ? new AudioContextConstructor() : null
}

export class AudioEngine {
  constructor({
    audioFactory = createBrowserAudio,
    audioContextFactory = createBrowserAudioContext,
  } = {}) {
    this.audioFactory = audioFactory
    this.audioContextFactory = audioContextFactory
    this.activeDeck = null
    this.standbyDeck = null
    this.graph = null
    this.entriesByDeck = new WeakMap()
    this.entries = new Set()
    this.userVolume = 1
    this.duckingFactor = 1
    this.disposed = false
    this.disposePromise = null

    const engine = this
    // Transitional compatibility for useYunVoice and playback telemetry.
    // AudioEngine is the owner; remove this facade when both consumers accept
    // explicit ducking/active-deck capabilities instead of a legacy audioRef.
    this.activeDeckRef = Object.freeze({
      get current() {
        return engine.getActiveDeck()
      },
    })
  }

  reactivate() {
    if (!this.disposed) return
    this.disposed = false
    this.disposePromise = null
  }

  getActiveDeck() {
    return this.activeDeck
  }

  getStandbyDeck() {
    return this.standbyDeck
  }

  getActiveDeckRef() {
    return this.activeDeckRef
  }

  ensureActiveDeck() {
    this.reactivate()
    if (!this.activeDeck) {
      this.activeDeck = this.audioFactory()
      if (this.activeDeck) this.activeDeck.volume = this.userVolume
    }
    return this.activeDeck
  }

  ensureStandbyDeck() {
    this.reactivate()
    if (!this.standbyDeck) {
      this.standbyDeck = this.audioFactory()
      if (this.standbyDeck) this.standbyDeck.volume = 0
    }
    return this.standbyDeck
  }

  swapDecks() {
    const activeDeck = this.activeDeck
    this.activeDeck = this.standbyDeck
    this.standbyDeck = activeDeck
    return this.activeDeck
  }

  ensureGraphFor(deck) {
    if (!deck) return null
    this.reactivate()

    try {
      if (!this.graph) {
        const context = this.audioContextFactory()
        if (!context) return null
        const masterGain = context.createGain()
        const musicGain = context.createGain()
        musicGain.gain.value = this.duckingFactor
        musicGain.connect(masterGain)
        masterGain.connect(context.destination)
        this.graph = { context, masterGain, musicGain }
      }

      let entry = this.entriesByDeck.get(deck)
      if (!entry) {
        const source = this.graph.context.createMediaElementSource(deck)
        const analyser = this.graph.context.createAnalyser()
        analyser.fftSize = 1024
        analyser.smoothingTimeConstant = 0.72
        source.connect(analyser)
        analyser.connect(this.graph.musicGain)
        entry = {
          deck,
          source,
          analyser,
          frequencyBuffer: new Uint8Array(analyser.frequencyBinCount),
          timeBuffer: new Uint8Array(analyser.fftSize),
        }
        this.entriesByDeck.set(deck, entry)
        this.entries.add(entry)
      }

      return { graph: this.graph, entry }
    } catch {
      // Playback remains usable when an embedded Chromium build rejects a
      // MediaElementSource for a particular media element.
      return null
    }
  }

  async resumeOutput(deck = this.activeDeck) {
    const graph = this.ensureGraphFor(deck)?.graph
    if (!graph?.context) return true

    try {
      if (graph.context.state !== 'running') await graph.context.resume()
      const now = graph.context.currentTime
      graph.musicGain.gain.cancelScheduledValues(now)
      graph.musicGain.gain.setValueAtTime(this.duckingFactor, now)
      return graph.context.state === 'running'
    } catch (error) {
      console.warn('[player] unable to resume music output', error)
      return false
    }
  }

  readTimeDomainData(deck = this.activeDeck) {
    try {
      const entry = this.ensureGraphFor(deck)?.entry
      if (!entry) return null
      entry.analyser.getByteTimeDomainData(entry.timeBuffer)
      return entry.timeBuffer
    } catch {
      return null
    }
  }

  readFrequencyData(deck = this.activeDeck) {
    if (!deck || deck.paused) return null

    try {
      const entry = this.ensureGraphFor(deck)?.entry
      if (!entry) return null
      entry.analyser.getByteFrequencyData(entry.frequencyBuffer)
      return entry.frequencyBuffer
    } catch {
      return null
    }
  }

  setUserVolume(value) {
    this.userVolume = clampUnit(value)
    if (this.activeDeck) this.activeDeck.volume = this.userVolume
    if (this.standbyDeck) this.standbyDeck.volume = 0
    return this.userVolume
  }

  getUserVolume() {
    return this.userVolume
  }

  setDuckingFactor(value, timeConstant = 0.08) {
    this.duckingFactor = clampUnit(value)
    const graph = this.ensureGraphFor(this.activeDeck)?.graph
    const gain = graph?.musicGain?.gain
    const context = graph?.context

    if (gain && context) {
      gain.cancelScheduledValues(context.currentTime)
      gain.setTargetAtTime(this.duckingFactor, context.currentTime, Math.max(0.01, timeConstant))
    }

    return Promise.resolve()
  }

  getDuckingFactor() {
    return this.duckingFactor
  }

  getDiagnostics() {
    return {
      activePaused: this.activeDeck?.paused ?? true,
      activeVolume: this.activeDeck?.volume ?? 0,
      standbyPaused: this.standbyDeck?.paused ?? true,
      standbyVolume: this.standbyDeck?.volume ?? 0,
      userVolume: this.userVolume,
      duckingFactor: this.duckingFactor,
      audioContextState: this.graph?.context?.state || 'not_attached',
      activeSource: this.activeDeck?.currentSrc || this.activeDeck?.src || '',
      standbySource: this.standbyDeck?.currentSrc || this.standbyDeck?.src || '',
    }
  }

  dispose() {
    if (this.disposed) return this.disposePromise || Promise.resolve()
    this.disposed = true

    this.activeDeck?.pause?.()
    this.standbyDeck?.pause?.()

    for (const entry of this.entries) {
      try { entry.source?.disconnect?.() } catch { /* already disconnected */ }
      try { entry.analyser?.disconnect?.() } catch { /* already disconnected */ }
    }

    const graph = this.graph
    if (graph?.musicGain && graph.context) {
      try {
        graph.musicGain.gain.cancelScheduledValues(graph.context.currentTime)
        graph.musicGain.gain.setValueAtTime(1, graph.context.currentTime)
      } catch {
        // Context teardown can race an Electron window shutdown.
      }
    }
    try { graph?.musicGain?.disconnect?.() } catch { /* already disconnected */ }
    try { graph?.masterGain?.disconnect?.() } catch { /* already disconnected */ }

    let closeResult
    try {
      if (graph?.context?.state !== 'closed') closeResult = graph?.context?.close?.()
    } catch {
      closeResult = null
    }

    this.activeDeck = null
    this.standbyDeck = null
    this.graph = null
    this.entries.clear()
    this.entriesByDeck = new WeakMap()
    this.duckingFactor = 1
    this.disposePromise = Promise.resolve(closeResult).catch(() => {})
    return this.disposePromise
  }
}
