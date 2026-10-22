export const APPEARANCE_STORAGE_KEY = 'yun_music_appearance'
const normalize = mode => ['light', 'dark', 'system'].includes(mode) ? mode : 'light'
export const resolveAppearance = (mode, systemDark) => mode === 'system' ? (systemDark ? 'dark' : 'light') : normalize(mode)

export function createAppearanceStore({ read, write, systemDark, onSystemChange, onStorageChange, apply }) {
  let mode = 'light'
  try { mode = normalize(read()) } catch { /* A blocked store still permits a session preference. */ }
  let snapshot = { mode, theme: resolveAppearance(mode, systemDark()) }, cleanups = []
  const listeners = new Set()
  apply(snapshot.theme)
  function publish(nextMode) {
    const next = { mode: normalize(nextMode), theme: resolveAppearance(normalize(nextMode), systemDark()) }
    if (next.mode === snapshot.mode && next.theme === snapshot.theme) return
    snapshot = next; apply(next.theme)
    for (const listener of listeners) listener()
  }
  return {
    getSnapshot: () => snapshot,
    setMode(nextMode) {
      const next = normalize(nextMode)
      let persisted = true
      try { write(next) } catch { persisted = false }
      publish(next)
      return persisted
    },
    subscribe(listener) {
      listeners.add(listener)
      if (listeners.size === 1) {
        cleanups = [onSystemChange(() => publish(snapshot.mode)), onStorageChange(publish)]
        // Refresh after an interval with no subscribers.
        publish(snapshot.mode)
      }
      return () => { listeners.delete(listener); if (!listeners.size) { cleanups.forEach(cleanup => cleanup()); cleanups = [] } }
    },
  }
}

let store
export function getMusicAppearanceStore() {
  if (!store) {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    store = createAppearanceStore({
      read: () => localStorage.getItem(APPEARANCE_STORAGE_KEY),
      write: mode => localStorage.setItem(APPEARANCE_STORAGE_KEY, mode),
      systemDark: () => media.matches,
      onSystemChange(callback) { media.addEventListener('change', callback); return () => media.removeEventListener('change', callback) },
      onStorageChange(callback) {
        const changed = event => { if (event.key === APPEARANCE_STORAGE_KEY || event.key === null) callback(event.newValue) }
        window.addEventListener('storage', changed); return () => window.removeEventListener('storage', changed)
      },
      apply(theme) {
        document.documentElement.dataset.musicTheme = theme
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0c151f' : '#f5f8fb')
      },
    })
  }
  return store
}
