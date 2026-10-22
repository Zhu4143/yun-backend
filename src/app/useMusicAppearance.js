import { useSyncExternalStore } from 'react'
import { getMusicAppearanceStore } from './appearance.js'

export function useMusicAppearance() {
  const store = getMusicAppearanceStore()
  const appearance = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return { ...appearance, setMode: store.setMode }
}
