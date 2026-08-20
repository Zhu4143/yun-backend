// Yun Agent Core assembly — P1 only wires the reusable factories together.
// Planner, agent loop, skills, and music tools arrive in later phases and are
// intentionally absent here.

import path from 'node:path'
import { createToolRegistry } from './toolRegistry.js'
import { createStateStore } from './stateStore.js'
import { createMemoryStore } from './memoryStore.js'
import { createModelProvider } from './modelProvider.js'

export function createYunAgentCore({
  dataDir,
  tools = [],
  memoryScope = 'default',
  modelEnv = process.env,
  modelConfigPath = null,
  modelProviderOptions = {},
  modelProvider = null,
} = {}) {
  const registry = createToolRegistry(tools)
  const state = createStateStore(path.join(dataDir, 'runtime_state.json'))
  const memory = createMemoryStore(path.join(dataDir, 'memory.json'), { scope: memoryScope })
  const model = modelProvider || createModelProvider({ env: modelEnv, configPath: modelConfigPath, ...modelProviderOptions })

  return { registry, state, memory, model }
}

export { createToolRegistry } from './toolRegistry.js'
export { validateToolCall, evaluateToolCall, createConfirmation } from './permission.js'
export { createStateStore, DEFAULT_RUNTIME_STATE } from './stateStore.js'
export { createMemoryStore, DEFAULT_MEMORY } from './memoryStore.js'
export { createModelProvider } from './modelProvider.js'
