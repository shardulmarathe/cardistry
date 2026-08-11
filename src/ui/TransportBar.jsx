import { useLayoutEffect, useRef } from 'react'
import { usePlayer } from '../lessons/engine/player'
import { useAppStore } from '../state/useAppStore'
import { getLessonById } from '../lessons/catalog'
import { RAMP_GRADIENT, RANDOM_RISING, useMixingView } from '../lessons/engine/mixing'
import OrderStrip from './OrderStrip'

const SPEEDS = [0.25, 0.5, 1, 2]

function fmt(ms) {
  const s = Math.max(0, ms) / 1000
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${m}:${r.toString().padStart(2, '0')}`
}

export default function TransportBar() {
  const barRef = useRef(null)
  const activeLessonId = useAppStore((s) => s.activeLessonId)
  const lesson = getLessonById(activeLessonId)

  const track = usePlayer((s) => s.track)
  const globalMs = usePlayer((s) => s.globalMs)
  const durationMs = usePlayer((s) => s.durationMs)
  const stepIndex = usePlayer((s) => s.stepIndex)
  const playing = usePlayer((s) => s.playing)
  const started = usePlayer((s) => s.started)
  const speed = usePlayer((s) => s.speed)
  const mixing = useMixingView((s) => s.enabled)

  const p = usePlayer.getState()
  const steps = track?.steps ?? []
  const step = steps[stepIndex]
  const pct = durationMs > 0 ? (globalMs / durationMs) * 100 : 0
  const facts = lesson?.facts ?? []
  const fact = facts.length ? facts[stepIndex % facts.length] : null

  const exit = () => {
    usePlayer.getState().clear()
    // Stays in lesson MODE (that shows the catalog) but drops the run counter,
    // baseline and history, so the next technique starts its own replay tally.
    useAppStore.setState({
      activeLessonId: null,
      lessonRun: 0,
      lessonBaseline: null,
      lessonHistory: [],
    })
  }

  const cycleSpeed = () => {
    const i = SPEEDS.indexOf(speed)
    p.setSpeed(SPEEDS[(i + 1) % SPEEDS.length])
  }

  // Tell the camera how much viewport this panel covers, so the shuffle is
  // framed in the strip above it rather than behind it. The panel's height is
  // not fixed, the mixing strip and the replay history both grow it, so this
  // has to be measured, not assumed.
  useLayoutEffect(() => {
    const el = barRef.current
    if (!el) return
    const publish = () => useAppStore.getState().setUiInset(el.getBoundingClientRect().height)
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => {
      ro.disconnect()
      useAppStore.getState().setUiInset(0)
    }
  }, [])

  return (
    <div className="transport" ref={barRef}>
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

      {/* Before the first play the panel offers ONE action, at full primary
          weight, instead of a row of five equal-sized glyph buttons in which
          the only one that matters is 24px wide. After that it is a transport
          and the controls below are the right affordance. */}
      {!started && (
        <div className="transport-start">
          <button type="button" className="demo-btn" onClick={() => p.play()} autoFocus>
            <span className="demo-btn-glyph" aria-hidden="true">
              ▶
            </span>
            <span className="demo-btn-text">
              <span className="demo-btn-title">Play demo</span>
              <span className="demo-btn-sub">
                {steps.length} steps · {fmt(durationMs)}
              </span>
            </span>
          </button>
          <p className="start-hint">
            Or scrub and step through it yourself — nothing moves until you say so.
          </p>
        </div>
      )}

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
          <button
            type="button"
            className={`ostrip-toggle${mixing ? ' is-on' : ''}`}
            aria-pressed={mixing}
            title="Watch the deck order change as the shuffle plays"
            onClick={() => useMixingView.getState().toggle()}
          >
            <span className="ostrip-swatch" style={{ background: RAMP_GRADIENT }} />
            <span className="ostrip-toggle-label">Mixing</span>
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

      <ReplayBar lesson={lesson} />
      <OrderStrip />
    </div>
  )
}

// "Shuffle again": re-run the same technique on the deck the last run left
// behind. Shuffles compound the way they do at a real table, and the per-run
// numbers are scored against the deck as it was when the lesson OPENED, so
// this is where the catalog's "~7 riffles randomize a deck" claim becomes
// something you can actually watch happen.
function ReplayBar({ lesson }) {
  const run = useAppStore((s) => s.lessonRun)
  const history = useAppStore((s) => s.lessonHistory)
  const durationMs = usePlayer((s) => s.durationMs)
  const globalMs = usePlayer((s) => s.globalMs)
  if (!lesson) return null

  const finished = durationMs > 0 && globalMs >= durationMs
  const random = Math.floor(RANDOM_RISING(52))
  const latest = history.length ? history[history.length - 1] : null

  return (
    <div className={`replay${finished ? ' is-ready' : ''}`}>
      <div className="replay-lead">
        <span className="replay-tag">Replay</span>
        <span className="replay-count">
          {run === 0 ? 'First run' : `Run ${run + 1} — shuffled ${run + 1}×`}
        </span>
      </div>

      {history.length > 0 && (
        <p className="replay-track">
          <span className="replay-track-label">How mixed, run by run</span>
          <span className="replay-seq">
            {history.map((h) => (
              <span key={h.run} className="replay-pip">
                {h.rising}
              </span>
            ))}
          </span>
          <span className="replay-target">of ~{random} when fully random</span>
        </p>
      )}

      <div className="replay-actions">
        {latest && (
          <span className="replay-kept">
            {Math.round((latest.kept / latest.pairs) * 100)}% of original neighbours still together
          </span>
        )}
        <button
          type="button"
          className="replay-btn"
          onClick={() => useAppStore.getState().repeatLesson()}
          title="Run this technique again, starting from the deck as it is now"
        >
          ↻ Shuffle again
        </button>
      </div>
    </div>
  )
}
