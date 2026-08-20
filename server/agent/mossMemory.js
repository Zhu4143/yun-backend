import { readFile, writeFile } from 'node:fs/promises';

const DEFAULT_MEMORY = { profile: { name: '朱东宇', preferredLanguage: 'zh-CN' }, longTerm: [], sessions: {} };
const SENSITIVE = /(密码|password|token|api[_ -]?key|密钥|身份证|银行卡)/i;

export function createMossMemoryStore(filePath) {
  let data = null;
  async function load() {
    if (data) return data;
    try { data = { ...DEFAULT_MEMORY, ...JSON.parse(await readFile(filePath, 'utf8')) }; } catch { data = structuredClone(DEFAULT_MEMORY); }
    return data;
  }
  async function save() { await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8'); }
  return {
    async context(sessionId) { const memory = await load(); return { profile: memory.profile, longTerm: memory.longTerm.slice(-8), recent: (memory.sessions[sessionId] || []).slice(-8) }; },
    async appendTurn(sessionId, turn) { const memory = await load(); memory.sessions[sessionId] = [...(memory.sessions[sessionId] || []), turn].slice(-24); await save(); },
    async remember(text) {
      const memory = await load();
      if (SENSITIVE.test(text)) return { saved: false, reason: '检测到敏感信息，MOSS 不会将其写入长期记忆。' };
      memory.longTerm.push({ text: text.slice(0, 400), createdAt: new Date().toISOString(), source: 'explicit-user-request' });
      memory.longTerm = memory.longTerm.slice(-50); await save();
      return { saved: true };
    },
  };
}
