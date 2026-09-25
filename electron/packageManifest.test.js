import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

test('desktop package includes every server runtime source root', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const packagedFiles = packageJson.build?.files || []

  assert.ok(
    packagedFiles.includes('src/services/netease/**/*.js'),
    'server.js imports NetEase capability truth from src/services/netease, so that runtime source root must ship',
  )
})
