import { useEffect, useRef } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { CAMERA_PRESETS, ORBIT } from '../lib/constants'
import { useAppStore } from '../state/useAppStore'

// Constrained OrbitControls that also smoothly tweens to a named preset whenever
// the store's camera.preset changes (e.g. entering a lesson). During a tween,
// user orbit is disabled so the choreography always frames correctly.
export default function CameraController() {
  const controlsRef = useRef(null)
  const { camera } = useThree()
  const preset = useAppStore((s) => s.camera.preset)
  const orbitMode = useAppStore((s) => s.camera.mode)

  const tween = useRef({
    active: false,
    t: 0,
    fromPos: new THREE.Vector3(),
    toPos: new THREE.Vector3(),
    fromTarget: new THREE.Vector3(),
    toTarget: new THREE.Vector3(),
  })

  useEffect(() => {
    const p = CAMERA_PRESETS[preset] ?? CAMERA_PRESETS.overview
    const controls = controlsRef.current
    const tw = tween.current
    tw.fromPos.copy(camera.position)
    tw.toPos.set(...p.position)
    tw.fromTarget.copy(controls ? controls.target : new THREE.Vector3())
    tw.toTarget.set(...p.target)
    tw.t = 0
    tw.active = true
  }, [preset, camera])

  useFrame((_, delta) => {
    const tw = tween.current
    const controls = controlsRef.current
    if (tw.active && controls) {
      tw.t = Math.min(1, tw.t + delta / 0.9)
      const e = easeInOutCubic(tw.t)
      camera.position.lerpVectors(tw.fromPos, tw.toPos, e)
      controls.target.lerpVectors(tw.fromTarget, tw.toTarget, e)
      controls.update()
      if (tw.t >= 1) tw.active = false
    }
  })

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enablePan={false}
      enableRotate={orbitMode === 'orbit'}
      enableZoom
      enableDamping
      dampingFactor={ORBIT.dampingFactor}
      minPolarAngle={ORBIT.minPolarAngle}
      maxPolarAngle={ORBIT.maxPolarAngle}
      minDistance={ORBIT.minDistance}
      maxDistance={ORBIT.maxDistance}
      target={[0, 0.15, 0]}
    />
  )
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
