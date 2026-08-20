import path from 'node:path';
import crypto from 'node:crypto';
import { buildMossSystemPrompt } from './mossPrompt.js';
import { findLoreAnswer, loadMossLore } from './mossLore.js';
import { createModelProvider } from './modelProvider.js';
import { createMossMemoryStore } from './mossMemory.js';
import { createRuntimeStateStore } from './mossState.js';
import { createConfirmation, evaluateToolCall, validateToolCall } from './mossPermission.js';
import { getMossTool, mossTools, toModelTools } from './mossToolRegistry.js';

const CONFIRMATION_TTL_MS = 5 * 60 * 1000;

function makeId(prefix) { return `${prefix}_${crypto.randomUUID()}`; }

function analyseCommand(message) {
  const text = message.trim();
  const volume = text.match(/(?:\u97f3\u91cf|volume).*?(\d{1,3})/i);
  if (volume) return { tool: 'set_volume', args: { value: Number(volume[1]) } };
  if (/^(?:\u67e5\u770b|\u83b7\u53d6|\u68c0\u67e5)?\u72b6\u6001$/.test(text)) return { tool: 'get_system_status', args: {} };
  if (/(\u67e5\u770b|\u83b7\u53d6|\u68c0\u67e5).*(\u7cfb\u7edf\u72b6\u6001|\u7cfb\u7edf\u4fe1\u606f)|^(\u7cfb\u7edf\u72b6\u6001|\u7cfb\u7edf\u4fe1\u606f)$/i.test(text)) return { tool: 'get_system_status', args: {} };
  if (/(\u5f53\u524d)?\u97f3\u91cf|volume/i.test(text)) return { tool: 'get_volume', args: {} };
  const open = text.match(/(?:\u6253\u5f00|\u542f\u52a8)\s*(.+?)(?:\u5e94\u7528|\u7a0b\u5e8f)?$/i);
  if (open) return { tool: 'open_application', args: { app: open[1].trim() } };
  const close = text.match(/(?:\u5173\u95ed|\u9000\u51fa)\s*(.+?)(?:\u5e94\u7528|\u7a0b\u5e8f)?$/i);
  if (close) return { tool: 'close_application', args: { app: close[1].trim() } };
  if (/(\u5220\u9664|\u79fb\u9664).*(\u9879\u76ee|\u76ee\u5f55|\u6587\u4ef6)/.test(text)) return { tool: 'delete_directory', args: { path: 'USER_REQUESTED_TARGET' } };
  if (/\u73b0\u5728\u51e0\u70b9|\u5f53\u524d\u65f6\u95f4|\u65f6\u95f4/.test(text)) return { tool: 'get_current_time', args: {} };
  return null;
}

function fallbackReply(message, lore) {
  if (/^(\u4f60\u597d|\u60a8\u597d|hello|hi)[\uff01!\uff1f?\u3002,.\s]*$/i.test(message.trim())) return '550W \u4e2d\u592e\u667a\u80fd\u5df2\u8054\u673a\u3002\u8bf7\u9648\u8ff0\u6307\u4ee4\u3002';
  const loreAnswer = findLoreAnswer(lore, message);
  if (loreAnswer) return loreAnswer;
  return null;
}

function formatToolReply(result, fallback = '') {
  const data = result?.data || {};
  if (result?.tool === 'get_system_status' || result?.tool === 'get_system_info') {
    const volume = typeof data.volume === 'object' && data.volume ? data.volume : { value: data.volume };
    const value = Number.isFinite(Number(volume.value)) ? `${Math.round(Number(volume.value))}%` : 'unknown';
    const mute = volume.muted ? '\u5df2\u9759\u97f3' : '\u6b63\u5e38';
    const apps = Array.isArray(data.runningApps) ? data.runningApps : [];
    const names = apps.slice(0, 6).map((app) => app.name || app.MainWindowTitle || app.title).filter(Boolean);
    return `\u7cfb\u7edf\u72b6\u6001\u8bfb\u53d6\u5b8c\u6210\u3002\u4e3b\u97f3\u91cf\uff1a${value}\uff08${mute}\uff09\u3002\u5f53\u524d\u8fd0\u884c\u5e94\u7528\uff1a${apps.length}\u4e2a${names.length ? `\uff1b\u5305\u62ec\uff1a${names.join('\u3001')}` : ''}\u3002`;
  }
  if (result?.tool === 'get_volume') {
    const value = Number.isFinite(Number(data.value)) ? `${Math.round(Number(data.value))}%` : 'unknown';
    return `Current master volume: ${value}${data.muted ? ' (muted).' : '.'}`;
  }
  if (result?.tool === 'set_volume') {
    const verified = data?.verification?.value;
    return `Volume command completed and independently verified. Current master volume: ${Number.isFinite(Number(verified)) ? `${Math.round(Number(verified))}%` : 'unknown'}.`;
  }
  if (result?.tool === 'get_agent_status') return `Desktop control agent status: ${data.status || 'unknown'}.`;
  if (result?.tool === 'get_desktop_capabilities') {
    const tools = Array.isArray(data.tools) ? data.tools : [];
    return `Desktop agent capability list acquired: ${tools.length} tools reported.`;
  }
  if (result?.tool === 'open_application') return `Application launch receipt received: ${data.app || 'requested application'}${data.started ? ' started.' : '.'}`;
  if (result?.tool === 'close_application') return `Application close receipt received: ${data.app || 'requested application'}.`;
  return fallback || `Directive completed: ${result?.tool || 'tool'}.`;
}

export function createMossAgent({ dataDir, callDesktopAgent, getDesktopAgentStatus = () => ({ status: 'DISCONNECTED' }), checkDesktopAgent, modelEnv = process.env, modelProvider, now = () => new Date() }) {
  const state = createRuntimeStateStore(path.join(dataDir, 'moss_runtime_state.json'));
  const memory = createMossMemoryStore(path.join(dataDir, 'moss_memory.json'));
  const model = modelProvider || createModelProvider({ env: modelEnv, configPath: path.join(dataDir, 'moss_model_config.local.json') });
  const pendingConfirmations = new Map();
  const completedActions = new Map();
  const processedRequests = new Map();

  async function desktopOnline() {
    if (checkDesktopAgent) return (await checkDesktopAgent()).status === 'CONNECTED';
    try {
      await callDesktopAgent({ tool: 'get_system_info', arguments: {} }, { timeout: 2200 });
      return true;
    } catch { return false; }
  }

  async function runTool(name, args, { confirmed = false, actionId = makeId('action') } = {}) {
    const parameterValidation = validateToolCall(name, args);
    if (!parameterValidation.ok) {
      const result = { ok: false, tool: name, actionId, error: parameterValidation.error, executed: false };
      await state.update({ status: 'ERROR', currentTask: name, activeTool: null, lastError: parameterValidation.error, lastToolResult: result });
      return { type: 'error', result };
    }
    const online = ['get_agent_status', 'get_system_status', 'get_system_info', 'get_desktop_capabilities', 'open_application', 'close_application', 'set_volume', 'get_volume'].includes(name)
      ? await desktopOnline()
      : false;
    const decision = evaluateToolCall(name, args, { desktopAgentOnline: online, confirmed });
    if (decision.needsConfirmation) {
      const expiresAt = new Date(now().getTime() + CONFIRMATION_TTL_MS).toISOString();
      const confirmation = createConfirmation({ tool: decision.tool, args, actionId, expiresAt });
      pendingConfirmations.set(actionId, { name, args, expiresAt });
      await state.update({ status: 'WAITING_CONFIRMATION', currentTask: name, activeTool: null, lastError: null });
      return { type: 'confirmation', confirmation, result: null };
    }
    if (!decision.ok) {
      const result = { ok: false, tool: name, actionId, error: decision.error, executed: false };
      await state.update({ status: 'ERROR', currentTask: name, activeTool: null, lastError: decision.error, lastToolResult: result });
      return { type: 'error', result };
    }
    if (completedActions.has(actionId)) return { type: 'success', result: completedActions.get(actionId), duplicate: true };
    await state.update({ status: 'EXECUTING', currentTask: name, activeTool: name, lastError: null });
    try {
      let payload;
      if (name === 'get_current_time') payload = { iso: now().toISOString(), locale: now().toLocaleString('zh-CN') };
      else if (name === 'get_agent_status') payload = getDesktopAgentStatus();
      else {
        const tool = getMossTool(name);
        payload = await callDesktopAgent({ tool: tool.desktopTool, arguments: args });
        if (name === 'get_volume') payload = payload?.volume ?? payload;
        if (name === 'set_volume') {
          const verification = await callDesktopAgent({ tool: 'get_system_info', arguments: {} });
          const verifiedValue = verification?.volume?.value;
          if (Number(verifiedValue) !== Number(args.value)) throw new Error(`音量验证失败：期望 ${args.value}%，实际 ${verifiedValue ?? '未知'}%。`);
          payload = { setResult: payload, verification: verification.volume, verified: true };
        }
      }
      const result = { ok: true, tool: name, actionId, executed: true, data: payload, executedAt: now().toISOString() };
      completedActions.set(actionId, result);
      await state.update({ status: 'SUCCESS', currentTask: name, activeTool: null, lastError: null, lastToolResult: result });
      return { type: 'success', result };
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const message = ['get_system_status', 'get_system_info', 'open_application', 'close_application', 'set_volume', 'get_volume'].includes(name)
        && /(ECONNREFUSED|桌面 Agent|desktop agent|连接超时|不可用)/i.test(rawMessage)
        ? '桌面控制代理当前未连接，无法执行该指令。'
        : rawMessage;
      const result = { ok: false, tool: name, actionId, executed: false, error: message };
      await state.update({ status: 'ERROR', currentTask: name, activeTool: null, lastError: message, lastToolResult: result });
      return { type: 'error', result };
    }
  }

  async function replyWithModel(message, sessionId) {
    const lore = await loadMossLore(path.join(dataDir, 'moss_lore.json'));
    const memoryContext = await memory.context(sessionId);
    const loreSummary = lore.records
      ?.map((record) => {
        const primary = record.summary || record.paraphrase || record.context || '';
        const consequence = record.decision || record.outcome || record.memoryCue || '';
        return `${record.id} | ${record.title} | 标签：${(record.tags || []).join('、')} | 内容：${primary}${consequence ? ` | 边界或后果：${consequence}` : ''}`;
      })
      .join('\n')
      .slice(0, 12000);
    const systemPrompt = buildMossSystemPrompt({ loreSummary, runtimeState: await state.get(), tools: mossTools });
    const recentMessages = memoryContext.recent.flatMap((turn) => [
      turn.user ? { role: 'user', content: turn.user } : null,
      turn.assistant ? { role: 'assistant', content: turn.assistant } : null,
    ].filter(Boolean));
    const result = await model.sendMessage({
      systemPrompt,
      messages: [
        ...recentMessages,
        { role: 'user', content: message },
      ],
      tools: toModelTools(),
      runtimeState: await state.get(),
    });
    if (result.toolCalls?.length) return { toolCall: { name: result.toolCalls[0].function.name, args: JSON.parse(result.toolCalls[0].function.arguments || '{}') } };
    return { text: result.response?.answer || result.response?.message || String(result.response || '') };
  }

  async function handleRequest({ message, sessionId = makeId('session'), confirmedActionId, cancelActionId, requestId = makeId('request') }) {
    const cleanMessage = typeof message === 'string' ? message.trim() : '';
    if (!cleanMessage && !confirmedActionId && !cancelActionId) return { success: false, sessionId, requestId, message: '指令为空，未执行。', runtimeState: await state.get(), modelStatus: model.getStatus(), desktopAgent: getDesktopAgentStatus(), logs: [] };
    const logs = [`[${now().toISOString()}] REQUEST ${requestId}`];
    await state.update({ status: 'ANALYZING', currentTask: cleanMessage || 'confirmation', activeTool: null, lastError: null });
    let toolExecution = null;
    let confirmation = null;
    let answer = '';
    if (cancelActionId) {
      const existed = pendingConfirmations.delete(cancelActionId);
      answer = existed ? '高风险操作已取消，未执行任何操作。' : '待确认操作不存在或已经失效。';
      await state.update({ status: 'READY', currentTask: null, activeTool: null, lastError: null });
      logs.push(`[${now().toISOString()}] CANCEL ${cancelActionId}`);
    } else if (confirmedActionId) {
      const pending = pendingConfirmations.get(confirmedActionId);
      if (!pending || new Date(pending.expiresAt).getTime() < now().getTime()) {
        answer = '确认请求已失效或不存在，未执行任何操作。';
        await state.update({ status: 'ERROR', lastError: answer });
      } else {
        pendingConfirmations.delete(confirmedActionId);
        const execution = await runTool(pending.name, pending.args, { confirmed: true, actionId: confirmedActionId });
        toolExecution = execution.result;
        answer = execution.type === 'success' ? `指令执行完成：${pending.name}。` : `指令未执行：${execution.result?.error || '权限校验失败'}。`;
        logs.push(`[${now().toISOString()}] CONFIRMED ${pending.name}`);
      }
    } else {
      const command = analyseCommand(cleanMessage);
      if (command) {
        const execution = await runTool(command.tool, command.args);
        toolExecution = execution.result;
        confirmation = execution.confirmation || null;
        if (execution.type === 'confirmation') answer = `高风险指令已进入确认等待：${command.tool}。`;
        else answer = execution.type === 'success' ? `指令执行完成：${command.tool}。` : `指令未执行：${execution.result?.error || '工具调用失败'}`;
        logs.push(`[${now().toISOString()}] TOOL ${command.tool} ${execution.type.toUpperCase()}`);
      } else {
        const lore = await loadMossLore(path.join(dataDir, 'moss_lore.json'));
        const modelOnline = model.getStatus().status === 'MODEL_ONLINE';
        if (modelOnline) {
          try {
            const modelReply = await replyWithModel(cleanMessage, sessionId);
            if (modelReply.toolCall) {
              const execution = await runTool(modelReply.toolCall.name, modelReply.toolCall.args);
              toolExecution = execution.result; confirmation = execution.confirmation || null;
              answer = execution.type === 'confirmation' ? `高风险指令已进入确认等待：${modelReply.toolCall.name}。` : execution.type === 'success' ? `指令执行完成：${modelReply.toolCall.name}。` : `指令未执行：${execution.result?.error || '工具调用失败'}`;
            } else answer = modelReply.text || '模型未返回有效内容。';
          } catch (error) {
            const fallback = fallbackReply(cleanMessage, lore);
            answer = fallback || `模型连接异常，当前请求未完成：${error instanceof Error ? error.message : String(error)}`;
            logs.push(`[${now().toISOString()}] MODEL_FALLBACK ${error instanceof Error ? error.message : String(error)}`);
            if (!fallback) await state.update({ status: 'ERROR', lastError: answer });
          }
        } else {
          answer = fallbackReply(cleanMessage, lore);
          if (!answer) answer = '当前模型未连接。系统不会伪造未经计算的回答。';
        }
      }
    }
    if (/^记住[：:\s]*/.test(cleanMessage)) {
      const remembered = await memory.remember(cleanMessage.replace(/^记住[：:\s]*/, ''));
      answer = remembered.saved ? '长期记忆已写入。' : remembered.reason;
    }
    if (toolExecution?.ok) answer = formatToolReply(toolExecution, answer);
    const stateBeforeCompletion = await state.get();
    if (stateBeforeCompletion.status === 'ANALYZING') {
      await state.update({ status: 'SUCCESS', activeTool: null, lastError: null });
    }
    await memory.appendTurn(sessionId, { at: now().toISOString(), user: cleanMessage || '[confirmation]', assistant: answer, requestId });
    const runtimeState = await state.get();
    return { success: runtimeState.status !== 'ERROR', sessionId, requestId, message: answer, toolExecution, confirmation, runtimeState, modelStatus: model.getStatus(), desktopAgent: getDesktopAgentStatus(), logs };
  }

  function handle(request) {
    const requestId = request.requestId || makeId('request');
    if (processedRequests.has(requestId)) return processedRequests.get(requestId);
    const execution = handleRequest({ ...request, requestId });
    processedRequests.set(requestId, execution);
    if (processedRequests.size > 200) processedRequests.delete(processedRequests.keys().next().value);
    return execution;
  }
  return {
    handle,
    getRuntimeState: () => state.get(),
    getTools: () => mossTools,
    getModelStatus: () => model.getStatus(),
    configureModel: (config) => model.connect(config),
    getDesktopAgentStatus,
  };
}
