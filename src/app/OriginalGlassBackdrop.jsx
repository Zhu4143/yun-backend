import { useEffect, useRef, useState } from 'react'
import { createOriginalGlassScene } from './originalGlassScene.js'

export default function OriginalGlassBackdrop({ cover, theme, suspended }) {
  const host = useRef(null), engine = useRef(null), live = useRef({ suspended, theme })
  const [ready, setReady] = useState(false)
  useEffect(() => { live.current.suspended = suspended; if (!suspended) engine.current?.resume() }, [suspended])
  useEffect(() => { live.current.theme = theme; engine.current?.setTheme?.(theme) }, [theme])
  useEffect(() => {
    let mounted = true
    const scene = createOriginalGlassScene(host.current, {
      initialNight: live.current.theme === 'dark' ? 1 : 0,
      // Resume underneath the outgoing view so its glass is ready during the
      // crossfade, including after a viewport change while listening.
      readSuspended: () => live.current.suspended && !document.querySelector('.immersive-player.is-leaving'),
      onReady: () => { if (mounted) setReady(true) },
      onFail: () => { if (mounted) { setReady(false); engine.current?.dispose(); engine.current = null } },
    })
    engine.current = scene
    return () => { mounted = false; scene?.dispose(); engine.current = null }
  }, [])
  useEffect(() => { void engine.current?.setCover(cover) }, [cover])
  return <div ref={host} className={`original-glass-backdrop ${ready ? 'is-ready' : ''}`} aria-hidden="true" />
}
