import { useEffect, useState } from 'react'
import App from '../App.jsx'
import YunIntro from './YunIntro.jsx'
import './YunExperience.css'

export default function YunExperience() {
  const [phase, setPhase] = useState('intro')
  const [appMounted, setAppMounted] = useState(false)
  const [appReady, setAppReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    let idleId = 0
    const preloadTimer = window.setTimeout(() => {
      const preload = () => import('../components/ParticleVinylBackground.jsx').then(() => {
        if (cancelled) return
        setAppMounted(true)
      })
      idleId = typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback(preload, { timeout: 1400 })
        : window.setTimeout(preload, 300)
    }, 2700)
    return () => {
      cancelled = true
      window.clearTimeout(preloadTimer)
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleId)
      else window.clearTimeout(idleId)
    }
  }, [])

  useEffect(() => {
    if (!appMounted || appReady) return undefined
    const checkReady = () => {
      const canvas = document.querySelector('.record-canvas-layer canvas')
      if (!canvas || canvas.width < 2 || canvas.height < 2) return
      window.clearInterval(interval)
      window.setTimeout(() => setAppReady(true), 320)
    }
    const interval = window.setInterval(checkReady, 80)
    checkReady()
    return () => window.clearInterval(interval)
  }, [appMounted, appReady])

  return (
    <div className={`yun-experience is-${phase}`}>
      <div className="yun-app-stage" aria-hidden={phase === 'intro'}>
        {appMounted && <App onVisualReady={() => setAppReady(true)} />}
      </div>
      {phase !== 'started' && (
      <YunIntro
        onTransitionStart={() => setPhase('transitioning')}
        onStart={() => setPhase('started')}
        transitionReady={appReady}
        onLoginSubmit={(data) => {
          window.dispatchEvent(new CustomEvent('yun:login-submit', { detail: data }))
        }}
      />
      )}
    </div>
  )
}
