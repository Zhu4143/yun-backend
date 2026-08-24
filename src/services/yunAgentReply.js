const PLANNING_PLACEHOLDER = /^(?:我已经准备好执行这些操作。|计划已生成，等待播放器执行结果。)$/

export function buildYunAgentFinalReply(result = {}, executions = []) {
  const actions = Array.isArray(result.actions) ? result.actions : []
  if (!actions.length) return String(result.message || '').trim()

  const completed = executions.length === actions.length
    && executions.every((item) => item?.ok !== false && item?.cancelled !== true)
  if (!completed) {
    const error = executions.find((item) => item?.ok === false && item?.error)?.error
    return error ? `这次操作没有完成：${error}` : '这次操作没有完成，我没有假装它已经执行。'
  }

  const plannedMessage = String(result.message || '').trim()
  return !plannedMessage || PLANNING_PLACEHOLDER.test(plannedMessage)
    ? '已经按你的要求执行完成。'
    : plannedMessage
}
