export function BootGate({ state, renderApp, renderBootScreen }) {
  if (state?.status === 'ready' || state?.status === 'degraded') return renderApp(state)
  return renderBootScreen(state)
}
