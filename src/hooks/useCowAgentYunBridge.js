import { useEffect, useRef } from 'react'
import { executeYunAgentActions } from '../services/yunAgentActions'

function createClientId() {
  return `yun-web-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
}

function withTimeout(promise, timeoutMs = 20_000) {
  let timer = 0
  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new Error('remote_playback_start_timeout')), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer))
}

export function useCowAgentYunBridge({ player, voice, currentSong, playHistory, recentRecommendations, onRemoteTurn, onRemoteOutcome } = {}) {
  const clientIdRef = useRef(createClientId())
  const latestRef = useRef({ player, voice, currentSong, playHistory, recentRecommendations, onRemoteTurn, onRemoteOutcome })

  useEffect(() => {
    latestRef.current = { player, voice, currentSong, playHistory, recentRecommendations, onRemoteTurn, onRemoteOutcome }
  }, [currentSong, onRemoteOutcome, onRemoteTurn, playHistory, player, recentRecommendations, voice])

  useEffect(() => {
    let cancelled = false
    let timer = 0

    const report = async (jobId, success, error = '') => {
      await fetch(`/api/yun/cowagent/jobs/${encodeURIComponent(jobId)}/outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success, error }),
      }).catch(() => {})
    }

    const poll = async () => {
      try {
        const response = await fetch(`/api/yun/cowagent/actions?clientId=${encodeURIComponent(clientIdRef.current)}`, { cache: 'no-store' })
        const result = await response.json().catch(() => ({}))
        for (const job of result.jobs || []) {
          if (cancelled) return
          const runtime = latestRef.current
          runtime.onRemoteTurn?.({ message: job.message, reply: job.reply, sender: job.sender })
          let executions = []
          let executionError = ''
          try {
            executions = await withTimeout(executeYunAgentActions(job.actions, {
              player: runtime.player,
              voice: runtime.voice,
              context: {
                currentSong: runtime.currentSong,
                playHistory: runtime.playHistory || [],
                recentRecommendations: runtime.recentRecommendations || [],
              },
              isCurrentRequest: () => !cancelled,
            }))
          } catch (error) {
            executionError = error instanceof Error ? error.message : '本机播放器未能执行该命令。'
          }
          const success = !executionError && executions.length === (job.actions || []).length && executions.every((item) => item?.ok !== false)
          const error = success ? '' : (executionError || executions.find((item) => item?.error)?.error || '本机播放器未能执行该命令。')
          if (!success && !cancelled) {
            const reply = error === 'remote_playback_start_timeout'
              ? '歌单已经找到，但浏览器没有完成后台播放启动。请在昀页面手动点一次播放键授权；之后微信命令就能继续直接接管播放。'
              : `歌单找到了，但本机播放失败：${error}`
            runtime.onRemoteOutcome?.({ job, reply })
          }
          await report(job.id, success, error)
        }
      } catch {
        // CowAgent is optional. A temporary bridge outage must never disturb
        // the local player or normal chat.
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, 1500)
      }
    }

    poll()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])
}
