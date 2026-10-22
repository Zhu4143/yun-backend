import { useEffect, useMemo, useRef } from 'react'
import {
  AVATAR_PHASE,
  AVATAR_GRID_SIZE_BY_QUALITY,
  PORTRAIT_WORLD_SIZE,
  PORTRAIT_MOTION_SIZE_BY_QUALITY,
  createForegroundMask,
  getPortraitViewportFit,
  getPortraitFrameTransform,
  createSpeakingMotionSequence,
  getSpeakingActivitySegments,
  shouldHandleWakeMotionEnd,
} from './portraitMotion.js'
import { createPortraitFrameProcessor, createPortraitFrameQueue } from './portraitFrameProcessing.js'
import { applyPortraitSpeechMouth, capturePortraitMouth, createPortraitMouthAtlas, createPortraitSpeechClock, samplePortraitVideoScan } from './portraitSpeech.js'

const MOTION_SOURCES = {
  wake: '/avatar-motion/wake.mp4',
  listening: '/avatar-motion/listening.mp4',
  speaking: '/avatar-motion/speaking.mp4',
}

function makeField(pointCount) {
  return {
    pointCount,
    version: 0,
    ready: false,
    targets: new Float32Array(pointCount * 3),
    uvs: new Float32Array(pointCount * 2),
    colors: new Float32Array(pointCount * 3),
    activeParticles: pointCount,
    speakingSegments: [],
    speakingScan: 'pending',
    smoothingSeconds: 0.035,
    screenHeight: 0,
    motionHeight: 96,
  }
}

function getMouthMotionScore(frame, baseline, width, height) {
  if (!baseline) return 0
  const left = Math.floor(width * 0.475)
  const right = Math.ceil(width * 0.525)
  const top = Math.floor(height * 0.435)
  const bottom = Math.ceil(height * 0.495)
  let difference = 0
  let samples = 0
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * width + x) * 4
      const currentLuma = frame[offset] * 0.299 + frame[offset + 1] * 0.587 + frame[offset + 2] * 0.114
      const baseLuma = baseline[offset] * 0.299 + baseline[offset + 1] * 0.587 + baseline[offset + 2] * 0.114
      difference += Math.abs(currentLuma - baseLuma) / 255
      samples += 1
    }
  }
  return samples ? difference / samples : 0
}

function waitForEvent(target, name, timeoutMs = 1800, signal) {
  return new Promise((resolve) => {
    let timeout = 0
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      target.removeEventListener(name, onEvent)
      target.removeEventListener('error', onError)
      signal?.removeEventListener('abort', onError)
      resolve(value)
    }
    const onEvent = () => finish(true)
    const onError = () => finish(false)
    target.addEventListener(name, onEvent, { once: true })
    target.addEventListener('error', onError, { once: true })
    signal?.addEventListener('abort', onError, { once: true })
    if (signal?.aborted) finish(false)
    else timeout = window.setTimeout(() => finish(false), timeoutMs)
  })
}

function seekTo(video, time, signal) {
  if (signal?.aborted) return Promise.resolve(false)
  if (Math.abs(video.currentTime - time) < 0.01) return Promise.resolve(true)
  const ready = waitForEvent(video, 'seeked', 1800, signal)
  video.currentTime = time
  return ready
}

async function scanSpeakingClip(video, size, framing, signal) {
  const unavailable = { segments: [], mouthAtlas: null }
  if (video.readyState < 2) return unavailable
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return unavailable
  const drawFrame = () => {
    context.fillStyle = `rgb(${framing.background.join(',')})`
    context.fillRect(0, 0, size.width, size.height)
    context.drawImage(video, framing.x, framing.y, size.width * framing.scale, size.height * framing.scale)
    return context.getImageData(0, 0, size.width, size.height).data
  }
  video.pause()
  video.playbackRate = 1
  if (!(await seekTo(video, 0, signal))) return unavailable
  const firstFrame = drawFrame()
  const mouthFrames = [capturePortraitMouth(firstFrame, size.width, size.height)]
  const duration = Number.isFinite(video.duration) ? video.duration : 0
  const fps = 12
  const frameCount = Math.max(1, Math.ceil(duration * fps))
  const scores = new Array(frameCount).fill(0)

  // Sample at source speed: accelerated decoding can skip the few frames
  // with a visibly open mouth and produce a closed-lip-only atlas.
  video.playbackRate = 1
  let sampledTick = -1
  const sample = (mediaTime) => {
    const tick = Math.min(frameCount - 1, Math.floor(mediaTime * fps))
    if (tick !== sampledTick && tick >= 0) {
      sampledTick = tick
      const frame = drawFrame()
      scores[tick] = getMouthMotionScore(frame, firstFrame, size.width, size.height)
      mouthFrames.push(capturePortraitMouth(frame, size.width, size.height))
    }
  }
  await samplePortraitVideoScan(video, { sample, signal, timeoutMs: duration * 1000 / video.playbackRate + 1800 })
  video.playbackRate = 1
  if (signal?.aborted) return unavailable
  await seekTo(video, 0, signal)
  return {
    segments: getSpeakingActivitySegments(scores, {
      fps,
      threshold: 0.045,
      mergeGapSeconds: 0.45,
      paddingSeconds: 0.12,
      minimumSeconds: 0.18,
    }),
    mouthAtlas: createPortraitMouthAtlas(mouthFrames),
  }
}

export function usePortraitMotionTargets({ quality = 'medium', phase = AVATAR_PHASE.VINYL_IDLE, turnId = 0, voiceMeterRef }) {
  const pointCount = (AVATAR_GRID_SIZE_BY_QUALITY[quality] || AVATAR_GRID_SIZE_BY_QUALITY.medium) ** 2
  const motionSize = PORTRAIT_MOTION_SIZE_BY_QUALITY[quality] || PORTRAIT_MOTION_SIZE_BY_QUALITY.medium
  const fieldRef = useMemo(() => ({ current: makeField(pointCount) }), [pointCount])
  const latestPhaseRef = useRef(phase)
  const latestTurnIdRef = useRef(turnId)
  const latestVoiceMeterRef = useRef(voiceMeterRef)
  useEffect(() => { latestVoiceMeterRef.current = voiceMeterRef }, [voiceMeterRef])

  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.width = motionSize.width
    canvas.height = motionSize.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return undefined

    const clipFraming = new WeakMap()
    const calibrateVideo = (video) => {
      if (video.readyState < 2 || clipFraming.has(video)) return
      context.drawImage(video, 0, 0, motionSize.width, motionSize.height)
      const frame = context.getImageData(0, 0, motionSize.width, motionSize.height)
      const mask = createForegroundMask(frame.data, motionSize.width, motionSize.height, { tolerance: 6 })
      clipFraming.set(video, { ...getPortraitFrameTransform(mask, motionSize.width, motionSize.height), background: Array.from(frame.data.slice(0, 3)) })
    }
    const videos = Object.fromEntries(Object.entries(MOTION_SOURCES).map(([name, src]) => {
      const video = document.createElement('video')
      video.src = src
      video.preload = 'auto'
      video.muted = true
      video.playsInline = true
      video.disablePictureInPicture = true
      video.crossOrigin = 'anonymous'
      video.onloadeddata = () => calibrateVideo(video)
      video.load()
      return [name, video]
    }))
    const field = fieldRef.current
    let disposed = false
    let activeVideo = null
    let activePhase = AVATAR_PHASE.VINYL_IDLE
    let activeTurnId = latestTurnIdRef.current
    let frameCallbackId = 0
    let animationFrameId = 0
    let lastFrameTick = -1
    const speechClock = createPortraitSpeechClock()
    const scanAbortController = new AbortController()
    const speakingMotions = createSpeakingMotionSequence()
    let speakingMotionTimer = 0
    let motionGeneration = 0
    let speakingSegments = []
    let mouthAtlas = null
    let scanVideo = null
    let publishedVideo = null
    let publishedTime = 0
    let clipChangedAt = 0
    let frameQueue = null
    let fallbackProcessor = null

    const writePortraitWorldTargets = () => {
      const fit = getPortraitViewportFit({
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      })
      field.screenHeight = fit.screenHeight
      field.motionHeight = motionSize.height
      for (let point = 0; point < pointCount; point += 1) {
        const offset = point * 3
        field.targets[offset] = (field.uvs[point * 2] - 0.5) * PORTRAIT_WORLD_SIZE.width * fit.scale
        field.targets[offset + 1] = (0.5 - field.uvs[point * 2 + 1]) * PORTRAIT_WORLD_SIZE.height * fit.scale + fit.offsetY
        field.targets[offset + 2] = 0.38
      }
      field.version += 1
    }

    const applyPortraitFrame = (result, { video, mediaTime }) => {
      if (disposed || video !== activeVideo) return
      field.uvs.set(result.uvs)
      field.colors.set(result.colors)
      if (publishedVideo !== video || Math.abs(mediaTime - publishedTime) > 0.25) {
        publishedVideo = video
        clipChangedAt = performance.now()
      }
      publishedTime = mediaTime
      field.smoothingSeconds = performance.now() - clipChangedAt < 450 ? 0.14 : 0.035
      writePortraitWorldTargets()
      field.ready = true
    }
    const useFallback = () => {
      frameQueue = null
      fallbackProcessor = createPortraitFrameProcessor(field.ready ? field : null)
      // A paused forming/thinking clip still needs one frame after failure.
      lastFrameTick = -1
      if (activeVideo) publishVideoFrame(activeVideo)
    }
    try {
      frameQueue = createPortraitFrameQueue({
        worker: new Worker(new URL('./portraitMotion.worker.js', import.meta.url), { type: 'module' }),
        onFrame: applyPortraitFrame,
        onError: useFallback,
        onIdle: () => { if (activeVideo) publishVideoFrame(activeVideo) },
      })
    } catch {
      fallbackProcessor = createPortraitFrameProcessor()
    }

    const publishVideoFrame = (video) => {
      if (disposed || video !== activeVideo || video.readyState < 2) return
      const tick = Math.floor(video.currentTime * 12)
      const voiceMeter = latestVoiceMeterRef.current?.current
      const voicePlaying = activePhase === AVATAR_PHASE.SPEAKING && Boolean(voiceMeter?.playing)
      if (lastFrameTick === -1) speechClock.invalidate()
      if (speechClock.publish({ now: performance.now(), tick, playing: voicePlaying, mouthOpen: voiceMeter?.mouthOpen || 0, busy: frameQueue?.busy })) {
        lastFrameTick = tick
        calibrateVideo(video)
        const framing = clipFraming.get(video)
        context.fillStyle = `rgb(${framing.background.join(',')})`
        context.fillRect(0, 0, motionSize.width, motionSize.height)
        context.drawImage(video, framing.x, framing.y, motionSize.width * framing.scale, motionSize.height * framing.scale)
        const frame = context.getImageData(0, 0, motionSize.width, motionSize.height)
        applyPortraitSpeechMouth(frame.data, motionSize.width, motionSize.height, mouthAtlas,
          voiceMeter?.mouthOpen || 0, { active: voicePlaying })
        const input = { rgba: frame.data, width: motionSize.width, height: motionSize.height, pointCount }
        const frameContext = { video, mediaTime: video.currentTime }
        if (frameQueue) frameQueue.submit(input, frameContext)
        else {
          const result = fallbackProcessor(input)
          if (result) applyPortraitFrame(result, frameContext)
        }
      }

    }

    const speechIntervalId = window.setInterval(() => {
      if (activeVideo && (latestVoiceMeterRef.current?.current?.playing || speechClock.active)) publishVideoFrame(activeVideo)
    }, 1000 / 24)

    const scheduleFrame = (video) => {
      if (disposed || activeVideo !== video) return
      if (video.requestVideoFrameCallback) {
        frameCallbackId = video.requestVideoFrameCallback(() => {
          publishVideoFrame(video)
          scheduleFrame(video)
        })
      } else {
        animationFrameId = window.requestAnimationFrame(() => {
          publishVideoFrame(video)
          scheduleFrame(video)
        })
      }
    }

    const beginSpeakingScan = async () => {
      // Analysis must not seek or accelerate the clip currently producing
      // visible body motion when the first reply arrives during preload.
      scanVideo = document.createElement('video')
      scanVideo.src = MOTION_SOURCES.speaking
      scanVideo.preload = 'auto'
      scanVideo.muted = true
      scanVideo.playsInline = true
      scanVideo.load()
      const scanReady = scanVideo.readyState >= 2
        ? Promise.resolve(true) : waitForEvent(scanVideo, 'loadeddata', 12000, scanAbortController.signal)
      // Embedded Chromium can defer preload for an unattached paused video.
      // Muted play explicitly requests decoding without audible playback.
      void scanVideo.play().catch(() => {})
      if (!(await scanReady)) {
        field.speakingScan = 'unavailable'
        return
      }
      if (disposed) return
      scanVideo.pause()
      if (!(await seekTo(scanVideo, 0, scanAbortController.signal)) || disposed) return
      calibrateVideo(scanVideo)
      const scanned = await scanSpeakingClip(scanVideo, motionSize, clipFraming.get(scanVideo), scanAbortController.signal)
      if (disposed) return
      speakingSegments = scanned.segments
      mouthAtlas = scanned.mouthAtlas
      lastFrameTick = -1
      if (activeVideo) publishVideoFrame(activeVideo)
      field.speakingSegments = speakingSegments
      field.speakingScan = speakingSegments.length ? 'ready' : 'full-clip-fallback'
      field.version += 1
    }
    void beginSpeakingScan()

    const stopActiveVideo = () => {
      frameQueue?.invalidate()
      motionGeneration += 1
      if (speakingMotionTimer) window.clearTimeout(speakingMotionTimer)
      speakingMotionTimer = 0
      if (frameCallbackId && activeVideo?.cancelVideoFrameCallback) activeVideo.cancelVideoFrameCallback(frameCallbackId)
      if (animationFrameId) window.cancelAnimationFrame(animationFrameId)
      frameCallbackId = 0
      animationFrameId = 0
      activeVideo?.pause()
      if (activeVideo) activeVideo.onended = null
      activeVideo = null
      activePhase = AVATAR_PHASE.VINYL_IDLE
      activeTurnId = -1
    }

    const startSpeakingMotion = async () => {
      if (disposed || latestPhaseRef.current !== AVATAR_PHASE.SPEAKING) return
      stopActiveVideo()
      const generation = motionGeneration
      const turnId = latestTurnIdRef.current
      const current = () => !disposed && generation === motionGeneration
        && latestTurnIdRef.current === turnId && latestPhaseRef.current === AVATAR_PHASE.SPEAKING
      const readyVideos = Object.values(videos).filter((video) => video.readyState < 2)
      await Promise.all(readyVideos.map((video) => waitForEvent(video, 'loadeddata', 1800, scanAbortController.signal)))
      if (!current()) return
      const motion = speakingMotions.next(Object.fromEntries(Object.entries(videos)
        .filter(([, video]) => video.readyState >= 2)
        .map(([name, video]) => [name, video.duration])))
      if (!motion) {
        speakingMotionTimer = window.setTimeout(() => { if (current()) void startSpeakingMotion() }, 500)
        return
      }
      const video = videos[motion.clip]
      activeVideo = video
      activePhase = AVATAR_PHASE.SPEAKING
      activeTurnId = turnId
      lastFrameTick = -1
      video.loop = false
      video.playbackRate = 1
      const positioned = await seekTo(video, motion.startAt, scanAbortController.signal)
      if (!current()) return
      if (!positioned) {
        speakingMotionTimer = window.setTimeout(() => { if (current()) void startSpeakingMotion() }, 500)
        return
      }
      publishVideoFrame(video)
      scheduleFrame(video)
      const next = () => { if (current()) void startSpeakingMotion() }
      video.onended = next
      try { await video.play() } catch { if (current()) speakingMotionTimer = window.setTimeout(next, 500); return }
      if (!current()) return
      speakingMotionTimer = window.setTimeout(next, motion.durationSeconds * 1000)
    }

    const playCurrentPhase = () => {
      if (disposed) return
      const currentPhase = latestPhaseRef.current
      const holdWakeFrame = currentPhase === AVATAR_PHASE.BREAKING || currentPhase === AVATAR_PHASE.HUMAN_FORMING
      const returningToVinyl = currentPhase === AVATAR_PHASE.HUMAN_DISPERSING || currentPhase === AVATAR_PHASE.VINYL_REFORMING
      if (returningToVinyl) {
        const heldVideo = activeVideo
        stopActiveVideo()
        if (heldVideo) {
          activeVideo = heldVideo
          activePhase = currentPhase
          lastFrameTick = -1
          publishVideoFrame(heldVideo)
        }
        return
      }
      const clip = currentPhase === AVATAR_PHASE.SPEAKING
        ? 'speaking'
        : currentPhase === AVATAR_PHASE.LISTENING || currentPhase === AVATAR_PHASE.THINKING
          ? 'listening'
          : currentPhase === AVATAR_PHASE.WAKE_MOTION || holdWakeFrame
            ? 'wake'
            : ''
      if (!clip) {
        stopActiveVideo()
        return
      }
      const video = videos[clip]
      const turnChanged = latestTurnIdRef.current !== activeTurnId
      if (currentPhase === AVATAR_PHASE.SPEAKING) {
        if (activePhase === AVATAR_PHASE.SPEAKING && !turnChanged) return
        void startSpeakingMotion()
        return
      }
      if (activeVideo === video && !turnChanged) {
        activePhase = currentPhase
        video.onended = shouldHandleWakeMotionEnd({ clip, phase: currentPhase }) ? () => {
          video.pause()
          window.dispatchEvent(new CustomEvent('yun:avatar-wake-motion-ended', {
            detail: { turnId: latestTurnIdRef.current },
          }))
        } : null
        if (holdWakeFrame || currentPhase === AVATAR_PHASE.THINKING || video.ended) video.pause()
        else if (video.paused) void video.play().catch(() => {})
        return
      }
      stopActiveVideo()
      activeVideo = video
      activePhase = currentPhase
      activeTurnId = latestTurnIdRef.current
      lastFrameTick = -1
      video.loop = clip === 'listening'
      video.playbackRate = 1
      video.onended = shouldHandleWakeMotionEnd({ clip, phase: currentPhase }) ? () => {
        video.pause()
        window.dispatchEvent(new CustomEvent('yun:avatar-wake-motion-ended', {
          detail: { turnId: latestTurnIdRef.current },
        }))
      } : null
      const startAt = 0
      const generation = motionGeneration
      const begin = async () => {
        if (disposed || activeVideo !== video || generation !== motionGeneration) return
        if (video.currentTime > startAt + 0.1 || video.ended) await seekTo(video, startAt)
        if (disposed || activeVideo !== video || generation !== motionGeneration) return
        publishVideoFrame(video)
        scheduleFrame(video)
        if (!holdWakeFrame && currentPhase !== AVATAR_PHASE.THINKING) void video.play().catch(() => {})
      }
      if (video.readyState >= 2) void begin()
      else {
        const onReady = () => { video.removeEventListener('loadeddata', onReady); void begin() }
        video.addEventListener('loadeddata', onReady, { once: true })
      }
    }

    const handleViewportResize = () => {
      if (field.ready) writePortraitWorldTargets()
    }
    window.addEventListener('resize', handleViewportResize)
    playCurrentPhase()
    const syncPhase = () => playCurrentPhase()
    window.addEventListener('yun:avatar-phase-sync', syncPhase)
    return () => {
      disposed = true
      scanAbortController.abort()
      window.clearInterval(speechIntervalId)
      stopActiveVideo()
      frameQueue?.dispose()
      if (scanVideo) {
        scanVideo.pause()
        scanVideo.removeAttribute('src')
        scanVideo.load()
      }
      window.removeEventListener('yun:avatar-phase-sync', syncPhase)
      window.removeEventListener('resize', handleViewportResize)
      Object.values(videos).forEach((video) => {
        video.onloadeddata = null
        video.pause()
        video.removeAttribute('src')
        video.load()
      })
    }
  }, [fieldRef, pointCount, motionSize])

  useEffect(() => {
    latestPhaseRef.current = phase
    latestTurnIdRef.current = turnId
    window.dispatchEvent(new Event('yun:avatar-phase-sync'))
  }, [phase, turnId])

  return fieldRef
}
