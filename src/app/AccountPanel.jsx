import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { checkNeteaseLoginQr, createNeteaseLoginQr, fetchNeteaseLoginStatus, logoutNetease } from '../api/neteaseAuthApi.js'
import { LoadingState } from './components.jsx'

export default function AccountPanel({ onConnected, onDisconnected }) {
  const [account, setAccount] = useState(null)
  const [qr, setQr] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const callbacks = useRef({ onConnected, onDisconnected })
  const operation = useRef({ epoch: 0, request: null, timer: 0 })
  useLayoutEffect(() => { callbacks.current = { onConnected, onDisconnected } }, [onConnected, onDisconnected])
  const cancel = useCallback(() => {
    const current = operation.current
    current.epoch += 1
    current.request?.abort()
    window.clearTimeout(current.timer)
  }, [])
  const connect = useCallback(async () => {
    cancel()
    const current = operation.current
    const epoch = current.epoch
    const request = new AbortController()
    current.request = request
    const valid = () => epoch === current.epoch && !request.signal.aborted
    setStatus('loading'); setError(''); setQr(null)
    try {
      const result = await fetchNeteaseLoginStatus({ signal: request.signal })
      if (!valid()) return
      if (result.loggedIn) { setAccount(result); setStatus('connected'); return }
      setAccount(null)
      const nextQr = await createNeteaseLoginQr({ signal: request.signal })
      if (!valid()) return
      setQr(nextQr); setStatus('waiting')
      const expires = Date.now() + 180000
      const poll = async () => {
        if (!valid()) return
        if (Date.now() > expires) { setStatus('expired'); return }
        try {
          const response = await checkNeteaseLoginQr(nextQr.key, { signal: request.signal })
          if (!valid()) return
          if (response.code === 800) { setStatus('expired'); return }
          if (response.code === 803) {
            setStatus('connected'); setAccount(response)
            callbacks.current.onConnected?.()
            return
          }
          setStatus(response.code === 802 ? 'scanned' : 'waiting')
          current.timer = window.setTimeout(poll, 1800)
        } catch (failure) { if (valid()) { setError(failure.message); setStatus('error') } }
      }
      current.timer = window.setTimeout(poll, 1800)
    } catch (failure) { if (valid()) { setError(failure.message); setStatus('error') } }
  }, [cancel])
  useEffect(() => {
    // Defer initialization until the modal has committed. StrictMode's probe
    // teardown can then cancel initialization before issuing duplicate reads.
    const timer = window.setTimeout(() => { void connect() }, 0)
    return () => { window.clearTimeout(timer); cancel() }
  }, [cancel, connect])
  const logout = async () => {
    cancel()
    const current = operation.current
    const epoch = current.epoch
    const request = new AbortController()
    current.request = request
    setStatus('working'); setError('')
    try {
      await logoutNetease({ signal: request.signal })
      if (epoch !== current.epoch || request.signal.aborted) return
      setAccount(null)
      callbacks.current.onDisconnected?.()
    } catch (failure) {
      if (epoch === current.epoch && !request.signal.aborted) { setError(failure.message); setStatus('connected') }
    }
  }
  return <div className="account-panel">
    <p>连接你的收藏、歌单和每日推荐。</p>
    {account ? <div className="account-profile">{account.avatar ? <img src={account.avatar} alt="" /> : <span aria-hidden="true">云</span>}<strong>{account.nickname || '网易云账户'}</strong><small>网易云音乐已连接</small></div>
      : status === 'loading' ? <LoadingState>正在连接网易云…</LoadingState>
        : <div className="account-qr">{qr?.img && <img src={qr.img} alt="网易云登录二维码" />}<p role="status">{status === 'expired' ? '二维码已失效，请刷新' : status === 'scanned' ? '已扫码，请在手机上确认' : status === 'error' ? '登录服务暂时不可用' : '使用网易云音乐 App 扫码'}</p></div>}
    {error && <p className="inline-notice" role="alert">{error}</p>}
    <button type="button" className="button button--primary" disabled={status === 'loading' || status === 'working'} onClick={() => { if (account) void logout(); else void connect() }}>{account ? status === 'working' ? '正在退出…' : '退出登录' : status === 'loading' ? '正在连接…' : '刷新二维码'}</button>
    <p className="settings-note">扫码授权无需在这里输入网易云密码。</p>
  </div>
}
