function compactText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
}

function trackId(track) {
  return String(track?.providerId || track?.id || '').trim()
}

function exactTitleCandidates(candidates, requestedTitle) {
  const expected = compactText(requestedTitle)
  if (!expected) return []
  return candidates.filter((candidate) => compactText(candidate?.title || candidate?.name) === expected)
}

function preferArtist(candidates, requestedArtist) {
  const expected = compactText(requestedArtist)
  if (!expected) return candidates
  const exact = candidates.filter((candidate) => compactText(candidate?.artist) === expected)
  return exact.length ? exact : candidates
}

function clarification(candidates) {
  return candidates.slice(0, 2).map((track) => ({
    providerId: trackId(track),
    title: track?.title || track?.name || '',
    artist: track?.artist || '',
  }))
}

export async function selectNeteaseSongCandidate({
  candidates = [],
  requestedTitle = '',
  requestedArtist = '',
  transcript = '',
  interpretation = '',
  inputMode = 'text',
  resolveVoiceCandidate = null,
} = {}) {
  const realCandidates = (Array.isArray(candidates) ? candidates : []).filter((candidate) => trackId(candidate))
  const exact = preferArtist(exactTitleCandidates(realCandidates, requestedTitle), requestedArtist)
  if (exact.length) return { status: 'selected', track: exact[0], candidates: realCandidates, evidence: 'exact_title' }

  if (!compactText(requestedTitle)) {
    return realCandidates.length
      ? { status: 'selected', track: realCandidates[0], candidates: realCandidates, evidence: 'api_ranking' }
      : { status: 'not_found', track: null, candidates: [], evidence: 'no_api_candidates' }
  }

  if (inputMode !== 'voice') {
    return { status: 'not_found', track: null, candidates: realCandidates, evidence: 'text_exact_mismatch' }
  }
  if (!realCandidates.length) return { status: 'not_found', track: null, candidates: [], evidence: 'no_api_candidates' }

  if (resolveVoiceCandidate) {
    try {
      const resolvedId = await resolveVoiceCandidate({
        transcript,
        interpretation,
        candidates: realCandidates,
      })
      const resolved = realCandidates.find((candidate) => trackId(candidate) === String(resolvedId || '').trim())
      if (resolved) return { status: 'selected', track: resolved, candidates: realCandidates, evidence: 'constrained_resolver' }
    } catch {
      // A failed constrained resolver does not grant any candidate permission
      // to play. The caller will ask the user instead of inventing certainty.
    }
  }

  if (realCandidates.length === 1) {
    return { status: 'selected', track: realCandidates[0], candidates: realCandidates, evidence: 'single_api_candidate' }
  }
  return { status: 'clarify', track: null, candidates: clarification(realCandidates), evidence: 'ambiguous_voice_candidates' }
}

function extractSearchQuery(message) {
  const text = String(message || '').trim()
  const quoted = text.match(/[《“"]([^》”"]{1,80})[》”"]/)
  if (quoted?.[1]) return quoted[1].trim()
  return text
    .replace(/^(?:昀[，,、\s]*)?/, '')
    .replace(/^(?:请|帮我|给我|麻烦)?(?:播放|放|想听|要听|搜索|搜一下|找一下|来首|来一首)\s*/, '')
    .replace(/[。！？!?]+$/g, '')
    .trim()
}

function streamLevel(text) {
  if (/标准/.test(text)) return 'standard'
  if (/HQ/i.test(text)) return 'exhigh'
  if (/无损|SQ/i.test(text)) return 'lossless'
  if (/Hi-?Res|高解析/i.test(text)) return 'hires'
  if (/高清环绕|jyeffect/i.test(text)) return 'jyeffect'
  if (/沉浸|sky/i.test(text)) return 'sky'
  if (/Master|母带|jymaster/i.test(text)) return 'jymaster'
  if (/Spatial Audio/i.test(text)) return 'spatial_audio'
  if (/Audio Vivid/i.test(text)) return 'audio_vivid'
  return 'standard'
}

function audioEffectArgs(text) {
  const effect = /8D/i.test(text) ? '8d'
    : /360/i.test(text) ? '360'
      : /超重低音/.test(text) ? 'bass_boost'
        : /摇滚/.test(text) ? 'rock'
          : /清澈人声/.test(text) ? 'clear_vocal'
            : /AI调音/i.test(text) ? 'ai_tuning'
              : 'all'
  return { effect, enabled: !/(?:关掉|关闭|关了|不要)/.test(text) }
}

function requestedCloudTitle(text) {
  const quoted = text.match(/[《“"]([^》”"]{1,80})[》”"]/)?.[1]
  if (quoted) return quoted.trim()
  return text.replace(/^.*?云盘(?:里|里的|中|中的)?/, '').replace(/^(?:播放|放|来一首|来首)/, '').replace(/[。！？!?]+$/g, '').trim()
}

const intent = (definition) => Object.freeze(definition)

// Deterministic short-command vocabulary is centralized here. Ordering is the
// priority contract: specific API sources (similar/FM/daily/resources) are
// considered before contextual recommendation or generic song search.
export const NETEASE_CAPABILITY_INTENT_CATALOG = Object.freeze([
  intent({ id: 'analysis.audio_anomaly', test: (text) => /(?:声音|听起来).*(?:奇怪|不对|怪怪的|有点怪|异常)/.test(text) && !/(?:关闭|关掉|打开|开启|切换|设置|调成|换成)/.test(text), build: () => ({ kind: 'analysis', action: 'analyze', capability: null, args: {}, automatic: false }) }),
  intent({ id: 'search.lyrics', test: (text) => /(?:歌词里有|歌词是|有一句|记得一句|唱过|唱的是).*(?:什么歌|哪首歌|帮我找|找一下|搜索|搜一下)|(?:什么歌|哪首歌).*(?:歌词|一句)/.test(text), build: (text) => ({ capability: 'netease.search.lyrics', action: 'resolve', args: { query: text } }) }),
  intent({ id: 'recommend.similar', test: (text) => /(?:类似|相似)(?:的)?(?:歌|歌曲|音乐)|(?:类似|相似)(?:这首|当前|现在这首)|(?:和)?(?:这首|当前|现在这首).{0,4}(?:类似|相似)(?:的)?(?:歌|歌曲|音乐)?/.test(text), build: (text, context) => ({ capability: 'netease.recommend.similar', action: /(?:播放|放|听|来|换|接着|继续)/.test(text) ? 'play' : 'list', args: { currentSong: context.currentTrack } }) }),
  intent({ id: 'library.liked_add', test: (text) => /(?:这首|当前这首|现在这首).*(?:收藏|红心|喜欢)|(?:收藏|红心|喜欢)(?:一下)?(?:这首|当前这首)/.test(text), build: (_text, context) => ({ capability: 'netease.library.liked', action: 'add', args: { song: context.currentTrack } }) }),
  intent({ id: 'client.podcast_page', test: (text) => /(?:打开|进入).*(?:网易云|网易云音乐)(?:客户端)?(?:里|中的)?.*(?:我的播客|播客页面)/.test(text), build: () => ({ capability: 'netease.client.podcast.open', action: 'open', args: {} }) }),
  intent({ id: 'library.podcast_play', test: (text) => /(?:播放|放|听).*(?:我的)?播客|(?:我的)?播客.*(?:播放|放|听)/.test(text), build: (text) => ({ capability: 'netease.library.podcasts', action: 'play', args: { podcastName: extractSearchQuery(text) } }) }),
  intent({ id: 'library.podcast_list', test: (text) => /(?:打开|看看|查看|列出|读读|有什么).*(?:我的)?播客|^(?:我的)?播客[？?]?$/.test(text), build: () => ({ capability: 'netease.library.podcasts', action: 'list', args: { source: 'subscribed' } }) }),
  intent({ id: 'client.open', test: (text) => /(?:打开|启动).*(?:网易云|网易云音乐)(?:客户端)?/.test(text), build: () => ({ capability: 'netease.client.open', action: 'open', args: {} }) }),
  intent({ id: 'player.stream_quality', test: (text) => /(?:这首|当前这首|现在这首).*(?:用|切到|换成|播放|放|听).*(?:标准|HQ|SQ|无损|Hi-?Res|高解析|高清环绕|沉浸|sky|Spatial Audio|Audio Vivid|Master|母带)|(?:这首|当前这首|现在这首).*(?:标准|HQ|SQ|无损|Hi-?Res|高解析|高清环绕|沉浸|sky|Spatial Audio|Audio Vivid|Master|母带).*(?:播放|放|听)|(?:用|切到|换成).*(?:标准|HQ|SQ|无损|Hi-?Res|高解析|高清环绕|沉浸|sky|Spatial Audio|Audio Vivid|Master|母带).*(?:播放|放)(?:这首|当前这首)?/i.test(text), build: (text, context) => ({ capability: 'yun.player.stream_quality', action: 'resolve', args: { level: streamLevel(text), song: context.currentTrack } }) }),
  intent({ id: 'desktop.default_quality', test: (text) => /(?:音质|品质).*(?:标准|HQ|SQ|无损|Spatial Audio|Audio Vivid|Master|沉浸)|(?:换回|调到|调成|切到|切成).*(?:标准(?:音质|品质)|无损(?:音质|品质)|HQ|SQ|Master)/i.test(text), build: (text) => ({ capability: 'netease.desktop.default_quality', action: 'set', args: { quality: streamLevel(text) } }) }),
  intent({ id: 'desktop.audio_effect', test: (text) => /(?:8D|360|超重低音|摇滚|清澈人声|AI调音|音效).*(?:关掉|关闭|关了|打开|开启|切换|设置|调成|换成)|(?:关掉|关闭|关了|打开|开启).*(?:8D|360|音效)/i.test(text), build: (text) => ({ capability: 'netease.audio.effect', action: 'set', args: audioEffectArgs(text) }) }),
  intent({ id: 'library.playlist_delete', test: (text) => /(?:删除|删掉).*(?:歌单)/.test(text), build: (text) => ({ capability: 'netease.library.playlist_delete', action: 'delete', args: { name: extractSearchQuery(text) }, requiresConfirmation: true }) }),
  intent({ id: 'player.next', test: (text) => /^(?:下一首|下首|切歌|换歌|换一首)[。！？!?]*$/.test(text), build: () => ({ capability: 'yun.player.transport', action: 'next', args: {} }) }),
  intent({ id: 'player.previous', test: (text) => /^(?:上一首|上首|前一首|上一曲)[。！？!?]*$/.test(text), build: () => ({ capability: 'yun.player.transport', action: 'previous', args: {} }) }),
  intent({ id: 'player.pause', test: (text) => /^(?:暂停|停一下|先停|暂停一下)[。！？!?]*$/.test(text), build: () => ({ capability: 'yun.player.transport', action: 'pause', args: {} }) }),
  intent({ id: 'player.resume', test: (text) => /^(?:继续|继续播放|恢复播放)[。！？!?]*$/.test(text), build: () => ({ capability: 'yun.player.transport', action: 'resume', args: {} }) }),
  intent({ id: 'recommend.personal_fm', test: (text) => /私人\s*FM|网易云.*(?:随便放|随便来|推荐来)|按网易云推荐来/i.test(text), build: (text) => ({ capability: 'netease.recommend.personal_fm', action: /(?:放|播放|听|来)/.test(text) ? 'play' : 'list', args: {} }) }),
  intent({ id: 'recommend.playlist', test: (text) => /(?:推荐|每日推荐).*(?:歌单)|(?:歌单).*(?:推荐|今天有什么)/.test(text), build: () => ({ capability: 'netease.recommend.playlist', action: 'list', args: {} }) }),
  intent({ id: 'recommend.daily', test: (text) => /每日推荐|今天(?:网易云)?(?:给我)?推荐什么|今天听什么|给我推荐(?:一首|几首|点歌)?|随便放点/.test(text), build: (text) => ({ capability: 'netease.recommend.daily', action: /(?:放|播放|听|来|推荐一首)/.test(text) ? 'play' : 'list', args: {} }) }),
  intent({ id: 'library.user_record', test: (text) => /最近(?:最常|常常|经常|最多)听|听歌排行|常听什么|历史上.*(?:听|播放).*(?:最多|排行)|(?:一直以来|累计|全部).*(?:听|播放).*(?:最多|排行)/.test(text), build: (text) => ({ capability: 'netease.library.user_record', action: 'list', args: { type: /历史上|一直以来|累计|全部|所有/.test(text) ? 'all' : 'week' } }) }),
  intent({ id: 'library.recent', test: (text) => /(?:网易云)?.*(?:最近播放|最近听了什么|最近听过什么)|看看我最近听|^(?:网易云)?(?:我)?最近(?:播放的?|听过的?|听的?)?(?:歌曲|歌)(?:记录|列表)?[。！？!?]*$/.test(text), build: () => ({ capability: 'netease.library.recent', action: 'list', args: { type: 'song' } }) }),
  intent({ id: 'library.cloud_play', test: (text) => /(?:播放|放|听).*(?:云盘)|(?:云盘).*(?:播放|放|听)/.test(text), build: (text) => ({ capability: 'netease.library.cloud', action: 'play', args: { query: requestedCloudTitle(text) } }) }),
  intent({ id: 'library.cloud_list', test: (text) => /(?:看看|查看|打开|列出|有什么).*(?:云盘)|^(?:我的)?云盘[？?]?$/.test(text), build: () => ({ capability: 'netease.library.cloud', action: 'list', args: {} }) }),
  intent({ id: 'search.suggest', test: (text) => /(?:搜索|搜歌).*(?:建议|提示|联想)/.test(text), build: (text) => ({ capability: 'netease.search.suggest', action: 'suggest', args: { query: extractSearchQuery(text) } }) }),
  intent({ id: 'song.playability', test: (text) => /(?:这首|当前这首|现在这首).*(?:能不能|是否|可以).*(?:播放|听)|(?:能不能|是否|可以).*(?:播放|听).*(?:这首|当前这首)/.test(text), build: (_text, context) => ({ capability: 'netease.song.playability', action: 'check', args: { songId: trackId(context.currentTrack) } }) }),
  intent({ id: 'song.detail', test: (text) => /(?:这首|当前这首|现在这首).*(?:详情|信息|专辑是什么|谁唱的)/.test(text), build: (_text, context) => ({ capability: 'netease.song.detail', action: 'get', args: { songId: trackId(context.currentTrack) } }) }),
  intent({ id: 'recommend.contextual', test: (text) => /(?:推荐|来点|来些|随便来|接着放).*(?:歌|音乐)?/.test(text) && !/(?:不要|不用|别)/.test(text), build: (text) => ({ capability: 'netease.recommend.contextual', action: 'list', args: { context: { request: text } } }) }),
  intent({ id: 'search.song', test: (text) => /(?:播放|放|想听|要听|搜索|搜一下|找一下|来首|来一首)/.test(text), build: (text) => ({ capability: 'netease.search.song', action: 'search', args: { query: extractSearchQuery(text) } }) }),
])

export function planNeteaseCapability({ message = '', inputMode = 'text', currentTrack = null } = {}) {
  const text = String(message || '').trim()
  const base = { version: 'netease-capability-plan/v1', inputMode }
  if (!text) return null
  const context = { currentTrack }
  for (const entry of NETEASE_CAPABILITY_INTENT_CATALOG) {
    if (!entry.test(text, context)) continue
    const plan = entry.build(text, context)
    return { ...base, detectedIntent: entry.id, kind: plan.kind || 'capability', ...plan }
  }
  return null
}
