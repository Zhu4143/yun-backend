import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

export function normalizeNeteaseSessionCookie(input) {
  const items = Array.isArray(input) ? input : [input]
  const ignored = new Set(['path', 'domain', 'expires', 'max-age', 'secure', 'httponly', 'samesite', 'priority'])
  const cookies = new Map()
  for (const item of items) {
    for (const rawPart of String(item || '').split(/[;\n]/)) {
      const [rawName, ...rest] = rawPart.trim().split('=')
      const name = String(rawName || '').trim()
      const value = rest.join('=').trim()
      if (!name || !value || ignored.has(name.toLowerCase())) continue
      cookies.set(name, value)
    }
  }
  return Array.from(cookies, ([name, value]) => `${name}=${value}`).join('; ')
}

export function createFileNetEaseSessionStore({ filePath, fs = { mkdir, readFile, rename, unlink, writeFile } }) {
  if (!filePath) throw new Error('netease_session_file_path_required')

  return {
    async get() {
      try {
        const cookie = normalizeNeteaseSessionCookie(await fs.readFile(filePath, 'utf8'))
        return cookie ? { cookie } : null
      } catch (error) {
        if (error?.code === 'ENOENT') return null
        throw error
      }
    },
    async set(session) {
      const cookie = normalizeNeteaseSessionCookie(session?.cookie)
      if (!cookie) throw new Error('netease_session_cookie_required')
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      const temporaryPath = `${filePath}.${randomUUID()}.tmp`
      try {
        await fs.writeFile(temporaryPath, cookie, { encoding: 'utf8', mode: 0o600 })
        await fs.rename(temporaryPath, filePath)
      } catch (error) {
        try { await fs.unlink(temporaryPath) } catch { /* Preserve the original write or rename error. */ }
        throw error
      }
    },
    async clear() {
      try { await fs.unlink(filePath) } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    },
  }
}

export function createMemoryNetEaseSessionStore(initialSession = null) {
  let session = initialSession ? { ...initialSession } : null
  return {
    async get() { return session ? { ...session } : null },
    async set(nextSession) { session = { ...nextSession } },
    async clear() { session = null },
  }
}
