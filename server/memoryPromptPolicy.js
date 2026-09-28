const DISABLED_MEMORY_TEXT = '本地记忆未启用。'

export function resolveYunMemoryPolicy(settings = {}) {
  const memoryMode = ['off', 'smart', 'deep'].includes(settings.memoryMode) ? settings.memoryMode : 'smart'
  const memoryEnabled = settings.memoryEnabled !== false
  return { memoryEnabled, memoryMode, enabled: memoryEnabled && memoryMode !== 'off' }
}

export function createMemoryPromptContext({
  memoryMode = 'smart',
  memoryEnabled = true,
  userMemory = null,
  companionMemory = {},
} = {}) {
  const enabled = resolveYunMemoryPolicy({ memoryMode, memoryEnabled }).enabled
  return {
    enabled,
    userMemory: enabled && userMemory
      ? JSON.stringify(userMemory).slice(0, 5000)
      : DISABLED_MEMORY_TEXT,
    companionMemory: enabled
      ? JSON.stringify(companionMemory).slice(0, 1000)
      : DISABLED_MEMORY_TEXT,
  }
}
