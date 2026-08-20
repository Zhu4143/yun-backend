import { useCallback, useEffect, useRef, useState } from 'react'
import { configureMossModel, fetchMossRuntime, sendMossMessage } from '../api/mossApi'

const SESSION_KEY = 'moss-agent-session-id'

function makeSessionId() {
  return globalThis.crypto?.randomUUID?.() || `moss-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function useMossAgent() {
  const [sessionId] = useState(() => {
    const existing = localStorage.getItem(SESSION_KEY)
    if (existing) return existing
    const created = makeSessionId()
    localStorage.setItem(SESSION_KEY, created)
    return created
  })
  const [runtimeState, setRuntimeState] = useState({ status: 'READY' })
  const [modelStatus, setModelStatus] = useState({ status: 'MODEL_OFFLINE' })
  const [desktopAgent, setDesktopAgent] = useState({ status: 'CONNECTING' })
  const [entries, setEntries] = useState([])
  const [pendingConfirmation, setPendingConfirmation] = useState(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [lastCommand, setLastCommand] = useState('')
  const controllerRef = useRef(null)
  const inFlightRef = useRef(false)

  useEffect(() => {
    fetchMossRuntime().then((data) => {
      setRuntimeState(data.runtimeState || { status: 'READY' })
      setModelStatus(data.modelStatus || { status: 'MODEL_OFFLINE' })
      setDesktopAgent(data.desktopAgent || { status: 'DISCONNECTED' })
    }).catch(() => setDesktopAgent({ status: 'ERROR' }))
  }, [])

  const submit = useCallback(async ({ message = '', confirmedActionId, cancelActionId } = {}) => {
    if (isProcessing || inFlightRef.current) return null
    const requestId = makeSessionId()
    const command = message.trim()
    if (!command && !confirmedActionId && !cancelActionId) return null
    setIsProcessing(true)
    inFlightRef.current = true
    setLastCommand(command || lastCommand)
    controllerRef.current = new AbortController()
    setRuntimeState((state) => ({ ...state, status: 'ANALYZING' }))
    try {
      const result = await sendMossMessage({ message: command, sessionId, confirmedActionId, cancelActionId, requestId }, controllerRef.current.signal)
      setRuntimeState(result.runtimeState || { status: result.success ? 'SUCCESS' : 'ERROR' })
      setModelStatus(result.modelStatus || { status: 'MODEL_OFFLINE' })
      setDesktopAgent(result.desktopAgent || { status: 'DISCONNECTED' })
      setPendingConfirmation(result.confirmation || null)
      setEntries((items) => [...items, {
        id: requestId,
        command: command || `CONFIRM ${confirmedActionId}`,
        message: result.message,
        result: result.toolExecution,
        logs: result.logs || [],
        ok: result.success,
      }].slice(-12))
      return result
    } catch (error) {
      if (error.name === 'AbortError') return null
      const messageText = `传输异常：${error.message}`
      setRuntimeState((state) => ({ ...state, status: 'ERROR', lastError: messageText }))
      setEntries((items) => [...items, { id: requestId, command, message: messageText, logs: [], ok: false }].slice(-12))
      return null
    } finally {
      controllerRef.current = null
      inFlightRef.current = false
      setIsProcessing(false)
    }
  }, [isProcessing, lastCommand, sessionId])

  const abort = useCallback(() => controllerRef.current?.abort(), [])
  const retry = useCallback(() => submit({ message: lastCommand }), [lastCommand, submit])
  const cancelConfirmation = useCallback(() => {
    if (!pendingConfirmation?.actionId) return null
    return submit({ cancelActionId: pendingConfirmation.actionId })
  }, [pendingConfirmation, submit])
  const configureModel = useCallback(async (config) => {
    const result = await configureMossModel(config)
    setModelStatus(result.modelStatus)
    return result
  }, [])
  return { runtimeState, modelStatus, desktopAgent, entries, pendingConfirmation, isProcessing, submit, abort, retry, cancelConfirmation, configureModel }
}
