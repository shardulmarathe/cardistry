import { usePlayer } from '../lessons/engine/player'
import { clamp01 } from '../lib/ease'

// Teaching instructions for the current moment, docked ABOVE the simulation.
// (They used to float in-scene as 3D callouts and covered the cards.)
export default function LessonInstructions() {
  const track = usePlayer((s) => s.track)
  const globalMs = usePlayer((s) => s.globalMs)
  if (!track) return null

  const active = []
  for (const a of track.annotations) {
    if (globalMs >= a.tStart && globalMs <= a.tEnd) {
      const fadeIn = clamp01((globalMs - a.tStart) / 220)
      const fadeOut = clamp01((a.tEnd - globalMs) / 220)
      active.push({ id: a.id, text: a.text, opacity: Math.min(fadeIn, fadeOut) })
    }
  }
  if (active.length === 0) return null

  return (
    <div className="lesson-instructions">
      {active.map((a) => (
        <div key={a.id} className="lesson-instruction" style={{ opacity: a.opacity }}>
          {a.text}
        </div>
      ))}
    </div>
  )
}
