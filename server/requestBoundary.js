const HTTP_PROTOCOLS = new Set(['http:', 'https:'])
const SIMPLE_BODY_TYPES = new Set(['text/plain', 'application/x-www-form-urlencoded'])

export function isLoopbackHostname(value) {
  const hostname = String(value || '').toLowerCase()
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
}

export function isLoopbackAddress(value) {
  const address = String(value || '').toLowerCase()
  return address === '::1' || address === '127.0.0.1' || address === '::ffff:127.0.0.1'
}

function parseOrigin(value) {
  if (typeof value !== 'string' || !value || value === 'null') return null
  try {
    const url = new URL(value)
    if (!HTTP_PROTOCOLS.has(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null
    return url
  } catch { return null }
}

function parseHost(value) {
  if (typeof value !== 'string' || !value || /[\s,/@\\?#]/.test(value)) return null
  try {
    const url = new URL(`http://${value}`)
    if (url.username || url.password || url.pathname !== '/' || !url.hostname) return null
    return url
  } catch { return null }
}

export function parseTrustedOrigins(value = '') {
  const entries = Array.isArray(value) ? value : String(value).split(/[\s,]+/)
  return entries.map(parseOrigin).filter(Boolean).map(url => url.origin)
}

function isProtectedPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/') || pathname === '/user_memory.json'
}

// The native desktop bridge intentionally has no browser API. A browser always
// sends Origin on WebSocket handshakes; the backend's Node client does not.
export function isTrustedDesktopRequest(request) {
  const host = parseHost(request.headers?.host)
  return Boolean(host && isLoopbackHostname(host.hostname)
    && isLoopbackAddress(request.socket?.remoteAddress)
    && !Object.hasOwn(request.headers || {}, 'origin')
    && !Object.hasOwn(request.headers || {}, 'referer')
    && !request.headers?.['sec-fetch-site'])
}

export function checkRequestSource(request, pathname, trustedOrigins = []) {
  const host = parseHost(request.headers?.host)
  if (!host) return { status: 400, code: 'invalid_host' }
  const allowedOrigins = new Set(parseTrustedOrigins(trustedOrigins))
  const allowedHosts = new Set([...allowedOrigins].map(origin => new URL(origin).host))
  if (!isLoopbackHostname(host.hostname) && !allowedHosts.has(host.host)) {
    return { status: 403, code: 'untrusted_host' }
  }
  if (!isProtectedPath(pathname)) return null

  const fetchSite = request.headers['sec-fetch-site']
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) {
    return { status: 403, code: 'untrusted_source' }
  }
  const acceptsOrigin = origin => Boolean(origin
    && (origin.host === host.host || (isLoopbackHostname(host.hostname) && allowedOrigins.has(origin.origin)))
    && (isLoopbackHostname(origin.hostname) || allowedOrigins.has(origin.origin)))
  if (Object.hasOwn(request.headers, 'origin') && !acceptsOrigin(parseOrigin(request.headers.origin))) {
    return { status: 403, code: 'untrusted_source' }
  }
  if (!request.headers.origin && request.headers.referer) {
    let refererOrigin
    try { refererOrigin = parseOrigin(new URL(request.headers.referer).origin) } catch { /* Reject malformed sources. */ }
    if (!acceptsOrigin(refererOrigin)) return { status: 403, code: 'untrusted_source' }
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const type = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
    if (SIMPLE_BODY_TYPES.has(type)) return { status: 415, code: 'unsupported_content_type' }
  }
  return null
}

function sendFailure(response, status, code) {
  if (response.destroyed || response.writableEnded) return
  if (response.headersSent) { response.destroy(); return }
  const body = JSON.stringify({ ok: false, code, error: status === 500 ? '服务暂时不可用' : '请求未通过安全检查' })
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) })
  response.end(body)
}

export function createRequestBoundary(handler, { trustedOrigins = [] } = {}) {
  return (request, response) => {
    // HTTP listeners do not await returned promises. Own the entire dispatch
    // promise so a rejected route or malformed encoded path cannot escape.
    void Promise.resolve().then(async () => {
      const url = new URL(request.url || '/', 'http://127.0.0.1')
      decodeURIComponent(url.pathname)
      const rejection = checkRequestSource(request, url.pathname, trustedOrigins)
      if (rejection) return sendFailure(response, rejection.status, rejection.code)
      await handler(request, response)
    }).catch(error => {
      const malformed = error instanceof URIError || error instanceof SyntaxError || error?.code === 'ERR_INVALID_URL'
      sendFailure(response, malformed ? 400 : 500, malformed ? 'invalid_request' : 'request_failed')
    })
  }
}
