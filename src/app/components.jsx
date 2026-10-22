import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Close, More, Play, Music, Loader } from './icons.js'
import { formatTime } from './formatTime.js'
import GlassSurface from './GlassSurface.jsx'

export function IconButton({ icon: Icon, label, children, className = '', ...props }) {
  const Button = className.includes('round-button') ? GlassSurface : 'button'
  return <Button {...(Button === GlassSurface ? { as: 'button', radius: 50 } : {})} type="button" className={`icon-button ${className}`} aria-label={label} title={label} {...props}>
    {Icon && <Icon size={20} strokeWidth={1.7} aria-hidden="true" />}{children}
  </Button>
}

export function AlbumArt({ song, src, className = '', alt = '', priority = false }) {
  return <img className={`album-art ${className}`} src={src || song?.coverUrl || song?.coverPath || '/artwork/night-cover.webp'} alt={alt}
    loading={priority ? 'eager' : 'lazy'} decoding="async" onError={event => {
      if (!event.currentTarget.src.endsWith('/artwork/night-cover.webp')) event.currentTarget.src = '/artwork/night-cover.webp'
    }} />
}

export function EmptyState({ title, children, action, icon: Icon = Music }) {
  return <div className="empty-state"><Icon size={32} strokeWidth={1.4} aria-hidden="true" /><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>
}

export function LoadingState({ children = '正在加载音乐…' }) {
  return <div className="loading-state" role="status"><Loader size={20} className="is-spinning" aria-hidden="true" />{children}</div>
}

export function TrackList({ tracks = [], currentId, isPlaying, onPlay, onMore, compact = false, emptyTitle = '这里还没有歌曲', children }) {
  if (!tracks.length) return <EmptyState title={emptyTitle}>{children}</EmptyState>
  return <ol className={`track-list ${compact ? 'track-list--compact' : ''}`}>
    {tracks.map((song, index) => <li className={`track-row ${String(song.id) === String(currentId) ? 'is-current' : ''}`} key={`${song.id || song.providerId}-${index}`}>
      <span className="track-index">{String(song.id) === String(currentId) && isPlaying ? <span className="playing-mark" aria-label="正在播放">●</span> : String(index + 1).padStart(2, '0')}</span>
      <button type="button" className="track-main" aria-label={`播放 ${song.title}，${song.artist || '未知歌手'}`} onClick={() => onPlay?.(song, tracks)}>
        <span className="track-cover-wrap"><AlbumArt song={song} /><Play className="track-play-mark" size={18} fill="currentColor" aria-hidden="true" /></span>
        <span className="track-copy"><strong>{song.title || '未命名歌曲'}</strong><span>{song.artist || '未知歌手'}</span></span>
      </button>
      {!compact && <span className="track-album">{song.album || (song.source === 'netease' ? '网易云音乐' : '本地音乐')}</span>}
      <span className="track-duration">{formatTime(song.duration)}</span>
      {onMore && <IconButton icon={More} label={`${song.title}的更多操作`} onClick={event => onMore(song, event.currentTarget)} />}
    </li>)}
  </ol>
}

export function Modal({ title, children, onClose, className = '', wide = false, immersive = false }) {
  const heading = useId()
  const dialogRef = useRef(null)
  const selectable = () => [...dialogRef.current.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter(node => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden')
  const onKey = event => {
    const dialog = dialogRef.current
    if (event.key === 'Escape') { event.preventDefault(); onClose?.(); return }
    if (event.key !== 'Tab') return
    const elements = selectable()
    if (!elements.length) { event.preventDefault(); dialog.focus(); return }
    const first = elements[0], last = elements[elements.length - 1]
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus() }
  }
  useEffect(() => {
    const previous = document.activeElement
    const dialog = dialogRef.current
    const application = document.querySelector('.music-app')
    const previousInert = application?.inert
    if (application) application.inert = true
    // A detail panel may claim initial focus before this frame runs.
    const timer = requestAnimationFrame(() => { if (!dialog.contains(document.activeElement)) (dialog.querySelector('button:not(:disabled)') || dialog).focus() })
    window.dispatchEvent(new Event('yun:glass-refresh'))
    return () => { cancelAnimationFrame(timer); if (application) application.inert = previousInert; if (previous?.isConnected) previous.focus?.(); window.dispatchEvent(new Event('yun:glass-refresh')) }
  }, [onClose])
  if (immersive) return createPortal(<section ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onKeyDown={onKey} className={`immersive-player ${className}`}>
    {children}
  </section>, document.body)
  return createPortal(<div className="music-modal-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose?.() }}>
    <GlassSurface as="section" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={heading} tabIndex={-1} onKeyDown={onKey} className={`music-dialog ${wide ? 'music-dialog--wide' : ''} ${className}`}>
      <header className="dialog-header"><h2 id={heading}>{title}</h2><IconButton icon={Close} label={`关闭${title}`} onClick={onClose} /></header>
      <div className="dialog-body">{children}</div>
    </GlassSurface>
  </div>, document.body)
}

