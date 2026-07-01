import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchSongLyrics } from '../api/yunApi'
import { fetchNeteaseLyrics } from '../api/neteaseApi'
import { lyricFlowController } from '../services/LyricFlowController'
import './FloatingLyrics.css'

function findActiveLyricIndex(lines, currentTime) {
  if (!lines.length) return -1

  let activeIndex = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (Number(lines[index].time) <= currentTime + 0.18) {
      activeIndex = index
    } else {
      break
    }
  }

  return activeIndex
}

function getLyricRowHeight() {
  if (typeof window === 'undefined') return 58

  return window.innerWidth <= 768 ? 40 : 58
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function FloatingLyrics({ currentSong, currentTime = 0, active = false }) {
  const [lyricState, setLyricState] = useState({ songId: '', lines: [], status: 'idle' })
  const [rowHeight, setRowHeight] = useState(getLyricRowHeight)
  const requestIdRef = useRef(0)
  const rootRef = useRef(null)
  const lyricFlowFrameRef = useRef(0)
  const songId = currentSong?.id || ''

  useEffect(() => {
    requestIdRef.current += 1
    const requestId = requestIdRef.current

    if (!songId) {
      return undefined
    }

    const lyricsRequest = currentSong?.source === 'netease'
      ? fetchNeteaseLyrics(currentSong.providerId || songId)
      : fetchSongLyrics(songId)

    lyricsRequest
      .then((lyrics) => {
        if (requestId !== requestIdRef.current) return
        const nextLines = lyrics.lines || []
        setLyricState({
          songId,
          lines: nextLines,
          status: nextLines.length ? 'ready' : 'empty',
        })
      })
      .catch(() => {
        if (requestId !== requestIdRef.current) return
        setLyricState({ songId, lines: [], status: 'empty' })
      })

    return undefined
  }, [currentSong?.providerId, currentSong?.source, songId])

  useEffect(() => {
    const updateRowHeight = () => {
      setRowHeight(getLyricRowHeight())
    }

    window.addEventListener('resize', updateRowHeight)

    return () => {
      window.removeEventListener('resize', updateRowHeight)
    }
  }, [])

  const lines = useMemo(
    () => (lyricState.songId === songId ? lyricState.lines : []),
    [lyricState.lines, lyricState.songId, songId],
  )
  const rawActiveIndex = useMemo(() => findActiveLyricIndex(lines, currentTime), [currentTime, lines])
  const activeIndex = Math.max(0, rawActiveIndex)
  const activeOffset = -(activeIndex * rowHeight + rowHeight / 2)
  const activeLyricKey = lines[activeIndex]
    ? `${lyricState.songId}-${lines[activeIndex].time}-${activeIndex}`
    : ''

  useEffect(() => {
    window.cancelAnimationFrame(lyricFlowFrameRef.current)
    if (!activeLyricKey) {
      lyricFlowController.deactivate()
      return undefined
    }
    const startTime = performance.now()
    lyricFlowController.beginReveal(startTime)
    const measureActiveLyric = (now) => {
      const activeLine = rootRef.current?.querySelector('.floating-lyrics__line.is-active')
      if (activeLine) {
        lyricFlowController.updateRect(
          activeLine.getBoundingClientRect(),
          window.innerWidth,
          window.innerHeight,
          now,
        )
      }
      if (now - startTime < 2150) {
        lyricFlowFrameRef.current = window.requestAnimationFrame(measureActiveLyric)
      }
    }
    lyricFlowFrameRef.current = window.requestAnimationFrame(measureActiveLyric)
    return () => window.cancelAnimationFrame(lyricFlowFrameRef.current)
  }, [activeIndex, activeLyricKey])

  useEffect(() => () => {
    window.cancelAnimationFrame(lyricFlowFrameRef.current)
    lyricFlowController.deactivate()
  }, [])

  if (lyricState.status !== 'ready' || !lines.length) {
    return null
  }

  return (
    <section
      ref={rootRef}
      className={`floating-lyrics${active ? ' is-playing' : ' is-paused'}`}
      style={{ '--active-lyric-offset': `${activeOffset}px` }}
      aria-label="滚动歌词"
    >
      <div className="floating-lyrics__shade" />
      <div className="floating-lyrics__viewport">
        <div className="floating-lyrics__track">
          <div className="floating-lyrics__scroll">
            {lines.map((line, index) => {
              const signedDistance = index - activeIndex
              const distance = Math.abs(signedDistance)
              const depth = Math.min(distance, 4)
              const opacity = 0.18 + (1 - Math.min(distance, 3) / 3) * 0.42
              const depthScale = clamp(1 - depth * 0.06, 0.84, 1)
              const blur = Math.min(depth * 0.46, 1.9)
              const nextLineTime = lines[index + 1]?.time ?? line.time + 4
              const lineDuration = Math.max(0.8, nextLineTime - line.time)
              const lyricProgress = index === activeIndex
                ? clamp((currentTime - line.time) / lineDuration, 0, 1)
                : index < activeIndex
                  ? 1
                  : 0
              const stateClass = index === activeIndex
                ? ' is-active'
                : signedDistance === -1
                  ? ' is-previous'
                  : signedDistance === 1
                    ? ' is-next'
                    : distance > 2
                      ? ' is-distant'
                      : ' is-near'
              return (
                <p
                  className={`floating-lyrics__line${stateClass}`}
                  data-lyric-text={line.text}
                  style={{
                    '--lyric-distance': distance,
                    '--lyric-opacity': opacity.toFixed(2),
                    '--lyric-depth-scale': depthScale.toFixed(3),
                    '--lyric-blur': `${blur.toFixed(2)}px`,
                    '--lyric-line-progress': lyricProgress.toFixed(3),
                  }}
                  key={`${line.time}-${index}`}
                >
                  <span className="floating-lyrics__text" data-lyric-text={line.text}>{line.text}</span>
                </p>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}

export default FloatingLyrics
