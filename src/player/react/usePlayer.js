import { useContext, useSyncExternalStore } from 'react'
import { PlayerContext } from './PlayerContext.js'

export function usePlayer(coreOverride = null) {
  const contextCore = useContext(PlayerContext)
  const core = coreOverride || contextCore

  if (!core) {
    throw new Error('usePlayer must be used with a PlayerProvider or a PlayerCore override')
  }

  return useSyncExternalStore(core.subscribe, core.getState, core.getState)
}

export function usePlayerCore() {
  const core = useContext(PlayerContext)

  if (!core) {
    throw new Error('usePlayerCore must be used within PlayerProvider')
  }

  return core
}
