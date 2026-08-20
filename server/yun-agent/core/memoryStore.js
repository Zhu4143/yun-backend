// Generic scoped memory store, generalized from MOSS's
// `server/agent/mossMemory.js`.
//
// Adds a `scope` so music, companion, and agent subsystems can share one file
// while keeping their long-term entries and session turns separate.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const DEFAULT_MEMORY = Object.freeze({ profile: {}, longTerm: [], sessions: {} })
const SENSITIVE = /(密码|password|token|api[_ -]?key|密钥|身份证|银行卡)/i

export function createMemoryStore(filePath, { scope = 'default', longTermLimit = 50, sessionLimit = 24 } = {}) {
  let data = null

  async function load() {
    if (data) return data
    try {
      data = { ...DEFAULT_MEMORY, ...JSON.parse(await readFile(filePath, 'utf8')) }
    } catch {
      data = structuredClone(DEFAULT_MEMORY)
    }
    return data
  }

  async function save() {
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  }

  return {
    scope,
    async context(sessionId) {
      const memory = await load()
      return {
        profile: memory.profile,
        longTerm: memory.longTerm.filter((item) => (item?.scope || 'default') === scope).slice(-8),
        recent: (memory.sessions[sessionId] || []).filter((turn) => (turn?.scope || 'default') === scope).slice(-8),
      }
    },
    async appendTurn(sessionId, turn) {
      const memory = await load()
      memory.sessions[sessionId] = [...(memory.sessions[sessionId] || []), { ...turn, scope }].slice(-sessionLimit)
      await save()
    },
    async remember(text, options = {}) {
      const memory = await load()
      if (SENSITIVE.test(String(text || ''))) {
        return { saved: false, reason: '检测到敏感信息，不会将其写入长期记忆。' }
      }
      memory.longTerm.push({
        text: String(text || '').slice(0, 400),
        createdAt: new Date().toISOString(),
        source: options.source || 'explicit-user-request',
        scope,
      })
      memory.longTerm = memory.longTerm.slice(-longTermLimit)
      await save()
      return { saved: true }
    },
  }
}
