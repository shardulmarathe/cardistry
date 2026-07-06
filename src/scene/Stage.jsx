import { ContactShadows } from '@react-three/drei'
import FeltTable from './FeltTable'
import LightingRig from './LightingRig'
import CameraController from './CameraController'
import ResponsiveCamera from './ResponsiveCamera'
import SceneController from './SceneController'

// Everything inside the Canvas. Cards live in SceneController and never remount.
export default function Stage() {
  return (
    <>
      <LightingRig />
      <FeltTable />
      <ContactShadows
        position={[0, 0.006, 0]}
        scale={7.5}
        blur={4.2}
        opacity={0.22}
        far={1.4}
        resolution={1024}
        color="#2b060f"
      />
      <CameraController />
      <ResponsiveCamera />
      <SceneController />
    </>
  )
}
