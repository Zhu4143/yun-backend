export class PendingPlaybackController {
  constructor({ schedule = setTimeout, cancel = clearTimeout } = {}) {
    this.schedule = schedule
    this.cancelTimer = cancel
    this.pending = null
  }

  hasPending() {
    return Boolean(this.pending)
  }

  begin({ timeoutMs = 0, timeoutResult = true, onSettle } = {}) {
    this.stop()

    let resolvePromise
    const entry = {
      promise: new Promise((resolve) => { resolvePromise = resolve }),
      timer: 0,
      settle: (result) => {
        if (entry.settled) return false
        entry.settled = true
        if (entry.timer) this.cancelTimer(entry.timer)
        if (this.pending === entry) this.pending = null
        resolvePromise(Boolean(result))
        onSettle?.(Boolean(result))
        return true
      },
      settled: false,
    }

    this.pending = entry
    if (timeoutMs > 0) entry.timer = this.schedule(() => entry.settle(timeoutResult), timeoutMs)

    return {
      promise: entry.promise,
      finish: (result = true) => entry.settle(result),
      cancel: () => entry.settle(false),
    }
  }

  stop() {
    return this.pending?.settle(false) || false
  }
}
