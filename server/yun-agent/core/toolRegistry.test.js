import test from 'node:test'
import assert from 'node:assert/strict'
import { createToolRegistry } from './toolRegistry.js'

const tools = [
  { name: 'get_time', description: 'read time', risk: 'low', authorization: 'L1', enabled: true, parameters: {}, handler: async () => ({ now: '2026-01-01' }) },
  { name: 'set_volume', description: 'set volume', risk: 'medium', authorization: 'L2', enabled: true, parameters: { value: '0-100' }, handler: async (args) => ({ value: args.value }) },
  { name: 'disabled_tool', description: 'off', risk: 'low', authorization: 'L1', enabled: false, parameters: {}, handler: async () => ({}) },
  { name: 'no_handler', description: 'no impl', risk: 'low', authorization: 'L1', enabled: true, parameters: {} },
]

test('registry exposes get / list / listEnabled', () => {
  const registry = createToolRegistry(tools)
  assert.equal(registry.get('get_time').name, 'get_time')
  assert.equal(registry.get('missing'), null)
  assert.equal(registry.list().length, 4)
  assert.equal(registry.listEnabled().length, 3)
})

test('toModelTools maps enabled tools to function-calling schema', () => {
  const registry = createToolRegistry(tools)
  const modelTools = registry.toModelTools()
  assert.equal(modelTools.length, 3)
  const volume = modelTools.find((tool) => tool.function.name === 'set_volume')
  assert.equal(volume.function.parameters.properties.value.type, 'number')
  assert.deepEqual(volume.function.parameters.required, ['value'])
  assert.equal(volume.function.parameters.additionalProperties, false)
})

test('invoke runs the handler and returns its data', async () => {
  const registry = createToolRegistry(tools)
  const result = await registry.invoke('set_volume', { value: 40 })
  assert.equal(result.ok, true)
  assert.equal(result.data.value, 40)
})

test('invoke reports errors for unknown / disabled / handler-less tools', async () => {
  const registry = createToolRegistry(tools)
  assert.equal((await registry.invoke('missing')).error, 'unknown_tool')
  assert.equal((await registry.invoke('disabled_tool')).error, 'tool_disabled')
  assert.equal((await registry.invoke('no_handler')).error, 'tool_has_no_handler')
})

test('invoke catches handler errors', async () => {
  const registry = createToolRegistry([{ name: 'boom', enabled: true, parameters: {}, handler: async () => { throw new Error('kaboom') } }])
  const result = await registry.invoke('boom')
  assert.equal(result.ok, false)
  assert.equal(result.error, 'kaboom')
})
