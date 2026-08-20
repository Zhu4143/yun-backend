import { useEffect, useRef } from 'react'
import { createWaterBackgroundEngine } from './waterBackgroundEngine'

export default function WaterBackground() {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!canvasRef.current) return undefined
    let engine
    try {
      engine = createWaterBackgroundEngine(canvasRef.current)
    } catch {
      return undefined
    }
    return () => engine.destroy()
  }, [])

  return <canvas ref={canvasRef} className="yun-intro__water-canvas" aria-hidden="true" />
}
