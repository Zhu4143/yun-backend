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

export function createFileNetEaseSessionStore({ filePath }) {
  if (!filePath) throw new Error('netease_session_file_path_required')

  return {
    async get() {
      try {
        const cookie = normalizeNeteaseSessionCookie(await readFile(filePath, 'utf8'))
        return cookie ? { cookie } : null
      } catch (error) {
        if (error?.code === 'ENOENT') return null
        throw error
      }
    },
    async set(session) {
      const cookie = normalizeNeteaseSessionCookie(session?.cookie)
      if (!cookie) throw new Error('netease_session_cookie_required')
      await mkdir(path.dirname(filePath), { recursive: true })
      const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
      await writeFile(temporaryPath, cookie, 'utf8')
      await rename(temporaryPath, filePath)
    },
    async clear() {
      try { await unlink(filePath) } catch (error) {
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
