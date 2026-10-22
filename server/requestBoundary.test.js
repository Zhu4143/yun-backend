import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { WebSocket, WebSocketServer } from 'ws'
import { createRequestBoundary, isTrustedDesktopRequest } from './requestBoundary.js'

async function withServer(handler, run, options) {
  const server = http.createServer(createRequestBoundary(handler, options))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try { await run(`http://127.0.0.1:${server.address().port}`) }
  finally { await new Promise(resolve => server.close(resolve)) }
}

function forwardedPost(url, headers) {
  // Use the native request API to model a proxy's exact Host header. Fetch
  // pools connections by URL and can retain its original authority header.
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method: 'POST', headers }, response => {
      response.resume()
      response.on('end', () => resolve(response.statusCode))
    })
    request.on('error', reject)
    request.end('{}')
  })
}

test('malformed static and route encodings return 400 while the HTTP server remains healthy', async () => {
  await withServer(async (req, res) => {
    if (req.url.startsWith('/api/track/')) decodeURIComponent(req.url.slice('/api/track/'.length))
    res.end('healthy')
  }, async base => {
    assert.equal((await fetch(`${base}/%E0%A4%A`)).status, 400)
    assert.equal((await fetch(`${base}/api/track/%E0%A4%A`)).status, 400)
    const health = await fetch(`${base}/api/health`)
    assert.equal(health.status, 200)
    assert.equal(await health.text(), 'healthy')
  })
})

test('rejected async routes return a generic 500 and do not terminate later requests', async () => {
  await withServer(async (req, res) => {
    if (req.url === '/api/fail') { await Promise.resolve(); throw new Error('private backend detail') }
    res.end('healthy')
  }, async base => {
    const failure = await fetch(`${base}/api/fail`)
    assert.equal(failure.status, 500)
    assert.doesNotMatch(await failure.text(), /private backend detail/)
    assert.equal((await fetch(`${base}/api/health`)).status, 200)
  })
})

test('untrusted settings writes and originless cross-site GET scans never reach their handlers', async () => {
  let mutations = 0
  await withServer((_req, res) => { mutations += 1; res.end('changed') }, async base => {
    const deniedWrite = await fetch(`${base}/api/yun-settings`, {
      method: 'POST', headers: { Origin: 'https://untrusted.invalid', 'Content-Type': 'text/plain' }, body: '{}',
    })
    assert.equal(deniedWrite.status, 403)
    const deniedScan = await fetch(`${base}/api/music/scan`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })
    assert.equal(deniedScan.status, 403)
    const deniedReferer = await fetch(`${base}/api/music/scan`, { headers: { Referer: 'https://untrusted.invalid/page' } })
    assert.equal(deniedReferer.status, 403)
    const opaque = await fetch(`${base}/api/yun-settings`, { method: 'POST', headers: { Origin: 'null', 'Content-Type': 'application/json' }, body: '{}' })
    assert.equal(opaque.status, 403)
    assert.equal(mutations, 0)
  })
})

test('same-origin JSON, Vite forwarded Host and native clients remain compatible', async () => {
  await withServer((_req, res) => res.end('ok'), async base => {
    assert.equal((await fetch(`${base}/api/settings`, {
      method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{}',
    })).status, 200)
    assert.equal(await forwardedPost(`${base}/api/settings`, {
      Host: 'localhost:5173', Origin: 'http://localhost:5173', 'Content-Type': 'application/json',
    }), 200)
    assert.equal((await fetch(`${base}/api/settings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })).status, 200)
    assert.equal((await fetch(`${base}/api/settings`, {
      method: 'POST', headers: { Origin: base, 'Content-Type': 'text/plain' }, body: '{}',
    })).status, 415)
  })
})

test('public HTTPS origin must be declared and forwarded headers cannot grant trust', async () => {
  const origin = 'https://music.example.test'
  await withServer((_req, res) => res.end('ok'), async base => {
    const accepted = await fetch(`${base}/api/settings`, {
      method: 'POST', headers: { Host: 'music.example.test', Origin: origin, 'Content-Type': 'application/json' }, body: '{}',
    })
    assert.equal(accepted.status, 200)
    const forged = await fetch(`${base}/api/settings`, {
      method: 'POST', headers: { Origin: 'https://untrusted.invalid', 'X-Forwarded-Host': 'untrusted.invalid', 'Content-Type': 'application/json' }, body: '{}',
    })
    assert.equal(forged.status, 403)
  }, { trustedOrigins: [origin] })
  await withServer((_req, res) => res.end('ok'), async base => {
    assert.equal((await fetch(`${base}/api/health`, { headers: { Host: 'rebound.example.test', Origin: 'http://rebound.example.test' } })).status, 403)
  })
})

test('desktop WebSocket handshake denies browser origins and admits the native loopback backend', async () => {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0,
    verifyClient: ({ req }, done) => done(isTrustedDesktopRequest(req), 403, 'Forbidden'),
  })
  await new Promise(resolve => wss.once('listening', resolve))
  wss.on('connection', socket => socket.send('native-ready'))
  const url = `ws://127.0.0.1:${wss.address().port}`
  try {
    for (const origin of ['https://untrusted.invalid', 'http://127.0.0.1:5173', 'null']) {
      await new Promise((resolve, reject) => {
        const socket = new WebSocket(url, { origin })
        socket.on('open', () => { socket.terminate(); reject(new Error('browser handshake must be denied')) })
        socket.on('error', error => { assert.match(error.message, /403/); resolve() })
      })
    }
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(url)
      socket.on('error', reject)
      socket.on('message', message => { assert.equal(message.toString(), 'native-ready'); socket.close() })
      socket.on('close', resolve)
    })
    assert.equal(isTrustedDesktopRequest({ headers: { host: '127.0.0.1:3131' }, socket: { remoteAddress: '192.0.2.1' } }), false)
    assert.equal(isTrustedDesktopRequest({ headers: { host: 'rebound.example.test:3131' }, socket: { remoteAddress: '127.0.0.1' } }), false)
  } finally { await new Promise(resolve => wss.close(resolve)) }
})
