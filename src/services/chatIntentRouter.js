import { requestSmartMusicCommand } from '../api/smartMusicApi'
import { searchNeteaseSongs } from '../api/neteaseApi'

function compactText(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s，。！？、,.!?~…《》"'“”‘’()[\]{}【】（）\-_/\\|]/g, '')
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
  if (!/(网易云|在线|网上|搜索|搜一下|找一下|找首|找歌|点歌|播放|放一首|来一首|想听|我要听)/.test(raw)) {
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

async function playNeteaseFromMessage(message, player, responseMode) {
  const query = extractOnlineMusicQuery(message)
  if (!query) return { handled: false }

  const songs = await searchNeteaseSongs(query, { limit: 5 })
  const track = songs[0]

  if (!track) {
    return {
      handled: true,
      reply: responseMode === 'silent' ? '...' : `我去网易云找了，但暂时没找到能播放的「${query}」。`,
      skipTts: responseMode === 'silent',
    }
  }

  const result = await player.playSong(track)

  return {
    handled: true,
    reply: responseMode === 'silent'
      ? '...'
      : result?.ok
        ? `找到了，网易云上先给你放「${track.title}」。`
        : `找到了「${track.title}」，但这首现在播不起来。`,
    song: result?.ok ? track : null,
    songReactionTrigger: 'user_play',
    skipTts: responseMode === 'silent',
  }
}

function detectHardMusicCommand(message) {
  const text = compactText(message)

  if (/^(下一首|下首|切歌|换一首|换歌)(吧|呀|呢|一下)?$/.test(text)) return 'next'
  if (/^(上一首|上首|前一首|上一曲)(吧|呀|呢|一下)?$/.test(text)) return 'previous'
  if (/^(暂停|停一下|先停|别放了|暂停一下)(吧|呀|呢)?$/.test(text)) return 'pause'
  if (/^(继续|继续播放|接着放|接着听|恢复播放)(吧|呀|呢)?$/.test(text)) return 'resume'
  if (/^(重新播放|重播|从头播放|从头放|再放一遍)(吧|呀|呢)?$/.test(text)) return 'replay'

  return null
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
  return /播放|放一首|来一首|想听|要听|听一下|听听|听这首|听那首|听歌|找歌|搜索|有没有|本地|换一首|换过去|切过去|下一首|上一首|歌手|歌名|随机来|随便来|推荐一首|给我放|帮我放|你来选|帮我选/.test(message)
}

function hasNaturalPlayIntent(message) {
  return /想听|要听|听一下|听听|听这首|听那首|放给我|给我放|帮我放|来点|来首|来一首|换成|换到|切到|播放/.test(message)
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
      podcast: '好，我切到下一首。让这段氛围往前走一点。',
      companion: '嗯，给你换一首。',
    },
    previous: {
      normal: '好，上一首。',
      podcast: '好，我带你回到上一首，像把刚才那段情绪倒回去一点。',
      companion: '嗯，回到上一首。',
    },
    pause: {
      normal: '好，先暂停。',
      podcast: '好，先把音乐停在这里，留一点安静给你。',
      companion: '好，先停一下。',
    },
    resume: {
      normal: '好，继续放。',
      podcast: '好，音乐继续，让刚才的气氛接上。',
      companion: '嗯，继续放给你听。',
    },
    replay: {
      normal: '好，从头再听。',
      podcast: '好，这首从头再来一遍，像重新走进同一个场景。',
      companion: '好，我们从头再听一遍。',
    },
    confirm: {
      normal: '好，就这首。',
      podcast: '好，那就这首。我放给你听。',
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
    const result = await player.playNext()
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
    const result = await player.playPrevious()
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
    player.pausePlayback?.()
    return { handled: true, ...modeReply(responseMode, 'pause') }
  }

  if (action === 'resume') {
    const result = player.currentSong
      ? await player.playSong(player.currentSong)
      : await player.togglePlayPause()

    return {
      handled: true,
      ...(result?.ok
        ? modeReply(responseMode, 'resume')
        : { reply: '还没有可以继续播放的歌。', skipTts: responseMode === 'silent' }),
    }
  }

  if (action === 'replay') {
    if (!player.currentSong) {
      return { handled: true, reply: '还没有正在播放的歌。', skipTts: responseMode === 'silent' }
    }

    player.seekTo(0)
    await player.playSong(player.currentSong)
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

    const result = await player.playSong(track)

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

export async function routeChatIntent({
  message,
  chatHistory = [],
  currentSong = null,
  libraryTracks = [],
  player,
  responseMode = 'companion',
  persona = 'warm',
  musicSource = 'local',
  memory = null,
  playHistory = [],
  rejectedTracks = [],
  recentRecommendations = [],
}) {
  const hardAction = detectHardMusicCommand(message)

  if (hardAction) return executeHardCommand(hardAction, player, responseMode)

  if (musicSource === 'netease' && !isSpecificSongQuestion(message) && (hasExplicitMusicAction(message) || hasNaturalPlayIntent(message))) {
    const onlineResult = await playNeteaseFromMessage(message, player, responseMode)
    if (onlineResult.handled) return onlineResult
  }

  const directMentionedTrack = findLocalTrackFromText(message, libraryTracks)
  if (directMentionedTrack && !isSpecificSongQuestion(message) && (hasExplicitMusicAction(message) || hasNaturalPlayIntent(message))) {
    const result = await player.playSong(directMentionedTrack)

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
    const onlineResult = await playNeteaseFromMessage(message, player, responseMode)
    if (onlineResult.handled) return onlineResult
  }

  if (detectRecommendationConfirm(message) || /换过去|切过去|刚才那首|之前那首|那就这个|就这个/.test(message)) {
    const confirmedTrack = findLastMentionedTrack(chatHistory, libraryTracks)
      || findRememberedTrack(message, memory, libraryTracks)

    if (confirmedTrack) {
      const result = await player.playSong(confirmedTrack)

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

  if (!shouldAskSmartMusicCommand(message)) return { handled: false }

  const smartResult = await requestSmartMusicCommand({
    message,
    chatHistory,
    currentSong,
    responseMode,
    persona,
    playHistory,
    rejectedTracks,
    recentRecommendations,
  })

  return executeSmartMusicResult({ smartResult, libraryTracks, player, responseMode })
}
