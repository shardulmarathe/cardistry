import { memo, useEffect, useMemo } from 'react'
import { usePlayer } from '../lessons/engine/player'
import { useAppStore } from '../state/useAppStore'
import {
  RAMP_GRADIENT,
  RANDOM_RISING,
  buildMixingTimeline,
  completedStepAt,
  frameAt,
  useMixingView,
} from '../lessons/engine/mixing'
import './orderStrip.css'

// The deck order only changes when a step FINISHES, so the whole strip hangs off
// one integer. TransportBar re-renders ~12Hz off globalMs; this selector runs at
// that rate but returns the same number almost every time, so zustand skips the
// render and the 52 cells are rebuilt a handful of times per lesson.
const selectCompletedStep = (s) => completedStepAt(s.track, s.globalMs)

function OrderStrip() {
  const enabled = useMixingView((s) => s.enabled)
  const tinted = useMixingView((s) => s.tint)
  const track = usePlayer((s) => s.track)
  const completed = usePlayer(selectCompletedStep)

  // Measure against the deck as it was when the lesson was OPENED, so repeats
  // ("Shuffle again") accumulate instead of each one resetting to one shuffle's
  // worth of mixing.
  const baseline = useAppStore((s) => s.lessonBaseline)
  const timeline = useMemo(
    () => (track ? buildMixingTimeline(track, baseline) : null),
    [track, baseline],
  )
  const frame = timeline ? frameAt(timeline, completed) : null

  // Publish the per-card ramp colour so the 3D cards can wear the same scale.
  // It is fixed for a lesson — a card's colour is WHERE IT STARTED, and only its
  // position moves — so this fires once per lesson, never per frame.
  useEffect(() => {
    useMixingView.getState().setColors(timeline ? timeline.colorById : null)
    return () => useMixingView.getState().setColors(null)
  }, [timeline])

  const cells = useMemo(() => {
    if (!frame || !timeline) return null
    return frame.order.map((id, i) => (
      // Keyed by SLOT, not by card: recolouring a fixed cell lets CSS cross-fade
      // the order change, where keying by id would silently move DOM nodes.
      <i key={i} className="ostrip-cell" style={{ background: timeline.colorById.get(id) }} />
    ))
  }, [frame, timeline])

  if (!enabled || !frame || !timeline) return null

  const n = timeline.originalIds.length
  const random = RANDOM_RISING(n) // 26.5 for a 52-card deck
  const randomLabel = Math.floor(random)
  const meter = Math.max(0, Math.min(1, (frame.rising - 1) / (random - 1)))
  const keptPct = Math.round((frame.kept / frame.pairs) * 100)

  return (
    <div className="ostrip">
      <div className="ostrip-head">
        <span className="ostrip-title">Deck order</span>
        <span className="ostrip-note">
          colour = where the card started
          {frame.squared ? '' : ' · deck is spread, showing the last squared order'}
        </span>
        <button
          type="button"
          className={`ostrip-tint${tinted ? ' is-on' : ''}`}
          aria-pressed={tinted}
          onClick={() => useMixingView.getState().toggleTint()}
        >
          Tint the real cards
        </button>
      </div>

      <div className="ostrip-rows">
        <span className="ostrip-rowlabel">start</span>
        <div className="ostrip-start" style={{ background: RAMP_GRADIENT }} />
        <span className="ostrip-rowlabel">now</span>
        <div
          className="ostrip-now"
          style={{ '--cells': n }}
          role="img"
          aria-label={`Deck order${frame.label ? ` after ${frame.label}` : ''}: ${frame.rising} rising sequences, ${keptPct}% of neighbouring pairs still together`}
        >
          {cells}
        </div>
      </div>

      <div className="ostrip-stats">
        <div className="ostrip-stat">
          <span className="ostrip-val">{frame.rising}</span>
          <span className="ostrip-unit">of {randomLabel}</span>
          <span className="ostrip-meter">
            <i style={{ width: `${meter * 100}%` }} />
          </span>
          <span className="ostrip-cap">
            <b>how mixed</b> — rising sequences: 1 is untouched, ~{randomLabel} is fully random
          </span>
        </div>
        <div className="ostrip-stat">
          <span className="ostrip-val">{keptPct}%</span>
          <span className="ostrip-cap">
            <b>neighbours kept</b> — pairs that started side by side and still are
          </span>
        </div>
      </div>
    </div>
  )
}

export default memo(OrderStrip)
