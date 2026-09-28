import { useEffect, useMemo, useState } from 'react'
import { getSharedAudioCaptureManager } from '../voice/audio/AudioCaptureManager.js'

export function usePersistentAudioCapture() {
  const manager = useMemo(() => getSharedAudioCaptureManager(), [])
  const [metrics, setMetrics] = useState(() => manager.getMetrics())

  useEffect(() => manager.subscribeMetrics(setMetrics), [manager])

  return { manager, metrics }
}
