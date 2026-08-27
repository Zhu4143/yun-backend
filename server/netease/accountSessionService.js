import { normalizeNeteaseSessionCookie } from './sessionStore.js'

export const NETEASE_SESSION_STATES = Object.freeze([
  'not_logged_in',
  'logging_in',
  'logged_in',
  'expired',
  'invalid',
  'network_error',
])

function publicStatus(status, user = null) {
  return {
    loggedIn: status === 'logged_in',
    status,
    ...(user ? { user } : {}),
  }
}

function normalizedValidation(result = {}) {
  const status = NETEASE_SESSION_STATES.includes(result.status) ? result.status : 'invalid'
  return { status, user: result.user || null }
}

function isNetworkFailure(error) {
  const providerStatus = Number(error?.status ?? error?.statusCode ?? error?.code)
  return error?.code === 'network_error'
    || (Number.isFinite(providerStatus) && providerStatus >= 500)
    || /network|timeout|socket|fetch|econn|enotfound/i.test(String(error?.message || ''))
}

export function createNetEaseAccountSessionValidator({ loginStatus } = {}) {
  if (typeof loginStatus !== 'function') throw new Error('netease_login_status_required')

  return async ({ cookie }) => {
    const response = await loginStatus({ cookie, timestamp: Date.now() })
    const body = response?.body || {}
    const data = body.data || body
    const profile = data.profile || body.profile
    if (profile?.userId) {
      return {
        status: 'logged_in',
        user: {
          userId: profile.userId,
          nickname: profile.nickname || '网易云用户',
          avatar: profile.avatarUrl || '',
          vipType: Number(profile.vipType || 0),
        },
      }
    }
    const providerCode = Number(body.code || response?.code || response?.status || 0)
    if (providerCode === 301) return { status: 'expired' }
    if (providerCode === 401 || providerCode === 403) return { status: 'invalid' }
    if (providerCode >= 500) return { status: 'network_error' }
    return { status: 'invalid' }
  }
}

export function createNetEaseAccountSessionService({ store, validate = async () => ({ status: 'invalid' }) } = {}) {
  if (!store || typeof store.get !== 'function' || typeof store.set !== 'function' || typeof store.clear !== 'function') {
    throw new Error('netease_session_store_required')
  }

  let session = null
  let status = 'not_logged_in'
  let user = null
  let initialized = false

  async function initialize() {
    if (initialized) return
    const stored = await store.get()
    const cookie = normalizeNeteaseSessionCookie(stored?.cookie)
    session = cookie ? { cookie } : null
    status = session ? 'logging_in' : 'not_logged_in'
    initialized = true
  }

  function getSession() {
    return session ? { ...session } : null
  }

  async function setSession(nextSession) {
    await initialize()
    const cookie = normalizeNeteaseSessionCookie(nextSession?.cookie)
    if (!cookie) throw new Error('netease_session_cookie_required')
    await store.set({ cookie })
    session = { cookie }
    status = 'logging_in'
    user = null
    return getSession()
  }

  async function clearSession() {
    await initialize()
    await store.clear()
    session = null
    status = 'not_logged_in'
    user = null
    return publicStatus(status)
  }

  async function validateSession() {
    await initialize()
    if (!session) return publicStatus('not_logged_in')
    try {
      const result = normalizedValidation(await validate({ ...session }))
      status = result.status
      user = result.user
      return publicStatus(status, user)
    } catch (error) {
      // A network failure says nothing about credential validity. Keep the
      // persisted session intact so a later retry can validate it.
      status = isNetworkFailure(error) ? 'network_error' : 'invalid'
      user = null
      return publicStatus(status)
    }
  }

  async function getStatus() {
    await initialize()
    return publicStatus(status, user)
  }

  return { initialize, getStatus, getSession, setSession, clearSession, validateSession }
}
