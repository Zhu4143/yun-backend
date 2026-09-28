function abortError(signal) {
  return signal?.reason || Object.assign(new Error('Operation aborted'), { name: 'AbortError' })
}

function waitForRetry(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError(signal))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms)
    function done() {
      signal?.removeEventListener('abort', cancel)
      resolve()
    }
    function cancel() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      reject(abortError(signal))
    }
    signal?.addEventListener('abort', cancel, { once: true })
  })
}

export async function fetchWithRetry(url, options = {}, {
  attempts = 2,
  timeoutMs = 12000,
  retryDelayMs = (attempt) => 300 * attempt,
  fetchImpl = fetch,
} = {}) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (options.signal?.aborted) throw abortError(options.signal)
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal
    try {
      const response = await fetchImpl(url, { ...options, signal })
      if (response.status < 500 || attempt === attempts) return response
      lastError = new Error(`Upstream service unavailable (${response.status})`)
    } catch (error) {
      if (options.signal?.aborted) throw abortError(options.signal)
      lastError = error
      if (attempt === attempts) throw error
    }
    if (attempt < attempts) await waitForRetry(typeof retryDelayMs === 'function' ? retryDelayMs(attempt) : retryDelayMs, options.signal)
  }
  throw lastError
}
