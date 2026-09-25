import assert from 'node:assert/strict'
import test from 'node:test'

import { acquireDesktopBackend, YUN_DESKTOP_BACKEND_PORT } from './backendRuntime.js'

test('desktop backend starts on the stable companion port', async () => {
  let requestedPort = null
  const stopServer = () => {}

  const result = await acquireDesktopBackend({
    startServer: async (port) => {
      requestedPort = port
      return { port }
    },
    stopServer,
    isHealthyYunBackend: async () => false,
  })

  assert.equal(YUN_DESKTOP_BACKEND_PORT, 3030)
  assert.equal(requestedPort, 3030)
  assert.deepEqual(result, { port: 3030, owned: true, stop: stopServer })
})

test('desktop backend reuses an already healthy Yun service on port 3030', async () => {
  const addressInUse = Object.assign(new Error('address in use'), { code: 'EADDRINUSE' })

  const result = await acquireDesktopBackend({
    startServer: async () => { throw addressInUse },
    stopServer: () => {},
    isHealthyYunBackend: async (port) => port === 3030,
  })

  assert.deepEqual(result, { port: 3030, owned: false, stop: null })
})

test('desktop backend starts an isolated renderer server when the healthy Yun service has no app shell', async () => {
  const addressInUse = Object.assign(new Error('address in use'), { code: 'EADDRINUSE' })
  const requestedPorts = []
  const stopServer = () => {}

  const result = await acquireDesktopBackend({
    startServer: async (port) => {
      requestedPorts.push(port)
      if (port === YUN_DESKTOP_BACKEND_PORT) throw addressInUse
      return { port: 43123 }
    },
    stopServer,
    isHealthyYunBackend: async () => true,
    hasYunAppShell: async () => false,
  })

  assert.deepEqual(requestedPorts, [YUN_DESKTOP_BACKEND_PORT, 0])
  assert.deepEqual(result, { port: 43123, owned: true, stop: stopServer })
})

test('desktop backend does not reuse an unknown service occupying port 3030', async () => {
  const addressInUse = Object.assign(new Error('address in use'), { code: 'EADDRINUSE' })

  await assert.rejects(
    acquireDesktopBackend({
      startServer: async () => { throw addressInUse },
      stopServer: () => {},
      isHealthyYunBackend: async () => false,
    }),
    addressInUse,
  )
})
