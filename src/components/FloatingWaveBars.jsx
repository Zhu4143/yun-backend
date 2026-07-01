import { useEffect, useRef } from 'react'
import './FloatingWaveBars.css'

const waveHeightPattern = [
  32, 46, 38, 62, 44, 74, 52, 84, 43, 68, 58, 92, 49, 76,
  56, 88, 41, 65, 35, 72, 54, 45, 61, 50, 36, 57, 47, 80,
]

const waveBars = Array.from({ length: 56 }, (_, index) => ({
  height: waveHeightPattern[index % waveHeightPattern.length],
  delay: -((index * 0.17) % 1.28),
  duration: 0.82 + ((index * 0.11) % 0.56),
}))

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function FloatingWaveBars({ active = false, getFrequencyData }) {
  const rootRef = useRef(null)
  const barRefs = useRef([])
  const smoothLevelsRef = useRef(waveBars.map(() => 0.38))
  const frameRef = useRef(0)

  useEffect(() => {
    const bars = barRefs.current
    const root = rootRef.current

    if (!active || typeof getFrequencyData !== 'function') {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
      smoothLevelsRef.current = waveBars.map(() => 0.38)
      bars.forEach((bar) => bar?.style.removeProperty('--wave-scale'))
      root?.classList.remove('is-audio-reactive')
      return undefined
    }

    let running = true
    let detectedLiveAudio = false

    const tick = () => {
      const frequencyData = getFrequencyData()

      if (frequencyData?.length) {
        if (!detectedLiveAudio) {
          detectedLiveAudio = true
          root?.classList.add('is-audio-reactive')
        }

        const usableBins = Math.max(12, Math.floor(frequencyData.length * 0.42))
        const nextLevels = smoothLevelsRef.current

        waveBars.forEach((_, index) => {
          const bandStart = Math.floor((index / waveBars.length) ** 1.35 * usableBins)
          const bandEnd = Math.max(bandStart + 2, Math.floor(((index + 1) / waveBars.length) ** 1.35 * usableBins))
          let sum = 0
          let count = 0

          for (let bin = bandStart; bin < bandEnd; bin += 1) {
            sum += frequencyData[bin] || 0
            count += 1
          }

          const average = count ? sum / count / 255 : 0
          const shaped = Math.pow(clamp(average * 1.95, 0, 1), 0.62)
          const base = 0.16 + (waveBars[index].height / 100) * 0.08
          const target = clamp(base + shaped * 1.26, 0.16, 1.42)
          nextLevels[index] += (target - nextLevels[index]) * 0.34

          bars[index]?.style.setProperty('--wave-scale', nextLevels[index].toFixed(3))
        })
      } else if (detectedLiveAudio) {
        detectedLiveAudio = false
        root?.classList.remove('is-audio-reactive')
      }

      if (running) {
        frameRef.current = requestAnimationFrame(tick)
      }
    }

    frameRef.current = requestAnimationFrame(tick)

    return () => {
      running = false
      cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
    }
  }, [active, getFrequencyData])

  return (
    <div
      className={`floating-wave-bars${active ? ' is-active' : ' is-idle'}`}
      ref={rootRef}
      aria-hidden="true"
    >
      <div className="floating-wave-bars__inner">
        {waveBars.map((bar, index) => (
          <span
            className="floating-wave-bars__bar"
            key={`wave-bar-${index + 1}`}
            ref={(element) => {
              barRefs.current[index] = element
            }}
            style={{
              '--bar-height': `${bar.height}%`,
              '--bar-delay': `${bar.delay}s`,
              '--bar-duration': `${bar.duration}s`,
            }}
          />
        ))}
      </div>
    </div>
  )
}

export default FloatingWaveBars
