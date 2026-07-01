import { useEffect, useRef } from 'react'

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
const HOLD_TIME_MS = 350
const WAKE_COOLDOWN_MS = 5000
const FRAME_INTERVAL_MS = 50

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0))
}

function jointAngle(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) }
  const cb = { x: c.x - b.x, y: c.y - b.y, z: (c.z || 0) - (b.z || 0) }
  const denominator = Math.max(0.000001, Math.hypot(ab.x, ab.y, ab.z) * Math.hypot(cb.x, cb.y, cb.z))
  const cosine = Math.max(-1, Math.min(1, (ab.x * cb.x + ab.y * cb.y + ab.z * cb.z) / denominator))
  return Math.acos(cosine) * 180 / Math.PI
}

function isVictoryGesture(points) {
  if (!points?.[20]) return false
  const wrist = points[0]
  const palmSize = Math.max(distance(wrist, points[9]), 0.001)
  const indexReach = distance(wrist, points[8])
  const middleReach = distance(wrist, points[12])
  const ringReach = distance(wrist, points[16])
  const pinkyReach = distance(wrist, points[20])
  const indexOpen = jointAngle(points[5], points[6], points[8]) > 132
  const middleOpen = jointAngle(points[9], points[10], points[12]) > 132
  const otherFingersLower = indexReach > ringReach * 1.055
    && middleReach > pinkyReach * 1.055
  const fingersSeparated = distance(points[8], points[12]) > palmSize * 0.17

  return indexOpen
    && middleOpen
    && otherFingersLower
    && fingersSeparated
}

export default function VictoryGestureWake({ enabled = false, disabled = false, onWake, onCameraStateChange }) {
  const disabledRef = useRef(disabled)
  const onWakeRef = useRef(onWake)
  const onCameraStateChangeRef = useRef(onCameraStateChange)

  useEffect(() => {
    disabledRef.current = disabled
  }, [disabled])

  useEffect(() => {
    onWakeRef.current = onWake
  }, [onWake])

  useEffect(() => {
    onCameraStateChangeRef.current = onCameraStateChange
  }, [onCameraStateChange])

  useEffect(() => {
    if (!enabled) return undefined

    let disposed = false
    let starting = false
    let stream = null
    let landmarker = null
    let video = null
    let frameId = 0
    let lastFrameAt = 0
    let gestureStartedAt = 0
    let lastWakeAt = 0

    const detect = () => {
      if (disposed) return
      frameId = window.requestAnimationFrame(detect)
      const now = performance.now()
      if (!landmarker || !video || video.readyState < 2 || now - lastFrameAt < FRAME_INTERVAL_MS) return
      lastFrameAt = now
      if (disabledRef.current || document.hidden) {
        gestureStartedAt = 0
        return
      }

      const result = landmarker.detectForVideo(video, now)
      const victory = result.landmarks?.some(isVictoryGesture) || false
      if (!victory) {
        gestureStartedAt = 0
        return
      }

      if (!gestureStartedAt) gestureStartedAt = now
      if (now - gestureStartedAt >= HOLD_TIME_MS && now - lastWakeAt >= WAKE_COOLDOWN_MS) {
        lastWakeAt = now
        gestureStartedAt = 0
        onWakeRef.current?.()
      }
    }

    const start = async () => {
      if (disposed || starting || stream) return
      starting = true
      onCameraStateChangeRef.current?.('starting')
      try {
        const cameraStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 },
              frameRate: { ideal: 24, max: 30 },
          },
          audio: false,
        })
        if (disposed) {
          cameraStream.getTracks().forEach((track) => track.stop())
          return
        }
        stream = cameraStream
        const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision')
        const vision = await FilesetResolver.forVisionTasks(WASM_ROOT)
        const options = {
          runningMode: 'VIDEO', numHands: 1,
          minHandDetectionConfidence: 0.38,
          minHandPresenceConfidence: 0.38,
          minTrackingConfidence: 0.42,
        }
        try {
          landmarker = await HandLandmarker.createFromOptions(vision, {
            ...options,
            baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'GPU' },
          })
        } catch {
          landmarker = await HandLandmarker.createFromOptions(vision, {
            ...options,
            baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'CPU' },
          })
        }
        if (disposed) {
          landmarker.close?.()
          landmarker = null
          stream.getTracks().forEach((track) => track.stop())
          stream = null
          return
        }
        video = document.createElement('video')
        video.muted = true
        video.playsInline = true
        video.srcObject = stream
        await video.play()
        onCameraStateChangeRef.current?.('active')
        frameId = window.requestAnimationFrame(detect)
      } catch {
        stream?.getTracks().forEach((track) => track.stop())
        stream = null
        if (!disposed) onCameraStateChangeRef.current?.('error')
      } finally {
        starting = false
      }
    }

    const unlock = () => {
      start()
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    start()

    return () => {
      disposed = true
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      if (frameId) window.cancelAnimationFrame(frameId)
      video?.pause?.()
      if (video) video.srcObject = null
      stream?.getTracks().forEach((track) => track.stop())
      stream = null
      landmarker?.close?.()
      landmarker = null
      onCameraStateChangeRef.current?.('off')
    }
  }, [enabled])

  return null
}
