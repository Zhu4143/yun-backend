async function readJson(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || '网易云登录服务暂不可用')
  return payload
}

export const fetchNeteaseLoginStatus = () => fetch('/api/netease/login/status', { cache: 'no-store' }).then(readJson)

export async function createNeteaseLoginQr() {
  const { key } = await fetch(`/api/netease/login/qr/key?t=${Date.now()}`, { cache: 'no-store' }).then(readJson)
  const qr = await fetch(`/api/netease/login/qr/create?key=${encodeURIComponent(key)}&t=${Date.now()}`, { cache: 'no-store' }).then(readJson)
  return { key, ...qr }
}

export const checkNeteaseLoginQr = (key) => fetch(`/api/netease/login/qr/check?key=${encodeURIComponent(key)}&t=${Date.now()}`, { cache: 'no-store' }).then(readJson)

export const logoutNetease = () => fetch('/api/netease/logout', { method: 'POST' }).then(readJson)
