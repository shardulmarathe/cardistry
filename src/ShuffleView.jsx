import { useCallback, useRef, useState } from 'react'
import { PlayingCard } from './Deck'

const MOVE_MS = 420
const SPLIT_PAUSE_MS = 380
const CHUNK_MS = 88
const RETURN_MS = 420

function wait(ms) {
  return new Promise((r) => window.setTimeout(r, ms))
}

function rand13() {
  return 1 + Math.floor(Math.random() * 3)
}

/** Alternating chunks of 1–3 cards until both halves are consumed. */
function buildRiffleChunks(left, right) {
  const L = [...left]
  const R = [...right]
  const chunks = []
  let preferLeft = Math.random() > 0.5

  while (L.length > 0 || R.length > 0) {
    if (preferLeft && L.length > 0) {
      const n = Math.min(L.length, rand13())
      chunks.push({ side: 'left', cards: L.splice(0, n) })
    } else if (!preferLeft && R.length > 0) {
      const n = Math.min(R.length, rand13())
      chunks.push({ side: 'right', cards: R.splice(0, n) })
    } else if (L.length > 0) {
      const n = Math.min(L.length, rand13())
      chunks.push({ side: 'left', cards: L.splice(0, n) })
    } else if (R.length > 0) {
      const n = Math.min(R.length, rand13())
      chunks.push({ side: 'right', cards: R.splice(0, n) })
    }
    preferLeft = !preferLeft
  }

  return chunks
}

function mergedFromChunks(chunks) {
  return chunks.flatMap((c) => c.cards)
}

export default function ShuffleView({ deck, setDeck }) {
  const [phase, setPhase] = useState('idle')
  const [deckPos, setDeckPos] = useState('corner')
  const [leftPack, setLeftPack] = useState([])
  const [rightPack, setRightPack] = useState([])
  const [centerPile, setCenterPile] = useState([])
  const runningRef = useRef(false)

  const busy = phase !== 'idle'

  const runRiffle = useCallback(async () => {
    if (runningRef.current || deck.length < 2) return
    runningRef.current = true
    const snapshot = [...deck]
    const half = Math.floor(snapshot.length / 2)
    const L0 = snapshot.slice(0, half)
    const R0 = snapshot.slice(half)

    try {
      setCenterPile([])
      setLeftPack([])
      setRightPack([])
      setPhase('prep')
      setDeckPos('center')
      await wait(MOVE_MS)

      setLeftPack(L0)
      setRightPack(R0)
      setPhase('split')
      await wait(SPLIT_PAUSE_MS)

      const chunks = buildRiffleChunks(L0, R0)
      const merged = mergedFromChunks(chunks)

      let remL = [...L0]
      let remR = [...R0]
      let acc = []
      setPhase('riffling')

      for (const chunk of chunks) {
        if (chunk.side === 'left') {
          remL = remL.slice(chunk.cards.length)
        } else {
          remR = remR.slice(chunk.cards.length)
        }
        acc = acc.concat(chunk.cards)
        setLeftPack([...remL])
        setRightPack([...remR])
        setCenterPile([...acc])
        await wait(CHUNK_MS)
      }

      setDeck(merged)
      setLeftPack([])
      setRightPack([])
      setCenterPile([])
      setPhase('returning')
      setDeckPos('corner')
      await wait(RETURN_MS)
    } finally {
      setPhase('idle')
      runningRef.current = false
    }
  }, [deck, setDeck])

  const methods = [
    { id: 'riffle', label: 'Riffle Shuffle', active: true, onClick: runRiffle },
    { id: 'overhand', label: 'Overhand', active: false },
    { id: 'hindu', label: 'Hindu', active: false },
    { id: 'pile', label: 'Pile', active: false },
    { id: 'faro', label: 'Faro', active: false },
    { id: 'random', label: 'Random', active: false },
  ]

  const showSplit = phase === 'split' || phase === 'riffling'
  const showCenter = phase === 'riffling' && centerPile.length > 0
  const showSingleStack =
    phase === 'idle' || phase === 'prep' || phase === 'returning'

  return (
    <div className="shuffle-view">
      <div
        className={`shuffle-deck-host shuffle-deck-host--${deckPos}${
          busy ? ' shuffle-deck-host--busy' : ''
        }`}
        aria-hidden={showSplit}
      >
        {showSingleStack && (
          <div className="shuffle-mini-stack">
            {deck.map((card, i) => (
              <div
                key={card.id}
                className="shuffle-mini-layer"
                style={{
                  zIndex: i,
                  transform: `translate(${i * 1.2}px, ${i * -2.5}px)`,
                }}
              >
                <PlayingCard
                  card={card}
                  isFloating={false}
                  onMouseDown={(e) => e.preventDefault()}
                  onKeyDown={(e) => e.preventDefault()}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="shuffle-stage" aria-live="polite">
        {showSplit && (
          <div className="shuffle-split">
            <div className="shuffle-half shuffle-half--left">
              <div className="shuffle-half-stack">
                {leftPack.map((card, i) => (
                  <div
                    key={`L-${card.id}`}
                    className="shuffle-mini-layer"
                    style={{
                      zIndex: i,
                      transform: `translate(${i * 1}px, ${i * -2}px)`,
                    }}
                  >
                    <PlayingCard
                      card={card}
                      isFloating={false}
                      onMouseDown={(e) => e.preventDefault()}
                      onKeyDown={(e) => e.preventDefault()}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="shuffle-half shuffle-half--right">
              <div className="shuffle-half-stack">
                {rightPack.map((card, i) => (
                  <div
                    key={`R-${card.id}`}
                    className="shuffle-mini-layer"
                    style={{
                      zIndex: i,
                      transform: `translate(${i * 1}px, ${i * -2}px)`,
                    }}
                  >
                    <PlayingCard
                      card={card}
                      isFloating={false}
                      onMouseDown={(e) => e.preventDefault()}
                      onKeyDown={(e) => e.preventDefault()}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {showCenter && centerPile.length > 0 && (
          <div className="shuffle-center-pile">
            {centerPile.map((card, i) => (
              <div
                key={`C-${card.id}-${i}`}
                className="shuffle-mini-layer shuffle-center-card"
                style={{
                  zIndex: i,
                  transform: `translate(${i * 0.4}px, ${i * -1.2}px)`,
                }}
              >
                <PlayingCard
                  card={card}
                  isFloating={false}
                  onMouseDown={(e) => e.preventDefault()}
                  onKeyDown={(e) => e.preventDefault()}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="shuffle-options">
        <h2 className="shuffle-options-title">Shuffle methods</h2>
        <div className="shuffle-grid">
          {methods.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`shuffle-method${m.active ? ' shuffle-method--active' : ''}`}
              disabled={busy || !m.active}
              onClick={m.onClick}
            >
              {m.label}
              {!m.active && <span className="shuffle-method-badge">Soon</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
