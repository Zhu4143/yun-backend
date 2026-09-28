function cleanResponseId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_.:-]/g, '-').slice(0, 96)
}

export function createRequestLifecycle(req, res, { responseId = '' } = {}) {
  const controller = new AbortController()
  let currentResponseId = cleanResponseId(responseId)

  const abort = (source) => {
    if (controller.signal.aborted) return
    const requestId = currentResponseId || 'unknown'
    const reason = new Error(`HTTP request cancelled (${source}; id=${requestId})`)
    reason.name = 'AbortError'
    controller.abort(reason)
    console.info(`[request] cancelled request_id=${requestId} source=${source}`)
  }
  const onRequestAborted = () => abort('client-aborted')
  const onResponseClosed = () => {
    if (!res.writableEnded) abort('response-closed')
  }

  req.on('aborted', onRequestAborted)
  res.on('close', onResponseClosed)
  if (req.aborted) onRequestAborted()

  return {
    signal: controller.signal,
    get responseId() { return currentResponseId },
    setResponseId(value) { currentResponseId = cleanResponseId(value) },
    cleanup() {
      req.off('aborted', onRequestAborted)
      res.off('close', onResponseClosed)
    },
  }
}
