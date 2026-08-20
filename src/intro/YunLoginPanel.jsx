import { useCallback, useEffect, useRef, useState } from 'react'
import LiquidGlass from 'liquid-glass-react'
import { checkNeteaseLoginQr, createNeteaseLoginQr, fetchNeteaseLoginStatus, logoutNetease } from '../api/neteaseAuthApi'

const statusText = {
  loading: '正在连接网易云…',
  waiting: '请使用网易云音乐 App 扫码',
  scanned: '已扫码，请在手机上确认',
  expired: '二维码已失效，请刷新',
  error: '登录服务暂时不可用',
}

export default function YunLoginPanel({ open, onBack, onLoginSubmit }) {
  const [status, setStatus] = useState('idle')
  const [qr, setQr] = useState(null)
  const [account, setAccount] = useState(null)
  const [error, setError] = useState('')
  const pollRef = useRef(0)

  const stopPolling = useCallback(() => window.clearInterval(pollRef.current), [])

  const refreshQr = useCallback(async () => {
    stopPolling()
    setStatus('loading')
    setError('')
    try {
      const nextQr = await createNeteaseLoginQr()
      setQr(nextQr)
      setStatus('waiting')
      pollRef.current = window.setInterval(async () => {
        try {
          const result = await checkNeteaseLoginQr(nextQr.key)
          if (result.code === 802) setStatus('scanned')
          if (result.code === 800) {
            stopPolling()
            setStatus('expired')
          }
          if (result.code === 803) {
            stopPolling()
            const nextAccount = { nickname: result.nickname || '网易云用户', avatar: result.avatar || '' }
            setAccount(nextAccount)
            setStatus('success')
            onLoginSubmit?.({ provider: 'netease', ...nextAccount })
          }
        } catch (pollError) {
          stopPolling()
          setError(pollError.message)
          setStatus('error')
        }
      }, 1800)
    } catch (nextError) {
      setError(nextError.message)
      setStatus('error')
    }
  }, [onLoginSubmit, stopPolling])

  useEffect(() => {
    if (!open) {
      stopPolling()
      return undefined
    }
    let cancelled = false
    fetchNeteaseLoginStatus().then((result) => {
      if (cancelled) return
      if (result.loggedIn) {
        setAccount({ nickname: result.nickname || '网易云用户', avatar: result.avatar || '' })
        setStatus('success')
      } else {
        refreshQr()
      }
    }).catch(() => refreshQr())
    return () => {
      cancelled = true
      stopPolling()
    }
  }, [open, refreshQr, stopPolling])

  const logout = async () => {
    await logoutNetease().catch(() => {})
    setAccount(null)
    refreshQr()
  }

  return (
    <section className={`yun-login-shell${open ? ' is-open' : ''}`} aria-hidden={!open}>
      <div className="yun-login-glass-wrap">
        <LiquidGlass displacementScale={34} blurAmount={0.015} saturation={118} aberrationIntensity={1.4} elasticity={0.22} cornerRadius={32} padding="0" className="yun-login-panel">
          <div className="yun-login-form yun-netease-login">
            <div className="yun-login-heading">
              <p>NETEASE CLOUD MUSIC</p>
              <h2>网易云登录</h2>
              <span>登录后可使用你的网易云账户授权。</span>
            </div>

            {status === 'success' && account ? (
              <div className="yun-netease-account">
                {account.avatar ? <img src={account.avatar} alt="" /> : <div className="yun-netease-avatar-placeholder">云</div>}
                <strong>{account.nickname}</strong>
                <span>网易云音乐已连接</span>
              </div>
            ) : (
              <div className="yun-netease-qr-wrap">
                {qr?.img ? <img className="yun-netease-qr" src={qr.img} alt="网易云登录二维码" /> : <div className="yun-netease-qr-loading" />}
                <p>{error || statusText[status] || '准备登录'}</p>
              </div>
            )}

            <div className="yun-login-actions">
              <button type="button" className="yun-login-back" onClick={onBack}>返回</button>
              {status === 'success' ? (
                <button type="button" className="yun-login-submit" onClick={logout}>退出登录</button>
              ) : (
                <button type="button" className="yun-login-submit" onClick={refreshQr} disabled={status === 'loading'}>刷新二维码</button>
              )}
            </div>
            <p className="yun-login-note">请使用网易云音乐 App 扫码；本站不会读取或保存你的密码。</p>
          </div>
        </LiquidGlass>
      </div>
    </section>
  )
}
