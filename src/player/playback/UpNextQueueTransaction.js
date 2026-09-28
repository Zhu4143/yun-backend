export class UpNextQueueTransaction {
  constructor() {
    this.active = false
  }

  async run({ candidate, source = 'unknown', play, commit } = {}) {
    if (this.active) {
      return { ok: false, error: 'queue_transition_in_progress', queueSource: source, queueCommitted: false }
    }
    if (!candidate || typeof play !== 'function') {
      return { ok: false, error: 'invalid_queue_candidate', queueSource: source, queueCommitted: false }
    }

    this.active = true
    try {
      const result = await play(candidate)
      if (!result?.ok) {
        return { ...result, ok: false, queueSource: source, queueCommitted: false }
      }
      await commit?.(candidate)
      return { ...result, queueSource: source, queueCommitted: true }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error || 'playback_failed'),
        queueSource: source,
        queueCommitted: false,
      }
    } finally {
      this.active = false
    }
  }
}
