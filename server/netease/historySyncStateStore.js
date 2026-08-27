import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

function clone(value) {
  return value === null || value === undefined ? null : JSON.parse(JSON.stringify(value))
}

export function createFileNetEaseHistorySyncStateStore({ filePath } = {}) {
  if (!filePath) throw new Error('netease_history_sync_state_file_required')
  return {
    async get() {
      try { return JSON.parse(await readFile(filePath, 'utf8')) } catch (error) {
        if (error?.code === 'ENOENT') return null
        if (error instanceof SyntaxError) {
          const corruption = new Error('netease_history_sync_state_corruption', { cause: error })
          corruption.code = 'netease_history_sync_state_corruption'
          throw corruption
        }
        throw error
      }
    },
    async set(state) {
      await mkdir(path.dirname(filePath), { recursive: true })
      const temporaryPath = `${filePath}.${randomUUID()}.tmp`
      try {
        await writeFile(temporaryPath, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 })
        await rename(temporaryPath, filePath)
      } catch (error) {
        try { await unlink(temporaryPath) } catch { /* Preserve the original persistence error. */ }
        throw error
      }
    },
  }
}

export function createMemoryNetEaseHistorySyncStateStore(initialState = null) {
  let state = clone(initialState)
  return {
    async get() { return clone(state) },
    async set(nextState) { state = clone(nextState) },
  }
}
