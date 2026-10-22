import { useEffect, useState } from 'react'
import { chorusWithinDuration, loadTrackChorus } from './trackChorus.js'

export function useTrackChorus(song, duration) {
  const id = song?.source === 'netease' ? String(song.providerId || song.id || '').replace(/^netease-/, '') : ''
  const [state, setState] = useState({ id: '', chorus: null })
  useEffect(() => {
    if (!id) return undefined
    let active = true
    loadTrackChorus(id).then(chorus => { if (active) setState({ id, chorus }) }).catch(() => { if (active) setState({ id, chorus: null }) })
    return () => { active = false }
  }, [id])
  return state.id === id ? chorusWithinDuration(state.chorus, duration) : null
}
