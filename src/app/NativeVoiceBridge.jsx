import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useAsrWakeWord } from '../hooks/useAsrWakeWord.js'
import { isCompanionCallEnd, normalizeCompanionTranscript } from './continuousVoiceCall.js'

// Loaded only after an explicit desktop voice opt-in. Reuse the existing
// native KWS/APM and shared browser fallback; never open a second recorder.
export default function NativeVoiceBridge({ model }) {
  const modelRef = useRef(model)
  const captureRef = useRef(null)
  const listeningRef = useRef(false)
  useLayoutEffect(() => { modelRef.current = model }, [model])
  const publish = useCallback(value => modelRef.current.voiceInput.setNativeStatus(value), [])
  const submit = useCallback(text => {
    if (!listeningRef.current) return
    listeningRef.current = false
    const transcript = normalizeCompanionTranscript(text)
    if (!transcript) { publish('没有听清，请重新唤醒'); return }
    if (isCompanionCallEnd(transcript)) {
      void modelRef.current.voiceInput.setNativeEnabled(false)
      return
    }
    publish('正在处理你的话…')
    void modelRef.current.sendMessage(transcript, { inputMode: 'voice' }).then(
      () => publish('等待「小昀」'), () => publish('对话暂未完成，请重试'),
    )
  }, [publish])
  const onWake = useCallback((source, inlineCommand) => {
    const current = modelRef.current
    current.voiceSession.cancelResponse(undefined, 'new_native_wake')
    current.voiceSession.wakeDetected()
    listeningRef.current = true
    if (inlineCommand) { submit(inlineCommand); return }
    if (source !== 'native' && !captureRef.current?.beginCommandCapture()) {
      listeningRef.current = false
      publish('麦克风正在准备，请稍后再说「小昀」')
      return
    }
    publish('正在听你说…')
  }, [publish, submit])
  const capture = useAsrWakeWord({ initialEnabled: true, onWake,
    speaking: model.voice.isSpeaking || model.voice.isPreparingSpeech })
  useLayoutEffect(() => { captureRef.current = capture }, [capture])
  const { voiceSession } = model
  useEffect(() => voiceSession.registerSessionCancellation(() => { listeningRef.current = false }), [voiceSession])
  useEffect(() => {
    const statuses = { starting: '正在连接桌面语音', listening: '等待「小昀」', 'native-listening': '等待「小昀」',
      denied: '麦克风不可用，请检查设备权限', unconfigured: '需要配置语音识别服务',
      'browser-fallback': '浏览器语音备用通道', 'native-stop-unconfirmed': '原生麦克风尚未释放，请稍后重试' }
    if (!listeningRef.current) publish(statuses[capture.status] || `桌面语音：${capture.status}`)
  }, [capture.status, publish])
  useEffect(() => {
    const final = event => submit(event.detail?.text || '')
    const partial = () => { if (listeningRef.current) publish('正在转写…') }
    const failure = () => { listeningRef.current = false; publish('没有听清，请重新唤醒') }
    const bargeIn = () => {
      const current = modelRef.current
      current.voiceSession.cancelResponse(undefined, 'barge_in')
      current.voiceSession.wakeDetected()
      listeningRef.current = true
      publish('已停止朗读，正在听你说…')
    }
    const events = { 'yun-native-asr-final': final, 'yun-browser-command-final': final,
      'yun-native-asr-transcribing': partial, 'yun-browser-command-transcribing': partial,
      'yun-native-asr-error': failure, 'yun-browser-command-timeout': failure,
      'yun-browser-command-cancelled': failure, 'yun-native-barge-in': bargeIn }
    for (const [name, handler] of Object.entries(events)) window.addEventListener(name, handler)
    return () => {
      listeningRef.current = false
      for (const [name, handler] of Object.entries(events)) window.removeEventListener(name, handler)
    }
  }, [publish, submit])
  return null
}
