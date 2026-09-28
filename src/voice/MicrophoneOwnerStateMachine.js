export class MicrophoneOwnerStateMachine {
  constructor({ maxNativeRetries = 3 } = {}) {
    this.maxNativeRetries = Math.max(0, Number(maxNativeRetries) || 0)
    this.owner = 'none'
    this.status = 'starting'
    this.retryCount = 0
  }

  getSnapshot() {
    return {
      owner: this.owner,
      status: this.status,
      retryCount: this.retryCount,
      maxNativeRetries: this.maxNativeRetries,
    }
  }

  nativeReady() {
    this.owner = 'native'
    this.status = 'native-listening'
    return this.getSnapshot()
  }

  markNativeStable() {
    this.retryCount = 0
    return this.getSnapshot()
  }

  nativeDisconnected() {
    if (this.owner === 'native') this.status = 'native-reconnecting'
    return this.getSnapshot()
  }

  reconnectFailed() {
    this.retryCount += 1
    if (this.retryCount > this.maxNativeRetries) {
      this.owner = 'handoff'
      this.status = 'fallback-pending'
      return 'fallback'
    }
    this.status = 'native-reconnecting'
    return 'retry'
  }

  browserFallbackStarted() {
    this.owner = 'browser'
    this.status = 'browser-fallback'
    this.retryCount = 0
    return this.getSnapshot()
  }

  beginNativeRecovery() {
    if (this.owner !== 'browser') return false
    this.owner = 'handoff'
    this.status = 'native-recovering'
    return true
  }

  nativeRecoveryFailed() {
    if (this.owner === 'handoff') {
      this.owner = 'browser'
      this.status = 'browser-fallback'
    }
    return this.getSnapshot()
  }

  nativeRecovered() {
    this.owner = 'native'
    this.status = 'native-listening'
    this.retryCount = 0
    return this.getSnapshot()
  }

  disable() {
    this.owner = 'none'
    this.status = 'off'
    this.retryCount = 0
    return this.getSnapshot()
  }
}
