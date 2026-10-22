import { useEffect, useId, useRef, useState } from 'react'
import { AlbumArt, EmptyState, IconButton } from './components.jsx'
import GlassSurface from './GlassSurface.jsx'
import { AudioLines, Check, Close, ImageIcon, Message, Mic, Pause, Play, Send, Settings, Sparkles } from './icons.js'

const RESPONSE_MODES = [
  { id: 'normal', label: '自然聊天', description: '聊音乐，也聊当下' },
  { id: 'podcast', label: '音乐播客', description: '听歌之间，听一点故事' },
  { id: 'companion', label: '陪伴', description: '根据心情陪你选歌' },
  { id: 'silent', label: '专注', description: '保留文字，安静听歌' },
]
const SUGGESTIONS = ['给我推荐一些放松的音乐', '读一读这首歌的评论', '把这首加入喜欢']

export default function CompanionPanel({ model, onSettings }) {
  const { draft, setDraft } = model.composer
  const [attachment, setAttachment] = useState(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [showLatest, setShowLatest] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [candidateStates, setCandidateStates] = useState({})
  const textareaRef = useRef(null)
  const imageInputRef = useRef(null)
  const messagesRef = useRef(null)
  const nearBottomRef = useRef(true)
  const draftRevisionRef = useRef(0)
  const sendEpochRef = useRef(0)
  const sendBusyRef = useRef(false)
  const composingRef = useRef(false)
  const inputId = useId()
  const statusId = useId()
  const messages = model.chat.messages || []
  const currentSong = model.playerState.currentTrack
  const pending = sending || model.chat.isThinking
  const speaking = model.voice.isSpeaking || model.voice.isPreparingSpeech
  const voiceBusy = model.voiceInput.starting || model.voiceInput.listening || model.voiceInput.transcribing
  const stopVoice = model.voiceInput.stop

  useEffect(() => () => { void stopVoice({ cancel: true }) }, [stopVoice])
  const lastMessage = messages[messages.length - 1]
  const latestAssistant = [...messages].reverse().find((message) => message.role === 'assistant')
  const announcedMessageRef = useRef(latestAssistant?.id)

  useEffect(() => () => {
    // Navigating away preserves the conversation, but its late completion
    // must not restore a discarded draft or allocate an unowned preview URL.
    sendEpochRef.current += 1
    sendBusyRef.current = false
  }, [])

  useEffect(() => {
    if (!latestAssistant?.id || latestAssistant.id === announcedMessageRef.current) return undefined
    const frame = window.requestAnimationFrame(() => {
      announcedMessageRef.current = latestAssistant.id
      setAnnouncement(latestAssistant.content || '')
    })
    return () => window.cancelAnimationFrame(frame)
  }, [latestAssistant?.id, latestAssistant?.content])

  useEffect(() => {
    const url = attachment?.previewUrl
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [attachment?.previewUrl])

  useEffect(() => {
    if (!nearBottomRef.current) return undefined
    const frame = window.requestAnimationFrame(() => {
      const element = messagesRef.current
      if (element) element.scrollTop = element.scrollHeight
    })
    return () => window.cancelAnimationFrame(frame)
  }, [messages.length, lastMessage?.id, lastMessage?.content, pending, attachment?.previewUrl])

  const jumpToLatest = () => {
    nearBottomRef.current = true
    setShowLatest(false)
    const element = messagesRef.current
    if (element) element.scrollTop = element.scrollHeight
  }

  const sendTurn = async ({ text = draft, useComposer = true } = {}) => {
    const content = String(text || '').trim()
    const image = useComposer ? attachment?.file : null
    if ((!content && !image) || sendBusyRef.current || model.chat.isThinking) return
    const epoch = ++sendEpochRef.current
    const revision = draftRevisionRef.current
    const previousDraft = draft
    const previousFile = image
    sendBusyRef.current = true
    setSending(true)
    setSendError('')
    nearBottomRef.current = true
    setShowLatest(false)
    // Clear only the submitted snapshot. A draft typed during the request is
    // never cleared by its eventual success, failure or cancellation.
    if (useComposer) {
      setDraft('')
      setAttachment(null)
      if (imageInputRef.current) imageInputRef.current.value = ''
    }
    textareaRef.current?.focus({ preventScroll: true })
    try {
      const result = await model.sendMessage(content, image ? { imageFile: image } : undefined)
      if (epoch !== sendEpochRef.current) return
      if (result === false) {
        setSendError('这条消息没有发送完成，你可以重试。')
        if (useComposer && revision === draftRevisionRef.current) {
          setDraft(previousDraft)
          if (previousFile) setAttachment({ file: previousFile, previewUrl: URL.createObjectURL(previousFile) })
        }
      }
    } catch (error) {
      if (epoch !== sendEpochRef.current) return
      setSendError(error instanceof Error ? error.message : '消息暂时无法发送，请再试一次。')
      if (useComposer && revision === draftRevisionRef.current) {
        setDraft(previousDraft)
        if (previousFile) setAttachment({ file: previousFile, previewUrl: URL.createObjectURL(previousFile) })
      }
    } finally {
      if (epoch === sendEpochRef.current) {
        sendBusyRef.current = false
        setSending(false)
      }
    }
  }

  const stopGeneration = () => {
    sendEpochRef.current += 1
    sendBusyRef.current = false
    setSending(false)
    model.chat.cancelActiveRequest('user_stop')
    void model.voiceInput.stop({ cancel: true })
  }

  const selectImage = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ''
    if (!file.type.startsWith('image/')) {
      setSendError('请选择一张图片。')
      return
    }
    draftRevisionRef.current += 1
    setSendError('')
    setAttachment({ file, previewUrl: URL.createObjectURL(file) })
  }

  const decideCandidate = async (candidate, decision) => {
    if (candidateStates[candidate.id]?.pending) return
    setCandidateStates((current) => ({ ...current, [candidate.id]: { pending: true, error: '' } }))
    try {
      const result = await model.chat.resolveSkillCandidate(candidate.id, decision)
      if (!result?.id || result.ok === false) throw new Error(result?.error || '保存失败，请重试。')
      setCandidateStates((current) => ({ ...current, [candidate.id]: { pending: false, error: '' } }))
    } catch (error) {
      setCandidateStates((current) => ({ ...current, [candidate.id]: { pending: false,
        error: error instanceof Error ? error.message : '操作失败，请重试。' } }))
    }
  }

  const inputStatus = model.voiceInput.starting ? '正在打开麦克风…'
    : model.voiceInput.transcribing ? '正在把声音转成文字…'
    : model.voiceInput.listening ? '我在听，停顿后会自动发送。也可以再次点按麦克风结束。'
      : model.voice.isPreparingSpeech ? '正在准备朗读…'
        : model.voice.isSpeaking ? '昀正在朗读'
          : pending ? '昀正在想…' : ''
  const visibleError = sendError || model.voiceInput.error

  return <section className="companion-page" aria-label="昀，陪你听">
    <header className="companion-heading">
      <div><p className="eyebrow"><Sparkles size={15} aria-hidden="true" />YUN COMPANION</p><h1>昀，陪你听</h1><p>想听什么，或只是想说说话，我都在。</p></div>
      <IconButton icon={Settings} label="打开声音与陪伴设置" onClick={onSettings} />
    </header>

    <div className="companion-modes" role="group" aria-label="回应方式">
      {RESPONSE_MODES.map((mode) => <button key={mode.id} type="button" aria-pressed={model.responseMode === mode.id}
        title={mode.description} onClick={() => model.setResponseMode(mode.id)}>
        {model.responseMode === mode.id && <Check size={14} aria-hidden="true" />}<span>{mode.label}</span>
      </button>)}
    </div>

    <div className="voice-call-control">
      <button type="button" aria-pressed={model.voiceInput.continuous}
        className={`voice-call-button ${model.voiceInput.continuous ? 'is-active' : ''}`}
        disabled={model.voiceInput.supported === false || model.voiceInput.nativeEnabled || model.voiceInput.nativeChanging}
        onClick={() => {
          if (model.voiceInput.continuous) model.voiceInput.stopContinuous()
          else { stopGeneration(); void model.voiceInput.startContinuous() }
        }}><AudioLines size={17} aria-hidden="true" />{model.voiceInput.continuous ? '结束语音陪聊' : '开始语音陪聊'}</button>
      <span>{model.voiceInput.nativeEnabled ? model.voiceInput.nativeStatus : model.voiceInput.continuous ? '回复后会继续听；说「结束对话」或点击结束。' : '点按开启，免去每轮手动录音。'}</span>
    </div>

    <div className="chat-context">
      {currentSong ? <><AlbumArt song={currentSong} /><div><span>{model.playerState.isPlaying ? '此刻正在听' : '接着听这一首'}</span>
        <strong>{currentSong.title}</strong><small>{currentSong.artist || '未知歌手'}</small></div>
        <IconButton icon={model.playerState.isPlaying ? Pause : Play} label={model.playerState.isPlaying ? '暂停当前歌曲' : '播放当前歌曲'}
          onClick={() => { void model.playerCore.togglePlay() }} /></>
        : <><AudioLines size={25} aria-hidden="true" /><div><span>从一首歌，或一句话开始</span><strong>还没有正在播放的歌曲</strong><small>可以让我帮你找一首。</small></div></>}
    </div>

    <div className="chat-messages" ref={messagesRef} role="log" aria-live="off" aria-label="与昀的对话记录" tabIndex={0}
      onScroll={(event) => {
        const element = event.currentTarget
        const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 96
        nearBottomRef.current = nearBottom
        setShowLatest(!nearBottom)
      }}>
      {!messages.length && <EmptyState icon={Message} title="今天，想听一点什么？">告诉我你的心情，一起找到适合此刻的音乐。</EmptyState>}
      {messages.map((message) => {
        const candidate = message.skillCandidate
        const candidateState = candidate && candidateStates[candidate.id]
        return <article key={message.id} className={`chat-message ${message.role === 'user' ? 'is-user' : 'is-assistant'}`}>
          <span className="chat-message-author">{message.role === 'user' ? '你' : '昀'}</span>
          <div className="chat-message-content"><p>{message.content}</p>
            {candidate && <div className="skill-candidate" aria-busy={candidateState?.pending || undefined}>
              {candidate.status === 'proposed' ? <><p>这类操作已成功完成 {candidate.successCount || 0} 次，保存为下次可用的快捷方式？</p>
                <div><button type="button" disabled={candidateState?.pending} onClick={() => { void decideCandidate(candidate, 'approved') }}>
                  <Check size={14} aria-hidden="true" />{candidateState?.pending ? '处理中…' : '保存快捷方式'}</button>
                  <button type="button" disabled={candidateState?.pending} onClick={() => { void decideCandidate(candidate, 'rejected') }}>暂不保存</button></div></>
                : <p>{candidate.status === 'approved' ? '已保存为本地快捷方式。' : '这条快捷方式未保存。'}</p>}
              {candidateState?.error && <p role="status">{candidateState.error}</p>}
            </div>}
          </div>
        </article>
      })}
      {pending && <div className="chat-message is-assistant is-pending" aria-hidden="true"><span className="chat-message-author">昀</span><div className="chat-message-content"><span className="thinking-dots"><i /><i /><i /></span><p>让我想一想…</p></div></div>}
    </div>

    {showLatest && <button className="chat-scroll-latest" type="button" onClick={jumpToLatest}>回到最新消息</button>}

    <div className="chat-suggestions" aria-label="试着这样说">
      {SUGGESTIONS.map((prompt, index) => <button type="button" key={prompt} disabled={pending || voiceBusy || (index > 0 && !currentSong)}
        onClick={() => { void sendTurn({ text: prompt, useComposer: false }) }}><Sparkles size={14} aria-hidden="true" />{prompt}</button>)}
    </div>

    <GlassSurface as="form" className="chat-composer" onSubmit={(event) => { event.preventDefault(); void sendTurn() }}>
      {attachment && <div className="composer-attachment"><img src={attachment.previewUrl} alt="将要发送的图片预览" /><span>{attachment.file.name}</span>
        <IconButton icon={Close} label="移除图片" onClick={() => { draftRevisionRef.current += 1; setAttachment(null) }} /></div>}
      <label className="sr-only" htmlFor={inputId}>和昀聊聊</label>
      <textarea className="composer-input" id={inputId} ref={textareaRef} value={draft} rows={2} aria-describedby={statusId}
        placeholder="和昀聊聊你想听的音乐…" onChange={(event) => { draftRevisionRef.current += 1; setDraft(event.target.value) }}
        onCompositionStart={() => { composingRef.current = true }} onCompositionEnd={() => { composingRef.current = false }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || composingRef.current || event.keyCode === 229) return
          event.preventDefault()
          if (!pending) void sendTurn()
        }} />
      <div className="composer-actions">
        <div><input ref={imageInputRef} type="file" accept="image/*" hidden onChange={selectImage} />
          <IconButton icon={ImageIcon} label="添加图片" onClick={() => imageInputRef.current?.click()} />
          <IconButton icon={Mic} label={model.voiceInput.starting ? '取消打开麦克风' : model.voiceInput.listening ? '结束录音并发送' : model.voiceInput.transcribing ? '取消语音识别' : '语音输入'}
            className={voiceBusy ? 'is-active' : ''} aria-pressed={voiceBusy} disabled={model.voiceInput.supported === false || model.voiceInput.nativeEnabled || model.voiceInput.nativeChanging}
            onClick={() => {
              setSendError('')
              if (model.voiceInput.starting || model.voiceInput.transcribing) void model.voiceInput.stop({ cancel: true })
              else if (model.voiceInput.listening) void model.voiceInput.stop()
              else {
                if (pending) stopGeneration()
                void model.voiceInput.start()
              }
            }} />
          <small>Enter 发送 · Shift + Enter 换行</small>
        </div>
        {pending ? <button key="stop-response" type="button" className="button button-secondary" onClick={event => { event.preventDefault(); stopGeneration() }}><Close size={17} aria-hidden="true" />停止生成</button>
          : <button key="send-message" type="submit" className="button button-primary" aria-label="发送给昀" disabled={(!draft.trim() && !attachment) || voiceBusy}><Send size={17} aria-hidden="true" /><span>发送</span></button>}
      </div>
    </GlassSurface>

    <div className="chat-status" id={statusId} role="status" aria-live="polite" aria-atomic="true">
      <span>{visibleError || inputStatus || '语音只会在你点按麦克风，或开启唤醒后使用。'}</span>
      {speaking && <button type="button" onClick={model.voice.stopSpeaking}><Close size={14} aria-hidden="true" />停止朗读</button>}
    </div>
    <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
  </section>
}
