// 云语音识别(ASR)设置面板 —— 阿里云百炼 Key 管理与识别测试。
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import LiquidGlass from 'liquid-glass-react'
import { clearAsrConfig, getAsrStatus, saveAsrConfig, transcribeAudio } from '../api/asrApi'
import './AsrSettingsPanel.css'

const TEST_RECORD_MS = 3000

export default function AsrSettingsPanel({ onConfiguredChange, className = '' }) {
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [status, setStatus] = useState('loading') // loading | ready | saving | error
  const [configured, setConfigured] = useState(false)
  const [message, setMessage] = useState('')
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const recordChunksRef = useRef([])
  const recordStreamRef = useRef(null)
  const recordContextRef = useRef(null)
  const recordProcessorRef = useRef(null)
  const recordTimerRef = useRef(0)
  const testRunRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    getAsrStatus()
      .then((body) => {
        if (cancelled) return
        setConfigured(Boolean(body.configured))
        setBaseUrl(body.baseUrl || '')
        setModel(body.model || '')
        setStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        setStatus('ready')
        setConfigured(false)
      })
    return () => {
      cancelled = true
      window.clearTimeout(recordTimerRef.current)
    }
  }, [])

  const stopRecording = useCallback(() => {
    window.clearTimeout(recordTimerRef.current)
    recordProcessorRef.current?.disconnect?.()
    recordStreamRef.current?.getTracks().forEach((track) => track.stop())
    if (recordContextRef.current?.state !== 'closed') recordContextRef.current?.close?.()
    recordProcessorRef.current = null
    recordStreamRef.current = null
    recordContextRef.current = null
  }, [])

  const encodeWavBlob = useCallback((chunks, sampleRate) => {
    const length = chunks.reduce((total, chunk) => total + chunk.length, 0)
    const buffer = new ArrayBuffer(44 + length * 2)
    const view = new DataView(buffer)
    const writeText = (offset, text) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)))
    writeText(0, 'RIFF')
    view.setUint32(4, 36 + length * 2, true)
    writeText(8, 'WAVE')
    writeText(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    writeText(36, 'data')
    view.setUint32(40, length * 2, true)
    let offset = 44
    chunks.forEach((chunk) => {
      for (let index = 0; index < chunk.length; index += 1) {
        const sample = Math.max(-1, Math.min(1, chunk[index]))
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
        offset += 2
      }
    })
    return new Blob([buffer], { type: 'audio/wav' })
  }, [])

  const handleSave = useCallback(async () => {
    if (!apiKey.trim()) {
      setMessage('请先填写阿里云百炼 API Key')
      return
    }
    setStatus('saving')
    setMessage('')
    try {
      const body = await saveAsrConfig({
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim(),
        model: model.trim(),
      })
      setConfigured(Boolean(body.configured))
      setApiKey('')
      setMessage(body.configured ? '已保存,云语音识别已启用' : '保存成功')
      onConfiguredChange?.(Boolean(body.configured))
    } catch (error) {
      setMessage(error.message || '保存失败')
    } finally {
      setStatus('ready')
    }
  }, [apiKey, baseUrl, model, onConfiguredChange])

  const handleClear = useCallback(async () => {
    try {
      const body = await clearAsrConfig()
      setConfigured(false)
      setApiKey('')
      setMessage('已清除配置')
      onConfiguredChange?.(false)
      void body
    } catch (error) {
      setMessage(error.message || '清除失败')
    }
  }, [onConfiguredChange])

  const handleTest = useCallback(async () => {
    if (isTesting || isRecording) return
    const runId = ++testRunRef.current
    setIsTesting(true)
    setTestResult('正在打开麦克风…')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      if (runId !== testRunRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      const AudioContext = window.AudioContext || window.webkitAudioContext
      const context = new AudioContext()
      const source = context.createMediaStreamSource(stream)
      const processor = context.createScriptProcessor(4096, 1, 1)
      const chunks = []
      recordChunksRef.current = chunks
      processor.onaudioprocess = (event) => {
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
      }
      source.connect(processor)
      processor.connect(context.destination)
      recordStreamRef.current = stream
      recordContextRef.current = context
      recordProcessorRef.current = processor
      setIsRecording(true)
      setTestResult(`录音中,请说「小昀」…(${TEST_RECORD_MS / 1000}秒)`)

      const blob = await new Promise((resolve) => {
        recordTimerRef.current = window.setTimeout(() => {
          const wav = encodeWavBlob(chunks, context.sampleRate)
          stopRecording()
          setIsRecording(false)
          resolve(wav)
        }, TEST_RECORD_MS)
      })

      if (runId !== testRunRef.current) return
      setTestResult('正在识别…')
      const result = await transcribeAudio(blob)
      if (runId !== testRunRef.current) return
      setTestResult(`识别结果:「${result.text}」`)
    } catch (error) {
      if (runId !== testRunRef.current) return
      setTestResult(error.message || '测试失败')
    } finally {
      if (runId === testRunRef.current) {
        setIsTesting(false)
        setIsRecording(false)
      }
    }
  }, [encodeWavBlob, isRecording, isTesting, stopRecording])

  return createPortal(
    <LiquidGlass
      displacementScale={40}
      blurAmount={0.01}
      saturation={160}
      aberrationIntensity={3}
      elasticity={0.35}
      cornerRadius={28}
      padding="20px"
      className={`asr-settings-glass${className ? ` ${className}` : ''}`}
    >
      <div className="asr-settings">
        <div className="asr-settings-header">
          <p className="sub">CLOUD VOICE</p>
          <h2>云语音识别设置</h2>
        </div>
        <div className={`asr-status-row${configured ? ' is-on' : ''}`}>
          <span className="asr-status-dot" aria-hidden="true" />
          <span>{status === 'loading' ? '检查中…' : configured ? '已启用(阿里云百炼)' : '未配置'}</span>
        </div>
        <label className="asr-field">
          <span>API Key</span>
          <input
            type="password"
            value={apiKey}
            spellCheck="false"
            autoComplete="off"
            placeholder={configured ? '已配置,留空保持不变' : 'sk-…(阿里云百炼 API Key)'}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        <label className="asr-field">
          <span>Base URL(可选)</span>
          <input
            type="text"
            value={baseUrl}
            spellCheck="false"
            placeholder="https://…/compatible-mode/v1"
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </label>
        <label className="asr-field">
          <span>模型(可选)</span>
          <input
            type="text"
            value={model}
            spellCheck="false"
            placeholder="qwen3-asr-flash"
            onChange={(event) => setModel(event.target.value)}
          />
        </label>
        <div className="asr-actions">
          <button type="button" className="asr-btn asr-btn--primary" onClick={handleSave} disabled={status === 'saving'}>
            {status === 'saving' ? '保存中…' : '保存 Key'}
          </button>
          {configured && (
            <button type="button" className="asr-btn" onClick={handleTest} disabled={isTesting || isRecording}>
              {isTesting ? (isRecording ? '录音中…' : '识别中…') : '测试识别'}
            </button>
          )}
          {configured && (
            <button type="button" className="asr-btn asr-btn--danger" onClick={handleClear}>
              清除
            </button>
          )}
        </div>
        {message && <p className="asr-message">{message}</p>}
        {testResult && <p className="asr-test-result">{testResult}</p>}
      </div>
    </LiquidGlass>,
    document.body
  )
}
