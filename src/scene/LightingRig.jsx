import { COLORS } from '../lib/constants'

// The casino look: a warm directional key with tight crisp shadows, an overhead
// "downlight" pooling on the felt, a low red-warm ambient fill, and a faint
// environment map so the cards read as glossy plastic.
export default function LightingRig() {
  return (
    <>
      {/* Kept low on purpose: ambient fill is what flattens a spotlit table. */}
      <ambientLight intensity={0.13} color="#ffd9c2" />

      <directionalLight
        position={[-3.4, 6.2, 3.2]}
        intensity={2.7}
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

      {/* Overhead pooled downlight for the casino highlight on the felt. Hung
          lower and narrowed from 0.5rad: at y=6.2 a 0.34rad cone lands a
          ~2.2-unit-radius pool over the play area instead of washing the whole
          6.5-unit table, which is what gives the felt visible falloff. */}
      <spotLight
        position={[0.2, 6.2, 0.9]}
        angle={0.34}
        penumbra={0.62}
        intensity={135}
        distance={16}
        color="#ffe6c4"
        castShadow={false}
      />

      {/* Cool rim from behind, grazing, so the deck silhouette and the
          translucent hands separate from the dark felt. */}
      <directionalLight position={[3, 1.6, -4.2]} intensity={0.9} color="#a9beff" />

      <hemisphereLight args={[COLORS.gold, COLORS.feltEdge, 0.18]} />
    </>
  )
}
