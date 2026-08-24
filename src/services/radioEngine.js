import { resolveNeteaseSongCandidate, searchNeteaseSongs } from '../api/neteaseApi.js'
import { NeteaseApiAdapter } from './netease/apiAdapter.js'
import { NeteaseCapabilityExecutor } from './netease/capabilityExecutor.js'
import { selectNeteaseSongCandidate } from './netease/capabilityPlanner.js'
import { YunPlayerAdapter } from './netease/playerAdapter.js'

const PLAN_VERSION = 'radio-plan/v1'

function compactText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
}

function trackKey(track) {
  return String(track?.providerId || track?.id || '').trim()
}

function collectRecentTrackKeys(context = {}) {
  return new Set([
    context.currentSong,
    ...(context.playHistory || []),
    ...(context.rejectedTracks || []),
    ...(context.recentRecommendations || []),
  ].map((item) => trackKey(item?.song || item)).filter(Boolean))
}

function scoreOnlineCandidate(track, searchIntent, context) {
  const query = compactText(searchIntent.query)
  const title = compactText(track.title)
  const artist = compactText(track.artist)
  const requestedTitle = compactText(searchIntent.title)
  const requestedArtist = compactText(searchIntent.artist)
  const recentKeys = collectRecentTrackKeys(context)
  let score = 0

  if (requestedTitle && title === requestedTitle) score += 120
  else if (requestedTitle && title.includes(requestedTitle)) score += 78
  if (requestedArtist && artist === requestedArtist) score += 90
  else if (requestedArtist && artist.includes(requestedArtist)) score += 54
  if (query && title.includes(query)) score += 46
  if (query && artist.includes(query)) score += 24
  if (recentKeys.has(trackKey(track))) score -= 80
  if (/伴奏|翻唱|live|remix|dj版|demo|karaoke/i.test(`${track.title} ${track.album || ''}`) && !/伴奏|翻唱|live|remix|dj版|demo|karaoke/i.test(searchIntent.query || '')) score -= 18

  return score
}

export function rankOnlineCandidates(songs, searchIntent = {}, context = {}) {
  return [...(Array.isArray(songs) ? songs : [])]
    .map((track, index) => ({ track, index, score: scoreOnlineCandidate(track, searchIntent, context) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.track)
}

function musicReply(action, responseMode, title, fallback = '') {
  if (responseMode === 'silent') return '...'
  // A model hint may name a stale or loosely matched candidate. Once playback
  // has selected a concrete track, the user-facing confirmation must describe
  // that track, not the model's earlier guess.
  if (action === 'play' && title) return `嗯，给你放《${title}》。`
  if (fallback) return fallback
  if (action === 'next') return '好，给你换一首。'
  if (action === 'previous') return '好，回到上一首。'
  if (action === 'pause') return '好，先暂停。'
  if (action === 'resume') return '好，继续播放。'
  return title ? `嗯，给你放《${title}》。` : '好，我来安排。'
}

function smartSearchIntent(smartResult = {}, message = '') {
  const command = smartResult.command || {}
  const target = smartResult.target || {}
  const namedReference = extractNamedSongReference(message)
  const rawQuery = String(command.query || target.query || message || '').trim()
  const preference = `${rawQuery} ${message} ${command.languagePreference || ''} ${(command.moodTags || []).join(' ')}`
  const onlineQuery = /英文|英语|欧美|\ben\b/i.test(preference) && /燃|热血|高能|劲爆|嗨|激烈/i.test(preference)
    ? '英文 热门 热血'
    : rawQuery
  return {
    query: onlineQuery,
    title: String(target.title || '').trim(),
    artist: String(command.artist || target.artist || namedReference.artist || '').trim(),
    languagePreference: String(command.languagePreference || '').trim(),
  }
}

function extractNamedSongReference(message) {
  const text = String(message || '').trim()
  const match = text.match(/(?:播放|放|想听|要听|听|来首|来一首)\s*(?:给我|一下)?\s*([^，。！？,.!？]{2,30}?)的\s*([^，。！？,.!？]{2,50})/)
  if (!match) return { artist: '', title: '' }
  const artist = match[1].replace(/^(?:给我|帮我|请)/, '').trim()
  const title = match[2].replace(/(?:吧|呀|呢|谢谢)$/g, '').trim()
  if (!artist || !title || /^(?:我|我的|我喜欢的)$/.test(artist)) return { artist: '', title: '' }
  return { artist, title }
}

function extractExplicitSongTitle(message, searchIntent = {}) {
  const text = String(message || '').trim()
  const quoted = text.match(/[《“"]([^》”"]{2,80})[》”"]/)
  if (quoted?.[1]) return quoted[1].trim()

  // A foreign title in a Chinese command is often the most reliable part of
  // speech recognition. For example, “播放蔡健雅的 Letting Go” must not
  // become an arbitrary Cai Jianya song merely because the model extracts the
  // artist more confidently than the English title.
  const foreignTitle = [...text.matchAll(/[a-z][a-z0-9 '&().-]{1,80}/ig)]
    .map((match) => match[0].trim())
    .filter((value) => value.split(/\s+/).length >= 2 || value.length >= 5)
    .at(-1)
  if (foreignTitle) return foreignTitle

  const namedReference = extractNamedSongReference(text)
  if (namedReference.title) return namedReference.title

  const declared = text.match(/(?:歌名是|名字叫|叫做|叫|播放|放)(?:一首|首|这首|那首)?[，,:：\s]*([^，。！？,.!？]{2,50})/)
  if (declared?.[1]) {
    return declared[1]
      .replace(/^(?:给我|帮我|一下|一首|首|这首|那首)/, '')
      .replace(/(?:吧|呀|呢|谢谢)$/g, '')
      .trim()
  }

  const requested = String(searchIntent.title || searchIntent.query || '').trim()
  // Queries made entirely of Chinese characters are normally title requests;
  // keep them as an exact-match guard. Broad mood/search phrases are excluded.
  return /^[\p{Script=Han}]{2,12}$/u.test(requested) && !/(推荐|随机|伤感|开心|安静|英文|日文|韩文|歌曲|音乐|一首|来点)/.test(requested)
    ? requested
    : ''
}

function makeOnlineSearchQuery(searchIntent, requestedTitle) {
  if (!requestedTitle) return searchIntent.query
  const title = compactText(requestedTitle)
  const query = compactText(searchIntent.query)
  const artist = String(searchIntent.artist || '').trim()
  // Avoid losing an explicitly named title when the intent model only emits
  // the artist as its query. The title leads because NetEase search weighs the
  // first terms heavily.
  if (!query.includes(title)) return [requestedTitle, artist].filter(Boolean).join(' ')
  return searchIntent.query
}

function isVerifiedLocalTitleMatch(track, requestedTitle) {
  if (!track) return false
  const expected = compactText(requestedTitle)
  if (!expected) return true
  const title = compactText(track.title || track.name)
  return Boolean(title && title === expected)
}

function localCandidateFromSmartResult(smartResult, libraryTracks) {
  const first = Array.isArray(smartResult?.matches) ? smartResult.matches[0]?.song : null
  if (!first) return null
  return libraryTracks.find((track) => track.id === first.id) || first
}

export async function createPlaybackPlan({
  smartResult = {},
  message = '',
  libraryTracks = [],
  musicSource = 'local',
  responseMode = 'companion',
  context = {},
  inputMode = 'text',
  apiAdapter = null,
} = {}) {
  const commandType = smartResult?.command?.type || smartResult?.action?.type || 'none'
  const base = {
    version: PLAN_VERSION,
    source: 'none',
    reason: smartResult?.natural_reply_hint || smartResult?.naturalReplyHint || '',
    intent: smartResult?.intent || 'music_control',
  }

  if (['next', 'previous', 'pause', 'resume'].includes(commandType)) {
    return {
      ...base,
      action: commandType,
      reply: musicReply(commandType, responseMode),
      shouldSpeak: responseMode !== 'silent',
    }
  }

  if (commandType !== 'play_search' || smartResult?.should_execute === false || smartResult?.shouldPlay === false) {
    return { ...base, action: 'none', reply: smartResult?.reply || '' }
  }

  const searchIntent = smartSearchIntent(smartResult, message)
  const requestedTitle = extractExplicitSongTitle(message, searchIntent)
  const proposedLocalTrack = musicSource === 'netease'
    ? null
    : localCandidateFromSmartResult(smartResult, libraryTracks)
  // The model may produce a plausible local recommendation even when the user
  // named a specific song that is not in the library. A named track may only
  // use local playback after the actual title matches; otherwise it must fall
  // through to NetEase search rather than playing an unrelated library song.
  const localTrack = isVerifiedLocalTitleMatch(proposedLocalTrack, requestedTitle)
    ? proposedLocalTrack
    : null
  if (localTrack) {
    return {
      ...base,
      action: 'play',
      source: 'local',
      track: localTrack,
      candidates: [localTrack],
      reply: musicReply('play', responseMode, localTrack.title, smartResult?.reply),
      shouldSpeak: responseMode !== 'silent' && smartResult?.shouldSpeak !== false,
    }
  }

  if (!searchIntent.query) {
    return { ...base, action: 'none', reply: smartResult?.reply || '我还没听清想找哪一首。' }
  }

  // The selected library source only changes priority. If the local resolver has no
  // match, online search remains a graceful fallback instead of a dead end.
  const onlineQuery = makeOnlineSearchQuery(searchIntent, requestedTitle)
  const neteaseExecutor = new NeteaseCapabilityExecutor({
    apiAdapter: apiAdapter || new NeteaseApiAdapter({ searchSongs: searchNeteaseSongs }),
  })
  const searchResult = await neteaseExecutor.execute({
    capability: 'netease.search.song',
    action: 'search',
    args: { query: onlineQuery, limit: 12 },
  })
  if (!searchResult.ok) {
    const error = new Error(searchResult.error || 'netease_search_failed')
    error.code = searchResult.errorCode || 'provider_error'
    error.details = searchResult.errorDetails || null
    throw error
  }
  const neteaseResults = searchResult.value
  const rankedCandidates = rankOnlineCandidates(
    neteaseResults,
    { ...searchIntent, query: onlineQuery, title: requestedTitle || searchIntent.title },
    context,
  )
  const selection = await selectNeteaseSongCandidate({
    candidates: rankedCandidates,
    requestedTitle,
    requestedArtist: searchIntent.artist,
    transcript: message,
    interpretation: `${searchIntent.query}${searchIntent.artist ? ` — ${searchIntent.artist}` : ''}`,
    inputMode,
    resolveVoiceCandidate: inputMode === 'voice' ? resolveNeteaseSongCandidate : null,
  })
  if (selection.status === 'not_found') {
    return {
      ...base,
      action: 'none',
      source: 'netease',
      reply: responseMode === 'silent'
        ? '...'
        : requestedTitle
          ? `我没能可靠确认《${requestedTitle}》的可播放版本，所以先不拿别的歌替代。`
          : `我没找到能播放的《${searchIntent.query}》。`,
    }
  }
  if (selection.status === 'clarify') {
    const choices = selection.candidates
      .map((candidate) => `《${candidate.title}》${candidate.artist ? `（${candidate.artist}）` : ''}`)
      .join('，还是 ')
    return {
      ...base,
      action: 'none',
      source: 'netease',
      needsClarification: true,
      candidates: selection.candidates,
      reply: responseMode === 'silent' ? '...' : `我找到了几个可能的结果。你想听的是${choices}？`,
    }
  }
  const track = selection.track
  if (!track) {
    return {
      ...base,
      action: 'none',
      source: musicSource === 'netease' ? 'netease' : 'local',
      reply: responseMode === 'silent' ? '...' : `我没找到能播放的《${searchIntent.query}》。`,
    }
  }

  return {
    ...base,
    action: 'play',
    source: 'netease',
    track,
    candidates: rankedCandidates.slice(0, 5),
    query: searchIntent.query,
    reply: musicReply('play', responseMode, track.title, smartResult?.reply),
    shouldSpeak: responseMode !== 'silent' && smartResult?.shouldSpeak !== false,
  }
}

export async function executePlaybackPlan(plan, player) {
  if (!plan || plan.action === 'none') return { ok: false, ignored: true }
  const executor = new NeteaseCapabilityExecutor({ playerAdapter: new YunPlayerAdapter(player) })
  if (plan.action === 'next' || plan.action === 'previous' || plan.action === 'pause') {
    return executor.execute({ capability: 'yun.player.transport', action: plan.action, args: {} })
  }
  if (plan.action === 'resume') {
    const currentTrack = player.getState().currentTrack
    return currentTrack
      ? executor.execute({ capability: 'yun.player.queue', action: 'play_track', args: { track: currentTrack } })
      : executor.execute({ capability: 'yun.player.transport', action: 'toggle', args: {} })
  }
  if (plan.action === 'play' && plan.track) {
    const currentTrack = player.getState().currentTrack
    if (plan.source === 'netease') {
      const queue = Array.isArray(plan.candidates) && plan.candidates.length
        ? plan.candidates
        : [plan.track]
      return executor.execute({
        capability: 'yun.player.queue',
        action: 'play_from_queue',
        args: { track: plan.track, queue, options: { crossfade: Boolean(currentTrack) } },
      })
    }
    await executor.execute({ capability: 'yun.player.queue', action: 'clear', args: {} })
    return executor.execute({
      capability: 'yun.player.queue',
      action: 'play_track',
      args: { track: plan.track, options: { crossfade: Boolean(currentTrack) } },
    })
  }
  return { ok: false, error: 'unsupported_radio_plan' }
}

export function createCompanionPlaybackPlan({ response, userText, libraryTracks, responseMode = 'companion' }) {
  const decision = response?.decision || {}
  const action = decision.musicAction
  const suggestions = Array.isArray(response?.recommendations) ? response.recommendations : []
  const suggestion = suggestions[0]?.song || suggestions[0] || null
  const track = suggestion?.id
    ? libraryTracks.find((item) => item.id === suggestion.id) || suggestion
    : null

  if (action === 'next_song') {
    if (!track) {
      return { version: PLAN_VERSION, action: 'next', source: 'local', reply: response?.reply || musicReply('next', responseMode) }
    }
    return {
      version: PLAN_VERSION,
      action: 'play',
      source: track.source || 'local',
      track,
      candidates: [track],
      reply: response?.reply || musicReply('play', responseMode, track.title),
    }
  }
  if (action === 'suggest_song' && track && /来首|来一首|来点|放一首|给我放|帮我放|想听|要听|推荐一首|随机来|随便来|你来选|帮我选/.test(userText || '')) {
    return {
      version: PLAN_VERSION,
      action: 'play',
      source: track.source || 'local',
      track,
      candidates: [track],
      reply: response?.reply || musicReply('play', responseMode, track.title),
    }
  }
  return { version: PLAN_VERSION, action: 'none' }
}
