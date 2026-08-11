import { useEffect, useRef, useState } from 'react'
import { LESSONS, getLessonById, RANDOMNESS_GUIDE, GRIP_GLOSSARY } from '../lessons/catalog'
import { useAppStore } from '../state/useAppStore'
import { usePlayer } from '../lessons/engine/player'
import { compileLesson } from '../lessons/engine/compileLesson'

const WIDE_QUERY = '(min-width: 900px)'
const PREVIEW_DELAY = 280 // debounce: never pay for a compile on a stray click

// Remembered across mounts so coming back from a lesson lands where you were.
let lastSelectedId = null

/* ---------------------------------------------------------------------------
   Mixing strength
   `randomizes` is authored prose ('Excellent', 'Weak', 'None — controlled').
   Rank it 0..4 so every card can carry a real meter instead of a tiny caption,
   and so the RANDOMNESS_GUIDE rows read on the same scale.
--------------------------------------------------------------------------- */
function mixLevel(strength = '') {
  const k = strength.toLowerCase()
  if (k.startsWith('excellent')) return 4
  if (k.startsWith('very good')) return 3
  if (k.startsWith('good') || k.startsWith('moderate')) return 2
  if (k.startsWith('weak')) return 1
  return 0
}

// The guide row that explains this lesson's mixing power. Matched on the
// technique words the guide already uses ('Overhand / Hindu / Strip', 'Cuts &
// flourishes') so adding a lesson needs no table here.
function guideRowFor(lesson) {
  const hay = `${lesson.title} ${lesson.technique ?? ''}`.toLowerCase()
  const hit = RANDOMNESS_GUIDE.find((row) =>
    row.technique
      .split(/[/&]/)
      .map((t) => t.trim().toLowerCase())
      .some((t) => t && (hay.includes(t) || (t.endsWith('s') && hay.includes(t.slice(0, -1))))),
  )
  return (
    hit ??
    RANDOMNESS_GUIDE.find(
      (row) => row.strength.toLowerCase() === (lesson.randomizes ?? '').toLowerCase(),
    ) ??
    null
  )
}

function MixMeter({ strength, className = '' }) {
  const level = mixLevel(strength)
  return (
    <span className={`mix mix-l${level} ${className}`.trim()}>
      <span className="mix-pips" aria-hidden="true">
        <i className={level > 0 ? 'on' : ''} />
        <i className={level > 1 ? 'on' : ''} />
        <i className={level > 2 ? 'on' : ''} />
        <i className={level > 3 ? 'on' : ''} />
      </span>
      <span className="mix-value">{strength}</span>
    </span>
  )
}

/* ---------------------------------------------------------------------------
   Live preview
   LessonRunner is already mounted for the whole of lesson mode and drives
   whatever track sits in usePlayer — so a preview is just "load a track WITHOUT
   setting activeLessonId" (that would swap the UI into the lesson view).
   compileLesson runs the full authoring pipeline, so tracks are debounced and
   cached per (lesson, deck order).
--------------------------------------------------------------------------- */
const TRACK_CACHE = new Map() // lessonId -> { sig, track }
const CACHE_MAX = 6
const previewIdOf = (id) => `preview:${id}`
const isPreviewId = (id) => typeof id === 'string' && id.startsWith('preview:')

function trackFor(lesson, deck) {
  const sig = deck.map((c) => c.id).join(',')
  const hit = TRACK_CACHE.get(lesson.id)
  if (hit && hit.sig === sig) return hit.track
  const track = compileLesson(lesson, deck)
  TRACK_CACHE.set(lesson.id, { sig, track })
  if (TRACK_CACHE.size > CACHE_MAX) TRACK_CACHE.delete(TRACK_CACHE.keys().next().value)
  return track
}

// A STILL POSTER FRAME, not a running preview. This used to load the technique and
// loop it forever while the catalog was open, which meant the table was shuffling
// continuously the whole time you were browsing - and there was no way to stop it
// short of leaving the tab. Nothing here plays now: opening a technique from the
// catalog is what starts it, and even then the lesson loads PAUSED behind its own
// "Play demo" button.
//
// The frame is taken from partway through rather than from 0, because every lesson
// starts on the same squared deck: at frame 0 all four posters are identical. At 45%
// each one is inside its signature beat - the riffle mid-interlace, the wash mid-
// spread - so the catalog still tells you what you are choosing between.
const POSTER_AT = 0.45

function usePreview(lessonId) {
  useEffect(() => {
    const lesson = lessonId ? getLessonById(lessonId) : null
    if (!lesson) return undefined
    const previewId = previewIdOf(lesson.id)
    const start = window.setTimeout(() => {
      const track = trackFor(lesson, useAppStore.getState().deck)
      usePlayer.getState().loadTrack(previewId, track)
      // `scrubTo` seeks, sets the step index and leaves the player PAUSED, which is
      // exactly a poster frame. It also bumps `seekNonce`, which is what makes the
      // runner re-read the position while paused.
      usePlayer.getState().scrubTo(track.duration * POSTER_AT)
    }, PREVIEW_DELAY)
    return () => window.clearTimeout(start)
  }, [lessonId])
}

export default function LessonCatalog() {
  const openLesson = useAppStore((s) => s.openLesson)

  const [infoOpen, setInfoOpen] = useState(false)
  // Wide screens have a detail column to fill, so pick the first technique for
  // the user; narrow screens drill down from the list, so they start on it.
  const [selectedId, setSelectedId] = useState(
    () => lastSelectedId ?? (window.matchMedia(WIDE_QUERY).matches ? (LESSONS[0]?.id ?? null) : null),
  )
  const lesson = selectedId ? getLessonById(selectedId) : null
  const playerLessonId = usePlayer((s) => s.lessonId)
  const previewLive = playerLessonId === previewIdOf(selectedId)

  usePreview(selectedId)

  const openingRef = useRef(false)
  const baseDeckRef = useRef(null)
  if (baseDeckRef.current === null) baseDeckRef.current = useAppStore.getState().deck

  useEffect(() => {
    lastSelectedId = selectedId
  }, [selectedId])

  // Tear the preview down for good when the catalog goes away (lesson opened,
  // tab changed), a track left in the player would keep the runner sampling.
  useEffect(() => {
    const baseDeck = baseDeckRef.current
    return () => {
      const p = usePlayer.getState()
      if (isPreviewId(p.lessonId)) p.clear()
      const app = useAppStore.getState()
      // A preview that ran to the end left its shuffled result in the deck.
      if (app.deck !== baseDeck) app.setDeck(baseDeck)
      if (!openingRef.current && app.camera.preset !== 'overview') {
        app.setCameraPreset('overview')
      }
    }
  }, [])

  const open = (id) => {
    openingRef.current = true
    openLesson(id)
  }
  const select = (id) => {
    setInfoOpen(false)
    setSelectedId(id)
  }

  const guideRow = lesson ? guideRowFor(lesson) : null
  const fact = lesson?.facts?.[0] ?? null

  return (
    <section
      className={`catalog${selectedId ? ' has-selection' : ''}${infoOpen ? ' is-guide' : ''}`}
      aria-label="Shuffle techniques"
    >
      <div className="catalog-col catalog-col--rail">
        <div className="catalog-head">
          <div className="catalog-head-row">
            <div className="catalog-head-text">
              <p className="eyebrow">Learn to shuffle</p>
              <h2 className="catalog-title">{infoOpen ? 'Mixing & grips' : 'Pick a technique'}</h2>
            </div>
            <button
              type="button"
              className={`info-toggle${infoOpen ? ' is-on' : ''}`}
              onClick={() => setInfoOpen((v) => !v)}
              aria-expanded={infoOpen}
            >
              {infoOpen ? 'Back to techniques' : 'Mixing & grips'}
            </button>
          </div>
          {!infoOpen && (
            <p className="catalog-lede">
              Pick one to see it posed on the table, then start the lesson when you’re ready.
            </p>
          )}
        </div>

        {infoOpen ? (
          <div className="guide-panel">
            <h3 className="guide-title">How random is each technique?</h3>
            <ul className="guide-list">
              {RANDOMNESS_GUIDE.map((row) => (
                <li key={row.technique}>
                  <div className="guide-row-head">
                    <span className="guide-technique">{row.technique}</span>
                    <MixMeter strength={row.strength} className="mix-sm" />
                  </div>
                  <p className="guide-detail">{row.detail}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="catalog-scroll">
            {/* Four techniques, one flat grid. The difficulty tiers this used to
                group by are gone: with four deliberately dissimilar moves the
                grouping was chrome rather than signal, and it invited the
                "beginner" ones to be treated as throwaways. */}
            <div className="catalog-grid">
              {LESSONS.map((l) => {
                const isSel = l.id === selectedId
                return (
                  <button
                    key={l.id}
                    type="button"
                    className={`lesson-card${isSel ? ' is-selected' : ''}`}
                    aria-pressed={isSel}
                    onClick={() => (isSel ? open(l.id) : select(l.id))}
                  >
                    <span className="lesson-name">{l.title}</span>
                    <MixMeter strength={l.randomizes} />
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <div className="catalog-col catalog-col--aside">
        {infoOpen ? (
          <div className="guide-panel">
            <h3 className="guide-title">Grip terminology</h3>
            <ul className="guide-list">
              {GRIP_GLOSSARY.map((g) => (
                <li key={g.name}>
                  <div className="guide-row-head">
                    <span className="guide-technique">{g.name}</span>
                  </div>
                  <p className="guide-detail">{g.detail}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : lesson ? (
          <div className="detail-card">
            <button type="button" className="detail-back" onClick={() => setSelectedId(null)}>
              ← All techniques
            </button>
            <h3 className="detail-title">{lesson.title}</h3>
            <div className="detail-mix">
              <span className="detail-mix-label">Mixing strength</span>
              <MixMeter strength={lesson.randomizes} className="mix-lg" />
            </div>
            <p className="detail-summary">{lesson.summary}</p>
            {guideRow && <p className="detail-note">{guideRow.detail}</p>}
            {fact && (
              <p className="detail-fact">
                <span className="fact-tag">Did you know</span>
                {fact}
              </p>
            )}
            <button type="button" className="start-btn" onClick={() => open(lesson.id)}>
              Start lesson →
            </button>
            <p className={`preview-status${previewLive ? ' is-live' : ''}`}>
              <span className="preview-dot" aria-hidden="true" />
              {previewLive ? 'Posed on the table — drag the felt to orbit' : 'Setting the table…'}
            </p>
          </div>
        ) : (
          <div className="detail-card detail-card--empty">
            <p className="detail-empty-title">Nothing on the table</p>
            <p className="detail-summary">
              Choose a technique on the left and it plays right here on the felt, in full, on a
              loop.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
