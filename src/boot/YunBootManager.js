const TERMINAL_TASK_STATUSES = new Set(['success', 'warning', 'failed'])

function now() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

function clampProgress(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.max(0, Math.min(100, number))
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown boot error')
}

function wait(delayMs) {
  if (!delayMs) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

async function runWithTimeout(run, timeoutMs, controller) {
  if (!timeoutMs) return run()

  let timer = 0
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error(`Timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })

  try {
    return await Promise.race([run(), timeout])
  } finally {
    clearTimeout(timer)
  }
}

function createTaskState(task) {
  return {
    id: task.id,
    label: task.label || task.id,
    status: 'pending',
    progress: 0,
    blocking: task.blocking !== false,
    error: '',
    detail: '',
    startTime: null,
    endTime: null,
    durationMs: null,
    retries: 0,
  }
}

export class YunBootManager {
  constructor({ tasks = [], retryDelayMs = 0 } = {}) {
    const ids = new Set()
    tasks.forEach((task) => {
      if (!task?.id || typeof task.run !== 'function') throw new Error('Each boot task needs an id and run function')
      if (ids.has(task.id)) throw new Error(`Duplicate boot task id: ${task.id}`)
      ids.add(task.id)
    })

    this.definitions = new Map(tasks.map((task) => [task.id, {
      weight: 1,
      dependencies: [],
      retries: 0,
      timeoutMs: 0,
      ...task,
    }]))
    this.retryDelayMs = retryDelayMs
    this.listeners = new Set()
    this.data = {}
    this.startPromise = null
    this.state = {
      status: 'idle',
      progress: 0,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      tasks: tasks.map(createTaskState),
      data: this.data,
    }
    this.publishDiagnostics()
  }

  getState = () => this.state

  subscribe = (listener) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start = () => {
    if (this.startPromise) return this.startPromise
    if (this.state.status === 'ready' || this.state.status === 'degraded') {
      return Promise.resolve(this.state)
    }

    const startedAt = now()
    this.updateState({ status: 'booting', startedAt, completedAt: null, durationMs: null })
    this.startPromise = this.runPipeline().finally(() => {
      this.startPromise = null
    })
    return this.startPromise
  }

  retry = () => {
    if (this.state.status !== 'failed' && this.state.status !== 'degraded') return this.start()

    this.data = {}
    this.state = {
      ...this.state,
      status: 'idle',
      progress: 0,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      data: this.data,
      tasks: [...this.definitions.values()].map(createTaskState),
    }
    this.emit()
    return this.start()
  }

  async runPipeline() {
    while (true) {
      const ready = this.state.tasks.filter((task) => {
        if (task.status !== 'pending') return false
        const definition = this.definitions.get(task.id)
        return definition.dependencies.every((id) => {
          const dependency = this.findTask(id)
          return dependency?.status === 'success' || dependency?.status === 'warning'
        })
      })

      if (!ready.length) break
      await Promise.all(ready.map((task) => this.runTask(task.id)))
    }

    const blockingFailure = this.state.tasks.some((task) => task.blocking && task.status !== 'success')
    const pendingTasks = this.state.tasks.filter((task) => task.status === 'pending')
    if (pendingTasks.length) {
      pendingTasks.forEach((task) => {
        this.updateTask(task.id, {
          status: task.blocking ? 'failed' : 'warning',
          error: 'A required boot dependency did not complete',
          endTime: now(),
        })
      })
    }

    const completedAt = now()
    const failed = blockingFailure || this.state.tasks.some((task) => task.blocking && task.status === 'failed')
    const degraded = !failed && this.state.tasks.some((task) => task.status === 'warning')
    this.updateState({
      status: failed ? 'failed' : degraded ? 'degraded' : 'ready',
      progress: failed ? this.state.progress : 100,
      completedAt,
      durationMs: Math.max(0, completedAt - this.state.startedAt),
    })
    return this.state
  }

  async runTask(id) {
    const definition = this.definitions.get(id)
    const firstStart = now()
    this.updateTask(id, { status: 'running', startTime: firstStart, error: '' })

    let lastError = null
    for (let attempt = 0; attempt <= definition.retries; attempt += 1) {
      if (attempt > 0) {
        this.updateTask(id, {
          retries: attempt,
          detail: `${definition.label || id}响应较慢，正在重试…`,
        })
        await wait(definition.retryDelayMs ?? this.retryDelayMs)
      }

      const controller = new AbortController()
      try {
        const result = await runWithTimeout(() => definition.run({
          signal: controller.signal,
          data: this.data,
          getResult: (taskId) => this.data[taskId],
          reportProgress: (progress, detail = '') => {
            const current = this.findTask(id)
            this.updateTask(id, {
              progress: Math.max(current.progress, clampProgress(progress)),
              detail: detail || current.detail,
            })
          },
        }), definition.timeoutMs, controller)

        this.data[id] = result
        if (typeof definition.assign === 'string') this.data[definition.assign] = result
        if (typeof definition.assign === 'function') definition.assign(this.data, result)
        const endTime = now()
        this.updateTask(id, {
          status: 'success',
          progress: 100,
          detail: '',
          error: '',
          endTime,
          durationMs: Math.max(0, endTime - firstStart),
        })
        return
      } catch (error) {
        lastError = error
      }
    }

    const endTime = now()
    this.updateTask(id, {
      status: definition.blocking === false ? 'warning' : 'failed',
      progress: definition.blocking === false ? 100 : this.findTask(id).progress,
      detail: '',
      error: errorMessage(lastError),
      endTime,
      durationMs: Math.max(0, endTime - firstStart),
    })
  }

  findTask(id) {
    return this.state.tasks.find((task) => task.id === id)
  }

  calculateProgress(tasks) {
    let weightedProgress = 0
    let totalWeight = 0
    tasks.forEach((task) => {
      const weight = Number(this.definitions.get(task.id)?.weight) || 1
      weightedProgress += task.progress * weight
      totalWeight += weight
    })
    return totalWeight ? weightedProgress / totalWeight : 100
  }

  updateTask(id, patch) {
    const tasks = this.state.tasks.map((task) => task.id === id ? { ...task, ...patch } : task)
    const progress = Math.max(this.state.progress, this.calculateProgress(tasks))
    this.state = { ...this.state, tasks, progress, data: this.data }
    this.emit()
  }

  updateState(patch) {
    const previousStatus = this.state.status
    this.state = { ...this.state, ...patch, data: this.data }
    this.emit()
    if (
      typeof document !== 'undefined'
      && import.meta.env?.DEV
      && typeof console !== 'undefined'
      && previousStatus !== this.state.status
      && (this.state.status === 'ready' || this.state.status === 'degraded')
    ) {
      const timings = this.state.tasks.map((task) => `${task.id}=${Math.round(task.durationMs || 0)}ms`).join(' ')
      console.info(`YUN BOOT COMPLETE Total=${Math.round(this.state.durationMs || 0)}ms ${timings}`)
    }
  }

  emit() {
    this.publishDiagnostics()
    this.listeners.forEach((listener) => listener(this.state))
  }

  publishDiagnostics() {
    if (typeof globalThis !== 'undefined') globalThis.__YUN_BOOT_STATE__ = this.state
    if (typeof document !== 'undefined' && import.meta.env?.DEV) {
      document.documentElement.dataset.yunBootDiagnostics = JSON.stringify({
        status: this.state.status,
        progress: this.state.progress,
        durationMs: this.state.durationMs,
        tasks: this.state.tasks.map(({ id, status, durationMs, retries, error }) => ({
          id,
          status,
          durationMs,
          retries,
          error,
        })),
      })
    }
  }
}

export function isBootTerminal(status) {
  return status === 'ready' || status === 'degraded' || status === 'failed'
}

export function isTaskTerminal(status) {
  return TERMINAL_TASK_STATUSES.has(status)
}
