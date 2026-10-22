import { AtomicJsonStore } from './atomicJsonStore.js'
import { normalizeLyricEffects } from './visuals/lyricEffectsSchema.js'

export function createLyricEffectsStore(filePath) {
  const store = new AtomicJsonStore(filePath)
  const record = value => ({ version: 1, settings: normalizeLyricEffects(value?.settings), savedAt: value?.savedAt || null })
  return {
    async read() {
      try { return record(await store.load()) }
      catch (error) { if (error.code === 'ENOENT') return record(null); throw error }
    },
    async save(settings) {
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new TypeError('歌词参数格式无效')
      return store.write({ version: 1, settings: normalizeLyricEffects(settings), savedAt: new Date().toISOString() })
    },
  }
}
