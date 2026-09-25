import assert from 'node:assert/strict'
import test from 'node:test'
import { createLatestCoverTextureLifecycle } from './particleVinylCoverTextureLifecycle.js'

function createTexture(name) {
  return {
    name,
    disposed: false,
    disposeCount: 0,
    dispose() {
      this.disposed = true
      this.disposeCount += 1
    },
  }
}

function createHarness() {
  const requests = []
  const commits = []
  const errors = []
  const lifecycle = createLatestCoverTextureLifecycle({
    loadTexture(source, onLoad, onError) {
      requests.push({ source, onLoad, onError })
    },
    prepareTexture(texture) {
      texture.prepared = true
    },
    onCommit(texture, context) {
      commits.push({ texture, context })
    },
    onError(error, context) {
      errors.push({ error, context })
    },
  })

  return { lifecycle, requests, commits, errors }
}

test('A -> B keeps the committed A texture visible until B finishes loading', () => {
  const { lifecycle, requests, commits } = createHarness()
  const textureA = createTexture('A')
  const textureB = createTexture('B')

  lifecycle.request('cover-a')
  requests[0].onLoad(textureA)
  lifecycle.request('cover-b')

  assert.equal(requests[0].source, 'cover-a')
  assert.equal(requests[1].source, 'cover-b')
  assert.equal(lifecycle.getCurrentTexture(), textureA)
  assert.equal(textureA.disposed, false)
  assert.deepEqual(commits.map(({ texture }) => texture.name), ['A'])

  requests[1].onLoad(textureB)

  assert.equal(lifecycle.getCurrentTexture(), textureB)
  assert.equal(textureA.disposed, false)
  assert.deepEqual(commits.map(({ texture }) => texture.name), ['A', 'B'])
})

test('rapid A -> B -> C commits only C and disposes both stale arrivals', () => {
  const { lifecycle, requests, commits } = createHarness()
  const textureA = createTexture('A')
  const textureB = createTexture('B')
  const textureC = createTexture('C')

  lifecycle.request('cover-a')
  lifecycle.request('cover-b')
  lifecycle.request('cover-c')
  requests[2].onLoad(textureC)
  requests[0].onLoad(textureA)
  requests[1].onLoad(textureB)

  assert.equal(lifecycle.getCurrentTexture(), textureC)
  assert.deepEqual(commits.map(({ texture }) => texture.name), ['C'])
  assert.equal(textureA.disposeCount, 1)
  assert.equal(textureB.disposeCount, 1)
  assert.equal(textureC.disposed, false)
})

test('late A success cannot overwrite an already committed B texture', () => {
  const { lifecycle, requests, commits } = createHarness()
  const textureA = createTexture('A')
  const textureB = createTexture('B')

  lifecycle.request('cover-a')
  lifecycle.request('cover-b')
  requests[1].onLoad(textureB)
  requests[0].onLoad(textureA)

  assert.equal(lifecycle.getCurrentTexture(), textureB)
  assert.deepEqual(commits.map(({ texture }) => texture.name), ['B'])
  assert.equal(textureA.disposeCount, 1)
  assert.equal(textureB.disposed, false)
})

test('late A error cannot overwrite an already committed B texture', () => {
  const { lifecycle, requests, commits, errors } = createHarness()
  const textureB = createTexture('B')

  lifecycle.request('cover-a')
  lifecycle.request('cover-b')
  requests[1].onLoad(textureB)
  requests[0].onError(new Error('late A failure'))

  assert.equal(lifecycle.getCurrentTexture(), textureB)
  assert.deepEqual(commits.map(({ texture }) => texture.name), ['B'])
  assert.equal(errors.length, 0)
  assert.equal(textureB.disposed, false)
})

test('B error preserves A and the same lifecycle can recover with C', () => {
  const { lifecycle, requests, commits, errors } = createHarness()
  const textureA = createTexture('A')
  const textureC = createTexture('C')

  lifecycle.request('cover-a')
  requests[0].onLoad(textureA)
  lifecycle.request('cover-b')
  requests[1].onError(new Error('B failed'))

  assert.equal(lifecycle.getCurrentTexture(), textureA)
  assert.equal(textureA.disposed, false)
  assert.equal(errors.length, 1)

  lifecycle.request('cover-c')
  requests[2].onLoad(textureC)

  assert.equal(lifecycle.getCurrentTexture(), textureC)
  assert.deepEqual(commits.map(({ texture }) => texture.name), ['A', 'C'])
})

test('one component lifecycle supports consecutive songs and releases retired textures', () => {
  const { lifecycle, requests, commits } = createHarness()
  const textures = ['A', 'B', 'C', 'D'].map(createTexture)

  textures.forEach((texture, index) => {
    lifecycle.request(`cover-${texture.name.toLowerCase()}`)
    requests[index].onLoad(texture)
    lifecycle.retainOnly([texture])
  })

  assert.deepEqual(commits.map(({ texture }) => texture.name), ['A', 'B', 'C', 'D'])
  assert.equal(lifecycle.getCurrentTexture(), textures[3])
  assert.deepEqual(textures.map(({ disposeCount }) => disposeCount), [1, 1, 1, 0])
})

test('a cancelled request disposes a late texture and never commits it', () => {
  const { lifecycle, requests, commits } = createHarness()
  const textureA = createTexture('A')

  const token = lifecycle.request('cover-a')
  lifecycle.cancel(token)
  requests[0].onLoad(textureA)

  assert.equal(lifecycle.getCurrentTexture(), null)
  assert.equal(textureA.disposeCount, 1)
  assert.equal(commits.length, 0)
})

test('StrictMode-like dispose and setup replay can request and commit again', () => {
  const { lifecycle, requests, commits } = createHarness()
  const textureA = createTexture('A')
  const textureB = createTexture('B')

  lifecycle.request('cover-a')
  requests[0].onLoad(textureA)
  lifecycle.dispose()

  assert.equal(textureA.disposeCount, 1)
  assert.equal(lifecycle.getCurrentTexture(), null)

  lifecycle.request('cover-b')
  requests[1].onLoad(textureB)

  assert.equal(lifecycle.getCurrentTexture(), textureB)
  assert.deepEqual(commits.map(({ texture }) => texture.name), ['A', 'B'])
  assert.equal(textureB.disposed, false)
})
