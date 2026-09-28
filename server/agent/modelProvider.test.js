import test from 'node:test'
import assert from 'node:assert/strict'
import { createModelProvider } from './modelProvider.js'

test('model provider bounds planner output and disables streaming', async () => {
  let payload = null
  const provider = createModelProvider({
    env: { AI_PROVIDER: 'deepseek', AI_API_KEY: 'temporary-key', AI_BASE_URL: 'https://example.test', AI_MODEL: 'deepseek-v4-pro' },
    maxTokens: 1200,
    fetchImpl: async (url, options) => {
      payload = JSON.parse(options.body)
      return new Response(JSON.stringify({
        choices: [{ message: { tool_calls: [{ function: { name: 'music_recommend', arguments: '{}' } }] } }],
      }), { status: 200 })
    },
  })

  const result = await provider.sendMessage({
    systemPrompt: 'plan music',
    messages: [{ role: 'user', content: 'give me a playlist' }],
    tools: [{ type: 'function', function: { name: 'music_recommend', parameters: { type: 'object' } } }],
  })

  assert.equal(result.toolCalls.length, 1)
  assert.equal(payload.max_tokens, 1200)
  assert.equal(payload.stream, false)
})

test('caller cancellation aborts the upstream model request without retrying', async () => {
  const caller = new AbortController()
  let upstreamSignal
  let attempts = 0
  const provider = createModelProvider({
    env: { AI_PROVIDER: 'deepseek', AI_API_KEY: 'temporary-key', AI_BASE_URL: 'https://example.test', AI_MODEL: 'deepseek-v4-pro' },
    maxAttempts: 3,
    fetchImpl: async (_url, options) => {
      attempts += 1
      upstreamSignal = options.signal
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })
      })
    },
  })

  const pending = provider.sendMessage({
    systemPrompt: 'test',
    messages: [{ role: 'user', content: 'test' }],
    signal: caller.signal,
  })
  await new Promise((resolve) => setImmediate(resolve))
  caller.abort()

  await assert.rejects(pending, (error) => error?.name === 'AbortError')
  assert.equal(upstreamSignal.aborted, true)
  assert.equal(attempts, 1)
})
