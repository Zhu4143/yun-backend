import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createImmersiveBackgroundStore } from './immersiveBackgroundStore.js'
import { IMMERSIVE_BACKGROUND_DEFAULTS, normalizeImmersiveBackground } from './visuals/immersiveBackgroundSchema.js'

async function fixture(t) {
  const folder = await mkdtemp(path.join(tmpdir(), 'yun-ore-preset-test-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const file = path.join(folder, 'background.json')
  return { file, store: createImmersiveBackgroundStore(file) }
}

test('opening an unsaved background provides the existing look without saving it', async t => {
  const { file, store } = await fixture(t)
  const result = await store.read()
  assert.deepEqual(result.settings, IMMERSIVE_BACKGROUND_DEFAULTS)
  assert.equal(result.savedAt, null)
  await assert.rejects(stat(file), { code: 'ENOENT' })
})

test('a saved effect survives a new store instance and preserves all tuning groups', async t => {
  const { file, store } = await fixture(t)
  const desired = { ...IMMERSIVE_BACKGROUND_DEFAULTS, flowSpeed: .033, warpStrength: .25, metal: .8,
    hueShift: -15, tintColor: '#AAbbCC', tintStrength: .2, transitionDuration: 4.5 }
  const saved = await store.save(desired)
  assert.ok(Number.isFinite(Date.parse(saved.savedAt)))
  assert.deepEqual((await createImmersiveBackgroundStore(file).read()), saved)
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), saved)
  assert.deepEqual(saved.settings, normalizeImmersiveBackground(desired))
})

test('unsupported and corrupt parameters cannot escape renderer limits', () => {
  const settings = normalizeImmersiveBackground({ flowSpeed: 20, scale: -5, contrast: Infinity,
    grain: 'NaN', tintColor: 'url(private)', unsafeUniform: 10 })
  assert.equal(settings.flowSpeed, .06)
  assert.equal(settings.scale, .65)
  assert.equal(settings.contrast, IMMERSIVE_BACKGROUND_DEFAULTS.contrast)
  assert.equal(settings.grain, IMMERSIVE_BACKGROUND_DEFAULTS.grain)
  assert.equal(settings.tintColor, '#ffffff')
  assert.equal('unsafeUniform' in settings, false)
})

test('invalid save requests leave the last saved effect intact', async t => {
  const { store } = await fixture(t)
  const original = await store.save({ ...IMMERSIVE_BACKGROUND_DEFAULTS, flowSpeed: .029 })
  for (const invalid of [null, [], 'bad']) await assert.rejects(store.save(invalid), TypeError)
  assert.deepEqual(await store.read(), original)
})
