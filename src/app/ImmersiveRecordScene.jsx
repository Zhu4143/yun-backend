import { useEffect, useRef } from 'react'
import { createImmersiveRecordScene } from './immersiveRecordScene.js'
import { useLiquidGlassEnabled } from './glassContext.js'

/** One lazy canvas draws the original physical disc and Liquid Ore field. */
export default function ImmersiveRecordScene({ slot, cover, trackKey, playing, recordVisible = true, backgroundSettings, onStatus, onPalette }) {
  const glassEnabled = useLiquidGlassEnabled()
  const host = useRef(null), scene = useRef(null), live = useRef({ playing, onStatus, glassEnabled, recordVisible, onPalette })
  const initialSettings = useRef(backgroundSettings)
  useEffect(() => { live.current = { playing, onStatus, glassEnabled, recordVisible, onPalette }; scene.current?.redraw() }, [playing, onStatus, glassEnabled, recordVisible, onPalette])
  useEffect(() => {
    let mounted = true
    const engine = createImmersiveRecordScene(host.current, slot.current, {
      readPlaying: () => live.current.playing,
      readGlassEnabled: () => live.current.glassEnabled,
      readRecordVisible: () => live.current.recordVisible,
      onPalette: palette => { if (mounted) live.current.onPalette?.(palette) },
      backgroundSettings: initialSettings.current,
      onReady: () => { if (mounted) live.current.onStatus('ready') },
      onFail: () => { if (mounted) { live.current.onStatus('failed'); scene.current?.dispose(); scene.current = null } },
    })
    scene.current = engine
    return () => { mounted = false; engine?.dispose(); scene.current = null }
  }, [slot])
  useEffect(() => { void scene.current?.setArtwork(cover, trackKey) }, [cover, trackKey])
  useEffect(() => { scene.current?.setBackgroundSettings(backgroundSettings) }, [backgroundSettings])
  return <div ref={host} className="immersive-visual" aria-hidden="true" />
}
