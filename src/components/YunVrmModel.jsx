/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'

const MODEL_URL = '/models/yun.vrm'
const VALID_EMOTIONS = new Set(['idle', 'happy', 'thinking', 'talking', 'listening'])

function clamp01(value) {
  return Math.max(0, Math.min(1, value))
}

function normalizeEmotion(emotion, isSpeaking, isListening) {
  if (VALID_EMOTIONS.has(emotion)) return emotion
  if (isSpeaking) return 'talking'
  if (isListening) return 'listening'

  return 'idle'
}

export function applyRelaxedPose(vrm) {
  // VRMA files now drive body pose. Keep this no-op so older imports do not
  // apply unsafe handwritten humanoid bone rotations.
  return vrm
}

export function updateIdleMotion(vrm, clock, emotion = 'idle') {
  // VRMA files now drive idle/listening body motion. This intentionally does
  // not touch humanoid bone rotations.
  return { vrm, clock, emotion }
}

function setExpressionValue(vrm, names, value) {
  const weight = clamp01(value)
  const expressionManager = vrm?.expressionManager

  if (expressionManager?.setValue) {
    names.forEach((name) => {
      if (!expressionManager.getExpression || expressionManager.getExpression(name)) {
        expressionManager.setValue(name, weight)
      }
    })
  }

  if (vrm?.blendShapeProxy?.setValue) {
    names.forEach((name) => {
      try {
        vrm.blendShapeProxy.setValue(name, weight)
      } catch {
        // Older VRM models may not expose every preset.
      }
    })
  }
}

export function updateExpression(vrm, clock, emotion = 'idle') {
  const elapsed = clock.elapsedTime
  const mouth = emotion === 'talking'
    ? 0.25 + Math.abs(Math.sin(elapsed * 11.5)) * 0.35
    : 0
  const blink = Math.max(0, Math.sin(elapsed * 1.18) - 0.965) * 28
  const happy = emotion === 'happy'
    ? 0.46
    : emotion === 'talking'
      ? 0.16
      : emotion === 'listening'
        ? 0.08
        : 0
  const lookRight = emotion === 'thinking' ? 0.22 : 0

  setExpressionValue(vrm, ['aa', 'A'], mouth)
  setExpressionValue(vrm, ['happy', 'joy'], happy)
  setExpressionValue(vrm, ['blink'], blink)
  setExpressionValue(vrm, ['lookRight'], lookRight)

  vrm?.expressionManager?.update?.()
}

export default function YunVrmModel({ emotion, isSpeaking = false, isListening = false }) {
  const mountRef = useRef(null)
  const stateRef = useRef({ emotion, isSpeaking, isListening })

  useEffect(() => {
    stateRef.current = { emotion, isSpeaking, isListening }
  }, [emotion, isSpeaking, isListening])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return undefined

    let currentVrm = null
    let animationFrame = 0
    let disposed = false
    let renderer = null
    let camera = null

    async function setupScene() {
      if (disposed) return

      const scene = new THREE.Scene()
      camera = new THREE.PerspectiveCamera(28, mount.clientWidth / mount.clientHeight, 0.1, 40)
      camera.position.set(0, 1.42, 4.2)

      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
      renderer.setSize(mount.clientWidth, mount.clientHeight)
      mount.appendChild(renderer.domElement)

      const keyLight = new THREE.DirectionalLight(0xfff1df, 2.6)
      keyLight.position.set(1.8, 2.5, 3.2)
      scene.add(keyLight)

      const fillLight = new THREE.DirectionalLight(0x9fc7ff, 1.4)
      fillLight.position.set(-2.8, 1.4, 1.6)
      scene.add(fillLight)
      scene.add(new THREE.AmbientLight(0xffffff, 1.8))

      const clock = new THREE.Clock()
      const loader = new GLTFLoader()

      loader.register((parser) => new VRMLoaderPlugin(parser))
      loader.load(
        MODEL_URL,
        (gltf) => {
          if (disposed) return

          const vrm = gltf.userData.vrm
          VRMUtils.removeUnnecessaryVertices(gltf.scene)
          VRMUtils.removeUnnecessaryJoints(gltf.scene)
          VRMUtils.rotateVRM0(vrm)

          currentVrm = vrm
          currentVrm.scene.position.set(-1.3, -0.18, 0)
          currentVrm.scene.rotation.y = -0.13
          currentVrm.scene.scale.setScalar(1.02)
          scene.add(currentVrm.scene)

          applyRelaxedPose(currentVrm)
          updateExpression(currentVrm, clock, normalizeEmotion(stateRef.current.emotion, stateRef.current.isSpeaking, stateRef.current.isListening))
        },
        undefined,
        (error) => {
          console.error('[YunVrmModel] failed to load VRM model:', error)
        },
      )

      const render = () => {
        animationFrame = window.requestAnimationFrame(render)

        const delta = clock.getDelta()
        const currentEmotion = normalizeEmotion(
          stateRef.current.emotion,
          stateRef.current.isSpeaking,
          stateRef.current.isListening,
        )

        if (currentVrm) {
          updateIdleMotion(currentVrm, clock, currentEmotion)
          updateExpression(currentVrm, clock, currentEmotion)
          currentVrm.update(delta)
        }

        renderer.render(scene, camera)
      }

      render()
    }

    setupScene()

    const handleResize = () => {
      const width = Math.max(1, mount.clientWidth)
      const height = Math.max(1, mount.clientHeight)

      if (!camera || !renderer) return

      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }

    window.addEventListener('resize', handleResize)

    return () => {
      disposed = true
      window.cancelAnimationFrame(animationFrame)
      window.removeEventListener('resize', handleResize)
      if (currentVrm && VRMUtils) {
        VRMUtils.deepDispose(currentVrm.scene)
      }
      renderer?.dispose()
      renderer?.domElement.remove()
    }
  }, [])

  return <div className="yun-vrm-model" ref={mountRef} aria-hidden="true" />
}
