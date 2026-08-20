const RECONNECT_INTERVAL_MS = 8000;

export function createMossDesktopAgentBridge({ callDesktopAgent, now = () => new Date() }) {
  let status = 'CONNECTING';
  let lastError = null;
  let lastConnectedAt = null;
  let lastCheckedAt = null;
  let probeTimer = null;
  let probeInFlight = null;

  function snapshot() {
    return { status, lastError, lastConnectedAt, lastCheckedAt, reconnectIntervalMs: RECONNECT_INTERVAL_MS };
  }

  async function probe({ force = false } = {}) {
    if (probeInFlight) return probeInFlight;
    if (!force && lastCheckedAt && now().getTime() - new Date(lastCheckedAt).getTime() < RECONNECT_INTERVAL_MS) return snapshot();
    status = 'CONNECTING';
    probeInFlight = callDesktopAgent({ tool: 'get_system_info', arguments: {} }, { timeout: 2500 })
      .then(() => {
        status = 'CONNECTED'; lastError = null; lastConnectedAt = now().toISOString(); lastCheckedAt = now().toISOString(); return snapshot();
      })
      .catch((error) => {
        status = 'DISCONNECTED'; lastError = error instanceof Error ? error.message : String(error); lastCheckedAt = now().toISOString(); return snapshot();
      })
      .finally(() => { probeInFlight = null; });
    return probeInFlight;
  }

  async function call(toolCall, options) {
    status = 'CONNECTING';
    try {
      const result = await callDesktopAgent(toolCall, options);
      status = 'CONNECTED'; lastError = null; lastConnectedAt = now().toISOString(); lastCheckedAt = now().toISOString();
      return result;
    } catch (error) {
      status = 'ERROR'; lastError = error instanceof Error ? error.message : String(error); lastCheckedAt = now().toISOString();
      throw error;
    }
  }

  function start() {
    if (probeTimer) return;
    void probe({ force: true });
    probeTimer = setInterval(() => { void probe({ force: true }); }, RECONNECT_INTERVAL_MS);
    probeTimer.unref?.();
  }

  function stop() { if (probeTimer) clearInterval(probeTimer); probeTimer = null; }
  return { start, stop, probe, call, getStatus: snapshot };
}
