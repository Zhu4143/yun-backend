export const YUN_DESKTOP_BACKEND_PORT = 3030

export async function acquireDesktopBackend({
  startServer,
  stopServer,
  isHealthyYunBackend,
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
    if (error?.code === 'EADDRINUSE' && await isHealthyYunBackend(port)) {
      if (hasYunAppShell && !await hasYunAppShell(port)) {
        return startOwnedBackend(0)
      }
      return { port, owned: false, stop: null }
    }
    throw error
  }
}
