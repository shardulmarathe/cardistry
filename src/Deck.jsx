import { useCallback, useEffect, useRef, useState } from 'react'
import { createDeck } from './deckModel'

const RED = new Set(['hearts', 'diamonds'])

const SUIT_SYMBOL = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
}

const CARD_W = 180
const CARD_H = 260
const FLOAT_OFFSET_X = 70
const FLOAT_OFFSET_Y = 180
const DRAG_THRESHOLD_PX = 6
const FLIP_MS = 600

function PlayingCard({
  card,
  isFloating,
  mouse = { x: 0, y: 0 },
  onMouseDown,
  onKeyDown,
}) {
  const frontUrl = `/assets/card-fronts/${card.id}.png`
  const flipped = !card.isFaceUp

  const inner = (
    <div className="card-inner">
      <div className="card-front">
        <div className={`card-front-fallback ${RED.has(card.suit) ? 'red' : 'black'}`}>
          <span className="card-front-corner tl">
            {card.rank}
            <span className="card-suit">{SUIT_SYMBOL[card.suit]}</span>
          </span>
          <span className="card-front-center">{SUIT_SYMBOL[card.suit]}</span>
          <span className="card-front-corner br">
            {card.rank}
            <span className="card-suit">{SUIT_SYMBOL[card.suit]}</span>
          </span>
        </div>
        <img
          src={frontUrl}
          alt=""
          className="card-front-photo"
          loading="lazy"
          decoding="async"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
        />
      </div>
      <div className="card-back" aria-hidden />
    </div>
  )

  if (isFloating) {
    return (
      <div
        className={`card floating${flipped ? ' flipped' : ''}`}
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          width: CARD_W,
          height: CARD_H,
          zIndex: 9999,
          pointerEvents: 'none',
          transform: `
            translate(${mouse.x - FLOAT_OFFSET_X}px, ${mouse.y - FLOAT_OFFSET_Y}px)
            rotate(-4deg)
            scale(1.08)
          `,
        }}
      >
        {inner}
      </div>
    )
  }

  return (
    <div
      className={`card${flipped ? ' flipped' : ''}`}
      aria-label={`Flip or drag ${card.id}`}
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
      role="button"
      tabIndex={0}
    >
      {inner}
    </div>
  )
}

export default function Deck() {
  const [deck, setDeck] = useState(createDeck)
  const [isFanned, setIsFanned] = useState(false)

  const [draggedCardId, setDraggedCardId] = useState(null)
  const [draggedIndex, setDraggedIndex] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [mouse, setMouse] = useState({ x: 0, y: 0 })
  const [hoverIndex, setHoverIndex] = useState(null)
  const [isFlipping, setIsFlipping] = useState(false)

  const hoverIndexRef = useRef(null)
  const draggedIndexRef = useRef(null)
  const draggedCardIdRef = useRef(null)
  const isDraggingRef = useRef(false)
  const dragSessionRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const isFlippingRef = useRef(false)

  useEffect(() => {
    hoverIndexRef.current = hoverIndex
  }, [hoverIndex])

  useEffect(() => {
    draggedIndexRef.current = draggedIndex
  }, [draggedIndex])

  useEffect(() => {
    dragStartRef.current = dragStart
  }, [dragStart])

  useEffect(() => {
    isDraggingRef.current = isDragging
  }, [isDragging])

  useEffect(() => {
    isFlippingRef.current = isFlipping
  }, [isFlipping])

  useEffect(() => {
    const onMove = (e) => {
      const x = e.clientX
      const y = e.clientY
      setMouse({ x, y })

      if (!draggedCardIdRef.current) return

      const dx = x - dragStartRef.current.x
      const dy = y - dragStartRef.current.y
      const distance = Math.sqrt(dx * dx + dy * dy)

      if (!isDraggingRef.current && distance > DRAG_THRESHOLD_PX) {
        isDraggingRef.current = true
        setIsDragging(true)
        const di = draggedIndexRef.current
        if (di !== null) {
          setHoverIndex(di)
          hoverIndexRef.current = di
        }
      }
    }

    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  const flipCard = useCallback((id) => {
    if (isFlippingRef.current) return
    isFlippingRef.current = true
    setIsFlipping(true)
    setDeck((prev) =>
      prev.map((c) => (c.id === id ? { ...c, isFaceUp: !c.isFaceUp } : c)),
    )
    window.setTimeout(() => {
      isFlippingRef.current = false
      setIsFlipping(false)
    }, FLIP_MS)
  }, [])

  const handleDrop = useCallback(() => {
    const h = hoverIndexRef.current
    const d = draggedIndexRef.current

    // Debug: if hoverIndex never changes, onMouseEnter is not firing
    console.log('draggedIndex:', d, 'hoverIndex:', h)

    if (h === null || d === null) return

    setDeck((prev) => {
      const updated = [...prev]
      const [removed] = updated.splice(d, 1)
      let insertAt = h
      if (h > d) insertAt = h - 1
      insertAt = Math.max(0, Math.min(insertAt, updated.length))
      updated.splice(insertAt, 0, removed)
      return updated
    })
  }, [])

  useEffect(() => {
    const onUp = () => {
      if (!dragSessionRef.current) return
      dragSessionRef.current = false

      const id = draggedCardIdRef.current
      if (!id) return

      const dragging = isDraggingRef.current

      if (dragging) {
        handleDrop()
      } else if (!isFlippingRef.current) {
        flipCard(id)
      }

      isDraggingRef.current = false
      setIsDragging(false)
      draggedCardIdRef.current = null
      setDraggedCardId(null)
      draggedIndexRef.current = null
      setDraggedIndex(null)
      setHoverIndex(null)
      hoverIndexRef.current = null
    }

    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [flipCard, handleDrop])

  const total = deck.length
  const spread = 180
  const angleStep = total > 1 ? spread / (total - 1) : 0
  const radius = 420

  const getFanTransform = (i) => {
    const angle = -spread / 2 + i * angleStep
    const rad = (angle * Math.PI) / 180
    const x = Math.sin(rad) * radius
    const y = -Math.cos(rad) * radius * 0.35
    return `translate(${x}px, ${y}px) rotate(${angle}deg)`
  }

  const getStackTransform = (i) =>
    `translateY(${i * -2}px) translateX(${i * 0.8}px)`

  const getLineTransform = (deckIndex, j, nFiltered) => {
    const spacing = 30
    let x = (j - (nFiltered - 1) / 2) * spacing
    if (hoverIndex !== null) {
      if (deckIndex >= hoverIndex) x += 20
      else x -= 20
    }
    return `translate(${x}px, 0px) rotate(0deg)`
  }

  const resolvePositionTransform = (deckIndex, j, nFiltered) => {
    if (draggedCardId && isDragging) {
      return getLineTransform(deckIndex, j, nFiltered)
    }
    if (isFanned) return getFanTransform(deckIndex)
    return getStackTransform(deckIndex)
  }

  const draggedCard =
    isDragging && draggedCardId
      ? deck.find((c) => c.id === draggedCardId)
      : null

  const nVisible = isDragging && draggedCardId ? deck.length - 1 : deck.length

  return (
    <div className={`deck-container${isDragging ? ' is-dragging' : ''}`}>
      <div
        className="deck-stack"
        onClick={(e) => {
          if (draggedCardId) return
          if (e.target !== e.currentTarget) return
          setIsFanned(!isFanned)
        }}
        role="presentation"
      >
        {deck.map((card, i) => {
          if (isDragging && card.id === draggedCardId) {
            return null
          }

          const j = deck
            .slice(0, i)
            .filter((c) => !(isDragging && c.id === draggedCardId)).length

          const positionTransform = resolvePositionTransform(
            i,
            j,
            nVisible,
          )

          return (
            <div
              key={card.id}
              className="deck-card-layer"
              style={{ zIndex: i }}
              onMouseEnter={() => {
                if (!isDragging) return
                console.log(
                  'draggedIndex:',
                  draggedIndexRef.current,
                  'hoverIndex:',
                  i,
                )
                setHoverIndex(i)
                hoverIndexRef.current = i
              }}
            >
              <div
                className="card-position"
                style={{ transform: positionTransform }}
              >
                <PlayingCard
                  card={card}
                  isFloating={false}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    const x = e.clientX
                    const y = e.clientY
                    dragStartRef.current = { x, y }
                    setDragStart({ x, y })
                    isDraggingRef.current = false
                    setIsDragging(false)
                    draggedCardIdRef.current = card.id
                    setDraggedCardId(card.id)
                    draggedIndexRef.current = i
                    setDraggedIndex(i)
                    dragSessionRef.current = true
                    setHoverIndex(null)
                    hoverIndexRef.current = null
                    setMouse({ x, y })
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      e.stopPropagation()
                      if (!isFlippingRef.current) flipCard(card.id)
                    }
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>

      {isDragging && draggedCardId && draggedCard && (
        <PlayingCard
          card={draggedCard}
          isFloating
          mouse={mouse}
        />
      )}
    </div>
  )
}
