const FINGER_JOINTS = [
  [5, 6, 8],
  [9, 10, 12],
  [13, 14, 16],
  [17, 18, 20],
]

function jointAngle(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) }
  const cb = { x: c.x - b.x, y: c.y - b.y, z: (c.z || 0) - (b.z || 0) }
  const denominator = Math.max(
    0.000001,
    Math.hypot(ab.x, ab.y, ab.z) * Math.hypot(cb.x, cb.y, cb.z),
  )
  const cosine = Math.max(-1, Math.min(1, (
    ab.x * cb.x + ab.y * cb.y + ab.z * cb.z
  ) / denominator))
  return Math.acos(cosine) * 180 / Math.PI
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value))
}

function measureOpenness(landmarks) {
  if (!landmarks?.[20]) return 0
  const total = FINGER_JOINTS.reduce((sum, [a, b, c]) => (
    sum + clamp01((jointAngle(landmarks[a], landmarks[b], landmarks[c]) - 80) / 80)
  ), 0)
  return total / FINGER_JOINTS.length
}

function palmCenter(landmarks, mirrorX) {
  const palmPoints = [0, 5, 9, 13, 17].map((index) => landmarks[index])
  const center = palmPoints.reduce((sum, point) => ({
    x: sum.x + point.x,
    y: sum.y + point.y,
  }), { x: 0, y: 0 })
  const x = center.x / palmPoints.length
  return {
    x: mirrorX ? 1 - x : x,
    y: center.y / palmPoints.length,
  }
}

function measurePalmRotation(landmarks, mirrorX) {
  if (!landmarks?.[13]) return 0
  const wrist = landmarks[0]
  const upperPalm = {
    x: (landmarks[9].x + landmarks[13].x) * 0.5,
    y: (landmarks[9].y + landmarks[13].y) * 0.5,
  }
  const horizontal = mirrorX ? wrist.x - upperPalm.x : upperPalm.x - wrist.x
  const vertical = wrist.y - upperPalm.y
  // Three.js positive Z rotation appears opposite to the mirrored camera view,
  // so expose the visual offset in the record's coordinate direction.
  return -Math.atan2(horizontal, vertical)
}

function shortestAngleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from))
}

export function createHandGestureController({
  smoothing = 0.42,
  rotationSmoothing = 0.34,
  mirrorX = true,
  joinArmDistance = 0.24,
  joinTriggerDistance = 0.16,
  joinOcclusionDistance = 0.24,
  joinMinTravel = 0.08,
  joinMinMs = 80,
  joinMaxMs = 1400,
  joinVerticalTolerance = 0.22,
  joinDetectionGraceMs = 180,
} = {}) {
  let scatter = 0
  let rotation = 0
  let joinCandidate = null
  let joinLatched = false
  let lastTwoHandsAt = Number.NEGATIVE_INFINITY

  return {
    update({ landmarks, secondaryLandmarks, timestamp = 0 } = {}) {
      const openness = measureOpenness(landmarks)
      scatter += (openness - scatter) * smoothing
      const rotationTarget = landmarks?.[20]
        ? measurePalmRotation(landmarks, mirrorX)
        : 0
      rotation += shortestAngleDelta(rotation, rotationTarget) * rotationSmoothing
      let action = null

      if (landmarks?.[20] && secondaryLandmarks?.[20]) {
        lastTwoHandsAt = timestamp
        const primaryCenter = palmCenter(landmarks, mirrorX)
        const secondaryCenter = palmCenter(secondaryLandmarks, mirrorX)
        const distance = Math.hypot(
          primaryCenter.x - secondaryCenter.x,
          primaryCenter.y - secondaryCenter.y,
        )
        const verticalGap = Math.abs(primaryCenter.y - secondaryCenter.y)

        if (distance >= joinArmDistance) {
          const shouldRestart = joinLatched
            || !joinCandidate
            || timestamp - joinCandidate.timestamp > joinMaxMs
          joinLatched = false
          if (shouldRestart) {
            joinCandidate = {
              maxDistance: distance,
              lastDistance: distance,
              lastVerticalGap: verticalGap,
              timestamp,
            }
          } else {
            joinCandidate.maxDistance = Math.max(joinCandidate.maxDistance, distance)
            joinCandidate.lastDistance = distance
            joinCandidate.lastVerticalGap = verticalGap
          }
        } else if (!joinLatched && joinCandidate) {
          joinCandidate.maxDistance = Math.max(joinCandidate.maxDistance, distance)
          joinCandidate.lastDistance = distance
          joinCandidate.lastVerticalGap = verticalGap
          const elapsedMs = timestamp - joinCandidate.timestamp
          const inwardTravel = joinCandidate.maxDistance - distance

          if (elapsedMs > joinMaxMs) {
            joinCandidate = null
          } else if (
            elapsedMs >= joinMinMs
            && distance <= joinTriggerDistance
            && inwardTravel >= joinMinTravel
            && verticalGap <= joinVerticalTolerance
          ) {
            action = 'next'
            joinLatched = true
            joinCandidate = null
          }
        }
      } else {
        const missingForMs = timestamp - lastTwoHandsAt
        if (!joinLatched && joinCandidate && missingForMs <= joinDetectionGraceMs) {
          const elapsedMs = timestamp - joinCandidate.timestamp
          const inwardTravel = joinCandidate.maxDistance - joinCandidate.lastDistance
          if (
            elapsedMs >= joinMinMs
            && elapsedMs <= joinMaxMs
            && joinCandidate.lastDistance <= joinOcclusionDistance
            && inwardTravel >= joinMinTravel
            && joinCandidate.lastVerticalGap <= joinVerticalTolerance
          ) {
            action = 'next'
            joinLatched = true
            joinCandidate = null
          }
        }
        if (missingForMs > joinDetectionGraceMs) joinCandidate = null
      }

      return { tracking: Boolean(landmarks?.[20]), openness, scatter, rotation, action }
    },
    reset() {
      scatter = 0
      rotation = 0
      joinCandidate = null
      joinLatched = false
      lastTwoHandsAt = Number.NEGATIVE_INFINITY
      return { tracking: false, openness: 0, scatter: 0, rotation: 0, action: null }
    },
  }
}
