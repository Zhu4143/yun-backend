import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react'
import NeteaseLikeButton from '../components/NeteaseLikeButton.jsx'
import { loadSongLyrics } from '../services/songLyrics.js'
import { fetchNeteaseSongComments } from '../api/neteaseApi.js'
import { AlbumArt, EmptyState, IconButton, LoadingState, Modal } from './components.jsx'
import { formatTime } from './formatTime.js'
import { createCommentAutoScroll } from './commentAutoScroll.js'
import { createTimelinePainter } from './timelinePainter.js'
import { useTrackChorus } from './useTrackChorus.js'
import GlassSurface from './GlassSurface.jsx'
import ImmersiveBackgroundEditor from './ImmersiveBackgroundEditor.jsx'
import { useImmersiveBackground } from './useImmersiveBackground.js'
import { useLyricEffects } from './useLyricEffects.js'
import LyricEffectsEditor from './LyricEffectsEditor.jsx'
import ImmersiveLyricText from './ImmersiveLyricText.jsx'
import { lyricColors, lyricEffectStyle, lyricInterval } from './lyricEffects.js'
import { resolveLyricFont } from './lyricFontMatching.js'
import { useLyricFont } from './useLyricFont.js'
import './player-bar.css'
import './lyric-effects.css'
import './immersive-queue.css'
import { AudioLines, ChevronDown, Close, Heart, ListMusic, Maximize, Message, Next, Pause, Play, Previous, Repeat, RepeatOne, Shuffle, Sliders, Sparkles, Trash, Volume, VolumeOff } from './icons.js'

const MODES = [
  { value: 'sequence', label: '顺序播放', icon: ListMusic },
  { value: 'shuffle', label: '随机播放', icon: Shuffle },
  { value: 'loop_one', label: '单曲循环', icon: RepeatOne },
  { value: 'ai_recommend', label: '智能续播', icon: AudioLines },
  { value: 'companion_continue', label: '陪伴续播', icon: Message },
]
const TABS = [{ value: 'queue', label: '待播列表' }, { value: 'lyrics', label: '歌词' }, { value: 'comments', label: '评论' }]
const ImmersiveRecordScene = lazy(() => import('./ImmersiveRecordScene.jsx'))

function songKey(song) {
  return song ? `${song.source || 'local'}:${song.providerId || song.id || song.fileUrl || ''}` : ''
}

function playerView(model) {
  const raw = model.localPlayer
  const song = raw.currentSong || model.playerState.currentTrack
  const duration = Math.max(0, Number(raw.duration) || Number(song?.duration) || 0)
  return {
    raw, song, duration,
    isPlaying: Boolean(raw.isPlaying),
    time: Math.max(0, Math.min(Number(raw.currentTime) || 0, duration || Infinity)),
    volume: Number.isFinite(Number(raw.volume)) ? Math.max(0, Math.min(1, Number(raw.volume))) : 1,
    mode: MODES.find(mode => mode.value === raw.playbackMode) || MODES[0],
    canSeek: Number(raw.duration) > 0,
  }
}

async function perform(model, action, fallback) {
  try {
    const result = await action()
    if (result?.ok === false) model.setNotice?.(result.error instanceof Error ? result.error.message : fallback)
    return result
  } catch (error) {
    model.setNotice?.(error instanceof Error ? error.message : fallback)
    return { ok: false }
  }
}

function LikeButton({ model, song }) {
  if (!song || song.source !== 'netease') return null
  const account = model.account.info
  return <NeteaseLikeButton song={song} accountKey={`${account?.userId || account?.nickname || ''}:${Boolean(account?.loggedIn)}`}
    onLoginRequested={() => {
      model.setNotice?.('登录网易云后，就可以收藏这首歌。')
      window.dispatchEvent(new CustomEvent('yun:open-login'))
    }} />
}

function Timeline({ model, className = '', minimal = false, active = true }) {
  const { raw, song, duration, time, canSeek, isPlaying } = playerView(model)
  const scrubber = useRef(null), painter = useRef(null), position = useRef({ time, duration })
  const { audioRef, getTimelineMedia } = raw
  const trackId = songKey(song)
  const [pointerHover, setPointerHover] = useState(false)
  useEffect(() => { position.current = { time, duration }; painter.current?.refresh() }, [time, duration, isPlaying, trackId])
  useEffect(() => {
    const controller = createTimelinePainter({
      node: scrubber.current, readMedia: () => getTimelineMedia ? getTimelineMedia() : audioRef?.current,
      readPosition: () => position.current, visible: () => active && !document.hidden,
    })
    painter.current = controller
    document.addEventListener('visibilitychange', controller.refresh)
    return () => { controller.dispose(); painter.current = null; document.removeEventListener('visibilitychange', controller.refresh) }
  }, [audioRef, getTimelineMedia, active])
  const seekTo = value => { raw.seekTo(value); painter.current?.refresh() }
  const chorus = useTrackChorus(song, canSeek ? duration : 0)
  const ratio = chorus ? chorus.start / duration : 0
  return <div className={`player-timeline ${className}`}>
    <span className="player-time">{formatTime(time)}</span>
    <div ref={scrubber} className={`player-scrubber ${minimal ? 'player-scrubber--minimal' : ''} ${pointerHover ? 'is-pointer-hovered' : ''}`}
      onPointerEnter={event => setPointerHover(event.pointerType === 'mouse' || event.pointerType === 'pen')}
      onPointerLeave={() => setPointerHover(false)} onPointerCancel={() => setPointerHover(false)}>
      {minimal && <span className="minimal-scrubber-line" aria-hidden="true"><span className="minimal-scrubber-fill" /></span>}
      <input type="range" min="0" max={duration || 1} step="0.1" value={Math.min(time, duration || 1)} disabled={!canSeek}
      aria-label="播放进度" aria-valuetext={`${formatTime(time)}，共 ${formatTime(duration)}`}
      style={{ '--range-progress': `${duration ? time / duration * 100 : 0}%` }}
      onChange={event => seekTo(Number(event.target.value))} />
      {chorus && <button type="button" className="player-chorus-marker" style={{ left: minimal ? `${ratio * 100}%` : `calc(${ratio * 100}% + ${4.5 - ratio * 9}px)` }}
        aria-label={`跳到高潮（副歌）${formatTime(chorus.start)}`} title={`高潮 · ${formatTime(chorus.start)}（网易云副歌时间）`}
        onClick={() => seekTo(chorus.start)} />}</div>
    <span className="player-time">{formatTime(duration)}</span>
  </div>
}

function VolumeControl({ model }) {
  const { raw, volume } = playerView(model)
  const previousVolume = useRef(0.7)
  useEffect(() => { if (volume > 0) previousVolume.current = volume }, [volume])
  return <div className="player-volume">
    <IconButton icon={volume > 0 ? Volume : VolumeOff} label={volume > 0 ? '静音' : '取消静音'}
      aria-pressed={volume === 0} onClick={() => raw.setVolume(volume > 0 ? 0 : previousVolume.current)} />
    <input type="range" min="0" max="1" step="0.01" value={volume} aria-label="音量" aria-valuetext={`${Math.round(volume * 100)}%`}
      style={{ '--range-progress': `${volume * 100}%` }} onChange={event => raw.setVolume(Number(event.target.value))} />
  </div>
}

function PlaybackModeButton({ model, className }) {
  const { raw, mode } = playerView(model)
  const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length]
  return <IconButton icon={mode.icon} className={className} label={`${mode.label}，点击切换为${next.label}`}
    onClick={() => raw.setPlaybackMode(next.value)} />
}

function Transport({ model, showMode = true }) {
  const { raw, song, isPlaying, mode } = playerView(model)
  const available = Boolean(song || model.library.songs.length)
  return <div className="player-transport">
    {showMode && <PlaybackModeButton model={model} className="player-mode-button" />}
    <IconButton icon={Previous} label="上一首" disabled={!song} onClick={() => { void perform(model, model.previous, '暂时无法播放上一首') }} />
    <IconButton icon={isPlaying ? Pause : Play} label={isPlaying ? '暂停' : '播放'} className="player-play-button" disabled={!available}
      onClick={() => { void perform(model, () => model.playerCore.togglePlay(), '暂时无法播放，请重新选择歌曲') }} />
    <IconButton icon={Next} label="下一首" disabled={!song} onClick={() => { void perform(model, model.next, '暂时没有下一首歌曲') }} />
    {showMode && <IconButton icon={Repeat} label={mode.value === 'loop_one' ? '关闭单曲循环' : '开启单曲循环'} aria-pressed={mode.value === 'loop_one'}
      className={`player-repeat-button ${mode.value === 'loop_one' ? 'is-active' : ''}`} onClick={() => raw.setPlaybackMode(mode.value === 'loop_one' ? 'sequence' : 'loop_one')} />}
  </div>
}

export function PlayerBar({ model, onExpand, onShowQueue, onShowLyrics, active = true }) {
  const { song, isPlaying } = playerView(model)
  const available = Boolean(song || model.library.songs.length)
  return <GlassSurface as="footer" className="music-player" aria-label="音乐播放器">
    <button type="button" className="player-expand-hit" onClick={onExpand} aria-label={song ? `打开 ${song.title} 的播放详情` : '打开播放详情'} />
    <Timeline model={model} minimal active={active} className="player-timeline--edge" />
    <div className="player-track">
      <div className="player-track-open">
        <AlbumArt song={song} className="player-cover" />
        <span className="player-copy"><strong className="player-title">{song?.title || '选一首喜欢的歌'}</strong><span className="player-artist">{song?.artist || '音乐与陪伴，刚刚好'}</span></span>
      </div>
      <LikeButton model={model} song={song} />
    </div>
    <div className="player-center"><Transport model={model} /></div>
    <div className="player-tools">
      <VolumeControl model={model} />
      <IconButton icon={ListMusic} label="查看待播列表" onClick={onShowQueue} />
      <IconButton icon={AudioLines} label="查看歌词" onClick={onShowLyrics} disabled={!song} />
      <IconButton icon={Maximize} label="展开播放器" onClick={onExpand} />
    </div>
    <div className="player-mobile-controls">
      <IconButton icon={isPlaying ? Pause : Play} label={isPlaying ? '暂停' : '播放'} className="player-mobile-play" disabled={!available}
        onClick={() => { void perform(model, () => model.playerCore.togglePlay(), '暂时无法播放，请重新选择歌曲') }} />
      <IconButton icon={ListMusic} label="查看待播列表" onClick={onShowQueue} />
    </div>
  </GlassSurface>
}

function QueueSection({ title, tracks, model, onRemove, activeQueue = false, queueKind }) {
  const [limit, setLimit] = useState(40)
  const { song, isPlaying } = playerView(model)
  if (!tracks.length) return null
  return <section className="queue-section" aria-label={title}>
    <h3>{title}<span>{tracks.length}</span></h3>
    <ol className="queue-list">
      {tracks.slice(0, limit).map((track, index) => <li key={`${songKey(track)}:${index}`} className={`queue-row ${songKey(song) === songKey(track) ? 'is-current' : ''}`}>
        <button type="button" className="queue-track-main" aria-label={`播放 ${track.title || '未命名歌曲'}，${track.artist || '未知歌手'}`}
          onClick={() => {
            const sourceQueue = activeQueue ? tracks : model.playerState.queue
            void perform(model, () => model.playTrack(track, sourceQueue), '这首歌曲暂时无法播放').then(result => {
              if (!result?.ok || activeQueue) return
              const current = model.playerCore.getState()
              // A slow playback response must not remove a user's newly
              // edited/rebuilt pending queue, or commit after another song won.
              if (songKey(current.currentTrack) === songKey(track) && current[queueKind] === tracks) onRemove?.(track)
            })
          }}>
          <AlbumArt song={track} />
          <span className="queue-copy"><strong>{track.title || '未命名歌曲'}</strong><small>{track.artist || '未知歌手'}</small></span>
          {songKey(song) === songKey(track) && isPlaying ? <span className="playing-mark" aria-label="正在播放">●</span> : <span className="queue-duration">{formatTime(track.duration)}</span>}
        </button>
        {onRemove && <IconButton icon={Trash} label={`从待播列表移除 ${track.title || '这首歌'}`} onClick={() => onRemove(track)} />}
      </li>)}
    </ol>
    {tracks.length > limit && <button type="button" className="text-button queue-load-more" onClick={() => setLimit(value => value + 40)}>显示更多歌曲</button>}
  </section>
}

function QueuePanel({ model }) {
  const { raw, song, mode } = playerView(model)
  const manual = raw.upNextTracks || []
  const automatic = raw.autoUpNextTracks || []
  const collection = model.playerState.queue || []
  const explicit = manual.length + automatic.length
  const automaticMode = mode.value === 'ai_recommend' || mode.value === 'companion_continue'
  if (!song && !explicit) return <EmptyState title="还没有正在播放的歌曲">选一首歌开始，播放列表会出现在这里。</EmptyState>
  return <div className="player-queue-content">
    <div className="queue-header"><span>{explicit ? `${explicit} 首待播` : '当前播放列表'}</span>
      {explicit > 0 && <button type="button" className="text-button" onClick={() => { raw.clearUpNext(); raw.clearAutoUpNext() }}><Trash size={14} aria-hidden="true" />清空待播</button>}
    </div>
    {automaticMode && <p className="queue-hint">{mode.label}已开启，播放时会继续补充推荐。</p>}
    <QueueSection title="下一首播放" tracks={manual} model={model} onRemove={raw.removeUpNext} queueKind="upNext" />
    <QueueSection title="为你续播" tracks={automatic} model={model} onRemove={raw.removeAutoUpNext} queueKind="autoUpNext" />
    <QueueSection title={explicit ? '当前播放列表' : mode.value === 'shuffle' ? '当前列表 · 随机播放' : '当前播放列表'} tracks={collection} model={model} activeQueue />
    {!explicit && !collection.length && <EmptyState title="待播列表是空的">在歌曲的更多菜单中选择“下一首播放”，把喜欢的音乐接在后面。</EmptyState>}
  </div>
}

function useSongResource(song, type) {
  const [retry, setRetry] = useState(0)
  const [state, setState] = useState({ key: '', status: 'idle', data: [], error: '' })
  const key = `${songKey(song)}:${type}:${retry}`
  const eligible = Boolean(song && (type === 'lyrics' || song.source === 'netease'))
  useEffect(() => {
    if (!eligible) return undefined
    let active = true
    const request = type === 'lyrics' ? loadSongLyrics(song) : fetchNeteaseSongComments(song.providerId || song.id, { limit: 12 })
    Promise.resolve(request).then(result => {
      if (!active) return
      const data = type === 'lyrics'
        ? (Array.isArray(result?.lines) ? result.lines : []).filter(line => line && String(line.text || '').trim()).map(line => ({ ...line, time: Math.max(0, Number(line.time) || 0) })).sort((a, b) => a.time - b.time)
        : Array.isArray(result) ? result : []
      setState({ key, status: 'ready', data, error: '' })
    }).catch(error => {
      if (active) setState({ key, status: 'error', data: [], error: error instanceof Error ? error.message : '内容暂时无法加载' })
    })
    // Both successful and failed results are invalidated on track/tab change
    // and unmount; old content never flashes under a new song's title.
    return () => { active = false }
  }, [eligible, key, song, type])
  return {
    ...(state.key === key ? state : { status: eligible ? 'loading' : 'idle', data: [], error: '' }),
    retry: () => setRetry(value => value + 1),
  }
}

function ResourceError({ resource }) {
  return <EmptyState title="暂时加载不了"><span>{resource.error}</span><br /><button type="button" className="text-button" onClick={resource.retry}>重新加载</button></EmptyState>
}

function LyricsPanel({ model, immersive = false, visible = true, effects, colors, font }) {
  const { song, time, raw, canSeek, duration } = playerView(model)
  const resource = useSongResource(song, 'lyrics')
  const listRef = useRef(null)
  const identity = songKey(song)
  const followTimer = useRef(null)
  const [manualTrack, setManualTrack] = useState(null)
  const resumeFollow = () => { clearTimeout(followTimer.current); setManualTrack(null) }
  const pauseFollow = () => {
    clearTimeout(followTimer.current)
    setManualTrack(identity)
    followTimer.current = setTimeout(() => setManualTrack(null), 5000)
  }
  useEffect(() => () => clearTimeout(followTimer.current), [])
  let activeIndex = -1
  for (let index = 0; index < resource.data.length; index += 1) {
    if (resource.data[index].time <= time + (effects?.timeOffset || 0) + 0.15) activeIndex = index
    else break
  }
  const interval = lyricInterval(resource.data, activeIndex, duration)
  useEffect(() => {
    const list = listRef.current
    if (!list || !visible || activeIndex < 0 || manualTrack === identity) return
    const follow = () => {
      const current = list.querySelector('[aria-current="true"]')
      if (!current) return
      const top = current.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop - list.clientHeight * (immersive ? 0.45 : 0.38) + (immersive ? current.clientHeight / 2 : 0)
      list.scrollTo?.({ top: Math.max(0, top), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    }
    follow()
    const observer = new ResizeObserver(follow)
    observer.observe(list)
    const activeLine = list.querySelector('[aria-current="true"]')
    if (activeLine) observer.observe(activeLine)
    document.fonts?.addEventListener('loadingdone', follow)
    return () => { observer.disconnect(); document.fonts?.removeEventListener('loadingdone', follow) }
  }, [activeIndex, identity, immersive, manualTrack, visible])
  if (!song) return <EmptyState title="选择歌曲后查看歌词" />
  if (resource.status === 'loading') return <LoadingState>正在加载歌词…</LoadingState>
  if (resource.status === 'error') return <ResourceError resource={resource} />
  const instrumental = resource.data.length > 0 && resource.data.every(line => /^纯音乐[，,、\s]*(?:请欣赏|敬请欣赏)?[。.!！]?$/.test(line.text.trim()))
  if (immersive && (instrumental || !resource.data.length)) return <div className="immersive-lyric-empty">
    <AudioLines size={30} strokeWidth={1.3} aria-hidden="true" /><p>{instrumental ? '纯音乐' : '此刻，听音乐'}</p>
    <h2>{instrumental ? '让旋律慢慢展开' : '把时间留给旋律'}</h2><span>{instrumental ? '无需言语，也能听见心情。' : '这首歌暂无歌词，静静听一会儿。'}</span>
  </div>
  if (!resource.data.length) return <EmptyState title="这首歌暂无歌词">先让旋律陪你听一会儿。</EmptyState>
  return <div className={`player-lyrics-content ${immersive ? 'player-lyrics-content--immersive lyric-fx' : ''}`}
    style={immersive && effects ? lyricEffectStyle(effects, colors, font) : undefined}>
    <div className="lyric-guidance"><p className="lyric-hint">{canSeek ? '点按歌词，听这一句' : '歌词随播放进度滚动'}</p>{manualTrack === identity && <button type="button" className="lyric-resume" onClick={resumeFollow}>回到当前歌词</button>}</div>
    <ol ref={listRef} className="lyric-list" aria-label={`${song.title || '当前歌曲'}的歌词`}
      tabIndex={0} onWheel={pauseFollow} onTouchStart={pauseFollow}
      onKeyDown={event => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) pauseFollow() }}>
      {resource.data.map((line, index) => <li key={`${line.time}:${index}`} className={`lyric-line ${index === activeIndex ? 'is-active' : ''}`}>
        <button type="button" aria-current={index === activeIndex ? 'true' : undefined} disabled={!canSeek}
          aria-label={`${line.text}，跳转到 ${formatTime(line.time)}`} onClick={() => { resumeFollow(); raw.seekTo(line.time) }}>
          {immersive && effects && index === activeIndex ? <ImmersiveLyricText text={line.text} interval={interval} settings={effects} audioRef={raw.audioRef} time={time} visible={visible} /> : line.text}
        </button>
      </li>)}
    </ol>
  </div>
}

function CommentCards({ comments }) {
  return comments.map((comment, index) => <li className="comment-card" key={comment.id || index}>
    <header><span className="comment-avatar" aria-hidden="true">{String(comment.user || '听众').slice(0, 1)}</span><strong>{comment.user || '一位听众'}</strong></header>
    <p>{comment.content}</p><span className="comment-likes"><Heart size={13} aria-hidden="true" />{Math.max(0, Number(comment.likedCount) || 0)}</span>
  </li>)
}

function ImmersiveComments({ comments, song }) {
  const listRef = useRef(null)
  const scroller = useRef(null)
  const [paused, setPaused] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const list = listRef.current
    const motion = matchMedia('(prefers-reduced-motion: reduce)')
    const controller = createCommentAutoScroll(list, { onEnd: () => setPaused(true) })
    scroller.current = controller
    controller.setPaused('manual', motion.matches)
    controller.setPaused('hover', matchMedia('(hover: hover)').matches && list.matches(':hover'))
    const visibility = () => controller.setPaused('hidden', document.hidden)
    const blur = () => controller.setPaused('window', true)
    const focus = () => controller.setPaused('window', false)
    const reduceMotion = event => { if (event.matches) { controller.setPaused('manual', true); setPaused(true) } }
    visibility()
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('blur', blur)
    window.addEventListener('focus', focus)
    motion.addEventListener('change', reduceMotion)
    return () => {
      controller.destroy()
      scroller.current = null
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('blur', blur)
      window.removeEventListener('focus', focus)
      motion.removeEventListener('change', reduceMotion)
    }
  }, [])
  const pause = () => { scroller.current?.setPaused('manual', true); setPaused(true) }
  const toggle = () => {
    if (paused) scroller.current?.restartIfEnded()
    scroller.current?.setPaused('manual', !paused)
    setPaused(!paused)
  }
  return <section className="immersive-comments" aria-label="歌曲评论">
    <div className="immersive-comments-heading"><p className="comments-source">来自网易云音乐的热门评论</p>
      <IconButton icon={paused ? Play : Pause} label={paused ? '继续自动滚动评论' : '暂停自动滚动评论'} onClick={toggle} />
    </div>
    <ol ref={listRef} className="comments-list immersive-comments-scroll" tabIndex={0} aria-label={`${song.title || '当前歌曲'}的热门评论`}
      onPointerEnter={event => { if (event.pointerType !== 'touch') scroller.current?.setPaused('hover', true) }}
      onPointerLeave={() => scroller.current?.setPaused('hover', false)}
      onPointerDown={pause} onTouchStart={pause} onWheel={pause}
      onFocus={() => scroller.current?.setPaused('focus', true)} onBlur={() => scroller.current?.setPaused('focus', false)}
      onKeyDown={event => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) pause() }}>
      <CommentCards comments={comments} />
    </ol>
  </section>
}

function CommentsPanel({ model, immersive = false }) {
  const { song } = playerView(model)
  const resource = useSongResource(song, 'comments')
  if (!song) return <EmptyState title="选择歌曲后查看评论" icon={Message} />
  if (song.source !== 'netease') return <EmptyState title="本地歌曲没有在线评论" icon={Message}>网易云歌曲可以在这里查看热门评论。</EmptyState>
  if (resource.status === 'loading') return <LoadingState>正在加载热门评论…</LoadingState>
  if (resource.status === 'error') return <ResourceError resource={resource} />
  if (!resource.data.length) return <EmptyState title="暂时没有可展示的评论" icon={Message} />
  if (immersive) return <ImmersiveComments key={songKey(song)} comments={resource.data} song={song} />
  return <div className="player-comments-content"><p className="comments-source">来自网易云音乐的热门评论</p>
    <ol className="comments-list"><CommentCards comments={resource.data} /></ol>
  </div>
}

function PlayerDetails({ model, tab, setTab }) {
  const id = useId()
  const active = TABS.some(item => item.value === tab) ? tab : 'queue'
  const tabRefs = useRef([])
  return <div className="player-details">
    <div className="rail-tabs player-detail-tabs" role="tablist" aria-label="播放详情">
      {TABS.map((item, index) => <button type="button" role="tab" key={item.value} ref={node => { tabRefs.current[index] = node }}
        id={`${id}-${item.value}-tab`} aria-controls={`${id}-panel`} aria-selected={active === item.value} tabIndex={active === item.value ? 0 : -1}
        className={active === item.value ? 'is-active' : ''} onClick={() => setTab(item.value)}
        onKeyDown={event => {
          let nextIndex
          if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length
          else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length
          else if (event.key === 'Home') nextIndex = 0
          else if (event.key === 'End') nextIndex = TABS.length - 1
          else return
          event.preventDefault()
          setTab(TABS[nextIndex].value)
          tabRefs.current[nextIndex]?.focus()
        }}>{item.label}</button>)}
    </div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${active}-tab`} className={`player-detail-content player-detail-content--${active}`} tabIndex="0">
      {active === 'queue' ? <QueuePanel model={model} /> : active === 'lyrics' ? <LyricsPanel model={model} /> : <CommentsPanel model={model} />}
    </div>
  </div>
}

export function NowPlayingRail({ model, tab, setTab, onExpand }) {
  const { song } = playerView(model)
  return <aside className="now-playing-rail" aria-label="正在播放">
    {song ? <>
      <button type="button" className="rail-cover-button" onClick={onExpand} aria-label={`展开 ${song.title} 的播放详情`}>
        <AlbumArt song={song} className="rail-cover" priority /><span className="rail-cover-expand"><Maximize size={17} aria-hidden="true" /></span>
      </button>
      <div className="rail-track"><div><h2 className="rail-track-title">{song.title || '未命名歌曲'}</h2><p className="rail-track-artist">{song.artist || '未知歌手'}</p></div><LikeButton model={model} song={song} /></div>
      <PlayerDetails model={model} tab={tab} setTab={setTab} />
    </> : <EmptyState title="把时间留给音乐">选一首喜欢的歌，歌词和待播列表会在这里陪你。</EmptyState>}
  </aside>
}

function ImmersiveDetails({ model, onClose, id }) {
  const closeRef = useRef(null)
  useEffect(() => {
    const frame = requestAnimationFrame(() => closeRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])
  return <GlassSurface as="aside" className="immersive-details" radius={24} id={id} aria-label="待播列表"
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }}>
    <header><h2>待播列表</h2><IconButton ref={closeRef} icon={Close} label="关闭待播列表" onClick={onClose} /></header>
    <div className="immersive-details-body"><QueuePanel model={model} /></div>
  </GlassSurface>
}

export function ExpandedPlayer({ model, initialTab = 'lyrics', onClose }) {
  const background = useImmersiveBackground()
  const lyricEffects = useLyricEffects()
  const [coverPalette, setCoverPalette] = useState(null)
  const colors = lyricColors(lyricEffects.settings, coverPalette)
  const [section, setSection] = useState(initialTab === 'queue' || initialTab === 'comments' ? initialTab : null)
  const [sceneStatus, setSceneStatus] = useState('loading')
  const [entered, setEntered] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const recordSlot = useRef(null)
  const exitTimer = useRef(null)
  const opener = useRef(null)
  const detailId = useId()
  const wordsId = useId()
  const { song, isPlaying } = playerView(model)
  const fontSelection = resolveLyricFont(lyricEffects.settings, song)
  const fontUnavailable = useLyricFont(fontSelection.font)
  const showingQueue = section === 'queue'
  const showingComments = section === 'comments'
  const editingBackground = section === 'background'
  const editingLyrics = section === 'lyric-effects'
  useEffect(() => {
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => setEntered(true)) })
    return () => cancelAnimationFrame(frame)
  }, [])
  useEffect(() => () => clearTimeout(exitTimer.current), [])
  const requestClose = useCallback(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { onClose(); return }
    setLeaving(true)
    clearTimeout(exitTimer.current)
    exitTimer.current = setTimeout(onClose, 520)
  }, [onClose])
  const closeDetails = () => { setSection(null); opener.current?.focus() }
  const toggleDetails = (value, event) => {
    if (section === value) { closeDetails(); return }
    opener.current = event.currentTarget
    setSection(value)
  }
  return <Modal title="沉浸播放" onClose={requestClose} immersive className={`immersive-player--record ${entered ? 'is-entered' : ''} ${sceneStatus === 'ready' ? 'is-scene-ready' : ''} ${showingQueue ? 'has-queue-overlay' : ''} ${editingBackground ? 'is-tuning-background' : ''} ${editingLyrics ? 'is-tuning-lyrics' : ''} ${leaving ? 'is-leaving' : ''}`}>
    {song && <Suspense fallback={null}><ImmersiveRecordScene slot={recordSlot} cover={song.coverUrl || song.coverPath} trackKey={songKey(song)} playing={isPlaying} recordVisible={!editingLyrics} backgroundSettings={background.settings} onStatus={setSceneStatus} onPalette={setCoverPalette} /></Suspense>}
    <header className="immersive-header">
      <div className="immersive-back"><IconButton icon={ChevronDown} label="收起沉浸播放" className="round-button" onClick={requestClose} /><span>昀 <span aria-hidden="true">/</span> 此刻在听</span></div>
      <div className="immersive-actions">
        <button type="button" aria-label="调整歌词特效" title="调整歌词特效" aria-pressed={editingLyrics} aria-controls={detailId} onClick={event => toggleDetails('lyric-effects', event)}><Sparkles size={19} aria-hidden="true" /></button>
        <button type="button" aria-label="调整矿脉背景" title="调整矿脉背景" aria-pressed={editingBackground} aria-controls={detailId} onClick={event => toggleDetails('background', event)}><Sliders size={19} aria-hidden="true" /></button>
        <button type="button" aria-expanded={section === 'queue'} aria-controls={detailId} onClick={event => toggleDetails('queue', event)}><ListMusic size={19} aria-hidden="true" /><span>待播列表</span></button>
        <button type="button" aria-pressed={showingComments} aria-controls={wordsId} title={showingComments ? '回到歌词' : '查看评论'} onClick={() => setSection(showingComments ? null : 'comments')}><Message size={19} aria-hidden="true" /><span>评论</span></button>
      </div>
    </header>
    {song ? <div className="immersive-stage">
      <section className="immersive-album" aria-label="正在播放的歌曲" inert={editingLyrics ? true : undefined} aria-hidden={editingLyrics || undefined}>
        <div ref={recordSlot} className="immersive-record-slot" role="img" aria-label={`${song.title || '当前歌曲'}的实体唱片`}><div className="immersive-disc-placeholder"><AlbumArt song={song} priority /></div></div>
        <div className="immersive-track"><p className="immersive-eyebrow">正在播放</p><h1>{song.title || '未命名歌曲'}</h1><p className="immersive-artist">{song.artist || '未知歌手'}</p>{song.album && <p className="immersive-album-name">{song.album}</p>}</div>
        <LikeButton model={model} song={song} />
        <a className="immersive-credit" href="https://github.com/annnguyentt/vibe-coding/tree/efba8dfb956cca848422f18e8ede1bdf96033fca/cd-case" target="_blank" rel="noreferrer">唱片设计 Ann Nguyen · TypingMind</a>
      </section>
      <div className="immersive-words" id={wordsId} hidden={editingBackground}>
        <div className="immersive-reading-layer" hidden={showingComments}><LyricsPanel key={songKey(song)} model={model} immersive effects={lyricEffects.settings} colors={colors} font={fontSelection.font} visible={!showingComments && !editingBackground} /></div>
        {showingComments && <div className="immersive-reading-layer" key={`${songKey(song)}:comments`}><CommentsPanel model={model} immersive /></div>}
      </div>
      {editingBackground && <ImmersiveBackgroundEditor id={detailId} background={background} onClose={closeDetails} />}
      {editingLyrics && <LyricEffectsEditor id={detailId} effects={lyricEffects} colors={colors} selection={fontSelection} song={song} fontUnavailable={fontUnavailable} onClose={closeDetails} />}
    </div> : <EmptyState title="选一首喜欢的歌，慢慢听">收起播放画面，从音乐库里开始。</EmptyState>}
    {song && showingQueue && <ImmersiveDetails id={detailId} model={model} onClose={closeDetails} />}
    <footer className="immersive-footer" aria-label="沉浸播放控制">
      <Timeline model={model} minimal />
      <div className="immersive-controls"><PlaybackModeButton model={model} className="immersive-mode" />
        <GlassSurface className="immersive-transport" radius={50}><Transport model={model} showMode={false} /></GlassSurface><VolumeControl model={model} />
      </div>
    </footer>
    {model.notice && <div className="music-toast" role="status">{model.notice}</div>}
  </Modal>
}
