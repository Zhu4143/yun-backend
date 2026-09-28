import assert from 'node:assert/strict'
import test from 'node:test'

import { acquireDesktopBackend, isCompatibleYunBackend, YUN_DESKTOP_API_VERSION, YUN_DESKTOP_BACKEND_PORT } from './backendRuntime.js'

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

test('desktop backend accepts only a compatible versioned service', () => {
  assert.equal(isCompatibleYunBackend({ ok: true, service: 'yun-backend', apiVersion: YUN_DESKTOP_API_VERSION }), true)
  assert.equal(isCompatibleYunBackend({ ok: true, service: 'yun-backend' }), false)
})

test('desktop backend starts an isolated service and reports an incompatible Yun backend', async () => {
  const addressInUse = Object.assign(new Error('address in use'), { code: 'EADDRINUSE' })
  const requestedPorts = []
  const stopServer = () => {}
  const result = await acquireDesktopBackend({
    startServer: async (port) => {
      requestedPorts.push(port)
      if (port === YUN_DESKTOP_BACKEND_PORT) throw addressInUse
      return { port: 43124 }
    },
    stopServer,
    isHealthyYunBackend: async () => false,
    getBackendHealth: async () => ({ ok: true, service: 'yun-backend', apiVersion: 0 }),
    hasYunAppShell: async () => true,
  })

  assert.deepEqual(requestedPorts, [YUN_DESKTOP_BACKEND_PORT, 0])
  assert.deepEqual(result, {
    port: 43124,
    owned: true,
    stop: stopServer,
    compatibilityNotice: '检测到旧版昀服务，当前桌面版已启动独立兼容服务。旧服务仍占用 3030 端口。',
  })
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
