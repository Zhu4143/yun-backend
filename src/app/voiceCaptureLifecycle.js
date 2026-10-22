// Keep ownership changes ordered across asynchronous getUserMedia/start/close.
// Callers still receive their own rejection; a failed operation cannot poison
// the queue and prevent the microphone from being released afterward.
export function createCaptureOperationQueue() {
  let settled = Promise.resolve()
  return {
    run(operation) {
      const result = settled.then(operation)
      settled = result.catch(() => {})
      return result
    },
    idle: () => settled,
  }
}
