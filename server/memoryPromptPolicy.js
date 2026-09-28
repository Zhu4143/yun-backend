const DISABLED_MEMORY_TEXT = '本地记忆未启用。'

export function createMemoryPromptContext({
  memoryMode = 'smart',
  memoryEnabled = true,
  userMemory = null,
  companionMemory = {},
} = {}) {
  const enabled = memoryMode !== 'off' && memoryEnabled !== false
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
