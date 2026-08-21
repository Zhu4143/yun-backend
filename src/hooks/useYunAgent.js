import { useMemo, useRef } from 'react'
import { executeYunAgentActions } from '../services/yunAgentActions'

function makeSessionId() {
  return `yun_agent_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`}`
}

export function useYunAgent({ player, playerState, setResponseMode, voice, libraryTracks = [], currentSong = null, playHistory = [], recentRecommendations = [] } = {}) {
  const sessionIdRef = useRef(makeSessionId())
  const context = useMemo(() => ({
    online: navigator.onLine !== false,
    playback: { currentTrackId: currentSong?.id || null, isPlaying: Boolean(playerState?.isPlaying), currentTime: Number(playerState?.currentTime || 0), duration: Number(playerState?.duration || 0), playbackMode: playerState?.playbackMode || 'sequence' },
    library: libraryTracks.map((track) => ({ id: track.id, title: track.title, artist: track.artist, source: track.source })).slice(0, 200),
  }), [currentSong, libraryTracks, playerState?.currentTime, playerState?.duration, playerState?.isPlaying, playerState?.playbackMode])

  return useMemo(() => ({
    run: async (message, { isCurrentRequest = () => true, onPlan = null } = {}) => {
      const startedAt = new Date().toISOString()
      const response = await fetch('/api/yun/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, sessionId: sessionIdRef.current, context }) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result.ok) return result
      // A companion acknowledgement should not wait behind network search or
      // audio startup. The caller can render/speak this plan while the safe,
      // declarative actions below continue in the background of the same turn.
      if (isCurrentRequest()) onPlan?.(result)
      const executions = await executeYunAgentActions(result.actions, {
        player,
        voice,
        setResponseMode,
        context: { currentSong, playHistory, recentRecommendations },
        isCurrentRequest,
      })
      const cancelled = executions.some((item) => item?.cancelled)
      let skillCandidate = null
      let learningOutcome = null
      if (result.runId && !cancelled) {
        const success = executions.length === result.actions.length && executions.every((item) => item?.ok !== false)
        try {
          const outcomeResponse = await fetch('/api/yun/agent/outcomes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ runId: result.runId, success }),
          })
          learningOutcome = await outcomeResponse.json().catch(() => ({}))
          skillCandidate = learningOutcome.candidate || null
        } catch {
          // Playback already finished locally. A failed learning receipt must
          // never turn a successful music action into a visible failure.
        }
      }
      return { ...result, executions, skillCandidate, startedAt, cancelled, analysisQueued: Boolean(learningOutcome?.analysisQueued) }
    },
    waitForSkillCandidate: async (since) => {
      for (const delay of [1500, 3000, 5000]) {
        await new Promise((resolve) => window.setTimeout(resolve, delay))
        try {
          const response = await fetch('/api/yun/skill-candidates')
          const result = await response.json().catch(() => ({}))
          const candidate = (result.items || []).find((item) => item.status === 'proposed' && String(item.createdAt) >= String(since))
          if (candidate) return candidate
        } catch {
          // Keep the live conversation independent from the background worker.
        }
      }
      return null
    },
    decideSkillCandidate: async (candidateId, decision) => {
      const response = await fetch('/api/yun/skill-candidates/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId, decision }),
      })
      return response.json().catch(() => ({}))
    },
  }), [context, currentSong, playHistory, player, recentRecommendations, setResponseMode, voice])
}
