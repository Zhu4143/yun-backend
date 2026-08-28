export const MUSIC_PREFERENCE_SNAPSHOT_VERSION = 'music-preferences/v1'

function finite(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function time(value) {
  const result = new Date(value).getTime()
  return Number.isFinite(result) ? result : null
}

function later(a, b) {
  if (!a) return b || null
  if (!b) return a
  return time(a) >= time(b) ? a : b
}

function trackKey(evidence) {
  return String(evidence?.trackId || evidence?.providerId || '').trim()
}

function newTrack(evidence) {
  return {
    trackId: trackKey(evidence), providerId: evidence.providerId || null, source: evidence.source || null,
    title: evidence.title || null, artist: evidence.artist || null, album: evidence.album || null,
    directListening: { playCount: 0, skipCount: 0, completeCount: 0, repeatCount: 0, pauseCount: 0, seekCount: 0, totalListenDurationMs: 0, lastDirectPlayedAt: null },
    providerObservation: { observedCount: 0, providerReportedCount: null, lastProviderPlayedAt: null, lastObservedAt: null, provenance: [] },
  }
}

function directWeight(type) {
  return ({ play: 1, resume: 0.6, complete: 1.8, repeat: 1.6, skip: -2.4, next: -1.2, previous: -1.2, pause: 0, seek: 0 })[type] || 0
}

function decay(at, generatedAt) {
  const age = Math.max(0, (time(generatedAt) - time(at)) / 86400000)
  return Math.exp(-age / 30)
}

function numeric(value) { return Math.round(value * 1000000) / 1000000 }

export function buildMusicPreferenceSnapshot({ listeningEvents = [], musicObservations = [], generatedAt }) {
  const safeGeneratedAt = new Date(generatedAt).toISOString()
  const tracks = new Map()
  const get = (evidence) => {
    const key = trackKey(evidence)
    if (!key) return null
    if (!tracks.has(key)) tracks.set(key, newTrack(evidence))
    return tracks.get(key)
  }
  const direct = [...listeningEvents].sort((a, b) => String(a.id).localeCompare(String(b.id)))
  const provider = [...musicObservations].sort((a, b) => String(a.id).localeCompare(String(b.id)))

  for (const event of direct) {
    const aggregate = get(event)
    if (!aggregate) continue
    const listening = aggregate.directListening
    if (event.type === 'play') { listening.playCount += 1; listening.lastDirectPlayedAt = later(listening.lastDirectPlayedAt, event.timestamp) }
    if (event.type === 'skip' || event.type === 'next' || event.type === 'previous') listening.skipCount += 1
    if (event.type === 'complete') listening.completeCount += 1
    if (event.type === 'repeat') listening.repeatCount += 1
    if (event.type === 'pause') listening.pauseCount += 1
    if (event.type === 'seek') listening.seekCount += 1
    const duration = finite(event.metadata?.listenDurationMs)
    if (duration !== null && duration >= 0 && ['skip', 'complete', 'next', 'previous'].includes(event.type)) listening.totalListenDurationMs += duration
  }
  for (const observation of provider) {
    const aggregate = get(observation)
    if (!aggregate) continue
    const evidence = aggregate.providerObservation
    evidence.observedCount += 1
    const count = finite(observation.playCount)
    if (count !== null && count >= 0) evidence.providerReportedCount = evidence.providerReportedCount === null ? count : Math.max(evidence.providerReportedCount, count)
    evidence.lastObservedAt = later(evidence.lastObservedAt, observation.observedAt)
    evidence.lastProviderPlayedAt = later(evidence.lastProviderPlayedAt, observation.metadata?.providerPlayedAt || null)
    if (!evidence.provenance.includes(observation.provenance)) evidence.provenance.push(observation.provenance)
  }

  const artistMap = new Map()
  const orderedTracks = Object.fromEntries([...tracks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, aggregate]) => {
    const d = aggregate.directListening
    const p = aggregate.providerObservation
    const directScore = d.playCount + d.completeCount * 1.8 + d.repeatCount * 1.6 - d.skipCount * 2.4
    const providerScore = p.observedCount * 0.35 + Math.log1p(p.providerReportedCount || 0) * 0.18
    const recentDirect = direct.reduce((score, event) => trackKey(event) === key ? score + directWeight(event.type) * decay(event.timestamp, safeGeneratedAt) : score, 0)
    const recentProvider = provider.reduce((score, event) => trackKey(event) === key ? score + 0.35 * decay(event.metadata?.providerPlayedAt || event.observedAt, safeGeneratedAt) : score, 0)
    const derived = {
      completionRate: d.playCount ? numeric(d.completeCount / d.playCount) : null,
      skipRate: d.playCount ? numeric(d.skipCount / d.playCount) : null,
      repeatRate: d.playCount ? numeric(d.repeatCount / d.playCount) : null,
      recentAffinity: numeric(recentDirect + recentProvider),
      longTermAffinity: numeric(directScore + providerScore),
      confidence: d.playCount || d.completeCount || d.skipCount || d.repeatCount ? 'high' : (p.observedCount ? 'medium' : 'low'),
    }
    const result = { ...aggregate, derived }
    const artist = result.artist || '未知歌手'
    if (!artistMap.has(artist)) artistMap.set(artist, { artist, directPlayCount: 0, directCompleteCount: 0, directSkipCount: 0, directRepeatCount: 0, providerObservedCount: 0, trackCount: 0, recentAffinity: 0, longTermAffinity: 0 })
    const artistAggregate = artistMap.get(artist)
    artistAggregate.directPlayCount += d.playCount; artistAggregate.directCompleteCount += d.completeCount; artistAggregate.directSkipCount += d.skipCount; artistAggregate.directRepeatCount += d.repeatCount
    artistAggregate.providerObservedCount += p.observedCount; artistAggregate.trackCount += 1; artistAggregate.recentAffinity += derived.recentAffinity; artistAggregate.longTermAffinity += derived.longTermAffinity
    return [key, result]
  }))
  const artists = Object.fromEntries([...artistMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, { ...value, recentAffinity: numeric(value.recentAffinity), longTermAffinity: numeric(value.longTermAffinity) }]))
  return {
    version: MUSIC_PREFERENCE_SNAPSHOT_VERSION, generatedAt: safeGeneratedAt, tracks: orderedTracks, artists,
    recent: { windowDays: 30, directWeight: 1, providerWeight: 0.35 },
    longTerm: { directBehaviorWeight: 1, providerExposureWeight: 0.35 },
    evidenceSummary: { directEvidenceCount: direct.length, providerEvidenceCount: provider.length, confidenceBreakdown: { high: direct.length, medium: provider.length }, direct: { count: direct.length, lastAt: direct.reduce((value, event) => later(value, event.timestamp), null) }, provider: { count: provider.length, lastAt: provider.reduce((value, event) => later(value, event.observedAt), null), provenance: [...new Set(provider.map((event) => event.provenance))].sort() } },
  }
}
