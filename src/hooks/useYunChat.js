import { useCallback, useMemo, useRef, useState } from 'react'
import { sendCompanionMessage } from '../api/companionApi'
import { requestSongReaction } from '../api/songReactionApi'
import { sendVisionMessage } from '../api/visionApi'
import { routeChatIntent } from '../services/chatIntentRouter'
import { createCompanionPlaybackPlan, executePlaybackPlan } from '../services/radioEngine'
import { createCommandObserver } from '../telemetry/commandObserver'

const observedRouteChatIntent = createCommandObserver(routeChatIntent)

const initialMessages = [
  { id: 'yun-welcome', role: 'assistant', content: '我在听，你可以慢慢说。' },
]
const PODCAST_AUTO_ANNOUNCEMENT_GAP_MS = 75_000

function createMessage(role, content, extra = {}) {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
    ...extra,
  }
}

function shouldSpeakReply(reply, responseMode, options = {}) {
  if (!reply || options.skipTts) return false
  if (responseMode === 'silent') return false

  return true
}

function isFollowUpMessage(text) {
  const normalized = String(text || '').trim()
  return /^(详细描述一下|详细说说|展开说说|继续|继续说|接着说|然后呢|多说一点|说具体点|描述一下|展开一下)[。！？!?.\s]*$/.test(normalized)
}

function isPlaylistChoiceReply(text) {
  return /^(?:选|播放)?(?:第)?[1-5一二三四五][个首]?[。！？!]?$/i.test(String(text || '').replace(/\s/g, ''))
    || /^(?:取消|算了|不要了)[。！？!]?$/i.test(String(text || '').trim())
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

// Retained for compatibility with older persisted companion recommendation data.
void findRecommendedTrack
void findTrackFromReplyText

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
  const plan = createCompanionPlaybackPlan({
    response,
    userText,
    libraryTracks,
    responseMode: 'companion',
  })
  if (plan.action === 'none') return false

  const result = await executePlaybackPlan(plan, player)
  return result?.ok ? (plan.track || result.song || null) : null
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
  agent = null,
} = {}) {
  const [messages, setMessages] = useState(initialMessages)
  const [isThinking, setIsThinking] = useState(false)
  const [recentRecommendations, setRecentRecommendations] = useState([])
  const [playHistory, setPlayHistory] = useState([])
  const prefetchedSongReactionsRef = useRef(new Map())
  const lastPodcastAutoAnnouncementAtRef = useRef(0)
  const requestEpochRef = useRef(0)
  const requestBusyRef = useRef(false)
  const queuedLatestMessageRef = useRef(null)
  const pendingPlaylistSelectionRef = useRef(null)

  const rememberPlayedSong = useCallback((song) => {
    if (!song) return
    const id = String(song.providerId || song.id || '').trim()
    if (!id) return
    setPlayHistory((current) => {
      const next = [{ id, providerId: song.providerId, title: song.title, artist: song.artist }, ...current]
      return next.filter((item, index, array) => array.findIndex((candidate) => String(candidate.providerId || candidate.id || '') === id) === index).slice(0, 32)
    })
  }, [])

  const chatHistory = useMemo(
    () => messages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content,
      })),
    [messages],
  )

  const sendMessage = async (text, options = {}) => {
    const userText = String(text || '').trim()
    const imageFile = options?.imageFile || null

    if (!userText && !imageFile) return false

    if (requestBusyRef.current) {
      // Keep one latest turn only.  A new spoken command supersedes the
      // previous pending interpretation; it must never disappear silently.
      requestEpochRef.current += 1
      queuedLatestMessageRef.current = { text: userText, options: { ...options, imageFile, _alreadyQueued: true } }
      voice?.stopSpeaking?.()
      setMessages((current) => [...current, createMessage('user', imageFile ? `${userText}\n[图片：${imageFile.name}]` : userText)])
      return true
    }

    const requestEpoch = ++requestEpochRef.current
    const isCurrentRequest = () => requestEpoch === requestEpochRef.current
    requestBusyRef.current = true

    const displayText = userText || '请帮我看看这张截图'
    if (pendingPlaylistSelectionRef.current && !isPlaylistChoiceReply(displayText)) {
      pendingPlaylistSelectionRef.current = null
    }
    const recentHistoryWithUser = buildRecentHistory(chatHistory, displayText)
    const nextUserMessage = createMessage(
      'user',
      imageFile ? `${displayText}\n[图片：${imageFile.name}]` : displayText,
    )
    const recentAiReplies = chatHistory
      .filter((message) => message.role === 'assistant')
      .slice(-5)
      .map((message) => message.content)
    const questionCountWindow = recentAiReplies
      .slice(-3)
      .filter((reply) => /[?？]/.test(reply)).length

    voice?.stopSpeaking?.()
    if (!options._alreadyQueued) setMessages((current) => [...current, nextUserMessage])
    setIsThinking(true)

    try {
      if (imageFile) {
        const visionAnswer = await sendVisionMessage(imageFile, displayText)
        const visionUserText = [
          `用户发来一张图片，并说：${displayText}`,
          '下面是视觉模型对图片的客观识别结果。请你作为昀来回复用户：自然、温柔、清楚，不要说“视觉模型说”，不要暴露中间流程，也不要编造图片里没有的内容。',
          `图片识别结果：${visionAnswer || '没有识别出明确内容。'}`,
        ].join('\n')
        const response = await sendCompanionMessage({
          userText: visionUserText,
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
        if (!isCurrentRequest()) return false
        const decision = response.decision || {}
        const reply = response.reply || decision.reply || visionAnswer || '我看到了图片，但暂时没能提取出明确内容。'
        const skipTts = response.shouldSpeak === false || decision.shouldSpeak === false

        setMessages((current) => [
          ...current,
          createMessage('assistant', reply),
        ])

        if (shouldSpeakReply(reply, responseMode, { skipTts })) {
          voice?.speakText?.(reply, { allowBargeIn: true })
        }

        return
      }

    const routed = await observedRouteChatIntent({
        message: displayText,
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
        pendingPlaylistSelection: pendingPlaylistSelectionRef.current,
      })
      if (!isCurrentRequest()) return false

      if (routed.playlistSelection) pendingPlaylistSelectionRef.current = routed.playlistSelection
      else if (routed.playlistSelectionResolved) pendingPlaylistSelectionRef.current = null

    if (routed.handled) {
        if (routed.song) {
          rememberPlayedSong(routed.song)
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
          voice?.speakText?.(reply, { allowBargeIn: true })
        }

      return
    }

    // Deterministic music commands stay in routeChatIntent above. The agent is
    // reserved for multi-step intents and returns declarative actions executed
    // through PlayerCore in the renderer.
    if (agent?.run) {
      let agentReplyAnnounced = false
      const announceAgentReply = (agentResult) => {
        if (agentReplyAnnounced || !isCurrentRequest()) return
        agentReplyAnnounced = true
        const reply = agentResult.message || '我已经开始安排了。'
        setMessages((current) => [...current, createMessage('assistant', reply, {
          skillCandidate: agentResult.skillCandidate || null,
        })])
        if (shouldSpeakReply(reply, responseMode, { skipTts: agentResult.source === 'skill' && responseMode === 'silent' })) {
          void voice?.speakText?.(reply, { allowBargeIn: true })
        }
      }
      const agentResult = await agent.run(displayText, { isCurrentRequest, onPlan: announceAgentReply })
      if (!isCurrentRequest()) return false
      if (agentResult?.ok && (agentResult.actions?.length || agentResult.source === 'skill')) {
        announceAgentReply(agentResult)
        if (agentResult.analysisQueued && agent.waitForSkillCandidate) {
          void agent.waitForSkillCandidate(agentResult.startedAt).then((candidate) => {
            if (!candidate) return
            setMessages((current) => [...current, createMessage(
              'assistant',
              '我发现这类请求可以在下次更快完成，先给你做成一个候选快捷方式。',
              { skillCandidate: candidate },
            )])
          })
        }
        return
      }
    }

    const response = await sendCompanionMessage({
        userText: displayText,
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
      if (!isCurrentRequest()) return false

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
      }, displayText)

      if (Array.isArray(response.recommendations) && response.recommendations.length) {
        setRecentRecommendations((current) => [
          ...response.recommendations.slice(0, 3),
          ...current,
        ].slice(0, 10))
      }

      if (shouldSpeakReply(reply, responseMode, { skipTts })) {
        voice?.speakText?.(reply, { allowBargeIn: true })
      }

      if (responseMode === 'companion') {
        const playedTrack = await executeCompanionDecision({
          userText: displayText,
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
      if (!isCurrentRequest()) return false
      const reply = error instanceof Error && error.message
        ? `我刚才有点卡住了：${error.message}`
        : '我刚才有点卡住了。你再说一遍，我听着。'

      setMessages((current) => [
        ...current,
        createMessage('assistant', reply),
      ])
    } finally {
      if (isCurrentRequest()) setIsThinking(false)
      const queued = queuedLatestMessageRef.current
      requestBusyRef.current = false
      if (queued && requestEpoch !== requestEpochRef.current) {
        queuedLatestMessageRef.current = null
        window.setTimeout(() => sendMessage(queued.text, queued.options), 0)
      }
    }
  }

  const reactToSongChange = useCallback(async (song, trigger = 'play') => {
    if (!song || responseMode !== 'podcast') {
      return false
    }

    if (trigger === 'auto_next' && Date.now() - lastPodcastAutoAnnouncementAtRef.current < PODCAST_AUTO_ANNOUNCEMENT_GAP_MS) {
      return false
    }

    try {
      const recentAiReplies = chatHistory
        .filter((message) => message.role === 'assistant')
        .slice(-5)
        .map((message) => message.content)
      const cacheKey = String(song.id || `${song.title}-${song.artist}`)
      const cachedResponse = prefetchedSongReactionsRef.current.get(cacheKey)
      prefetchedSongReactionsRef.current.delete(cacheKey)
      const response = cachedResponse || await requestSongReaction({
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

      if (trigger === 'auto_next') lastPodcastAutoAnnouncementAtRef.current = Date.now()

      setMessages((current) => [
        ...current,
        createMessage('assistant', reply),
      ])

      if (response.shouldSpeak !== false && shouldSpeakReply(reply, responseMode)) {
        // Radio transitions are one-way announcements. Do not arm the
        // microphone interruption detector here: it can hear the speakers and
        // mistakenly start a companion call on every automatic track change.
        voice?.speakText?.(reply, { allowBargeIn: false })
      }

      return true
    } catch {
      return false
    }
  }, [chatHistory, personaMode, responseMode, voice])

  const prefetchSongReaction = useCallback(async (song, trigger = 'auto_next') => {
    if (!song || responseMode !== 'podcast') return false
    const cacheKey = String(song.id || `${song.title}-${song.artist}`)
    if (prefetchedSongReactionsRef.current.has(cacheKey)) return true

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
      prefetchedSongReactionsRef.current.set(cacheKey, response)
      if (prefetchedSongReactionsRef.current.size > 3) {
        const oldestKey = prefetchedSongReactionsRef.current.keys().next().value
        prefetchedSongReactionsRef.current.delete(oldestKey)
      }
      return true
    } catch {
      return false
    }
  }, [chatHistory, personaMode, responseMode])

  const resolveSkillCandidate = useCallback(async (candidateId, decision) => {
    if (!agent?.decideSkillCandidate) return { ok: false }
    const result = await agent.decideSkillCandidate(candidateId, decision)
    if (!result?.id) return result
    setMessages((current) => current.map((message) => (
      message.skillCandidate?.id === candidateId
        ? { ...message, skillCandidate: { ...message.skillCandidate, status: result.status } }
        : message
    )))
    return result
  }, [agent])

  const appendRemoteTurn = useCallback(({ message, reply, sender = '微信' } = {}) => {
    const text = String(message || '').trim()
    const answer = String(reply || '').trim()
    if (!text && !answer) return
    setMessages((current) => [
      ...current,
      ...(text ? [createMessage('user', `${sender} · ${text}`, { source: 'cowagent' })] : []),
      ...(answer ? [createMessage('assistant', answer, { source: 'cowagent' })] : []),
    ])
  }, [])

  return {
    messages,
    isThinking,
    playHistory,
    recentRecommendations,
    sendMessage,
    reactToSongChange,
    prefetchSongReaction,
    rememberPlayedSong,
    resolveSkillCandidate,
    appendRemoteTurn,
  }
}
