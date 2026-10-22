import { lazy, Suspense, useEffect, useRef } from 'react'
import { COVER_FADE_MS, createCoverCrossfade } from './coverCrossfade.js'
import { useLiquidGlassEnabled } from './glassContext.js'

const OriginalGlassBackdrop = lazy(() => import('./OriginalGlassBackdrop.jsx'))

/** A shared, budgeted colour field sits behind the original glass surfaces. */
export default function LiquidGlassLayer({ cover, theme = 'light', suspended = false }) {
  const enabled = useLiquidGlassEnabled()
  const host = useRef(null)
  const controller = useRef(null)
  useEffect(() => {
    const fade = createCoverCrossfade(host.current)
    controller.current = fade
    return () => { fade.dispose(); controller.current = null }
  }, [])
  useEffect(() => { controller.current?.setCover(cover) }, [cover])

  return <div className="yun-glass-layer" aria-hidden="true">
    <div className="yun-color-fallback" />
    <div ref={host} className="yun-glass-artwork" style={{ '--cover-fade-duration': `${COVER_FADE_MS}ms` }} />
    {enabled && <Suspense fallback={null}><OriginalGlassBackdrop cover={cover} theme={theme} suspended={suspended} /></Suspense>}
  </div>
}
