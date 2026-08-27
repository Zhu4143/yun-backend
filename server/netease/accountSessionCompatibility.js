function safeUser(user) {
  if (!user || typeof user !== 'object') return null
  return {
    userId: user.userId ?? null,
    nickname: user.nickname || '',
    avatar: user.avatar || '',
    vipType: Number(user.vipType || 0),
  }
}

// Legacy NetEase routes and capability consumers use flat account fields. Keep
// that shape at this boundary while the session domain only exposes { user }.
export function toNeteaseLoginInfo(sessionStatus = {}) {
  const user = safeUser(sessionStatus.user)
  return {
    loggedIn: sessionStatus.loggedIn === true,
    status: sessionStatus.status || 'not_logged_in',
    userId: user?.userId ?? null,
    nickname: user?.nickname || '',
    avatar: user?.avatar || '',
    vipType: user?.vipType || 0,
    ...(user ? { user } : {}),
  }
}
