import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PlayerProvider } from '../player/react/PlayerProvider.jsx'
import { useMusicApp } from './useMusicApp.js'
import LiquidGlassLayer from './LiquidGlassLayer.jsx'
import GlassSurface, { LiquidGlassProvider } from './GlassSurface.jsx'
import { PlayerBar, NowPlayingRail, ExpandedPlayer } from './PlayerPanel.jsx'
import CompanionPanel from './CompanionPanel.jsx'
import { AlbumArt, EmptyState, IconButton, LoadingState, Modal, TrackList } from './components.jsx'
import { Home, Search, Library, Heart, Clock, Settings, Message, Login, ChevronLeft, ChevronRight, Play, More, Upload, Plus, Headphones, AudioLines, QueueAdd, Download, Check } from './icons.js'
import { addSongToNeteaseCollection, fetchNeteaseCloud, fetchNeteaseDailySongs, fetchNeteasePersonalFm, fetchNeteasePodcasts, fetchNeteasePodcastPrograms, fetchNeteasePlaylistTracks, fetchNeteaseRecentHistory, resolveNeteaseStreamQuality } from '../api/neteaseApi.js'
import { loadPaginatedCollection } from '../boot/playlistLoader.js'
import './music.css'
import './music-theme.css'
import AppearanceToggle from './AppearanceToggle.jsx'
import { useMusicAppearance } from './useMusicAppearance.js'

const MusicSettings = lazy(() => import('./MusicSettings.jsx'))
const AccountPanel = lazy(() => import('./AccountPanel.jsx'))
const NativeVoiceBridge = lazy(() => import('./NativeVoiceBridge.jsx'))
const PAGE_TITLES = { discover: '为你推荐', search: '搜索', library: '我的音乐', liked: '喜欢的音乐', recent: '最近播放', playlist: '歌单', companion: '昀，陪你听' }
const NAVIGATION = [{ id: 'discover', label: '为你推荐', short: '为你', icon: Home }, { id: 'search', label: '搜索', short: '搜索', icon: Search }, { id: 'library', label: '我的音乐', short: '音乐库', icon: Library }, { id: 'companion', label: '昀，陪你听', short: '陪伴', icon: Message }]
const SOURCE_FILTERS = [{ id: 'all', label: '全部' }, { id: 'local', label: '本地音乐' }, { id: 'netease', label: '网易云' }]
const trackKey = song => String(song?.providerId || song?.id || song?.fileUrl || '')
const readHistory = () => { try { const value = JSON.parse(localStorage.getItem('yun_recent_tracks_v2') || '[]'); return Array.isArray(value) ? value.filter(song => song?.fileUrl).slice(0, 40) : [] } catch { return [] } }
const uniqueTracks = tracks => { const seen = new Set(); return tracks.filter(song => { const key = trackKey(song); if (!key || !song?.fileUrl || seen.has(key)) return false; seen.add(key); return true }) }

export default function MusicApp({ bootData = {}, bootState = null }) {
  const appearance = useMusicAppearance()
  const controller = useMusicApp({ bootData, bootState })
  const { playTrack: controllerPlayTrack, setNotice, playerCore } = controller
  const playbackIntent = useRef(0)
  const playTrack = useCallback((...args) => { playbackIntent.current += 1; return controllerPlayTrack(...args) }, [controllerPlayTrack])
  const model = { ...controller, playTrack }
  const [navigation, setNavigation] = useState({ entries: [{ page: 'discover' }], index: 0 })
  const entry = navigation.entries[navigation.index]
  const page = entry.page
  const [source, setSource] = useState('all')
  const [query, setQuery] = useState('')
  const libraryTab = entry.collection || 'local'
  const [panel, setPanel] = useState(null)
  const [railTab, setRailTab] = useState('queue')
  const selectedPlaylist = entry.playlist || null
  const [playlistCache, setPlaylistCache] = useState({})
  const [trackMenu, setTrackMenu] = useState(null)
  const [recentTracks, setRecentTracks] = useState(readHistory)
  const [collections, setCollections] = useState({})
  const collectionKey = entry.podcast ? `podcast:${entry.podcast.id}` : page === 'liked' || page === 'recent' ? page : libraryTab
  const collectionRecord = collections[collectionKey] || { status: 'idle', tracks: [], podcasts: [] }
  const remoteTracks = collectionRecord.tracks || []
  const collectionStatus = collectionRecord.status
  const collectionError = collectionRecord.error || ''
  const podcasts = collectionRecord.podcasts || []
  const [visibleTracks, setVisibleTracks] = useState(80)
  const [glassEnabled, setGlassEnabled] = useState(() => { try { return localStorage.getItem('yun_glass_enabled') !== 'false' } catch { return true } })
  const [menuStatus, setMenuStatus] = useState('')
  const collectionEpoch = useRef(0)
  const playlistRequest = useRef(null)
  const homeRequest = useRef(0)
  const importRef = useRef(null)
  const searchRef = useRef(null)
  const screenRef = useRef(null)
  const current = model.playerState.currentTrack
  const loggedIn = Boolean(model.account.info?.loggedIn)
  const playlists = model.account.playlists
  const accountIdentity = loggedIn ? String(model.account.info?.userId || model.account.info?.nickname || 'connected') : 'logged-out'
  const previousAccount = useRef(accountIdentity)
  const playlistRecord = playlistCache[selectedPlaylist?.id] || { status: 'idle', songs: [] }
  const closePanel = useCallback(() => setPanel(null), [])
  const closeTrackMenu = useCallback(() => { setTrackMenu(null); setMenuStatus('') }, [])
  const navigate = useCallback((next, context = {}) => {
    collectionEpoch.current += 1
    screenRef.current?.scrollTo({ top: 0, behavior: 'instant' })
    setNavigation(previous => {
      const current = previous.entries[previous.index]
      if (current.page === next && current.playlist?.id === context.playlist?.id && current.collection === context.collection && current.podcast?.id === context.podcast?.id) return previous
      return { entries: [...previous.entries.slice(0, previous.index + 1), { page: next, ...context }], index: previous.index + 1 }
    })
  }, [])
  const moveNavigation = direction => { collectionEpoch.current += 1; setNavigation(previous => ({ ...previous, index: previous.index + direction })) }
  const openSettings = useCallback(() => setPanel('settings'), [])
  const openLogin = useCallback(() => setPanel('login'), [])
  const openExpanded = useCallback(() => setPanel('player'), [])
  const openQueue = useCallback(() => { setRailTab('queue'); setPanel('queue') }, [])
  const openLyrics = useCallback(() => { setRailTab('lyrics'); setPanel('lyrics') }, [])
  const showTrackMenu = useCallback((song, _element, queue = [song]) => { setTrackMenu({ song, queue }); setMenuStatus('') }, [])

  useEffect(() => {
    playbackIntent.current += 1
  }, [current?.id, model.playerState.isPlaying])
  useEffect(() => {
    if (previousAccount.current === accountIdentity) return undefined
    previousAccount.current = accountIdentity
    collectionEpoch.current += 1
    playlistRequest.current?.abort()
    const timer = window.setTimeout(() => {
      setCollections({}); setPlaylistCache({})
      setNavigation(previous => ['playlist', 'liked'].includes(previous.entries[previous.index].page) ? { entries: [{ page: 'library' }], index: 0 } : previous)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [accountIdentity])
  useEffect(() => () => { playlistRequest.current?.abort(); collectionEpoch.current += 1 }, [])
  useEffect(() => {
    const onGlass = event => setGlassEnabled(event.detail?.enabled !== false)
    window.addEventListener('yun:glass-setting', onGlass)
    window.addEventListener('yun:open-login', openLogin)
    return () => { window.removeEventListener('yun:glass-setting', onGlass); window.removeEventListener('yun:open-login', openLogin) }
  }, [openLogin])
  useEffect(() => {
    const onShortcut = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); navigate('search'); searchRef.current?.focus() }
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [navigate])
  useEffect(() => {
    if (!current?.fileUrl) return
    const previous = readHistory()
    const next = uniqueTracks([current, ...previous]).slice(0, 40)
    try { localStorage.setItem('yun_recent_tracks_v2', JSON.stringify(next)) } catch { /* Playback works without available storage. */ }
    // This effect is keyed by track identity, not the playback clock.
    const update = window.setTimeout(() => setRecentTracks(next), 0)
    return () => window.clearTimeout(update)
  }, [current])
  useEffect(() => {
    screenRef.current?.scrollTo({ top: 0, behavior: 'instant' })
    window.dispatchEvent(new Event('yun:glass-refresh'))
    if (page === 'search') searchRef.current?.focus()
  }, [page, entry.collection, entry.playlist?.id, entry.podcast?.id])
  useEffect(() => {
    if (!model.notice) return undefined
    const timer = window.setTimeout(() => setNotice(''), 6500)
    return () => window.clearTimeout(timer)
  }, [model.notice, setNotice])

  const selectPlaylist = useCallback(async playlist => {
    playlistRequest.current?.abort()
    const request = new AbortController()
    playlistRequest.current = request
    setVisibleTracks(80)
    navigate('playlist', { playlist })
    setPlaylistCache(previous => ({ ...previous, [playlist.id]: { status: 'loading', songs: [] } }))
    try {
      const songs = await fetchNeteasePlaylistTracks(playlist.id, { signal: request.signal })
      if (!request.signal.aborted) setPlaylistCache(previous => ({ ...previous, [playlist.id]: { status: 'ready', songs } }))
    } catch (error) {
      if (!request.signal.aborted) setPlaylistCache(previous => ({ ...previous, [playlist.id]: { status: 'error', songs: [], error: error.message } }))
    }
  }, [navigate])

  const fetchCollection = useCallback(async kind => {
    if (!loggedIn) { openLogin(); return }
    setVisibleTracks(80)
    if (kind === 'liked') navigate('liked')
    else if (kind === 'recent') navigate('recent')
    else navigate('library', { collection: kind })
    const epoch = ++collectionEpoch.current
    const intent = playbackIntent.current
    setCollections(previous => ({ ...previous, [kind]: { status: 'loading', tracks: [], podcasts: [], requestId: epoch } }))
    try {
      let tracks = [], podcastList = []
      if (kind === 'liked') {
        const liked = playlists.find(playlist => playlist.liked)
        if (!liked) throw new Error('没有找到喜欢的音乐歌单，请刷新网易云连接后重试。')
        tracks = await fetchNeteasePlaylistTracks(liked.id)
      } else if (kind === 'daily') tracks = await fetchNeteaseDailySongs()
      else if (kind === 'fm') tracks = await fetchNeteasePersonalFm()
      else if (kind === 'cloud') { const response = await loadPaginatedCollection({ pageSize: 100, fetchPage: async ({ offset, limit }) => { const data = await fetchNeteaseCloud({ offset, limit }); return { ...data, items: data.songs || [] } } }); tracks = response.items }
      else if (kind === 'recent') { const response = await fetchNeteaseRecentHistory({ limit: 100 }); tracks = response.songs || [] }
      else if (kind === 'podcasts') { const response = await loadPaginatedCollection({ pageSize: 60, fetchPage: async ({ offset, limit }) => { const data = await fetchNeteasePodcasts({ offset, limit }); return { ...data, items: data.podcasts || [] } } }); podcastList = response.items }
      setCollections(previous => previous[kind]?.requestId !== epoch ? previous : ({ ...previous, [kind]: { status: 'ready', tracks: tracks || [], podcasts: podcastList } }))
      if (epoch === collectionEpoch.current && kind === 'fm' && tracks.length && intent === playbackIntent.current) { playerCore.setPlaybackMode('sequence'); await playTrack(tracks[0], tracks) }
    } catch (error) { setCollections(previous => previous[kind]?.requestId !== epoch ? previous : ({ ...previous, [kind]: { status: 'error', tracks: [], error: error.message || '暂时无法读取，请重试。' } })) }
  }, [loggedIn, playTrack, playerCore, navigate, openLogin, playlists])

  const openPodcast = async podcast => {
    navigate('library', { collection: 'podcasts', podcast })
    const epoch = ++collectionEpoch.current
    const key = `podcast:${podcast.id}`
    setCollections(previous => ({ ...previous, [key]: { status: 'loading', tracks: [], requestId: epoch } }))
    try {
      const response = await loadPaginatedCollection({ pageSize: 100, fetchPage: async ({ offset, limit }) => { const data = await fetchNeteasePodcastPrograms(podcast.id, { offset, limit }); return { ...data, items: data.programs || [] } } })
      setCollections(previous => previous[key]?.requestId !== epoch ? previous : ({ ...previous, [key]: { status: 'ready', tracks: response.items.map(program => program.song).filter(Boolean) } }))
    } catch (error) { setCollections(previous => previous[key]?.requestId !== epoch ? previous : ({ ...previous, [key]: { status: 'error', tracks: [], error: error.message } })) }
  }

  const submitSearch = event => {
    event?.preventDefault()
    navigate('search')
    setVisibleTracks(80)
    if (query.trim()) void model.search.run(query, source)
    else searchRef.current?.focus()
  }

  const homeOnlineTracks = collections.daily?.tracks
  const filteredRecommendations = useMemo(() => uniqueTracks([...model.recommendations, ...(homeOnlineTracks || [])]).filter(song => source === 'all' || (song.source || 'local') === source), [model.recommendations, homeOnlineTracks, source])
  const chooseSource = async nextSource => {
    setSource(nextSource)
    if (nextSource !== 'netease' || !loggedIn || collections.daily?.status === 'ready' || collections.daily?.status === 'loading') return
    const requestId = -(++homeRequest.current)
    setCollections(previous => ({ ...previous, daily: { status: 'loading', tracks: [], requestId } }))
    try {
      const tracks = await fetchNeteaseDailySongs()
      setCollections(previous => previous.daily?.requestId !== requestId ? previous : ({ ...previous, daily: { status: 'ready', tracks } }))
    } catch (error) {
      setCollections(previous => previous.daily?.requestId !== requestId ? previous : ({ ...previous, daily: { status: 'error', tracks: [], error: error.message } }))
    }
  }
  const continueCollection = uniqueTracks([...recentTracks, ...filteredRecommendations]).filter(song => source === 'all' || (song.source || 'local') === source)
  const continueTracks = continueCollection.slice(0, 4)
  const recentCollection = source === 'netease' ? filteredRecommendations : model.library.songs
  const recentAdded = recentCollection.slice(0, 6)
  const currentId = current?.id
  const playCollection = tracks => {
    if (!tracks.length) { navigate('library'); return }
    void model.playTrack(tracks[0], tracks)
  }
  const importMusic = async event => { const files = event.target.files; if (files?.length) await model.library.importFiles(files); event.target.value = '' }
  const fullTracks = page === 'playlist' ? playlistRecord.songs
    : page === 'search' ? model.search.results
      : page === 'liked' ? remoteTracks
        : page === 'recent' ? uniqueTracks([...recentTracks, ...remoteTracks])
          : libraryTab === 'local' ? model.library.songs : remoteTracks

  const trackAction = async action => {
    const { song, queue } = trackMenu
    setMenuStatus('')
    try {
      if (action === 'play') await model.playTrack(song, queue)
      if (action === 'queue') { model.playerCore.enqueueUpNext(song); model.setNotice(`已加入待播：${song.title}`) }
      if (action === 'like') { await addSongToNeteaseCollection({ song, target: 'liked' }); model.setNotice('已同步到网易云喜欢的音乐') }
      if (action === 'quality') { const resolved = await resolveNeteaseStreamQuality(song, 'lossless'); await model.playTrack({ ...song, ...resolved }, queue); model.setNotice('已切换到当前账户可用的无损音源') }
      closeTrackMenu()
    } catch (error) { setMenuStatus(error.message || '这次操作未完成，请重试。') }
  }

  const goLocal = () => { setVisibleTracks(80); navigate('library') }
  const renderTrackList = (tracks, emptyTitle) => <>
    <TrackList tracks={tracks.slice(0, visibleTracks)} currentId={currentId} isPlaying={model.playerState.isPlaying}
      onPlay={song => model.playTrack(song, tracks)} onMore={song => showTrackMenu(song, null, tracks)} emptyTitle={emptyTitle} />
    {tracks.length > visibleTracks && <button type="button" className="button button--secondary load-more" onClick={() => setVisibleTracks(value => value + 80)}>显示更多 <span>{Math.min(visibleTracks, tracks.length)} / {tracks.length}</span></button>}
  </>

  return <PlayerProvider core={model.playerCore}><LiquidGlassProvider enabled={glassEnabled}>
    <LiquidGlassLayer cover={current?.coverUrl || current?.coverPath} theme={appearance.theme} suspended={['player', 'queue', 'lyrics'].includes(panel)} />
    <div className="music-app" data-theme={appearance.theme} data-player-expanded={['player', 'queue', 'lyrics'].includes(panel) || undefined}>
      <a className="skip-link" href="#music-content">跳转到音乐内容</a>
      <input ref={importRef} className="visually-hidden" tabIndex={-1} type="file" accept="audio/*,.flac,.mp3,.wav,.m4a,.ogg,.aac" multiple aria-label="导入本地音乐文件" onChange={importMusic} />
      <GlassSurface as="aside" className="music-sidebar" aria-label="主导航">
        <button type="button" className="brand" onClick={() => navigate('discover')} aria-label="昀音乐首页"><strong>昀</strong><span>YUN</span></button>
        <nav className="main-navigation">
          {NAVIGATION.slice(0, 3).map(item => <button key={item.id} type="button" className={`nav-item ${page === item.id || item.id === 'library' && page === 'playlist' ? 'is-active' : ''}`} onClick={() => { if (item.id === 'library') goLocal(); else navigate(item.id) }} aria-current={page === item.id ? 'page' : undefined}><item.icon size={21} strokeWidth={1.6} /><span>{item.label}</span></button>)}
          <button type="button" className={`nav-item ${page === 'liked' ? 'is-active' : ''}`} onClick={() => void fetchCollection('liked')}><Heart size={21} strokeWidth={1.6} /><span>喜欢的音乐</span></button>
          <button type="button" className={`nav-item ${page === 'recent' ? 'is-active' : ''}`} onClick={() => { navigate('recent'); setVisibleTracks(80); if (loggedIn) void fetchCollection('recent') }}><Clock size={21} strokeWidth={1.6} /><span>最近播放</span></button>
        </nav>
        <div className="sidebar-section-heading"><span>我的歌单</span><IconButton icon={Plus} label="导入音乐到本地音乐库" onClick={() => importRef.current?.click()} /></div>
        <div className="sidebar-playlists">
          {playlists.slice(0, 12).map(playlist => <button key={playlist.id} className={`sidebar-playlist ${page === 'playlist' && String(selectedPlaylist?.id) === String(playlist.id) ? 'is-active' : ''}`} onClick={() => void selectPlaylist(playlist)}><AlbumArt src={playlist.coverUrl || playlist.coverImgUrl} /><span><strong>{playlist.name}</strong><small>{playlist.trackCount ?? playlist.songs?.length ?? 0} 首</small></span></button>)}
          {!playlists.length && <p className="sidebar-empty">连接网易云，<br />把收藏的歌单带过来。</p>}
        </div>
        <div className="sidebar-bottom">
          <button type="button" className={`nav-item ${page === 'companion' ? 'is-active' : ''}`} onClick={() => navigate('companion')}><Message size={21} strokeWidth={1.6} /><span>昀，陪你听</span></button>
          <div className="sidebar-divider" />
          <button type="button" className="nav-item account-button" onClick={openLogin}><Login size={21} strokeWidth={1.6} /><span>{loggedIn ? model.account.info?.nickname || '网易云已连接' : '连接网易云账号'}</span>{loggedIn && <Check size={15} />}</button>
          <button type="button" className="nav-item" onClick={openSettings}><Settings size={21} strokeWidth={1.6} /><span>设置</span></button>
        </div>
      </GlassSurface>

      <div className="music-workspace">
        <header className="music-topbar">
          <div className="desktop-history"><IconButton icon={ChevronLeft} label="返回上一页" disabled={navigation.index === 0} onClick={() => moveNavigation(-1)} /><IconButton icon={ChevronRight} label="前往下一页" disabled={navigation.index >= navigation.entries.length - 1} onClick={() => moveNavigation(1)} /></div>
          <button type="button" className="brand mobile-brand" onClick={() => navigate('discover')} aria-label="昀音乐首页"><strong>昀</strong><span>YUN</span></button>
          {page !== 'search' && <GlassSurface as="form" className="global-search" radius={24} onSubmit={submitSearch} role="search"><Search size={20} strokeWidth={1.7} aria-hidden="true" /><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} aria-label="搜索歌曲、歌手、专辑" placeholder="搜索歌曲、歌手、专辑" autoComplete="off" /><kbd>Ctrl K</kbd></GlassSurface>}
          <div className="topbar-actions"><AppearanceToggle dark={appearance.theme === 'dark'} onChange={() => appearance.setMode(appearance.theme === 'dark' ? 'light' : 'dark')} /><IconButton icon={Message} label="打开昀的陪伴聊天" onClick={() => navigate('companion')} className="round-button" /><IconButton icon={Settings} label="打开设置" onClick={openSettings} className="mobile-settings round-button" /><button type="button" className="account-avatar" aria-label={loggedIn ? '管理网易云账号' : '连接网易云账号'} onClick={openLogin}>{model.account.info?.avatar ? <img src={model.account.info.avatar} alt="" /> : <Headphones size={20} strokeWidth={1.5} />}</button></div>
        </header>

        <main id="music-content" ref={screenRef} className={`music-content ${page === 'companion' ? 'music-content--chat' : ''}`} tabIndex={-1}>
          {page === 'companion' ? <CompanionPanel model={model} onSettings={openSettings} /> : <>
            <header className="page-heading"><div><h1>{page === 'playlist' ? selectedPlaylist?.name || '歌单' : PAGE_TITLES[page]}</h1><p>{page === 'discover' ? '本地与网易云，放在一起听。' : page === 'search' ? '找到想听的那一首。' : page === 'playlist' ? `${playlistRecord.songs.length} 首音乐 · 网易云歌单` : page === 'liked' ? '喜欢的旋律，随时回来。' : page === 'recent' ? '从上一次心动的地方，接着听。' : '把喜欢的音乐，放在一起。'}</p></div>{page === 'library' && libraryTab === 'local' && <button type="button" className="button button--secondary import-button" disabled={model.library.importing} onClick={() => importRef.current?.click()}><Upload size={17} />{model.library.importing ? '正在导入…' : '导入音乐'}</button>}</header>
            {page === 'discover' && <>
              <GlassSurface as="form" className="mobile-search" radius={24} role="search" onSubmit={submitSearch}><Search size={21} /><input value={query} onChange={event => setQuery(event.target.value)} aria-label="手机搜索歌曲、歌手、专辑" placeholder="搜索歌曲、歌手、专辑" /></GlassSurface>
              <div className="source-filters" role="group" aria-label="推荐音乐来源">{SOURCE_FILTERS.map(item => <button type="button" key={item.id} aria-pressed={source === item.id} onClick={() => void chooseSource(item.id)}>{item.label}</button>)}</div>
              <section className="editorial-grid" aria-label="音乐推荐入口">
                <article className="editorial-card"><img src="/artwork/coast.webp" alt="晨雾中的宁静海岸" fetchPriority="high" /><div><h2>把时间留给音乐</h2><p>让喜欢的旋律，接着播放。</p><IconButton icon={Play} label="播放推荐音乐" className="editorial-play" onClick={() => playCollection(filteredRecommendations)} /></div></article>
                <article className="editorial-card editorial-card--radio"><img src="/artwork/meadow.webp" alt="阳光洒在湖畔草地上" /><div><h2>今日私人电台</h2><p>顺着你的心情，发现下一首。</p><IconButton icon={Play} label="播放网易云私人 FM" className="editorial-play" onClick={() => void fetchCollection('fm')} /></div></article>
              </section>
              <section className="music-section"><div className="section-heading"><h2>{recentTracks.length ? '继续收听' : '从你的音乐开始'}</h2><button className="text-button" onClick={() => navigate('recent')}>查看全部<ChevronRight size={16} /></button></div>
                {continueTracks.length ? <div className="album-grid">{continueTracks.map(song => <article className="album-card" key={trackKey(song)}><button className="album-play" aria-label={`播放 ${song.title}`} onClick={() => model.playTrack(song, continueCollection)}><AlbumArt song={song} /><span><Play size={21} fill="currentColor" /></span></button><div className="album-caption"><div><strong title={song.title}>{song.title}</strong><p>{song.artist || '未知歌手'}</p></div><IconButton icon={More} label={`${song.title}的更多操作`} onClick={() => showTrackMenu(song, null, continueCollection)} /></div></article>)}</div> : <EmptyState title={source === 'netease' ? loggedIn ? '听听今天的新推荐' : '把网易云收藏带过来' : '你的音乐旅程，从这里开始'} action={<button className="button button--primary" disabled={source === 'netease' && collections.daily?.status === 'loading'} onClick={() => source === 'netease' ? loggedIn ? void fetchCollection('daily') : openLogin() : importRef.current?.click()}>{source === 'netease' ? loggedIn ? '打开每日推荐' : '连接网易云' : '导入音乐'}</button>}>{source === 'netease' ? collections.daily?.error || (collections.daily?.status === 'loading' ? '正在读取你的推荐…' : '登录后收听推荐、歌单和喜欢的音乐。') : '导入本地歌曲，或连接网易云音乐收藏。'}</EmptyState>}
              </section>
              <section className="music-section"><div className="section-heading"><h2>最近加入</h2><button type="button" className="text-button" onClick={goLocal}>查看全部<ChevronRight size={16} /></button></div><TrackList tracks={recentAdded} currentId={currentId} isPlaying={model.playerState.isPlaying} onPlay={song => model.playTrack(song, recentCollection)} onMore={song => showTrackMenu(song, null, recentCollection)} emptyTitle={source === 'netease' ? '选择歌单，开始探索网易云收藏' : '音乐库还是空的'} /></section>
            </>}

            {page === 'search' && <>
              <GlassSurface as="form" className="search-page-form" radius={26} role="search" onSubmit={submitSearch}><Search size={22} aria-hidden="true" /><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="输入歌曲、歌手或专辑" aria-label="搜索歌曲、歌手、专辑" autoComplete="off" /><button className="button button--primary" type="submit" disabled={!query.trim()}>搜索</button></GlassSurface>
              <div className="source-filters source-filters--visible" role="group" aria-label="搜索范围">{SOURCE_FILTERS.map(item => <button key={item.id} aria-pressed={source === item.id} onClick={() => { setSource(item.id); if (query.trim()) void model.search.run(query, item.id) }}>{item.label}</button>)}</div>
              {model.search.status === 'loading' ? <LoadingState>正在寻找音乐…</LoadingState> : model.search.status === 'error' && !fullTracks.length ? <EmptyState icon={Search} title="暂时没能完成搜索" action={<button className="button button--secondary" onClick={submitSearch}>重试</button>}>{model.search.error}</EmptyState> : model.search.status === 'idle' ? <EmptyState icon={Search} title="想听什么，搜一下">可以搜索歌曲、歌手、专辑，也可以在陪伴里用一句话点歌。</EmptyState> : <section className="music-section"><div className="section-heading"><h2>搜索结果</h2><span>{fullTracks.length} 首</span></div>{model.search.error && <p className="inline-notice" role="status">{model.search.error} 已保留找到的本地音乐。<button className="text-button" onClick={submitSearch}>重试在线搜索</button></p>}{renderTrackList(fullTracks, '没有找到匹配的音乐')}</section>}
            </>}

            {page === 'library' && <>
              <div className="collection-tabs" role="group" aria-label="音乐库分类">{[{ id: 'local', label: '本地音乐' }, { id: 'liked', label: '喜欢的音乐' }, { id: 'recent', label: '最近播放' }, { id: 'fm', label: '私人 FM' }, { id: 'playlists', label: '网易云歌单' }, { id: 'daily', label: '每日推荐' }, { id: 'cloud', label: '音乐云盘' }, { id: 'podcasts', label: '我的播客' }].map(item => <button key={item.id} aria-pressed={libraryTab === item.id} onClick={() => { setVisibleTracks(80); if (item.id === 'local') goLocal(); else if (item.id === 'recent' && !loggedIn) navigate('recent'); else if (item.id === 'playlists') { navigate('library', { collection: 'playlists' }); if (!loggedIn) openLogin() } else void fetchCollection(item.id) }}>{item.label}</button>)}</div>
              {libraryTab === 'playlists' ? loggedIn ? <div className="playlist-grid">{playlists.map(playlist => <button key={playlist.id} className="playlist-card" onClick={() => void selectPlaylist(playlist)}><AlbumArt src={playlist.coverUrl || playlist.coverImgUrl} /><strong>{playlist.name}</strong><span>{playlist.trackCount || 0} 首音乐</span></button>)}{!playlists.length && <EmptyState title="还没有读取到歌单" action={<button className="button button--secondary" onClick={() => void model.account.refresh()}>重新同步</button>} />}</div> : <EmptyState icon={Login} title="把收藏的歌单带过来" action={<button className="button button--primary" onClick={openLogin}>连接网易云</button>}>通过网易云 App 扫码登录，不需要输入密码。</EmptyState>
                : <><div className="library-toolbar"><span>{entry.podcast && <button className="text-button" onClick={() => navigate('library', { collection: 'podcasts' })}><ChevronLeft size={16} />全部播客</button>}{entry.podcast && <strong>{entry.podcast.name} · </strong>}{libraryTab === 'local' ? `${model.library.songs.length} 首本地音乐` : libraryTab === 'podcasts' && !entry.podcast ? `${podcasts.length} 个播客` : `${remoteTracks.length} 首音乐`}</span><div>{libraryTab === 'local' && <><button className="text-button" onClick={() => void model.library.refresh({ scan: true })}>扫描文件夹</button><button className="text-button" onClick={() => void model.library.analyze()}>分析音乐标签</button></>}{(libraryTab !== 'podcasts' || entry.podcast) && <button className="button button--primary" disabled={!fullTracks.length} onClick={() => playCollection(fullTracks)}><Play size={16} fill="currentColor" />播放全部</button>}</div></div>
                  {(libraryTab === 'local' ? model.library.status === 'loading' : collectionStatus === 'loading') ? <LoadingState /> : collectionError && libraryTab !== 'local' ? <EmptyState title="音乐暂时没有连接上" action={<button className="button button--secondary" onClick={() => entry.podcast ? void openPodcast(entry.podcast) : void fetchCollection(libraryTab)}>重试</button>}>{collectionError}</EmptyState> : libraryTab === 'podcasts' && podcasts.length ? <div className="playlist-grid">{podcasts.map(podcast => <button key={podcast.id} className="playlist-card" onClick={() => void openPodcast(podcast)}><AlbumArt src={podcast.coverUrl || podcast.picUrl} /><strong>{podcast.name}</strong><span>查看节目</span></button>)}</div> : renderTrackList(fullTracks, '这里还没有音乐')}
                  {model.library.error && libraryTab === 'local' && <p className="inline-notice" role="status">{model.library.error}</p>}
                </>}
            </>}
            {(page === 'playlist' || page === 'liked' || page === 'recent') && <>
              <div className="library-toolbar"><span>{fullTracks.length} 首音乐</span><button type="button" className="button button--primary" disabled={!fullTracks.length} onClick={() => playCollection(fullTracks)}><Play size={16} fill="currentColor" />播放全部</button></div>
              {(page === 'playlist' ? playlistRecord.status === 'loading' : page !== 'recent' && collectionStatus === 'loading') ? <LoadingState /> : page === 'playlist' && playlistRecord.status === 'error' ? <EmptyState title="暂时无法读取歌单" action={<button className="button button--secondary" onClick={() => void selectPlaylist(selectedPlaylist)}>重试</button>}>{playlistRecord.error}</EmptyState> : collectionStatus === 'error' && page === 'liked' ? <EmptyState title="暂时无法读取喜欢的音乐" action={<button className="button button--secondary" onClick={() => void fetchCollection('liked')}>重试</button>}>{collectionError}</EmptyState> : renderTrackList(fullTracks, page === 'recent' ? '听过的音乐，会在这里留下足迹' : '歌单中还没有音乐')}
            </>}
          </>}
        </main>
      </div>

      <GlassSurface as="aside" className="music-rail" aria-label="正在播放与队列">
        <NowPlayingRail model={model} tab={railTab} setTab={setRailTab} onExpand={openExpanded} />
        <div className="companion-shortcut"><h3>昀，陪你听</h3><button type="button" className="companion-prompt" onClick={() => { navigate('companion'); void model.sendMessage('给我一些放松的音乐') }}><AudioLines size={19} /><span>试试说，“给我一些放松的音乐”</span><ChevronRight size={16} /></button><button type="button" className="companion-open" onClick={() => navigate('companion')}>和昀聊聊想听的音乐…<Message size={18} /></button></div>
      </GlassSurface>
      <PlayerBar model={model} active={!['player', 'queue', 'lyrics'].includes(panel)} onExpand={openExpanded} onShowQueue={openQueue} onShowLyrics={openLyrics} />
      <GlassSurface as="nav" className="mobile-navigation" aria-label="手机主导航">{NAVIGATION.map(item => <button key={item.id} aria-current={page === item.id || item.id === 'library' && ['playlist', 'liked', 'recent'].includes(page) ? 'page' : undefined} onClick={() => item.id === 'library' ? goLocal() : navigate(item.id)}><item.icon size={23} strokeWidth={1.7} /><span>{item.short}</span></button>)}</GlassSurface>
      {model.notice && <div className="music-toast" role="status">{model.notice}</div>}

      <Suspense fallback={<div className="lazy-panel-loading" role="status">正在打开…</div>}>
        {model.voiceInput.nativeEnabled && <NativeVoiceBridge model={model} />}
        {panel === 'settings' && <MusicSettings model={model} appearance={appearance} onClose={closePanel} onLogin={openLogin} />}
        {panel === 'login' && <Modal title="连接网易云音乐" onClose={closePanel} className="account-dialog"><AccountPanel onConnected={() => { void model.account.refresh(); model.setNotice('网易云账号已连接'); closePanel() }} onDisconnected={() => { model.account.clear(); setCollections({}); setPlaylistCache({}); model.setNotice('已退出网易云账号'); closePanel() }} /></Modal>}
      </Suspense>
      {['player', 'queue', 'lyrics'].includes(panel) && <ExpandedPlayer model={model} initialTab={panel === 'player' ? 'lyrics' : panel} onClose={closePanel} />}
      {trackMenu && <Modal title="歌曲操作" onClose={closeTrackMenu} className="track-action-dialog"><div className="track-action-summary"><AlbumArt song={trackMenu.song} /><div><strong>{trackMenu.song.title}</strong><p>{trackMenu.song.artist}</p></div></div><div className="track-action-list"><button onClick={() => void trackAction('play')}><Play size={19} />立即播放</button><button onClick={() => void trackAction('queue')}><QueueAdd size={19} />加入待播队列</button>{trackMenu.song.source === 'netease' && <><button onClick={() => void trackAction('like')}><Heart size={19} />同步到网易云喜欢</button><button onClick={() => void trackAction('quality')}><Headphones size={19} />使用可用的无损音质</button></>}<a href={trackMenu.song.fileUrl} download={trackMenu.song.filename || trackMenu.song.title}><Download size={19} />保存音频文件</a></div>{menuStatus && <p className="inline-notice" role="alert">{menuStatus}</p>}</Modal>}
    </div>
  </LiquidGlassProvider></PlayerProvider>
}
