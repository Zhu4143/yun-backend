const MAX_LISTENING_EVENT_BYTES = 32 * 1024

// Narrow HTTP boundary: validation/sanitization stays in MusicMemoryService,
// while this handler never reflects incoming credentials or memory records.
export function createListeningEventHandler({ musicMemoryService, readJson, sendJson } = {}) {
  if (!musicMemoryService?.persistListeningEvent) throw new Error('music_memory_service_required')
  if (typeof readJson !== 'function') throw new Error('music_memory_read_json_required')
  if (typeof sendJson !== 'function') throw new Error('music_memory_send_json_required')

  return async function handleListeningEvent(req, res) {
    try {
      const input = await readJson(req, { maxBytes: MAX_LISTENING_EVENT_BYTES })
      const result = await musicMemoryService.persistListeningEvent(input)
      if (result.invalid) return sendJson(res, 400, { ok: false, written: false, duplicate: false })
      return sendJson(res, 200, { ok: true, written: result.written === true, duplicate: result.duplicate === true })
    } catch {
      return sendJson(res, 400, { ok: false, written: false, duplicate: false })
    }
  }
}

export function createMusicPreferencesHandler({ musicMemoryService, sendJson } = {}) {
  if (!musicMemoryService?.getPreferences) throw new Error('music_memory_preferences_service_required')
  if (typeof sendJson !== 'function') throw new Error('music_memory_send_json_required')
  return async function handleMusicPreferences(_req, res) {
    try { return sendJson(res, 200, { ok: true, snapshot: await musicMemoryService.getPreferences() }) }
    catch { return sendJson(res, 500, { ok: false, snapshot: null }) }
  }
}

export { MAX_LISTENING_EVENT_BYTES }
