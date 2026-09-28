import assert from 'node:assert/strict'
import test from 'node:test'

import { createMemoryPromptContext } from './memoryPromptPolicy.js'

test('memory off excludes user and companion memory while preserving current-turn policy', () => {
  const context = createMemoryPromptContext({
    memoryMode: 'off',
    memoryEnabled: true,
    userMemory: { privateDetail: 'should not be sent' },
    companionMemory: { rememberedPreference: 'should not be sent' },
  })

  assert.equal(context.enabled, false)
  assert.equal(context.userMemory, '本地记忆未启用。')
  assert.equal(context.companionMemory, '本地记忆未启用。')
  assert.doesNotMatch(JSON.stringify(context), /should not be sent/)
})

test('per-turn memory disable excludes memory even when the saved mode is enabled', () => {
  const context = createMemoryPromptContext({
    memoryMode: 'deep',
    memoryEnabled: false,
    userMemory: { privateDetail: 'should not be sent' },
    companionMemory: { rememberedPreference: 'should not be sent' },
  })

  assert.equal(context.enabled, false)
  assert.doesNotMatch(JSON.stringify(context), /privateDetail|rememberedPreference/)
})
