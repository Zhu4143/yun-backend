export const CROSSFADE_DURATION = 7000
export const CROSSFADE_START_VOLUME = 0.03
export const MIN_CROSSFADE_DURATION = 1200

const MIN_TRANSITION_RATE = 0.95
const MAX_TRANSITION_RATE = 1.05

const browserScheduler = Object.freeze({
  requestFrame: (callback) => globalThis.requestAnimationFrame(callback),
  cancelFrame: (handle) => globalThis.cancelAnimationFrame(handle),
  setTimer: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimer: (handle) => globalThis.clearTimeout(handle),
  now: () => globalThis.performance?.now?.() ?? Date.now(),
})

function clampUnit(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 1
}

function clampTransitionRate(rate) {
  const value = Number(rate)
  return Number.isFinite(value) ? Math.max(MIN_TRANSITION_RATE, Math.min(MAX_TRANSITION_RATE, value)) : 1
}

function getSafeDuration(deck) {
  return Number.isFinite(deck?.duration) ? deck.duration : 0
}

function setDeckPlaybackRate(deck, rate) {
  if (!deck) return
  deck.preservesPitch = true
  deck.mozPreservesPitch = true
  deck.webkitPreservesPitch = true
  deck.playbackRate = clampTransitionRate(rate)
}

export function equalPowerFadeIn(progress) {
  return Math.sin((Math.PI / 2) * progress)
}

export function equalPowerFadeOut(progress) {
  return Math.cos((Math.PI / 2) * progress)
}

function createEqualPowerCurves(sampleCount = 129) {
  const count = Math.max(3, Math.floor(sampleCount))
  const fadeOutCurve = new Float32Array(count)
  const fadeInCurve = new Float32Array(count)

  for (let index = 0; index < count; index += 1) {
    const progress = index / (count - 1)
    fadeOutCurve[index] = equalPowerFadeOut(progress)
    fadeInCurve[index] = CROSSFADE_START_VOLUME
      + (1 - CROSSFADE_START_VOLUME) * equalPowerFadeIn(progress)
  }

  return { fadeOutCurve, fadeInCurve }
}

export class CrossfadeController {
  constructor({
    audioEngine,
    getEffectiveVolume = () => audioEngine.getUserVolume(),
    scheduler = browserScheduler,
    debug = Boolean(import.meta.env?.DEV),
    logger = console,
  }) {
    this.audioEngine = audioEngine
    this.getEffectiveVolume = getEffectiveVolume
    this.scheduler = { ...browserScheduler, ...scheduler }
    this.debug = debug
    this.logger = logger
    this.token = 0
    this.transaction = null
    this.crossfadeFrame = 0
    this.recoveryTimer = 0
    this.tempoRampFrame = 0
    this.standbyPlayToken = 0
    this.disposed = false
  }

  reactivate() {
    this.disposed = false
  }

  isCrossfading() {
    return Boolean(this.transaction)
  }

  calculateDuration(fromDeck, transitionPlan = null) {
    const naturalDuration = Math.max(
      MIN_CROSSFADE_DURATION,
      Math.min(
        CROSSFADE_DURATION,
        (getSafeDuration(fromDeck) - (fromDeck?.currentTime || 0)) * 1000 || CROSSFADE_DURATION,
      ),
    )

    return transitionPlan
      ? Math.max(
        MIN_CROSSFADE_DURATION,
        Math.min(Number(transitionPlan.crossfadeMs) || naturalDuration, naturalDuration + 1800),
      )
      : naturalDuration
  }

  startTransition({
    source,
    transitionPlan = null,
    metadata = null,
    shouldPromoteTarget = () => false,
    onPrepared,
    onTargetPlaying,
    onCommitted,
    onFailed,
  }) {
    this.reactivate()
    if (this.transaction) this.cancel()

    const fromDeck = this.audioEngine.getActiveDeck()
    const toDeck = this.audioEngine.ensureStandbyDeck()
    if (!fromDeck || !toDeck || !source) {
      return Promise.resolve({ ok: false, error: 'missing_transition_resource', metadata })
    }

    const id = ++this.token
    const duration = this.calculateDuration(fromDeck, transitionPlan)

    return new Promise((resolve) => {
      const transaction = {
        id,
        phase: 'preparing',
        progress: 0,
        duration,
        fromDeck,
        toDeck,
        source,
        transitionPlan,
        metadata,
        shouldPromoteTarget,
        onPrepared,
        onTargetPlaying,
        onCommitted,
        onFailed,
        resolve,
        settled: false,
        startedAt: 0,
      }
      this.transaction = transaction
      this.prepare(transaction)
    })
  }

  async prepare(transaction) {
    const { fromDeck, toDeck, transitionPlan } = transaction

    try {
      await this.audioEngine.resumeOutput(fromDeck)
      if (!this.isCurrent(transaction)) return
      await this.audioEngine.resumeOutput(toDeck)
      if (!this.isCurrent(transaction)) return

      toDeck.pause()
      if (toDeck.src !== transaction.source) toDeck.src = transaction.source
      toDeck.currentTime = transitionPlan
        ? Math.max(0, Math.min(0.75, Number(transitionPlan.startOffsetSec) || 0))
        : 0

      if (transitionPlan) {
        setDeckPlaybackRate(toDeck, transitionPlan.toRate)
        this.rampPlaybackRate(
          fromDeck,
          transitionPlan.fromRate,
          Math.min(1800, transaction.duration * 0.36),
        )
      } else {
        setDeckPlaybackRate(fromDeck, 1)
        setDeckPlaybackRate(toDeck, 1)
      }

      const targetVolume = clampUnit(this.getEffectiveVolume())
      toDeck.volume = Math.min(targetVolume, targetVolume * CROSSFADE_START_VOLUME)
      this.standbyPlayToken = transaction.id
      transaction.onPrepared?.()
      await toDeck.play()
    } catch (error) {
      if (this.isCurrent(transaction)) this.fail(transaction, error)
      else this.pauseStaleStandby(transaction)
      return
    }

    if (!this.isCurrent(transaction)) {
      this.pauseStaleStandby(transaction)
      return
    }

    transaction.phase = 'fading'
    transaction.audioEnvelopeScheduled = this.scheduleAudioThreadEnvelopes(transaction)
    transaction.onTargetPlaying?.({ toDeck })
    if (!this.isCurrent(transaction)) return

    transaction.startedAt = this.scheduler.now()
    this.recoveryTimer = this.scheduler.setTimer(() => {
      if (this.isCurrent(transaction) && this.audioEngine.getStandbyDeck() === toDeck) {
        this.finish(transaction)
      }
    }, transaction.duration + 350)
    this.crossfadeFrame = this.scheduler.requestFrame((now) => this.step(transaction, now))
  }

  step(transaction, now) {
    if (!this.isCurrent(transaction)) return

    const progress = Math.min(1, (now - transaction.startedAt) / transaction.duration)
    transaction.progress = progress
    this.applyTransactionEnvelope(transaction)

    if (progress < 1) {
      this.crossfadeFrame = this.scheduler.requestFrame((nextNow) => this.step(transaction, nextNow))
      return
    }

    this.finish(transaction)
  }

  applyTransactionEnvelope(transaction) {
    const effectiveVolume = clampUnit(this.getEffectiveVolume())
    if (transaction.audioEnvelopeScheduled) {
      transaction.fromDeck.volume = effectiveVolume
      transaction.toDeck.volume = effectiveVolume
      return
    }
    const fadeOut = equalPowerFadeOut(transaction.progress)
    const fadeIn = equalPowerFadeIn(transaction.progress)
    const audibleFadeIn = CROSSFADE_START_VOLUME + (1 - CROSSFADE_START_VOLUME) * fadeIn
    transaction.fromDeck.volume = effectiveVolume * fadeOut
    transaction.toDeck.volume = Math.min(effectiveVolume, effectiveVolume * audibleFadeIn)
  }

  scheduleAudioThreadEnvelopes(transaction) {
    if (typeof this.audioEngine.scheduleCrossfadeEnvelopes !== 'function') return false
    const { fadeOutCurve, fadeInCurve } = createEqualPowerCurves()
    return this.audioEngine.scheduleCrossfadeEnvelopes({
      fromDeck: transaction.fromDeck,
      toDeck: transaction.toDeck,
      durationMs: transaction.duration,
      fadeOutCurve,
      fadeInCurve,
    }) === true
  }

  settleDeckEnvelopes(fromDeck, toDeck) {
    this.audioEngine.setDeckEnvelope?.(fromDeck, 0)
    this.audioEngine.setDeckEnvelope?.(toDeck, 1)
  }

  applyVolumes() {
    const transaction = this.transaction
    if (transaction?.phase === 'fading') {
      this.applyTransactionEnvelope(transaction)
      return
    }

    const effectiveVolume = clampUnit(this.getEffectiveVolume())
    const activeDeck = this.audioEngine.getActiveDeck()
    const standbyDeck = this.audioEngine.getStandbyDeck()
    if (activeDeck) activeDeck.volume = effectiveVolume
    if (standbyDeck) standbyDeck.volume = 0
  }

  finish(transaction) {
    if (!this.isCurrent(transaction) || transaction.settled) return

    transaction.phase = 'finishing'
    this.clearCrossfadeFrame()
    this.clearRecoveryTimer()

    const { fromDeck, toDeck, transitionPlan } = transaction
    this.settleDeckEnvelopes(fromDeck, toDeck)
    fromDeck.pause()
    fromDeck.currentTime = 0
    fromDeck.volume = 0
    setDeckPlaybackRate(fromDeck, 1)
    toDeck.volume = clampUnit(this.getEffectiveVolume())
    this.audioEngine.swapDecks()
    this.transaction = null

    transaction.onCommitted?.({ activeDeck: toDeck })
    if (transitionPlan) {
      this.rampPlaybackRate(toDeck, 1, Number(transitionPlan.restoreDurationMs) || 9000)
    } else {
      setDeckPlaybackRate(toDeck, 1)
    }

    this.assertStableDeckState('finish')
    this.settle(transaction, { ok: true, metadata: transaction.metadata })
  }

  fail(transaction, error) {
    if (!this.isCurrent(transaction) || transaction.settled) return

    this.clearCrossfadeFrame()
    this.clearRecoveryTimer()
    this.cancelTempoRamp({ resetDecks: true })
    this.settleDeckEnvelopes(transaction.toDeck, transaction.fromDeck)
    transaction.toDeck.volume = 0
    transaction.toDeck.pause()
    transaction.fromDeck.volume = clampUnit(this.getEffectiveVolume())
    this.transaction = null
    transaction.onFailed?.(error)
    this.assertStableDeckState('failure')
    this.settle(transaction, {
      ok: false,
      error: error instanceof Error ? error.message : 'play_failed',
      metadata: transaction.metadata,
    })
  }

  cancel() {
    if (this.disposed) {
      return { hadTransaction: false, activeDeckChanged: false, shouldRefreshActiveDeck: false }
    }

    this.token += 1
    this.clearCrossfadeFrame()
    this.clearRecoveryTimer()
    this.cancelTempoRamp({ resetDecks: true })

    const transaction = this.transaction
    const shouldRefreshActiveDeck = Boolean(transaction && transaction.phase !== 'preparing')
    let activeDeckChanged = false
    if (transaction) {
      let promoteTarget
      try {
        promoteTarget = transaction.phase !== 'preparing'
          && transaction.shouldPromoteTarget?.() === true
          && !transaction.toDeck.paused
      } catch {
        promoteTarget = false
      }

      const activeDeck = promoteTarget ? transaction.toDeck : transaction.fromDeck
      const inactiveDeck = promoteTarget ? transaction.fromDeck : transaction.toDeck
      this.audioEngine.setDeckEnvelope?.(activeDeck, 1)
      this.audioEngine.setDeckEnvelope?.(inactiveDeck, 0)
      inactiveDeck.pause()
      inactiveDeck.volume = 0
      activeDeck.volume = clampUnit(this.getEffectiveVolume())
      if (this.audioEngine.getActiveDeck() !== activeDeck) {
        this.audioEngine.swapDecks()
        activeDeckChanged = true
      }
      this.transaction = null
      this.settle(transaction, {
        ok: false,
        error: 'crossfade_cancelled',
        metadata: transaction.metadata,
      })
    } else {
      const activeDeck = this.audioEngine.getActiveDeck()
      const standbyDeck = this.audioEngine.getStandbyDeck()
      if (activeDeck) {
        activeDeck.volume = clampUnit(this.getEffectiveVolume())
      }
      if (standbyDeck) {
        standbyDeck.volume = 0
        standbyDeck.pause()
      }
    }

    this.assertStableDeckState('cancel')
    return { hadTransaction: Boolean(transaction), activeDeckChanged, shouldRefreshActiveDeck }
  }

  pauseStaleStandby(transaction) {
    if (
      this.audioEngine.getStandbyDeck() === transaction.toDeck
      && this.standbyPlayToken === transaction.id
    ) {
      this.audioEngine.setDeckEnvelope?.(transaction.toDeck, 0)
      transaction.toDeck.volume = 0
      transaction.toDeck.pause()
    }
  }

  rampPlaybackRate(deck, targetRate, durationMs = 1200) {
    if (!deck) return
    this.cancelTempoRamp()
    const fromRate = clampTransitionRate(deck.playbackRate)
    const toRate = clampTransitionRate(targetRate)
    const startedAt = this.scheduler.now()
    const step = (now) => {
      const progress = Math.min(1, (now - startedAt) / Math.max(160, durationMs))
      const eased = 1 - Math.pow(1 - progress, 3)
      setDeckPlaybackRate(deck, fromRate + (toRate - fromRate) * eased)
      if (progress < 1) this.tempoRampFrame = this.scheduler.requestFrame(step)
      else this.tempoRampFrame = 0
    }
    this.tempoRampFrame = this.scheduler.requestFrame(step)
  }

  cancelTempoRamp({ resetDecks = false } = {}) {
    if (this.tempoRampFrame) {
      this.scheduler.cancelFrame(this.tempoRampFrame)
      this.tempoRampFrame = 0
    }
    if (resetDecks) {
      setDeckPlaybackRate(this.audioEngine.getActiveDeck(), 1)
      setDeckPlaybackRate(this.audioEngine.getStandbyDeck(), 1)
    }
  }

  clearCrossfadeFrame() {
    if (!this.crossfadeFrame) return
    this.scheduler.cancelFrame(this.crossfadeFrame)
    this.crossfadeFrame = 0
  }

  clearRecoveryTimer() {
    if (!this.recoveryTimer) return
    this.scheduler.clearTimer(this.recoveryTimer)
    this.recoveryTimer = 0
  }

  isCurrent(transaction) {
    return this.transaction === transaction && this.token === transaction.id && !transaction.settled
  }

  settle(transaction, result) {
    if (transaction.settled) return
    transaction.settled = true
    transaction.resolve(result)
  }

  assertStableDeckState(label) {
    if (!this.debug) return
    const activeDeck = this.audioEngine.getActiveDeck()
    const standbyDeck = this.audioEngine.getStandbyDeck()
    const expectedVolume = clampUnit(this.getEffectiveVolume())
    const violations = []

    if (this.transaction) violations.push('crossfade transaction still active')
    if (this.crossfadeFrame) violations.push('crossfade RAF still active')
    if (this.recoveryTimer) violations.push('recovery timer still active')
    if (activeDeck && Math.abs(activeDeck.volume - expectedVolume) > 0.001) {
      violations.push(`active volume ${activeDeck.volume} != ${expectedVolume}`)
    }
    if (standbyDeck && (!standbyDeck.paused || standbyDeck.volume !== 0)) {
      violations.push(`standby is not silent/paused (${standbyDeck.paused}, ${standbyDeck.volume})`)
    }

    if (violations.length) this.logger.error(`[player:${label}] unstable deck state`, violations)
  }

  getDiagnostics() {
    const transaction = this.transaction
    return Object.freeze({
      isCrossfading: Boolean(transaction),
      progress: transaction?.progress ?? 0,
      transactionId: transaction?.id ?? null,
      duration: transaction?.duration ?? 0,
      phase: transaction?.phase || 'idle',
      hasCrossfadeFrame: Boolean(this.crossfadeFrame),
      hasRecoveryTimer: Boolean(this.recoveryTimer),
      hasTempoRampFrame: Boolean(this.tempoRampFrame),
    })
  }

  dispose() {
    if (this.disposed) return
    this.cancel()
    this.disposed = true
  }
}
