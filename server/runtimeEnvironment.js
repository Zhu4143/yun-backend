import { constants, copyFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

export function migrateLegacyEnvironmentFile({ legacyPath, runtimePath }) {
  const source = path.resolve(legacyPath)
  const destination = path.resolve(runtimePath)
  if (source.toLowerCase() === destination.toLowerCase()) return false
  if (!existsSync(source) || existsSync(destination)) return false
  mkdirSync(path.dirname(destination), { recursive: true })
  try {
    copyFileSync(source, destination, constants.COPYFILE_EXCL)
  } catch (error) {
    if (error?.code === 'EEXIST') return false
    throw error
  }
  return true
}

export function migrateLegacyDataFiles({ legacyDirectory, runtimeDirectory, files = [] }) {
  const legacyRoot = path.resolve(legacyDirectory)
  const runtimeRoot = path.resolve(runtimeDirectory)
  if (legacyRoot.toLowerCase() === runtimeRoot.toLowerCase()) return []
  const migrated = []
  for (const file of files) {
    const relative = path.normalize(String(file || ''))
    if (!relative || path.isAbsolute(relative) || relative.startsWith('..')) continue
    if (migrateLegacyEnvironmentFile({
      legacyPath: path.join(legacyRoot, relative),
      runtimePath: path.join(runtimeRoot, relative),
    })) migrated.push(relative)
  }
  return migrated
}
