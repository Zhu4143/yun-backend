import { fetchNeteaseLyrics } from '../api/neteaseApi.js'
import { fetchSongLyrics } from '../api/yunApi.js'

export function createSongLyricsLoader({ fetchNetease = fetchNeteaseLyrics, fetchLocal = fetchSongLyrics } = {}) {
  const requests = new Map()

  const load = (song) => {
    const songId = song?.id
    if (!songId) return Promise.resolve({ lines: [] })
    const source = song.source || 'local'
    const lookupId = source === 'netease' ? song.providerId || songId : songId
    const key = `${source}:${lookupId}`
    const cached = requests.get(key)
    if (cached) return cached

    const request = Promise.resolve()
      .then(() => source === 'netease' ? fetchNetease(lookupId) : fetchLocal(lookupId))
      .catch((error) => {
        if (requests.get(key) === request) requests.delete(key)
        throw error
      })
    requests.set(key, request)
    if (requests.size > 32) requests.delete(requests.keys().next().value)
    return request
  }

  return { load, prefetch: (song) => { load(song).catch(() => {}) } }
}

const songLyricsLoader = createSongLyricsLoader()
export const loadSongLyrics = songLyricsLoader.load
export const prefetchSongLyrics = songLyricsLoader.prefetch
