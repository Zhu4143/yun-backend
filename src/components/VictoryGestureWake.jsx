import { useEffect, useRef } from 'react'
import { createHandGestureController } from '../gestures/HandGestureController.js'

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
const FRAME_INTERVAL_MS = 50

export default function VictoryGestureWake({
  enabled = false,
  disabled = false,
  onCameraStateChange,
  onGestureState,
  onAction,
}) {
  const disabledRef = useRef(disabled)
  const onCameraStateChangeRef = useRef(onCameraStateChange)
  const onGestureStateRef = useRef(onGestureState)
  const onActionRef = useRef(onAction)

  useEffect(() => {
    disabledRef.current = disabled
  }, [disabled])

  useEffect(() => {
    onCameraStateChangeRef.current = onCameraStateChange
  }, [onCameraStateChange])

  useEffect(() => {
    onGestureStateRef.current = onGestureState
  }, [onGestureState])

  useEffect(() => {
    onActionRef.current = onAction
  }, [onAction])

  useEffect(() => {
    if (!enabled) return undefined

    let disposed = false
    let starting = false
    let stream = null
    let landmarker = null
    let video = null
    let frameId = 0
    let lastFrameAt = 0
    const gestureController = createHandGestureController()

    const publishIdleGesture = () => {
      onGestureStateRef.current?.(gestureController.reset())
    }

    const detect = () => {
      if (disposed) return
      frameId = window.requestAnimationFrame(detect)
      const now = performance.now()
      if (!landmarker || !video || video.readyState < 2 || now - lastFrameAt < FRAME_INTERVAL_MS) return
      lastFrameAt = now
      if (disabledRef.current || document.hidden) {
        publishIdleGesture()
        return
      }

      const result = landmarker.detectForVideo(video, now)
      const gestureState = gestureController.update({
        landmarks: result.landmarks?.[0] || null,
        secondaryLandmarks: result.landmarks?.[1] || null,
        timestamp: now,
      })
      onGestureStateRef.current?.(gestureState)
      if (gestureState.action) onActionRef.current?.(gestureState.action)
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
          runningMode: 'VIDEO', numHands: 2,
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
        publishIdleGesture()
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
      publishIdleGesture()
      onCameraStateChangeRef.current?.('off')
    }
  }, [enabled])

  return null
}
