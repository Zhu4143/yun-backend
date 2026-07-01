import { Canvas, extend, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Preload } from '@react-three/drei'
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { MapShaderMaterial } from './SonicMapShaderMaterial'
import { YUN_TERRAIN_ANIMATION_URL, YunVrmScene } from './YunHologramAvatar'
import './SonicTopographyBackground.css'

extend({ MapShaderMaterial })

const sonicTheme = {
  uBaseColor1: new THREE.Color(0.01, 0.02, 0.04),
  uBaseColor2: new THREE.Color(0.03, 0.05, 0.09),
  uCoolCore: new THREE.Color(0.0, 0.3, 1.0),
  uCoolEdge: new THREE.Color(0.6, 0.2, 1.0),
  uWarmCore: new THREE.Color(1.0, 0.2, 0.1),
  uWarmEdge: new THREE.Color(1.0, 0.6, 0.0),
  uRippleColor: new THREE.Color(0.2, 0.9, 1.0),
  uGlowIntensity: 1.0,
}

const GROUND_TOP_Y = 1.0
const TARGET_CHARACTER_HEIGHT = 6.0
const CHARACTER_PLATFORM_RADIUS = 4.5
const FOOT_CLEARANCE = 0.02
const SHOW_TERRAIN_DEBUG = false
const CAMERA_POSITION = [0, 4.8, 12]
const CAMERA_TARGET = [0, 2.7, 0]
const CAMERA_FOV = 38

const emptyAudioData = {
  bass: 0,
  mid: 0,
  treble: 0,
  energy: 0,
  subBass: 0,
  lowMid: 0,
  highMid: 0,
  presence: 0,
  brilliance: 0,
  air: 0,
  warmth: 0,
  brightness: 0,
  sharpness: 0,
  smoothness: 0.68,
  density: 0,
  spectralCentroid: 0,
}

function makeAudioSampler(getFrequencyData, active) {
  const prevData = new Array(512).fill(0)
  const smoothed = { ...emptyAudioData }
  let prevBrightness = 0
  let fluxHistoryIndex = 0
  const fluxHistory = new Array(40).fill(0)
  let smoothedFlux = 0
  let prevSmoothedFlux = 0
  let beatHold = 0
  let meteorHold = 0

  const average = (sum, count) => (count > 0 ? sum / count : 0)

  return {
    read() {
      const raw = active && typeof getFrequencyData === 'function' ? getFrequencyData() : null
      const dataArray = raw?.length ? raw : null
      let energySum = 0
      let centroidNum = 0
      let centroidDen = 0
      let subBassSum = 0
      let bassSum = 0
      let lowMidSum = 0
      let midSum = 0
      let highMidSum = 0
      let presenceSum = 0
      let brillianceSum = 0
      let airSum = 0
      let jumpVolatilitySum = 0
      let fluxPulse = 0
      let fluxMeteor = 0
      const binCount = Math.max(512, dataArray?.length || 0)

      for (let index = 0; index < binCount; index += 1) {
        const value = dataArray ? (dataArray[index] || 0) / 255 : 0
        const previous = prevData[index] || 0
        energySum += value
        centroidNum += index * value
        centroidDen += value
        jumpVolatilitySum += Math.abs(value - previous)

        if (index <= 16) {
          const diff = value - previous
          if (diff > 0) fluxPulse += diff
        }

        if (index >= 159 && index <= 174) {
          const diff = value - previous
          if (diff > 0) fluxMeteor += diff
        }

        prevData[index] = value

        if (index <= 1) subBassSum += value
        else if (index <= 3) bassSum += value
        else if (index <= 7) lowMidSum += value
        else if (index <= 18) midSum += value
        else if (index <= 46) highMidSum += value
        else if (index <= 93) presenceSum += value
        else if (index <= 186) brillianceSum += value
        else if (index <= 372) airSum += value
      }

      const energy = energySum / binCount
      const subBass = average(subBassSum, 2)
      const bass = average(bassSum, 2)
      const lowMid = average(lowMidSum, 4)
      const mid = average(midSum, 11)
      const highMid = average(highMidSum, 28)
      const presence = average(presenceSum, 47)
      const brilliance = average(brillianceSum, 93)
      const air = average(airSum, 186)
      const oldBass = average(subBassSum + bassSum + lowMidSum, 8)
      const oldMid = average(midSum + highMidSum, 39)
      const oldTreble = average(presenceSum + brillianceSum + airSum, 326)
      const warmth = energySum > 0 ? (subBassSum + bassSum + lowMidSum + midSum) / energySum : 0
      const brightness = energySum > 0 ? (presenceSum + brillianceSum + airSum) / energySum : 0
      const sharpness = Math.max(0, brightness - prevBrightness) * 10
      const smoothness = Math.max(0, 1 - (jumpVolatilitySum / binCount) * 2)
      const activeThreshold = energy * 1.5
      const density = [
        subBass,
        bass,
        lowMid,
        mid,
        highMid,
        presence,
        brilliance,
        air,
      ].filter((band) => band > activeThreshold).length / 8
      const spectralCentroid = centroidDen > 0 ? centroidNum / centroidDen : 0
      const smoothing = dataArray ? 0.15 : 0.045

      prevBrightness = brightness

      smoothed.bass += (oldBass - smoothed.bass) * smoothing
      smoothed.mid += (oldMid - smoothed.mid) * smoothing
      smoothed.treble += (oldTreble - smoothed.treble) * smoothing
      smoothed.energy += (energy - smoothed.energy) * smoothing
      smoothed.subBass += (subBass - smoothed.subBass) * smoothing
      smoothed.lowMid += (lowMid - smoothed.lowMid) * smoothing
      smoothed.highMid += (highMid - smoothed.highMid) * smoothing
      smoothed.presence += (presence - smoothed.presence) * smoothing
      smoothed.brilliance += (brilliance - smoothed.brilliance) * smoothing
      smoothed.air += (air - smoothed.air) * smoothing
      smoothed.warmth += (warmth - smoothed.warmth) * smoothing
      smoothed.brightness += (brightness - smoothed.brightness) * smoothing
      smoothed.sharpness += (sharpness - smoothed.sharpness) * smoothing
      smoothed.smoothness += (smoothness - smoothed.smoothness) * smoothing
      smoothed.density += (density - smoothed.density) * smoothing
      smoothed.spectralCentroid += (spectralCentroid - smoothed.spectralCentroid) * smoothing

      smoothedFlux += (fluxPulse - smoothedFlux) * 0.4
      fluxHistory[fluxHistoryIndex] = smoothedFlux
      fluxHistoryIndex = (fluxHistoryIndex + 1) % fluxHistory.length
      const avgFlux = fluxHistory.reduce((sum, value) => sum + value, 0) / fluxHistory.length
      const variance = fluxHistory.reduce((sum, value) => sum + (value - avgFlux) ** 2, 0) / fluxHistory.length
      const threshold = Math.max(0.05, avgFlux + Math.sqrt(variance) * 4.4)
      const pulseStrength = beatHold <= 0 && prevSmoothedFlux > threshold && prevSmoothedFlux >= smoothedFlux
        ? prevSmoothedFlux * 0.6
        : 0
      prevSmoothedFlux = smoothedFlux
      beatHold = pulseStrength > 0 ? 28 : Math.max(0, beatHold - 1)

      const meteorStrength = meteorHold <= 0 && fluxMeteor > 0.45 ? fluxMeteor * 0.5 : 0
      meteorHold = meteorStrength > 0 ? 120 : Math.max(0, meteorHold - 1)

      return {
        audioData: { ...smoothed },
        pulseStrength,
        meteorStrength,
      }
    },
  }
}

function SonicMapScene({ active, emotion, getFrequencyData, showCharacter = false }) {
  const meshRef = useRef(null)
  const materialRef = useRef(null)
  const fogRef = useRef(null)
  const meteorMeshRef = useRef(null)
  const meteorMatRef = useRef(null)
  const particleMeshRef = useRef(null)
  const particleMatRef = useRef(null)
  const samplerRef = useRef(null)
  const terrainReadyRef = useRef(false)
  const { clock } = useThree()
  const gridSize = 160
  const spacing = 1.05
  const count = gridSize * gridSize
  const MAX_METEORS = 20
  const MAX_PARTICLES = 200
  const dummyMatrix = useMemo(() => new THREE.Matrix4(), [])
  const dummyPosition = useMemo(() => new THREE.Vector3(), [])
  const dummyRotation = useMemo(() => new THREE.Quaternion(), [])
  const dummyScale = useMemo(() => new THREE.Vector3(), [])
  const ripplesRef = useRef(new Array(10).fill(null).map(() => ({
    pos: new THREE.Vector2(),
    time: -100,
    strength: 0,
    isActive: 0,
    rippleType: 0,
  })))
  const rippleIndex = useRef(0)
  const meteorsRef = useRef(new Array(MAX_METEORS).fill(null).map(() => ({
    active: false,
    x: 0,
    y: -1000,
    z: 0,
    speed: 0,
    strength: 0,
  })))
  const meteorIndex = useRef(0)
  const lastMeteorSpawnTime = useRef(-Infinity)
  const particlesRef = useRef(new Array(MAX_PARTICLES).fill(null).map(() => ({
    active: false,
    x: 0,
    y: -1000,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 0,
    maxLife: 1,
    scale: 1,
  })))
  const particleIndex = useRef(0)
  const [pressTime, setPressTime] = useState(0)

  useEffect(() => {
    samplerRef.current = makeAudioSampler(getFrequencyData, active)
  }, [active, getFrequencyData])

  useLayoutEffect(() => {
    if (!meshRef.current) return
    const tempMatrix = new THREE.Matrix4()
    const offset = (gridSize * spacing) / 2
    let index = 0

    for (let x = 0; x < gridSize; x += 1) {
      for (let z = 0; z < gridSize; z += 1) {
        tempMatrix.makeTranslation(x * spacing - offset, 0.5, z * spacing - offset)
        meshRef.current.setMatrixAt(index, tempMatrix)
        index += 1
      }
    }

    meshRef.current.instanceMatrix.needsUpdate = true
    meshRef.current.computeBoundingBox?.()
    meshRef.current.computeBoundingSphere?.()
    terrainReadyRef.current = true
  }, [])

  const addRipple = (x, z, strength, isWhite = false) => {
    const index = rippleIndex.current
    ripplesRef.current[index] = {
      pos: new THREE.Vector2(x, z),
      time: clock.getElapsedTime(),
      strength,
      isActive: 1,
      rippleType: isWhite ? 1 : 0,
    }
    rippleIndex.current = (index + 1) % ripplesRef.current.length
  }

  const addMeteor = (strength) => {
    const now = clock.getElapsedTime()
    if (now - lastMeteorSpawnTime.current < 1.2) return
    lastMeteorSpawnTime.current = now

    const index = meteorIndex.current
    const angle = Math.random() * Math.PI * 2
    const dist = Math.random() * 25
    const meteor = meteorsRef.current[index]

    meteor.active = true
    meteor.x = Math.cos(angle) * dist
    meteor.z = Math.sin(angle) * dist
    meteor.y = 30 + Math.random() * 10
    meteor.speed = 1 + Math.random() * 0.5 + strength * 1.5
    meteor.strength = strength
    meteorIndex.current = (index + 1) % meteorsRef.current.length
  }

  const spawnParticle = (x, y, z, speedMultiplier) => {
    const index = particleIndex.current
    const particle = particlesRef.current[index]
    particle.active = true
    particle.x = x + (Math.random() - 0.5) * 1.5
    particle.y = y + (Math.random() - 0.5) * 1.5
    particle.z = z + (Math.random() - 0.5) * 1.5
    particle.vx = (Math.random() - 0.5) * 2
    particle.vy = Math.random() * 2 + speedMultiplier * 10
    particle.vz = (Math.random() - 0.5) * 2
    particle.life = 0
    particle.maxLife = 0.5 + Math.random() * 0.5
    particle.scale = Math.random() * 0.6 + 0.2
    particleIndex.current = (index + 1) % particlesRef.current.length
  }

  useFrame((state, delta) => {
    if (!materialRef.current || !samplerRef.current) return
    if (!terrainReadyRef.current && meshRef.current) {
      meshRef.current.instanceMatrix.needsUpdate = true
      meshRef.current.computeBoundingBox?.()
      meshRef.current.computeBoundingSphere?.()
      terrainReadyRef.current = true
    }
    const material = materialRef.current
    const { audioData, pulseStrength, meteorStrength } = samplerRef.current.read()
    const lerpSpeed = 3 * delta

    material.uBaseColor1.lerp(sonicTheme.uBaseColor1, lerpSpeed)
    material.uBaseColor2.lerp(sonicTheme.uBaseColor2, lerpSpeed)
    material.uCoolCore.lerp(sonicTheme.uCoolCore, lerpSpeed)
    material.uCoolEdge.lerp(sonicTheme.uCoolEdge, lerpSpeed)
    material.uWarmCore.lerp(sonicTheme.uWarmCore, lerpSpeed)
    material.uWarmEdge.lerp(sonicTheme.uWarmEdge, lerpSpeed)
    material.uRippleColor.lerp(sonicTheme.uRippleColor, lerpSpeed)
    material.uGlowIntensity = THREE.MathUtils.lerp(material.uGlowIntensity, sonicTheme.uGlowIntensity, lerpSpeed)

    if (fogRef.current) {
      fogRef.current.color.lerp(sonicTheme.uBaseColor1, lerpSpeed)
    }

    material.uTime = state.clock.getElapsedTime()
    material.uBass = audioData.bass
    material.uMid = audioData.mid
    material.uTreble = audioData.treble
    material.uEnergy = audioData.energy
    material.uSubBass = audioData.subBass
    material.uLowMid = audioData.lowMid
    material.uHighMid = audioData.highMid
    material.uPresence = audioData.presence
    material.uBrilliance = audioData.brilliance
    material.uAir = audioData.air
    material.uWarmth = audioData.warmth
    material.uBrightness = audioData.brightness
    material.uSharpness = audioData.sharpness
    material.uSmoothness = audioData.smoothness
    material.uDensity = audioData.density
    material.uSpectralCentroid = audioData.spectralCentroid
    material.uCoreRadius = CHARACTER_PLATFORM_RADIUS
    material.uCoreResponse = 0.035
    material.uRipples = ripplesRef.current

    if (pulseStrength > 0) {
      const angle = Math.random() * Math.PI * 2
      const dist = Math.random() * 25
      addRipple(Math.cos(angle) * dist, Math.sin(angle) * dist, Math.min(pulseStrength * 3, 4))
    }

    if (meteorStrength > 0) {
      addMeteor(meteorStrength)
    }

    if (meteorMeshRef.current) {
      if (meteorMatRef.current) {
        const meteorColor = new THREE.Color().copy(sonicTheme.uWarmCore).lerp(new THREE.Color(0xffffff), 0.7)
        meteorMatRef.current.color.lerp(meteorColor, lerpSpeed)
      }

      meteorsRef.current.forEach((meteor, index) => {
        if (!meteor.active) {
          dummyPosition.set(0, -1000, 0)
          dummyScale.set(0, 0, 0)
        } else {
          meteor.y -= meteor.speed * 60 * delta
          if (meteor.y <= 0) {
            meteor.active = false
            addRipple(meteor.x, meteor.z, Math.min(meteor.strength, 1.2), true)
            for (let particle = 0; particle < 10; particle += 1) {
              spawnParticle(meteor.x, 0.5, meteor.z, meteor.speed * 1.5)
            }
          }
          dummyPosition.set(meteor.x, Math.max(0, meteor.y), meteor.z)
          dummyScale.set(1.5, 1.5, 1.5)
        }

        dummyMatrix.compose(dummyPosition, dummyRotation, dummyScale)
        meteorMeshRef.current.setMatrixAt(index, dummyMatrix)

        if (meteor.active && meteor.y > 0 && Math.random() > 0.3) {
          spawnParticle(meteor.x, meteor.y, meteor.z, meteor.speed * 0.2)
        }
      })

      meteorMeshRef.current.instanceMatrix.needsUpdate = true
    }

    if (particleMeshRef.current) {
      if (particleMatRef.current) {
        particleMatRef.current.color.copy(meteorMatRef.current ? meteorMatRef.current.color : new THREE.Color(0xffffff))
      }

      particlesRef.current.forEach((particle, index) => {
        if (!particle.active) {
          dummyPosition.set(0, -1000, 0)
          dummyScale.set(0, 0, 0)
        } else {
          particle.life += delta
          if (particle.life >= particle.maxLife) {
            particle.active = false
            dummyScale.set(0, 0, 0)
          } else {
            particle.x += particle.vx * delta * 10
            particle.y += particle.vy * delta * 10
            particle.z += particle.vz * delta * 10
            const scale = particle.scale * (1 - particle.life / particle.maxLife)
            dummyPosition.set(particle.x, particle.y, particle.z)
            dummyScale.set(scale, scale, scale)
          }
        }

        dummyMatrix.compose(dummyPosition, dummyRotation, dummyScale)
        particleMeshRef.current.setMatrixAt(index, dummyMatrix)
      })

      particleMeshRef.current.instanceMatrix.needsUpdate = true
    }
  })

  const handlePointerDown = (event) => {
    if (event.button !== 0) return
    setPressTime(performance.now())
  }

  const handlePointerUp = (event) => {
    if (event.button !== 0) return
    const duration = performance.now() - pressTime
    addRipple(event.point.x, event.point.z, Math.min(0.2 + (duration / 1000) * 2.8, 3))
  }

  return (
    <>
      <fog ref={fogRef} attach="fog" args={[`#${sonicTheme.uBaseColor1.getHexString()}`, 30, 95]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 20, 10]} intensity={1} />
      <directionalLight color="#8bdcff" intensity={0.45} position={[-8, 8, 5]} />
      <directionalLight color="#c7a5ff" intensity={0.25} position={[4, 8, -8]} />
      <OrbitControls
        makeDefault
        autoRotate={false}
        enablePan={false}
        minDistance={6}
        maxDistance={26}
        maxPolarAngle={Math.PI / 2 - 0.08}
        target={CAMERA_TARGET}
      />
      {SHOW_TERRAIN_DEBUG && (
        <>
          <axesHelper args={[4]} />
          <mesh position={[0, GROUND_TOP_Y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[CHARACTER_PLATFORM_RADIUS, 64]} />
            <meshBasicMaterial color="#33e7ff" opacity={0.2} side={THREE.DoubleSide} transparent />
          </mesh>
        </>
      )}
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, count]}
        frustumCulled={false}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        <boxGeometry args={[0.9, 1, 0.9]} />
        <mapShaderMaterial ref={materialRef} transparent />
      </instancedMesh>
      <instancedMesh ref={meteorMeshRef} args={[undefined, undefined, MAX_METEORS]} frustumCulled={false}>
        <boxGeometry args={[0.4, 1.2, 0.4]} />
        <meshBasicMaterial ref={meteorMatRef} color="#ffffff" toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={particleMeshRef} args={[undefined, undefined, MAX_PARTICLES]} frustumCulled={false}>
        <boxGeometry args={[0.8, 0.8, 0.8]} />
        <meshBasicMaterial ref={particleMatRef} color="#ffffff" toneMapped={false} transparent opacity={0.6} />
      </instancedMesh>
      {showCharacter && (
        <Suspense fallback={null}>
          <YunVrmScene
            alignToGround
            animationReady={true}
            animationUrl={YUN_TERRAIN_ANIMATION_URL}
            avatarOffset={{ x: 0, y: 0 }}
            basePosition={[0, 0, 0]}
            emotion={emotion}
            footClearance={FOOT_CLEARANCE}
            groundY={GROUND_TOP_Y}
            hologramEnabled
            intensity={0.72}
            targetHeight={TARGET_CHARACTER_HEIGHT}
            debug={SHOW_TERRAIN_DEBUG}
            rotation={[0, -Math.PI / 4, 0]}
          />
          <Preload all />
        </Suspense>
      )}
    </>
  )
}

function SonicTopographyBackground({
  active = false,
  emotion = 'idle',
  getFrequencyData,
  showCharacter = false,
}) {
  return (
    <div className="sonic-topography-background" aria-hidden="true">
      <Canvas camera={{ position: CAMERA_POSITION, fov: CAMERA_FOV }} dpr={[1, 1.35]}>
        <SonicMapScene
          active={active}
          emotion={emotion}
          getFrequencyData={getFrequencyData}
          showCharacter={showCharacter}
        />
      </Canvas>
    </div>
  )
}

export default SonicTopographyBackground
