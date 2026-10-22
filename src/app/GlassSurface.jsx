import { useContext, useImperativeHandle, useRef } from 'react'
import { GlassContext, SurfaceContext, useLiquidGlassEnabled } from './glassContext.js'

export function LiquidGlassProvider({ enabled, children }) {
  return <GlassContext value={enabled}>{children}</GlassContext>
}

/** Layout and readable fallback only. The source Liquid Ore pass paints one
 * optical body around each outer surface, underneath the clear DOM content. */
export default function GlassSurface({ as: Tag = 'div', children, className = '', radius = 26, ref, ...props }) {
  const enabled = useLiquidGlassEnabled(), nested = useContext(SurfaceContext), root = useRef(null)
  useImperativeHandle(ref, () => root.current, [])
  return <Tag ref={root} className={`${className} glass-surface`} data-yun-glass={enabled && !nested ? 'surface' : undefined}
    data-glass-mode="fallback" data-glass-radius={radius} {...props}>
    {enabled && !nested && <canvas className="glass-optical-canvas" aria-hidden="true" />}
    <span aria-hidden="true" className="glass-finish" />
    <SurfaceContext value>{children}</SurfaceContext>
  </Tag>
}
