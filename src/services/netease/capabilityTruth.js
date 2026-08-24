import { planNeteaseCapability } from './capabilityPlanner.js'
import { getCapability } from './capabilityRegistry.js'

function publicCapabilityFact(definition) {
  if (!definition) return null
  return {
    id: definition.id,
    name: definition.name,
    domain: definition.domain,
    actions: [...definition.actions],
    transport: definition.transport,
    supportStatus: definition.supportStatus,
  }
}
// Capability knowledge shown to a model is derived from the same deterministic
// intent catalog and registry used by execution. At most the matched capability
// is injected; the full registry is deliberately never copied into every turn.
export function getRelevantNeteaseCapabilityTruth({ message = '', inputMode = 'text', currentTrack = null } = {}) {
  const plan = planNeteaseCapability({ message, inputMode, currentTrack })
  const definition = getCapability(plan?.capability)
  if (!definition) return null
  return {
    source: 'netease-capability-registry',
    detectedIntent: plan.detectedIntent,
    requestedAction: plan.action,
    capabilities: [publicCapabilityFact(definition)],
  }
}
