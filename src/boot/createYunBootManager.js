import { fetchNeteaseMePage, fetchNeteasePlaylistTracksPage } from '../api/neteaseApi.js'
import { REVISION as THREE_REVISION } from 'three'
import { fetchMusicLibrary, scanMusicLibrary } from '../api/yunApi.js'
import { fetchDefaultUserMemory, fetchYunMemory, fetchYunSettings } from '../api/memoryApi.js'
import { createYunLegacyPlayerAdapter } from '../player/adapters/yunLegacyPlayerAdapter.js'
import { YunBootManager } from './YunBootManager.js'
import {
  isValidPlaylist,
  isValidCompletePlaylist,
  loadCompletePlaylistTracks,
  loadCompletePlaylistCache,
  loadPaginatedCollection,
  saveCompletePlaylistCache,
} from './playlistLoader.js'

const PLAYLIST_CACHE_KEY = 'yun_boot_netease_playlists_v1'
const PLAYLIST_CACHE_VERSION = 2

async function requestJson(path, { signal } = {}) {
  const response = await fetch(path, { cache: 'no-store', signal })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok === false) throw new Error(data.error || `${path} unavailable`)
  return data
}

function readPlayerRestoreSnapshot(storage) {
  let session
  try {
    session = JSON.parse(storage?.getItem('yun_player_session_v1') || 'null')
  } catch {
    session = null
  }
  return {
    playbackMode: storage?.getItem('yun_playback_mode') || 'shuffle',
    queue: Array.isArray(session?.queue) ? session.queue : [],
    currentTrack: session?.currentTrack?.fileUrl ? session.currentTrack : null,
    currentTrackId: String(session?.currentTrackId || ''),
    position: Math.max(0, Number(session?.position) || 0),
    duration: Math.max(0, Number(session?.duration) || 0),
  }
}

function preloadImage(url, signal) {
  if (!url || typeof Image === 'undefined') return Promise.resolve(false)
  return new Promise((resolve) => {
    const image = new Image()
    const finish = (loaded) => {
      image.onload = null
      image.onerror = null
      resolve(loaded)
    }
    image.onload = () => finish(true)
    image.onerror = () => finish(false)
    signal?.addEventListener('abort', () => finish(false), { once: true })
    image.src = url
  })
}

export function createYunBootManager({ storage = globalThis.localStorage } = {}) {
  return new YunBootManager({
    retryDelayMs: 350,
    tasks: [
      {
        id: 'BOOT_CONFIG',
        label: '检查基础配置',
        blocking: true,
        weight: 5,
        run: async () => {
          if (typeof fetch !== 'function') throw new Error('Fetch API is unavailable')
          if (!storage) throw new Error('Local storage is unavailable')
          return { version: 1 }
        },
      },
      {
        id: 'BACKEND_HEALTH',
        label: '连接昀的服务',
        blocking: true,
        weight: 5,
        retries: 2,
        timeoutMs: 8000,
        run: ({ signal }) => requestJson('/api/health', { signal }),
      },
      {
        id: 'LOAD_SETTINGS',
        label: '读取用户设置',
        blocking: true,
        weight: 5,
        dependencies: ['BACKEND_HEALTH'],
        retries: 2,
        timeoutMs: 8000,
        run: ({ signal }) => fetchYunSettings({ signal }),
      },
      {
        id: 'INIT_MUSIC_PROVIDER',
        label: '初始化音乐来源',
        blocking: true,
        weight: 10,
        dependencies: ['BACKEND_HEALTH'],
        retries: 2,
        timeoutMs: 10000,
        run: ({ signal }) => fetchNeteaseMePage({ offset: 0, limit: 80, signal }),
      },
      {
        id: 'LOAD_LIBRARY',
        label: '加载本地音乐库',
        blocking: true,
        weight: 15,
        dependencies: ['INIT_MUSIC_PROVIDER'],
        retries: 1,
        timeoutMs: 30000,
        run: async ({ signal }) => {
          try {
            return await fetchMusicLibrary({ signal })
          } catch {
            return scanMusicLibrary({ signal })
          }
        },
      },
      {
        id: 'LOAD_PLAYLISTS',
        label: '同步网易云歌单',
        // Full pagination can involve hundreds of remote tracks. The first
        // provider page is already available from INIT_MUSIC_PROVIDER, so this
        // refresh must never hold the entire application behind the boot gate.
        blocking: false,
        weight: 25,
        dependencies: ['INIT_MUSIC_PROVIDER'],
        retries: 2,
        timeoutMs: 45000,
        run: async ({ getResult, reportProgress, signal }) => {
          const firstPage = getResult('INIT_MUSIC_PROVIDER')
          if (!firstPage?.loggedIn) {
            reportProgress(100, '未登录网易云')
            return { account: firstPage, playlists: [], complete: true, expectedCount: 0, loadedCount: 0 }
          }

          const cached = loadCompletePlaylistCache({
            storage,
            key: PLAYLIST_CACHE_KEY,
            version: PLAYLIST_CACHE_VERSION,
            validateItem: isValidCompletePlaylist,
          })
          if (cached) {
            const expected = Number(firstPage.total) || cached.totalItems
            reportProgress(Math.min(8, cached.totalItems / Math.max(1, expected) * 8), `发现 ${cached.totalItems} 个完整缓存歌单`)
          }

          const result = await loadPaginatedCollection({
            initialPage: firstPage,
            pageSize: 80,
            signal,
            validateItem: isValidPlaylist,
            fetchPage: ({ offset, limit, signal: pageSignal }) => fetchNeteaseMePage({ offset, limit, signal: pageSignal }),
            onProgress: ({ loadedCount, expectedCount, progress }) => {
              reportProgress(progress * 0.1, `${loadedCount} / ${expectedCount} 个歌单`)
            },
          })
          const completePlaylists = await loadCompletePlaylistTracks({
            playlists: result.items,
            signal,
            fetchPage: ({ playlistId, offset, limit, signal: pageSignal }) => (
              fetchNeteasePlaylistTracksPage(playlistId, { offset, limit, signal: pageSignal })
            ),
            onProgress: ({ loadedTrackCount, expectedTrackCount, progress }) => {
              reportProgress(10 + progress * 0.9, `${loadedTrackCount} / ${expectedTrackCount} 首`)
            },
          })
          saveCompletePlaylistCache({
            storage,
            key: PLAYLIST_CACHE_KEY,
            version: PLAYLIST_CACHE_VERSION,
            items: completePlaylists.playlists,
            validateItem: isValidCompletePlaylist,
          })
          return {
            account: { ...firstPage, playlists: completePlaylists.playlists },
            playlists: completePlaylists.playlists,
            complete: true,
            expectedCount: result.expectedCount,
            loadedCount: result.loadedCount,
            expectedTrackCount: completePlaylists.expectedTrackCount,
            loadedTrackCount: completePlaylists.loadedTrackCount,
          }
        },
      },
      {
        id: 'INIT_PLAYER_CORE',
        label: '初始化播放器核心',
        blocking: true,
        weight: 10,
        dependencies: ['LOAD_LIBRARY'],
        run: async () => createYunLegacyPlayerAdapter(),
      },
      {
        id: 'RESTORE_PLAYER',
        label: '恢复播放状态',
        blocking: true,
        weight: 5,
        dependencies: ['INIT_PLAYER_CORE'],
        run: async () => readPlayerRestoreSnapshot(storage),
      },
      {
        id: 'LOAD_MEMORY',
        label: '读取长期记忆',
        blocking: false,
        weight: 8,
        dependencies: ['BACKEND_HEALTH'],
        retries: 1,
        timeoutMs: 10000,
        run: async ({ signal }) => {
          const [longTermMemory, defaultUserMemory] = await Promise.all([
            fetchYunMemory({ signal }),
            fetchDefaultUserMemory({ signal }),
          ])
          return { longTermMemory, defaultUserMemory }
        },
      },
      {
        id: 'INIT_COMPANION',
        label: '连接陪伴模型',
        blocking: false,
        weight: 4,
        dependencies: ['BACKEND_HEALTH'],
        retries: 1,
        timeoutMs: 8000,
        run: ({ signal }) => requestJson('/api/yun/model-status', { signal }),
      },
      {
        id: 'INIT_TTS',
        label: '检查语音服务',
        blocking: false,
        weight: 3,
        dependencies: ['BACKEND_HEALTH'],
        retries: 1,
        timeoutMs: 8000,
        run: async ({ signal }) => {
          const status = await requestJson('/api/moss-tts/health', { signal })
          if (status.configured === false || status.available === false) throw new Error('语音服务未配置')
          return status
        },
      },
      {
        id: 'INIT_VISUAL',
        label: '准备视觉资源',
        blocking: false,
        weight: 3,
        dependencies: ['BOOT_CONFIG'],
        timeoutMs: 15000,
        run: async () => {
          const canvas = document.createElement('canvas')
          const context = canvas.getContext('webgl2') || canvas.getContext('webgl')
          if (!context) throw new Error('WebGL is unavailable')
          return { webgl: true, threeRevision: THREE_REVISION }
        },
      },
      {
        id: 'PRELOAD_COVERS',
        label: '预载歌曲封面',
        blocking: false,
        weight: 2,
        dependencies: ['LOAD_LIBRARY'],
        timeoutMs: 12000,
        run: async ({ getResult, reportProgress, signal }) => {
          const covers = (getResult('LOAD_LIBRARY')?.songs || [])
            .map((song) => song.coverUrl || song.coverPath)
            .filter(Boolean)
            .slice(0, 6)
          if (!covers.length) return { loaded: 0, total: 0 }
          let loaded = 0
          for (const cover of covers) {
            if (await preloadImage(cover, signal)) loaded += 1
            reportProgress((loaded + (covers.length - loaded) * 0.25) / covers.length * 100, `${loaded} / ${covers.length}`)
          }
          return { loaded, total: covers.length }
        },
      },
    ],
  })
}

let sharedManager = null

export function getYunBootManager() {
  if (!sharedManager) sharedManager = createYunBootManager()
  return sharedManager
}
