import { LESSONS } from '../lessons/catalog'
import { useAppStore } from '../state/useAppStore'
import FacesToggle from './FacesToggle'
import MixMeter from './MixMeter'

/* ---------------------------------------------------------------------------
   THE WHOLE OF THE LEARN LANDING STATE.

   What used to be here: a two-column catalog with a technique list, a detail
   pane, a "Mixing & grips" reference sheet with a grip glossary, a debounced
   poster-frame compile per hover, and a "Start lesson" button behind all of it.
   Four things to read and three clicks before a card moved.

   What is here now: the deck squared on the table with a hand either side of it
   (LessonRunner's idle table, built from the SHARED deck - reorder or flip in the
   visualizer and it is already like that when you arrive), and four buttons. One
   click starts the shuffle.
--------------------------------------------------------------------------- */

export default function LessonPicker() {
  const openLesson = useAppStore((s) => s.openLesson)

  return (
    <section className="picker" aria-label="Shuffle techniques">
      <div className="picker-head">
        <p className="eyebrow">Learn to shuffle</p>
        <h2 className="picker-title">Pick a shuffle</h2>
        <FacesToggle className="picker-faces" />
      </div>

      <div className="picker-grid">
        {LESSONS.map((l) => (
          <button
            key={l.id}
            type="button"
            className="picker-card"
            onClick={() => openLesson(l.id)}
          >
            <span className="picker-name">{l.title}</span>
            <MixMeter strength={l.randomizes} />
          </button>
        ))}
      </div>

      <p className="picker-hint">
        Runs on the deck you see — the same one the visualizer is holding.
      </p>
    </section>
  )
}
