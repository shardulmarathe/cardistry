import { useRef, useState } from 'react'
import Deck from './Deck'
import './Table.css'

const TABS = [
  { id: 'deck', label: 'Deck' },
  { id: 'playing', label: 'Playing' },
  { id: 'shuffles', label: 'Shuffles' },
]

export default function Table() {
  const [mode, setMode] = useState('deck')
  const deckRef = useRef(null)

  return (
    <div className="table-content">
      <nav className="table-mode-tabs" aria-label="Table mode">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={`table-pill table-mode-tab${mode === id ? ' is-active' : ''}`}
            onClick={() => setMode(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <Deck ref={deckRef} />
      <div className="table-deck-controls" role="toolbar" aria-label="Deck actions">
        <button
          type="button"
          className="table-pill table-deck-btn"
          onClick={() => deckRef.current?.flipAll()}
        >
          Flip All
        </button>
        <button
          type="button"
          className="table-pill table-deck-btn"
          onClick={() => deckRef.current?.resetDeck()}
        >
          Reset Deck
        </button>
      </div>
    </div>
  )
}
