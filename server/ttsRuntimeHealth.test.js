import assert from 'node:assert/strict'
import test from 'node:test'

import { getTtsRuntimeHealth } from './ttsRuntimeHealth.js'

test('local OmniVoice boot health probes the provider used by the TTS route', async () => {
  let requestedUrl
  const result = await getTtsRuntimeHealth({
    environment: { YUN_TTS_PROVIDER: 'local-omnivoice', YUN_OMNIVOICE_URL: 'http://127.0.0.1:17893/' },
    fetchImpl: async (url) => {
      requestedUrl = url
      return new Response(JSON.stringify({ status: 'ok', modelLoaded: true }), { status: 200 })
    },
  })

  assert.equal(requestedUrl, 'http://127.0.0.1:17893/health')
  assert.equal(result.provider, 'local-omnivoice')
  assert.equal(result.available, true)
  assert.equal(result.nativePlaybackOptional, true)
})

test('remote TTS readiness follows the configuration required by /api/tts', async () => {
  const missing = await getTtsRuntimeHealth({ environment: { YUN_TTS_PROVIDER: 'doubao' } })
  const configured = await getTtsRuntimeHealth({
    environment: { YUN_TTS_PROVIDER: 'doubao', DOUBAO_TTS_API_KEY: 'configured-key' },
  })

  assert.equal(missing.configured, false)
  assert.equal(configured.configured, true)
  assert.equal(configured.available, true)
})
