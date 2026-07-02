import { Html } from '@react-three/drei'
import { usePlayer } from '../engine/player'
import { clamp01 } from '../../lib/ease'

// 3D-anchored teaching callouts. Subscribes to the mirrored time cursor (~12Hz),
// so it re-renders only a handful of DOM nodes at a modest rate.
export default function AnnotationLayer() {
  const track = usePlayer((s) => s.track)
  const globalMs = usePlayer((s) => s.globalMs)
  if (!track) return null

  const active = []
  for (const a of track.annotations) {
    if (globalMs >= a.tStart && globalMs <= a.tEnd) {
      const fadeIn = clamp01((globalMs - a.tStart) / 220)
      const fadeOut = clamp01((a.tEnd - globalMs) / 220)
      active.push({ ...a, opacity: Math.min(fadeIn, fadeOut) })
    }
  }

  return (
    <>
      {active.map((a) => (
        <group key={a.id} position={a.worldPos}>
          <Html center distanceFactor={6} zIndexRange={[20, 0]} occlude={false}>
            <div className="lesson-annotation" style={{ opacity: a.opacity }}>
              {a.text}
            </div>
          </Html>
        </group>
      ))}
    </>
  )
}
