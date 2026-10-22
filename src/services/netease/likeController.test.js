import test from 'node:test'
import assert from 'node:assert/strict'
import { createNeteaseLikeController, getNeteaseLikeSongId } from './likeController.js'

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('only a confirmed NetEase identity can be written, never a local file ID', () => {
  assert.equal(getNeteaseLikeSongId({ source: 'netease', providerId: '123' }), '123')
  assert.equal(getNeteaseLikeSongId({ id: 'netease-456' }), '456')
  assert.equal(getNeteaseLikeSongId({ source: 'local', id: '123' }), '')
  assert.equal(getNeteaseLikeSongId({ source: 'netease', providerId: 'NaN' }), '')
})

test('a delayed liked-status read cannot paint the next song red', async () => {
  const first = deferred()
  const controller = createNeteaseLikeController({
    readLiked: (songId) => songId === '123' ? first.promise : Promise.resolve({ statuses: [{ providerId: songId, liked: false }] }),
  })
  const oldRead = controller.selectSong('123')
  await controller.selectSong('456')
  first.resolve({ statuses: [{ providerId: '123', liked: true }] })
  await oldRead
  assert.deepEqual(controller.getSnapshot(), { songId: '456', liked: false, status: 'ready', error: '' })
})

test('confirmed add and remove reach the server, duplicate clicks submit once', async () => {
  const mutation = deferred()
  const writes = []
  const controller = createNeteaseLikeController({
    readLiked: async () => ({ statuses: [{ providerId: '123', liked: false }] }),
    writeLiked: async (id, liked) => { writes.push({ id, liked }); return writes.length === 1 ? mutation.promise : { providerId: id, liked } },
  })
  await controller.selectSong('123')
  const adding = controller.toggle()
  await controller.toggle()
  assert.equal(controller.getSnapshot().liked, false)
  mutation.resolve({ providerId: '123', liked: true })
  await adding
  assert.equal(controller.getSnapshot().liked, true)
  await controller.toggle()
  assert.equal(controller.getSnapshot().liked, false)
  assert.deepEqual(writes, [{ id: '123', liked: true }, { id: '123', liked: false }])
})

test('failed or unconfirmed writes preserve the existing red heart', async () => {
  for (const writeLiked of [
    async () => ({ providerId: '999', liked: false }),
    async () => { throw new Error('网易云网络错误') },
  ]) {
    const controller = createNeteaseLikeController({
      readLiked: async () => ({ statuses: [{ providerId: '123', liked: true }] }),
      writeLiked,
    })
    await controller.selectSong('123')
    await controller.toggle()
    assert.equal(controller.getSnapshot().liked, true)
    assert.equal(controller.getSnapshot().status, 'error')
  }
})

test('returning to a song during its write reads after it settles', async () => {
  const mutation = deferred()
  let liked = false
  const controller = createNeteaseLikeController({
    readLiked: async (id) => ({ statuses: [{ providerId: id, liked: id === '123' && liked }] }),
    writeLiked: async (id, nextLiked) => { await mutation.promise; liked = nextLiked; return { providerId: id, liked } },
  })
  await controller.selectSong('123')
  const writing = controller.toggle()
  await controller.selectSong('456')
  const returning = controller.selectSong('123')
  assert.equal(controller.getSnapshot().status, 'loading')
  mutation.resolve()
  await Promise.all([writing, returning])
  assert.equal(controller.getSnapshot().liked, true)
  assert.equal(controller.getSnapshot().status, 'ready')
})

test('a login error does not create an assumed empty collection or submit a write', async () => {
  let writes = 0
  const controller = createNeteaseLikeController({
    readLiked: async () => { throw Object.assign(new Error('请先登录网易云'), { code: 'not_logged_in' }) },
    writeLiked: async () => { ++writes },
  })
  await controller.selectSong('123')
  await controller.toggle()
  assert.equal(controller.getSnapshot().status, 'login_required')
  assert.equal(controller.getSnapshot().liked, null)
  assert.equal(writes, 0)
})

test('an account refresh invalidates the previous account read for the same song', async () => {
  const previous = deferred()
  let reads = 0
  const controller = createNeteaseLikeController({
    readLiked: async () => ++reads === 1 ? previous.promise : { statuses: [{ providerId: '123', liked: false }] },
  })
  const oldRead = controller.selectSong('123')
  await Promise.resolve()
  await controller.selectSong('123')
  previous.resolve({ statuses: [{ providerId: '123', liked: true }] })
  await oldRead
  assert.equal(controller.getSnapshot().liked, false)
})
