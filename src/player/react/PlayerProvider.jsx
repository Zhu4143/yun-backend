import { PlayerContext } from './PlayerContext.js'

export function PlayerProvider({ core, children }) {
  return (
    <PlayerContext.Provider value={core}>
      {children}
    </PlayerContext.Provider>
  )
}
