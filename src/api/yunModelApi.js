export async function configureYunProModel(payload) {
  const response = await fetch('/api/yun/model-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Pro 模型连接失败，请检查配置后重试。')
  return data
}
