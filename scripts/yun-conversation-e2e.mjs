import process from 'node:process'
import { routeChatIntent } from '../src/services/chatIntentRouter.js'
import { planNeteaseCapability } from '../src/services/netease/capabilityPlanner.js'
import { getCapability } from '../src/services/netease/capabilityRegistry.js'
import { formatYunChatErrorReply } from '../src/services/yunChatReply.js'

const realAccount = process.argv.includes('--real')
if (realAccount && process.env.YUN_E2E_NETEASE !== '1') {
  console.error('Real-account smoke is disabled. Set YUN_E2E_NETEASE=1 explicitly.')
  process.exit(2)
}

const currentTrack = {
  id: 'netease-186016',
  providerId: '186016',
  source: 'netease',
  title: '晴天',
  artist: '周杰伦',
  fileUrl: '/api/netease/audio?id=186016',
}

const songs = {
  rainLove: { id: '101', title: '雨爱', artist: '杨丞琳', album: '雨爱' },
  qingtian: { id: '186016', title: '晴天', artist: '周杰伦', album: '叶惠美' },
  daily: { id: '201', title: '每日一歌', artist: '推荐歌手' },
  fm: { id: '301', title: '私人 FM 一', artist: 'FM 歌手' },
  similar: { id: '401', title: '相似候选一', artist: '相似歌手' },
  recent: { id: '501', title: '最近听过', artist: '历史歌手' },
  podcast: { id: '601', title: '播客节目一', artist: '主播' },
  cloud: { id: '701', title: '云盘歌曲一', artist: '云盘歌手' },
  lyric: { id: '801', title: '夜空中最亮的星', artist: '逃跑计划' },
}

const cases = [
  { input: '播放雨爱', capability: 'netease.search.song', action: 'search', playerCommand: 'playTrackFromQueue' },
  { input: '播放与爱', inputMode: 'voice', capability: 'netease.search.song', action: 'search', playerCommand: 'playTrackFromQueue', allowRealClarification: true },
  { input: '播放周杰伦的晴天', capability: 'netease.search.song', action: 'search', playerCommand: 'playTrackFromQueue' },
  { input: '暂停', capability: 'yun.player.transport', action: 'pause', playerCommand: 'pause' },
  { input: '继续', capability: 'yun.player.transport', action: 'resume', playerCommand: 'playTrack' },
  { input: '下一首', capability: 'yun.player.transport', action: 'next', playerCommand: 'next' },
  { input: '上一首', capability: 'yun.player.transport', action: 'previous', playerCommand: 'previous' },
  { input: '打开每日推荐', capability: 'netease.recommend.daily', action: 'list' },
  { input: '今天网易云推荐什么', capability: 'netease.recommend.daily', action: 'list' },
  { input: '放私人FM', capability: 'netease.recommend.personal_fm', action: 'play', playerCommand: 'playTrackFromQueue' },
  { input: '私人FM连续播放', capability: 'netease.recommend.personal_fm', action: 'play', playerCommand: 'playTrackFromQueue' },
  { input: '来点和这首相似的', capability: 'netease.recommend.similar', action: 'play', playerCommand: 'playTrackFromQueue' },
  { input: '随便放点网易云推荐的', capability: 'netease.recommend.daily', action: 'play', playerCommand: 'playTrackFromQueue' },
  { input: '最近歌曲', capability: 'netease.library.recent', action: 'list' },
  { input: '看看我最近听了什么', capability: 'netease.library.recent', action: 'list' },
  { input: '看看我最近常听什么', capability: 'netease.library.user_record', action: 'list', type: 'week' },
  { input: '我最近最常听哪几首', capability: 'netease.library.user_record', action: 'list', type: 'week' },
  { input: '我历史上听最多的歌', capability: 'netease.library.user_record', action: 'list', type: 'all', replyPattern: /历史上/ },
  { input: '看看我的播客', capability: 'netease.library.podcasts', action: 'list' },
  { input: '播放我的播客', capability: 'netease.library.podcasts', action: 'play', playerCommand: 'playTrack' },
  { input: '看看我的云盘', capability: 'netease.library.cloud', action: 'list' },
  { input: '这首用无损播放', capability: 'yun.player.stream_quality', action: 'resolve', playerCommand: 'playTrack' },
  { input: '这首用hires', capability: 'yun.player.stream_quality', action: 'resolve', playerCommand: 'playTrack' },
  { input: '换回标准品质', capability: 'netease.desktop.default_quality', action: 'set', errorCode: 'unsupported' },
  { input: '把8D环绕关掉', capability: 'netease.audio.effect', action: 'set', errorCode: 'unsupported' },
  { input: '声音有点怪', capability: null, detectedIntent: 'analysis.audio_anomaly', handled: false, noPlayerMutation: true },
  { input: '有首歌歌词是夜空中最亮的星，帮我找', capability: 'netease.search.lyrics', action: 'resolve', playerCommand: 'playTrackFromQueue' },
]

function fixtureResponse(pathname, searchParams, body) {
  if (pathname === '/api/smart-music-command') {
    const message = String(body.message || '')
    const query = message.replace(/^(?:播放|放|想听|来一首|来首)/, '').replace(/[。！？!?]+$/g, '').trim()
    return /^(?:播放|放|想听|来一首|来首)/.test(message)
      ? { should_execute: true, command: { type: 'play_search', query }, target: { source: 'netease', query } }
      : { should_execute: false, command: { type: 'none' }, reply: '' }
  }
  if (pathname === '/api/netease/search') return { ok: true, songs: [songs.rainLove, songs.qingtian] }
  if (pathname === '/api/netease/resolve-voice-song') return { ok: true, providerId: '101' }
  if (pathname === '/api/netease/recommend/daily-songs') return { ok: true, songs: [songs.daily, songs.similar] }
  if (pathname === '/api/netease/recommend/playlists') return { ok: true, playlists: [{ id: 'p1', name: '每日歌单' }] }
  if (pathname === '/api/netease/recommend/personal-fm') return { ok: true, songs: [songs.fm, songs.daily] }
  if (pathname === '/api/netease/recommendations') return { ok: true, songs: [songs.similar, songs.daily] }
  if (pathname === '/api/netease/history/recent') return { ok: true, type: searchParams.get('type') || 'song', songs: [songs.recent], items: [{ song: songs.recent }], total: 1 }
  if (pathname === '/api/netease/history/user-record') return { ok: true, type: searchParams.get('type') || 'week', songs: [songs.recent], records: [{ song: songs.recent, playCount: 9 }], total: 1 }
  if (pathname === '/api/netease/podcasts') return { ok: true, podcasts: [{ id: 'podcast-1', name: '订阅播客' }], programs: [], total: 1 }
  if (pathname === '/api/netease/podcast/programs') return { ok: true, programs: [{ id: 'program-1', name: '播客节目一', song: songs.podcast }], total: 1 }
  if (pathname === '/api/netease/cloud') return { ok: true, items: [{ id: 'cloud-1', song: songs.cloud }], songs: [songs.cloud], total: 1 }
  if (pathname === '/api/netease/song/playability') return { ok: true, playable: true, providerId: searchParams.get('id') }
  if (pathname === '/api/netease/song/stream') return { ok: true, providerId: searchParams.get('id'), requestedLevel: searchParams.get('level'), level: searchParams.get('level'), fileUrl: `/api/netease/audio?id=${searchParams.get('id')}&level=${searchParams.get('level')}` }
  if (pathname === '/api/netease/resolve-lyric-song') return { ok: true, verified: true, song: songs.lyric, candidates: [songs.lyric] }
  if (pathname === '/api/netease/me') return { ok: true, loggedIn: true, user: { nickname: 'fixture' } }
  return null
}

function fixtureFetch(raw, init = {}) {
  const url = new URL(raw, 'http://fixture.local')
  let body = {}
  if (typeof init.body === 'string') {
    try {
      body = JSON.parse(init.body)
    } catch {
      body = {}
    }
  }
  const value = fixtureResponse(url.pathname, url.searchParams, body)
  const status = value ? 200 : 404
  const payload = value || { ok: false, code: 'not_found', error: `fixture_missing:${url.pathname}` }
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function createRecordingPlayer() {
  const commands = []
  let state = { currentTrack, isPlaying: true, queue: [], playbackMode: 'sequence', volume: 0.8 }
  const record = (command, detail = {}) => commands.push({ command, ...detail })
  return {
    commands,
    player: {
      getState: () => state,
      play: async () => { record('play'); state = { ...state, isPlaying: true }; return { ok: true } },
      pause: async () => { record('pause'); state = { ...state, isPlaying: false }; return { ok: true } },
      togglePlay: async () => { record('togglePlay'); state = { ...state, isPlaying: !state.isPlaying }; return { ok: true } },
      next: async () => { record('next'); return { ok: true } },
      previous: async () => { record('previous'); return { ok: true } },
      seek: (seconds) => record('seek', { seconds }),
      playTrack: async (track) => { record('playTrack', { providerId: track?.providerId }); state = { ...state, currentTrack: track, isPlaying: true }; return { ok: true } },
      playTrackFromQueue: async (track, queue) => { record('playTrackFromQueue', { providerId: track?.providerId, queueLength: queue?.length || 0 }); state = { ...state, currentTrack: track, queue, isPlaying: true }; return { ok: true } },
      setPlaybackMode: (mode) => { record('setPlaybackMode', { mode }); state = { ...state, playbackMode: mode } },
      setPlaybackQueue: (queue) => { record('setPlaybackQueue', { queueLength: queue?.length || 0 }); state = { ...state, queue } },
      clearPlaybackQueue: () => { record('clearPlaybackQueue'); state = { ...state, queue: [] } },
      setQueuedNextTrack: (track) => record('setQueuedNextTrack', { providerId: track?.providerId || null }),
      enqueueUpNext: (track) => record('enqueueUpNext', { providerId: track?.providerId }),
      clearUpNext: () => record('clearUpNext'),
      setAutoUpNext: (tracks) => record('setAutoUpNext', { queueLength: tracks?.length || 0 }),
      setVolume: (value) => { record('setVolume', { value }); state = { ...state, volume: value } },
      getPlaybackDiagnostics: () => ({ ok: true, state }),
    },
  }
}

function safeNetworkCode(error) {
  const code = String(error?.cause?.code || error?.code || '').trim()
  return /^[A-Z][A-Z0-9_]+$/.test(code) ? code : 'FETCH_FAILED'
}

function safeBackendSummary(path, payload) {
  const songs = Array.isArray(payload?.songs) ? payload.songs : []
  const items = Array.isArray(payload?.items) ? payload.items : []
  const programs = Array.isArray(payload?.programs) ? payload.programs : []
  const records = Array.isArray(payload?.records) ? payload.records : []
  const values = songs.length ? songs : items.length ? items : programs.length ? programs : records
  const summary = {
    code: payload?.code || null,
    providerCode: payload?.details?.providerCode || null,
    providerMethod: payload?.details?.method || null,
    ...(values.length ? { itemCount: values.length } : {}),
  }
  if (path.startsWith('/api/netease/search')) {
    summary.candidates = songs.slice(0, 5).map((song) => ({
      providerId: String(song?.providerId || song?.id || '').replace(/^netease-/, '').trim(),
      title: String(song?.title || song?.name || '').trim(),
      artist: String(song?.artist || '').trim(),
    }))
  }
  return summary
}

function classifyRouteError(error) {
  const code = String(error?.code || error?.cause?.code || '').trim()
  if (/^(?:EACCES|ECONN|ENET|EHOST|ETIMEDOUT|FETCH_FAILED)/.test(code) || /fetch failed|network/i.test(String(error?.message || ''))) {
    return 'network_error'
  }
  return code || 'provider_error'
}

async function runConversationTurn(request) {
  const trace = {}
  const { player, commands } = createRecordingPlayer()
  activeBackendRequests = []
  let result
  try {
    result = await routeChatIntent({
      message: request.input,
      inputMode: request.inputMode || 'text',
      currentSong: currentTrack,
      player,
      libraryTracks: [],
      chatHistory: [],
      debugTrace: trace,
    })
  } catch (error) {
    const plan = planNeteaseCapability({ message: request.input, inputMode: request.inputMode, currentTrack })
    const definition = getCapability(plan?.capability)
    Object.assign(trace, {
      input: request.input,
      inputMode: request.inputMode === 'voice' ? 'voice' : 'text',
      detectedIntent: plan?.detectedIntent || null,
      plannedCapability: plan?.capability || null,
      transport: definition?.transport || null,
      adapterAction: plan?.action || null,
      planArgs: plan?.args || null,
      executorResult: { ok: false, errorCode: classifyRouteError(error) },
      finalReply: formatYunChatErrorReply(error),
    })
    result = { handled: true, reply: trace.finalReply, routeError: true }
  }
  return { result, trace, playerCommands: commands, backendRequests: activeBackendRequests }
}

let stopBackend = async () => {}
let backendBaseUrl
const nativeFetch = globalThis.fetch
let activeBackendRequests = []
const failures = []
let caseFailureCount = 0
let casePassCount = 0
let casesExecuted = 0
const forbiddenAvailableReply = /(?:没有|不具备).{0,8}(?:功能|能力)|暂时不支持|无法读取历史|没有读取历史|我只能推荐/
const forbiddenUnexecutedReply = /我已经准备好执行这些操作|计划已生成，等待播放器执行结果/
const successClaim = /^(?:开始播放)|(?:已经播放|已经按|已通过|先接上|给你放|给你换|操作已完成)/

try {
  if (realAccount) {
    const backend = await import('../server.js')
    const address = await backend.startServer(0)
    backendBaseUrl = `http://127.0.0.1:${address.port}`
    stopBackend = backend.stopServer
    const nodeMajor = Number(process.versions.node.split('.')[0])
    if (nodeMajor !== 22) console.warn(`REAL ACCOUNT ENVIRONMENT: Node ${process.versions.node}; CI baseline is Node 22.`)
  } else backendBaseUrl = 'http://fixture.local'

  globalThis.fetch = async (input, init) => {
    const raw = typeof input === 'string' ? input : input.url
    const target = raw.startsWith('/') ? `${backendBaseUrl}${raw}` : raw
    const usesFixture = !realAccount && raw.startsWith('/')
    const isBackendRequest = usesFixture || target.startsWith(backendBaseUrl)
    const path = isBackendRequest ? target.slice(backendBaseUrl.length) : ''
    try {
      const response = usesFixture ? fixtureFetch(raw, init) : await nativeFetch(target, init)
      if (isBackendRequest) {
        const payload = await response.clone().json().catch(() => null)
        activeBackendRequests.push({
          method: init?.method || 'GET',
          path,
          status: response.status,
          ...safeBackendSummary(path, payload),
        })
      }
      return response
    } catch (error) {
      if (isBackendRequest) {
        activeBackendRequests.push({
          method: init?.method || 'GET',
          path,
          status: null,
          code: 'network_error',
          networkCode: safeNetworkCode(error),
        })
      }
      throw error
    }
  }

  if (realAccount) {
    activeBackendRequests = []
    try {
      const response = await nativeFetch(`${backendBaseUrl}/api/netease/me`)
      const account = await response.json().catch(() => ({}))
      console.log(`REAL ACCOUNT: ${JSON.stringify({ httpStatus: response.status, loggedIn: account.loggedIn === true, errorCode: account.code || null })}`)
    } catch (error) {
      console.log(`REAL ACCOUNT: ${JSON.stringify({ httpStatus: null, loggedIn: false, errorCode: 'network_error', networkCode: safeNetworkCode(error) })}`)
      failures.push({ input: '(account preflight)', reasons: [`account preflight failed (${safeNetworkCode(error)})`] })
    }
  }

  for (const item of cases) {
    try {
      casesExecuted += 1
      const turn = await runConversationTurn(item)
      const { trace, result, playerCommands, backendRequests } = turn
      const reasons = []
      if (trace.detectedIntent !== (item.detectedIntent || trace.detectedIntent)) reasons.push(`intent=${trace.detectedIntent}`)
      if (trace.plannedCapability !== item.capability) reasons.push(`capability=${trace.plannedCapability}`)
      if (item.action && trace.adapterAction !== item.action) reasons.push(`action=${trace.adapterAction}`)
      if (item.type && result?.capabilityPlan?.args?.type !== item.type) reasons.push(`type=${result?.capabilityPlan?.args?.type}`)
      if (item.handled !== undefined && Boolean(result?.handled) !== item.handled) reasons.push(`handled=${Boolean(result?.handled)}`)
      const definition = getCapability(item.capability)
      const executionError = trace.executorResult?.errorCode
      const classifiedRuntimeError = ['network_error', 'not_logged_in', 'unauthorized', 'vip_required', 'provider_error', 'empty_result'].includes(executionError)
      const acceptedClarification = realAccount
        && item.allowRealClarification
        && !classifiedRuntimeError
        && playerCommands.length === 0
        && /你想听的是/.test(trace.finalReply)
      if (item.playerCommand && !playerCommands.some((entry) => entry.command === item.playerCommand) && !classifiedRuntimeError && !acceptedClarification) reasons.push(`missing PlayerCore command ${item.playerCommand}`)
      if (item.noPlayerMutation && playerCommands.length) reasons.push('unexpected PlayerCore mutation')
      if (item.replyPattern && !classifiedRuntimeError && !item.replyPattern.test(trace.finalReply)) reasons.push(`reply did not match ${item.replyPattern}`)
      if (item.errorCode && trace.executorResult?.errorCode !== item.errorCode) reasons.push(`errorCode=${trace.executorResult?.errorCode || 'none'}`)
      if (forbiddenUnexecutedReply.test(trace.finalReply)) reasons.push('planning placeholder leaked to final reply')
      if (trace.executorResult?.ok === false && successClaim.test(trace.finalReply)) reasons.push('failed execution produced a success reply')

      if (definition?.supportStatus === 'available' && !classifiedRuntimeError && forbiddenAvailableReply.test(trace.finalReply)) {
        reasons.push('available capability was described as unavailable')
      }
      if (definition?.supportStatus === 'available' && !item.errorCode && !trace.executorResult?.ok && !playerCommands.length && !acceptedClarification) {
        reasons.push(`execution did not complete${executionError ? ` (${executionError})` : ''}`)
      }
      if (classifiedRuntimeError && !item.errorCode) reasons.push(`real execution error ${executionError}`)
      if (result?.handled && !trace.finalReply) reasons.push('missing final reply')

      const passed = reasons.length === 0
      if (!passed) {
        caseFailureCount += 1
        failures.push({ input: item.input, reasons })
      } else casePassCount += 1
      console.log('\nINPUT:')
      console.log(item.input)
      console.log('PLAN:')
      console.log(JSON.stringify({ detectedIntent: trace.detectedIntent, capability: trace.plannedCapability, action: trace.adapterAction, transport: trace.transport, args: trace.planArgs }))
      console.log('EXECUTION:')
      console.log(JSON.stringify({ executorResult: trace.executorResult, playerCommands, backendRequests }))
      console.log('REPLY:')
      console.log(trace.finalReply || '(router intentionally left this turn for non-action analysis/chat)')
      console.log(passed ? 'PASS' : `FAIL: ${reasons.join('; ')}`)
    } catch (error) {
      const reason = `harness error (${safeNetworkCode(error)})`
      caseFailureCount += 1
      failures.push({ input: item.input, reasons: [reason] })
      console.log('\nINPUT:')
      console.log(item.input)
      console.log('PLAN:')
      console.log('(unavailable: harness failed before trace completion)')
      console.log('EXECUTION:')
      console.log(JSON.stringify({ executorResult: { ok: false, errorCode: 'harness_error', networkCode: safeNetworkCode(error) }, playerCommands: [], backendRequests: activeBackendRequests }))
      console.log('REPLY:')
      console.log('(none)')
      console.log(`FAIL: ${reason}`)
    }
  }
} catch (error) {
  failures.push({ input: '(harness startup)', reasons: [`startup failed (${safeNetworkCode(error)})`] })
} finally {
  globalThis.fetch = nativeFetch
  await stopBackend().catch((error) => {
    failures.push({ input: '(cleanup)', reasons: [`cleanup failed (${safeNetworkCode(error)})`] })
  })
}

console.log(`\nSUMMARY: ${casePassCount}/${cases.length} PASS; ${caseFailureCount} FAIL; ${casesExecuted}/${cases.length} EXECUTED (${realAccount ? 'real-account' : 'deterministic'})`)
if (failures.length) {
  console.error(JSON.stringify(failures, null, 2))
  process.exitCode = 1
}
