// Generic tool-call permission gate, generalized from MOSS's
// `server/agent/mossPermission.js`.
//
// Parameter validation and risk/confirmation/online evaluation are separated
// so callers can validate a call without executing it.

const HIGH_RISK = 'high'

export function validateToolCall(tool, args = {}) {
  if (!tool) return { ok: false, error: 'unknown_tool' }
  const parameters = tool.parameters || {}
  const safeArgs = args && typeof args === 'object' && !Array.isArray(args) ? args : {}

  const declaredKeys = new Set(Object.keys(parameters))
  const extraKeys = Object.keys(safeArgs).filter((key) => !declaredKeys.has(key))
  if (extraKeys.length) {
    return { ok: false, error: `存在未声明的参数：${extraKeys.join('、')}` }
  }

  for (const [key, expected] of Object.entries(parameters)) {
    const value = safeArgs[key]
    if (expected === '0-100') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
        return { ok: false, error: `参数 ${key} 必须为 0 至 100 的数字。` }
      }
    } else if (expected === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { ok: false, error: `参数 ${key} 必须为数字。` }
      }
    } else if (expected === 'string') {
      if (typeof value !== 'string' || !value.trim()) {
        return { ok: false, error: `参数 ${key} 不能为空。` }
      }
    } else if (expected === 'boolean') {
      if (typeof value !== 'boolean') {
        return { ok: false, error: `参数 ${key} 必须为布尔值。` }
      }
    }
    if (String(key).includes('path') && typeof value === 'string' && value.includes('..')) {
      return { ok: false, error: '路径参数不能包含上级目录跳转。' }
    }
  }
  return { ok: true, tool }
}

export function evaluateToolCall(tool, args = {}, { online = false, confirmed = false } = {}) {
  const validation = validateToolCall(tool, args)
  if (!validation.ok) return validation
  if (tool.risk === HIGH_RISK && !confirmed) {
    return { ok: false, needsConfirmation: true, tool, error: '该操作属于高风险操作，需要用户明确确认。' }
  }
  if (!tool.enabled) {
    return { ok: false, tool, error: `工具 ${tool.name} 当前未启用，未执行任何操作。` }
  }
  if (tool.requiresOnline && !online) {
    return { ok: false, tool, error: `工具 ${tool.name} 依赖的后端当前未连接，无法执行该指令。` }
  }
  return { ok: true, tool }
}

export function createConfirmation({ tool, args, actionId, expiresAt }) {
  return {
    actionId,
    tool: tool?.name || '',
    summary: `请求执行 ${tool?.name || ''}。风险等级：${String(tool?.risk || 'low').toUpperCase()}。`,
    parameters: args,
    expiresAt,
    warning: '确认后系统会再次校验权限、工具启用状态与参数；未通过校验时不会执行。',
  }
}
