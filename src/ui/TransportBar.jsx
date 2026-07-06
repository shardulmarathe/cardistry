import { usePlayer } from '../lessons/engine/player'
import { useAppStore } from '../state/useAppStore'
import { getLessonById } from '../lessons/catalog'

const SPEEDS = [0.25, 0.5, 1, 2]

function fmt(ms) {
  const s = Math.max(0, ms) / 1000
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${m}:${r.toString().padStart(2, '0')}`
}

export default function TransportBar() {
  const activeLessonId = useAppStore((s) => s.activeLessonId)
  const lesson = getLessonById(activeLessonId)

  const track = usePlayer((s) => s.track)
  const globalMs = usePlayer((s) => s.globalMs)
  const durationMs = usePlayer((s) => s.durationMs)
  const stepIndex = usePlayer((s) => s.stepIndex)
  const playing = usePlayer((s) => s.playing)
  const speed = usePlayer((s) => s.speed)

  const p = usePlayer.getState()
  const steps = track?.steps ?? []
  const step = steps[stepIndex]
  const pct = durationMs > 0 ? (globalMs / durationMs) * 100 : 0
  const facts = lesson?.facts ?? []
  const fact = facts.length ? facts[stepIndex % facts.length] : null

  const exit = () => {
    usePlayer.getState().clear()
    useAppStore.setState({ activeLessonId: null })
  }

  const cycleSpeed = () => {
    const i = SPEEDS.indexOf(speed)
    p.setSpeed(SPEEDS[(i + 1) % SPEEDS.length])
  }

  return (
    <div className="transport">
      <div className="transport-info">
        <button type="button" className="back-link" onClick={exit}>
          ← All techniques
        </button>
        <h3 className="transport-title">{lesson?.title}</h3>
        <p className="transport-step">
          <span className="step-count">
            Step {Math.min(stepIndex + 1, steps.length)} / {steps.length}
          </span>
          <span className="step-label">{step?.label}</span>
        </p>
        {fact && (
          <p className="transport-fact">
            <span className="fact-tag">Did you know</span>
            {fact}
          </p>
        )}
      </div>

      <div className="transport-controls">
        <div className="transport-buttons">
          <button
            type="button"
            className="t-btn"
            onClick={() => p.stepPrev()}
            aria-label="Previous step"
          >
            ⟨
          </button>
          <button
            type="button"
            className="t-btn t-play"
            onClick={() => {
              if (globalMs >= durationMs) p.restart()
              else p.toggle()
            }}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? '❙❙' : '▶'}
          </button>
          <button
            type="button"
            className="t-btn"
            onClick={() => p.stepNext()}
            aria-label="Next step"
          >
            ⟩
          </button>
          <button type="button" className="t-btn speed" onClick={cycleSpeed}>
            {speed}×
          </button>
        </div>

        <div className="scrub">
          <span className="time">{fmt(globalMs)}</span>
          <div
            className="scrub-track"
            style={{ '--pct': `${pct}%` }}
          >
            <input
              type="range"
              min={0}
              max={durationMs}
              step={10}
              value={globalMs}
              onChange={(e) => p.scrubTo(Number(e.target.value))}
              aria-label="Scrub lesson"
            />
          </div>
          <span className="time">{fmt(durationMs)}</span>
        </div>
      </div>
    </div>
  )
}
