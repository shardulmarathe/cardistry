import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { AdaptiveDpr } from '@react-three/drei'
import * as THREE from 'three'
import Stage from './Stage'
import { CAMERA_PRESETS } from '../lib/constants'

// The single Canvas, mounted once for the app's lifetime.
export default function CanvasRoot() {
  const cam = CAMERA_PRESETS.overview
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: cam.fov, position: cam.position, near: 0.1, far: 100 }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.05
      }}
    >
      <color attach="background" args={['#170309']} />
      <fog attach="fog" args={['#170309', 9, 17]} />
      <Suspense fallback={null}>
        <Stage />
      </Suspense>
      <AdaptiveDpr pixelated={false} />
    </Canvas>
  )
}
