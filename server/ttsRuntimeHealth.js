export async function getTtsRuntimeHealth({ environment = process.env, fetchImpl = fetch, timeoutMs = 1800 } = {}) {
  const provider = String(environment.YUN_TTS_PROVIDER || 'doubao').trim().toLowerCase()
  if (provider === 'local-omnivoice' || provider === 'local-qwen3') {
    const baseUrl = provider === 'local-omnivoice'
      ? String(environment.YUN_OMNIVOICE_URL || 'http://127.0.0.1:17893')
      : String(environment.YUN_LOCAL_SPEECH_URL || 'http://127.0.0.1:17892')
    const healthUrl = `${baseUrl.replace(/\/+$/, '')}/health`
    try {
      const response = await fetchImpl(healthUrl, { signal: AbortSignal.timeout(timeoutMs) })
      const body = await response.json().catch(() => ({}))
      const available = response.ok && body.status !== 'error' && body.available !== false && body.modelLoaded !== false
      return { provider, configured: true, available, nativePlaybackOptional: true, runtime: body }
    } catch (error) {
      return { provider, configured: true, available: false, nativePlaybackOptional: true, error: error instanceof Error ? error.message : 'provider unavailable' }
    }
  }
  const apiKey = String(environment.DOUBAO_TTS_API_KEY || '').trim()
  const configured = Boolean(apiKey && !apiKey.includes('your_'))
  return { provider: 'doubao', configured, available: configured, nativePlaybackOptional: true }
}
