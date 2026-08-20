import { useCallback, useEffect, useRef, useState } from 'react'
import LiquidGlass from 'liquid-glass-react'
import { createFluidEngine } from '../effects/fluid/fluidEngine'
import { createIdleFlow, runVinylTransition, runYunIntroInkSequence } from '../effects/fluid/fluidIntroSequence'
import WaterBackground from '../effects/water/WaterBackground'
import YunLoginPanel from './YunLoginPanel'
import './YunIntro.css'

export default function YunIntro({ onStart, onTransitionStart, onLoginSubmit, transitionReady = true }) {
  const canvasRef = useRef(null)
  const engineRef = useRef(null)
  const cleanupIdleRef = useRef(null)
  const [phase, setPhase] = useState('quiet')
  const [loginOpen, setLoginOpen] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [webglReady, setWebglReady] = useState(true)
  const [exiting, setExiting] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const [replayKey, setReplayKey] = useState(0)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = (event) => setReducedMotion(event.matches)
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || reducedMotion) {
      setPhase('ready')
      return undefined
    }
    const abortController = new AbortController()
    const timers = []
    try {
      const engine = createFluidEngine(canvas)
      engineRef.current = engine
      cleanupIdleRef.current = createIdleFlow(engine)
      timers.push(window.setTimeout(() => {
        if (abortController.signal.aborted) return
        setPhase('ink')
        runYunIntroInkSequence(engine, abortController.signal)
      }, 360))
      timers.push(window.setTimeout(() => setPhase('reveal'), 900))
      timers.push(window.setTimeout(() => setPhase('ready'), 2380))
    } catch {
      window.setTimeout(() => {
        setWebglReady(false)
        setPhase('ready')
      }, 0)
    }

    const handleVisibility = () => engineRef.current?.setPaused(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      abortController.abort()
      timers.forEach(window.clearTimeout)
      document.removeEventListener('visibilitychange', handleVisibility)
      cleanupIdleRef.current?.()
      cleanupIdleRef.current = null
      engineRef.current?.destroy()
      engineRef.current = null
    }
  }, [reducedMotion, replayKey])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    engine.setBrightness(loginOpen ? 0.78 : 1)
  }, [loginOpen])

  useEffect(() => {
    if (phase !== 'ready' || !engineRef.current) return undefined
    let lastX = 0
    let lastY = 0
    let lastTime = 0
    const disturb = (event) => {
      if (event.target instanceof Element && event.target.closest('button, input, form, .yun-login-shell')) return
      const now = performance.now()
      if (now - lastTime < 42) return
      const x = event.clientX / Math.max(window.innerWidth, 1)
      const y = 1 - event.clientY / Math.max(window.innerHeight, 1)
      const dx = lastTime ? (event.clientX - lastX) * 0.08 : 0
      const dy = lastTime ? (lastY - event.clientY) * 0.08 : 0
      lastX = event.clientX
      lastY = event.clientY
      lastTime = now
      engineRef.current?.splatVelocityOnly(x, y, dx, dy, 0.055)
    }
    window.addEventListener('pointermove', disturb, { passive: true })
    return () => window.removeEventListener('pointermove', disturb)
  }, [phase])

  const start = useCallback(() => {
    if (!transitionReady || transitioning || exiting || phase !== 'ready') return
    setTransitioning(true)
    window.dispatchEvent(new CustomEvent('yun:vinyl-transition-start'))
    onTransitionStart?.()
    cleanupIdleRef.current?.()
    cleanupIdleRef.current = null
    const transitionController = new AbortController()
    if (!reducedMotion && engineRef.current) runVinylTransition(engineRef.current, transitionController.signal)
    const fadeTimer = window.setTimeout(() => setExiting(true), reducedMotion ? 80 : 720)
    window.setTimeout(() => {
      transitionController.abort()
      window.clearTimeout(fadeTimer)
      engineRef.current?.destroy()
      engineRef.current = null
      onStart?.()
    }, reducedMotion ? 360 : 1550)
  }, [exiting, onStart, onTransitionStart, phase, reducedMotion, transitioning, transitionReady])

  const showLogin = () => {
    if (phase !== 'ready' || exiting) return
    setLoginOpen(true)
  }

  const replayIntro = () => {
    setLoginOpen(false)
    setExiting(false)
    setWebglReady(true)
    setPhase('quiet')
    setReplayKey((value) => value + 1)
  }

  return (
    <div className={`yun-intro phase-${phase}${loginOpen ? ' is-login-open' : ''}${transitioning ? ' is-transitioning' : ''}${exiting ? ' is-exiting' : ''}${!webglReady || reducedMotion ? ' is-static' : ''}`}>
      <div className="yun-intro__base" aria-hidden="true" />
      <WaterBackground />
      <canvas ref={canvasRef} className="yun-intro-canvas yun-intro__fluid-canvas" aria-hidden="true" />
      <div className="yun-intro-vignette" aria-hidden="true" />

      <main className="yun-intro-brand" aria-label="昀音乐入口">
        <div className="yun-intro-mark" aria-label="昀">昀</div>
        <p className="yun-intro-kicker">YUN · LISTENING WITH YOU</p>
        <h1>让音乐理解此刻的你</h1>
        <div className="yun-intro-actions">
          <div className="yun-intro-primary-wrap">
            <LiquidGlass
              displacementScale={28}
              blurAmount={0.01}
              saturation={116}
              aberrationIntensity={1.5}
              elasticity={0.24}
              cornerRadius={999}
              padding="0"
              className="yun-intro-primary-glass"
            >
              <button type="button" onClick={start} disabled={phase !== 'ready' || exiting || !transitionReady}>开始使用</button>
            </LiquidGlass>
          </div>
          <button type="button" className="yun-intro-login-button" onClick={showLogin} disabled={phase !== 'ready' || exiting}>登录</button>
        </div>
      </main>

      <YunLoginPanel
        open={loginOpen}
        onBack={() => setLoginOpen(false)}
        onLoginSubmit={onLoginSubmit}
      />

      <p className="yun-intro-footnote">声音会留下来，界面会慢慢退后。</p>
      <button type="button" className="yun-intro-replay" onClick={replayIntro}>重播入场</button>
    </div>
  )
}
