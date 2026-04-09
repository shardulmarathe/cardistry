import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, m } from 'framer-motion'
import './App.css'

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs']
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const RED_SUITS = new Set(['hearts', 'diamonds'])
const SHUFFLES = ['riffle', 'overhand', 'hindu', 'faro']

const PILE_POSITION = { x: 0, y: 130, z: 0 }
const FOCUS_POSITION = { x: 0, y: -20, z: 140 }
const MotionButton = m.button
const MotionDiv = m.div

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const hashOrder = (ids) => ids.reduce((acc, id, index) => {
  let local = 0
  for (let i = 0; i < id.length; i += 1) local += id.charCodeAt(i)
  return (acc + local * (index + 17)) >>> 0
}, 2166136261)

const createSeeded = (seedValue) => {
  let seed = seedValue >>> 0
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
}

const toCardId = (rank, suit) => `${rank}${suit[0].toUpperCase()}`

const createDeck = () => {
  const deck = []
  let index = 0
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        id: toCardId(rank, suit),
        suit,
        rank,
        index,
        position: { ...PILE_POSITION },
        rotation: { x: 0, y: 0, z: 0 },
        isFaceUp: true,
        state: 'idle',
      })
      index += 1
    }
  }
  return deck
}

const buildRiffleSteps = (ids, rand) => {
  const cut = clamp(Math.floor(ids.length / 2 + (rand() - 0.5) * 6), 20, 32)
  const left = ids.slice(0, cut)
  const right = ids.slice(cut)
  const order = []
  const steps = []
  let li = 0
  let ri = 0
  while (li < left.length || ri < right.length) {
    const takeLeft = ri >= right.length || (li < left.length && rand() > 0.47)
    const batch = clamp(Math.floor(rand() * 3) + 1, 1, 3)
    for (let i = 0; i < batch; i += 1) {
      if (takeLeft && li < left.length) {
        order.push(left[li]); li += 1
      } else if (!takeLeft && ri < right.length) {
        order.push(right[ri]); ri += 1
      }
    }
    steps.push([...order, ...left.slice(li), ...right.slice(ri)])
  }
  return { steps, finalOrder: order }
}

const buildFaroSteps = (ids) => {
  const cut = Math.floor(ids.length / 2)
  const left = ids.slice(0, cut)
  const right = ids.slice(cut)
  const order = []
  const steps = []
  for (let i = 0; i < cut; i += 1) {
    order.push(left[i])
    order.push(right[i])
    steps.push([...order, ...left.slice(i + 1), ...right.slice(i + 1)])
  }
  return { steps, finalOrder: order }
}

const buildOverhandSteps = (ids, rand) => {
  const packets = []
  let cursor = 0
  while (cursor < ids.length) {
    const size = clamp(Math.floor(rand() * 7) + 3, 3, 9)
    packets.push(ids.slice(cursor, cursor + size))
    cursor += size
  }
  const order = []
  const steps = []
  packets.forEach((packet) => {
    order.unshift(...packet)
    const rest = packets.flat().filter((id) => !order.includes(id))
    steps.push([...order, ...rest])
  })
  return { steps, finalOrder: order }
}

const buildHinduSteps = (ids, rand) => {
  let source = [...ids]
  let target = []
  const steps = []
  while (source.length > 0) {
    const take = clamp(Math.floor(rand() * 6) + 2, 2, 7)
    const packet = source.slice(0, take)
    source = source.slice(packet.length)
    target = [...packet, ...target]
    steps.push([...target, ...source])
  }
  return { steps, finalOrder: target }
}

const generateShufflePlan = (deck, type) => {
  const ids = deck.map((card) => card.id)
  const seed = hashOrder(ids) + type.length * 101
  const rand = createSeeded(seed)
  switch (type) {
    case 'riffle':
      return buildRiffleSteps(ids, rand)
    case 'overhand':
      return buildOverhandSteps(ids, rand)
    case 'hindu':
      return buildHinduSteps(ids, rand)
    case 'faro':
      return buildFaroSteps(ids)
    default:
      return { steps: [ids], finalOrder: ids }
  }
}

const reorderDeck = (deck, idOrder, state = 'animating') => {
  const map = new Map(deck.map((card) => [card.id, card]))
  return idOrder.map((id, index) => ({
    ...map.get(id),
    index,
    state,
  }))
}

const cardSortMetric = (i, midpoint) => 1000 - Math.abs(i - midpoint)

const getLayoutMap = ({ deck, mode, hoveredId, selectedId }) => {
  const layout = new Map()
  const count = deck.length
  const midpoint = (count - 1) / 2

  if (mode === 'fan') {
    const angleStart = -62
    const angleEnd = 62
    const radius = 460
    deck.forEach((card, i) => {
      const t = count <= 1 ? 0.5 : i / (count - 1)
      const angle = angleStart + (angleEnd - angleStart) * t
      const rad = (angle * Math.PI) / 180
      const hover = hoveredId === card.id ? 1 : 0
      layout.set(card.id, {
        x: Math.sin(rad) * radius,
        y: PILE_POSITION.y - Math.cos(rad) * radius - 100 - hover * 8,
        rotateZ: angle * 0.9,
        rotateY: 0,
        rotateX: 0,
        scale: hover ? 1.04 : 1,
        zIndex: cardSortMetric(i, midpoint),
        state: hoveredId === card.id ? 'hovered' : 'fanned',
      })
    })
    return layout
  }

  deck.forEach((card, i) => {
    const isSelected = selectedId === card.id
    if (isSelected && mode === 'focus') {
      return
    }
    layout.set(card.id, {
      x: PILE_POSITION.x + (i % 2) * 0.15,
      y: PILE_POSITION.y - i * 0.12,
      rotateZ: (i % 2 ? -0.6 : 0.6),
      rotateY: 0,
      rotateX: 0,
      scale: 1,
      zIndex: 200 + i,
      state: 'idle',
    })
  })

  return layout
}

const CardFace = ({ card }) => {
  const suitSymbol = card.suit === 'spades' ? '♠' : card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : '♣'
  const tone = RED_SUITS.has(card.suit) ? 'red' : 'black'
  return (
    <div className={`card-face card-front ${tone}`}>
      <div className="corner tl">{card.rank}{suitSymbol}</div>
      <div className="center-symbol">{suitSymbol}</div>
      <div className="corner br">{card.rank}{suitSymbol}</div>
    </div>
  )
}

const CardBody = ({ card, selected }) => (
  <div className={`playing-card-shell ${selected ? 'selected-shell' : ''}`}>
    {card.isFaceUp ? <CardFace card={card} /> : <div className="card-face card-back" />}
  </div>
)

const DeckCard = memo(function DeckCard({
  card,
  layout,
  isFanMode,
  isSelected,
  fastMotion,
  onHover,
  onClick,
}) {
  if (!layout) return null
  return (
    <MotionButton
      type="button"
      className={`deck-card ${fastMotion ? 'fast-motion' : ''}`}
      style={{ zIndex: layout.zIndex }}
      initial={false}
      animate={{
        x: layout.x,
        y: layout.y,
        rotateX: layout.rotateX,
        rotateY: layout.rotateY,
        rotateZ: layout.rotateZ,
        scale: layout.scale,
      }}
      transition={{
        x: { type: 'spring', damping: 24, stiffness: 190, mass: 0.6 },
        y: { type: 'spring', damping: 24, stiffness: 190, mass: 0.6 },
        rotateZ: { duration: 0.62, ease: 'easeInOut' },
        scale: { duration: 0.15, ease: 'easeOut' },
      }}
      onMouseEnter={() => isFanMode && onHover(card.id)}
      onMouseLeave={() => isFanMode && onHover(null)}
      onClick={() => onClick(card.id)}
    >
      <CardBody card={card} selected={isSelected} />
    </MotionButton>
  )
})

function App() {
  const [deck, setDeck] = useState(() => createDeck())
  const [mode, setMode] = useState('stack')
  const [hoveredId, setHoveredId] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [shuffleType, setShuffleType] = useState('riffle')
  const [shuffleSpeed, setShuffleSpeed] = useState(1)
  const [shuffleSteps, setShuffleSteps] = useState([])
  const [shuffleStepIndex, setShuffleStepIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [focusRot, setFocusRot] = useState({ x: -4, y: 0 })
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [activeZone, setActiveZone] = useState(null)
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, rx: 0, ry: 0 })
  const selectedCard = useMemo(() => deck.find((card) => card.id === selectedId) || null, [deck, selectedId])

  const layoutMap = useMemo(() => getLayoutMap({ deck, mode, hoveredId, selectedId }), [deck, mode, hoveredId, selectedId])

  const beginShuffle = () => {
    const { steps } = generateShufflePlan(deck, shuffleType)
    setShuffleSteps(steps)
    setShuffleStepIndex(0)
    setMode('shuffle')
    setSelectedId(null)
    setHoveredId(null)
  }

  const applyShuffleStep = useCallback((stepIndex) => {
    if (!shuffleSteps[stepIndex]) return
    setDeck((prev) => reorderDeck(prev, shuffleSteps[stepIndex], 'animating'))
    setShuffleStepIndex(stepIndex)
  }, [shuffleSteps])

  useEffect(() => {
    if (!isPlaying || mode !== 'shuffle') return undefined
    const delay = clamp(420 / shuffleSpeed, 150, 1000)
    const timer = setTimeout(() => {
      const next = shuffleStepIndex + 1
      if (next >= shuffleSteps.length) {
        setIsPlaying(false)
        return
      }
      applyShuffleStep(next)
    }, delay)
    return () => clearTimeout(timer)
  }, [isPlaying, shuffleStepIndex, shuffleSpeed, shuffleSteps, mode, applyShuffleStep])

  useEffect(() => {
    if (!selectedId || mode !== 'focus' || dragging) return undefined
    const frame = requestAnimationFrame(() => {
      setFocusRot((prev) => ({ ...prev, y: prev.y + 0.25 }))
    })
    return () => cancelAnimationFrame(frame)
  }, [selectedId, mode, dragging, focusRot.y])

  const onSelectCard = (cardId) => {
    setSelectedId(cardId)
    setMode('focus')
    setHoveredId(null)
    setShuffleSteps([])
    setIsPlaying(false)
  }

  const onDeckCardClick = (cardId) => {
    if (mode === 'fan') onSelectCard(cardId)
  }

  const onSelectButton = () => {
    const top = deck[deck.length - 1]
    if (top) onSelectCard(top.id)
  }

  const onToggleFace = () => {
    if (!selectedId) return
    setDeck((prev) => prev.map((card) => (card.id === selectedId ? { ...card, isFaceUp: !card.isFaceUp } : card)))
  }

  const onDragStart = (event) => {
    if (!selectedCard) return
    setDragging(true)
    dragStart.current = {
      x: event.clientX,
      y: event.clientY,
      rx: focusRot.x,
      ry: focusRot.y,
    }
  }

  const onDragMove = (event) => {
    if (!dragging) return
    const dx = event.clientX - dragStart.current.x
    const dy = event.clientY - dragStart.current.y
    setDragOffset({ x: dx, y: dy })
    setFocusRot({
      x: clamp(dragStart.current.rx + dy * 0.08, -30, 30),
      y: dragStart.current.ry + dx * 0.12,
    })
    if (Math.abs(dx) < 180 && dy < -120) setActiveZone('top')
    else if (Math.abs(dx) < 180 && Math.abs(dy) <= 120) setActiveZone('middle')
    else if (Math.abs(dx) < 180 && dy > 120) setActiveZone('bottom')
    else setActiveZone(null)
  }

  const onDragEnd = () => {
    if (!selectedCard) return
    if (!activeZone) {
      setDragOffset({ x: 0, y: 0 })
      setDragging(false)
      return
    }
    setDeck((prev) => {
      const rest = prev.filter((card) => card.id !== selectedId)
      const insertion = activeZone === 'top' ? rest.length : activeZone === 'middle' ? Math.floor(rest.length / 2) : 0
      const card = prev.find((item) => item.id === selectedId)
      const merged = [...rest.slice(0, insertion), card, ...rest.slice(insertion)]
      return merged.map((entry, index) => ({ ...entry, index, state: 'inserting' }))
    })
    setDragOffset({ x: 0, y: 0 })
    setDragging(false)
    setActiveZone(null)
    setMode('stack')
    setSelectedId(null)
  }

  return (
    <div className="table-app">
      <div className="casino-bg" />
      <div className="table-vignette" />
      <main className="table-stage">
        <header className="top-controls">
          <button type="button" onClick={() => { setMode((prev) => (prev === 'fan' ? 'stack' : 'fan')); setSelectedId(null) }}>
            Fan Deck
          </button>
          <button type="button" onClick={onSelectButton}>Select Card</button>
          <button type="button" onClick={beginShuffle}>Shuffle Modes</button>
        </header>

        <section className="deck-plane">
          {deck.map((card) => (
            <DeckCard
              key={card.id}
              card={card}
              layout={layoutMap.get(card.id)}
              isFanMode={mode === 'fan'}
              isSelected={selectedId === card.id}
              fastMotion={mode === 'shuffle' && shuffleSpeed > 1.25}
              onHover={setHoveredId}
              onClick={onDeckCardClick}
            />
          ))}

          <AnimatePresence>
            {selectedCard && mode === 'focus' && (
              <MotionDiv
                className="focus-card-wrap"
                style={{ zIndex: 800 }}
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{
                  opacity: 1,
                  x: FOCUS_POSITION.x + dragOffset.x,
                  y: FOCUS_POSITION.y + dragOffset.y,
                  rotateX: focusRot.x,
                  rotateY: focusRot.y,
                  scale: 1.25,
                }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.56, ease: 'easeInOut' }}
                onPointerDown={onDragStart}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
                onPointerLeave={() => dragging && onDragEnd()}
              >
                <div className="focus-halo" />
                <CardBody card={selectedCard} selected />
              </MotionDiv>
            )}
          </AnimatePresence>

          {selectedCard && mode === 'focus' && (
            <div className="zones">
              <div className={`zone ${activeZone === 'top' ? 'active' : ''}`}>TOP</div>
              <div className={`zone ${activeZone === 'middle' ? 'active' : ''}`}>MIDDLE</div>
              <div className={`zone ${activeZone === 'bottom' ? 'active' : ''}`}>BOTTOM</div>
            </div>
          )}
        </section>

        <aside className="shuffle-panel">
          <label>
            Shuffle
            <select value={shuffleType} onChange={(event) => setShuffleType(event.target.value)}>
              {SHUFFLES.map((type) => <option key={type} value={type}>{type.toUpperCase()}</option>)}
            </select>
          </label>
          <label>
            Speed {shuffleSpeed.toFixed(2)}x
            <input
              type="range"
              min="0.25"
              max="2"
              step="0.05"
              value={shuffleSpeed}
              onChange={(event) => setShuffleSpeed(Number(event.target.value))}
            />
          </label>
          <div className="row">
            <button
              type="button"
              onClick={() => setIsPlaying((prev) => !prev)}
              disabled={mode !== 'shuffle' || shuffleSteps.length === 0}
            >
              {isPlaying ? 'Pause' : 'Play'}
            </button>
            <button
              type="button"
              onClick={() => applyShuffleStep(clamp(shuffleStepIndex + 1, 0, shuffleSteps.length - 1))}
              disabled={mode !== 'shuffle' || shuffleSteps.length === 0}
            >
              Step Forward
            </button>
          </div>
          {selectedCard && (
            <button type="button" onClick={onToggleFace}>Toggle Face</button>
          )}
        </aside>
      </main>
    </div>
  )
}

export default App
