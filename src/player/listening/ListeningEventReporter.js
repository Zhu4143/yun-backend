const MAX_QUEUE_SIZE = 100

// Best effort by design: reporting never participates in the player promise
// chain. The serial queue preserves per-client event ordering at the server.
export function createListeningEventReporter({ fetchImpl = globalThis.fetch, url = '/api/music-memory/listening-event', maxQueueSize = MAX_QUEUE_SIZE } = {}) {
  let queue = Promise.resolve()
  let queued = 0

  function report(event) {
    if (typeof fetchImpl !== 'function' || queued >= maxQueueSize) return false
    queued += 1
    const send = async () => {
      try {
        await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
        })
      } catch {
        // Memory transport failures are deliberately isolated from playback.
      } finally {
        queued -= 1
      }
    }
    queue = queue.then(send, send)
    return true
  }

  return { report, getQueuedCount: () => queued, flush: () => queue }
}
