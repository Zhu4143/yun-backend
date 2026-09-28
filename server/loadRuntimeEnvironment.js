import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

import { migrateLegacyDataFiles, migrateLegacyEnvironmentFile } from './runtimeEnvironment.js'

const applicationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const applicationEnvPath = path.join(applicationDirectory, '.env')

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return
  dotenv.config({ path: filePath, override: true, quiet: true })
}

loadDotEnv(applicationEnvPath)

export const legacyBackendDirectory = path.resolve(
  process.env.YUN_LEGACY_BACKEND_DIR || 'C:\\Users\\zhudo\\Documents\\Codex\\2026-05-28\\claude-ai-api-doctype-html-html',
)
export const runtimeDataDirectory = path.resolve(
  process.env.YUN_DATA_DIR || path.join(applicationDirectory, 'server', 'data'),
)
export const runtimeEnvironmentPath = path.join(runtimeDataDirectory, '.env')

migrateLegacyEnvironmentFile({ legacyPath: applicationEnvPath, runtimePath: runtimeEnvironmentPath })
migrateLegacyDataFiles({
  legacyDirectory: path.join(applicationDirectory, 'server', 'data'),
  runtimeDirectory: runtimeDataDirectory,
  files: [
    'manualMusicTags.json',
    'musicLibrary.json',
    'yunMemory.json',
    'yunSettings.json',
    'yunListeningProfile.json',
    'netease-cookie.txt',
  ],
})
loadDotEnv(path.join(legacyBackendDirectory, '.env'))
loadDotEnv(runtimeEnvironmentPath)
