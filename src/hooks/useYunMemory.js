import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchDefaultUserMemory,
  fetchYunMemory,
  fetchYunSettings,
  resetYunMemory,
  saveYunSettings,
} from '../api/memoryApi'

const COMPANION_MEMORY_KEY = 'yun_companion_memory'
const USER_MEMORY_KEY = 'yun_user_memory'
const MEMORY_ENABLED_KEY = 'yun_memory_enabled'

const memoryModeCopy = {
  off: '安静模式：昀不会主动使用长期记忆。',
  smart: '自然记得：昀会在需要时想起长期记忆。',
  deep: '认真陪你：昀会更主动结合过往记忆陪你聊天。',
}

const memoryModeLabels = {
  off: '安静模式',
  smart: '自然记得',
  deep: '认真陪你',
}

function createEmptyRecentMemory() {
  return {
    recentTalkTopics: [],
    recentEmotionalThemes: [],
    lastHelpfulSong: '',
    dislikedTone: [],
    comfortPreference: [],
    lastCompanionModeState: '',
  }
}

function readJsonStorage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') || fallback
  } catch {
    return fallback
  }
}

function normalizeRecentMemory(memory = {}) {
  return {
    recentTalkTopics: (memory.recentTalkTopics || memory.recentTopics || []).slice(-8),
    recentEmotionalThemes: (memory.recentEmotionalThemes || memory.recentEmotions || []).slice(-10),
    lastHelpfulSong: memory.lastHelpfulSong || '',
    dislikedTone: (memory.dislikedTone || []).slice(-6),
    comfortPreference: (memory.comfortPreference || []).slice(-8),
    lastCompanionModeState: memory.lastCompanionModeState || memory.companionState || '',
  }
}

function compactUserMemory(userMemory, companionMemory, memoryEnabled) {
  if (!memoryEnabled) return null

  return {
    userProfile: userMemory?.userProfile || {},
    communicationPreference: userMemory?.communicationPreference || {},
    creativeProjects: userMemory?.creativeProjects || {},
    emotionalContext: userMemory?.emotionalContext || {},
    musicCompanionPersonalityDesign: userMemory?.musicCompanionPersonalityDesign || {},
    memoryRules: userMemory?.memoryRules || {},
    companionSystemNote: userMemory?.companionSystemNote || '',
    recentMemory: companionMemory,
  }
}

function buildSummary({ userMemory, companionMemory, memoryEnabled, memoryMode, status }) {
  if (status === 'loading') return '记忆摘要加载中...'
  if (!memoryEnabled) return '本地记忆已关闭，AI 不会读取默认记忆和近期记忆。'

  const name = userMemory?.userProfile?.preferredName || userMemory?.userProfile?.name || '未加载'
  const topics = (companionMemory.recentTalkTopics || []).slice(-2).join('、') || '暂无'
  const emotions = (companionMemory.recentEmotionalThemes || []).slice(-2).join('、') || '暂无'
  const preference = (companionMemory.comfortPreference || []).slice(-1)[0] || '默认熟人式陪伴'

  return `默认记忆：${name} · 模式：${memoryModeLabels[memoryMode] || '自然记得'} · 近期话题：${topics} · 情绪：${emotions} · 陪伴：${preference}`
}

export function useYunMemory() {
  const [memoryEnabled, setMemoryEnabledState] = useState(() => localStorage.getItem(MEMORY_ENABLED_KEY) !== 'false')
  const [memoryMode, setMemoryModeState] = useState('smart')
  const [userMemory, setUserMemory] = useState(() => readJsonStorage(USER_MEMORY_KEY, null))
  const [companionMemory, setCompanionMemoryState] = useState(() =>
    normalizeRecentMemory(readJsonStorage(COMPANION_MEMORY_KEY, createEmptyRecentMemory())),
  )
  const [longTermMemory, setLongTermMemory] = useState(null)
  const [status, setStatus] = useState('loading')

  const saveCompanionMemory = useCallback((memory) => {
    const normalized = normalizeRecentMemory(memory)
    setCompanionMemoryState(normalized)
    localStorage.setItem(COMPANION_MEMORY_KEY, JSON.stringify(normalized))
    return normalized
  }, [])

  const reloadDefaultMemory = useCallback(async () => {
    const data = await fetchDefaultUserMemory()
    const recentMemory = normalizeRecentMemory(data.recentMemory || createEmptyRecentMemory())

    setUserMemory(data)
    localStorage.setItem(USER_MEMORY_KEY, JSON.stringify(data))
    saveCompanionMemory(recentMemory)
    return data
  }, [saveCompanionMemory])

  useEffect(() => {
    let cancelled = false

    async function loadMemory() {
      setStatus('loading')
      try {
        const [settings, serverMemory] = await Promise.all([
          fetchYunSettings().catch(() => ({ memoryMode: 'smart' })),
          fetchYunMemory().catch(() => null),
        ])

        if (cancelled) return
        if (['off', 'smart', 'deep'].includes(settings.memoryMode)) {
          setMemoryModeState(settings.memoryMode)
        }
        setLongTermMemory(serverMemory)

        if (!userMemory) {
          await reloadDefaultMemory()
        }

        if (!cancelled) setStatus('ready')
      } catch {
        if (!cancelled) setStatus('error')
      }
    }

    loadMemory()

    return () => {
      cancelled = true
    }
  }, [reloadDefaultMemory, userMemory])

  const setMemoryEnabled = useCallback((enabled) => {
    setMemoryEnabledState(Boolean(enabled))
    localStorage.setItem(MEMORY_ENABLED_KEY, String(Boolean(enabled)))
  }, [])

  const setMemoryMode = useCallback(async (mode) => {
    if (!['off', 'smart', 'deep'].includes(mode)) return

    setMemoryModeState(mode)
    try {
      const settings = await saveYunSettings({ memoryMode: mode })
      if (['off', 'smart', 'deep'].includes(settings.memoryMode)) {
        setMemoryModeState(settings.memoryMode)
      }
    } catch {
      setStatus('error')
    }
  }, [])

  const clearRecentMemory = useCallback(() => {
    saveCompanionMemory(createEmptyRecentMemory())
  }, [saveCompanionMemory])

  const resetDefaultMemory = useCallback(async () => {
    await reloadDefaultMemory()
    const serverMemory = await resetYunMemory().catch(() => null)
    if (serverMemory) setLongTermMemory(serverMemory)
  }, [reloadDefaultMemory])

  const updateCompanionMemory = useCallback((patch = {}, userText = '') => {
    const next = {
      ...createEmptyRecentMemory(),
      ...companionMemory,
    }

    if (patch.recentTopic) next.recentTalkTopics.push(String(patch.recentTopic).slice(0, 80))
    if (patch.recentEmotion) next.recentEmotionalThemes.push(String(patch.recentEmotion).slice(0, 40))
    if (patch.likedVibe) next.comfortPreference.push(String(patch.likedVibe).slice(0, 80))
    if (patch.effectiveSongNote) next.lastHelpfulSong = String(patch.effectiveSongNote).slice(0, 100)
    if (patch.keyMemory) next.recentTalkTopics.push(String(patch.keyMemory).slice(0, 100))
    if (patch.companionState) next.lastCompanionModeState = String(patch.companionState).slice(0, 60)

    if (/别问了|不想说|别追问|不要问/.test(userText)) {
      next.dislikedTone.push('不喜欢被连续追问')
      next.comfortPreference.push('情绪低时少问，多安静陪伴')
    }
    if (/想起以前|以前的人|怀旧|过去/.test(userText)) {
      next.recentEmotionalThemes.push('怀旧', '过去的关系', '听歌触发回忆')
    }
    if (/正常聊天|别一直推荐|不是让你一直推荐/.test(userText)) {
      next.dislikedTone.push('不喜欢被强行推荐音乐')
      next.comfortPreference.push('想正常聊天时不要把话题都拉回歌曲')
    }

    return saveCompanionMemory(next)
  }, [companionMemory, saveCompanionMemory])

  const memoryContext = useMemo(
    () => compactUserMemory(userMemory, companionMemory, memoryEnabled),
    [companionMemory, memoryEnabled, userMemory],
  )

  const summary = useMemo(
    () => buildSummary({ userMemory, companionMemory, memoryEnabled, memoryMode, status }),
    [companionMemory, memoryEnabled, memoryMode, status, userMemory],
  )

  return {
    memoryEnabled,
    memoryMode,
    memoryModeCopy,
    memoryContext,
    userMemory,
    companionMemory,
    longTermMemory,
    status,
    summary,
    setMemoryEnabled,
    setMemoryMode,
    clearRecentMemory,
    resetDefaultMemory,
    updateCompanionMemory,
    openLongTermMemory: () => window.open('/api/yun-memory', '_blank'),
  }
}
