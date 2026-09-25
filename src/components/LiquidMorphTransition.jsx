import { useEffect, useRef } from 'react'
import {
  liquidMorphHasSettled,
  resolveLiquidMorphDelta,
  resolveLiquidMorphFrame,
  shouldRevealLiquidMorph,
  stepLiquidMorph,
} from './liquidMorphSpring'
import { liquidOreGlassState } from './liquidOreSource'

function writeFrame(element, frame) {
  element.style.left = `${frame.left}px`
  element.style.top = `${frame.top}px`
  element.style.width = `${frame.width}px`
  element.style.height = `${frame.height}px`
  element.style.borderRadius = `${frame.radius}px`
  element.style.setProperty('--liquid-morph-energy', frame.energy.toFixed(4))
  element.dataset.morphEnergy = frame.energy.toFixed(4)
  element.dataset.morphDirX = frame.directionX.toFixed(4)
  element.dataset.morphDirY = frame.directionY.toFixed(4)
}

export default function LiquidMorphTransition({ transition, onReveal, onComplete }) {
  const layerRef = useRef(null)
  const callbacksRef = useRef({ onReveal, onComplete })

  useEffect(() => {
    callbacksRef.current = { onReveal, onComplete }
  }, [onComplete, onReveal])

  useEffect(() => {
    const element = layerRef.current
    if (!element || !transition) return undefined

    let animationFrame = 0
    let previousTime = performance.now()
    let elapsedTime = 0
    let spring = { progress: 0, velocity: 0 }
    let revealed = false
    let cancelled = false
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    const finish = () => {
      if (cancelled) return
      const finalSpring = { progress: 1, velocity: 0 }
      writeFrame(element, resolveLiquidMorphFrame(transition, finalSpring))
      if (!revealed && transition.direction === 'open') {
        revealed = true
        callbacksRef.current.onReveal?.(transition)
      }
      callbacksRef.current.onComplete?.(transition)
    }

    if (reducedMotion) {
      animationFrame = requestAnimationFrame(finish)
      return () => {
        cancelled = true
        cancelAnimationFrame(animationFrame)
      }
    }

    writeFrame(element, resolveLiquidMorphFrame(transition, spring))

    const animate = (now) => {
      let remainingDelta = resolveLiquidMorphDelta(
        (now - previousTime) / 1000,
        document.visibilityState,
      )
      previousTime = now
      elapsedTime += remainingDelta
      while (remainingDelta > 0.0001) {
        const step = Math.min(remainingDelta, 0.05)
        spring = stepLiquidMorph(spring, step, 1, liquidOreGlassState.bounce)
        remainingDelta -= step
      }
      writeFrame(element, resolveLiquidMorphFrame(transition, spring))

      if (!revealed && transition.direction === 'open' && shouldRevealLiquidMorph(spring, elapsedTime)) {
        revealed = true
        callbacksRef.current.onReveal?.(transition)
      }

      if (liquidMorphHasSettled(spring)) {
        finish()
        return
      }
      animationFrame = requestAnimationFrame(animate)
    }

    animationFrame = requestAnimationFrame(animate)
    return () => {
      cancelled = true
      cancelAnimationFrame(animationFrame)
    }
  }, [transition])

  if (!transition) return null

  return (
    <div
      ref={layerRef}
      className="liquid-morph-layer"
      aria-hidden="true"
      data-liquid-morph={transition.direction}
    />
  )
}
