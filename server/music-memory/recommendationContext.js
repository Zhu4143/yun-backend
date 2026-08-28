const NEGATIVE_PREFERENCE_RE = /不喜欢|讨厌|避免|避开|不要|别再|以后别|太吵|太炸|高刺激|过度高能|\bavoid\b|\bdislike\b|\bnegative\b/i
const BEDTIME_HABIT_RE = /睡前|睡觉前|入睡|每晚|晚上睡觉/
const SLEEP_CONTEXT_RE = /睡了|睡觉|睡前|入睡|晚安|困了/
const SESSION_MOOD_RE = /(?:今天|今晚|现在|这会儿|刚刚).{0,16}(?:想听|听点|来点|要听).{0,16}(?:安静|平静|放松|低刺激|舒缓|轻柔)/

function boundedUnique(values = [], limit = 8) {
  const seen = new Set()
  const result = []
  for (const value of values) {
    const text = String(value || '').trim().slice(0, 240)
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text)
    if (result.length >= limit) break
  }
  return result
}

function userSessionMessages(recentChat = []) {
  return boundedUnique((Array.isArray(recentChat) ? recentChat : []).flatMap((entry) => {
    if (typeof entry === 'string') return [entry]
    if (!entry || entry.role === 'assistant') return []
    return [entry.content || entry.text || entry.message]
  }).filter((text) => SESSION_MOOD_RE.test(String(text || ''))), 4)
}

export function buildMusicRecommendationMemoryContext({ userText = '', musicPreferences = [], recentChat = [] } = {}) {
  const preferences = boundedUnique(musicPreferences)
  const avoidPreferences = preferences.filter((preference) => NEGATIVE_PREFERENCE_RE.test(preference))
  const sceneHabits = preferences.filter((preference) => !NEGATIVE_PREFERENCE_RE.test(preference) && BEDTIME_HABIT_RE.test(preference))
  const positivePreferences = preferences.filter((preference) => !avoidPreferences.includes(preference) && !sceneHabits.includes(preference))
  const sessionScopedPreferences = userSessionMessages(recentChat)
  const bedtimeHabitMatched = SLEEP_CONTEXT_RE.test(String(userText)) && sceneHabits.length > 0
  const sections = [
    'MUSIC RECOMMENDATION MEMORY：只使用下列真实 fixture/已存记忆，不得编造其他历史偏好。',
    `当前请求：${String(userText || '').trim().slice(0, 300) || '无'}`,
    positivePreferences.length ? `长期正向偏好：${positivePreferences.join('；')}` : '',
    avoidPreferences.length ? `长期避开项（硬约束，不得被当前请求覆盖）：${avoidPreferences.join('；')}` : '',
    sceneHabits.length ? `长期场景习惯：${sceneHabits.join('；')}` : '',
    sessionScopedPreferences.length ? `当前会话临时需求（仅本会话有效，不得视为长期 music_taste）：${sessionScopedPreferences.join('；')}` : '',
    bedtimeHabitMatched ? '睡前习惯已命中：本次优先安静、放松、低刺激，并避免突然高能。' : '',
    positivePreferences.length ? '开放式选歌时优先考虑长期正向偏好，不要表现为完全随机。' : '',
    avoidPreferences.length ? '合并当前请求与偏好时必须保留全部避开项；有情绪不等于高刺激。' : '',
  ].filter(Boolean)
  return {
    available: positivePreferences.length > 0 || avoidPreferences.length > 0 || sceneHabits.length > 0 || sessionScopedPreferences.length > 0,
    positivePreferences,
    avoidPreferences,
    sceneHabits,
    sessionScopedPreferences,
    bedtimeHabitMatched,
    prompt: sections.join('\n'),
  }
}
