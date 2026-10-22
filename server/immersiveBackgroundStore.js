import { AtomicJsonStore } from './atomicJsonStore.js'
import { normalizeImmersiveBackground } from './visuals/immersiveBackgroundSchema.js'

export function createImmersiveBackgroundStore(filePath) {
  const store = new AtomicJsonStore(filePath)
  const record = value => ({ version: 1, settings: normalizeImmersiveBackground(value?.settings), savedAt: value?.savedAt || null })
  return {
    async read() {
      try { return record(await store.load()) }
      catch (error) { if (error.code === 'ENOENT') return record(null); throw error }
    },
    async save(settings) {
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new TypeError('背景参数格式无效')
      return store.write({ version: 1, settings: normalizeImmersiveBackground(settings), savedAt: new Date().toISOString() })
    },
  }
}
