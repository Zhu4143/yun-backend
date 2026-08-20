import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createResponse, parseModelResponse } from './mossResponseParser.js'

const MODEL_REQUEST_TIMEOUT_MS = 30000
const MODEL_MAX_ATTEMPTS = 3
const MODEL_MAX_TOKENS = 700

function retryableError(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.retryable = true
  return error
}

function waitBeforeRetry(attempt) {
  return new Promise((resolve) => setTimeout(resolve, 250 * attempt))
}

function getConfig(env) {
  const provider = env.AI_PROVIDER || (env.DEEPSEEK_API_KEY ? 'deepseek' : '')
  const apiKey = env.AI_API_KEY || env.DEEPSEEK_API_KEY || ''
  const baseUrl = String(env.AI_BASE_URL || env.DEEPSEEK_BASE_URL || (provider === 'deepseek' ? 'https://api.deepseek.com' : 'https://api.openai.com/v1')).replace(/\/+$/, '')
  const model = env.AI_MODEL || env.DEEPSEEK_MODEL || (provider === 'deepseek' ? 'deepseek-chat' : '')
  return { provider, apiKey, baseUrl, model, temperature: Number(env.AI_TEMPERATURE || 0.3) }
}

function readPersistedConfig(configPath) {
  if (!configPath) return {}
  try {
    const saved = JSON.parse(readFileSync(configPath, 'utf8'))
    return {
      provider: String(saved.provider || '').trim(),
      apiKey: String(saved.apiKey || '').trim(),
      baseUrl: String(saved.baseUrl || '').trim().replace(/\/+$/, ''),
      model: String(saved.model || '').trim(),
      temperature: Number(saved.temperature),
    }
  } catch { return {} }
}

function describeFetchError(error) {
  const code = error?.cause?.code || error?.code
  if (code === 'ENOTFOUND') return 'cannot resolve the model service domain; check network or DNS'
  if (code === 'ECONNREFUSED') return 'the model service refused the connection; check Base URL or proxy'
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return 'model connection timed out; check network, proxy, or firewall'
  if (code === 'ECONNRESET') return 'model connection was reset; check proxy or TLS settings'
  return `cannot reach the model service${code ? ` (${code})` : ''}; check network, Base URL, or proxy`
}

export function createModelProvider({
  env = process.env,
  fetchImpl = fetch,
  configPath = null,
  requestTimeoutMs = MODEL_REQUEST_TIMEOUT_MS,
  maxAttempts = MODEL_MAX_ATTEMPTS,
  maxTokens = MODEL_MAX_TOKENS,
} = {}) {
  let config = { ...getConfig(env), ...readPersistedConfig(configPath) }

  function candidateFrom(next = {}) {
    return {
      provider: String(next.provider || config.provider || '').trim(),
      apiKey: String(next.apiKey || '').trim(),
      baseUrl: String(next.baseUrl || config.baseUrl || '').trim().replace(/\/+$/, ''),
      model: String(next.model || config.model || '').trim(),
      temperature: Number.isFinite(Number(next.temperature)) ? Number(next.temperature) : config.temperature,
    }
  }

  function validate(candidate) {
    if (!candidate.apiKey || !candidate.baseUrl || !candidate.model) throw new Error('model configuration needs API Key, Base URL, and model name')
  }

  function persist() {
    if (!configPath) return
    mkdirSync(path.dirname(configPath), { recursive: true })
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
  }

  async function request(payload, timeoutMs = requestTimeoutMs) {
    const endpoint = config.baseUrl.endsWith('/chat/completions') ? config.baseUrl : `${config.baseUrl}/chat/completions`
    let response
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || requestTimeoutMs))
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
    } catch (error) {
      if (error?.name === 'AbortError') throw retryableError('model request timed out')
      throw retryableError(`model connection error: ${describeFetchError(error)}`, error)
    } finally {
      clearTimeout(timeout)
    }

    const raw = await response.text()
    let data
    try {
      data = JSON.parse(raw)
    } catch (error) {
      throw retryableError(raw.trim() ? 'model service returned invalid JSON' : 'model service returned an empty response', error)
    }
    if (!response.ok) {
      const message = data?.error?.message || `model request failed: HTTP ${response.status}`
      if (response.status === 408 || response.status === 429 || response.status >= 500) throw retryableError(message)
      throw new Error(message)
    }
    return data
  }

  return {
    getStatus() { return { status: config.apiKey && config.model ? 'MODEL_ONLINE' : 'MODEL_OFFLINE', provider: config.provider || 'unconfigured', model: config.model || null } },
    configure(next = {}) {
      const candidate = candidateFrom(next)
      validate(candidate)
      config = candidate
      persist()
      return this.getStatus()
    },
    async connect(next = {}) {
      const previous = config
      const candidate = candidateFrom(next)
      validate(candidate)
      config = candidate
      try {
        await request({ model: config.model, messages: [{ role: 'user', content: 'connection check' }], max_tokens: 1 })
        persist()
        return this.getStatus()
      } catch (error) {
        config = previous
        throw error
      }
    },
    async sendMessage({ systemPrompt, messages, tools = [], runtimeState, timeoutMs }) {
      if (!config.apiKey || !config.model) throw new Error('model is offline: configure API Key, Base URL, and model name')
      const payload = {
        model: config.model,
        temperature: Math.max(0.2, Math.min(0.5, config.temperature)),
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        tools: tools.length ? tools : undefined,
        max_tokens: Math.max(64, Math.min(1200, Number(maxTokens) || MODEL_MAX_TOKENS)),
        stream: false,
        metadata: { mossRuntime: runtimeState?.agentStatus || 'READY' },
      }

      let lastError
      const attempts = Math.max(1, Math.min(3, Number(maxAttempts) || MODEL_MAX_ATTEMPTS))
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          const data = await request(payload, timeoutMs)
          const choice = data?.choices?.[0]?.message
          if (choice?.tool_calls?.length) return { toolCalls: choice.tool_calls, response: null }

          const content = String(choice?.content || '').trim()
          if (!content) throw retryableError('model returned no answer content')
          try {
            return { toolCalls: [], response: parseModelResponse(content) }
          } catch (error) {
            const plainText = content.replace(/^```(?:text|markdown)?\s*|```$/g, '').trim()
            if (plainText && !/^[{[]/.test(plainText)) {
              return { toolCalls: [], response: createResponse({ message: plainText }) }
            }
            throw retryableError('model returned incomplete structured output', error)
          }
        } catch (error) {
          lastError = error
          if (!error?.retryable || attempt === attempts) break
          await waitBeforeRetry(attempt)
        }
      }
      throw new Error(`model response failed after ${attempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
    },
  }
}
