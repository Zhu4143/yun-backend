function hasAbortSignal() {
  return typeof AbortController !== 'undefined'
}

// Client-side boundary for requests to the local backend.  It prevents a
// disconnected/restarted dev server from surfacing Chromium's vague
// "fetch failed" message to the companion UI.
export async function fetchLocalApi(url, options = {}, {
  timeoutMs = 30000,
  unavailableMessage = '本地服务暂时不可用，请稍后重试',
} = {}) {
  if (!hasAbortSignal()) return fetch(url, options)

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('本地服务响应超时，请稍后重试', { cause: error })
    }
    throw new Error(unavailableMessage, { cause: error })
  } finally {
    window.clearTimeout(timeout)
  }
}
