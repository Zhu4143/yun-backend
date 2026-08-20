export function createResponse(overrides = {}) {
  return {
    message: '',
    intent: 'chat',
    mode: 'normal',
    risk: { level: 'low', reason: '' },
    requiresConfirmation: false,
    toolCall: null,
    memoryUpdate: null,
    uiUpdate: { status: 'READY', task: '', riskLevel: 'LOW' },
    ...overrides,
  }
}

export function parseModelResponse(content) {
  const source = String(content || '').trim().replace(/^```json\s*|```$/g, '')
  const parsed = JSON.parse(source)
  if (!parsed || typeof parsed.message !== 'string') throw new Error('模型返回结构无效')
  return createResponse(parsed)
}
