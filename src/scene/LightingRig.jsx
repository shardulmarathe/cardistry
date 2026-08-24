import { COLORS } from '../lib/constants'

// The casino look: a warm directional key with tight crisp shadows, an overhead
// "downlight" pooling on the felt, a low red-warm ambient fill, and a faint
// environment map so the cards read as glossy plastic.
export default function LightingRig() {
  return (
    <>
      {/* Ambient fill is what flattens a spotlit table, so this stays low - but
          0.13 was set when the hands were translucent and the felt read through
          their shadow side. Solid, with a skin albedo instead of a near-white
          one, the unlit side of a finger measured (64,27,16): crushed to almost
          nothing, which is what makes a curled hand read as one dark lump
          instead of separate digits. 0.19 lifts it to a legible ~(85,45,30).
          Ambient scales with ALBEDO, so this is nearly free everywhere it could
          do harm: the felt's dark vignette is dark because its albedo is low
          (+0.001 linear there), and the cards gain ~4% - it lands almost
          entirely on the mid-albedo skin it was raised for. */}
      <ambientLight intensity={0.19} color="#ffd9c2" />

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
        // 0.02 world units is 2mm, and it was set when the only casters were
        // large and far from what they shadowed. normalBias offsets the RECEIVER
        // sample toward the light, so it erases any shadow whose caster is
        // nearer than the offset - i.e. it deletes exactly the contact shadow
        // that tells you a fingertip is touching a card, right at the moment of
        // contact (peter-panning). Halved to 1mm, which still covers the depth
        // slope on the felt at this ortho size (6.4 units / 2048 = 3.1mm per
        // texel) while letting a pad keep its own shadow.
        shadow-normalBias={0.01}
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

      {/* Cool rim from behind, grazing, so the deck silhouette and the hands
          separate from the dark felt. (The hands are no longer translucent;
          this light matters MORE now, because it is what draws the edge of a
          solid hand against the felt behind it.) */}
      <directionalLight position={[3, 1.6, -4.2]} intensity={0.9} color="#a9beff" />

      <hemisphereLight args={[COLORS.gold, COLORS.feltEdge, 0.18]} />
    </>
  )
}
