import { useCallback, useEffect, useRef, useState } from 'react'
import { loadSongLyrics } from '../services/songLyrics'
import { usePlayer } from '../player/react/usePlayer'
import { lyricFlowController } from '../services/LyricFlowController'
import ThreeLyricText from './ThreeLyricText'
import { LYRIC_3D_DEFAULTS } from './lyric3DSettings'
import './FloatingLyrics.css'

function findActiveLyricIndex(lines, currentTime) {
  let activeIndex = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (Number(lines[index].time) <= currentTime + 0.18) activeIndex = index
    else break
  }
  return activeIndex
}

function FloatingLyrics({ settings = LYRIC_3D_DEFAULTS, theme }) {
  const { currentTrack: currentSong, currentTime, isPlaying } = usePlayer()
  const songId = currentSong?.id || ''
  const [lyricState, setLyricState] = useState({ songId: '', lines: [], outgoing: null, transitionId: 0 })
  const requestIdRef = useRef(0)
  const displayedSnapshotRef = useRef({ currentTime: 0, palette: { primary: '#648db5', secondary: '#a6d6ee' } })
  const [displayedSnapshot, setDisplayedSnapshot] = useState({
    songId: '', currentTime: 0, palette: { primary: '#648db5', secondary: '#a6d6ee' },
  })
  const rootRef = useRef(null)
  const flowFrameRef = useRef(0)
  const flowSettleRef = useRef(0)

  const palette = {
    primary: theme?.['--song-primary'] || '#648db5',
    secondary: theme?.['--song-secondary'] || '#a6d6ee',
  }

  if (lyricState.songId === songId && (
    displayedSnapshot.songId !== songId
    || displayedSnapshot.currentTime !== currentTime
    || displayedSnapshot.palette.primary !== palette.primary
    || displayedSnapshot.palette.secondary !== palette.secondary
  )) {
    setDisplayedSnapshot({ songId, currentTime, palette })
  }

  useEffect(() => {
    displayedSnapshotRef.current = displayedSnapshot
  }, [displayedSnapshot])

  useEffect(() => {
    requestIdRef.current += 1
    const requestId = requestIdRef.current
    if (!songId) return undefined
    const request = loadSongLyrics(currentSong)
    const showLyrics = (lines) => {
      if (requestId !== requestIdRef.current) return
      setLyricState((previous) => {
        const outgoing = previous.songId && previous.songId !== songId && previous.lines.length
          ? {
            songId: previous.songId,
            lines: previous.lines,
            currentTime: displayedSnapshotRef.current.currentTime,
            activeIndex: Math.max(0, findActiveLyricIndex(previous.lines, displayedSnapshotRef.current.currentTime)),
            palette: displayedSnapshotRef.current.palette,
          }
          : null
        return { songId, lines, outgoing, transitionId: previous.transitionId + 1 }
      })
    }
    request.then((lyrics) => {
      showLyrics(lyrics.lines || [])
    }).catch(() => {
      showLyrics([])
    })
    return undefined
  }, [currentSong, songId])

  const finishTransition = useCallback((transitionId) => {
    setLyricState((previous) => previous.transitionId === transitionId
      ? { ...previous, outgoing: null }
      : previous)
  }, [])

  const lines = lyricState.lines
  const waitingForLyrics = lyricState.songId !== songId
  const displayTime = waitingForLyrics ? displayedSnapshot.currentTime : currentTime
  const displayPalette = waitingForLyrics ? displayedSnapshot.palette : palette
  const activeIndex = Math.max(0, findActiveLyricIndex(lines, displayTime))
  const activeKey = lines[activeIndex] ? `${lyricState.songId}-${lines[activeIndex].time}-${activeIndex}` : ''

  useEffect(() => {
    window.cancelAnimationFrame(flowFrameRef.current)
    window.clearTimeout(flowSettleRef.current)
    if (!activeKey) {
      lyricFlowController.deactivate()
      return undefined
    }
    lyricFlowController.beginReveal(performance.now())
    const measure = () => {
      const anchor = rootRef.current?.querySelector('.floating-lyrics__flow-anchor')
      if (!anchor) return
      lyricFlowController.updateRect(
        anchor.getBoundingClientRect(), window.innerWidth, window.innerHeight, performance.now(),
      )
    }
    const advance = (frameTime) => {
      lyricFlowController.updateEnvelope(frameTime)
      if (lyricFlowController.active) flowFrameRef.current = window.requestAnimationFrame(advance)
    }
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    if (rootRef.current) observer?.observe(rootRef.current)
    window.addEventListener('resize', measure)
    const measureFrame = window.requestAnimationFrame(measure)
    flowFrameRef.current = window.requestAnimationFrame(advance)
    flowSettleRef.current = window.setTimeout(measure, 620)
    return () => {
      window.cancelAnimationFrame(measureFrame)
      window.cancelAnimationFrame(flowFrameRef.current)
      window.clearTimeout(flowSettleRef.current)
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [activeKey])

  useEffect(() => () => {
    window.cancelAnimationFrame(flowFrameRef.current)
    window.clearTimeout(flowSettleRef.current)
    lyricFlowController.deactivate()
  }, [])

  return (
    <section
      ref={rootRef}
      className={`floating-lyrics${isPlaying ? ' is-playing' : ' is-paused'}`}
      style={{
        '--lyric-user-shift-x': `${settings.offsetX}%`,
        '--lyric-user-shift-y': `${settings.offsetY}%`,
        '--lyric-size': settings.size,
        '--lyric-glow-strength': settings.glow,
        '--lyric-glow-color': settings.followCover ? displayPalette.secondary : settings.glowColor,
      }}
      aria-label="滚动歌词"
    >
      <div className="floating-lyrics__viewport" aria-hidden="true">
        <ThreeLyricText
          lines={lines}
          songId={lyricState.songId}
          activeIndex={activeIndex}
          currentTime={displayTime}
          isPlaying={isPlaying && !waitingForLyrics}
          settings={settings}
          palette={displayPalette}
          outgoing={lyricState.outgoing}
          transitionId={lyricState.transitionId}
          onTransitionComplete={finishTransition}
        />
        <span className="floating-lyrics__flow-anchor">{lines[activeIndex]?.text}</span>
      </div>
      <div className="floating-lyrics__accessible" aria-live="polite">
        {lines[activeIndex]?.text}
      </div>
    </section>
  )
}

export default FloatingLyrics
