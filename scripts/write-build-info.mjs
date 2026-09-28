import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
let commit = 'unknown'
let dirty = false
try {
  commit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  dirty = Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim())
} catch {
  // Source archives without git metadata still receive an app-version identity.
}

const buildHash = `${commit}${dirty ? '-dirty' : ''}`
const buildDirectory = path.join(root, 'build')
mkdirSync(buildDirectory, { recursive: true })
writeFileSync(path.join(buildDirectory, 'build-info.json'), `${JSON.stringify({ appVersion: packageJson.version, buildHash }, null, 2)}\n`, 'utf8')
process.stdout.write(`Packaging Yun ${packageJson.version} (${buildHash})\n`)
