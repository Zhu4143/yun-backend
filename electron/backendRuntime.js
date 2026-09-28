import { isCompatibleBackendHealth, YUN_BACKEND_API_VERSION } from '../server/backendIdentity.js'

export const YUN_DESKTOP_BACKEND_PORT = 3030
export const YUN_DESKTOP_API_VERSION = YUN_BACKEND_API_VERSION

export const isCompatibleYunBackend = isCompatibleBackendHealth

export async function acquireDesktopBackend({
  startServer,
  stopServer,
  isHealthyYunBackend,
  getBackendHealth,
  hasYunAppShell,
  port = YUN_DESKTOP_BACKEND_PORT,
}) {
  const startOwnedBackend = async (requestedPort) => {
    const address = await startServer(requestedPort)
    const resolvedPort = typeof address === 'object' && address
      ? Number(address.port)
      : Number(address)

    return {
      port: resolvedPort || requestedPort,
      owned: true,
      stop: stopServer,
    }
  }

  try {
    return await startOwnedBackend(port)
  } catch (error) {
    if (error?.code === 'EADDRINUSE') {
      const health = getBackendHealth ? await getBackendHealth(port) : null
      const identifiesYun = health
        ? health?.ok === true && health?.service === 'yun-backend'
        : await isHealthyYunBackend(port)
      if (identifiesYun) {
        const compatible = health
          ? isCompatibleYunBackend(health)
          : await isHealthyYunBackend(port)
        if (!compatible) {
          const isolated = await startOwnedBackend(0)
          return {
            ...isolated,
            compatibilityNotice: '检测到旧版昀服务，当前桌面版已启动独立兼容服务。旧服务仍占用 3030 端口。',
          }
        }
        if (hasYunAppShell && !await hasYunAppShell(port)) {
          return startOwnedBackend(0)
        }
        return { port, owned: false, stop: null }
      }
    }
    throw error
  }
}
