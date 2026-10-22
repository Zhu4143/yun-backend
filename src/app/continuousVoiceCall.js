export function normalizeCompanionTranscript(value) {
  const text = String(value || '').trim().replace(/^(?:小昀|小云|晓云|小韵|小芸|小允|老赢|角蝇)[，,、\s]*/i, '')
  return /[\p{L}\p{N}]/u.test(text) ? text : ''
}

export function isCompanionCallEnd(value) {
  const text = normalizeCompanionTranscript(value).replace(/[\s，。！？、,.!?~…]/g, '')
  return /^(没事了|不用了|先这样|挂了吧|结束对话|结束语音|停止陪聊)(小昀|小云|晓云|小韵)?$/.test(text)
}

// This only owns explicit call consent and delayed reopening. The existing
// VoiceSessionController and shared capture manager remain the turn owners.
export function createContinuousVoiceCall({ schedule = setTimeout, cancel = clearTimeout } = {}) {
  let active = false
  let version = 0
  let timer = null
  const clearResume = () => {
    if (timer !== null) cancel(timer)
    timer = null
  }
  return {
    isActive: () => active,
    isCurrent: (token) => active && token === version,
    start() {
      clearResume()
      active = true
      return ++version
    },
    stop() {
      clearResume()
      active = false
      version += 1
    },
    clearResume,
    resumeAfter({ busy = false, lastSpeechEndedAt = 0, now = Date.now() } = {}, onResume) {
      clearResume()
      if (!active || busy) return
      const token = version
      const delay = Math.max(400, Number(lastSpeechEndedAt || 0) + 950 - now)
      timer = schedule(() => {
        timer = null
        if (active && token === version) onResume(token)
      }, delay)
    },
  }
}
