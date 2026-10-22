export function getNeteaseLikeSongId(song) {
  if (song?.source !== 'netease' && !String(song?.id || '').startsWith('netease-')) return ''
  const id = String(song?.providerId || song?.id || '').replace(/^netease-/, '').trim()
  return /^\d+$/.test(id) ? id : ''
}

// A changed song/account invalidates reads and writes before they reach the UI.
// If the user returns to a song while its write is pending, read it only after
// that write settles so an old server value cannot replace the new heart.
export function createNeteaseLikeController({ readLiked, writeLiked }) {
  let generation = 0
  let abortRead = null
  let snapshot = { songId: '', liked: null, status: 'unavailable', error: '' }
  const listeners = new Set()
  const pendingWrites = new Map()
  const publish = (next) => {
    snapshot = { ...snapshot, ...next }
    listeners.forEach((listener) => listener())
  }
  const fail = (error) => publish({
    status: error?.code === 'not_logged_in' || error?.code === 'unauthorized' ? 'login_required' : 'error',
    error: error instanceof Error ? error.message : '网易云红心同步失败',
  })

  async function selectSong(songId) {
    const selectedGeneration = ++generation
    abortRead?.abort()
    abortRead = null
    publish({ songId, liked: null, status: songId ? 'loading' : 'unavailable', error: '' })
    if (!songId) return
    const isCurrent = () => generation === selectedGeneration
    const controller = new AbortController()
    abortRead = controller
    try {
      await pendingWrites.get(songId)?.catch(() => {})
      if (!isCurrent()) return
      const result = await readLiked(songId, { signal: controller.signal })
      if (!isCurrent()) return
      const status = result.statuses?.find((item) => String(item.providerId) === songId)
      if (typeof status?.liked !== 'boolean') throw new Error('网易云没有返回这首歌的红心状态')
      publish({ liked: status.liked, status: 'ready', error: '' })
    } catch (error) {
      if (isCurrent()) fail(error)
    }
  }

  async function toggle() {
    if (!snapshot.songId || !['ready', 'error'].includes(snapshot.status)) return
    if (snapshot.liked === null) return selectSong(snapshot.songId)
    const { songId, liked } = snapshot
    const selectedGeneration = generation
    publish({ status: 'saving', error: '' })
    const mutation = Promise.resolve().then(() => writeLiked(songId, !liked))
    pendingWrites.set(songId, mutation)
    try {
      const result = await mutation
      if (result.providerId !== songId || result.liked !== !liked) throw new Error('网易云没有确认这首歌的红心状态')
      if (generation === selectedGeneration) publish({ liked: !liked, status: 'ready', error: '' })
    } catch (error) {
      if (generation === selectedGeneration) fail(error)
    } finally {
      if (pendingWrites.get(songId) === mutation) pendingWrites.delete(songId)
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    selectSong,
    toggle,
    clear: () => { ++generation; abortRead?.abort(); abortRead = null },
  }
}
