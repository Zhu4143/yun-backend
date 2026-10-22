import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { createLiquidMetalField } from './liquidMetalField'

export function LiquidMetalFieldQuad({ colors, trackKey, settings, paused, forceTransitionSignal, active, getFrequencyData }) {
  const { gl } = useThree()
  const field = useMemo(() => createLiquidMetalField(), [])
  const resolution = useMemo(() => new THREE.Vector2(), [])
  useEffect(() => () => field.dispose(), [field])
  useEffect(() => { field.setColors(colors, trackKey) }, [field, colors, trackKey])
  useEffect(() => {
    if (forceTransitionSignal > 0) field.forceTransition(colors)
  }, [field, colors, forceTransitionSignal])
  useFrame((_, delta) => {
    gl.getDrawingBufferSize(resolution)
    field.step(delta, { settings, paused, active, getFrequencyData }, resolution.x, resolution.y)
  })
  return (
    <mesh frustumCulled={false} renderOrder={-1000}>
      <planeGeometry args={[2, 2]} />
      <primitive object={field.material} attach="material" />
    </mesh>
  )
}

export default function FlowFieldBackground({
  colors,
  trackKey,
  settings,
  paused = false,
  forceTransitionSignal = 0,
  quality = 'high',
  active = false,
  getFrequencyData,
}) {
  const dpr = quality === 'low'
    ? [0.45, 0.6]
    : quality === 'medium'
      ? [0.6, 0.8]
      : [1, 1.5]

  return (
    <Canvas
      className="flow-field-canvas"
      orthographic
      camera={{ position: [0, 0, 1], near: 0, far: 2 }}
      dpr={dpr}
      gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
    >
      <LiquidMetalFieldQuad
        colors={colors}
        trackKey={trackKey}
        settings={settings}
        paused={paused}
        forceTransitionSignal={forceTransitionSignal}
        active={active}
        getFrequencyData={getFrequencyData}
      />
    </Canvas>
  )
}
