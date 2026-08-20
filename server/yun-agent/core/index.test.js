import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createYunAgentCore } from './index.js'

test('createYunAgentCore assembles registry / state / memory / model', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-core-'))
  try {
    const core = createYunAgentCore({
      dataDir: dir,
      tools: [{ name: 'ping', enabled: true, parameters: {}, handler: async () => 'pong' }],
      memoryScope: 'music',
      modelEnv: {},
    })

    assert.equal(typeof core.registry.get, 'function')
    assert.equal(typeof core.state.get, 'function')
    assert.equal(typeof core.memory.context, 'function')
    assert.equal(typeof core.model.getStatus, 'function')

    assert.equal(core.memory.scope, 'music')
    assert.equal(core.model.getStatus().status, 'MODEL_OFFLINE')

    const result = await core.registry.invoke('ping')
    assert.equal(result.ok, true)
    assert.equal(result.data, 'pong')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
