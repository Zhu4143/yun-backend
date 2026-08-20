import { getMossTool, needsDesktopBridge } from './mossToolRegistry.js';

const highRiskTools = new Set(['delete_file', 'delete_directory', 'move_file', 'send_message', 'email_send', 'open_url', 'write_file', 'type_text']);
const blockedApplicationTargets = /^(?:cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?|wt(?:\.exe)?|windows terminal|wscript(?:\.exe)?|cscript(?:\.exe)?|mshta(?:\.exe)?|reg(?:\.exe)?)$/i;

export function validateToolCall(name, args = {}) {
  const tool = getMossTool(name);
  if (!tool) return { ok: false, error: `未知工具：${name}` };
  for (const [key, expected] of Object.entries(tool.parameters)) {
    const value = args[key];
    if (expected === '0-100' && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100)) return { ok: false, error: `参数 ${key} 必须为 0 至 100。` };
    if (expected === 'string' && (typeof value !== 'string' || !value.trim())) return { ok: false, error: `参数 ${key} 不能为空。` };
    if (key.includes('path') && typeof value === 'string' && value.includes('..')) return { ok: false, error: '路径参数不能包含上级目录跳转。' };
  }
  if (name === 'open_application' && blockedApplicationTargets.test(String(args.app || '').trim())) return { ok: false, error: 'Command interpreters and script hosts are not permitted MOSS launch targets.' };
  return { ok: true, tool };
}

export function evaluateToolCall(name, args, { desktopAgentOnline = false, confirmed = false } = {}) {
  const validation = validateToolCall(name, args);
  if (!validation.ok) return validation;
  const { tool } = validation;
  const confirmationRequired = highRiskTools.has(name) || tool.risk === 'high';
  if (confirmationRequired && !confirmed) return { ok: false, needsConfirmation: true, tool, error: '该操作属于高风险操作，需要用户明确确认。' };
  if (!tool.enabled) return { ok: false, tool, error: `工具 ${name} 当前未启用，未执行任何操作。` };
  if (needsDesktopBridge(tool) && !desktopAgentOnline) return { ok: false, tool, error: '桌面控制代理当前未连接，无法执行该指令。' };
  return { ok: true, tool };
}

export function createConfirmation({ tool, args, actionId, expiresAt }) {
  return {
    actionId,
    tool: tool.name,
    summary: `请求执行 ${tool.name}。风险等级：${tool.risk.toUpperCase()}。`,
    parameters: args,
    expiresAt,
    warning: '确认后系统会再次校验权限、工具启用状态与参数；未通过校验时不会执行。',
  };
}
