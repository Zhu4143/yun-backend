import { useEffect, useMemo, useRef, useState } from 'react'
import ParticleVinylBackground from './components/ParticleVinylBackground'
import PixelRhythmPortrait from './components/PixelRhythmPortrait'
import VinylPortraitBridge from './components/VinylPortraitBridge'
import './PixelRhythmPreview.css'

export default function PixelRhythmPreview() {
  const crop = useMemo(() => ({ x: 0.08, y: 0.18, width: 0.84, height: 0.68 }), [])
  const sequenceUrls = useMemo(
    () => Array.from({ length: 11 }, (_, index) => `/portrait-sequence/${String(index + 1).padStart(2, '0')}.png`),
    [],
  )
  const sequenceOrder = useMemo(() => {
    // Connect both ends by ping-ponging without repeating either endpoint.
    const forward = [0, 1, 3, 4, 5, 6, 7, 8, 9, 10]
    return [...forward, ...forward.slice(1, -1).reverse()]
  }, [])
  const sampleStep = 6
  const [sequenceFps, setSequenceFps] = useState(3)
  const [transitionTarget, setTransitionTarget] = useState(1)
  const [transitionProgress, setTransitionProgress] = useState(1)
  const progressRef = useRef(1)

  useEffect(() => {
    let frameId = 0
    let previousTime = performance.now()
    const animateTransition = (now) => {
      const delta = Math.min(0.05, (now - previousTime) / 1000)
      previousTime = now
      const direction = transitionTarget > progressRef.current ? 1 : -1
      const next = Math.max(0, Math.min(1, progressRef.current + direction * delta / 2.6))
      progressRef.current = Math.abs(next - transitionTarget) < 0.002 ? transitionTarget : next
      setTransitionProgress(progressRef.current)
      if (progressRef.current !== transitionTarget) frameId = requestAnimationFrame(animateTransition)
    }
    frameId = requestAnimationFrame(animateTransition)
    return () => cancelAnimationFrame(frameId)
  }, [transitionTarget])

  const portraitOpacity = Math.max(0, Math.min(1, (transitionProgress - 0.78) / 0.18))
  const vinylOpacity = Math.max(0, Math.min(1, 1 - transitionProgress / 0.22))
  const bridgeOpacity = Math.max(
    0,
    Math.min(1, Math.min(transitionProgress / 0.16, (1 - transitionProgress) / 0.16)),
  )
  return (
    <main className="pixel-preview" aria-label="像素音律人像效果预览">
      <div className="vinyl-transition-layer" style={{ opacity: vinylOpacity }}>
        <ParticleVinylBackground portraitTransition={transitionProgress} viewLocked />
      </div>
      <div className="bridge-transition-layer" style={{ opacity: bridgeOpacity }}>
        <VinylPortraitBridge
          imageUrl={sequenceUrls[0]}
          crop={crop}
          progress={transitionProgress}
        />
      </div>
      <div className="portrait-transition-layer" style={{ opacity: portraitOpacity }}>
        <PixelRhythmPortrait
          imageUrl={sequenceUrls[0]}
          sequenceUrls={sequenceUrls}
          sequenceOrder={sequenceOrder}
          sequenceFps={sequenceFps}
          revealProgress={transitionProgress}
          sampleStep={sampleStep}
          pointSize={2.5}
          crop={crop}
        />
      </div>
      <aside className="sequence-speed-control" aria-label="动画速度控制">
        <div>
          <span>动画速度</span>
          <strong>{sequenceFps.toFixed(2)} FPS</strong>
        </div>
        <input
          type="range"
          min="0.25"
          max="12"
          step="0.25"
          value={sequenceFps}
          onChange={(event) => setSequenceFps(Number(event.target.value))}
        />
      </aside>
      <button
        type="button"
        className="transition-toggle"
        onClick={() => setTransitionTarget((value) => (value > 0.5 ? 0 : 1))}
      >
        {transitionTarget > 0.5 ? '人物 → 原唱片' : '原唱片 → 人物'}
      </button>
    </main>
  )
}
