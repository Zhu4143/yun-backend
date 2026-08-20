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
