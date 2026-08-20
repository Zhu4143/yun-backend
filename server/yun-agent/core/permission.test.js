import test from 'node:test'
import assert from 'node:assert/strict'
import { validateToolCall, evaluateToolCall, createConfirmation } from './permission.js'

const volumeTool = { name: 'set_volume', risk: 'medium', authorization: 'L2', enabled: true, requiresOnline: false, parameters: { value: '0-100' } }
const highRiskTool = { name: 'delete_file', risk: 'high', authorization: 'L3', enabled: true, requiresOnline: false, parameters: { path: 'string' } }
const onlineTool = { name: 'send_message', risk: 'high', authorization: 'L3', enabled: true, requiresOnline: true, parameters: { recipient: 'string', content: 'string' } }

test('validateToolCall rejects an unknown tool', () => {
  assert.equal(validateToolCall(null, {}).ok, false)
})

test('validateToolCall validates 0-100 and string parameters', () => {
  assert.equal(validateToolCall(volumeTool, { value: 120 }).ok, false)
  assert.equal(validateToolCall(volumeTool, { value: 40 }).ok, true)
  assert.equal(validateToolCall(volumeTool, { value: '40' }).ok, false)
  assert.equal(validateToolCall(onlineTool, { recipient: '', content: 'hi' }).ok, false)
  assert.equal(validateToolCall(onlineTool, { recipient: 'a', content: 'hi' }).ok, true)
})

test('validateToolCall rejects undeclared parameters', () => {
  assert.equal(validateToolCall(volumeTool, { value: 40, extra: 'x' }).ok, false)
})

test('validateToolCall rejects non-number values for number schema', () => {
  const numberTool = { name: 'seek_to', risk: 'low', authorization: 'L1', enabled: true, requiresOnline: false, parameters: { seconds: 'number' } }
  assert.equal(validateToolCall(numberTool, { seconds: '' }).ok, false)
  assert.equal(validateToolCall(numberTool, { seconds: '40' }).ok, false)
  assert.equal(validateToolCall(numberTool, { seconds: 40 }).ok, true)
  assert.equal(validateToolCall(numberTool, { seconds: NaN }).ok, false)
})

test('validateToolCall blocks path traversal', () => {
  assert.equal(validateToolCall(highRiskTool, { path: '../secret' }).ok, false)
})

test('evaluateToolCall requires confirmation for high risk', () => {
  const result = evaluateToolCall(highRiskTool, { path: 'ok' })
  assert.equal(result.ok, false)
  assert.equal(result.needsConfirmation, true)
  assert.equal(evaluateToolCall(highRiskTool, { path: 'ok' }, { confirmed: true }).ok, true)
})

test('evaluateToolCall gates disabled and offline tools', () => {
  assert.equal(evaluateToolCall({ ...volumeTool, enabled: false }, { value: 40 }).ok, false)
  assert.equal(evaluateToolCall(onlineTool, { recipient: 'a', content: 'hi' }).ok, false)
  assert.equal(evaluateToolCall(onlineTool, { recipient: 'a', content: 'hi' }, { confirmed: true, online: true }).ok, true)
})

test('createConfirmation carries tool metadata', () => {
  const confirmation = createConfirmation({ tool: highRiskTool, args: { path: 'x' }, actionId: 'a1', expiresAt: 't' })
  assert.equal(confirmation.actionId, 'a1')
  assert.equal(confirmation.tool, 'delete_file')
  assert.equal(confirmation.summary.includes('HIGH'), true)
})
