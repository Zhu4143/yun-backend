import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import CaseStage from './CaseStage'
import CdLibraryWall from './CdLibraryWall'
import { waitForPlaybackRecovery } from './playbackHandoff'
import './cd-case.css'

// Keep this object stable: changing it would rebuild the renderer.
const DISC = { name: 'TypingMind Motion', art: '/cd-case/stickers.webp', artIn: 16.2, printOut: 59.1 }
const SOURCE_URL = 'https://github.com/annnguyentt/vibe-coding/tree/efba8dfb956cca848422f18e8ede1bdf96033fca/cd-case'

const CdCaseBackground = memo(function CdCaseBackground({ coverUrl, trackKey, isPlaying, backgroundBrightness, quality, liquidMetalSettings, getFrequencyData, onReady, libraryOpen, library, onCloseLibrary, onPlayTrack, readPlaybackState, recordPresentation }) {
  const stageRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [changing, setChanging] = useState(false)
  const [failed, setFailed] = useState(false)
  const [artworkError, setArtworkError] = useState(false)
  const [selection, setSelection] = useState(null)
  const [readyArtwork, setReadyArtwork] = useState('')
  const [playReady, setPlayReady] = useState(false)
  const [flightDone, setFlightDone] = useState(false)
  const [selectionError, setSelectionError] = useState('')
  const [previousLibraryOpen, setPreviousLibraryOpen] = useState(libraryOpen)
  const [wallPresent, setWallPresent] = useState(libraryOpen)
  const request = useRef(0)
  const picking = useRef(false)

  // A new opening owns a fresh selection, even if the previous wall's exit
  // has not finished. Otherwise its completed handoff immediately closes it.
  if (previousLibraryOpen !== libraryOpen) {
    setPreviousLibraryOpen(libraryOpen)
    if (libraryOpen) {
      setWallPresent(true)
      setSelection(null)
      setSelectionError('')
      setPlayReady(false)
      setFlightDone(false)
    }
  }
  useLayoutEffect(() => {
    if (!libraryOpen) return
    request.current++
    picking.current = false
  }, [libraryOpen])
  useEffect(() => () => { request.current++ }, [])

  const pickTrack = async (item, rect, source) => {
    if (picking.current) return
    picking.current = true
    const key = ++request.current
    const track = item.record
    setSelection({ key, item, rect, source, trackKey: String(track.id || track.fileUrl || '') })
    setFlightDone(false); setPlayReady(false); setSelectionError('')
    try {
      const result = await onPlayTrack(track)
      if (key !== request.current) return
      if (!result?.ok) throw new Error(result?.error || result?.message || '这首歌暂时无法播放，请再选一首')
      setPlayReady(true)
    } catch (error) {
      if (key !== request.current) return
      const message = String(error.message || '')
      if (/interrupted|AbortError/i.test(message)) {
        const resumed = await waitForPlaybackRecovery({
          readState: readPlaybackState,
          trackKey: String(track.id || track.fileUrl || ''),
          isCurrent: () => key === request.current,
        })
        if (key !== request.current) return
        if (resumed) { setPlayReady(true); return }
      }
      picking.current = false
      setSelectionError(/interrupted|AbortError/i.test(message) ? '歌曲切换被打断，请再选一次' : /https?:|\[object Object\]/i.test(message) ? '这首歌暂时无法播放，请再选一首' : message || '歌曲暂时无法播放')
      setSelection(null)
    }
  }

  useEffect(() => {
    if (libraryOpen && selection && playReady && flightDone && (failed || readyArtwork === selection.trackKey || artworkError)) onCloseLibrary()
  }, [libraryOpen, selection, playReady, flightDone, readyArtwork, artworkError, failed, onCloseLibrary])

  const failScene = () => {
    setFailed(true)
    onReady?.()
  }

  return (
    <section className={`cd-case-background${libraryOpen ? ' is-library-covered' : ''}`} aria-label="CD 盒播放器皮肤" data-track-key={trackKey} data-playing={isPlaying}>
      <div
        className="cd-case__scene"
        tabIndex={0}
        aria-label={isPlaying ? '右侧完整唱片，暂停后回盒待机' : '待机唱片盒，点击开合，拖动旋转，按 O 开合盒盖'}
        onKeyDown={(event) => {
          const key = event.key.toLowerCase()
          if (!isPlaying && key === 'o' && !event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey) {
            event.preventDefault()
            stageRef.current?.setOpen()
          }
        }}
      >
        {!failed && <CaseStage
          recordPresentation={recordPresentation}
          ref={stageRef}
          disc={DISC}
          artworkUrl={selection?.item.cover || coverUrl || DISC.art}
          trackKey={selection?.trackKey || trackKey}
          paused={!isPlaying || wallPresent || libraryOpen || Boolean(selection)}
          concealed={libraryOpen}
          background={{ brightness: backgroundBrightness, quality, settings: liquidMetalSettings, getFrequencyData, active: isPlaying }}
          onOpen={setOpen}
          onReady={onReady}
          onFail={failScene}
          onArtworkReady={setReadyArtwork}
          onArtworkChanging={(value) => {
            setChanging(value)
            if (value) setArtworkError(false)
          }}
          onArtworkError={() => setArtworkError(true)}
        />}
        {failed && <div className="cd-case__fallback">
          <img src={DISC.art} alt="CD 封面" />
          <p>CD 场景暂不可用，音乐仍可播放</p>
        </div>}
      </div>
      <div className="cd-case__tools">
        <span className="cd-case__hint" role="status">
          {failed ? '' : changing ? '正在换片' : artworkError ? '封面暂不可用，保留当前盘面' : isPlaying ? '播放中 · 暂停归位' : '盒内待机 · 拖动旋转'}
        </span>
        {!failed && !isPlaying && <button type="button" aria-label={open ? '合上 CD 盒' : '打开 CD 盒'} aria-pressed={open} onClick={() => stageRef.current?.setOpen()}>
          {open ? '合上盒子' : '打开盒子'}
        </button>}
      </div>
      <small className="cd-case__credit">
        CD case by <a href="https://x.com/ann_nnng" target="_blank" rel="noopener noreferrer">Ann Nguyen</a>
        {' · '}Built with <a href="https://typingmind.com" target="_blank" rel="noopener noreferrer">TypingMind</a>
        {' · '}<a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">原作品 ↗</a>
      </small>
      {library && <CdLibraryWall open={libraryOpen} library={library} selection={selection} error={selectionError}
        getTarget={() => stageRef.current?.getBounds() || { x: window.innerWidth * 0.38, y: window.innerHeight * 0.2, width: 400, height: 400 }}
        onPick={pickTrack}
        onClose={() => { request.current++; picking.current = false; setSelection(null); setSelectionError(''); onCloseLibrary() }}
        onFlightComplete={key => { if (key === selection?.key) setFlightDone(true) }}
        onExited={() => { setWallPresent(false); picking.current = false; setSelection(null) }} />}
    </section>
  )
})

export default CdCaseBackground
