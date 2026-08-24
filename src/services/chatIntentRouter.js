import { requestSmartMusicCommand } from '../api/smartMusicApi.js'
import {
  fetchNeteaseArtistSongs,
  fetchNeteaseMe,
  fetchNeteasePlaylistTracks,
} from '../api/neteaseApi.js'
import { resolveMusicStructureSeek } from '../api/musicIntelligenceApi.js'
import { createPlaybackPlan, executePlaybackPlan } from './radioEngine.js'
import { NeteaseApiAdapter } from './netease/apiAdapter.js'
import { NeteaseCapabilityExecutor, formatCapabilityExecutionReply } from './netease/capabilityExecutor.js'
import { planNeteaseCapability } from './netease/capabilityPlanner.js'
import { NeteaseDesktopAdapter } from './netease/desktopAdapter.js'
import { getCapability } from './netease/capabilityRegistry.js'
import { YunPlayerAdapter } from './netease/playerAdapter.js'

function compactText(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s，。！？、,.!?~…《》"'“”‘’()[\]{}【】（）\-_/\\|]/g, '')
}

function getCurrentTrack(player) {
  return player.getState().currentTrack
}

function createCapabilityExecutor(player) {
  return new NeteaseCapabilityExecutor({
    apiAdapter: new NeteaseApiAdapter(),
    playerAdapter: new YunPlayerAdapter(player),
    desktopAdapter: new NeteaseDesktopAdapter(),
  })
}

const capabilityErrorCodes = new Set([
  'unsupported',
  'unauthorized',
  'not_logged_in',
  'vip_required',
  'not_found',
  'network_error',
  'provider_error',
  'empty_result',
  'ambiguous',
])

function capabilityFailureFromError(error, capability, action) {
  const code = capabilityErrorCodes.has(error?.code) ? error.code : 'provider_error'
  return {
    ok: false,
    error: error instanceof Error ? error.message : 'capability_execution_failed',
    errorCode: code,
    errorDetails: error?.details || null,
    capability,
    action,
    transport: 'api',
  }
}

function requireCapabilityValue(result) {
  if (!result?.ok) {
    const error = new Error(result?.error || 'capability_execution_failed')
    error.code = capabilityErrorCodes.has(result?.errorCode) ? result.errorCode : 'provider_error'
    error.details = result?.errorDetails || null
    throw error
  }
  return result.value
}

function neteaseOperationFailureReply(error, responseMode, operation = '读取网易云内容') {
  if (responseMode === 'silent') return '...'
  const code = String(error?.code || '')
  const message = String(error instanceof Error ? error.message : error || '')
  if (code === 'network_error' || /failed to fetch|networkerror|fetch failed|网络.*(?:断开|异常|不可用)|连接.*(?:失败|不上|不可用)/i.test(message)) {
    return `网易云连接暂时不可用，${operation}没有完成。你可以检查网络后重试，或者让我改为播放本地音乐。`
  }
  if (code === 'not_logged_in' || code === 'unauthorized' || /登录|401|unauthor/i.test(message)) {
    return '网易云登录已失效，请重新登录后再试。'
  }
  if (code === 'vip_required') return `当前账号没有拿到${operation}所需的资源权限。`
  return `网易云暂时无法${operation}。请稍后重试。`
}

function collectTextValues(value, output = []) {
  if (!value) return output
  if (typeof value === 'string') {
    output.push(value)
    return output
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectTextValues(item, output))
    return output
  }
  if (typeof value === 'object') {
    Object.values(value).forEach((item) => collectTextValues(item, output))
  }
  return output
}

function extractQuotedTitles(text) {
  return [...String(text || '').matchAll(/《([^》]+)》/g)]
    .map((match) => match[1])
    .filter(Boolean)
}

function findLocalTrackByTitle(title, libraryTracks, artist = '') {
  const compactTitle = compactText(title)
  const compactArtist = compactText(artist)

  if (!compactTitle) return null

  return libraryTracks.find((song) => {
    const songTitle = compactText(song.title)
    const songArtist = compactText(song.artist)
    const songFile = compactText(song.filename || '')

    return (
      songTitle === compactTitle ||
      songTitle.includes(compactTitle) ||
      compactTitle.includes(songTitle) ||
      songFile.includes(compactTitle)
    ) && (!compactArtist || songArtist.includes(compactArtist) || compactArtist.includes(songArtist))
  }) || null
}

function findLocalTrackFromText(text, libraryTracks) {
  for (const title of extractQuotedTitles(text)) {
    const track = findLocalTrackByTitle(title, libraryTracks)
    if (track) return track
  }

  const compactMessage = compactText(text)
  if (compactMessage.length < 2) return null

  return libraryTracks.find((song) => {
    const title = compactText(song.title)
    return title && title.length >= 2 && compactMessage.includes(title)
  }) || null
}

function extractOnlineMusicQuery(message) {
  const raw = String(message || '').trim()
  const quoted = [...raw.matchAll(/[《「『"“']([^》」』"”']{1,60})[》」』"”']/g)]
    .map((match) => match[1]?.trim())
    .find(Boolean)

  if (quoted) return quoted
  if (!/(网易云|在线|网上|搜索|搜一下|找一下|找首|找歌|点歌|播放|放一首|来首|来一首|想听|我要听)/.test(raw)) {
    return ''
  }

  return raw
    .replace(/昀/g, '')
    .replace(/帮我|给我|可以|能不能|能帮我|一下|一首|这首|歌曲|音乐/g, '')
    .replace(/网易云|在线|网上|搜索|搜|找|点歌|播放|放|来|想听|我要听|听/g, '')
    .replace(/[，。！？、,.!?~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

async function playNeteaseFromMessage(message, player, responseMode, context = {}) {
  const query = extractOnlineMusicQuery(message)
  if (!query) return { handled: false }

  // This is the fallback after the Smart Music request is unavailable. It must
  // use the same exact-title safety boundary as the normal route; otherwise a
  // named song could be replaced by a more popular track from the same artist.
  let plan
  try {
    plan = await createPlaybackPlan({
      smartResult: { should_execute: true, command: { type: 'play_search', query } },
      message,
      player,
      responseMode,
      musicSource: 'netease',
      context,
      inputMode: context.inputMode || 'text',
    })
  } catch (error) {
    return {
      handled: true,
      capabilityPlan: planNeteaseCapability({ message, inputMode: context.inputMode || 'text', currentTrack: context.currentSong }),
      capabilityResult: capabilityFailureFromError(error, 'netease.search.song', 'search'),
      reply: neteaseOperationFailureReply(error, responseMode, '搜索这首歌'),
      skipTts: responseMode === 'silent',
    }
  }
  if (plan.action === 'none') {
    return {
      handled: true,
      reply: plan.reply || (responseMode === 'silent' ? '...' : `我去网易云找了，但暂时没找到能播放的「${query}」。`),
      skipTts: responseMode === 'silent',
    }
  }

  const result = await executePlaybackPlan(plan, player)

  return {
    handled: true,
    reply: responseMode === 'silent'
      ? '...'
      : result?.ok
        ? plan.reply
        : `找到了「${plan.track?.title || query}」，但这首现在播不起来。`,
    song: result?.ok ? plan.track : null,
    songReactionTrigger: 'user_play',
    skipTts: responseMode === 'silent',
  }
}

async function executePlatformCapabilityIntent({
  message,
  inputMode,
  player,
  responseMode,
  currentSong,
  playHistory = [],
  rejectedTracks = [],
  recentRecommendations = [],
}) {
  const plan = planNeteaseCapability({ message, inputMode, currentTrack: currentSong })
  if (!plan?.capability) return { handled: false, capabilityPlan: plan }
  const definition = getCapability(plan.capability)
  const directApiCapabilities = new Set([
    'netease.recommend.daily',
    'netease.recommend.personal_fm',
    'netease.recommend.similar',
    'netease.recommend.playlist',
    'netease.library.recent',
    'netease.library.user_record',
    'netease.library.podcasts',
    'netease.library.cloud',
    'netease.search.suggest',
    'netease.song.detail',
    'netease.song.playability',
    'yun.player.stream_quality',
  ])
  const directlyHandled = directApiCapabilities.has(plan.capability)
    || ['audio', 'client', 'client_settings'].includes(definition?.domain)
  if (!definition || !directlyHandled) {
    return { handled: false, capabilityPlan: plan }
  }

  const executor = createCapabilityExecutor(player)
  const result = await executor.execute(plan)
  const subject = definition.name
  if (!result.ok) {
    const errorReplies = {
      not_logged_in: '请先登录网易云，我才能读取你的个人内容。',
      unauthorized: '网易云没有授权这次读取，请重新登录后再试。',
      vip_required: '网易云没有为当前账号返回这个资源权限，我没有假装它可以播放。',
      not_found: result.error || `${subject}没有找到可用内容。`,
      network_error: '网易云连接暂时不可用，这次没有切换到桌面控制。',
      empty_result: `${subject}这次没有返回内容，我没有假装操作已经完成。`,
      unsupported: `${subject}目前没有可验证的控制通道。`,
      ambiguous: '找到了多个可能目标，请再说具体一点。',
      provider_error: `网易云暂时无法完成${subject}。`,
    }
    const personalFmErrorReplies = {
      network_error: '网易云连接确实失败了，私人 FM 这次没有开始播放。',
      not_logged_in: '请先登录网易云，我才能读取你的私人 FM。',
      unauthorized: '网易云没有授权这次私人 FM 读取，请重新登录后再试。',
      vip_required: '当前账号没有拿到私人 FM 所需的资源权限，我没有假装它已经播放。',
      provider_error: '网易云这次没把私人 FM 列表返回给我，我没有切换到桌面控制。',
      empty_result: '网易云这次返回了空的私人 FM 列表，我没有切歌。',
      unsupported: '私人 FM 目前没有可验证的控制通道。',
    }
    const replyByCode = plan.capability === 'netease.recommend.personal_fm'
      ? personalFmErrorReplies
      : errorReplies
    return {
      handled: true,
      capabilityPlan: plan,
      capabilityResult: result,
      reply: responseMode === 'silent' ? '...' : (replyByCode[result.errorCode] || `网易云暂时无法完成${subject}。`),
      skipTts: responseMode === 'silent',
    }
  }

  const value = result.value
  const apiSongs = Array.isArray(value) ? value : Array.isArray(value?.songs) ? value.songs : []
  const recommendationIdsToExclude = new Set([
    currentSong,
    ...playHistory.slice(-10),
    ...rejectedTracks.slice(-10),
    ...recentRecommendations.slice(-10).map((item) => item?.song || item),
  ].map((song) => String(song?.providerId || song?.id || '').replace(/^netease-/, '')).filter(Boolean))
  const songs = ['netease.recommend.daily', 'netease.recommend.personal_fm'].includes(plan.capability)
    ? apiSongs.filter((song) => !recommendationIdsToExclude.has(String(song?.providerId || song?.id || '').replace(/^netease-/, '')))
    : apiSongs
  const resolvedTrack = plan.capability === 'yun.player.stream_quality'
    || (['netease.library.podcasts', 'netease.library.cloud'].includes(plan.capability) && plan.action === 'play')
    ? value
    : songs[0]
  const shouldPlay = plan.action === 'play' || plan.capability === 'yun.player.stream_quality'
  let playbackResult = null
  if (shouldPlay) {
    if (!resolvedTrack?.providerId) {
      return {
        handled: true,
        capabilityPlan: plan,
        capabilityResult: result,
        reply: responseMode === 'silent' ? '...' : `${subject}没有返回可播放歌曲。`,
        skipTts: responseMode === 'silent',
      }
    }
    if (plan.capability === 'netease.recommend.similar') {
      await executor.execute({ capability: 'yun.player.settings', action: 'set_mode', args: { mode: 'ai_recommend' } })
    }
    playbackResult = await executor.execute({
      capability: 'yun.player.queue',
      action: songs.length > 1 ? 'play_from_queue' : 'play_track',
      args: songs.length > 1 ? { track: resolvedTrack, queue: songs } : { track: resolvedTrack },
    })
    if (!playbackResult.ok) {
      return {
        handled: true,
        capabilityPlan: plan,
        capabilityResult: result,
        playbackResult,
        reply: responseMode === 'silent' ? '...' : `网易云已经返回${subject}，但 PlayerCore 这次没有开始播放。`,
        skipTts: responseMode === 'silent',
      }
    }
    if (plan.capability === 'netease.recommend.similar') {
      await executor.execute({ capability: 'yun.player.queue', action: 'set_auto_up_next', args: { tracks: songs.slice(1, 4), options: { replace: true } } })
      await executor.execute({ capability: 'yun.player.queue', action: 'set_queued_next', args: { track: null } })
    }
  }

  const songNames = songs.slice(0, 5).map((song) => `《${song.title}》`).join('、')
  const listNames = (items) => (Array.isArray(items) ? items : []).slice(0, 5).map((item) => `《${item.name || item.title || ''}》`).filter((name) => name !== '《》').join('、')
  const successReplies = {
    'netease.recommend.daily': shouldPlay ? `按网易云每日推荐播放${resolvedTrack ? `《${resolvedTrack.title}》` : ''}。` : `网易云今天推荐了：${songNames || '暂时没有歌曲'}。`,
    'netease.recommend.personal_fm': shouldPlay ? `开始播放你的网易云私人 FM：${resolvedTrack ? `《${resolvedTrack.title}》` : ''}。` : `私人 FM 返回了：${songNames || '暂时没有歌曲'}。`,
    'netease.recommend.similar': shouldPlay ? `找到了和当前歌曲相似的歌，先接上《${resolvedTrack?.title || ''}》。` : `和当前歌曲相似的有：${songNames || '暂时没有歌曲'}。`,
    'netease.recommend.playlist': `网易云推荐歌单：${listNames(value) || '暂时没有歌单'}。`,
    'netease.library.recent': `你的网易云最近播放：${songNames || '暂时没有记录'}。`,
    'netease.library.user_record': plan.args?.type === 'all'
      ? `你历史上最常听：${songNames || '暂时没有排行记录'}。`
      : `你最近常听：${songNames || '暂时没有排行记录'}。`,
    'netease.library.podcasts': plan.action === 'play' ? `开始播放播客节目《${resolvedTrack?.title || ''}》。` : `你的网易云订阅播客：${listNames(value?.podcasts) || '暂时没有订阅播客'}。`,
    'netease.library.cloud': plan.action === 'play' ? `开始播放云盘歌曲《${resolvedTrack?.title || ''}》。` : `你的网易云云盘有 ${Number(value?.total || value?.items?.length || 0)} 首，最近的包括：${songNames || '暂无可播放歌曲'}。`,
    'netease.search.suggest': `网易云搜索建议：${songNames || listNames(value?.artists) || '没有返回建议'}。`,
    'netease.song.detail': songs[0] ? `这首是《${songs[0].title}》，歌手 ${songs[0].artist}${songs[0].album ? `，收录于《${songs[0].album}》` : ''}。` : '网易云没有返回这首歌的详情。',
    'netease.song.playability': value?.playable ? '网易云确认这首当前可以播放。' : `这首当前不可播放${value?.message ? `：${value.message}` : '。'}`,
    'yun.player.stream_quality': `已通过网易云 ${value?.streamLevel || plan.args.level} 取流，并交给 PlayerCore 播放。`,
  }
  return {
    handled: true,
    capabilityPlan: plan,
    capabilityResult: result,
    playbackResult,
    reply: responseMode === 'silent'
      ? '...'
      : successReplies[plan.capability] || formatCapabilityExecutionReply(result, {
        success: `${subject}已经按你的要求完成。`,
        failure: `${subject}这次没有设置成功，我没有改动现有状态。`,
        unsupported: `${subject}目前还没有可验证的控制通道，所以我没有假装已经设置成功。`,
        confirmation: `${subject}需要你再次明确确认后才能执行。`,
      }),
    song: playbackResult?.ok ? resolvedTrack : null,
    songReactionTrigger: playbackResult?.ok ? 'user_play' : null,
    skipTts: responseMode === 'silent',
  }
}

function extractLyricLookup(message) {
  const raw = String(message || '').trim()
  // Accept natural requests such as “我记得有首歌里唱了……，帮我找
  // 一下”， rather than requiring the user to say a fixed phrase like
  // “这首副歌有”.  A search intent is still mandatory, so ordinary lyric
  // discussion does not unexpectedly start a song search.
  const hasLookupIntent = /(?:帮我|给我|能不能)?(?:找|搜|识别|查)(?:一下)?(?:这首|这句|这段)?(?:歌|歌曲)?|(?:这句|这段).{0,8}(?:什么歌|哪首歌)|(?:什么|哪|哪个).{0,4}(?:歌|首)|(?:我记得|听到).{0,16}(?:有|叫|唱).{5,}/.test(raw)
  if (!hasLookupIntent) return ''
  const quoted = raw.match(/[《“"]([^》”"]{5,160})[》”"]/)
  if (quoted?.[1]) return quoted[1].trim()

  const afterMarker = raw.match(/(?:有(?:这样(?:的)?)?(?:歌词|一句|一段)|歌词(?:是|叫|里有)?|唱的是|这句(?:是|唱)?|我记得(?:有)?(?:首歌)?(?:里)?|听到(?:一句|一段)?)\s*[:：，,]?\s*(.{5,200})$/)
  const candidate = String(afterMarker?.[1] || raw)
    .replace(/^(?:那首(?:就是|是)?|我记得(?:有)?(?:一首)?(?:歌)?(?:里)?|有(?:一首)?(?:歌)?(?:里)?|歌词(?:是|叫|里有)?|唱的是)\s*/g, '')
    .replace(/(?:，|,|。|\.|然后|麻烦你|你能(?:不能)?|帮我|给我).{0,24}?(?:找|搜|识别|查)(?:一下)?(?:这首|这句|这段)?(?:歌|歌曲)?[。！？!？]?$/g, '')
    .replace(/(?:这是什么歌|是哪首歌|帮我找(?:一下)?|帮我播放|播放这首|放这首)$/g, '')
    .trim()
  // The server extracts the lyric from this natural-language candidate and
  // rejects weak evidence. Require a small meaningful fragment before paying
  // for that network round trip.
  return compactText(candidate).length >= 5 ? candidate : ''
}

async function playNeteaseFromLyrics(message, player, responseMode) {
  const lyrics = extractLyricLookup(message)
  if (!lyrics) return { handled: false }
  return playNeteaseFromLyricFragment(lyrics, player, responseMode)
}

async function playNeteaseFromLyricFragment(lyrics, player, responseMode) {
  let capabilityResult = null
  try {
    const executor = createCapabilityExecutor(player)
    capabilityResult = await executor.execute({
      capability: 'netease.search.lyrics',
      action: 'resolve',
      args: { query: lyrics },
    })
    const resolved = requireCapabilityValue(capabilityResult)
    if (!resolved.verified || !resolved.song) {
      return {
        handled: true,
        reply: '这句我还没敢随便认。你再给我半句歌词，或者说一下歌手/语言，我陪你把它找出来。',
        skipTts: responseMode === 'silent',
      }
    }
    const result = await executor.execute({
      capability: 'yun.player.queue',
      action: 'play_from_queue',
      args: {
        track: resolved.song,
        queue: [resolved.song],
        options: { crossfade: Boolean(getCurrentTrack(player)) },
      },
    })
    return {
      handled: true,
      capabilityResult,
      playbackResult: result,
      reply: result?.ok
        ? `嗯，这句我认出来了——《${resolved.song.title}》${resolved.song.artist ? `，${resolved.song.artist}唱的` : ''}。我给你接上。`
        : `我确认是《${resolved.song.title}》，但现在没能把它顺利放出来。`,
      song: result?.ok ? resolved.song : null,
      songReactionTrigger: result?.ok ? 'user_play' : null,
      skipTts: responseMode === 'silent',
    }
  } catch (error) {
    return {
      handled: true,
      capabilityResult: capabilityResult?.ok === false
        ? capabilityResult
        : capabilityFailureFromError(error, 'netease.search.lyrics', 'resolve'),
      reply: neteaseOperationFailureReply(error, responseMode, '完成歌词识曲'),
      skipTts: responseMode === 'silent',
    }
  }
}

function getNeteaseCollectionRequest(message) {
  const raw = String(message || '').trim()
  // “放到/放进” means moving the current track into a collection when a
  // playlist target follows; it is not a request to start playing that list.
  if (!raw || !/(添加|加入|存到|收藏|收进|放到|放进|移到|移进)/.test(raw)) return null
  if (!/(网易云|歌单|播放列表|喜欢|红心|收藏)/.test(raw)) return null

  const likesTarget = /(喜欢的音乐|喜欢队列|我的喜欢|红心|收藏(?:夹|歌曲|音乐)?)/.test(raw)
  if (likesTarget) return { target: 'liked' }

  const quotedPlaylist = raw.match(/(?:歌单|播放列表)\s*(?:叫|名为|《|“|")\s*[《“"]?([^》”，。！？\s]{1,30})/)
  const directPlaylist = raw.match(/(?:添加到|添加进|添加|加入到|加入|加到|加进|存到|收进|放到|放进|移到|移进)\s*(?:我(?:的)?网易云(?:音乐)?(?:的)?\s*)?(?:歌单|播放列表)\s*[《“"]?([^》”，。！？\s]{1,30})/)
  const playlistName = (quotedPlaylist?.[1] || directPlaylist?.[1] || '')
    .replace(/^(?:里|中|里面|中去)$/, '')
    .trim()
  return { target: 'playlist', playlistName }
}

function isGeneratedPlaylistRequest(message) {
  const raw = String(message || '').trim()
  if (!/(歌单|播放列表)/.test(raw)) return false
  if (/(?:创建|创造|生成|做(?:一(?:个|份))?|制作|打造|安排|规划|组(?:一(?:个|份))?)/.test(raw)) return true
  if (/(?:给我|帮我)?来(?:一(?:个|份))?.{0,20}(?:歌单|播放列表)/.test(raw) && !/(?:网易云|我的|喜欢|收藏)/.test(raw)) return true
  return /(?:运动|跑步|健身|通勤|雨天|睡前|助眠|放松).{0,18}(?:歌单|播放列表)/.test(raw) && !/(?:网易云|我的|喜欢|收藏)/.test(raw)
}

function isSceneRecommendationRequest(message) {
  const raw = String(message || '').trim()
  if (/(不要|不用|别)/.test(raw)) return false
  return /(?:推荐|来(?:点|些)?|安排).*(?:歌|歌曲|音乐)/.test(raw)
    && /(?:运动|跑步|健身|通勤|上班|下班|雨天|睡前|助眠|放松|舒缓|解压)/.test(raw)
}

function isCompoundInstruction(message) {
  const raw = String(message || '').trim()
  if (!raw) return false
  // Do not mistake polite fillers such as “再来一首” for a second task.
  return /(?:然后|并且|同时|顺便|接着|之后|再(?:帮我|给我|为我|做|创建|生成|推荐|安排|分析|收藏|加入|添加|播放|放))/.test(raw)
}

async function addCurrentSongToNeteaseCollection(message, currentSong, responseMode) {
  const request = getNeteaseCollectionRequest(message)
  if (!request) return { handled: false }
  if (!currentSong) {
    return {
      handled: true,
      reply: '现在没有正在播放的歌。先放一首歌，再告诉我把这首歌加到网易云。',
      skipTts: responseMode === 'silent',
    }
  }
  if (request.target === 'playlist' && !request.playlistName) {
    return {
      handled: true,
      reply: '要加到哪一个网易云歌单？直接说歌单的完整名字就好。',
      skipTts: responseMode === 'silent',
    }
  }
  try {
    const executor = createCapabilityExecutor(null)
    const capability = request.target === 'liked' ? 'netease.library.liked' : 'netease.library.collection'
    const result = requireCapabilityValue(await executor.execute({
      capability,
      action: 'add',
      args: { song: currentSong, ...request },
    }))
    const songTitle = result.song?.title || currentSong.title || currentSong.name || '这首歌'
    const destination = result.playlist?.liked ? '网易云“我喜欢的音乐”' : `网易云歌单“${result.playlist?.name || request.playlistName}”`
    return {
      handled: true,
      reply: result.alreadyExists
        ? `《${songTitle}》已经在${destination}里了。`
        : `好了，已经把《${songTitle}》加入${destination}。`,
      skipTts: responseMode === 'silent',
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : '添加到网易云失败'
    return {
      handled: true,
      reply: /登录网易云/.test(messageText)
        ? '网易云还没有登录，登录后我就能帮你收藏和加歌单。'
        : messageText,
      skipTts: responseMode === 'silent',
    }
  }
}

const PLAYBACK_SETTING_OPTIONS = [
  { id: 'companion_continue', label: '陪伴续播', pattern: /陪伴续播|陪伴模式续播/ },
  { id: 'ai_recommend', label: 'AI推荐播放', pattern: /(?:ai|AI)推荐(?:播放|模式)?|智能推荐(?:播放|模式)?/ },
  { id: 'loop_one', label: '单曲循环', pattern: /单曲循环|循环这首|重复这首/ },
  { id: 'shuffle', label: '随机播放', pattern: /随机播放|随机模式|打乱播放/ },
  { id: 'sequence', label: '顺序播放', pattern: /顺序播放|列表循环|顺序模式/ },
]

const RESPONSE_SETTING_OPTIONS = [
  { id: 'podcast', label: '播客', pattern: /播客(?:模式|状态)?/ },
  { id: 'companion', label: '陪伴', pattern: /陪伴(?:模式|状态)?/ },
  { id: 'silent', label: '专注', pattern: /专注(?:模式|状态)?|静音(?:模式|状态)?|安静模式/ },
  { id: 'normal', label: '普通', pattern: /普通(?:模式|状态)?|正常(?:模式|状态)?/ },
]

function hasSettingsVerb(text) {
  return /(开启|打开|启用|切换|改成|设为|设置成|使用|进入|变成|关闭|退出)/.test(text)
}

function detectPlayerSettingIntent(message) {
  const text = String(message || '').trim()
  if (!text || !hasSettingsVerb(text)) return null

  const playback = PLAYBACK_SETTING_OPTIONS.find((option) => option.pattern.test(text))
  if (playback) return { kind: 'playback', option: playback }

  if (/关闭.*(?:播放模式|循环|续播|推荐)/.test(text)) {
    return { kind: 'playback', option: PLAYBACK_SETTING_OPTIONS.find((option) => option.id === 'sequence') }
  }

  const response = RESPONSE_SETTING_OPTIONS.find((option) => option.pattern.test(text))
  if (response && /(?:关闭|退出).*(?:播客|陪伴|专注|静音|普通|正常)|(?:播客|陪伴|专注|静音).*(?:关闭|退出)/.test(text)) {
    return { kind: 'response', option: RESPONSE_SETTING_OPTIONS.find((option) => option.id === 'normal') }
  }
  if (response) return { kind: 'response', option: response }
  return null
}

function executePlayerSettingIntent(message, player, setResponseMode, responseMode) {
  const intent = detectPlayerSettingIntent(message)
  if (!intent) return { handled: false }
  if (intent.kind === 'playback') {
    if (!player?.setPlaybackMode) return { handled: false }
    player.setPlaybackMode(intent.option.id)
    return {
      handled: true,
      reply: `好，已经切换为${intent.option.label}。`,
      skipTts: responseMode === 'silent',
    }
  }
  if (!setResponseMode) return { handled: false }
  setResponseMode(intent.option.id)
  return {
    handled: true,
    reply: intent.option.id === 'silent' ? '好，已进入专注模式，我会保持安静。' : `好，已经切换为${intent.option.label}状态。`,
    skipTts: intent.option.id === 'silent' || responseMode === 'silent',
  }
}

function playlistChoiceIndex(message) {
  const text = String(message || '').replace(/\s/g, '')
  if (/^(?:取消|算了|不要了)[。！？!]?$/i.test(text)) return -1
  const match = text.match(/^(?:选|播放)?(?:第)?([1-5一二三四五])[个首]?/i)
  if (!match) return null
  const numbers = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5 }
  return Number(match[1]) || numbers[match[1]] || null
}

async function playMyNeteasePlaylist(message, player, responseMode, { forceLiked = false, pendingSelection = null } = {}) {
  const raw = String(message || '').trim()
  const choiceIndex = pendingSelection ? playlistChoiceIndex(raw) : null
  if (choiceIndex === -1) {
    return { handled: true, reply: '好，已取消这次歌单选择。', skipTts: responseMode === 'silent', playlistSelectionResolved: true }
  }
  // Keep collection mutations and playback mutually exclusive even when a
  // future phrase adds another transfer verb.
  if (!forceLiked && getNeteaseCollectionRequest(raw)) return { handled: false }
  const compact = compactText(raw)
  const asksLiked = forceLiked || /我喜欢的(?:音乐|歌|歌曲)?|我的喜欢|喜欢的音乐|收藏的(?:音乐|歌|歌曲)?|红心(?:歌|歌曲|音乐)?/.test(raw)
  const asksPlaylist = asksLiked || /网易云|云音乐|歌单/.test(raw)
  const asksPlay = forceLiked || /播放|放|听|来一首|来点|开始|继续/.test(raw)
  if (!asksPlaylist || !asksPlay) {
    if (!pendingSelection || !Number.isInteger(choiceIndex) || choiceIndex < 1) return { handled: false }
  }

  try {
    const account = await fetchNeteaseMe()
    if (!account?.loggedIn) {
      return { handled: true, reply: '请先登录网易云，我才能播放你的喜欢音乐和歌单。', skipTts: responseMode === 'silent' }
    }
    const playlists = Array.isArray(account.playlists) ? account.playlists : []
    const matching = asksLiked
      ? playlists.filter((playlist) => playlist.liked)
      : playlists.filter((playlist) => {
        const name = compactText(playlist.name)
        return name.length >= 2 && compact.includes(name)
      })
    const candidates = pendingSelection && Number.isInteger(choiceIndex) && choiceIndex >= 1
      ? pendingSelection.candidates || []
      : matching
    if (!asksLiked && !pendingSelection && matching.length > 1) {
      const options = matching.slice(0, 5).map((playlist, index) => `第${index + 1}个《${playlist.name}》`).join('、')
      return {
        handled: true,
        reply: `我找到了 ${matching.length} 个同名歌单：${options}。你想播放哪一个？`,
        skipTts: responseMode === 'silent',
        playlistSelection: { candidates: matching.slice(0, 5).map((playlist) => ({ id: playlist.id, name: playlist.name })) },
      }
    }
    const selected = pendingSelection && Number.isInteger(choiceIndex) && choiceIndex >= 1
      ? playlists.find((playlist) => playlist.id === candidates[choiceIndex - 1]?.id)
      : matching[0]
    if (!selected) {
      return { handled: true, reply: pendingSelection ? '这个歌单选择已经失效了，请重新说一次歌单名。' : (asksLiked ? '我没有找到你的“我喜欢的音乐”歌单。' : '我没有在你的网易云歌单里找到这个名字。请直接说完整歌单名。'), skipTts: responseMode === 'silent', playlistSelectionResolved: Boolean(pendingSelection) }
    }
    const tracks = await fetchNeteasePlaylistTracks(selected.id)
    if (!tracks.length) {
      return { handled: true, reply: `《${selected.name}》里暂时没有可播放歌曲。`, skipTts: responseMode === 'silent' }
    }
    // A personal playlist is a fixed queue, not an AI radio session. Keep the
    // visible playback mode aligned with the spoken “按顺序播放” confirmation.
    player.setPlaybackMode('sequence')
    const result = await player.playTrackFromQueue(tracks[0], tracks)
    return {
      handled: true,
      reply: result?.ok ? `正在按顺序播放你的网易云歌单《${selected.liked ? '我喜欢的音乐' : selected.name}》。` : `找到了《${selected.name}》，但第一首暂时播放失败。`,
      song: result?.ok ? tracks[0] : null,
      skipTts: responseMode === 'silent',
      playlistSelectionResolved: Boolean(pendingSelection),
    }
  } catch (error) {
    return {
      handled: true,
      reply: neteaseOperationFailureReply(error, responseMode, '读取你的歌单'),
      skipTts: responseMode === 'silent',
      playlistSelectionResolved: Boolean(pendingSelection),
    }
  }
}

function extractArtistCatalogRequest(message) {
  const raw = String(message || '').trim()
  if (!/(所有|全部|全套|全部的|所有的)/.test(raw) || !/(歌|歌曲|作品|曲子)/.test(raw)) return ''
  if (!/(播放|放|想听|要听|听|来点|来一遍|找)/.test(raw)) return ''
  return raw
    .replace(/^(?:小昀|小云|晓云|小韵|小芸|小允)[，,、\s]*/i, '')
    .replace(/请|帮我|给我|可以|能不能|我想|我要|想听|要听|播放|放|听|来点|来一遍|找/g, ' ')
    .replace(/(?:的)?(?:所有|全部|全套|全部的|所有的)(?:的)?(?:歌|歌曲|作品|曲子)/g, ' ')
    .replace(/[，。！？、,.!?~《》“”"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50)
}

async function playNeteaseArtistCatalog(message, player, responseMode) {
  const artistQuery = extractArtistCatalogRequest(message)
  if (!artistQuery) return { handled: false }
  let catalog
  try {
    catalog = await fetchNeteaseArtistSongs(artistQuery, { limit: 2000 })
  } catch (error) {
    return {
      handled: true,
      reply: responseMode === 'silent' ? '...' : (error instanceof Error ? error.message : '歌手曲库暂时读取失败。'),
      skipTts: responseMode === 'silent',
    }
  }
  const tracks = Array.isArray(catalog.songs) ? catalog.songs : []
  if (!tracks.length) {
    return {
      handled: true,
      reply: responseMode === 'silent' ? '...' : `找到了歌手「${catalog.artist?.name || artistQuery}」，但暂时没有可播放的歌曲。`,
      skipTts: responseMode === 'silent',
    }
  }
  player.setPlaybackMode('sequence')
  const result = await player.playTrackFromQueue(
    tracks[0],
    tracks,
    { crossfade: Boolean(getCurrentTrack(player)) },
  )
  const artistName = catalog.artist?.name || artistQuery
  return {
    handled: true,
    reply: responseMode === 'silent'
      ? '...'
      : result?.ok
        ? `找到了 ${artistName} 的 ${tracks.length} 首可播放歌曲，已经从第一首开始顺序播放。`
        : `找到了 ${artistName} 的歌曲，但第一首暂时播不起来。`,
    song: result?.ok ? tracks[0] : null,
    songReactionTrigger: result?.ok ? 'user_play' : null,
    skipTts: responseMode === 'silent',
  }
}

function isAiRecommendationRequest(message) {
  const text = String(message || '')
  if (/(不要|不用|别)/.test(text)) return false
  const asksRecommendation = /(?:AI|ai|网易云)?推荐/.test(text)
    && /(?:播放|放|听|来|选|继续|一首|几首|喜欢|相似|适合)/.test(text)
  const asksSimilar = /(?:播放|放|来|换成|接着|继续|找)(?:一首|一点|点)?(?:和)?(?:这首|当前|现在这首)?(?:相似|类似)(?:的)?(?:歌|歌曲|音乐)/.test(text)
  return asksRecommendation || asksSimilar
}

async function playNeteaseAiRecommendation(message, player, responseMode, context = {}) {
  if (!isAiRecommendationRequest(message)) return { handled: false }
  let tracks
  try {
    const executor = createCapabilityExecutor(player)
    const currentTrack = getCurrentTrack(player) || context.currentSong
    const capability = /(?:类似|相似)/.test(message) ? 'netease.recommend.similar' : 'netease.recommend.contextual'
    tracks = requireCapabilityValue(await executor.execute({
      capability,
      action: 'list',
      args: capability === 'netease.recommend.similar'
        ? { currentSong: currentTrack, context, limit: 8 }
        : { context: { ...context, currentSong: currentTrack }, limit: 8 },
    }))
  } catch {
    return { handled: false }
  }
  if (!tracks.length) return { handled: false }
  player.setPlaybackMode('ai_recommend')
  const result = await player.playTrackFromQueue(
    tracks[0],
    tracks,
    { crossfade: Boolean(getCurrentTrack(player)) },
  )
  if (result?.ok) {
    player.setAutoUpNext(tracks.slice(1, 4))
    player.setQueuedNextTrack(null)
  }
  return {
    handled: true,
    reply: responseMode === 'silent'
      ? '...'
      : result?.ok
        ? '好，我会参考现在这首歌、你的网易云推荐和喜欢音乐，接着自动续播。'
        : '推荐队列已经生成，但第一首暂时播不起来。',
    song: result?.ok ? tracks[0] : null,
    songReactionTrigger: result?.ok ? 'ai_next' : null,
    skipTts: responseMode === 'silent',
  }
}

function detectHardMusicCommand(message) {
  const text = compactText(message)

  // Voice input and quick typing often repeat the command (for example, “换歌换歌”).
  // Treat every repetition as one immediate player command instead of handing it to the chat model.
  if (/^(?:(?:下一首|下首|切歌|换一首|换歌))+(?:吧|呀|呢|一下)?$/.test(text)) return 'next'
  if (/^(上一首|上首|前一首|上一曲)(吧|呀|呢|一下)?$/.test(text)) return 'previous'
  if (/^(暂停|停一下|先停|别放了|暂停一下)(吧|呀|呢)?$/.test(text)) return 'pause'
  if (/^(继续|继续播放|接着放|接着听|恢复播放)(吧|呀|呢)?$/.test(text)) return 'resume'
  if (/^(重新播放|重播|从头播放|从头放|再放一遍)(吧|呀|呢)?$/.test(text)) return 'replay'

  return null
}

// Retained for a possible offline-only mode. Normal routing uses the
// contextual DeepSeek gate below.
function detectInstantMusicCommand(message) {
  const text = String(message || '')
    .trim()
    .replace(/^(?:小昀|小云|晓云|小韵|小芸|小允|老赢|角蝇)[，,、\s]*/i, '')
    .replace(/[，。！？、,.!?~…\s]/g, '')

  // These are deterministic player controls. They must execute locally before
  // any model request, otherwise a simple pause can become a spoken promise
  // instead of an actual player operation.
  if (/^(?:暂停|暂停音乐|暂停播放|先暂停|先停|停一下|停一会|停止播放|别放了)$/.test(text)) return 'pause'
  if (/^(?:继续|继续播放|恢复播放|接着放|继续听)$/.test(text)) return 'resume'
  if (/^(?:下一首|下首|切歌|换歌|换一首|换首歌)$/.test(text)) return 'next'
  if (/^(?:上一首|上首|前一首|上一曲)$/.test(text)) return 'previous'
  if (/^(?:重新播放|重播|从头播放|从头再放)$/.test(text)) return 'replay'

  return detectHardMusicCommand(text)
}

function detectMusicStructureIntent(message) {
  const text = String(message || '').replace(/\s/g, '')
  if (!text) return null
  if (/第二段副歌/.test(text)) return { intent: 'seek_music_section', target: 'chorus', occurrence: 'second' }
  if (/最后一段副歌|末段副歌/.test(text)) return { intent: 'seek_music_section', target: 'chorus', occurrence: 'last' }
  if (/第一段副歌|从副歌开始|跳到副歌/.test(text)) return { intent: 'seek_music_section', target: 'chorus', occurrence: 'first' }
  if (/播放高潮|直接放高潮|跳到高潮|最激烈的那一段/.test(text)) return { intent: 'seek_music_section', target: 'highlight', occurrence: 'best' }
  if (/跳过前奏|播放前奏/.test(text)) return { intent: 'seek_music_section', target: 'intro', occurrence: 'first' }
  if (/从有人声的地方开始/.test(text)) return { intent: 'seek_music_section', target: 'vocal_entry', occurrence: 'first' }
  if (/跳到吉他solo/.test(text)) return { intent: 'seek_music_section', target: 'guitar_solo', occurrence: 'first' }
  return null
}

async function executeMusicStructureIntent(intent, player, responseMode) {
  const currentTrack = getCurrentTrack(player)
  if (!currentTrack) return { handled: true, reply: '还没有正在播放的歌。', skipTts: responseMode === 'silent' }
  const result = await resolveMusicStructureSeek(currentTrack, intent)
  if (!result.ok || !Number.isFinite(Number(result.positionSec))) {
    return {
      handled: true,
      reply: responseMode === 'silent' ? '...' : '这首歌的结构还在后台分析，完成后我就能准确跳到那一段。',
      skipTts: responseMode === 'silent',
    }
  }
  player.seek(result.positionSec)
  return { handled: true, reply: responseMode === 'silent' ? '...' : '好，已经跳到那一段。', skipTts: responseMode === 'silent' }
}

function hasNegativeMusicProtection(message) {
  return /别换歌|不要换|先别动|就这首|不用推荐|不要推荐|别播放|不要播放|先别放/.test(message)
}

function isSongDiscussion(message) {
  return /这首歌|这首|现在这首|当前这首/.test(message)
    && /讲什么|什么感觉|为什么|好听|难过|空|歌词|氛围|适合|像什么/.test(message)
}

function isSpecificSongQuestion(message) {
  return /什么意思|什么感觉|为什么|好听吗|歌词|讲什么|讲的什么|表达什么|谁唱的|哪首|哪一首/.test(message)
}

function isMusicReject(message) {
  return /不要这首|不想听这个|别放这个|换掉它|跳过这首|我不要|不想听|别放|不放/.test(message)
}

function hasExplicitMusicAction(message) {
  return /播放|放一首|来首|来一首|想听|要听|听一下|听听|听这首|听那首|听歌|找歌|搜索|有没有|本地|换歌|切歌|换一首|换过去|切过去|下一首|上一首|歌手|歌名|随机来|随便来|推荐一首|给我放|帮我放|你来选|帮我选/.test(message)
}

function hasNaturalPlayIntent(message) {
  return /想听|要听|听一下|听听|听这首|听那首|放给我|给我放|帮我放|来点|来首|来一首|换成|换到|切到|播放/.test(message)
}

function hasExplicitNamedOnlineTrackRequest(message) {
  const text = String(message || '').trim()
  if (!hasExplicitMusicAction(text)) return false
  return /[《“"][^》”"]{2,80}[》”"]/.test(text)
    || /(?:播放|放|想听|要听|听|来首|来一首)[^，。！？,.!?]{2,30}的[^，。！？,.!?]{2,50}/.test(text)
    || /(?:播放|放|想听|要听|听|来首|来一首).*?[a-z][a-z0-9 '&().-]{1,80}/i.test(text)
}

function hasLanguageMusicPreference(message) {
  return /中文歌|中文|国语|华语|日语|日文|日系|英文|英语|欧美|韩语|韩文|纯音乐|不要人声|无人声|伴奏|instrumental|jpop|kpop/i.test(message)
}

function shouldAskSmartMusicCommand(message) {
  const text = String(message || '').trim()

  if (!text) return false
  if (hasNegativeMusicProtection(text) && !isMusicReject(text)) return false
  if (isSongDiscussion(text)) return false
  if (isMusicReject(text)) return true
  if (hasExplicitMusicAction(text)) return true

  return hasLanguageMusicPreference(text) && /来|放|听|找|推荐|想/.test(text)
}

function detectRecommendationConfirm(message) {
  const text = compactText(message)

  return /^(好|好的|可以|行|嗯|恩|就这首|就这个|就它|放吧|播放吧|听这个|那就这首|好就这首吧?)$/.test(text)
}

function findLocalTrackBySmartResult(result, libraryTracks) {
  const matches = Array.isArray(result?.matches) ? result.matches : []
  const matchedSong = matches[0]?.song

  if (!matchedSong?.id) return null

  return libraryTracks.find((track) => track.id === matchedSong.id) || matchedSong
}

function findLastMentionedTrack(chatHistory, libraryTracks) {
  const assistantMessages = [...(chatHistory || [])]
    .reverse()
    .filter((item) => item?.role === 'assistant')

  for (const message of assistantMessages) {
    const content = String(message.content || '')
    const titleMatches = [...content.matchAll(/《([^》]+)》/g)].map((match) => match[1])

    for (const title of titleMatches) {
      const compactTitle = compactText(title)
      const track = libraryTracks.find((song) => {
        const songTitle = compactText(song.title)
        const songFile = compactText(song.filename || '')

        return songTitle === compactTitle || songTitle.includes(compactTitle) || songFile.includes(compactTitle)
      })

      if (track) return track
    }
  }

  return null
}

function findRememberedTrack(message, memory, libraryTracks) {
  if (!memory?.memoryEnabled) return null
  if (!/过去|之前|刚才|那首|这首|记得|记忆|换过去|就这/.test(message)) return null

  const memoryTexts = [
    ...collectTextValues(memory.memoryContext),
    ...collectTextValues(memory.longTermMemory),
  ]
    .filter((text) => /歌|音乐|听|播放|曲库|《/.test(text))
    .reverse()

  for (const text of memoryTexts) {
    const track = findLocalTrackFromText(text, libraryTracks)
    if (track) return track
  }

  return null
}

function modeReply(responseMode, action, fallback) {
  if (responseMode === 'silent') return { reply: '...', skipTts: true }

  const replies = {
    next: {
      normal: '好，换一首。',
      podcast: '好，换一首。',
      companion: '嗯，给你换一首。',
    },
    previous: {
      normal: '好，上一首。',
      podcast: '好，上一首。',
      companion: '嗯，回到上一首。',
    },
    pause: {
      normal: '好，先暂停。',
      podcast: '好，先暂停。',
      companion: '好，先停一下。',
    },
    resume: {
      normal: '好，继续放。',
      podcast: '好，继续放。',
      companion: '嗯，继续放给你听。',
    },
    replay: {
      normal: '好，从头再听。',
      podcast: '好，从头再来一遍。',
      companion: '好，我们从头再听一遍。',
    },
    confirm: {
      normal: '好，就这首。',
      podcast: '好，就这首。',
      companion: '嗯，那就这首。我放给你听。',
    },
  }

  return {
    reply: replies[action]?.[responseMode] || replies[action]?.companion || fallback,
    skipTts: false,
  }
}

async function executeHardCommand(action, player, responseMode) {
  if (action === 'next') {
    const result = await player.next()
    return {
      handled: true,
      ...(result?.ok
        ? {
          ...modeReply(responseMode, 'next'),
          song: result.song,
          songReactionTrigger: 'ai_next',
        }
        : { reply: '本地曲库还没找到下一首。', skipTts: responseMode === 'silent' }),
    }
  }

  if (action === 'previous') {
    const result = await player.previous()
    return {
      handled: true,
      ...(result?.ok
        ? {
          ...modeReply(responseMode, 'previous'),
          song: result.song,
          songReactionTrigger: 'user_prev',
        }
        : { reply: '本地曲库还没找到上一首。', skipTts: responseMode === 'silent' }),
    }
  }

  if (action === 'pause') {
    player.pause()
    return { handled: true, ...modeReply(responseMode, 'pause') }
  }

  if (action === 'resume') {
    const currentTrack = getCurrentTrack(player)
    const result = currentTrack
      ? await player.playTrack(currentTrack)
      : await player.togglePlay()

    return {
      handled: true,
      ...(result?.ok
        ? modeReply(responseMode, 'resume')
        : { reply: '还没有可以继续播放的歌。', skipTts: responseMode === 'silent' }),
    }
  }

  if (action === 'replay') {
    const currentTrack = getCurrentTrack(player)
    if (!currentTrack) {
      return { handled: true, reply: '还没有正在播放的歌。', skipTts: responseMode === 'silent' }
    }

    player.seek(0)
    await player.playTrack(currentTrack)
    return { handled: true, ...modeReply(responseMode, 'replay') }
  }

  return { handled: false }
}

async function executeSmartMusicResult({ smartResult, libraryTracks, player, responseMode }) {
  const commandType = smartResult?.command?.type || smartResult?.action?.type || 'none'

  if (commandType === 'none') return { handled: false }
  if (commandType === 'next') return executeHardCommand('next', player, responseMode)
  if (commandType === 'previous') return executeHardCommand('previous', player, responseMode)
  if (commandType === 'pause') return executeHardCommand('pause', player, responseMode)
  if (commandType === 'resume') return executeHardCommand('resume', player, responseMode)

  if (commandType === 'play_search') {
    const track = findLocalTrackBySmartResult(smartResult, libraryTracks)

    if (!track) {
      return {
        handled: true,
        reply: responseMode === 'silent'
          ? '...'
          : smartResult.reply || '我在本地曲库里没找到合适的歌。',
        skipTts: responseMode === 'silent',
      }
    }

    const result = await player.playTrack(track)

    return {
      handled: true,
      reply: responseMode === 'silent'
        ? '...'
        : result?.ok
          ? smartResult.reply || `嗯，我找到了，给你放《${track.title}》。`
          : `找到了《${track.title}》，但这首暂时播不了。`,
      song: result?.ok ? track : null,
      songReactionTrigger: 'ai_next',
      skipTts: responseMode === 'silent' || smartResult.shouldSpeak === false,
    }
  }

  return { handled: false }
}

// Kept as the offline-only legacy executor while RadioEngine owns normal execution.
void executeSmartMusicResult

async function executeRadioPlanResult({
  smartResult,
  message,
  libraryTracks,
  player,
  responseMode,
  musicSource,
  context,
  inputMode,
}) {
  const plan = await createPlaybackPlan({
    smartResult,
    message,
    libraryTracks,
    player,
    responseMode,
    musicSource,
    context,
    inputMode,
  })

  if (plan.action === 'none') {
    if (plan.needsClarification) {
      return {
        handled: true,
        reply: plan.reply,
        skipTts: responseMode === 'silent',
        playbackPlan: plan,
      }
    }
    // A none classification is not a final answer. Continue through the
    // remaining router and Agent fallbacks instead of consuming this turn.
    return { handled: false, playbackPlan: plan }
  }

  const result = await executePlaybackPlan(plan, player)
  const song = result?.ok && plan.action === 'play' ? plan.track : result?.song || null
  return {
    handled: true,
    reply: responseMode === 'silent'
      ? '...'
      : result?.ok
        ? plan.reply
        : `我找到了《${plan.track?.title || ''}》，但这首暂时播不起来。`,
    song: result?.ok ? song : null,
    songReactionTrigger: plan.action === 'play' || plan.action === 'next' ? 'ai_next' : null,
    skipTts: responseMode === 'silent' || plan.shouldSpeak === false,
    playbackPlan: plan,
  }
}

void detectInstantMusicCommand
void shouldAskSmartMusicCommand

async function routeChatIntentImpl({
  message,
  chatHistory = [],
  currentSong = null,
  libraryTracks = [],
  player,
  setResponseMode = null,
  responseMode = 'companion',
  persona = 'warm',
  musicSource = 'local',
  memory = null,
  playHistory = [],
  rejectedTracks = [],
  recentRecommendations = [],
  pendingPlaylistSelection = null,
  inputMode = 'text',
}) {
  // Playback controls are latency-sensitive, especially on a voice turn.
  // They must never wait for the model-backed intent gate: Pro models can
  // legitimately spend seconds reasoning before producing a tool decision.
  const instantAction = detectInstantMusicCommand(message)
  if (instantAction) return executeHardCommand(instantAction, player, responseMode)

  // Local shortcuts may only own a whole turn. Chained requests are planned
  // by the Agent, so a later clause is never silently discarded.
  if (isCompoundInstruction(message)) return { handled: false }

  // Generated playlists and scene-aware recommendations are Agent skills,
  // rather than a lookup for one of the user's existing NetEase playlists.
  if (isGeneratedPlaylistRequest(message) || isSceneRecommendationRequest(message)) return { handled: false }

  const structureIntent = detectMusicStructureIntent(message)
  if (structureIntent) return executeMusicStructureIntent(structureIntent, player, responseMode)

  const platformCapability = await executePlatformCapabilityIntent({
    message,
    inputMode,
    player,
    responseMode,
    currentSong: currentSong || getCurrentTrack(player),
    playHistory,
    rejectedTracks,
    recentRecommendations,
  })
  if (platformCapability.handled) return platformCapability

  const settingsIntent = executePlayerSettingIntent(message, player, setResponseMode, responseMode)
  if (settingsIntent.handled) return settingsIntent

  const lyricLookup = await playNeteaseFromLyrics(message, player, responseMode)
  if (lyricLookup.handled) return lyricLookup

  const collectionAdd = await addCurrentSongToNeteaseCollection(message, currentSong || getCurrentTrack(player), responseMode)
  if (collectionAdd.handled) return collectionAdd

  const artistCatalog = await playNeteaseArtistCatalog(message, player, responseMode)
  if (artistCatalog.handled) return artistCatalog

  const myPlaylist = await playMyNeteasePlaylist(message, player, responseMode, { pendingSelection: pendingPlaylistSelection })
  if (myPlaylist.handled) return myPlaylist

  // An explicit song-and-artist request is already deterministic. Bypass the
  // model gate so a `none` classification cannot add seconds of delay before
  // the exact-title protected NetEase lookup begins.
  if (hasExplicitNamedOnlineTrackRequest(message)) {
    return playNeteaseFromMessage(message, player, responseMode, {
      currentSong,
      playHistory,
      rejectedTracks,
      recentRecommendations,
      inputMode,
    })
  }

  const aiRecommendation = await playNeteaseAiRecommendation(message, player, responseMode, {
    currentSong,
    playHistory,
    rejectedTracks,
    recentRecommendations,
  })
  if (aiRecommendation.handled) return aiRecommendation

  // Every user utterance passes through the DeepSeek intent gate first.  The
  // gate can deliberately return `none` for ordinary companion chat, but it
  // also sees the preceding turn so corrections such as “我说的是《情歌》”
  // complete the earlier playback request instead of becoming empty smalltalk.
  try {
    const smartResult = await requestSmartMusicCommand({
      message,
      chatHistory,
      currentSong,
      responseMode,
      persona,
      playHistory,
      rejectedTracks,
      recentRecommendations,
      inputMode,
    })
    if (smartResult?.should_execute && smartResult?.target?.source === 'netease_liked') {
      return playMyNeteasePlaylist(message, player, responseMode, { forceLiked: true })
    }
    if (smartResult?.should_execute && smartResult?.target?.source === 'lyrics' && smartResult?.target?.query) {
      return playNeteaseFromLyricFragment(smartResult.target.query, player, responseMode)
    }
    const executed = await executeRadioPlanResult({
      smartResult,
      message,
      libraryTracks,
      player,
      responseMode,
      musicSource,
      context: { currentSong, playHistory, rejectedTracks, recentRecommendations },
      inputMode,
    })

    if (executed.handled) return executed
  } catch {
    // Offline fallback remains constrained to harmless, deterministic player
    // controls; no model failure may turn a normal sentence into an action.
    const fallbackAction = detectHardMusicCommand(message)
    if (fallbackAction) return executeHardCommand(fallbackAction, player, responseMode)
    // Direct NetEase lookup and the Agent below are deliberate fallbacks. A
    // failed intent gate must not turn a multi-step request into a final error.
  }

  const directMentionedTrack = findLocalTrackFromText(message, libraryTracks)
  if (directMentionedTrack && !isSpecificSongQuestion(message) && (hasExplicitMusicAction(message) || hasNaturalPlayIntent(message))) {
    player.clearPlaybackQueue()
    const result = await player.playTrack(directMentionedTrack)

    return {
      handled: true,
      reply: result?.ok
        ? `嗯，换到《${directMentionedTrack.title}》了。`
        : `我找到了《${directMentionedTrack.title}》，但这首暂时播不了。`,
      song: result?.ok ? directMentionedTrack : null,
      songReactionTrigger: 'user_play',
      skipTts: responseMode === 'silent',
    }
  }

  if (!directMentionedTrack) {
    const onlineResult = await playNeteaseFromMessage(message, player, responseMode, {
      currentSong,
      playHistory,
      rejectedTracks,
      recentRecommendations,
      inputMode,
    })
    if (onlineResult.handled) return onlineResult
  }

  if (detectRecommendationConfirm(message) || /换过去|切过去|刚才那首|之前那首|那就这个|就这个/.test(message)) {
    const confirmedTrack = findLastMentionedTrack(chatHistory, libraryTracks)
      || findRememberedTrack(message, memory, libraryTracks)

    if (confirmedTrack) {
      player.clearPlaybackQueue()
      const result = await player.playTrack(confirmedTrack)

      return {
        handled: true,
        ...(result?.ok
          ? {
            ...modeReply(responseMode, 'confirm'),
            song: confirmedTrack,
            songReactionTrigger: 'user_play',
          }
          : {
            reply: responseMode === 'silent'
              ? '...'
              : `我找到了《${confirmedTrack.title}》，但这首暂时播不了。`,
            skipTts: responseMode === 'silent',
          }),
      }
    }
  }

  return { handled: false }
}

function summarizeTraceResult(result) {
  if (!result) return null
  const value = result.value
  const itemCount = Array.isArray(value)
    ? value.length
    : Array.isArray(value?.songs)
      ? value.songs.length
      : Array.isArray(value?.items)
        ? value.items.length
        : undefined
  return {
    ok: result.ok === true,
    ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    ...(result.errorDetails ? { errorDetails: result.errorDetails } : {}),
    ...(itemCount !== undefined ? { itemCount } : {}),
  }
}

// `debugTrace` is an explicit dev/E2E-only collector. Production callers do
// not pass it, and no trace metadata is returned to or rendered by the chat UI.
export async function routeChatIntent(args = {}) {
  const currentTrack = args.currentSong || args.player?.getState?.()?.currentTrack || null
  const planned = planNeteaseCapability({
    message: args.message,
    inputMode: args.inputMode,
    currentTrack,
  })
  const result = await routeChatIntentImpl(args)
  const trace = args.debugTrace
  if (trace && typeof trace === 'object') {
    const actualPlan = result?.capabilityPlan || planned
    const definition = getCapability(actualPlan?.capability)
    const exactExecution = result?.playbackResult || result?.capabilityResult || null
    Object.assign(trace, {
      input: String(args.message || ''),
      inputMode: args.inputMode === 'voice' ? 'voice' : 'text',
      detectedIntent: actualPlan?.detectedIntent || null,
      plannedCapability: actualPlan?.capability || null,
      transport: definition?.transport || null,
      adapterAction: actualPlan?.action || null,
      planArgs: actualPlan?.args || null,
      executorResult: exactExecution
        ? summarizeTraceResult(exactExecution)
        : result?.song
          ? { ok: true, inferredFrom: 'completed_route_result' }
          : null,
      capabilityExecutorResult: result?.capabilityResult
        ? summarizeTraceResult(result.capabilityResult)
        : null,
      finalReply: String(result?.reply || ''),
    })
  }
  return result
}
