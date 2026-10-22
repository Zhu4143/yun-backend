import { useEffect, useState, useSyncExternalStore } from 'react'
import { fetchNeteaseLikedStatus, setNeteaseSongLiked } from '../api/neteaseApi.js'
import { createNeteaseLikeController, getNeteaseLikeSongId } from '../services/netease/likeController.js'

export default function NeteaseLikeButton({ song, accountKey = '', onLoginRequested }) {
  const [controller] = useState(() => createNeteaseLikeController({ readLiked: fetchNeteaseLikedStatus, writeLiked: setNeteaseSongLiked }))
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const songId = getNeteaseLikeSongId(song)
  useEffect(() => {
    controller.selectSong(songId)
    const refresh = () => controller.selectSong(songId)
    const collectionChanged = (event) => {
      if (event.detail?.providerId === songId) refresh()
    }
    window.addEventListener('focus', refresh)
    window.addEventListener('yun:netease-liked-changed', collectionChanged)
    return () => {
      controller.clear()
      window.removeEventListener('focus', refresh)
      window.removeEventListener('yun:netease-liked-changed', collectionChanged)
    }
  }, [controller, songId, accountKey])

  const current = state.songId === songId
  const liked = current && state.liked === true
  const busy = !current || state.status === 'loading' || state.status === 'saving'
  const loginRequired = current && state.status === 'login_required'
  const label = !songId ? '当前歌曲不是网易云歌曲'
    : loginRequired ? '登录网易云后添加红心'
      : busy ? '正在同步网易云红心'
        : state.error ? `${state.error}，点击重试`
          : liked ? '取消网易云红心' : '添加网易云红心'

  return (
    <button
      className={`control-button player-like-button${liked ? ' is-liked' : ''}`}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={liked}
      aria-busy={busy && Boolean(songId)}
      disabled={!songId || busy}
      onClick={() => loginRequired ? onLoginRequested?.() : controller.toggle()}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20.3 4.8a5.2 5.2 0 0 0-7.4 0l-.9.9-.9-.9a5.2 5.2 0 0 0-7.4 7.4L12 20.5l8.3-8.3a5.2 5.2 0 0 0 0-7.4Z" />
      </svg>
    </button>
  )
}
