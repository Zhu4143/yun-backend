export const MUSIC_LONG_TERM_SUMMARY_VERSION = 'music-long-term-preferences/v1'

export const MUSIC_PROMOTION_POLICY = Object.freeze({
  track: Object.freeze({
    positive: Object.freeze({ minimumPlays: 5, minimumPositiveOutcomes: 3, maximumSkipRate: 0.25, minimumLongTermAffinity: 5 }),
    strongPositive: Object.freeze({ minimumPlays: 8, minimumPositiveOutcomes: 5 }),
    negative: Object.freeze({ minimumPlays: 4, minimumSkips: 3, minimumSkipRate: 0.6, maximumDirectScore: -1 }),
    strongNegative: Object.freeze({ minimumPlays: 6, minimumSkips: 5, minimumSkipRate: 0.75 }),
    providerExposure: Object.freeze({ minimumObservations: 2, minimumReportedCount: 5 }),
  }),
  artist: Object.freeze({ minimumTracks: 2, minimumPositivePlays: 10, minimumNegativePlays: 8 }),
  stale: Object.freeze({ moderateAfterDays: 180, weakAfterDays: 365 }),
})

function finite(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function timestamp(value) {
  if (value === null || value === undefined || value === '') return null
  const milliseconds = new Date(value).getTime()
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null
}

function unique(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))].sort()
}

function strengthAfterStaleness(baseStrength, lastConfirmedAt, asOfAt) {
  const confirmed = timestamp(lastConfirmedAt)
  const frontier = timestamp(asOfAt)
  if (!confirmed || !frontier) return { strength: baseStrength, stale: false, staleDays: null }
  const staleDays = Math.max(0, Math.floor((new Date(frontier).getTime() - new Date(confirmed).getTime()) / 86400000))
  const levels = ['weak', 'moderate', 'strong']
  const baseIndex = Math.max(0, levels.indexOf(baseStrength))
  const decay = staleDays >= MUSIC_PROMOTION_POLICY.stale.weakAfterDays ? 2 : staleDays >= MUSIC_PROMOTION_POLICY.stale.moderateAfterDays ? 1 : 0
  return { strength: levels[Math.max(0, baseIndex - decay)], stale: decay > 0, staleDays }
}

function basePreference(track, { signal, confidence, source, evidenceType, provenance, baseStrength, firstPromotedAt, lastConfirmedAt, evidence }) {
  const staleState = strengthAfterStaleness(baseStrength, lastConfirmedAt, track.asOfAt)
  return {
    trackId: String(track.trackId || ''),
    providerId: track.providerId || null,
    title: track.title || null,
    artist: track.artist || null,
    signal,
    confidence,
    source,
    provenance: unique(provenance),
    evidenceType,
    firstPromotedAt: timestamp(firstPromotedAt) || timestamp(lastConfirmedAt),
    lastConfirmedAt: timestamp(lastConfirmedAt),
    strength: staleState.strength,
    stale: staleState.stale,
    staleDays: staleState.staleDays,
    evidence,
  }
}

function promoteTrack(input, asOfAt, previous) {
  const track = { ...input, asOfAt }
  const direct = track.directListening || {}
  const provider = track.providerObservation || {}
  const derived = track.derived || {}
  const playCount = finite(direct.playCount)
  const completeCount = finite(direct.completeCount)
  const repeatCount = finite(direct.repeatCount)
  const skipCount = finite(direct.skipCount)
  const positiveOutcomes = completeCount + repeatCount
  const skipRate = derived.skipRate === null || derived.skipRate === undefined ? (playCount ? skipCount / playCount : null) : finite(derived.skipRate)
  const directScore = playCount + completeCount * 1.8 + repeatCount * 1.6 - skipCount * 2.4
  const evidence = { playCount, completeCount, repeatCount, skipCount, skipRate, directScore, longTermAffinity: finite(derived.longTermAffinity), recentAffinity: finite(derived.recentAffinity) }
  const lastDirectAt = direct.lastDirectPlayedAt || null

  const positive = MUSIC_PROMOTION_POLICY.track.positive
  if (playCount >= positive.minimumPlays && positiveOutcomes >= positive.minimumPositiveOutcomes && skipRate !== null && skipRate <= positive.maximumSkipRate && finite(derived.longTermAffinity) >= positive.minimumLongTermAffinity) {
    const strong = MUSIC_PROMOTION_POLICY.track.strongPositive
    const baseStrength = playCount >= strong.minimumPlays && positiveOutcomes >= strong.minimumPositiveOutcomes ? 'strong' : 'moderate'
    return basePreference(track, { signal: 'positive', confidence: 'high', source: 'inferred_behavior', evidenceType: 'direct_player', provenance: ['direct_player'], baseStrength, firstPromotedAt: previous?.signal === 'positive' ? previous.firstPromotedAt : null, lastConfirmedAt: lastDirectAt, evidence })
  }

  const negative = MUSIC_PROMOTION_POLICY.track.negative
  if (playCount >= negative.minimumPlays && skipCount >= negative.minimumSkips && skipRate !== null && skipRate >= negative.minimumSkipRate && directScore <= negative.maximumDirectScore) {
    const strong = MUSIC_PROMOTION_POLICY.track.strongNegative
    const baseStrength = playCount >= strong.minimumPlays && skipCount >= strong.minimumSkips && skipRate >= strong.minimumSkipRate ? 'strong' : 'moderate'
    return basePreference(track, { signal: 'negative', confidence: 'high', source: 'inferred_behavior', evidenceType: 'direct_player', provenance: ['direct_player'], baseStrength, firstPromotedAt: previous?.signal === 'negative' ? previous.firstPromotedAt : null, lastConfirmedAt: lastDirectAt, evidence })
  }

  const noDirectBehavior = playCount === 0 && completeCount === 0 && repeatCount === 0 && skipCount === 0
  const exposure = MUSIC_PROMOTION_POLICY.track.providerExposure
  const observedCount = finite(provider.observedCount)
  const providerReportedCount = provider.providerReportedCount === null || provider.providerReportedCount === undefined ? null : finite(provider.providerReportedCount)
  if (noDirectBehavior && (observedCount >= exposure.minimumObservations || providerReportedCount >= exposure.minimumReportedCount)) {
    return basePreference(track, {
      signal: 'exposure', confidence: providerReportedCount >= 20 || observedCount >= 4 ? 'medium' : 'low',
      source: 'provider_history', evidenceType: 'provider_exposure', provenance: provider.provenance || [], baseStrength: 'weak',
      firstPromotedAt: previous?.signal === 'exposure' ? previous.firstPromotedAt : null,
      lastConfirmedAt: provider.lastProviderPlayedAt || provider.lastObservedAt,
      evidence: { observedCount, providerReportedCount, directPlayCount: 0 },
    })
  }
  return null
}

function buildArtistPreferences(tracks, asOfAt, previousArtists = {}) {
  const groups = new Map()
  for (const track of Object.values(tracks)) {
    if (!track.artist || track.evidenceType !== 'direct_player' || !['positive', 'negative'].includes(track.signal)) continue
    if (!groups.has(track.artist)) groups.set(track.artist, [])
    groups.get(track.artist).push(track)
  }
  return Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([artist, entries]) => {
    const positive = entries.filter((entry) => entry.signal === 'positive')
    const negative = entries.filter((entry) => entry.signal === 'negative')
    const candidates = positive.length > negative.length ? positive : negative.length > positive.length ? negative : []
    if (candidates.length < MUSIC_PROMOTION_POLICY.artist.minimumTracks) return []
    const signal = candidates[0].signal
    const totalDirectPlayCount = candidates.reduce((sum, entry) => sum + finite(entry.evidence?.playCount), 0)
    const requiredPlays = signal === 'positive' ? MUSIC_PROMOTION_POLICY.artist.minimumPositivePlays : MUSIC_PROMOTION_POLICY.artist.minimumNegativePlays
    if (totalDirectPlayCount < requiredPlays) return []
    const lastConfirmedAt = candidates.map((entry) => entry.lastConfirmedAt).filter(Boolean).sort().at(-1) || null
    const firstPromotedAt = (previousArtists[artist]?.signal === signal ? timestamp(previousArtists[artist]?.firstPromotedAt) : null) || candidates.map((entry) => entry.firstPromotedAt).filter(Boolean).sort()[0] || null
    const baseStrength = candidates.length >= 3 || totalDirectPlayCount >= 16 ? 'strong' : 'moderate'
    const staleState = strengthAfterStaleness(baseStrength, lastConfirmedAt, asOfAt)
    return [[artist, {
      artist, signal, confidence: 'high', source: 'inferred_behavior', evidenceType: 'direct_player',
      provenance: unique(candidates.flatMap((entry) => entry.provenance)), firstPromotedAt, lastConfirmedAt,
      strength: staleState.strength, stale: staleState.stale, staleDays: staleState.staleDays,
      evidence: { trackCount: candidates.length, totalDirectPlayCount, trackIds: candidates.map((entry) => entry.trackId).sort() },
    }]]
  }))
}

export function buildMusicLongTermSummary(snapshot = {}, { previousSummary } = {}) {
  const asOfAt = timestamp(snapshot.asOfAt)
  const tracks = Object.fromEntries(Object.entries(snapshot.tracks || {}).sort(([a], [b]) => a.localeCompare(b)).flatMap(([key, track]) => {
    const promoted = promoteTrack({ ...track, trackId: track?.trackId || key }, asOfAt, previousSummary?.tracks?.[key])
    return promoted ? [[key, promoted]] : []
  }))
  return {
    version: MUSIC_LONG_TERM_SUMMARY_VERSION,
    generatedAt: timestamp(snapshot.generatedAt),
    asOfAt,
    sourceSnapshot: { version: snapshot.version || null, generatedAt: timestamp(snapshot.generatedAt), asOfAt },
    tracks,
    artists: buildArtistPreferences(tracks, asOfAt, previousSummary?.artists),
    policy: MUSIC_PROMOTION_POLICY,
  }
}

function explicitEntries(value) {
  if (Array.isArray(value)) return value
  return value && typeof value === 'object' ? Object.values(value) : []
}

function explicitSignal(value) {
  const signal = String(value || '').toLowerCase()
  if (['negative', 'dislike', 'hate'].includes(signal)) return 'negative'
  if (['positive', 'like', 'love'].includes(signal)) return 'positive'
  return null
}

export function mergeExplicitAndInferredMusicPreferences(explicitPreferences = {}, inferredSummary = {}) {
  const tracks = Object.fromEntries(Object.entries(inferredSummary.tracks || {}).map(([key, value]) => [key, { ...value }]))
  const artists = Object.fromEntries(Object.entries(inferredSummary.artists || {}).map(([key, value]) => [key, { ...value }]))
  const merge = (target, entries, keyFor) => {
    for (const entry of explicitEntries(entries)) {
      const key = String(keyFor(entry) || '').trim()
      const signal = explicitSignal(entry?.signal)
      if (!key || !signal) continue
      const inferred = target[key] || null
      target[key] = {
        ...(inferred || {}), ...entry, signal, confidence: 'high', source: 'explicit_user', evidenceType: 'explicit_statement',
        provenance: ['explicit_user_statement'], strength: 'strong',
        behavioralMismatch: inferred && inferred.signal !== signal ? { inferredSignal: inferred.signal, inferredSource: inferred.source } : null,
      }
    }
  }
  merge(tracks, explicitPreferences.tracks, (entry) => entry?.trackId || entry?.providerId || entry?.id)
  merge(artists, explicitPreferences.artists, (entry) => entry?.artist || entry?.name)
  return { ...inferredSummary, tracks, artists }
}
