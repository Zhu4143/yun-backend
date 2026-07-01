import { useCallback, useMemo, useState } from 'react'
import { sendCompanionMessage } from '../api/companionApi'
import { requestSongReaction } from '../api/songReactionApi'
import { routeChatIntent } from '../services/chatIntentRouter'

const initialMessages = [
  { id: 'yun-welcome', role: 'assistant', content: '我在听，你可以慢慢说。' },
]

function createMessage(role, content) {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
  }
}

function shouldSpeakReply(reply, responseMode, options = {}) {
  if (!reply || options.skipTts) return false
  if (responseMode === 'silent') return false

  return true
}

function isExplicitAutoPlayRequest(text) {
  return /你来选|帮我放|放一首|不知道听什么|随便来|随便放|给我放/.test(text)
}

function isFollowUpMessage(text) {
  const normalized = String(text || '').trim()
  return /^(详细描述一下|详细说说|展开说说|继续|继续说|接着说|然后呢|多说一点|说具体点|描述一下|展开一下)[。！？!?.\s]*$/.test(normalized)
}

function compactText(text) {
  return String(text || '').replace(/[\s，。！？、,.!?~…《》]/g, '').toLowerCase()
}

function findRecommendedTrack(recommendations, libraryTracks) {
  const candidates = Array.isArray(recommendations) ? recommendations : []

  for (const item of candidates) {
    const song = item?.song || item

    if (!song) continue

    const byId = song.id
      ? libraryTracks.find((track) => track.id === song.id)
      : null

    if (byId) return byId

    const songTitle = compactText(song.title)
    const songArtist = compactText(song.artist)
    const byTitle = libraryTracks.find((track) => {
      const trackTitle = compactText(track.title)
      const trackArtist = compactText(track.artist)

      return trackTitle === songTitle && (!songArtist || trackArtist === songArtist)
    })

    if (byTitle) return byTitle
    if (song.fileUrl) return song
  }

  return null
}

function findTrackFromReplyText(reply, libraryTracks) {
  const titles = [...String(reply || '').matchAll(/《([^》]+)》/g)].map((match) => match[1])

  for (const title of titles) {
    const compactTitle = compactText(title)
    const track = libraryTracks.find((song) => {
      const trackTitle = compactText(song.title)
      const trackFile = compactText(song.filename || '')

      return trackTitle === compactTitle || trackTitle.includes(compactTitle) || trackFile.includes(compactTitle)
    })

    if (track) return track
  }

  return null
}

function buildRecentHistory(chatHistory, userText) {
  const recent = [...chatHistory, { role: 'user', content: userText }].slice(-8)

  if (!isFollowUpMessage(userText)) {
    return recent
  }

  const lastAssistant = [...chatHistory].reverse().find((message) => message.role === 'assistant')?.content || ''
  const lastUser = [...chatHistory].reverse().find((message) => message.role === 'user')?.content || ''
  const contextNote = [
    '【上下文续接提示】用户这句话是在要求你延续上一轮对话，不是开启新话题。',
    lastUser ? `上一条用户消息：${lastUser}` : '',
    lastAssistant ? `上一条昀的回复：${lastAssistant}` : '',
    '请直接围绕上一轮内容展开回答。不要反问“你问的是谁/什么”。',
  ].filter(Boolean).join('\n')

  return [
    { role: 'assistant', content: contextNote },
    ...recent,
  ].slice(-8)
}

async function executeCompanionDecision({
  userText,
  response,
  libraryTracks,
  player,
}) {
  const decision = response?.decision || {}
  const recommendations = Array.isArray(response?.recommendations) ? response.recommendations : []
  const action = decision.musicAction

  if (!['next_song', 'suggest_song'].includes(action)) {
    return false
  }

  if (action === 'suggest_song' && !isExplicitAutoPlayRequest(userText)) {
    return false
  }

  const pickedTrack = findRecommendedTrack(recommendations, libraryTracks)
    || findTrackFromReplyText(response?.reply, libraryTracks)

  if (!pickedTrack && action === 'next_song') {
    const result = await player.playNext?.()
    return result?.ok ? result.song : null
  }

  if (!pickedTrack) {
    return false
  }

  const result = await player.playSong?.(pickedTrack)
  return result?.ok ? pickedTrack : null
}

export function useYunChat({
  currentSong = null,
  libraryTracks = [],
  player = {},
  voice = null,
  responseMode = 'companion',
  personaMode = 'warm',
  musicSource = 'local',
  memory = null,
} = {}) {
  const [messages, setMessages] = useState(initialMessages)
  const [isThinking, setIsThinking] = useState(false)
  const [recentRecommendations, setRecentRecommendations] = useState([])
  const [playHistory, setPlayHistory] = useState([])

  const chatHistory = useMemo(
    () => messages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content,
      })),
    [messages],
  )

  const sendMessage = async (text) => {
    const userText = String(text || '').trim()

    if (!userText || isThinking) {
      return
    }

    const recentHistoryWithUser = buildRecentHistory(chatHistory, userText)
    const nextUserMessage = createMessage('user', userText)
    const recentAiReplies = chatHistory
      .filter((message) => message.role === 'assistant')
      .slice(-5)
      .map((message) => message.content)
    const questionCountWindow = recentAiReplies
      .slice(-3)
      .filter((reply) => /[?？]/.test(reply)).length

    voice?.stopSpeaking?.()
    setMessages((current) => [...current, nextUserMessage])
    setIsThinking(true)

    try {
      const routed = await routeChatIntent({
        message: userText,
        chatHistory: recentHistoryWithUser,
        currentSong,
        libraryTracks,
        player,
        responseMode,
        persona: personaMode,
        musicSource,
        memory,
        playHistory,
        rejectedTracks: [],
        recentRecommendations,
      })

      if (routed.handled) {
        if (routed.song) {
          setPlayHistory((current) => [
            { id: routed.song.id, title: routed.song.title, artist: routed.song.artist },
            ...current,
          ].slice(0, 10))
          setRecentRecommendations((current) => [
            { song: { id: routed.song.id, title: routed.song.title, artist: routed.song.artist } },
            ...current,
          ].slice(0, 10))
        }

        if (responseMode === 'podcast' && routed.songReactionTrigger && routed.song) {
          const reacted = await reactToSongChange(routed.song, routed.songReactionTrigger)

          if (reacted) {
            return
          }
        }

        const reply = routed.reply || (responseMode === 'silent' ? '...' : '好。')
        setMessages((current) => [
          ...current,
          createMessage('assistant', reply),
        ])

        if (shouldSpeakReply(reply, responseMode, routed)) {
          voice?.speakText?.(reply)
        }

        return
      }

      const response = await sendCompanionMessage({
        userText,
        chatHistory: recentHistoryWithUser,
        currentSong,
        responseMode,
        persona: personaMode,
        companionMemory: memory?.companionMemory || {},
        userMemory: memory?.memoryContext || null,
        memoryEnabled: memory?.memoryEnabled !== false,
        recentAiReplies,
        questionCountWindow,
        localTime: new Date().toLocaleString('zh-CN'),
        playHistory,
        rejectedTracks: [],
        recentRecommendations,
      })

      const decision = response.decision || {}
      const reply = response.reply || decision.reply || '嗯，我在。你慢慢说。'
      const skipTts = response.shouldSpeak === false || decision.shouldSpeak === false

      setMessages((current) => [
        ...current,
        createMessage('assistant', reply),
      ])

      memory?.updateCompanionMemory?.({
        ...(response.memoryPatch || {}),
        companionState: decision.companionState,
      }, userText)

      if (Array.isArray(response.recommendations) && response.recommendations.length) {
        setRecentRecommendations((current) => [
          ...response.recommendations.slice(0, 3),
          ...current,
        ].slice(0, 10))
      }

      if (shouldSpeakReply(reply, responseMode, { skipTts })) {
        voice?.speakText?.(reply)
      }

      if (responseMode === 'companion') {
        const playedTrack = await executeCompanionDecision({
          userText,
          response,
          libraryTracks,
          player,
        })

        if (playedTrack) {
          setPlayHistory((current) => [
            { id: playedTrack.id, title: playedTrack.title, artist: playedTrack.artist },
            ...current,
          ].slice(0, 10))
        }
      }
    } catch (error) {
      const reply = error instanceof Error && error.message
        ? `我刚才有点卡住了：${error.message}`
        : '我刚才有点卡住了。你再说一遍，我听着。'

      setMessages((current) => [
        ...current,
        createMessage('assistant', reply),
      ])
    } finally {
      setIsThinking(false)
    }
  }

  const reactToSongChange = useCallback(async (song, trigger = 'play') => {
    if (!song || responseMode !== 'podcast') {
      return false
    }

    try {
      const recentAiReplies = chatHistory
        .filter((message) => message.role === 'assistant')
        .slice(-5)
        .map((message) => message.content)
      const response = await requestSongReaction({
        song,
        trigger,
        responseMode,
        currentMood: '平静',
        personaMode,
        recentChat: chatHistory.slice(-6),
        recentAiReplies,
      })
      const reply = String(response.reply || '').trim()

      if (!reply || response.displayMessage === false) {
        return false
      }

      setMessages((current) => [
        ...current,
        createMessage('assistant', reply),
      ])

      if (response.shouldSpeak !== false && shouldSpeakReply(reply, responseMode)) {
        voice?.speakText?.(reply)
      }

      return true
    } catch {
      return false
    }
  }, [chatHistory, personaMode, responseMode, voice])

  return {
    messages,
    isThinking,
    sendMessage,
    reactToSongChange,
  }
}
