import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createWavBlob,
  enrollVoiceprint,
  getVoiceprintProfile,
  removeVoiceprint,
} from '../services/voiceprintApi'

const SAMPLE_COUNT = 3
const RECORD_SECONDS = 3.2
const prompts = ['小昀，早上好', '小昀，帮我换一首歌', '小昀，我在这里']

function captureWav(durationMs) {
  return new Promise((resolve, reject) => {
    let stream
    let context
    let processor
    let source
    const chunks = []
    const start = async () => {
      try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      const AudioContext = window.AudioContext || window.webkitAudioContext
      context = new AudioContext()
      source = context.createMediaStreamSource(stream)
      processor = context.createScriptProcessor(4096, 1, 1)
      processor.onaudioprocess = (event) => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
      source.connect(processor)
      processor.connect(context.destination)
      window.setTimeout(async () => {
        try {
          processor.disconnect()
          source.disconnect()
          stream.getTracks().forEach((track) => track.stop())
          await context.close()
          resolve(createWavBlob(chunks, context.sampleRate))
        } catch (error) {
          reject(error)
        }
      }, durationMs)
      } catch (error) {
        stream?.getTracks().forEach((track) => track.stop())
        context?.close?.()
        reject(error)
      }
    }
    start()
  })
}

export default function VoiceprintEnrollment({ onProfileChange }) {
  const [profile, setProfile] = useState(null)
  const [status, setStatus] = useState('checking')
  const [step, setStep] = useState(0)
  const samplesRef = useRef([])

  const loadProfile = useCallback(async () => {
    try {
      const next = await getVoiceprintProfile()
      setProfile(next)
      setStatus(next.enrolled ? 'ready' : 'idle')
      onProfileChange?.(next)
    } catch {
      setStatus('offline')
      setProfile(null)
    }
  }, [onProfileChange])

  useEffect(() => {
    const timer = window.setTimeout(loadProfile, 0)
    return () => window.clearTimeout(timer)
  }, [loadProfile])

  const recordNext = useCallback(async () => {
    if (status === 'recording' || status === 'saving') return
    setStatus('recording')
    try {
      const sample = await captureWav(RECORD_SECONDS * 1000)
      const samples = [...samplesRef.current, sample]
      samplesRef.current = samples
      setStep(samples.length)
      if (samples.length < SAMPLE_COUNT) {
        setStatus('idle')
        return
      }
      setStatus('saving')
      const next = await enrollVoiceprint(samples)
      setProfile(next)
      setStatus('ready')
      samplesRef.current = []
      onProfileChange?.(next)
    } catch {
      setStatus('error')
    }
  }, [onProfileChange, status])

  const restart = useCallback(() => {
    samplesRef.current = []
    setStep(0)
    setStatus('idle')
  }, [])

  const clear = useCallback(async () => {
    if (status === 'saving') return
    try {
      await removeVoiceprint()
      samplesRef.current = []
      setStep(0)
      setProfile({ enrolled: false })
      setStatus('idle')
      onProfileChange?.({ enrolled: false })
    } catch {
      setStatus('error')
    }
  }, [onProfileChange, status])

  const isBusy = status === 'recording' || status === 'saving' || status === 'checking'
  const prompt = prompts[Math.min(step, prompts.length - 1)]
  const detail = status === 'offline'
    ? '本地声纹服务未启动'
    : status === 'recording'
      ? `正在录制第 ${step + 1} 段，请说：${prompt}`
      : status === 'saving'
        ? '正在本机生成声纹…'
        : status === 'ready'
          ? `已录入 ${profile?.sampleCount || 3} 段，仅保存在此电脑`
          : status === 'error'
            ? '录入失败，请检查麦克风并重试'
            : `录入 ${SAMPLE_COUNT} 段，每段约 ${RECORD_SECONDS} 秒：${prompt}`

  return (
    <div className={`voiceprint-enrollment is-${status}`}>
      <div>
        <span className="voice-row-label">本地声纹确认</span>
        <p className="voiceprint-enrollment__detail">{detail}</p>
      </div>
      <div className="voiceprint-enrollment__actions">
        {status !== 'ready' && (
          <button className="voiceprint-button" type="button" onClick={recordNext} disabled={isBusy || status === 'offline'}>
            {status === 'recording' ? '录音中' : step ? `录第 ${step + 1} 段` : '开始录入'}
          </button>
        )}
        {(step > 0 || status === 'error') && status !== 'saving' && (
          <button className="voiceprint-button is-quiet" type="button" onClick={restart}>重录</button>
        )}
        {status === 'ready' && (
          <>
            <button className="voiceprint-button" type="button" onClick={restart}>重新录入</button>
            <button className="voiceprint-button is-quiet" type="button" onClick={clear}>删除</button>
          </>
        )}
        {status === 'offline' && <button className="voiceprint-button is-quiet" type="button" onClick={loadProfile}>重试</button>}
      </div>
    </div>
  )
}
