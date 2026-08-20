// Pure, framework-free telemetry decision helpers.
//
// Kept free of React / DOM / Node imports so the same rules can be exercised
// by unit tests and reused by the browser observers.

// Normalize a user command into a coarse semantic intent for repeat detection.
export function commandIntent(text) {
  const value = String(text || '')
  if (/下一首|下首|切歌|换一首|换首歌|换歌|下一曲|下一支|切到下一/.test(value)) return 'next'
  if (/上一首|上首|前一首|上一曲|回到上一/.test(value)) return 'previous'
  if (/暂停|先停|停一下|别放了|暂停播放|暂停音乐|停止播放/.test(value)) return 'pause'
  if (/继续|接着放|恢复播放|继续播放|继续听/.test(value)) return 'resume'
  if (/重播|重新播放|从头|再放一遍|再来一遍/.test(value)) return 'replay'
  if (/不要这首|不想听|换掉|跳过这首|别放|不放|太吵|不好听/.test(value)) return 'reject'
  if (/声音|音量|大点声|小点声|大声|小声|静音/.test(value)) return 'volume'
  return 'other'
}

// Compact a command for exact-normalized comparison.
export function compactCommand(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s，。！？、,.!?~…《》"'“”‘’()[\]{}【】（）\-_/\\|]/g, '')
}

// Decide whether two consecutive commands count as a repeat within a window.
export function shouldMarkRepeated({ prevText, prevAt, currentText, now, windowMs }) {
  if (!prevText || !currentText) return false
  if (now - prevAt >= windowMs) return false
  if (compactCommand(prevText) === compactCommand(currentText)) return true
  return commandIntent(prevText) === commandIntent(currentText)
}

// Classify an auto-advance (`lastAutoNextSong` changed) into its causal reason.
//
// `naturalEndPending` is true when the audio element actually fired `ended`
// (the song played to its natural end) before the auto-advance resolved.
//
// The auto-advance itself is always a real event: `playback.auto_advanced`.
// Its `reason` distinguishes "the previous song finished" from "the system
// skipped before the end". Natural completion is reported separately by
// `playback.play_ended_natural` from the `ended` listener.
export function autoAdvanceOutcome({ naturalEndPending, playbackMode }) {
  const endedNaturally = Boolean(naturalEndPending)
  return {
    reason: endedNaturally ? 'natural_end' : 'early_skip',
    recommendAccepted: playbackMode === 'ai_recommend' || playbackMode === 'companion_continue',
  }
}

// Classify a TTS `isSpeaking` transition into a lifecycle event.
//
// A speaking→silent transition is `completed` only when nothing else is
// starting. When the new utterance is already preparing (speakText internally
// called the raw stopSpeaking), or when stopSpeaking was explicitly called, the
// previous utterance was cut short and must be `interrupted`, never completed.
export function ttsTransitionOutcome({ prevIsSpeaking, isSpeaking, isPreparingSpeech, interrupted }) {
  if (!prevIsSpeaking && isSpeaking) return { type: 'tts.started' }
  if (prevIsSpeaking && !isSpeaking) {
    const replaced = Boolean(isPreparingSpeech)
    if (interrupted || replaced) {
      return { type: 'tts.interrupted', reason: replaced ? 'replaced' : 'interrupted' }
    }
    return { type: 'tts.completed', reason: 'completed' }
  }
  return null
}
