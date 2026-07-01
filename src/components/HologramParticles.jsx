import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { STARDUST_CONFIG } from './stardustConfig'

const SURFACE_COUNT = Math.round(STARDUST_CONFIG.particleCount * STARDUST_CONFIG.innerDensity)
const RIM_COUNT = Math.round(STARDUST_CONFIG.particleCount * STARDUST_CONFIG.coreDensity)
const GLINT_COUNT = Math.round(STARDUST_CONFIG.particleCount * 0.05)
const SPLATTER_COUNT = Math.round(STARDUST_CONFIG.particleCount * STARDUST_CONFIG.scatterAmount)
const FEATURE_COUNT = Math.round(STARDUST_CONFIG.particleCount * STARDUST_CONFIG.featureDensity)
const FACE_FEATURE_COUNT = Math.round(STARDUST_CONFIG.particleCount * STARDUST_CONFIG.faceFeatureDensity)

const SURFACE_OPACITY = 0.26
const RIM_OPACITY = 0.78
const GLINT_OPACITY = 0.96
const SPLATTER_OPACITY = 0.48
const FEATURE_OPACITY = 0.92
const FACE_FEATURE_OPACITY = 0.72

const SURFACE_OUTWARD_OFFSET = 0.002
const RIM_OUTWARD_OFFSET = 0.012
const SPLATTER_OUTWARD_OFFSET = STARDUST_CONFIG.scatterDistance
const FLICKER_STRENGTH = 0.3

const COLOR_STOPS = [
  new THREE.Color('#f7fcff'),
  new THREE.Color('#d9f6ff'),
  new THREE.Color('#aee9ff'),
  new THREE.Color('#8dcaff'),
  new THREE.Color('#c8fff5'),
]

const tempVertex = new THREE.Vector3()
const tempNormal = new THREE.Vector3()
const tempRootLocal = new THREE.Vector3()
const tempRootInverse = new THREE.Matrix4()
const tempA = new THREE.Vector3()
const tempB = new THREE.Vector3()
const tempC = new THREE.Vector3()
const tempAB = new THREE.Vector3()
const tempAC = new THREE.Vector3()
const tempCameraLocal = new THREE.Vector3()
const tempViewDirection = new THREE.Vector3()

function clamp01(value) {
  return Math.max(0, Math.min(1, value))
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min)
}

function classifyBodyPart(point) {
  const absX = Math.abs(point.x)

  if (point.y <= -1.04) return 'shoes'
  if (point.y < -0.18) return 'legs'
  if (point.y > -0.16 && point.y < 0.2 && absX < 0.46) return 'waist'
  if (point.y > -0.22 && point.y < 0.58 && absX > 0.32) return 'arms'
  if (point.y > 0.72 && absX < 0.28) return 'face'
  if (point.y > 0.8) return 'hair'
  if (point.y > 0.62) return 'head'
  if (point.y > -0.12 && point.y < 0.74) return 'torso'

  return 'torso'
}

function makeBudgetTracker(count, mode) {
  const budgets = STARDUST_CONFIG.bodyPartBudgets || {}
  const targets = {}
  const accepted = {}

  Object.entries(budgets).forEach(([part, ratio]) => {
    let modeScale = 1

    if (mode === 'faceFeature') modeScale = part === 'face' || part === 'hair' ? 1.6 : 0.08
    else if (mode === 'feature') modeScale = ['face', 'hair', 'arms', 'legs', 'shoes'].includes(part) ? 1.25 : 0.45
    else if (mode === 'splatter') modeScale = ['legs', 'face', 'shoes'].includes(part) ? 0.4 : 0.22
    else if (mode === 'surface') modeScale = ['torso', 'legs', 'arms'].includes(part) ? 1.1 : 0.55

    targets[part] = Math.max(0, Math.floor(count * ratio * modeScale))
    accepted[part] = 0
  })

  return { accepted, targets }
}

function budgetAcceptanceMultiplier(part, tracker) {
  const target = tracker.targets[part] || 0
  const accepted = tracker.accepted[part] || 0

  if (!target) return 0.42
  if (accepted < target) return 2.8
  if (accepted < target * 1.35) return 0.72

  return 0.18
}

function shouldSkipParticleMesh(object) {
  const objectName = `${object.name || ''} ${object.parent?.name || ''}`.toLowerCase()
  const materials = Array.isArray(object.material) ? object.material : [object.material]
  const materialName = materials
    .map((material) => material?.name || '')
    .join(' ')
    .toLowerCase()
  const name = `${objectName} ${materialName}`

  return /eye|iris|pupil|lash|tear|mouth|tooth|tongue/.test(name)
}

function getMeshHintWeight(object) {
  const name = `${object.name || ''} ${object.parent?.name || ''}`.toLowerCase()

  if (/hair|bang|head/.test(name)) return 3.5
  if (/hand|finger|sleeve|arm|shoulder|skirt|dress|shoe|foot|leg|sock|cloth|jacket/.test(name)) return 3
  if (/face|neck/.test(name)) return 1.8
  if (/shirt|body|torso|chest/.test(name)) return 0.45

  return 1
}

function collectMeshSources(vrm) {
  const root = vrm?.scene
  const sources = []

  if (!root) return sources

  root.updateMatrixWorld(true)
  root.traverse((object) => {
    const position = object.geometry?.attributes?.position

    if (position?.count && !shouldSkipParticleMesh(object)) {
      const source = buildMeshSource(object)

      if (!source) return

      sources.push({
        ...source,
        mesh: object,
        hintWeight: getMeshHintWeight(object),
      })
    }
  })

  return sources
}

function getTriangleVertexIndex(source, triangleIndex, corner) {
  const geometryIndex = source.mesh.geometry.index
  const vertexOffset = triangleIndex * 3 + corner

  return geometryIndex ? geometryIndex.getX(vertexOffset) : vertexOffset
}

function getTriangleArea(source, triangleIndex) {
  const position = source.mesh.geometry.attributes.position
  const a = getTriangleVertexIndex(source, triangleIndex, 0)
  const b = getTriangleVertexIndex(source, triangleIndex, 1)
  const c = getTriangleVertexIndex(source, triangleIndex, 2)

  tempA.fromBufferAttribute(position, a)
  tempB.fromBufferAttribute(position, b)
  tempC.fromBufferAttribute(position, c)
  tempAB.subVectors(tempB, tempA)
  tempAC.subVectors(tempC, tempA)

  return tempAB.cross(tempAC).length() * 0.5
}

function buildMeshSource(mesh) {
  const position = mesh.geometry?.attributes?.position

  if (!position?.count) return null

  const triangleCount = mesh.geometry.index
    ? Math.floor(mesh.geometry.index.count / 3)
    : Math.floor(position.count / 3)
  const cumulativeAreas = new Float32Array(triangleCount)
  const source = { mesh, triangleCount }
  let totalArea = 0

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const area = getTriangleArea(source, triangleIndex)

    totalArea += Number.isFinite(area) ? area : 0
    cumulativeAreas[triangleIndex] = totalArea
  }

  if (totalArea <= 0) return null

  return { cumulativeAreas, totalArea, triangleCount }
}

function pickSource(sources, mode = 'surface') {
  const totalWeight = sources.reduce((sum, source) => {
    const hint = mode === 'surface'
      ? Math.max(0.25, Math.sqrt(source.hintWeight))
      : source.hintWeight

    return sum + source.totalArea * hint
  }, 0)
  let cursor = Math.random() * totalWeight

  for (const source of sources) {
    const hint = mode === 'surface'
      ? Math.max(0.25, Math.sqrt(source.hintWeight))
      : source.hintWeight

    cursor -= source.totalArea * hint
    if (cursor <= 0) return source
  }

  return sources[sources.length - 1]
}

function pickTriangleIndex(source) {
  const targetArea = Math.random() * source.totalArea
  let low = 0
  let high = source.cumulativeAreas.length - 1

  while (low < high) {
    const mid = Math.floor((low + high) / 2)

    if (targetArea <= source.cumulativeAreas[mid]) high = mid
    else low = mid + 1
  }

  return low
}

function randomBarycentric(target) {
  let u = Math.random()
  let v = Math.random()

  if (u + v > 1) {
    u = 1 - u
    v = 1 - v
  }

  target.set(1 - u - v, u, v)
  return target
}

function readSkinnedVertex(mesh, vertexIndex, target) {
  target.fromBufferAttribute(mesh.geometry.attributes.position, vertexIndex)

  if (mesh.isSkinnedMesh && typeof mesh.applyBoneTransform === 'function') {
    mesh.applyBoneTransform(vertexIndex, target)
  }

  target.applyMatrix4(mesh.matrixWorld)
  return target
}

function readParticleSurface(root, sample, target, normalTarget) {
  const { barycentric, mesh, triangleIndex } = sample
  const a = getTriangleVertexIndex(sample.source, triangleIndex, 0)
  const b = getTriangleVertexIndex(sample.source, triangleIndex, 1)
  const c = getTriangleVertexIndex(sample.source, triangleIndex, 2)

  readSkinnedVertex(mesh, a, tempA)
  readSkinnedVertex(mesh, b, tempB)
  readSkinnedVertex(mesh, c, tempC)

  tempAB.subVectors(tempB, tempA)
  tempAC.subVectors(tempC, tempA)
  normalTarget.crossVectors(tempAB, tempAC).normalize()

  target
    .copy(tempA)
    .multiplyScalar(barycentric.x)
    .addScaledVector(tempB, barycentric.y)
    .addScaledVector(tempC, barycentric.z)

  tempRootInverse.copy(root.matrixWorld).invert()
  target.applyMatrix4(tempRootInverse)
  normalTarget.transformDirection(tempRootInverse).normalize()
}

function rimScore(point, normal, source) {
  const horizontalEdge = Math.min(1, Math.abs(point.x) / 0.36)
  const fresnelLike = 1 - Math.min(1, Math.abs(normal.z))
  const headHair = point.y > 0.82 ? 0.46 : 0
  const shoulder = point.y > 0.46 && point.y < 0.85 && Math.abs(point.x) > 0.18 ? 0.35 : 0
  const hands = point.y > -0.22 && point.y < 0.42 && Math.abs(point.x) > 0.34 ? 0.52 : 0
  const waistEdge = point.y > -0.08 && point.y < 0.12 && Math.abs(point.x) > 0.26 ? 0.12 : 0
  const upperLegOuter = point.y > -0.62 && point.y <= -0.16 && Math.abs(point.x) > 0.18 ? 0.2 : 0
  const lowerLegOuter = point.y <= -0.62 && Math.abs(point.x) > 0.12 ? 0.34 : 0
  const hinted = source.hintWeight > 1.5 ? 0.32 : 0

  return horizontalEdge * 0.65 + fresnelLike * 0.82 + headHair + shoulder + hands + waistEdge + upperLegOuter + lowerLegOuter + hinted
}

function bodyRegionWeights(point, normal, source) {
  const absX = Math.abs(point.x)
  const fresnelLike = 1 - Math.min(1, Math.abs(normal.z))
  const headHair = point.y > 0.82
  const hairEdge = point.y > 0.82 && (absX > 0.12 || fresnelLike > 0.48)
  const topHair = point.y > 1.03
  const bangs = point.y > 0.78 && point.y < 1.05 && absX < 0.24
  const hairOverFace = point.y > 0.76 && point.y < 1.04 && absX < 0.18 && point.z > -0.08
  const faceCenter = point.y > 0.82 && absX < 0.16 && point.z > -0.08
  const faceContour = point.y > 0.74 && point.y < 1.08 && absX > 0.12 && absX < 0.3
  const chinLine = point.y > 0.68 && point.y < 0.82 && absX < 0.18
  const eyeLine = point.y > 0.9 && point.y < 1.0 && absX > 0.045 && absX < 0.2
  const noseLine = point.y > 0.82 && point.y < 0.94 && absX < 0.055
  const mouthLine = point.y > 0.76 && point.y < 0.84 && absX < 0.13
  const shoulder = point.y > 0.48 && point.y < 0.84 && absX > 0.18
  const sleeveCuff = point.y > -0.04 && point.y < 0.34 && absX > 0.34
  const handFinger = point.y > -0.3 && point.y < 0.18 && absX > 0.42
  const waistLine = point.y > 0.06 && point.y < 0.23 && absX > 0.12 && absX < 0.34
  const torsoCenter = point.y > 0.16 && point.y < 0.72 && absX < 0.22
  const abdomenCenter = point.y > -0.04 && point.y < 0.26 && absX < 0.22
  const waistInterior = point.y > -0.1 && point.y < 0.18 && absX < 0.27
  const waistEdge = point.y > -0.08 && point.y < 0.08 && absX > 0.22 && absX < 0.36
  const thighInterior = point.y < -0.18 && point.y > -0.58 && absX >= 0.13 && absX < 0.25
  const betweenLegs = point.y < -0.14 && point.y > -1.05 && absX < 0.105
  const thighOuter = point.y < -0.18 && point.y > -0.6 && absX > 0.17
  const calfInterior = point.y <= -0.56 && point.y > -1.14 && absX >= 0.08 && absX < 0.16
  const legOuter = point.y < -0.2 && point.y > -1.08 && absX > 0.17
  const calfOuter = point.y < -0.56 && point.y > -1.16 && absX > 0.12
  const shoeEdge = point.y <= -1.04 && absX > 0.1
  const rimLike = fresnelLike > 0.45 || absX > 0.32 || source.hintWeight > 1.5

  let core = 0.18
  let inner = 0.22
  let scatter = rimLike ? 0.2 : 0.02
  let brightness = 1
  let faceFeature = 0.04
  let feature = 0.08
  let sizeBoost = 1

  if (headHair || shoulder || sleeveCuff || handFinger || calfOuter || shoeEdge) {
    core = STARDUST_CONFIG.rimDensity
    inner = 0.34
    scatter = 0.42
    brightness = 1.16
    feature = STARDUST_CONFIG.featureBoost
    sizeBoost = 1.08
  }

  if (hairEdge || bangs) {
    feature *= STARDUST_CONFIG.hairEdgeBoost
    brightness = Math.max(brightness, 1.24)
    sizeBoost = Math.max(sizeBoost, 1.08)
  }

  if (hairOverFace) {
    core *= 0.35
    inner *= 0.45
    feature *= 0.35
    brightness *= 0.72
  }

  if (topHair) {
    brightness *= 0.74
    feature *= 0.62
    sizeBoost *= 0.86
  }

  if (faceContour) {
    feature *= STARDUST_CONFIG.faceContourBoost
    faceFeature *= STARDUST_CONFIG.faceContourBoost * 2.2
    brightness = Math.max(brightness, 1.18)
  }

  if (chinLine) {
    faceFeature *= STARDUST_CONFIG.chinLineBoost * 2.4
    brightness = Math.max(brightness, 1.2)
  }

  if (eyeLine || noseLine || mouthLine) {
    faceFeature *= eyeLine ? 3.2 : 1.8
    core *= 0.45
    brightness = Math.max(brightness, eyeLine ? 1.12 : 0.92)
    sizeBoost *= 0.78
  }

  if (bangs) {
    faceFeature *= STARDUST_CONFIG.bangsBoost
  }

  if (sleeveCuff || shoulder || waistLine) {
    feature *= 1.8
  }

  if (handFinger) {
    feature *= STARDUST_CONFIG.fingerBoost
    brightness = Math.max(brightness, 1.36)
    sizeBoost = Math.max(sizeBoost, 1.18)
  }

  if (waistEdge) {
    core *= STARDUST_CONFIG.waistEdgeDensity
    feature *= STARDUST_CONFIG.waistEdgeBoost
    scatter *= 0.18
    brightness = Math.max(brightness, 1.02)
    sizeBoost = Math.max(sizeBoost, 1.02)
  }

  if (thighOuter || legOuter || calfOuter) {
    const legBoost = calfOuter ? STARDUST_CONFIG.legOuterBoost : STARDUST_CONFIG.legOuterBoost * 0.72
    core *= STARDUST_CONFIG.legOuterDensity * legBoost
    inner *= 1.25
    feature *= calfOuter ? 2.8 : 1.8
    scatter *= 0.55
    brightness = Math.max(brightness, calfOuter ? 1.22 : 1.08)
  }

  if (thighInterior || calfInterior) {
    inner *= STARDUST_CONFIG.legInnerBoost
    core *= 0.78
    scatter *= 0.22
    brightness *= 0.84
  }

  if (shoeEdge) {
    core *= STARDUST_CONFIG.legOuterBoost
    feature *= STARDUST_CONFIG.shoeBoost
    brightness = Math.max(brightness, 1.34)
    sizeBoost = Math.max(sizeBoost, 1.16)
  }

  if (waistInterior) {
    inner = 0.36
    core *= 0.54
    scatter *= 0.12
  }

  if (torsoCenter || abdomenCenter) {
    inner *= STARDUST_CONFIG.torsoInnerDensity
    core *= 0.3
    feature *= 0.1
    scatter *= 0.08
    brightness *= 0.72
  }

  if (faceCenter) {
    inner *= 0.18
    core *= 0.18
    feature *= 0.08
    scatter *= 0.04
  }

  if (betweenLegs) {
    inner *= STARDUST_CONFIG.legInnerDensity
    core *= STARDUST_CONFIG.legInnerDensity * 0.5
    feature *= 0.03
    scatter *= 0.02
    brightness *= 0.42
    sizeBoost *= 0.74
  }

  return { brightness, core, faceFeature, feature, inner, scatter, sizeBoost }
}

function lowerBodySeparationPenalty(point, mode) {
  const betweenLegs = point.y < -0.14 && point.y > -0.96 && Math.abs(point.x) < 0.16
  const longSkirtBridge = point.y < -0.2 && point.y > -0.72 && Math.abs(point.x) < 0.24
  const belowSkirtInterior = point.y < -0.16 && point.y > -0.58 && Math.abs(point.x) < 0.28

  if (betweenLegs) return mode === 'surface' ? 0.03 : 0.015
  if (longSkirtBridge) return mode === 'splatter' ? 0.04 : 0.1
  if (belowSkirtInterior) return mode === 'surface' ? 0.16 : 0.24

  return 1
}

function clusterScore(point, mode) {
  const verticalBands = 0.55 + Math.abs(Math.sin(point.y * 13.5 + point.x * 4.2)) * 0.45
  const sideSparkle = 0.58 + Math.abs(Math.sin(point.x * 21 + point.y * 3.5)) * 0.42
  const contourBreakup = 0.68 + Math.abs(Math.sin((point.x + point.y) * 17.5)) * 0.32
  const base = verticalBands * sideSparkle * contourBreakup

  if (mode === 'surface') return 0.42 + base * 0.48
  if (mode === 'splatter') return 0.35 + base * 0.45

  return 0.52 + base * 0.6
}

function makeColors(count, boostWhite = false, debug = false) {
  const colors = new Float32Array(count * 3)
  const color = new THREE.Color()

  for (let index = 0; index < count; index += 1) {
    const offset = index * 3

    if (debug) {
      colors[offset] = 1
      colors[offset + 1] = 1
      colors[offset + 2] = 1
      continue
    }

    const first = COLOR_STOPS[Math.floor(Math.random() * COLOR_STOPS.length)]
    const second = COLOR_STOPS[Math.floor(Math.random() * COLOR_STOPS.length)]

    color.copy(first).lerp(second, Math.random() * 0.34)
    if (boostWhite) color.lerp(new THREE.Color('#ffffff'), 0.46 + Math.random() * 0.34)

    colors[offset] = color.r
    colors[offset + 1] = color.g
    colors[offset + 2] = color.b
  }

  return colors
}

function makePixelSizes(count, mode, debug = false) {
  const sizes = new Float32Array(count)

  for (let index = 0; index < count; index += 1) {
    const tier = Math.random()

    if (debug) {
      sizes[index] = 2.8
    } else if (mode === 'faceFeature') {
      if (tier < 0.82) sizes[index] = randomBetween(0.62, 1.05)
      else if (tier < 0.97) sizes[index] = randomBetween(1.08, 1.55)
      else sizes[index] = randomBetween(1.6, 2.1)
    } else if (mode === 'splatter') {
      sizes[index] = tier < 0.9 ? randomBetween(0.45, 1.05) : randomBetween(1.1, 1.7)
    } else if (mode === 'glint') {
      sizes[index] = tier < 0.5 ? randomBetween(1.4, 2.2) : randomBetween(2.2, 3.2)
    } else if (tier < 0.7) {
      sizes[index] = randomBetween(0.35, 0.8)
    } else if (tier < 0.9) {
      sizes[index] = randomBetween(0.8, 1.4)
    } else if (tier < 0.98) {
      sizes[index] = randomBetween(1.4, 2.2)
    } else {
      sizes[index] = randomBetween(2.2, 3.2)
    }
  }

  return sizes
}

function makeAlphas(count, mode, debug = false) {
  const alphas = new Float32Array(count)

  for (let index = 0; index < count; index += 1) {
    if (debug) alphas[index] = 1
    else if (mode === 'faceFeature') alphas[index] = randomBetween(0.36, 0.76)
    else if (mode === 'feature') alphas[index] = randomBetween(0.58, 1)
    else if (mode === 'glint') alphas[index] = randomBetween(0.82, 1)
    else if (mode === 'rim') alphas[index] = randomBetween(0.46, 0.98)
    else if (mode === 'splatter') alphas[index] = randomBetween(0.16, 0.58)
    else alphas[index] = randomBetween(0.08, 0.32)
  }

  return alphas
}

function makeBrightness(count, mode, debug = false) {
  const brightness = new Float32Array(count)

  for (let index = 0; index < count; index += 1) {
    if (debug) brightness[index] = 1
    else if (mode === 'faceFeature') brightness[index] = randomBetween(0.82, 1.45)
    else if (mode === 'feature') brightness[index] = randomBetween(1.15, 2.15)
    else if (mode === 'glint') brightness[index] = randomBetween(1.45, 2.3)
    else if (mode === 'rim') brightness[index] = randomBetween(0.95, 1.8)
    else if (mode === 'splatter') brightness[index] = randomBetween(0.42, 1.05)
    else brightness[index] = randomBetween(0.35, 0.86)
  }

  return brightness
}

function makeTwinkles(count) {
  const twinkles = new Float32Array(count)

  for (let index = 0; index < count; index += 1) {
    twinkles[index] = Math.random() * Math.PI * 2
  }

  return twinkles
}

function makeMeshSamples(vrm, count, mode) {
  const root = vrm?.scene
  const sources = collectMeshSources(vrm)

  if (!root || !sources.length) {
    console.warn('[HologramParticles] Could not sample VRM mesh vertices.')
    return null
  }

  const samples = []
  const positions = []
  const phases = []
  const outward = []
  const brightnessBoosts = []
  const sizeBoosts = []
  const drift = []
  const budgetTracker = makeBudgetTracker(count, mode)
  let guard = 0

  while (samples.length < count && guard < count * 60) {
    guard += 1

    const source = pickSource(sources, mode)
    const barycentric = randomBarycentric(new THREE.Vector3())
    const sample = {
      barycentric,
      mesh: source.mesh,
      normal: new THREE.Vector3(),
      source,
      triangleIndex: pickTriangleIndex(source),
      basePosition: new THREE.Vector3(),
    }

    readParticleSurface(root, sample, tempVertex, tempNormal)
    sample.normal.copy(tempNormal)
    sample.basePosition.copy(tempVertex)

    const rim = rimScore(tempVertex, tempNormal, source)
    const region = bodyRegionWeights(tempVertex, tempNormal, source)
    const bodyPart = classifyBodyPart(tempVertex)
    let acceptance = lowerBodySeparationPenalty(tempVertex, mode) * budgetAcceptanceMultiplier(bodyPart, budgetTracker)

    if (mode === 'surface') {
      acceptance *= (0.08 + Math.min(0.28, rim * 0.08)) * region.inner * clusterScore(tempVertex, mode)
    } else if (mode === 'rim') {
      acceptance *= (rim > 0.9 ? 0.82 : 0.07) * region.core * clusterScore(tempVertex, mode)
    } else if (mode === 'glint') {
      acceptance *= (rim > 1.28 ? 0.52 : 0.012) * region.core * clusterScore(tempVertex, mode)
      if (tempVertex.y > 1.02) acceptance *= STARDUST_CONFIG.headGlintReduce
    } else if (mode === 'feature') {
      acceptance *= (rim > 0.72 ? 0.3 : 0.035) * region.feature * clusterScore(tempVertex, mode)
      if (tempVertex.y <= -0.16 && tempVertex.y > -0.58 && Math.abs(tempVertex.x) < 0.28) acceptance *= 0.08
      if (tempVertex.y < -0.14 && tempVertex.y > -1.05 && Math.abs(tempVertex.x) < 0.15) acceptance *= 0.02
    } else if (mode === 'faceFeature') {
      acceptance *= region.faceFeature * clusterScore(tempVertex, mode)
    } else {
      acceptance *= (rim > 1.0 ? 0.32 : 0.012) * region.scatter * clusterScore(tempVertex, mode)
    }

    if (Math.random() > acceptance) continue

    const baseOutward = mode === 'splatter'
      ? SPLATTER_OUTWARD_OFFSET * randomBetween(0.4, tempVertex.y < -0.16 ? 0.78 : 1.55)
      : mode === 'rim' || mode === 'glint' || mode === 'feature' || mode === 'faceFeature'
        ? RIM_OUTWARD_OFFSET * randomBetween(0.55, 1.6)
        : SURFACE_OUTWARD_OFFSET * randomBetween(0.2, 1.4)

    const isLowerBody = tempVertex.y < -0.14
    const sidePushLimit = mode === 'splatter'
      ? (isLowerBody ? 0.018 : 0.038)
      : (isLowerBody ? 0.004 : 0.01)
    const verticalLift = mode === 'splatter'
      ? randomBetween(isLowerBody ? -0.008 : -0.018, isLowerBody ? 0.014 : 0.035)
      : randomBetween(-0.004, 0.01)
    const sidePush = Math.sign(tempVertex.x || Math.random() - 0.5) * randomBetween(0, sidePushLimit)

    tempRootLocal.copy(tempVertex).addScaledVector(tempNormal, baseOutward)
    positions.push(
      tempRootLocal.x + sidePush,
      tempRootLocal.y + verticalLift,
      tempRootLocal.z + randomBetween(-0.01, 0.01),
    )
    drift.push(sidePush, verticalLift, randomBetween(-0.012, 0.012))
    phases.push(Math.random() * Math.PI * 2)
    outward.push(baseOutward)
    brightnessBoosts.push(region.brightness)
    sizeBoosts.push(region.sizeBoost)
    budgetTracker.accepted[bodyPart] = (budgetTracker.accepted[bodyPart] || 0) + 1
    samples.push(sample)
  }

  if (!samples.length) {
    console.warn(`[HologramParticles] No mesh surface samples accepted for ${mode}.`)
  }

  return {
    count: samples.length,
    brightnessBoosts: new Float32Array(brightnessBoosts),
    drift: new Float32Array(drift),
    outward: new Float32Array(outward),
    phases: new Float32Array(phases),
    positions: new Float32Array(positions),
    root,
    samples,
    sizeBoosts: new Float32Array(sizeBoosts),
  }
}

function createParticleMaterial(opacity, debug = false) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: debug ? THREE.NormalBlending : THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: {
      uDebug: { value: debug ? 1 : 0 },
      uGlowIntensity: { value: STARDUST_CONFIG.glowIntensity },
      uIntensity: { value: 0.65 },
      uOpacity: { value: opacity },
      uPixelRatio: { value: 1 },
      uTime: { value: 0 },
    },
    vertexShader: `
      attribute float particleAlpha;
      attribute float particleBrightness;
      attribute float particleSize;
      attribute float particleTwinkle;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vBrightness;
      varying float vTwinkle;
      uniform float uDebug;
      uniform float uPixelRatio;
      uniform float uTime;

      void main() {
        vColor = color;
        vAlpha = particleAlpha;
        vBrightness = particleBrightness;
        vTwinkle = particleTwinkle;

        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float pulse = uDebug > 0.5 ? 1.0 : 0.86 + sin(uTime * 2.7 + particleTwinkle) * 0.14;
        gl_PointSize = max(0.35, particleSize * uPixelRatio * pulse);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      varying float vBrightness;
      varying float vTwinkle;
      uniform float uDebug;
      uniform float uGlowIntensity;
      uniform float uIntensity;
      uniform float uOpacity;
      uniform float uTime;

      void main() {
        vec2 centered = gl_PointCoord - vec2(0.5);
        float distanceFromCenter = length(centered);
        if (uDebug > 0.5) {
          if (distanceFromCenter > 0.5) discard;
          gl_FragColor = vec4(1.0, 1.0, 1.0, vAlpha * uOpacity * uIntensity);
          return;
        }

        float core = smoothstep(0.28, 0.02, distanceFromCenter);
        float glow = smoothstep(0.5, 0.06, distanceFromCenter);
        float halo = smoothstep(0.5, 0.2, distanceFromCenter) * 0.36;
        float sparkle = 0.82 + sin(uTime * ${STARDUST_CONFIG.sparkleSpeed.toFixed(2)} + vTwinkle) * 0.18;
        float alpha = (core * 0.9 + glow * 0.42 + halo) * vAlpha * uOpacity * uIntensity * sparkle;

        if (distanceFromCenter > 0.5 || alpha < 0.01) discard;

        gl_FragColor = vec4(vColor * vBrightness * uGlowIntensity * (1.0 + core * 0.8 + halo), alpha);
      }
    `,
  })
}

function createLayer(count, mode, opacity, debug = false) {
  const geometry = new THREE.BufferGeometry()
  const material = createParticleMaterial(debug ? 1 : opacity, debug)
  const alphas = makeAlphas(count, mode, debug)
  const sizes = makePixelSizes(count, mode, debug)

  geometry.setAttribute('color', new THREE.BufferAttribute(makeColors(count, mode === 'glint', debug), 3))
  geometry.setAttribute('particleAlpha', new THREE.BufferAttribute(alphas, 1))
  geometry.setAttribute('particleBrightness', new THREE.BufferAttribute(makeBrightness(count, mode, debug), 1))
  geometry.setAttribute('particleSize', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('particleTwinkle', new THREE.BufferAttribute(makeTwinkles(count), 1))

  return { baseAlphas: new Float32Array(alphas), baseSizes: new Float32Array(sizes), geometry, material }
}

function applySampleBoosts(layer) {
  const data = layer.data
  const brightness = layer.geometry.attributes.particleBrightness
  const sizes = layer.geometry.attributes.particleSize

  if (!data?.brightnessBoosts || !data?.sizeBoosts || !brightness || !sizes) return

  for (let index = 0; index < data.count; index += 1) {
    brightness.array[index] *= data.brightnessBoosts[index]
    sizes.array[index] *= data.sizeBoosts[index]
  }

  brightness.needsUpdate = true
  sizes.needsUpdate = true
}

function updateMeshLayer(layer, mode, time, intensity, splatterStrength, camera, debug = false) {
  const { data, geometry, material } = layer
  const positions = geometry.attributes.position
  const particleAlpha = geometry.attributes.particleAlpha
  const particleSize = geometry.attributes.particleSize
  const array = positions.array
  const alphaArray = particleAlpha.array
  const sizeArray = particleSize.array
  const safeIntensity = clamp01(intensity)

  data.root.updateMatrixWorld(true)
  tempRootInverse.copy(data.root.matrixWorld).invert()
  tempCameraLocal.copy(camera.position).applyMatrix4(tempRootInverse)

  for (let index = 0; index < data.samples.length; index += 1) {
    const offset = index * 3
    const sample = data.samples[index]
    const phase = data.phases[index]

    readParticleSurface(data.root, sample, tempVertex, tempNormal)
    const region = bodyRegionWeights(tempVertex, tempNormal, sample.source)
    tempViewDirection.subVectors(tempCameraLocal, tempVertex).normalize()
    const rimFactor = 1 - Math.min(1, Math.abs(tempNormal.dot(tempViewDirection)))
    const silhouetteBoost = mode === 'surface'
      ? 0.62 + rimFactor * 0.48
      : mode === 'splatter'
        ? 0.78 + rimFactor * 0.36
        : 0.88 + rimFactor * 0.58
    const betweenLegsFade = tempVertex.y < -0.14 && tempVertex.y > -1.05 && Math.abs(tempVertex.x) < 0.15
      ? STARDUST_CONFIG.legInnerDensity
      : 1

    const breathing = debug ? 0 : Math.sin(time * 1.9 + phase) * (mode === 'surface' ? 0.002 : 0.008)
    const driftScale = debug ? 0 : STARDUST_CONFIG.driftAmount
    const scatterCycle = mode === 'splatter' ? ((time * 0.08 + phase) % 1) : 0
    const scatterFade = mode === 'splatter' ? (1 - scatterCycle * 0.68) * betweenLegsFade : betweenLegsFade
    const floatY = debug ? 0 : Math.sin(time * 1.35 + phase) * (mode === 'splatter' ? driftScale * 2.8 : driftScale)
    const floatX = debug ? 0 : Math.sin(time * 1.65 + phase) * (mode === 'splatter' ? driftScale * 2.4 : driftScale * 0.75)
    const outward = debug
      ? 0
      : data.outward[index] * (mode === 'splatter' ? splatterStrength * (0.55 + scatterCycle * 0.65) : 1) + breathing

    tempRootLocal.copy(tempVertex).addScaledVector(tempNormal, outward)
    array[offset] = tempRootLocal.x + (debug ? 0 : data.drift[offset]) + floatX
    array[offset + 1] = tempRootLocal.y + (debug ? 0 : data.drift[offset + 1]) + floatY
    array[offset + 2] = tempRootLocal.z + (debug ? 0 : data.drift[offset + 2] + Math.cos(time * 1.4 + phase) * 0.004)
    alphaArray[index] = debug
      ? layer.baseAlphas[index]
      : layer.baseAlphas[index] * region.brightness * silhouetteBoost * scatterFade * (0.86 + Math.sin(time * STARDUST_CONFIG.sparkleSpeed + phase) * 0.14)
    if (!debug && layer.baseSizes) {
      sizeArray[index] = layer.baseSizes[index] * (0.92 + rimFactor * 0.28)
    }
  }

  positions.needsUpdate = true
  particleAlpha.needsUpdate = true
  particleSize.needsUpdate = true
  material.uniforms.uTime.value = time
  material.uniforms.uIntensity.value = debug
    ? 1
    : safeIntensity * (1 + Math.sin(time * 2.2) * FLICKER_STRENGTH * 0.16)
}

export default function HologramParticles({
  vrm,
  debug = false,
  enabled = true,
  intensity = 0.65,
  splatterStrength = 1,
}) {
  const surfaceRef = useRef(null)
  const rimRef = useRef(null)
  const featureRef = useRef(null)
  const faceFeatureRef = useRef(null)
  const glintRef = useRef(null)
  const splatterRef = useRef(null)
  const { gl } = useThree()
  const safeIntensity = clamp01(intensity)
  const safeSplatterStrength = Math.max(0.35, splatterStrength)

  const layers = useMemo(() => {
    const surfaceData = makeMeshSamples(vrm, SURFACE_COUNT, 'surface')
    const rimData = makeMeshSamples(vrm, RIM_COUNT, 'rim')
    const featureData = makeMeshSamples(vrm, FEATURE_COUNT, 'feature')
    const faceFeatureData = makeMeshSamples(vrm, FACE_FEATURE_COUNT, 'faceFeature')
    const glintData = makeMeshSamples(vrm, GLINT_COUNT, 'glint')
    const splatterData = makeMeshSamples(vrm, SPLATTER_COUNT, 'splatter')
    const surface = createLayer(surfaceData?.count || 0, 'surface', SURFACE_OPACITY, debug)
    const rim = createLayer(rimData?.count || 0, 'rim', RIM_OPACITY, debug)
    const feature = createLayer(featureData?.count || 0, 'feature', FEATURE_OPACITY, debug)
    const faceFeature = createLayer(faceFeatureData?.count || 0, 'faceFeature', FACE_FEATURE_OPACITY, debug)
    const glint = createLayer(glintData?.count || 0, 'glint', GLINT_OPACITY, debug)
    const splatter = createLayer(splatterData?.count || 0, 'splatter', SPLATTER_OPACITY, debug)

    surface.geometry.setAttribute('position', new THREE.BufferAttribute(surfaceData?.positions || new Float32Array(0), 3))
    rim.geometry.setAttribute('position', new THREE.BufferAttribute(rimData?.positions || new Float32Array(0), 3))
    feature.geometry.setAttribute('position', new THREE.BufferAttribute(featureData?.positions || new Float32Array(0), 3))
    faceFeature.geometry.setAttribute('position', new THREE.BufferAttribute(faceFeatureData?.positions || new Float32Array(0), 3))
    glint.geometry.setAttribute('position', new THREE.BufferAttribute(glintData?.positions || new Float32Array(0), 3))
    splatter.geometry.setAttribute('position', new THREE.BufferAttribute(splatterData?.positions || new Float32Array(0), 3))

    return {
      feature: { ...feature, data: featureData },
      faceFeature: { ...faceFeature, data: faceFeatureData },
      glint: { ...glint, data: glintData },
      rim: { ...rim, data: rimData },
      splatter: { ...splatter, data: splatterData },
      surface: { ...surface, data: surfaceData },
    }
  }, [debug, vrm])

  useEffect(() => {
    Object.values(layers).forEach(applySampleBoosts)
  }, [layers])

  useEffect(() => () => {
    Object.values(layers).forEach((layer) => {
      layer.geometry.dispose()
      layer.material.dispose()
    })
  }, [layers])

  useFrame(({ camera, clock }) => {
    const visible = enabled && safeIntensity > 0
    const time = clock.elapsedTime
    const pixelRatio = Math.min(gl.getPixelRatio?.() || window.devicePixelRatio || 1, 2)

    ;[surfaceRef, rimRef, featureRef, faceFeatureRef, glintRef, splatterRef].forEach((ref) => {
      if (ref.current) ref.current.visible = visible
    })
    if (!visible) return

    Object.values(layers).forEach((layer) => {
      layer.material.uniforms.uPixelRatio.value = pixelRatio
    })

    if (layers.surface.data) updateMeshLayer(layers.surface, 'surface', time, safeIntensity, safeSplatterStrength, camera, debug)
    if (layers.rim.data) updateMeshLayer(layers.rim, 'rim', time, safeIntensity, safeSplatterStrength, camera, debug)
    if (layers.feature.data) updateMeshLayer(layers.feature, 'feature', time, safeIntensity, safeSplatterStrength, camera, debug)
    if (layers.faceFeature.data) updateMeshLayer(layers.faceFeature, 'faceFeature', time, safeIntensity, safeSplatterStrength, camera, debug)
    if (layers.glint.data) updateMeshLayer(layers.glint, 'glint', time, safeIntensity, safeSplatterStrength, camera, debug)
    if (layers.splatter.data) updateMeshLayer(layers.splatter, 'splatter', time, safeIntensity, safeSplatterStrength, camera, debug)
  })

  return (
    <group>
      <points ref={surfaceRef} geometry={layers.surface.geometry} material={layers.surface.material} />
      <points ref={rimRef} geometry={layers.rim.geometry} material={layers.rim.material} />
      <points ref={featureRef} geometry={layers.feature.geometry} material={layers.feature.material} />
      <points ref={faceFeatureRef} geometry={layers.faceFeature.geometry} material={layers.faceFeature.material} />
      <points ref={glintRef} geometry={layers.glint.geometry} material={layers.glint.material} />
      <points ref={splatterRef} geometry={layers.splatter.geometry} material={layers.splatter.material} />
    </group>
  )
}
