import {
  getCapability,
  isExecutableCapability,
  NETEASE_TRANSPORT,
} from './capabilityRegistry.js'

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || 'capability_execution_failed')
}

const capabilityErrorCodes = new Set([
  'unsupported',
  'unauthorized',
  'not_logged_in',
  'vip_required',
  'not_found',
  'network_error',
  'provider_error',
  'empty_result',
  'ambiguous',
])

function normalizeAdapterResult(result, request, transport) {
  const metadata = {
    capability: request.capability,
    action: request.action,
    transport,
  }
  if (result && typeof result === 'object' && !Array.isArray(result) && Object.hasOwn(result, 'ok')) {
    return { ...result, value: result, ...metadata }
  }
  return { ok: true, value: result, ...metadata }
}

export class NeteaseCapabilityExecutor {
  constructor({ apiAdapter = null, playerAdapter = null, desktopAdapter = null, capabilityLookup = getCapability } = {}) {
    this.adapters = {
      [NETEASE_TRANSPORT.API]: apiAdapter,
      [NETEASE_TRANSPORT.PLAYER]: playerAdapter,
      [NETEASE_TRANSPORT.DESKTOP]: desktopAdapter,
    }
    this.capabilityLookup = capabilityLookup
  }

  async execute(request = {}, context = {}) {
    const definition = this.capabilityLookup(request.capability)
    if (!definition) {
      return { ok: false, unsupported: true, error: 'unknown_capability', errorCode: 'unsupported', capability: request.capability || null, action: request.action || null, transport: 'unavailable' }
    }
    if (!definition.actions.includes(request.action)) {
      return { ok: false, unsupported: true, error: 'unsupported_capability_action', errorCode: 'unsupported', capability: definition.id, action: request.action || null, transport: definition.transport }
    }
    if (definition.requiresConfirmation && context.confirmed !== true) {
      return { ok: false, needsConfirmation: true, error: 'confirmation_required', capability: definition.id, action: request.action, transport: definition.transport, risk: definition.risk }
    }
    if (!isExecutableCapability(definition)) {
      return { ok: false, unsupported: true, error: 'capability_unavailable', errorCode: 'unsupported', capability: definition.id, action: request.action, transport: definition.transport, supportStatus: definition.supportStatus }
    }

    // There is intentionally no catch-to-desktop path here. A transient API
    // failure remains an API failure because transport ownership comes only
    // from the registry, never from runtime exceptions.
    const adapter = this.adapters[definition.transport]
    if (!adapter?.execute) {
      return { ok: false, unsupported: true, error: 'transport_adapter_unavailable', errorCode: 'unsupported', capability: definition.id, action: request.action, transport: definition.transport }
    }
    try {
      const result = await adapter.execute(definition.id, request.action, request.args || {}, context)
      return normalizeAdapterResult(result, request, definition.transport)
    } catch (error) {
      return {
        ok: false,
        error: errorMessage(error),
        errorCode: capabilityErrorCodes.has(error?.code) ? error.code : 'provider_error',
        errorDetails: error?.details || null,
        capability: definition.id,
        action: request.action,
        transport: definition.transport,
      }
    }
  }
}

export function formatCapabilityExecutionReply(result, {
  success = '操作已完成。',
  failure = '这次操作没有完成。',
  unsupported = '这个能力目前还不能可靠控制。',
  confirmation = '这个操作需要你再次明确确认。',
} = {}) {
  if (result?.ok === true) return success
  if (result?.needsConfirmation) return confirmation
  if (result?.unsupported) return unsupported
  return failure
}
