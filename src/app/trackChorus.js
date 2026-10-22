import { fetchLocalApi } from '../api/requestApi.js'

export function chorusWithinDuration(chorus, duration) {
  if (chorus?.source !== 'netease-chorus' || !Number.isFinite(chorus.start) || !Number.isFinite(chorus.end)) return null
  if (!Number.isFinite(duration) || !(duration > 0) || chorus.start < 0 || chorus.start >= duration || chorus.end <= chorus.start) return null
  return { ...chorus, end: Math.min(chorus.end, duration) }
}

export function createTrackChorusLoader(fetcher = fetchLocalApi) {
  const requests = new Map()
  return songId => {
    const id = String(songId || '').replace(/^netease-/, '')
    if (!/^\d+$/.test(id)) return Promise.resolve(null)
    if (requests.has(id)) return requests.get(id)
    const request = Promise.resolve().then(async () => {
      const response = await fetcher(`/api/netease/chorus?id=${encodeURIComponent(id)}`, {}, { timeoutMs: 8000 })
      const data = await response.json()
      if (!response.ok || data.ok === false) throw new Error('Chorus unavailable')
      return data.chorus || null
    }).catch(error => {
      if (requests.get(id) === request) requests.delete(id)
      throw error
    })
    requests.set(id, request)
    if (requests.size > 32) requests.delete(requests.keys().next().value)
    return request
  }
}

export const loadTrackChorus = createTrackChorusLoader()
