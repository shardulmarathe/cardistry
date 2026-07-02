import { useState } from 'react'
import {
  getLessonsByDifficulty,
  DIFFICULTY_LABEL,
  RANDOMNESS_GUIDE,
  GRIP_GLOSSARY,
} from '../lessons/catalog'
import { useAppStore } from '../state/useAppStore'

const SUIT_FOR_DIFF = {
  beginner: '♦',
  intermediate: '♣',
  advanced: '♠',
}

export default function LessonCatalog() {
  const openLesson = useAppStore((s) => s.openLesson)
  const groups = getLessonsByDifficulty()
  const [infoOpen, setInfoOpen] = useState(false)

  return (
    <section className="catalog" aria-label="Shuffle techniques">
      <div className="catalog-head">
        <div className="catalog-head-row">
          <div>
            <p className="eyebrow">Learn to shuffle</p>
            <h2 className="catalog-title">Pick a technique</h2>
          </div>
          <button
            type="button"
            className="info-toggle"
            onClick={() => setInfoOpen((v) => !v)}
            aria-expanded={infoOpen}
          >
            {infoOpen ? 'Hide guide' : 'Mixing & grips'}
          </button>
        </div>

        {infoOpen && (
          <div className="catalog-info">
            <div className="info-panel">
              <h3 className="info-title">How random is each technique?</h3>
              <ul className="info-list">
                {RANDOMNESS_GUIDE.map((row) => (
                  <li key={row.technique}>
                    <span className="info-technique">{row.technique}</span>
                    <span className="info-strength">{row.strength}</span>
                    <p className="info-detail">{row.detail}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div className="info-panel">
              <h3 className="info-title">Grip terminology</h3>
              <ul className="info-list grips">
                {GRIP_GLOSSARY.map((g) => (
                  <li key={g.name}>
                    <span className="info-technique">{g.name}</span>
                    <p className="info-detail">{g.detail}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      <div className="catalog-scroll">
        {groups.map((group) => (
          <div key={group.difficulty} className="catalog-tier">
            <div className="tier-head">
              <span className={`tier-suit diff-${group.difficulty}`}>
                {SUIT_FOR_DIFF[group.difficulty]}
              </span>
              <span className="tier-label">{DIFFICULTY_LABEL[group.difficulty]}</span>
              <span className="tier-rule" />
            </div>
            <div className="catalog-grid">
              {group.lessons.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className="lesson-card"
                  onClick={() => openLesson(l.id)}
                >
                  <div className="lesson-card-top">
                    <span className="randomizes">Mixing · {l.randomizes}</span>
                  </div>
                  <h3 className="lesson-name">{l.title}</h3>
                  <p className="lesson-summary">{l.summary}</p>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
