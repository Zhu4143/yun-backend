import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createYunTelemetry } from './index.js'

function mockRequest(body, headers = {}) {
  const buffer = Buffer.from(body)
  return {
    headers,
    async *[Symbol.asyncIterator]() {
      yield buffer
    },
  }
}

function mockResponse() {
  const response = { status: 0, headers: {}, body: '' }
  response.writeHead = (status, headers) => {
    response.status = status
    response.headers = headers
  }
  response.end = (body) => {
    response.body = body
  }
  return response
}

function makeEvent(overrides = {}) {
  return {
    id: 'test_event',
    ts: new Date().toISOString(),
    sessionId: 'sess',
    turnId: null,
    domain: 'command',
    type: 'command.received',
    actor: 'user',
    source: 'test',
    payload: { length: 5 },
    context: {},
    meta: { app: 'yun', env: 'test' },
    ...overrides,
  }
}

async function makeTelemetry() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-telemetry-'))
  return { dir, telemetry: createYunTelemetry({ dataDir: dir }) }
}

// Flush pending snapshot writes before removing the directory so cleanup never
// races a background write.
async function cleanup({ dir, telemetry }) {
  await telemetry.flush()
  await rm(dir, { recursive: true, force: true })
}

test('default telemetry file contains no raw user text', async () => {
  const ctx = await makeTelemetry()
  try {
    const req = mockRequest(JSON.stringify({ events: [makeEvent({ payload: { text: '播放周杰伦的歌', length: 7 } })] }))
    const res = mockResponse()
    await ctx.telemetry.handleTelemetry(req, res)
    assert.equal(res.status, 200)
    const raw = await readFile(path.join(ctx.dir, 'yun_telemetry.ndjson'), 'utf8')
    assert.equal(raw.includes('播放周杰伦的歌'), false)
    assert.equal(raw.includes('"text"'), false)
  } finally {
    await cleanup(ctx)
  }
})

test('oversized request is rejected without crashing', async () => {
  const ctx = await makeTelemetry()
  try {
    const req = mockRequest('{}', { 'content-length': String(300 * 1024) })
    const res = mockResponse()
    await ctx.telemetry.handleTelemetry(req, res)
    assert.equal(res.status, 413)
  } finally {
    await cleanup(ctx)
  }
})

test('invalid event schema is rejected', async () => {
  const ctx = await makeTelemetry()
  try {
    const req = mockRequest(JSON.stringify({ events: [{ type: 123 }] }))
    const res = mockResponse()
    await ctx.telemetry.handleTelemetry(req, res)
    assert.equal(res.status, 200)
    assert.equal(JSON.parse(res.body).accepted, 0)
  } finally {
    await cleanup(ctx)
  }
})

test('batch is capped at the maximum event count', async () => {
  const ctx = await makeTelemetry()
  try {
    const events = Array.from({ length: 600 }, (_, index) => makeEvent({ id: `event_${index}` }))
    const req = mockRequest(JSON.stringify({ events }))
    const res = mockResponse()
    await ctx.telemetry.handleTelemetry(req, res)
    assert.equal(res.status, 200)
    assert.equal(JSON.parse(res.body).accepted, 500)
  } finally {
    await cleanup(ctx)
  }
})

test('oversized single event is rejected', async () => {
  const ctx = await makeTelemetry()
  try {
    const req = mockRequest(JSON.stringify({ events: [makeEvent({ id: 'big', payload: { items: Array.from({ length: 50 }, () => 'x'.repeat(200)) } })] }))
    const res = mockResponse()
    await ctx.telemetry.handleTelemetry(req, res)
    assert.equal(res.status, 200)
    assert.equal(JSON.parse(res.body).accepted, 0)
  } finally {
    await cleanup(ctx)
  }
})

test('flush awaits the pending snapshot write', async () => {
  const ctx = await makeTelemetry()
  try {
    const events = Array.from({ length: 60 }, (_, index) => makeEvent({ id: `event_${index}` }))
    const res = mockResponse()
    await ctx.telemetry.handleTelemetry(mockRequest(JSON.stringify({ events })), res)
    assert.equal(res.status, 200)
    await ctx.telemetry.flush()
    const signals = JSON.parse(await readFile(path.join(ctx.dir, 'yun_signals.json'), 'utf8'))
    assert.equal(signals.totals['command.received'], 60)
  } finally {
    await cleanup(ctx)
  }
})
