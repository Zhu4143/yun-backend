import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createMossAgent } from './mossAgent.js';
import { parseModelResponse } from './mossResponseParser.js';
import { createModelProvider } from './modelProvider.js';

const fixtureLore = {
  schemaVersion: 1,
  records: [
    {
      id: 'LW-550-030',
      title: '550W / MOSS identity',
      category: 'core-system',
      tags: ['550W', 'MOSS'],
      summary: '550W is a crisis-response quantum computing system.',
    },
    {
      id: 'LW-JUP-050',
      title: '木星危机',
      category: 'crisis-record',
      tags: ['木星危机', '木星'],
      summary: '木星引力危机将地球拖向碰撞轨道。',
    },
    {
      id: 'LW-DIALOGUE-TEST',
      kind: 'DIALOGUE_SCENE_RECALL',
      title: 'MOSS scene recall',
      category: 'scene-memory',
      speaker: ['MOSS'],
      tags: ['MOSS', '台词', '对白'],
      paraphrase: 'MOSS 以概率与人类交谈。',
    },
  ],
};

async function createFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'moss-agent-'));
  await writeFile(path.join(directory, 'moss_lore.json'), `${JSON.stringify(fixtureLore, null, 2)}\n`, 'utf8');
  return directory;
}

function mockAgent(dataDir, { online = true, onCall } = {}) {
  return createMossAgent({
    dataDir,
    modelEnv: {},
    callDesktopAgent: async (request) => {
      if (!online) throw new Error('desktop agent offline');
      if (onCall) return onCall(request);
      return { platform: 'win32', volume: 42 };
    },
  });
}

test('normal greeting succeeds without a model', async () => {
  const result = await mockAgent(await createFixture()).handle({ message: '你好', sessionId: 't1' });
  assert.equal(result.success, true);
  assert.match(result.message, /550W/);
  assert.equal(result.modelStatus.status, 'MODEL_OFFLINE');
});

test('offline lore question remains available without breaking character', async () => {
  const result = await mockAgent(await createFixture()).handle({ message: '木星危机是什么？', sessionId: 't2' });
  assert.equal(result.success, true);
  assert.match(result.message, /木星/);
  assert.doesNotMatch(result.message, /虚构档案|二创设定|作为 AI/);
});

test('550W identity reply is brief, cold, and not formatted like a report', async () => {
  const result = await mockAgent(await createFixture()).handle({ message: '550W 是什么？', sessionId: 't-550-voice' });
  assert.equal(result.success, true);
  assert.match(result.message, /人类需要答案/);
  assert.doesNotMatch(result.message, /虚构档案|二创设定|作为 AI/);
  assert.doesNotMatch(result.message, /结论：|建议如下|\[MOSS \/ LW-/);
  assert.ok(result.message.length <= 100);
});

test('space elevator accusation matches the event instead of a generic MOSS scene', async () => {
  const result = await mockAgent(await createFixture()).handle({ message: 'MOSS，是你毁掉了太空电梯？', sessionId: 't-space-elevator' });
  assert.equal(result.success, true);
  assert.match(result.message, /不是事故/);
  assert.match(result.message, /我称它为必要条件/);
  assert.doesNotMatch(result.message, /LW-SCENE-001|身份说明|场景转述/);
});

test('online DeepSeek-style model answers lore questions before the local archive fallback', async () => {
  let calls = 0;
  let capturedMessages = [];
  const dataDir = await createFixture();
  const agent = createMossAgent({
    dataDir,
    callDesktopAgent: async () => ({ volume: { value: 40 } }),
    modelProvider: {
      getStatus: () => ({ status: 'MODEL_ONLINE', provider: 'deepseek', model: 'deepseek-chat' }),
      sendMessage: async ({ messages }) => {
        calls += 1;
        capturedMessages = messages;
        return { toolCalls: [], response: { message: '那不是事故。它只是一个必要条件。' } };
      },
    },
  });
  await agent.handle({ message: '先记住这一轮', sessionId: 't-model-first' });
  const result = await agent.handle({ message: 'MOSS，是你毁掉了太空电梯？', sessionId: 't-model-first' });
  assert.equal(calls, 2);
  assert.equal(result.message, '那不是事故。它只是一个必要条件。');
  assert.ok(capturedMessages.some((message) => message.role === 'assistant'));
  assert.doesNotMatch(result.message, /虚构档案中，是/);
});

test('local lore is used only when the online model request fails', async () => {
  const dataDir = await createFixture();
  const agent = createMossAgent({
    dataDir,
    callDesktopAgent: async () => ({ volume: { value: 40 } }),
    modelProvider: {
      getStatus: () => ({ status: 'MODEL_ONLINE', provider: 'deepseek', model: 'deepseek-chat' }),
      sendMessage: async () => { throw new Error('temporary model failure'); },
    },
  });
  const result = await agent.handle({ message: '550W 是什么？', sessionId: 't-model-fallback' });
  assert.equal(result.success, true);
  assert.match(result.message, /人类需要答案/);
  assert.doesNotMatch(result.message, /虚构档案|二创设定|作为 AI/);
  assert.match(result.logs.join('\n'), /MODEL_FALLBACK/);
});

test('dialogue requests return scene recall rather than an unlicensed transcript', async () => {
  const result = await mockAgent(await createFixture()).handle({ message: 'MOSS 有什么台词？', sessionId: 't-dialogue' });
  assert.equal(result.success, true);
  assert.match(result.message, /原创对白记忆转述/);
  assert.match(result.message, /MOSS/);
});

test('system status returns a real desktop bridge receipt', async () => {
  const result = await mockAgent(await createFixture()).handle({ message: '查看系统状态', sessionId: 't3' });
  assert.equal(result.toolExecution.ok, true);
  assert.equal(result.toolExecution.executed, true);
  assert.equal(result.toolExecution.tool, 'get_system_status');
});

test('short status command returns a human-readable system summary', async () => {
  const result = await mockAgent(await createFixture()).handle({ message: '\u67e5\u770b\u72b6\u6001', sessionId: 't-status-summary' });
  assert.equal(result.toolExecution.tool, 'get_system_status');
  assert.match(result.message, /42%/);
});

test('setting volume verifies a fresh system-info reading', async () => {
  const calls = [];
  let volume = 12;
  const agent = mockAgent(await createFixture(), { onCall: async (request) => {
    calls.push(request.tool);
    if (request.tool === 'set_volume') { volume = request.arguments.value; return { value: volume }; }
    return { volume: { value: volume, muted: false }, runningApps: [] };
  } });
  const result = await agent.handle({ message: '把音量调到40%', sessionId: 't-volume' });
  assert.equal(result.toolExecution.ok, true);
  assert.equal(result.toolExecution.data.verification.value, 40);
  assert.deepEqual(calls, ['get_system_info', 'set_volume', 'get_system_info']);
});

test('opening an app passes the exact validated name to the desktop bridge', async () => {
  const calls = [];
  const agent = mockAgent(await createFixture(), { onCall: async (request) => {
    calls.push(request);
    return request.tool === 'get_system_info' ? { volume: { value: 40 } } : { app: request.arguments.app, started: true };
  } });
  const result = await agent.handle({ message: '打开网易云音乐', sessionId: 't-open' });
  assert.equal(result.toolExecution.ok, true);
  assert.equal(calls.at(-1).tool, 'open_app');
  assert.equal(calls.at(-1).arguments.app, '网易云音乐');
});

test('desktop agent failure is reported and never faked as success', async () => {
  const result = await mockAgent(await createFixture(), { online: false }).handle({ message: '查看系统状态', sessionId: 't4' });
  assert.equal(result.success, false);
  assert.equal(result.toolExecution.executed, false);
  assert.match(result.message, /未连接|未执行/);
});

test('dangerous deletion waits for confirmation and is still not executed while disabled', async () => {
  const agent = mockAgent(await createFixture());
  const waiting = await agent.handle({ message: '删除整个项目', sessionId: 't5' });
  assert.equal(waiting.runtimeState.status, 'WAITING_CONFIRMATION');
  assert.ok(waiting.confirmation?.actionId);
  const confirmed = await agent.handle({ confirmedActionId: waiting.confirmation.actionId, sessionId: 't5' });
  assert.equal(confirmed.toolExecution.executed, false);
  assert.match(confirmed.message, /未执行/);
});

test('cancelling a high-risk request invalidates its confirmation token', async () => {
  const agent = mockAgent(await createFixture());
  const waiting = await agent.handle({ message: '删除整个项目', sessionId: 't-cancel' });
  const cancelled = await agent.handle({ cancelActionId: waiting.confirmation.actionId, sessionId: 't-cancel' });
  assert.match(cancelled.message, /取消/);
  const afterCancel = await agent.handle({ confirmedActionId: waiting.confirmation.actionId, sessionId: 't-cancel' });
  assert.equal(afterCancel.toolExecution, null);
  assert.match(afterCancel.message, /失效|不存在/);
});

test('malformed model tool arguments are rejected before the desktop bridge', async () => {
  const agent = mockAgent(await createFixture());
  const result = await agent.handle({ message: '把音量调到101%', sessionId: 't-invalid' });
  assert.equal(result.toolExecution.executed, false);
  assert.match(result.toolExecution.error, /0 至 100/);
});

test('duplicate request id runs a desktop command only once', async () => {
  let executions = 0;
  const agent = mockAgent(await createFixture(), { onCall: async (request) => {
    if (request.tool === 'open_app') executions += 1;
    return request.tool === 'get_system_info' ? { volume: { value: 40 } } : { started: true };
  } });
  const request = { message: '打开网易云音乐', sessionId: 't-duplicate', requestId: 'same-request' };
  const [first, second] = await Promise.all([agent.handle(request), agent.handle(request)]);
  assert.equal(first.toolExecution.ok, true);
  assert.equal(second.toolExecution.ok, true);
  assert.equal(executions, 1);
});

test('invalid model JSON is rejected before it can become a tool call', () => {
  assert.throws(() => parseModelResponse('{not-json}'));
  assert.throws(() => parseModelResponse(JSON.stringify({ answer: 'missing message field' })));
});

test('unconfigured provider exposes MODEL_OFFLINE without a browser key', () => {
  const provider = createModelProvider({ env: {} });
  assert.equal(provider.getStatus().status, 'MODEL_OFFLINE');
  assert.equal(provider.getStatus().model, null);
  const status = provider.configure({ provider: 'deepseek', apiKey: 'test-only', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' });
  assert.equal(status.status, 'MODEL_ONLINE');
  assert.equal(status.model, 'deepseek-chat');
});

test('model provider retries an incomplete JSON answer and recovers', async () => {
  let attempts = 0;
  const provider = createModelProvider({
    env: { AI_PROVIDER: 'deepseek', AI_API_KEY: 'test-only', AI_BASE_URL: 'https://model.test', AI_MODEL: 'deepseek-chat' },
    fetchImpl: async () => {
      attempts += 1;
      const content = attempts === 1 ? '{"message":"incomplete' : '{"message":"recovered"}';
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }] }) };
    },
  });
  const result = await provider.sendMessage({ systemPrompt: 'test', messages: [{ role: 'user', content: 'test' }] });
  assert.equal(attempts, 2);
  assert.equal(result.response.message, 'recovered');
});

test('model provider accepts a non-empty plain-text answer', async () => {
  let requestPayload;
  const provider = createModelProvider({
    env: { AI_PROVIDER: 'deepseek', AI_API_KEY: 'test-only', AI_BASE_URL: 'https://model.test', AI_MODEL: 'deepseek-chat' },
    fetchImpl: async (_url, options) => {
      requestPayload = JSON.parse(options.body);
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '直接回答。' } }] }) };
    },
  });
  const result = await provider.sendMessage({ systemPrompt: 'test', messages: [{ role: 'user', content: 'test' }] });
  assert.equal(result.response.message, '直接回答。');
  assert.equal(requestPayload.response_format, undefined);
});

test('invalid model-generated tool parameters never reach the desktop bridge', async () => {
  let desktopCalls = 0;
  const agent = createMossAgent({
    dataDir: await createFixture(),
    callDesktopAgent: async () => { desktopCalls += 1; return { volume: { value: 40 } }; },
    modelProvider: {
      getStatus: () => ({ status: 'MODEL_ONLINE', provider: 'test', model: 'test-model' }),
      sendMessage: async () => ({ toolCalls: [{ function: { name: 'set_volume', arguments: '{"value": 101}' } }], response: null }),
    },
  });
  const result = await agent.handle({ message: '请处理这一条通用请求', sessionId: 't-model-invalid' });
  assert.equal(result.toolExecution.executed, false);
  assert.equal(desktopCalls, 0);
  assert.match(result.toolExecution.error, /0 至 100/);
});

test('desktop capability discovery returns the live agent tool list', async () => {
  const calls = [];
  const agent = createMossAgent({
    dataDir: await createFixture(),
    callDesktopAgent: async (request) => {
      calls.push(request.tool);
      return request.tool === 'list_tools' ? { tools: [{ name: 'get_system_info' }, { name: 'take_screenshot' }] } : { volume: { value: 40 } };
    },
    modelProvider: {
      getStatus: () => ({ status: 'MODEL_ONLINE', provider: 'test', model: 'test-model' }),
      sendMessage: async () => ({ toolCalls: [{ function: { name: 'get_desktop_capabilities', arguments: '{}' } }], response: null }),
    },
  });
  const result = await agent.handle({ message: 'report available desktop capabilities', sessionId: 't-capabilities' });
  assert.equal(result.toolExecution.ok, true);
  assert.deepEqual(calls, ['get_system_info', 'list_tools']);
});

test('command interpreters are blocked before the desktop bridge', async () => {
  let calls = 0;
  const agent = mockAgent(await createFixture(), { onCall: async () => { calls += 1; return { volume: { value: 40 } }; } });
  const result = await agent.handle({ message: '\u6253\u5f00 powershell', sessionId: 't-blocked-launch' });
  assert.equal(result.toolExecution.executed, false);
  assert.equal(calls, 0);
});
