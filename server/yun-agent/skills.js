// Reusable high-level workflows. A skill produces the same declarative action
// plans as tools, keeping the server free of browser/audio ownership.

function playlistSearchQuery(message) {
  const text = String(message || '')
  const theme = [
    ['运动|跑步|健身', '运动'],
    ['通勤|上班|下班', '通勤'],
    ['雨天|下雨', '雨天'],
    ['睡觉|睡前|助眠', '助眠'],
    ['放松|舒缓|解压', '放松'],
    ['夜路回家|夜归|晚归|夜路', '夜路回家 舒缓'],
    ['平静|冷静|心乱|吵架|难过|烦躁', '平静 舒缓'],
  ].find(([pattern]) => new RegExp(pattern).test(text))?.[1]
  return theme ? `${theme} 歌曲` : ''
}

function playlistSetupActions(message) {
  const text = String(message || '')
  const actions = []
  if (/随机播放|随机模式|打乱播放/.test(text)) actions.push({ type: 'music.set_mode', payload: { mode: 'shuffle' } })
  if (/顺序播放|列表循环|顺序模式/.test(text)) actions.push({ type: 'music.set_mode', payload: { mode: 'sequence' } })
  if (/单曲循环|循环这首/.test(text)) actions.push({ type: 'music.set_mode', payload: { mode: 'loop_one' } })
  if (/专注(?:模式|状态)?|静音(?:模式|状态)?|安静模式/.test(text)) actions.push({ type: 'music.set_response_mode', payload: { mode: 'silent' } })
  if (/播客(?:模式|状态)?/.test(text)) actions.push({ type: 'music.set_response_mode', payload: { mode: 'podcast' } })
  if (/陪伴(?:模式|状态)?/.test(text)) actions.push({ type: 'music.set_response_mode', payload: { mode: 'companion' } })
  if (/(?:把|将)?这首.*(?:加到.*(?:喜欢|红心)|加入.*(?:喜欢|红心)|收藏|存到.*(?:喜欢|红心))|(?:喜欢|红心).*(?:加|收藏)/.test(text)) {
    actions.push({ type: 'music.add_to_collection', payload: { target: 'liked' } })
  }
  return actions
}

function companionLeadIn(message, { query = '', keepCurrentSong = false } = {}) {
  const text = String(message || '')
  if (/七夕|情人节|圣诞|跨年|生日/.test(text) && /一个人|自己过|独自|孤单/.test(text)) {
    return keepCurrentSong
      ? '节日一个人也不用把现在这首急着换掉。我先给你留一组不吵、但不会太空的歌在后面。'
      : '七夕一个人过啊。那今晚不搞热闹的，我给你挑一组不吵、但不会太空的歌。'
  }
  if (/失眠|睡不着/.test(text)) return keepCurrentSong ? '先不动现在这首，我把更轻一点的歌放进后面。' : '还没睡着啊。先别硬撑，我放一组轻一点的。'
  if (/加班|赶工|工作/.test(text)) return keepCurrentSong ? '你先忙，我把不抢注意力的歌排在后面。' : '行，先陪你把这段熬过去。我放点不抢注意力的。'
  if (/烦躁|心烦|难过|失恋|低落/.test(text)) return keepCurrentSong ? '先不急着把情绪盖过去，我把合适的歌留在后面。' : '嗯，今天先不用把自己哄好。我挑几首能安静待着的。'
  if (keepCurrentSong) return '好，先不打断现在这首；下一组歌我放进待播放。'
  return query ? `好，我按“${query.replace(/ 歌曲$/, '')}”给你挑一组。` : '好，我先按你现在的状态挑一组。'
}

function extractNamedNeteasePlaylist(message) {
  const text = String(message || '').trim()
  if (!/(?:播放|放|听|开始|继续)/.test(text) || !/(?:歌单|播放列表)/.test(text)) return ''
  const match = text.match(/(?:我叫|名为|我的)\s*[「《“"]?([^」》”"，。！？\s]{1,50}?)[」》”"]?\s*(?:的)?(?:歌单|播放列表)/)
  return String(match?.[1] || '').trim()
}

function requestsNeteaseLikedSongs(message) {
  const text = String(message || '').trim()
  return /(?:播放|放|听|开始|继续)/.test(text)
    && /(?:我喜欢的音乐|我的喜欢|我喜欢的歌|喜欢的歌)/.test(text)
}

export const yunSkills = Object.freeze([
  {
    name: 'play_netease_liked_songs',
    description: 'Play the signed-in user\'s NetEase liked-songs playlist.',
    matches: (message) => requestsNeteaseLikedSongs(message),
    run: async () => ({
      skill: 'play_netease_liked_songs',
      message: '好，给你放「我喜欢的音乐」。',
      actions: [{ type: 'music.play_netease_playlist', payload: { playlistName: '我喜欢的音乐' } }],
    }),
  },
  {
    name: 'play_named_netease_playlist',
    description: 'Play one of the user\'s NetEase playlists by its exact spoken name.',
    matches: (message) => Boolean(extractNamedNeteasePlaylist(message)),
    run: async ({ message }) => {
      const playlistName = extractNamedNeteasePlaylist(message)
      return {
        skill: 'play_named_netease_playlist',
        message: `好，我去播放你的网易云歌单《${playlistName}》。`,
        actions: [{ type: 'music.play_netease_playlist', payload: { playlistName } }],
      }
    },
  },
  {
    name: 'build_playlist',
    description: 'Build a short recommendation queue for the current listening context.',
    matches: (message) => /歌单|播放列表|推荐.*(?:几首|几首歌|一组)|来.*(?:几首|一组)|(?:适合|适宜).*(?:运动|跑步|健身|通勤|雨天|下雨|睡觉|睡前|助眠|放松|舒缓|解压|夜路|夜归|平静)|夜路回家|晚归|(?:心乱|吵架|难过|烦躁).*(?:歌|音乐)|(?:歌|音乐).*(?:平静|舒缓)/.test(String(message || '')),
    run: async ({ message }) => {
      const query = playlistSearchQuery(message)
      const setup = playlistSetupActions(message)
      const keepCurrentSong = /先别.*换歌|先不.*换歌|别急着换歌|不想换歌/.test(String(message || ''))
      return {
        skill: 'build_playlist',
        message: companionLeadIn(message, { query, keepCurrentSong }),
        actions: [...setup, query
          ? keepCurrentSong
            ? { type: 'music.prepare_queue', payload: { query, limit: 4 } }
            : { type: 'music.search_netease', payload: { query, queue: true, limit: 4 } }
          : { type: 'music.recommend', payload: { queue: true, limit: 4 } }],
      }
    },
  },
  {
    name: 'troubleshoot_playback',
    description: 'Inspect playback diagnostics and return safe recovery guidance.',
    matches: (message) => /播不了|播放.*(?:失败|卡住|没声音)|没有声音|音乐.*(?:卡|坏了)/.test(String(message || '')),
    run: async () => ({
      skill: 'troubleshoot_playback',
      message: '我先检查一下播放器状态，不会修改你的队列。',
      actions: [{ type: 'music.get_state', payload: { diagnostics: true } }],
    }),
  },
])

export function selectSkill(message, skills = yunSkills) {
  return skills.find((skill) => skill.matches?.(message)) || null
}
