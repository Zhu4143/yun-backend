import { useEffect, useMemo, useState } from 'react'
import { getSharedAudioCaptureManager } from '../voice/audio/AudioCaptureManager.js'

export function usePersistentAudioCapture({ enabled = false } = {}) {
  const manager = useMemo(() => getSharedAudioCaptureManager(), [])
  const [metrics, setMetrics] = useState(() => manager.getMetrics())

  useEffect(() => manager.subscribeMetrics(setMetrics), [manager])
  useEffect(() => {
    if (!enabled) return undefined
    manager.start().catch(() => {})
    // Do not stop on a conversation/TTS transition. This singleton is released
    // only by application teardown, device changes, or unrecoverable errors.
    return undefined
  }, [enabled, manager])

  return { manager, metrics }
}
