import { useCallback, useEffect, useRef, useState } from 'react'
import { IMMERSIVE_BACKGROUND_DEFAULTS, normalizeImmersiveBackground } from '../../server/visuals/immersiveBackgroundSchema.js'

const endpoint = '/api/visuals/immersive-background'
async function request(options) {
  const response = await fetch(endpoint, options)
  const data = await response.json()
  if (!response.ok || !data.ok) throw new Error(data.error || '背景效果未能保存，请重试')
  return { ...data, settings: normalizeImmersiveBackground(data.settings) }
}

export function useImmersiveBackground() {
  const [settings, setSettings] = useState(() => ({ ...IMMERSIVE_BACKGROUND_DEFAULTS }))
  const [saved, setSaved] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const edits = useRef(0), mounted = useRef(false), saveRequest = useRef(null)
  useEffect(() => {
    mounted.current = true
    const controller = new AbortController(), epoch = edits.current
    request({ signal: controller.signal, cache: 'no-store' }).then(data => {
      if (controller.signal.aborted) return
      setSaved(data.settings)
      if (epoch === edits.current) setSettings(data.settings)
      setMessage(epoch === edits.current ? data.savedAt ? '已载入保存的效果' : '调整后点击保存效果' : '预览中，调整尚未保存')
    }).catch(error => { if (!controller.signal.aborted) setMessage(`暂未读到已存效果：${error.message}`) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { mounted.current = false; controller.abort(); saveRequest.current?.abort() }
  }, [])
  const change = useCallback((key, value) => {
    edits.current++
    setSettings(previous => normalizeImmersiveBackground({ ...previous, [key]: value }))
    setMessage('预览中，调整尚未保存')
  }, [])
  const reset = useCallback(() => {
    edits.current++
    setSettings({ ...IMMERSIVE_BACKGROUND_DEFAULTS })
    setMessage('已恢复默认预览，尚未保存')
  }, [])
  const save = async () => {
    if (saveRequest.current) return
    const controller = new AbortController(), snapshot = settings, epoch = edits.current
    saveRequest.current = controller; setSaving(true); setMessage('正在保存…')
    try {
      const data = await request({ method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: snapshot }) })
      if (!mounted.current) return
      setSaved(data.settings)
      setMessage(epoch === edits.current ? '已保存，重新打开仍会保留' : '已保存上次调整，当前还有未保存的修改')
    } catch (error) { if (!controller.signal.aborted && mounted.current) setMessage(`保存失败：${error.message}`) }
    finally { saveRequest.current = null; if (mounted.current) setSaving(false) }
  }
  return { settings, loading, saving, change, reset, save, message, dirty: saved && JSON.stringify(settings) !== JSON.stringify(saved) }
}
