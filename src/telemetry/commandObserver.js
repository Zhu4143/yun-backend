// Non-invasive wrapper over `routeChatIntent`.
//
// It observes command entry/exit without changing the router's behavior: the
// wrapped function returns exactly the same value (or rethrows exactly the
// same error) as the original.
//
// Privacy: raw user text is never persisted by default. Events carry only
// intent / length / success metadata; a truncated copy is added only when the
// debug-text flag is explicitly enabled.

import emitter, { textField } from './emitter.js'
import { commandIntent, shouldMarkRepeated } from './logic.js'

const REPEAT_WINDOW_MS = 5000
const CORRECTION_PATTERN = /我说的是|我说得是|不是这个|不是这首|刚刚说的是|刚才说的是|更正|纠正/
const REPLAY_PATTERN = /重新播放|重播|从头播放|从头放|再放一遍|再来一遍/
const REJECT_PATTERN = /不要这首|不想听这个|别放这个|换掉它|跳过这首|我不要|不想听|别放|不放|太吵|不好听/

function safeEmit(telemetry, type, payload, opts) {
  try {
    telemetry.emit(type, payload, opts)
  } catch {
    // noop
  }
}

export function createCommandObserver(routeChatIntent, telemetry = emitter) {
  let prevText = ''
  let prevAt = 0

  return async function observedRouteChatIntent(params = {}) {
    const message = String(params.message || '')
    const now = Date.now()

    safeEmit(
      telemetry,
      'command.received',
      { ...textField(message) },
      { domain: 'command', actor: 'user', source: 'voice_or_text' },
    )

    if (shouldMarkRepeated({ prevText, prevAt, currentText: message, now, windowMs: REPEAT_WINDOW_MS })) {
      safeEmit(
        telemetry,
        'command.repeated',
        { ...textField(message), intent: commandIntent(message) },
        { domain: 'command', actor: 'user' },
      )
    }
    prevText = message
    prevAt = now

    if (CORRECTION_PATTERN.test(message)) {
      safeEmit(
        telemetry,
        'command.corrected',
        { ...textField(message), intent: 'correction' },
        { domain: 'command', actor: 'user' },
      )
    }
    if (REPLAY_PATTERN.test(message)) {
      safeEmit(
        telemetry,
        'playback.replay',
        { ...textField(message), intent: 'replay' },
        { domain: 'playback', actor: 'user', source: 'command' },
      )
    }

    let result
    try {
      result = await routeChatIntent(params)
    } catch (error) {
      safeEmit(
        telemetry,
        'command.failed',
        { ...textField(message), error: error instanceof Error ? error.message : String(error) },
        { domain: 'command', actor: 'system' },
      )
      throw error
    }

    if (result?.handled) {
      safeEmit(
        telemetry,
        'command.handled',
        { ...textField(message), success: true },
        { domain: 'command', actor: 'system' },
      )
      if (REJECT_PATTERN.test(message)) {
        safeEmit(
          telemetry,
          'recommendation.rejected',
          { ...textField(message), intent: 'reject' },
          { domain: 'recommendation', actor: 'user' },
        )
      }
    } else {
      safeEmit(
        telemetry,
        'command.unhandled',
        { ...textField(message), success: false },
        { domain: 'command', actor: 'system' },
      )
    }

    return result
  }
}
