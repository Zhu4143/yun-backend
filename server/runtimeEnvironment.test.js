import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { migrateLegacyDataFiles, migrateLegacyEnvironmentFile } from './runtimeEnvironment.js'

test('legacy runtime environment migrates to the user data directory once', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'yun-env-migration-'))
  const legacyPath = path.join(root, 'app', '.env')
  const runtimePath = path.join(root, 'userData', 'data', '.env')
  mkdirSync(path.dirname(legacyPath), { recursive: true })
  writeFileSync(legacyPath, 'DEEPSEEK_API_KEY=kept-local\n', 'utf8')

  try {
    assert.equal(migrateLegacyEnvironmentFile({ legacyPath, runtimePath }), true)
    assert.equal(readFileSync(runtimePath, 'utf8'), 'DEEPSEEK_API_KEY=kept-local\n')
    writeFileSync(legacyPath, 'DEEPSEEK_API_KEY=older-value\n', 'utf8')
    assert.equal(migrateLegacyEnvironmentFile({ legacyPath, runtimePath }), false)
    assert.equal(readFileSync(runtimePath, 'utf8'), 'DEEPSEEK_API_KEY=kept-local\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('migration leaves a missing legacy config alone and refuses same-path copies', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'yun-env-no-migration-'))
  const runtimePath = path.join(root, '.env')
  try {
    assert.equal(migrateLegacyEnvironmentFile({ legacyPath: path.join(root, 'missing.env'), runtimePath }), false)
    writeFileSync(runtimePath, 'YUN_TEST=1\n', 'utf8')
    assert.equal(migrateLegacyEnvironmentFile({ legacyPath: runtimePath, runtimePath }), false)
    assert.equal(existsSync(runtimePath), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('legacy user data migrates only once and ignores paths outside the data directory', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'yun-data-migration-'))
  const legacyDirectory = path.join(root, 'legacy-data')
  const runtimeDirectory = path.join(root, 'userData', 'data')
  mkdirSync(legacyDirectory, { recursive: true })
  writeFileSync(path.join(legacyDirectory, 'yunMemory.json'), '{"episodicMemories":[]}\n', 'utf8')

  try {
    assert.deepEqual(migrateLegacyDataFiles({
      legacyDirectory,
      runtimeDirectory,
      files: ['yunMemory.json', '../outside.json'],
    }), ['yunMemory.json'])
    assert.equal(readFileSync(path.join(runtimeDirectory, 'yunMemory.json'), 'utf8'), '{"episodicMemories":[]}\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
