import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import FeltTable, { FELT_LAYER } from './FeltTable'
import LightingRig from './LightingRig'
import CameraController from './CameraController'
import ResponsiveCamera from './ResponsiveCamera'
import SceneController from './SceneController'

// Everything inside the Canvas. Cards live in SceneController and never remount.
export default function Stage() {
  const camera = useThree((s) => s.camera)

  // The felt draws on FELT_LAYER so the ContactShadows depth pass skips it
  // (see below); the one real camera has to opt back in to keep seeing it.
  useEffect(() => {
    camera.layers.enable(FELT_LAYER)
  }, [camera])

  return (
    <>
      <LightingRig />
      <FeltTable />
      {/* Grounding. This node was previously a no-op: drei renders its blur
          passes by drawing an untransformed plane at world y=0 through the
          shadow camera, which looks UP from the node's own position. At
          y=+0.006 that plane lands just behind the near plane, gets clipped,
          and — because autoClear is on — each blur pass wipes the render target
          to transparent. Nothing ever reached the felt, while the app still
          paid for a full 52-card depth re-render every frame.
          near=-0.02 pulls the blur plane back inside the frustum. That would
          also sweep in the felt itself (also at world y=0), flooding the map
          with a solid slab, which is why the felt sits on FELT_LAYER. */}
      <ContactShadows
        position={[0, 0.006, 0]}
        scale={5.2}
        blur={2.4}
        opacity={0.62}
        near={-0.02}
        far={1.2}
        resolution={512}
        color="#1c0308"
      />
      <CameraController />
      <ResponsiveCamera />
      <SceneController />
    </>
  )
}
