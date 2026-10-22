async function readJson(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.ok === false) throw new Error(payload.error || '网易云登录服务暂不可用')
  return payload
}

export const fetchNeteaseLoginStatus = ({ signal } = {}) => fetch('/api/netease/login/status', { cache: 'no-store', signal }).then(readJson)

export async function createNeteaseLoginQr({ signal } = {}) {
  const { key } = await fetch(`/api/netease/login/qr/key?t=${Date.now()}`, { cache: 'no-store', signal }).then(readJson)
  const qr = await fetch(`/api/netease/login/qr/create?key=${encodeURIComponent(key)}&t=${Date.now()}`, { cache: 'no-store', signal }).then(readJson)
  return { key, ...qr }
}

export const checkNeteaseLoginQr = (key, { signal } = {}) => fetch(`/api/netease/login/qr/check?key=${encodeURIComponent(key)}&t=${Date.now()}`, { cache: 'no-store', signal }).then(readJson)

export const logoutNetease = ({ signal } = {}) => fetch('/api/netease/logout', { method: 'POST', signal }).then(readJson)
