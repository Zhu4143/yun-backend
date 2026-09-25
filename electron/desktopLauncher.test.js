import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('Windows PowerShell resolves the packaged desktop executable without corrupting its name', {
  skip: process.platform !== 'win32',
}, () => {
  const scriptPath = path.join(projectRoot, 'scripts', 'start-yun.ps1')
  const desktopDirectory = mkdtempSync(path.join(tmpdir(), 'yun-desktop-launcher-'))
  const executablePath = path.join(desktopDirectory, '昀.exe')

  try {
    writeFileSync(executablePath, '')
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      '-CheckDesktopApp',
      '-DesktopAppDirectory', desktopDirectory,
    ], {
      cwd: projectRoot,
      encoding: 'utf8',
    })

    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), executablePath)
  } finally {
    rmSync(desktopDirectory, { recursive: true, force: true })
  }
})
