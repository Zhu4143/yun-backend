export async function resolveMusicStructureSeek(track, intent) {
  const response = await fetch('/api/music/structure-seek', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ track, intent }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.error) throw new Error(data.error || '歌曲结构定位失败')
  return data
}
