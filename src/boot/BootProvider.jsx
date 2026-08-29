import { useEffect, useSyncExternalStore } from 'react'

import { BootGate } from './BootGate.js'
import { YunBootScreen } from './YunBootScreen.jsx'

export function BootProvider({ manager, children }) {
  const state = useSyncExternalStore(manager.subscribe, manager.getState, manager.getState)

  useEffect(() => {
    manager.start()
  }, [manager])

  return (
    <BootGate
      state={state}
      renderApp={() => children(state)}
      renderBootScreen={() => <YunBootScreen state={state} onRetry={manager.retry} />}
    />
  )
}
