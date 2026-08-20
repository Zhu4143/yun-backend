import { useEffect, useState } from 'react'
import { VoiceSessionController } from '../voice/VoiceSessionController.js'
import { createInitialVoiceState } from '../voice/VoiceStateMachine.js'
import { VoiceTelemetry } from '../voice/voiceTelemetry.js'
import { DEFAULT_VOICE_CONFIG } from '../voice/voiceConfig.js'

export function useVoiceSessionController({ config = DEFAULT_VOICE_CONFIG } = {}) {
  const [snapshot, setSnapshot] = useState(createInitialVoiceState)
  const [controller] = useState(() => {
    const telemetry = new VoiceTelemetry({ enabled: config.diagnostics.enabled })
    return new VoiceSessionController({ onStateChange: setSnapshot, telemetry })
  })

  useEffect(() => () => controller.endSession('component_unmounted'), [controller])

  return { controller, snapshot }
}
