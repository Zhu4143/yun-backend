import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import LiquidGlass from 'liquid-glass-react'
import { fetchMusicLibrary } from './api/yunApi'
import { useLocalPlayer } from './hooks/useLocalPlayer'
import './App.css'

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '00:00'
  }

  const minutes = Math.floor(seconds / 60)
  const restSeconds = Math.floor(seconds % 60)

  return `${String(minutes).padStart(2, '0')}:${String(restSeconds).padStart(2, '0')}`
}

function getSongTags(song) {
  const tags = [...(song?.moodTags || []), ...(song?.sceneTags || [])]

  return tags.length ? tags.slice(0, 3) : ['calm', 'warm']
}

function App() {
  const [activePanel, setActivePanel] = useState(null)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [libraryTracks, setLibraryTracks] = useState([])
  const [libraryCount, setLibraryCount] = useState(0)
  const [libraryStatus, setLibraryStatus] = useState('idle')
  const [libraryError, setLibraryError] = useState('')
  const [panelContentVisible, setPanelContentVisible] = useState(true)
  const [pendingMorph, setPendingMorph] = useState(null)
  const [morphLayer, setMorphLayer] = useState(null)
  const [pressedPanel, setPressedPanel] = useState(null)
  const voiceTriggerRef = useRef(null)
  const memoryTriggerRef = useRef(null)
  const libraryTriggerRef = useRef(null)
  const playModeTriggerRef = useRef(null)
  const {
    currentSong,
    isPlaying,
    currentTime,
    duration,
    playSong,
    togglePlayPause,
    playNext,
    playPrevious,
    seekTo,
  } = useLocalPlayer(libraryTracks)

  const visibleLibraryTracks = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase()

    if (!query) {
      return libraryTracks
    }

    return libraryTracks.filter((track) =>
      `${track.title} ${track.artist}`.toLowerCase().includes(query),
    )
  }, [libraryQuery, libraryTracks])

  const loadMusicLibrary = useCallback(async () => {
    setLibraryStatus('loading')
    setLibraryError('')

    try {
      const library = await fetchMusicLibrary()
      setLibraryTracks(library.songs)
      setLibraryCount(library.count ?? library.songs.length)
      setLibraryStatus('ready')
    } catch (error) {
      setLibraryTracks([])
      setLibraryCount(0)
      setLibraryStatus('error')
      setLibraryError(error instanceof Error ? error.message : '曲库读取失败')
    }
  }, [])

  const triggerRefs = {
    library: libraryTriggerRef,
    voice: voiceTriggerRef,
    memory: memoryTriggerRef,
    playMode: playModeTriggerRef,
  }

  const panelSelectors = {
    library: '.local-library-drawer',
    voice: '.voice-popover',
    memory: '.memory-settings-panel',
    playMode: '.ai-mode-expanded',
  }

  const panelRadii = {
    library: 28,
    voice: 30,
    memory: 32,
    playMode: 999,
  }

  useEffect(() => {
    const timer = window.setTimeout(loadMusicLibrary, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [loadMusicLibrary])

  const getRect = (element) => {
    const rect = element.getBoundingClientRect()

    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    }
  }

  const pressPanel = (panel) => {
    setPressedPanel(panel)
    window.setTimeout(() => setPressedPanel(null), 150)
  }

  const openPanel = (panel) => {
    pressPanel(panel)
    setPanelContentVisible(false)
    setActivePanel(panel)
    setPendingMorph({ panel, direction: 'open' })
  }

  const closePanel = (panel = activePanel) => {
    if (!panel) {
      return
    }

    const trigger = triggerRefs[panel]?.current
    const panelElement = document.querySelector(panelSelectors[panel])

    if (!trigger || !panelElement) {
      setActivePanel(null)
      return
    }

    setPanelContentVisible(false)

    setMorphLayer({
      panel,
      phase: 'from',
      from: getRect(panelElement),
      to: getRect(trigger),
      fromRadius: panelRadii[panel],
      toRadius: 999,
    })

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setMorphLayer((layer) => (layer ? { ...layer, phase: 'to' } : layer))
      })
    })

    window.setTimeout(() => {
      setActivePanel(null)
      setMorphLayer(null)
      setPanelContentVisible(true)
    }, 430)
  }

  const togglePanel = (panel) => {
    if (activePanel === panel) {
      pressPanel(panel)
      closePanel(panel)
      return
    }

    openPanel(panel)
  }

  useLayoutEffect(() => {
    if (!pendingMorph || pendingMorph.direction !== 'open' || activePanel !== pendingMorph.panel) {
      return undefined
    }

    const panel = pendingMorph.panel
    const trigger = triggerRefs[panel]?.current
    const panelElement = document.querySelector(panelSelectors[panel])

    if (!trigger || !panelElement) {
      const fallbackTimer = window.setTimeout(() => {
        setPanelContentVisible(true)
        setPendingMorph(null)
      }, 0)

      return () => {
        window.clearTimeout(fallbackTimer)
      }
    }

    const openTimer = window.setTimeout(() => {
      setPanelContentVisible(true)
    }, 275)

    const finishTimer = window.setTimeout(() => {
      setMorphLayer(null)
      setPendingMorph(null)
    }, 430)

    const kickoffTimer = window.setTimeout(() => {
      setMorphLayer({
        panel,
        phase: 'from',
        from: getRect(trigger),
        to: getRect(panelElement),
        fromRadius: 999,
        toRadius: panelRadii[panel],
      })

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          setMorphLayer((layer) => (layer ? { ...layer, phase: 'to' } : layer))
        })
      })
    }, 0)

    return () => {
      window.clearTimeout(kickoffTimer)
      window.clearTimeout(openTimer)
      window.clearTimeout(finishTimer)
    }
  }, [activePanel, pendingMorph])

  useEffect(() => {
    if (!activePanel) {
      return undefined
    }

    const handlePointerDown = (event) => {
      const target = event.target

      if (!(target instanceof Element)) {
        return
      }

      const clickedInsideLayer = target.closest(
        [
          '.local-library-drawer',
          '.memory-settings-panel',
          '.voice-popover',
          '.ai-mode-expanded',
          '.library-trigger',
          '.ai-play-button',
          '.floating-actions',
        ].join(', '),
      )

      if (clickedInsideLayer) {
        return
      }

      closePanel(activePanel)
    }

    document.addEventListener('pointerdown', handlePointerDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [activePanel])

  const morphRect = morphLayer?.phase === 'to' ? morphLayer.to : morphLayer?.from
  const morphRadius = morphLayer?.phase === 'to' ? morphLayer.toRadius : morphLayer?.fromRadius
  const displayedSong = currentSong || {
    title: 'golden hour',
    artist: 'kudasai',
    coverUrl: '',
  }
  const displayedTags = getSongTags(currentSong)
  const progressPercent = duration ? Math.min(100, (currentTime / duration) * 100) : 0
  const morphStyle = morphLayer
    ? {
        left: `${morphRect.left}px`,
        top: `${morphRect.top}px`,
        width: `${morphRect.width}px`,
        height: `${morphRect.height}px`,
        borderRadius: `${morphRadius}px`,
      }
    : undefined

  return (
    <main className={`app${activePanel === 'library' ? ' library-open' : ''}${activePanel === 'memory' ? ' memory-settings-open' : ''}${activePanel === 'voice' ? ' voice-open' : ''}${activePanel === 'playMode' ? ' play-mode-open' : ''}${panelContentVisible ? '' : ' panel-content-hidden'}${morphLayer ? ' is-morphing' : ''}`}>
      <div className="bg-image" />
      <div className="ambient-orbit" />

      <LiquidGlass
        displacementScale={86}
        blurAmount={0.08}
        saturation={150}
        aberrationIntensity={2.5}
        elasticity={0.35}
        cornerRadius={40}
        padding="32px 40px"
        className="status-card"
      >
        <div className="status-meta">
          <p className="sub">YUN IS LISTENING</p>
          <span>now companion mode</span>
        </div>
        <h1 className="status-title">
          {displayedSong.title} · {displayedTags.slice(0, 2).join(' / ')}
        </h1>
        <p className="status-description">
          {displayedSong.artist} 正在慢慢铺开，这首歌的光很安静。
          <br />
          我会把声音放轻一点，陪你慢慢说。
        </p>
        <div className="status-tags">
          {displayedTags.map((tag) => (
            <span className="status-tag" key={tag}>{tag}</span>
          ))}
        </div>
        <p className="sub">YUN IS LISTENING</p>
        <h1>我正在听着，你慢慢说。</h1>
        <p>这首歌的光很安静，像傍晚留在木桌上的温度。</p>
      </LiquidGlass>

      <LiquidGlass
        displacementScale={62}
        blurAmount={0.07}
        saturation={145}
        aberrationIntensity={1.8}
        elasticity={0.22}
        cornerRadius={28}
        padding="8px"
        className="mode-switch"
      >
        <div className="mode-options">
          <span className="mode-option">普通</span>
          <span className="mode-option">播客</span>
          <span className="mode-option active">陪伴</span>
          <span className="mode-option">专注</span>
        </div>
      </LiquidGlass>

      <div className="floating-actions">
        <button
          className={`action-button${pressedPanel === 'voice' ? ' is-pressed' : ''}`}
          type="button"
          aria-label="声音"
          aria-expanded={activePanel === 'voice'}
          ref={voiceTriggerRef}
          onClick={() => togglePanel('voice')}
        >
          声
        </button>
        <button
          className={`action-button${pressedPanel === 'memory' ? ' is-pressed' : ''}`}
          type="button"
          aria-label="设置"
          aria-expanded={activePanel === 'memory'}
          ref={memoryTriggerRef}
          onClick={() => togglePanel('memory')}
        >
          设
        </button>
      </div>

      <LiquidGlass
        displacementScale={74}
        blurAmount={0.08}
        saturation={150}
        aberrationIntensity={2.1}
        elasticity={0.22}
        cornerRadius={30}
        padding="14px"
        className={`voice-popover glass-popover glass-level-3${activePanel === 'voice' ? ' is-open' : ''}`}
        style={{
          position: 'absolute',
          top: 'var(--voice-popover-top)',
          left: 'var(--voice-popover-left)',
          width: 'var(--voice-popover-width)',
        }}
      >
        <div className="voice-popover-header">
          <p className="sub">VOICE</p>
          <h2>声音与朗读</h2>
        </div>
        <div className="voice-stack">
          <div className="voice-row">
            <span className="voice-row-label">自动朗读</span>
            <span className="voice-toggle">开</span>
          </div>
          <div className="voice-row">
            <span className="voice-row-label">音色</span>
            <span className="voice-value">soft voice</span>
          </div>
          <div className="voice-row">
            <span className="voice-row-label">语速</span>
            <div className="voice-slider">
              <span className="voice-slider-fill" />
              <span className="voice-slider-thumb" />
            </div>
            <span className="voice-value">1.0</span>
          </div>
          <div className="voice-row">
            <span className="voice-row-label">音量</span>
            <div className="voice-slider voice-slider--volume">
              <span className="voice-slider-fill" />
              <span className="voice-slider-thumb" />
            </div>
            <span className="voice-value">1.0</span>
          </div>
          <div className="voice-row">
            <span className="voice-row-label">音乐压低</span>
            <span className="voice-toggle">开</span>
          </div>
        </div>
        <button className="voice-preview-button" aria-label="试听声音">试听声音</button>
      </LiquidGlass>

      <LiquidGlass
        displacementScale={74}
        blurAmount={0.08}
        saturation={150}
        aberrationIntensity={2.1}
        elasticity={0.22}
        cornerRadius={28}
        padding="18px"
        className={`memory-settings-panel${activePanel === 'memory' ? ' is-open' : ''}`}
      >
        <div className="memory-settings-content">
          <div className="memory-settings-header">
            <h2>记忆设置</h2>
            <button
              className="memory-settings-close"
              type="button"
              aria-label="关闭记忆设置"
              onClick={() => closePanel('memory')}
            >
              ×
            </button>
          </div>

          <div className="memory-settings-row">
            <span>允许使用本地记忆</span>
            <span className="memory-toggle is-on" aria-label="允许使用本地记忆：开" />
          </div>

          <p className="memory-settings-status">记忆摘要加载中…</p>

          <div className="memory-mode-options" aria-label="记忆模式">
            <button className="memory-mode-button" type="button">安静模式</button>
            <button className="memory-mode-button active" type="button">自然记得</button>
            <button className="memory-mode-button" type="button">认真陪你</button>
          </div>

          <p className="memory-mode-description">自然记得：昀会在需要时想起长期记忆。</p>

          <div className="memory-manage-actions">
            <button type="button">查看你的记忆</button>
            <button type="button">重载默认</button>
            <button type="button">清空近期</button>
          </div>

          <div className="memory-settings-row memory-settings-row--footer">
            <span>允许 AI 控制播放形式</span>
            <span className="memory-toggle is-on" aria-label="允许 AI 控制播放形式：开" />
          </div>
        </div>
      </LiquidGlass>

      <LiquidGlass
        displacementScale={76}
        blurAmount={0.075}
        saturation={152}
        aberrationIntensity={2.1}
        elasticity={0.26}
        cornerRadius={32}
        padding="22px"
        className="chat-panel"
      >
        <div className="chat-content">
          <div className="chat-header">
            <p className="sub">YUN COMPANION</p>
            <span>soft voice</span>
          </div>
          <div className="chat-messages">
            <div className="chat-bubble chat-bubble--yun">
              <span>昀</span>
              <p>我在听，你可以慢慢说。</p>
            </div>
            <div className="chat-bubble chat-bubble--me">
              <span>我</span>
              <p>今天有点累，想听安静一点的。</p>
            </div>
            <div className="chat-bubble chat-bubble--yun">
              <span>昀</span>
              <p>那我先把声音放轻一点，陪你待一会儿。</p>
            </div>
          </div>
          <div className="chat-input">
            <span>慢慢说，我在这里</span>
            <i />
          </div>
        </div>
      </LiquidGlass>

      <LiquidGlass
        displacementScale={70}
        blurAmount={0.07}
        saturation={148}
        aberrationIntensity={2}
        elasticity={0.24}
        cornerRadius={34}
        padding="16px 18px"
        className="memory-strip"
      >
        <div className="memory-list">
          <article className="memory-card active">
            <div className="memory-cover memory-cover--gold" />
            <div>
              <h3>golden hour</h3>
              <p>calm</p>
            </div>
          </article>
          <article className="memory-card">
            <div className="memory-cover memory-cover--night" />
            <div>
              <h3>night walk</h3>
              <p>focus</p>
            </div>
          </article>
          <article className="memory-card">
            <div className="memory-cover memory-cover--rain" />
            <div>
              <h3>rainy room</h3>
              <p>lonely</p>
            </div>
          </article>
          <article className="memory-card">
            <div className="memory-cover memory-cover--tea" />
            <div>
              <h3>silent tea</h3>
              <p>warm</p>
            </div>
          </article>
        </div>
      </LiquidGlass>

      <LiquidGlass
        displacementScale={90}
        blurAmount={0.1}
        saturation={150}
        aberrationIntensity={2.5}
        elasticity={0.35}
        cornerRadius={40}
        padding="28px 34px"
        className="player-card"
      >
        <div className="player-content">
          <div className="player-meta">
            <div
              className="cover"
              style={displayedSong.coverUrl ? { backgroundImage: `url(${displayedSong.coverUrl})` } : undefined}
            />
            <div className="track-info">
              <p className="sub">NOW PLAYING</p>
              <h2>{displayedSong.title}</h2>
              <p>{displayedSong.artist}</p>
            </div>
            <button
              className={`library-trigger${pressedPanel === 'library' ? ' is-pressed' : ''}`}
              type="button"
              aria-label="打开本地曲库"
              aria-expanded={activePanel === 'library'}
              ref={libraryTriggerRef}
              onClick={() => togglePanel('library')}
            >
              曲库
            </button>
          </div>

          <div className="player-controls" aria-label="Static player controls">
            <button className="control-button control-button--ghost" aria-label="Like">♡</button>
            <button className="control-button control-button--ghost" aria-label="More">...</button>
            <button className="control-button" type="button" aria-label="Previous" onClick={playPrevious}>‹</button>
            <button
              className="control-button control-button--primary"
              type="button"
              aria-label={isPlaying ? 'Pause' : 'Play'}
              onClick={togglePlayPause}
            >
              {isPlaying ? 'Ⅱ' : '▶'}
            </button>
            <button className="control-button" type="button" aria-label="Next" onClick={playNext}>›</button>
            <button className="control-button control-button--ghost" aria-label="Repeat">↻</button>
          </div>

          <div className="player-progress" aria-label="Playback progress">
            <div
              className="progress-track"
              role="button"
              tabIndex={0}
              onClick={(event) => {
                if (!duration) return
                const rect = event.currentTarget.getBoundingClientRect()
                const ratio = (event.clientX - rect.left) / rect.width
                seekTo(duration * ratio)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') seekTo(currentTime - 5)
                if (event.key === 'ArrowRight') seekTo(currentTime + 5)
              }}
            >
              <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
              <div className="progress-thumb" style={{ left: `${progressPercent}%` }} />
            </div>
            <p className="time-code">{formatTime(currentTime)} / {formatTime(duration)}</p>
          </div>
          <button
            className={`ai-play-button${pressedPanel === 'playMode' ? ' is-pressed' : ''}`}
            type="button"
            aria-label="AI推荐播放"
            aria-expanded={activePanel === 'playMode'}
            ref={playModeTriggerRef}
            onClick={() => togglePanel('playMode')}
          >
            AI推荐播放
          </button>
  <div className="cover" />

  <div className="track-info">
    <p className="sub">NOW PLAYING</p>
    <h2>golden hour</h2>
    <p>kudasai</p>
  </div>

  <button aria-label="Pause">Ⅱ</button>
</div>
      </LiquidGlass>

      <LiquidGlass
        displacementScale={74}
        blurAmount={0.08}
        saturation={150}
        aberrationIntensity={2.1}
        elasticity={0.22}
        cornerRadius={28}
        padding="18px"
        className={`local-library-drawer${activePanel === 'library' ? ' is-open' : ''}`}
      >
        <div className="library-content">
          <div className="library-header">
            <div>
              <h2>本地曲库</h2>
              <p className="library-live-count">
                {libraryStatus === 'loading'
                  ? '正在读取曲库…'
                  : `曲库共 ${libraryCount} 首`}
              </p>
            </div>
            <div className="library-header-actions">
              <button
                className="library-scan-button library-scan-button-live"
                type="button"
                aria-label="扫描本地曲库"
                disabled={libraryStatus === 'loading'}
                onClick={loadMusicLibrary}
              >
                {libraryStatus === 'loading' ? '读取中' : '扫描'}
              </button>
              <button
                className="library-close-button"
                type="button"
                aria-label="关闭本地曲库"
                onClick={() => closePanel('library')}
              >
                ×
              </button>
            </div>
          </div>

          <label className="library-search">
            <span>搜索</span>
            <input
              type="search"
              placeholder="搜索歌名或歌手"
              value={libraryQuery}
              onChange={(event) => setLibraryQuery(event.target.value)}
            />
          </label>

          <div className="library-preview-list">
            {libraryStatus === 'error' && (
              <div className="library-empty-state">{libraryError}</div>
            )}
            {libraryStatus !== 'error' && visibleLibraryTracks.length === 0 && (
              <div className="library-empty-state">
                {libraryStatus === 'loading' ? '正在读取旧项目曲库…' : '没有找到匹配歌曲'}
              </div>
            )}
            {visibleLibraryTracks.slice(0, 4).map((track) => (
              <article className="library-track" key={track.id || `${track.title}-${track.artist}`}>
                <button
                  className="library-play-button"
                  type="button"
                  aria-label={`播放 ${track.title}`}
                  onClick={() => playSong(track)}
                >
                  ▶
                </button>
                <div
                  className={`library-cover ${track.cover || ''}`}
                  style={track.coverUrl ? { backgroundImage: `url(${track.coverUrl})` } : undefined}
                />
                <div className="library-track-info">
                  <h3>{track.title}</h3>
                  <p>{track.artist}</p>
                </div>
              </article>
            ))}
          </div>

          <div className="library-scroll-list" aria-label="全部歌曲列表">
            {visibleLibraryTracks.map((track) => (
              <article className="library-scroll-track" key={`scroll-${track.id || `${track.title}-${track.artist}`}`}>
                <button
                  className="library-play-button"
                  type="button"
                  aria-label={`播放 ${track.title}`}
                  onClick={() => playSong(track)}
                >
                  ▶
                </button>
                <div
                  className={`library-cover ${track.cover || ''}`}
                  style={track.coverUrl ? { backgroundImage: `url(${track.coverUrl})` } : undefined}
                />
                <div className="library-track-info">
                  <h3>{track.title}</h3>
                  <p>{track.artist}</p>
                </div>
              </article>
            ))}
          </div>

          <button className="library-all-button" type="button">
            查看全部歌曲（{libraryCount}）
          </button>
        </div>
      </LiquidGlass>

      <LiquidGlass
        displacementScale={58}
        blurAmount={0.06}
        saturation={150}
        aberrationIntensity={1.6}
        elasticity={0.18}
        cornerRadius={999}
        padding="6px"
        className={`ai-mode-expanded${activePanel === 'playMode' ? ' is-open' : ''}`}
      >
        <div className="ai-mode-options">
          <button className="ai-mode-option" type="button">随机播放</button>
          <button className="ai-mode-option" type="button">单曲循环</button>
          <button className="ai-mode-option" type="button">顺序播放</button>
          <button className="ai-mode-option active" type="button" onClick={() => closePanel('playMode')}>AI推荐播放</button>
          <button className="ai-mode-option" type="button">陪伴续播</button>
        </div>
      </LiquidGlass>

      <div className="ai-popover glass-popover glass-level-3">
        <div className="ai-popover-compact">
          <div className="ai-popover-header">
            <p className="sub">SMART QUEUE</p>
            <h2>AI推荐播放</h2>
          </div>
          <div className="ai-reason-card">
            <p>根据 calm / warm 和你的聊天状态，续播更安静的歌。</p>
          </div>
          <div className="ai-queue">
            <div className="ai-queue-item">
              <span>1</span>
              <p>night walk</p>
            </div>
            <div className="ai-queue-item">
              <span>2</span>
              <p>rainy room</p>
            </div>
            <div className="ai-queue-item">
              <span>3</span>
              <p>silent tea</p>
            </div>
          </div>
          <div className="ai-preference-chips">
            <span>更安静</span>
            <span>更温暖</span>
            <span>少说话</span>
          </div>
          <button className="ai-popover-action" aria-label="重新推荐">重新推荐</button>
        </div>
        <div className="ai-popover-header">
          <p className="sub">SMART QUEUE</p>
          <h2>AI推荐播放</h2>
          <p>根据当前歌曲情绪和你的聊天状态，自动续播更适合的歌。</p>
        </div>
        <div className="ai-reason-card">
          <span>推荐理由</span>
          <p>你现在听的是 golden hour，情绪偏 calm / warm。</p>
          <p>我会优先推荐安静、温暖、低打扰的歌曲。</p>
        </div>
        <div className="ai-queue">
          <div className="ai-queue-item">
            <span>1</span>
            <p>night walk · focus</p>
          </div>
          <div className="ai-queue-item">
            <span>2</span>
            <p>rainy room · lonely</p>
          </div>
          <div className="ai-queue-item">
            <span>3</span>
            <p>silent tea · warm</p>
          </div>
        </div>
        <div className="ai-preference-chips">
          <span>更安静</span>
          <span>更温暖</span>
          <span>少说话</span>
          <span>多陪伴</span>
        </div>
        <button className="ai-popover-action" aria-label="重新推荐">重新推荐</button>
      </div>
      {morphLayer && (
        <div
          className={`liquid-morph-layer ${morphLayer.phase === 'to' ? 'is-to' : 'is-from'}`}
          style={morphStyle}
        />
      )}
    </main>
  )
}

export default App
