export function normalizeSongChorus(response, id) {
  const body = response?.body || response || {}
  const rows = Array.isArray(body.chorus) ? body.chorus : Array.isArray(body.data) ? body.data : []
  const row = rows.find(item => String(item?.id) === String(id))
  if (row?.startTime == null || row?.endTime == null) return null
  const start = Number(row.startTime) / 1000
  const end = Number(row.endTime) / 1000
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return null
  return { start, end, source: 'netease-chorus' }
}

export function createSongChorusLoader(fetchChorus, { now = Date.now } = {}) {
  const entries = new Map()
  return id => {
    const cached = entries.get(id)
    if (cached && cached.expires > now()) return cached.promise
    const promise = Promise.resolve().then(() => fetchChorus(id)).then(result => normalizeSongChorus(result, id)).catch(error => {
      if (entries.get(id)?.promise === promise) entries.delete(id)
      throw error
    })
    entries.set(id, { promise, expires: now() + 15 * 60 * 1000 })
    if (entries.size > 64) entries.delete(entries.keys().next().value)
    return promise
  }
}
