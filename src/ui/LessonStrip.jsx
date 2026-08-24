import { useEffect, useLayoutEffect, useRef } from 'react'
import { usePlayer } from '../lessons/engine/player'
import { useAppStore } from '../state/useAppStore'
import { getLessonById } from '../lessons/catalog'
import FacesToggle from './FacesToggle'

const SPEEDS = [0.25, 0.5, 1, 2]

function fmt(ms) {
  const s = Math.max(0, ms) / 1000
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${m}:${r.toString().padStart(2, '0')}`
}

/* ---------------------------------------------------------------------------
   THE STEP BAR: the shuffle broken into its named beats, plus a scrubber that
   can put you anywhere in it.

   Every step of the compiled track is a chip you can click. The chips are the
   navigation - the old bar had a step COUNTER ("Step 3 / 8") and two arrows,
   which told you where you were but never what was coming, so "show me the
   part where the cards interlace" meant nudging the arrow and guessing.
--------------------------------------------------------------------------- */
export default function LessonStrip() {
  const barRef = useRef(null)
  const stepsRef = useRef(null)
  const activeLessonId = useAppStore((s) => s.activeLessonId)
  const lesson = getLessonById(activeLessonId)

  const track = usePlayer((s) => s.track)
  const globalMs = usePlayer((s) => s.globalMs)
  const durationMs = usePlayer((s) => s.durationMs)
  const stepIndex = usePlayer((s) => s.stepIndex)
  const playing = usePlayer((s) => s.playing)
  const speed = usePlayer((s) => s.speed)
  const run = useAppStore((s) => s.lessonRun)

  const p = usePlayer.getState()
  const steps = track?.steps ?? []
  const pct = durationMs > 0 ? (globalMs / durationMs) * 100 : 0
  const finished = durationMs > 0 && globalMs >= durationMs

  // Follow playback. `nearest`/`center` keeps the active beat in view without
  // yanking the page, and it only fires when the step index actually changes.
  useEffect(() => {
    const row = stepsRef.current
    const chip = row?.children?.[stepIndex]
    chip?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [stepIndex])

  // Tell the camera how much viewport this panel covers, so the shuffle is
  // framed in the strip above it rather than behind it. The height is not fixed
  // (the finished-run row grows it), so this has to be measured, not assumed.
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

  const cycleSpeed = () => {
    const i = SPEEDS.indexOf(speed)
    p.setSpeed(SPEEDS[(i + 1) % SPEEDS.length])
  }

  return (
    <div className="stepbar" ref={barRef}>
      <div className="stepbar-head">
        <button
          type="button"
          className="back-link"
          onClick={() => useAppStore.getState().closeLesson()}
          title="Back to the four shuffles, with the deck as it was before this one"
        >
          ← All shuffles
        </button>
        <h3 className="stepbar-title">{lesson?.title}</h3>
        {run > 0 && <span className="run-tag">shuffled {run + 1}×</span>}
        <button type="button" className="ghost-btn stepbar-restart" onClick={() => p.restart()}>
          ↻ Restart
        </button>
      </div>

      <div className="steps" ref={stepsRef} aria-label="Steps">
        {steps.map((s, i) => (
          <button
            key={i}
            type="button"
            className={`step-chip${i === stepIndex ? ' is-current' : ''}${i < stepIndex ? ' is-done' : ''}`}
            aria-current={i === stepIndex}
            onClick={() => p.jumpToStep(i)}
          >
            <span className="step-num">{i + 1}</span>
            <span className="step-text">{s.label}</span>
          </button>
        ))}
      </div>

      <div className="stepbar-controls">
        <div className="stepbar-buttons">
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
            onClick={() => (finished ? p.restart() : p.toggle())}
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
          <button type="button" className="t-btn speed" onClick={cycleSpeed} title="Playback speed">
            {speed}×
          </button>
          <FacesToggle />
        </div>

        <div className="scrub">
          <span className="time">{fmt(globalMs)}</span>
          <div className="scrub-track" style={{ '--pct': `${pct}%` }}>
            <input
              type="range"
              min={0}
              max={durationMs}
              step={10}
              value={globalMs}
              onChange={(e) => p.scrubTo(Number(e.target.value))}
              aria-label="Scrub through the shuffle"
            />
          </div>
          <span className="time">{fmt(durationMs)}</span>
        </div>
      </div>

      {/* Finished. Two next moves, and they are genuinely different: replay
          watches THIS shuffle again, "shuffle again" runs the technique a
          second time on the deck it just produced - which is how the dock's
          run-by-run climb toward randomness gets built. */}
      {finished && (
        <div className="done-row">
          <span className="done-tag">Shuffle complete</span>
          <div className="done-actions">
            <button type="button" className="ghost-btn" onClick={() => p.restart()}>
              ↻ Replay
            </button>
            <button
              type="button"
              className="again-btn"
              onClick={() => useAppStore.getState().repeatLesson()}
              title="Run this technique again on the deck it just produced"
            >
              ↻ Shuffle again
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
