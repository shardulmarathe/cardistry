import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { usePlayer } from '../lessons/engine/player'
import { useAppStore } from '../state/useAppStore'
import { getLessonById } from '../lessons/catalog'
import {
  RAMP_GRADIENT,
  RANDOM_RISING,
  buildMixingTimeline,
  completedStepAt,
  frameAt,
  useMixingView,
} from '../lessons/engine/mixing'
import MixMeter from './MixMeter'
import './mixDock.css'

/* ---------------------------------------------------------------------------
   HOW WELL DID THAT MIX? Docked on the right for the whole of a run.

   This is the payoff panel: the deck's order read straight out of the compiled
   track, scored two ways, next to the same reading for a genuinely random deck.
   It used to be behind a "Mixing" toggle in the transport, which meant the one
   thing that makes the app more than an animation was off by default.

   The deck order only changes when a step FINISHES, so the whole panel hangs off
   one integer. The parent re-renders ~12Hz off globalMs; this selector runs at
   that rate but returns the same number almost every time, so zustand skips the
   render and the 52 cells are rebuilt a handful of times per run.
--------------------------------------------------------------------------- */
const selectCompletedStep = (s) => completedStepAt(s.track, s.globalMs)

const SIDE_DOCK = '(min-width: 1000px)'

export default function MixDock() {
  // A CALLBACK REF, not useRef. The panel returns null until the track has
  // compiled, so on the first render there is no element for a layout effect to
  // measure - and with an empty dep list that effect never ran again, which left
  // `uiInsetRight` at 0 and the shuffle framed under the dock. Ref-as-state
  // re-runs the effect exactly when the node appears.
  const [dockEl, setDockEl] = useState(null)
  const tinted = useMixingView((s) => s.tint)
  const track = usePlayer((s) => s.track)
  const completed = usePlayer(selectCompletedStep)
  const activeLessonId = useAppStore((s) => s.activeLessonId)
  const history = useAppStore((s) => s.lessonHistory)
  const lesson = getLessonById(activeLessonId)

  // THIS run's starting order. Re-snapped by "Shuffle again" (not by Replay),
  // so the strip below always reads before-and-after of the shuffle on screen.
  // The run-by-run pips use the other reference - see `lessonOrigin`.
  const baseline = useAppStore((s) => s.lessonBaseline)
  const timeline = useMemo(
    () => (track ? buildMixingTimeline(track, baseline) : null),
    [track, baseline],
  )
  const frame = timeline ? frameAt(timeline, completed) : null

  // Publish the per-card ramp colour so the 3D cards can wear the same scale.
  // It is fixed for a run - a card's colour is WHERE IT STARTED, only its
  // position moves - so this fires once per run, never per frame.
  useEffect(() => {
    useMixingView.getState().setColors(timeline ? timeline.colorById : null)
    return () => useMixingView.getState().setColors(null)
  }, [timeline])

  // Never leave the table false-coloured behind a panel that has gone away.
  useEffect(() => () => useMixingView.getState().setTint(false), [])

  // Only a SIDE dock steals horizontal framing; below that width it sits under
  // the top bar as a compact readout and the camera is left alone.
  useLayoutEffect(() => {
    const el = dockEl
    if (!el) return
    const mq = window.matchMedia(SIDE_DOCK)
    const publish = () =>
      useAppStore
        .getState()
        .setUiInsetRight(mq.matches ? el.getBoundingClientRect().width + 24 : 0)
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    mq.addEventListener('change', publish)
    return () => {
      ro.disconnect()
      mq.removeEventListener('change', publish)
      useAppStore.getState().setUiInsetRight(0)
    }
  }, [dockEl])

  const cells = useMemo(() => {
    if (!frame || !timeline) return null
    return frame.order.map((id, i) => (
      // Keyed by SLOT, not by card: recolouring a fixed cell lets CSS cross-fade
      // the order change, where keying by id would silently move DOM nodes.
      <i key={i} className="mdock-cell" style={{ background: timeline.colorById.get(id) }} />
    ))
  }, [frame, timeline])

  if (!frame || !timeline) return null

  const n = timeline.originalIds.length
  const random = RANDOM_RISING(n) // 26.5 for a 52-card deck
  const randomLabel = Math.floor(random)
  const meter = Math.max(0, Math.min(1, (frame.rising - 1) / (random - 1)))
  const keptPct = Math.round((frame.kept / frame.pairs) * 100)

  return (
    <aside className="mdock" ref={setDockEl} aria-label="Mixing">
      <div className="mdock-head">
        <p className="eyebrow">How well it mixes</p>
        {lesson && <MixMeter strength={lesson.randomizes} className="mix-sm" />}
      </div>

      <div className="mdock-big">
        <span className="mdock-big-val">{frame.rising}</span>
        <span className="mdock-big-of">of {randomLabel}</span>
        <span className="mdock-meter">
          <i style={{ width: `${meter * 100}%` }} />
        </span>
        <span className="mdock-cap">
          <b>rising sequences</b>, this shuffle — 1 is an untouched deck, ~{randomLabel} is fully
          random
        </span>
      </div>

      <div className="mdock-rows">
        <span className="mdock-rowlabel">started</span>
        <div className="mdock-start" style={{ background: RAMP_GRADIENT }} />
        <span className="mdock-rowlabel">now</span>
        <div
          className="mdock-now"
          style={{ '--cells': n }}
          role="img"
          aria-label={`Deck order${frame.label ? ` after ${frame.label}` : ''}: ${frame.rising} rising sequences, ${keptPct}% of neighbouring pairs still together`}
        >
          {cells}
        </div>
        <p className="mdock-note">
          colour = where the card was when this shuffle started
          {frame.squared ? '' : ' · deck is spread, showing the last squared order'}
        </p>
      </div>

      <div className="mdock-stat">
        <span className="mdock-stat-val">{keptPct}%</span>
        <span className="mdock-cap">
          <b>neighbours kept</b> — pairs this shuffle left side by side
        </span>
      </div>

      {/* Run by run, and measured from the deck you PICKED the technique on, not
          from each run's own start - so reading left to right is the actual
          Bayer–Diaconis climb: repeats compound, and ~7 riffles is where a
          52-card deck arrives at random. */}
      {history.length > 0 && (
        <div className="mdock-runs">
          <span className="mdock-cap">
            <b>since you started</b> — rising sequences after each shuffle
          </span>
          <span className="mdock-seq">
            {history.map((h) => (
              <span key={h.run} className="mdock-pip">
                {h.rising}
              </span>
            ))}
          </span>
        </div>
      )}

      <button
        type="button"
        className={`mdock-tint${tinted ? ' is-on' : ''}`}
        aria-pressed={tinted}
        onClick={() => useMixingView.getState().toggleTint()}
        title="Paint the ramp onto the real cards so the table and the strip match"
      >
        <span className="mdock-swatch" style={{ background: RAMP_GRADIENT }} />
        {tinted ? 'Untint the cards' : 'Tint the cards'}
      </button>
    </aside>
  )
}
