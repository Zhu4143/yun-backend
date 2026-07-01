/* eslint-disable react-refresh/only-export-components */
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { Preload } from '@react-three/drei'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import { createVRMAnimationClip, VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation'
import HologramParticles from './HologramParticles'
import { STARDUST_CONFIG } from './stardustConfig'
import { updateExpression } from './YunVrmModel'
import './YunHologramAvatar.css'

const MODEL_URL = '/models/yun-vrm-import.glb'
const DEFAULT_ANIMATION_URL = '/animations/idle.vrma'
const MOTION_OPTIONS = [
  { id: '01', label: '全身', url: '/animations/VRMA_01.vrma' },
  { id: '02', label: '招呼', url: '/animations/VRMA_02.vrma' },
  { id: '03', label: '剪刀', url: '/animations/VRMA_03.vrma' },
  { id: '04', label: '射击', url: '/animations/VRMA_04.vrma' },
  { id: '05', label: '旋转', url: '/animations/VRMA_05.vrma' },
  { id: '06', label: '摆拍', url: '/animations/VRMA_06.vrma' },
  { id: '07', label: '下蹲', url: '/animations/VRMA_07.vrma' },
]
const AVATAR_POSITION_KEY = 'yun_hologram_avatar_offset'
const DEFAULT_AVATAR_OFFSET = { x: 0, y: 0 }
const AVATAR_BASE_POSITION = [-1.22, -0.92, 0]
const AVATAR_BASE_SCALE = 0.82
const DEBUG_PARTICLE_SAMPLING = false
const PARTICLE_ONLY_AVATAR = false

const tempCalibrationBox = new THREE.Box3()
const tempCalibrationSize = new THREE.Vector3()
const tempLeftFoot = new THREE.Vector3()
const tempRightFoot = new THREE.Vector3()

function DebugBox3Helper({ box }) {
  const helper = useMemo(() => {
    const debugBox = new THREE.Box3(
      new THREE.Vector3(...box.min),
      new THREE.Vector3(...box.max),
    )

    return new THREE.Box3Helper(debugBox, new THREE.Color('#ff5b7a'))
  }, [box.max, box.min])

  useEffect(() => () => {
    helper.geometry?.dispose?.()
    helper.material?.dispose?.()
  }, [helper])

  return <primitive object={helper} />
}

function resolveEmotion(emotion) {
  return ['idle', 'happy', 'thinking', 'talking', 'listening'].includes(emotion) ? emotion : 'idle'
}

function getInitialAvatarOffset() {
  try {
    const parsed = JSON.parse(localStorage.getItem(AVATAR_POSITION_KEY) || 'null')

    if (
      parsed
      && Number.isFinite(parsed.x)
      && Number.isFinite(parsed.y)
    ) {
      return {
        x: Math.max(-420, Math.min(420, parsed.x)),
        y: Math.max(-260, Math.min(260, parsed.y)),
      }
    }
  } catch {
    // Ignore broken local drag data and fall back to the default position.
  }

  return DEFAULT_AVATAR_OFFSET
}

function screenOffsetToWorld(offset) {
  return {
    x: offset.x * 0.0047,
    y: offset.y * -0.0047,
  }
}

function createNormalizedGltfRoot(scene) {
  const clonedScene = scene.clone(true)
  const box = new THREE.Box3().setFromObject(scene)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const height = size.y || 1
  const scale = 2.12 / height
  const root = new THREE.Group()

  clonedScene.scale.setScalar(scale)
  clonedScene.position.set(
    -center.x * scale,
    -box.min.y * scale - 1.06,
    -center.z * scale,
  )
  root.add(clonedScene)
  root.updateMatrixWorld(true)
  clonedScene.updateMatrixWorld(true)

  return root
}

function getGhostMaterialOpacity(object, material) {
  const name = `${object?.name || ''} ${object?.parent?.name || ''} ${material?.name || ''}`.toLowerCase()

  if (/shirt|body|torso|chest|blouse/.test(name)) return 0.13
  if (/hair|bang|head|face/.test(name)) return 0.2
  if (/hand|finger|arm|sleeve|shoulder|skirt|dress|leg|shoe|foot/.test(name)) return 0.17

  return 0.15
}

function applyStardustGhostMaterial(object) {
  const materials = Array.isArray(object.material) ? object.material : [object.material]

  materials.forEach((material) => {
    if (!material) return

    material.transparent = true
    material.opacity = getGhostMaterialOpacity(object, material)
    material.depthWrite = false
    material.alphaTest = 0
    material.blending = THREE.NormalBlending

    if ('emissive' in material) {
      material.emissive = material.emissive || new THREE.Color('#7fdcff')
      material.emissive.lerp(new THREE.Color('#9fefff'), 0.36)
      material.emissiveIntensity = 0.045
    }

    material.needsUpdate = true
  })
}

function StardustBloom() {
  const { camera, gl, scene, size } = useThree()
  const composer = useMemo(() => {
    const nextComposer = new EffectComposer(gl)
    const renderPass = new RenderPass(scene, camera)
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.width, size.height),
      STARDUST_CONFIG.bloomStrength,
      STARDUST_CONFIG.bloomRadius,
      STARDUST_CONFIG.bloomThreshold,
    )

    nextComposer.addPass(renderPass)
    nextComposer.addPass(bloomPass)

    return nextComposer
  }, [camera, gl, scene, size.height, size.width])

  useEffect(() => {
    composer.setSize(size.width, size.height)
    composer.setPixelRatio(Math.min(gl.getPixelRatio?.() || window.devicePixelRatio || 1, 1.5))
  }, [composer, gl, size.height, size.width])

  useEffect(() => () => {
    composer.dispose()
  }, [composer])

  useFrame(() => {
    composer.render()
  }, 1)

  return null
}

async function assetExists(url) {
  const response = await fetch(url, { cache: 'no-store' })
  const contentType = response.headers.get('content-type') || ''

  return response.ok && !contentType.includes('text/html')
}

function IdleVrmaAction({ animationUrl, vrm }) {
  const gltf = useLoader(GLTFLoader, animationUrl, (loader) => {
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser))
  })
  const mixerRef = useRef(null)

  useEffect(() => {
    if (!vrm) return undefined

    const vrmAnimation = gltf.userData.vrmAnimations?.[0]

    if (!vrmAnimation) {
      console.warn(`[YunHologramAvatar] ${animationUrl} did not contain a VRM animation`)
      return undefined
    }

    const clip = createVRMAnimationClip(vrmAnimation, vrm)
    const mixer = new THREE.AnimationMixer(vrm.scene)
    const action = mixer.clipAction(clip)

    action.reset()
    action.setLoop(THREE.LoopRepeat, Infinity)
    action.play()
    mixerRef.current = mixer

    return () => {
      action.stop()
      mixer.stopAllAction()
      mixer.uncacheClip(clip)
      mixer.uncacheRoot(vrm.scene)
      mixerRef.current = null
    }
  }, [animationUrl, gltf, vrm])

  useFrame((_, delta) => {
    mixerRef.current?.update(delta)
  })

  return null
}

export const YUN_TERRAIN_ANIMATION_URL = MOTION_OPTIONS[0].url

export function YunVrmScene({
  animationReady,
  animationUrl,
  basePosition = AVATAR_BASE_POSITION,
  baseScale = AVATAR_BASE_SCALE,
  emotion,
  alignToGround = false,
  debug = false,
  footClearance = 0.02,
  groundY = 0,
  hologramEnabled,
  intensity,
  avatarOffset,
  targetHeight,
  rotation = [0, -0.13, 0],
}) {
  const characterRootRef = useRef(null)
  const [debugInfo, setDebugInfo] = useState(null)
  const gltf = useLoader(GLTFLoader, MODEL_URL, (loader) => {
    if (MODEL_URL.toLowerCase().endsWith('.vrm')) {
      loader.register((parser) => new VRMLoaderPlugin(parser))
    }
  })
  const model = useMemo(() => {
    const loadedVrm = gltf.userData.vrm

    if (loadedVrm) {
      VRMUtils.removeUnnecessaryVertices(gltf.scene)
      VRMUtils.removeUnnecessaryJoints(gltf.scene)
      VRMUtils.rotateVRM0(loadedVrm)
    }

    gltf.scene.traverse((object) => {
      if (object.isMesh || object.isSkinnedMesh) {
        applyStardustGhostMaterial(object)
      }
    })

    const normalizedModel = loadedVrm || {
      scene: createNormalizedGltfRoot(gltf.scene),
      update: () => {},
      isPlainGltf: true,
    }

    return normalizedModel
  }, [gltf])
  const currentEmotion = resolveEmotion(emotion)
  const worldOffset = screenOffsetToWorld(avatarOffset)

  useLayoutEffect(() => {
    const characterRoot = characterRootRef.current

    if (!characterRoot || !model?.scene) return

    characterRoot.position.set(
      basePosition[0] + worldOffset.x,
      alignToGround ? basePosition[1] : basePosition[1] + worldOffset.y,
      basePosition[2],
    )
    characterRoot.rotation.set(rotation[0], rotation[1], rotation[2])
    characterRoot.scale.setScalar(1)
    characterRoot.updateMatrixWorld(true)

    tempCalibrationBox.setFromObject(model.scene)
    const rawSize = tempCalibrationBox.getSize(tempCalibrationSize)
    const rawHeight = Math.max(rawSize.y, 0.0001)
    const finalScale = Number.isFinite(targetHeight) && targetHeight > 0
      ? targetHeight / rawHeight
      : baseScale

    characterRoot.scale.setScalar(finalScale)
    characterRoot.updateMatrixWorld(true)

    let lowestFootY
    let footSource = 'box'
    const leftFootNode = model.humanoid?.getNormalizedBoneNode?.('leftFoot')
    const rightFootNode = model.humanoid?.getNormalizedBoneNode?.('rightFoot')

    if (leftFootNode && rightFootNode) {
      leftFootNode.getWorldPosition(tempLeftFoot)
      rightFootNode.getWorldPosition(tempRightFoot)
      lowestFootY = Math.min(tempLeftFoot.y, tempRightFoot.y)
      footSource = 'humanoid'
    } else {
      tempCalibrationBox.setFromObject(model.scene)
      lowestFootY = tempCalibrationBox.min.y
      tempLeftFoot.set(tempCalibrationBox.min.x, lowestFootY, 0)
      tempRightFoot.set(tempCalibrationBox.max.x, lowestFootY, 0)
    }

    if (alignToGround && Number.isFinite(lowestFootY)) {
      characterRoot.position.y += groundY + footClearance - lowestFootY
      characterRoot.updateMatrixWorld(true)
    }

    if (leftFootNode && rightFootNode) {
      leftFootNode.getWorldPosition(tempLeftFoot)
      rightFootNode.getWorldPosition(tempRightFoot)
      lowestFootY = Math.min(tempLeftFoot.y, tempRightFoot.y)
    } else {
      tempCalibrationBox.setFromObject(model.scene)
      lowestFootY = tempCalibrationBox.min.y
      tempLeftFoot.set(tempCalibrationBox.min.x, lowestFootY, tempCalibrationBox.min.z)
      tempRightFoot.set(tempCalibrationBox.max.x, lowestFootY, tempCalibrationBox.min.z)
    }

    tempCalibrationBox.setFromObject(model.scene)
    const finalSize = tempCalibrationBox.getSize(tempCalibrationSize)
    const nextDebugInfo = {
      box: {
        max: tempCalibrationBox.max.toArray(),
        min: tempCalibrationBox.min.toArray(),
      },
      finalHeight: finalSize.y,
      finalScale,
      footSource,
      groundY,
      leftFoot: tempLeftFoot.toArray(),
      leftFootY: tempLeftFoot.y,
      lowestFootY,
      rightFoot: tempRightFoot.toArray(),
      rightFootY: tempRightFoot.y,
    }

    setDebugInfo(nextDebugInfo)
    window.__yunTerrainCalibration = nextDebugInfo
    console.info('[Yun terrain calibration]', nextDebugInfo)
  }, [
    alignToGround,
    basePosition,
    baseScale,
    footClearance,
    groundY,
    model,
    rotation,
    targetHeight,
    worldOffset.x,
    worldOffset.y,
  ])

  useFrame(({ clock }, delta) => {
    if (!model) return

    updateExpression(model, clock, currentEmotion)
    model.update?.(delta)
  })

  if (!model) return null

  return (
    <>
      <group ref={characterRootRef}>
        <primitive object={model.scene} visible={!DEBUG_PARTICLE_SAMPLING && !PARTICLE_ONLY_AVATAR} />
        {!model.isPlainGltf && animationReady && <IdleVrmaAction animationUrl={animationUrl} vrm={model} />}
        {hologramEnabled && (
          <HologramParticles
            debug={DEBUG_PARTICLE_SAMPLING}
            vrm={model}
            enabled={hologramEnabled}
            intensity={intensity}
            splatterStrength={1.15}
          />
        )}
      </group>
      {debug && debugInfo && (
        <>
          <mesh position={debugInfo.leftFoot}>
            <sphereGeometry args={[0.09, 16, 16]} />
            <meshBasicMaterial color="#ff4b68" depthTest={false} />
          </mesh>
          <mesh position={debugInfo.rightFoot}>
            <sphereGeometry args={[0.09, 16, 16]} />
            <meshBasicMaterial color="#5affc8" depthTest={false} />
          </mesh>
          <DebugBox3Helper box={debugInfo.box} />
        </>
      )}
    </>
  )
}

function WaitingModelMessage() {
  return (
    <div className="yun-hologram-avatar__message">
      等待 yun.vrm 模型文件
    </div>
  )
}

function WaitingAnimationMessage() {
  return (
    <div className="yun-hologram-avatar__message yun-hologram-avatar__message--animation">
      等待 idle.vrma 动作文件
    </div>
  )
}

export default function YunHologramAvatar({
  basePosition = AVATAR_BASE_POSITION,
  baseScale = AVATAR_BASE_SCALE,
  bloomEnabled = true,
  camera = { fov: 28, position: [0, 1.42, 4.2], near: 0.1, far: 40 },
  className = '',
  draggable = true,
  visible = true,
  emotion = 'idle',
  hologramEnabled = true,
  intensity = 0.65,
  rotation = [0, -0.13, 0],
  showMotionPicker = true,
}) {
  const [modelStatus, setModelStatus] = useState('checking')
  const [animationStatus, setAnimationStatus] = useState('checking')
  const [selectedMotion, setSelectedMotion] = useState(MOTION_OPTIONS[0])
  const [avatarOffset, setAvatarOffset] = useState(getInitialAvatarOffset)
  const dragRef = useRef(null)
  const avatarOffsetRef = useRef(avatarOffset)

  useEffect(() => {
    avatarOffsetRef.current = avatarOffset
  }, [avatarOffset])

  useEffect(() => {
    let cancelled = false

    assetExists(MODEL_URL)
      .then((exists) => {
        if (!cancelled) {
          setModelStatus(exists ? 'ready' : 'missing')
        }
      })
      .catch(() => {
        if (!cancelled) {
          setModelStatus('missing')
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    assetExists(selectedMotion.url || DEFAULT_ANIMATION_URL)
      .then((exists) => {
        if (!cancelled) {
          setAnimationStatus(exists ? 'ready' : 'missing')
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAnimationStatus('missing')
        }
      })

    return () => {
      cancelled = true
    }
  }, [selectedMotion])

  const handlePointerDown = (event) => {
    if (event.button !== 0 || modelStatus !== 'ready') return

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offset: avatarOffsetRef.current,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const handlePointerMove = (event) => {
    const drag = dragRef.current

    if (!drag || drag.pointerId !== event.pointerId) return

    const nextOffset = {
      x: Math.max(-420, Math.min(420, drag.offset.x + event.clientX - drag.startX)),
      y: Math.max(-260, Math.min(260, drag.offset.y + event.clientY - drag.startY)),
    }

    setAvatarOffset(nextOffset)
    avatarOffsetRef.current = nextOffset
  }

  const finishDrag = (event) => {
    const drag = dragRef.current

    if (!drag || drag.pointerId !== event.pointerId) return

    dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    localStorage.setItem(AVATAR_POSITION_KEY, JSON.stringify(avatarOffsetRef.current))
  }

  const resetAvatarOffset = () => {
    setAvatarOffset(DEFAULT_AVATAR_OFFSET)
    avatarOffsetRef.current = DEFAULT_AVATAR_OFFSET
    localStorage.removeItem(AVATAR_POSITION_KEY)
  }

  if (!visible) return null

  return (
    <div
      className={`yun-hologram-avatar${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      style={{
        '--avatar-drag-x': `${avatarOffset.x}px`,
        '--avatar-drag-y': `${avatarOffset.y}px`,
      }}
    >
      {modelStatus !== 'ready' ? (
        <WaitingModelMessage />
      ) : (
        <>
          {animationStatus === 'missing' && <WaitingAnimationMessage />}
          {showMotionPicker && (
            <div className="yun-motion-picker" onPointerDown={(event) => event.stopPropagation()}>
              {MOTION_OPTIONS.map((motion) => (
                <button
                  type="button"
                  className={`yun-motion-button${selectedMotion.id === motion.id ? ' is-active' : ''}`}
                  key={motion.id}
                  onClick={() => setSelectedMotion(motion)}
                >
                  {motion.label}
                </button>
              ))}
            </div>
          )}
          {draggable && (
            <div
              className="yun-avatar-drag-surface"
              onDoubleClick={resetAvatarOffset}
              onPointerCancel={finishDrag}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={finishDrag}
            />
          )}
          <Canvas
            camera={camera}
            dpr={[1, 1.5]}
            gl={{ alpha: true, antialias: true, premultipliedAlpha: false }}
          >
            <ambientLight intensity={0.58} />
            <directionalLight color="#fff1df" intensity={0.86} position={[1.8, 2.5, 3.2]} />
            <directionalLight color="#8bdcff" intensity={0.48} position={[-2.4, 1.6, 1.8]} />
            <directionalLight color="#c7a5ff" intensity={0.24} position={[0.8, 1.9, -2.1]} />
            {bloomEnabled && !DEBUG_PARTICLE_SAMPLING && <StardustBloom />}
            <Suspense fallback={null}>
              <YunVrmScene
                animationReady={animationStatus === 'ready'}
                animationUrl={selectedMotion.url || DEFAULT_ANIMATION_URL}
                avatarOffset={avatarOffset}
                basePosition={basePosition}
                baseScale={baseScale}
                emotion={emotion}
                hologramEnabled={hologramEnabled}
                intensity={intensity}
                rotation={rotation}
              />
              <Preload all />
            </Suspense>
          </Canvas>
        </>
      )}
    </div>
  )
}
