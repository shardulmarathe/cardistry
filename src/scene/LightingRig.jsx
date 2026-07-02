import { COLORS } from '../lib/constants'

// The casino look: a warm directional key with tight crisp shadows, an overhead
// "downlight" pooling on the felt, a low red-warm ambient fill, and a faint
// environment map so the cards read as glossy plastic.
export default function LightingRig() {
  return (
    <>
      <ambientLight intensity={0.28} color="#ffd9c2" />

      <directionalLight
        position={[-3.4, 6.2, 3.2]}
        intensity={2.3}
        color="#fff2e6"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={18}
        shadow-camera-left={-3.2}
        shadow-camera-right={3.2}
        shadow-camera-top={3.2}
        shadow-camera-bottom={-3.2}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />

      {/* Overhead pooled downlight for the casino highlight on the felt. */}
      <spotLight
        position={[0.4, 7.5, 0.6]}
        angle={0.5}
        penumbra={0.85}
        intensity={90}
        distance={20}
        color="#ffe6c4"
        castShadow={false}
      />

      {/* Cool rim from behind so the deck edge separates from the dark felt. */}
      <directionalLight position={[2.6, 2.2, -4]} intensity={0.5} color="#b9c8ff" />

      <hemisphereLight args={[COLORS.gold, COLORS.feltEdge, 0.35]} />
    </>
  )
}
