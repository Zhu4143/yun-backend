export class BrowserRecognitionQueue {
  constructor() {
    this.pending = []
    this.draining = false
    this.processor = null
  }

  enqueue(segment) {
    this.pending.push(segment)
    return this.pending.length
  }

  get pendingCount() {
    return this.pending.length
  }

  clear() {
    this.pending.length = 0
  }

  async drain(processor = this.processor) {
    if (processor) this.processor = processor
    if (this.draining || !this.processor) return
    this.draining = true
    try {
      while (this.pending.length) {
        const segment = this.pending.shift()
        await this.processor(segment)
      }
    } finally {
      this.draining = false
      if (this.pending.length && this.processor) void this.drain()
    }
  }
}
