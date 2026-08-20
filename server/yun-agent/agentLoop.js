import crypto from 'node:crypto'
import { createYunAgentCore, evaluateToolCall } from './core/index.js'
import { createMusicTools } from './musicTools.js'
import { selectSkill, yunSkills } from './skills.js'
import { createSkillMining } from './skillMining.js'

const MAX_TOOL_CALLS = 4
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`

function safeLibrary(library) {
  return (Array.isArray(library) ? library : []).slice(0, 200).map((track) => ({
    id: String(track.id || ''), title: String(track.title || ''), artist: String(track.artist || ''), source: String(track.source || 'local'),
  }))
}

function promptFor(skills) {
  return [
    'You are Yun, a music assistant. Use tools only for explicit music actions.',
    'Never claim an action succeeded before the renderer executes the returned plan.',
    'For a multi-step request, return every safe action in the user\'s stated order. Use music_add_to_collection only to add the currently playing song to NetEase liked music.',
    'Use music_get_state only when the user explicitly asks about playback state or diagnostics. Never use it as the final action for a recommendation, mood, scene, or companion request; choose a music action instead.',
    `Available reusable skills: ${skills.map((skill) => `${skill.name}: ${skill.description}`).join('; ')}`,
  ].join('\n')
}

function textPlanPrompt(tools) {
  const availableTools = tools.map((tool) => ({ name: tool.name, parameters: tool.parameters, description: tool.description }))
  return [
    'You are Yun, a music companion. Return one strict JSON object and nothing else.',
    'Schema: {"message":"a short natural Chinese reply","toolCalls":[{"name":"tool_name","arguments":{}}]}.',
    'toolCalls may be empty. For explicit music actions, choose only from the listed tools and preserve the user\'s order. Never claim the action already happened.',
    'Use music_get_state only for an explicit playback-status or diagnostic request. For music recommendations, mood, scene, or companion requests, it is not a valid final action: choose a music action instead.',
    'Do not add keys that are not declared in a tool\'s parameters. Return no more than four tool calls.',
    `Available tools: ${JSON.stringify(availableTools)}`,
  ].join('\n')
}

function needsTextPlanFallback(error) {
  return /model returned no answer content/i.test(error instanceof Error ? error.message : String(error))
}

async function analyzeReusableRecommendation(model, request) {
  if (model.getStatus().status !== 'MODEL_ONLINE') return null
  const result = await model.sendMessage({
    systemPrompt: [
      'You are Yun\'s background skill analyst. This is asynchronous and must never affect the live reply.',
      'Only decide whether the successful examples are all scene/mood variants of asking for a music recommendation.',
      'Never create code, URLs, tools, searches, or actions. Return JSON with message, family, title, rationale.',
      'family must be exactly "scene_recommendation" or "none". Use scene_recommendation only when one context-aware recommend action safely fits every example.',
    ].join('\n'),
    messages: [{ role: 'user', content: JSON.stringify({ examples: request.examples, actions: request.actions }) }],
    tools: [],
    runtimeState: { agentStatus: 'BACKGROUND_ANALYSIS' },
  })
  const proposal = result.response || {}
  return proposal.family === 'scene_recommendation'
    ? { family: proposal.family, title: proposal.title, rationale: proposal.rationale }
    : null
}

export function createYunAgent({ dataDir, modelProvider, modelEnv = process.env, now = () => new Date(), skills = yunSkills } = {}) {
  const core = createYunAgentCore({
    dataDir,
    tools: createMusicTools(),
    memoryScope: 'yun-agent',
    modelEnv,
    modelProvider,
    // Planning needs a short function-call response. Bound it so a companion
    // request never stalls the chat behind a long Pro generation.
    modelProviderOptions: { requestTimeoutMs: 30000, maxAttempts: 1, maxTokens: 1200 },
  })
  const skillMining = createSkillMining({ dataDir, now })

  async function executeToolCall(call, context) {
    const name = String(call?.function?.name || call?.name || '')
    let args = call?.arguments ?? call?.function?.arguments ?? {}
    if (typeof args === 'string') {
      try { args = JSON.parse(args) } catch { return { ok: false, tool: name, error: 'invalid_tool_arguments' } }
    }
    const tool = core.registry.get(name)
    const decision = evaluateToolCall(tool, args, { online: Boolean(context.online), confirmed: false })
    if (!decision.ok) return { ok: false, tool: name, error: decision.error, needsConfirmation: decision.needsConfirmation === true }
    return core.registry.invoke(name, args, context)
  }

  async function recordOutcome(outcome) {
    const recorded = await skillMining.recordOutcome(outcome)
    if (!recorded.analysisRequest) return recorded
    // Intentionally detached: the renderer has already completed the action,
    // so Pro analysis cannot add latency to the listener's current turn.
    void analyzeReusableRecommendation(core.model, recorded.analysisRequest)
      .then((proposal) => proposal && skillMining.applySemanticProposal({
        actionKey: recorded.analysisRequest.actionKey,
        proposal,
      }))
      .catch(() => {})
    return { ...recorded, analysisQueued: true, analysisRequest: undefined }
  }

  async function handle({ message, sessionId = id('session'), context = {} } = {}) {
    const cleanMessage = String(message || '').trim()
    if (!cleanMessage) return { ok: false, message: '消息为空。', actions: [] }
    const runtimeContext = { ...context, library: safeLibrary(context.library) }
    await core.state.update({ status: 'ANALYZING', currentTask: cleanMessage, activeTool: null, lastError: null })

    const userSkill = await skillMining.match(cleanMessage)
    if (userSkill) {
      const result = {
        skill: userSkill.id,
        message: `已按你的快捷操作“${userSkill.name.replace(/^常用操作：/, '')}”执行。`,
        actions: userSkill.actions,
      }
      await core.memory.appendTurn(sessionId, { at: now().toISOString(), user: cleanMessage, assistant: result.message })
      await core.state.update({ status: 'SUCCESS', currentTask: userSkill.id, activeTool: null, lastError: null })
      return { ok: true, sessionId, source: 'user_skill', ...result, runtimeState: await core.state.get() }
    }

    const skill = selectSkill(cleanMessage, skills)
    if (skill) {
      const result = await skill.run({ message: cleanMessage, context: runtimeContext })
      await core.memory.appendTurn(sessionId, { at: now().toISOString(), user: cleanMessage, assistant: result.message })
      await core.state.update({ status: 'SUCCESS', currentTask: skill.name, activeTool: null, lastError: null })
      return { ok: true, sessionId, source: 'skill', ...result, runtimeState: await core.state.get() }
    }

    if (core.model.getStatus().status !== 'MODEL_ONLINE') {
      await core.state.update({ status: 'READY', currentTask: null, activeTool: null, lastError: null })
      return { ok: false, sessionId, source: 'offline', message: '智能音乐助手当前未连接模型。', actions: [], runtimeState: await core.state.get() }
    }

    try {
      let result
      const runtimeState = await core.state.get()
      try {
        result = await core.model.sendMessage({
          systemPrompt: promptFor(skills),
          messages: [{ role: 'user', content: cleanMessage }],
          tools: core.registry.toModelTools(),
          runtimeState,
          // Some Pro endpoints accept the connection probe but do not support
          // OpenAI function calls. Detect that quickly, then use JSON below.
          timeoutMs: 8000,
        })
      } catch (error) {
        if (!needsTextPlanFallback(error)) throw error
        result = await core.model.sendMessage({
          systemPrompt: textPlanPrompt(core.registry.listEnabled()),
          messages: [{ role: 'user', content: cleanMessage }],
          tools: [],
          runtimeState,
          timeoutMs: 30000,
        })
      }
      const calls = (Array.isArray(result.toolCalls) && result.toolCalls.length
        ? result.toolCalls
        : result.response?.toolCalls || []).slice(0, MAX_TOOL_CALLS)
      const executions = []
      for (const call of calls) executions.push(await executeToolCall(call, runtimeContext))
      const actions = executions.filter((item) => item.ok).map((item) => item.data)
      const runId = actions.length ? id('run') : null
      if (runId) await skillMining.recordPlan({ runId, message: cleanMessage, actions })
      const messageText = result.response?.answer || result.response?.message || (actions.length ? '我已经准备好执行这些操作。' : '我还需要你再说明一点想做什么。')
      await core.memory.appendTurn(sessionId, { at: now().toISOString(), user: cleanMessage, assistant: messageText })
      await core.state.update({ status: actions.length ? 'SUCCESS' : 'READY', currentTask: null, activeTool: null, lastError: null, lastToolResult: executions.at(-1) || null })
      return { ok: true, sessionId, runId, source: 'model', message: messageText, actions, executions, runtimeState: await core.state.get() }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error)
      await core.state.update({ status: 'ERROR', currentTask: null, activeTool: null, lastError: messageText })
      return { ok: false, sessionId, message: `智能音乐处理失败：${messageText}`, actions: [], runtimeState: await core.state.get() }
    }
  }

  return {
    handle,
    async configureModel(config) {
      try {
        const modelStatus = await core.model.connect(config)
        await core.state.update({ status: 'READY', currentTask: null, activeTool: null, lastError: null })
        return modelStatus
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await core.state.update({ status: 'ERROR', currentTask: null, activeTool: null, lastError: message })
        throw error
      }
    },
    getModelStatus: () => core.model.getStatus(),
    recordOutcome,
    listSkillCandidates: () => skillMining.listCandidates(),
    decideSkillCandidate: (decision) => skillMining.decide(decision),
    getRuntimeState: () => core.state.get(),
    getTools: () => core.registry.listEnabled(),
    getSkills: () => skills,
  }
}
