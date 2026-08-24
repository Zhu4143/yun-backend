async function invokeDesktopCapability(request) {
  const response = await fetch('/api/netease/desktop-capability', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || result.ok === false) throw new Error(result.error || 'desktop_capability_failed')
  return result
}

export class NeteaseDesktopAdapter {
  constructor({ invoke = invokeDesktopCapability } = {}) {
    this.invoke = invoke
  }

  async execute(capability, action, args = {}) {
    if (capability !== 'netease.client.open' || action !== 'open') {
      return { ok: false, unsupported: true, error: 'desktop_capability_not_implemented' }
    }
    // The adapter exposes a semantic request. It never exposes coordinates or
    // OCR details to the planner and must rely on its invoker to verify success.
    return this.invoke({ capability, action, args: { application: 'cloudmusic', ...args } })
  }

  async getState() {
    return {
      audio: {},
      client: {},
    }
  }
}
