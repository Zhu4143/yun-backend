// Generic typed tool registry factory, generalized from MOSS's
// `server/agent/mossToolRegistry.js`.
//
// Unlike the MOSS original, each tool carries a `handler` (its local
// implementation) instead of a desktop-agent mapping, so the same registry can
// be reused for music, companion, or any other tool family without depending
// on the desktop bridge.

function parameterJsonSchema(type) {
  if (type === 'number' || type === '0-100') return { type: 'number' }
  if (type === 'boolean') return { type: 'boolean' }
  return { type: 'string' }
}

function normalizeTool(tool) {
  return {
    name: String(tool?.name || '').trim(),
    description: String(tool?.description || '').trim(),
    risk: ['low', 'medium', 'high'].includes(tool?.risk) ? tool.risk : 'low',
    authorization: ['L1', 'L2', 'L3'].includes(tool?.authorization) ? tool.authorization : 'L1',
    enabled: tool?.enabled !== false,
    requiresOnline: tool?.requiresOnline === true,
    parameters: tool?.parameters && typeof tool.parameters === 'object' ? tool.parameters : {},
    handler: typeof tool?.handler === 'function' ? tool.handler : null,
  }
}

export function createToolRegistry(tools = []) {
  const registry = new Map()
  for (const raw of tools) {
    const tool = normalizeTool(raw)
    if (!tool.name) continue
    registry.set(tool.name, tool)
  }

  const get = (name) => registry.get(String(name || '')) || null
  const list = () => [...registry.values()]
  const listEnabled = () => list().filter((tool) => tool.enabled)

  const toModelTools = () => listEnabled().map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(tool.parameters).map(([key, type]) => [key, parameterJsonSchema(type)]),
        ),
        required: Object.keys(tool.parameters),
        additionalProperties: false,
      },
    },
  }))

  async function invoke(name, args = {}, context = {}) {
    const tool = get(name)
    if (!tool) return { ok: false, tool: String(name || ''), error: 'unknown_tool' }
    if (!tool.enabled) return { ok: false, tool: tool.name, error: 'tool_disabled' }
    if (!tool.handler) return { ok: false, tool: tool.name, error: 'tool_has_no_handler' }
    try {
      const data = await tool.handler(args, context)
      return { ok: true, tool: tool.name, data }
    } catch (error) {
      return { ok: false, tool: tool.name, error: error instanceof Error ? error.message : String(error) }
    }
  }

  return { get, list, listEnabled, toModelTools, invoke }
}
