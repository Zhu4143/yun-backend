export const YUN_BACKEND_API_VERSION = 1

export function createBackendIdentity({ appVersion = 'unknown', buildHash = 'unknown' } = {}) {
  return {
    service: 'yun-backend',
    apiVersion: YUN_BACKEND_API_VERSION,
    appVersion: String(appVersion || 'unknown'),
    buildHash: String(buildHash || 'unknown'),
  }
}

export function isCompatibleBackendHealth(payload) {
  return payload?.ok === true
    && payload?.service === 'yun-backend'
    && payload?.apiVersion === YUN_BACKEND_API_VERSION
}
