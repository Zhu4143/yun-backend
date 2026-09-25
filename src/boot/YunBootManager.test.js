import assert from 'node:assert/strict'
import test from 'node:test'

import { YunBootManager } from './YunBootManager.js'
import { createYunBootManager } from './createYunBootManager.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

test('all blocking tasks must complete before boot becomes ready', async () => {
  const library = deferred()
  const manager = new YunBootManager({
    tasks: [
      { id: 'CONFIG', label: 'Config', blocking: true, run: async () => ({ ok: true }) },
      { id: 'LIBRARY', label: 'Library', blocking: true, run: () => library.promise },
    ],
  })

  const startPromise = manager.start()
  await Promise.resolve()

  assert.equal(manager.getState().status, 'booting')
  library.resolve({ songs: [] })
  await startPromise

  assert.equal(manager.getState().status, 'ready')
})

test('an optional task failure enters degraded without blocking the application', async () => {
  const manager = new YunBootManager({
    tasks: [
      { id: 'CONFIG', blocking: true, run: async () => true },
      { id: 'TTS', blocking: false, run: async () => { throw new Error('offline') } },
    ],
  })

  await manager.start()

  assert.equal(manager.getState().status, 'degraded')
  assert.equal(manager.getState().tasks.find((task) => task.id === 'TTS').status, 'warning')
})

test('optional tasks retry in the background without delaying application readiness', async () => {
  const optionalAttempt = deferred()
  let attempts = 0
  const manager = new YunBootManager({
    tasks: [
      { id: 'CONFIG', blocking: true, run: async () => true },
      {
        id: 'TTS',
        blocking: false,
        dependencies: ['CONFIG'],
        retries: 1,
        run: async () => {
          attempts += 1
          if (attempts === 1) throw new Error('temporarily offline')
          return optionalAttempt.promise
        },
      },
    ],
  })

  const starting = manager.start()
  let readinessTimer = 0

  try {
    const readiness = await Promise.race([
      starting.then(() => 'ready'),
      new Promise((resolve) => {
        readinessTimer = setTimeout(() => resolve('blocked'), 50)
      }),
    ])
    assert.equal(readiness, 'ready')
    assert.equal(manager.getState().status, 'ready')
    assert.equal(manager.getState().tasks.find((task) => task.id === 'TTS').status, 'running')
    assert.equal(manager.getState().tasks.find((task) => task.id === 'TTS').retries, 1)
  } finally {
    clearTimeout(readinessTimer)
    optionalAttempt.resolve({ available: true })
    await starting
  }

  await new Promise((resolve) => {
    if (manager.getState().tasks.find((task) => task.id === 'TTS').status === 'success') return resolve()
    const unsubscribe = manager.subscribe((state) => {
      if (state.tasks.find((task) => task.id === 'TTS').status !== 'success') return
      unsubscribe()
      resolve()
    })
  })

  assert.equal(manager.getState().status, 'ready')
  assert.equal(attempts, 2)
})

test('full NetEase playlist synchronization is outside the startup critical path', () => {
  const manager = createYunBootManager({
    storage: { getItem: () => null, setItem: () => {} },
  })

  assert.equal(manager.definitions.get('LOAD_PLAYLISTS').blocking, false)
  assert.deepEqual(manager.definitions.get('INIT_PLAYER_CORE').dependencies, ['LOAD_LIBRARY'])
})

test('a timed out task retries and can complete boot', async () => {
  let attempts = 0
  const manager = new YunBootManager({
    tasks: [{
      id: 'BACKEND',
      blocking: true,
      retries: 1,
      timeoutMs: 5,
      run: async () => {
        attempts += 1
        if (attempts === 1) return new Promise(() => {})
        return true
      },
    }],
  })

  await manager.start()

  assert.equal(attempts, 2)
  assert.equal(manager.getState().status, 'ready')
  assert.equal(manager.getState().tasks[0].retries, 1)
})

test('a blocking task final failure makes boot fail', async () => {
  const manager = new YunBootManager({
    tasks: [{ id: 'BACKEND', blocking: true, retries: 1, run: async () => { throw new Error('down') } }],
  })

  await manager.start()

  assert.equal(manager.getState().status, 'failed')
  assert.equal(manager.getState().tasks[0].status, 'failed')
  assert.match(manager.getState().tasks[0].error, /down/)
})

test('reported boot progress never moves backward', async () => {
  const observed = []
  const manager = new YunBootManager({
    tasks: [{
      id: 'PLAYLISTS',
      run: async ({ reportProgress }) => {
        reportProgress(60, '6 / 10')
        reportProgress(20, '2 / 10')
      },
    }],
  })
  manager.subscribe((state) => observed.push(state.progress))

  await manager.start()

  observed.forEach((progress, index) => {
    if (index > 0) assert.ok(progress >= observed[index - 1])
  })
})

test('successful boot progress reaches exactly 100', async () => {
  const manager = new YunBootManager({
    tasks: [
      { id: 'CONFIG', weight: 5, run: async () => true },
      { id: 'PLAYLISTS', weight: 25, run: async ({ reportProgress }) => reportProgress(48) },
    ],
  })

  await manager.start()

  assert.equal(manager.getState().progress, 100)
})

test('concurrent start calls share one boot pipeline', async () => {
  const gate = deferred()
  let runs = 0
  const manager = new YunBootManager({
    tasks: [{ id: 'CONFIG', run: async () => { runs += 1; return gate.promise } }],
  })

  const first = manager.start()
  const second = manager.start()
  gate.resolve(true)
  await Promise.all([first, second])

  assert.equal(runs, 1)
})

test('a second start after ready does not initialize again', async () => {
  let runs = 0
  const manager = new YunBootManager({
    tasks: [{ id: 'CONFIG', run: async () => { runs += 1 } }],
  })

  await manager.start()
  await manager.start()

  assert.equal(runs, 1)
})

test('manual retry reruns a failed pipeline and can recover', async () => {
  let runs = 0
  const manager = new YunBootManager({
    tasks: [{
      id: 'BACKEND',
      run: async () => {
        runs += 1
        if (runs === 1) throw new Error('first failure')
        return true
      },
    }],
  })

  await manager.start()
  assert.equal(manager.getState().status, 'failed')
  await manager.retry()

  assert.equal(manager.getState().status, 'ready')
  assert.equal(runs, 2)
})
