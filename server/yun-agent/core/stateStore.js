// Generic JSON runtime-state store, generalized from MOSS's
// `server/agent/mossState.js`.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const DEFAULT_RUNTIME_STATE = Object.freeze({
  status: 'READY',
  currentTask: null,
  activeTool: null,
  lastToolResult: null,
  lastError: null,
  updatedAt: null,
})

export function createStateStore(filePath, defaultState = DEFAULT_RUNTIME_STATE) {
  let state = { ...defaultState }
  let loaded = false

  async function ensureLoaded() {
    if (loaded) return
    try {
      state = { ...defaultState, ...JSON.parse(await readFile(filePath, 'utf8')) }
    } catch {
      state = { ...defaultState }
    }
    loaded = true
  }

  return {
    async get() {
      await ensureLoaded()
      return { ...state }
    },
    async update(patch) {
      await ensureLoaded()
      state = { ...state, ...patch, updatedAt: new Date().toISOString() }
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
      return { ...state }
    },
  }
}
