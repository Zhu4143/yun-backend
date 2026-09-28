import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

function abortError(signal) {
  return signal?.reason || Object.assign(new Error('Operation aborted'), { name: 'AbortError' })
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal)
}

async function syncDirectory(directory) {
  let handle
  try {
    handle = await open(directory, 'r')
    await handle.sync()
  } catch {
    // Directory fsync is not supported by every Windows filesystem.
  } finally {
    await handle?.close().catch(() => {})
  }
}

async function atomicReplace(filePath, content) {
  const directory = path.dirname(filePath)
  await mkdir(directory, { recursive: true })
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`
  let handle
  try {
    handle = await open(temporaryPath, 'wx')
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await rename(temporaryPath, filePath)
    await syncDirectory(directory)
  } catch (error) {
    await handle?.close().catch(() => {})
    await unlink(temporaryPath).catch(() => {})
    throw error
  }
}

export class AtomicJsonStore {
  constructor(filePath, { backupPath = `${filePath}.bak`, defaultValue } = {}) {
    this.filePath = path.resolve(filePath)
    this.backupPath = path.resolve(backupPath)
    this.defaultValue = defaultValue
    this.writeQueue = Promise.resolve()
  }

  enqueue(operation) {
    const result = this.writeQueue.then(operation, operation)
    this.writeQueue = result.catch(() => {})
    return result
  }

  async readUnlocked(defaultValue = this.defaultValue, initialize = false) {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8'))
    } catch (primaryError) {
      try {
        const recovered = JSON.parse(await readFile(this.backupPath, 'utf8'))
        await atomicReplace(this.filePath, JSON.stringify(recovered, null, 2))
        return recovered
      } catch {
        if (defaultValue === undefined) throw primaryError
        if (initialize) await this.writeUnlocked(defaultValue)
        return defaultValue
      }
    }
  }

  async writeUnlocked(value) {
    let previous
    try {
      previous = await readFile(this.filePath, 'utf8')
      JSON.parse(previous)
    } catch {
      previous = null
    }
    if (previous != null) await atomicReplace(this.backupPath, previous)
    await atomicReplace(this.filePath, JSON.stringify(value, null, 2))
    return value
  }

  load(defaultValue = this.defaultValue) {
    return this.enqueue(() => this.readUnlocked(defaultValue, true))
  }

  write(value, { signal } = {}) {
    return this.enqueue(async () => {
      throwIfAborted(signal)
      return this.writeUnlocked(value)
    })
  }

  update(mutator, { signal, defaultValue = this.defaultValue } = {}) {
    if (typeof mutator !== 'function') throw new TypeError('JSON store update needs a mutator function')
    return this.enqueue(async () => {
      throwIfAborted(signal)
      const current = await this.readUnlocked(defaultValue, true)
      const result = await mutator(current)
      throwIfAborted(signal)
      return this.writeUnlocked(result === undefined ? current : result)
    })
  }
}
