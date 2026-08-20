export async function sendVisionMessage(imageFile, text = '') {
  if (!imageFile) {
    throw new Error('缺少图片')
  }

  const formData = new FormData()
  formData.append('image', imageFile)
  formData.append('text', text || '请帮我看看这张截图')

  const response = await fetch('/api/vision-chat', {
    method: 'POST',
    body: formData,
  })
  const data = await response.json().catch(() => ({}))

  if (!response.ok || data.error) {
    throw new Error(data.detail || data.error || '视觉识别失败')
  }

  return data.answer || ''
}
