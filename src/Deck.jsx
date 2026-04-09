import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { createDeck } from './deckModel'

const RED = new Set(['hearts', 'diamonds'])

const SUIT_SYMBOL = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
}

const CARD_W = 270
const CARD_H = 390
const DRAG_THRESHOLD_PX = 6
const FLIP_MS = 350
const FLIP_STAGGER_MS = 7
/** Position-based drop: matches spread math (card width − overlap step) */
const DROP_CARD_WIDTH = 140
const DROP_OVERLAP = 60
/** Gap between bottom of top row and top of bottom row (screen px) */
const ROW_FACE_GAP_PX = 32
/** Lift both rows so the spread sits comfortably in the deck area */
const DRAG_GROUP_LIFT_PX = 44
/** Max width of each row as a fraction of viewport (centered, not full-bleed) */
const ROW_MAX_WIDTH_FRAC = 0.65
/** Target overlap between adjacent cards (~26% of card width → ~74% step) */
const ROW_OVERLAP_FRAC = 0.26
/** Insert preview gap (kept modest so the spread stays compact) */
const INSERT_GAP_PX = 22
const BULK_FLIP_MS = FLIP_MS + 51 * FLIP_STAGGER_MS

/** Horizontal step (center-to-center) for k overlapping cards within maxRowW */
function compactRowStep(k, maxRowW) {
  if (k <= 1) return CARD_W
  const loose = CARD_W * (1 - ROW_OVERLAP_FRAC)
  const looseSpan = (k - 1) * loose + CARD_W
  if (looseSpan <= maxRowW) return loose
  const compressed = (maxRowW - CARD_W) / (k - 1)
  return Math.max(10, compressed)
}

/** Remaining-list insert slot for gap animation from drop index (0..deckLen) */
function remainingInsertSlotFromDrop(dropIdx, draggedIdx) {
  if (dropIdx == null || draggedIdx == null) return 0
  if (dropIdx <= draggedIdx) return dropIdx
  return dropIdx - 1
}

/** Drop index 0..deckLen from cursor X vs deck bounds (position-based, no hover) */
function computeDropIndex(mouseX, deckLen, rect) {
  if (!rect || deckLen < 0) return 0
  const relativeX = mouseX - rect.left
  const effectiveWidth = DROP_CARD_WIDTH - DROP_OVERLAP
  if (effectiveWidth <= 0) return 0
  const index = Math.floor(relativeX / effectiveWidth)
  return Math.max(0, Math.min(deckLen, index))
}

/** Remaining-card index j in 0..n-1 → compact overlapping two-row spread */
function getTwoRowTransform(
  j,
  n,
  viewportWidth,
  insertSlot,
) {
  if (n <= 0) return 'translate(0px, 0px) rotate(0deg)'

  const maxRowW = Math.max(300, viewportWidth * ROW_MAX_WIDTH_FRAC)
  const rowBudget = Math.max(240, maxRowW - INSERT_GAP_PX)

  const topCount = Math.ceil(n / 2)
  const row = j < topCount ? 0 : 1
  const idxInRow = row === 0 ? j : j - topCount
  const rowCount = row === 0 ? topCount : n - topCount

  const step = compactRowStep(rowCount, rowBudget)
  const firstCenterX = -((rowCount - 1) * step) / 2
  let x = firstCenterX + idxInRow * step
  if (j >= insertSlot) x += INSERT_GAP_PX

  const y =
    row === 0
      ? -(CARD_H - ROW_FACE_GAP_PX) - DRAG_GROUP_LIFT_PX
      : -DRAG_GROUP_LIFT_PX

  return `translate(${x}px, ${y}px) rotate(0deg)`
}

const PlayingCard = memo(function PlayingCard({
  card,
  isFloating,
  mouse = { x: 0, y: 0 },
  onMouseDown,
  onKeyDown,
  flipStaggerMs = 0,
}) {
  const frontUrl = `/assets/card-fronts/${card.id}.png`
  const flipped = !card.isFaceUp

  const innerStyle = {
    transitionDelay:
      flipStaggerMs > 0 ? `${flipStaggerMs}ms` : '0ms',
  }

  const inner = (
    <div className="card-inner" style={innerStyle}>
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
          '--float-x': `${mouse.x}px`,
          '--float-y': `${mouse.y - 100}px`,
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
})

const Deck = forwardRef(function Deck(_props, ref) {
  const [deck, setDeck] = useState(createDeck)
  const [isFanned, setIsFanned] = useState(false)
  const [layoutWidth, setLayoutWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1024,
  )

  const [mouseX, setMouseX] = useState(0)
  const [mouseY, setMouseY] = useState(0)
  const mouseXRef = useRef(0)
  const mouseYRef = useRef(0)

  const [draggedCardId, setDraggedCardId] = useState(null)
  const [draggedIndex, setDraggedIndex] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [isFlipping, setIsFlipping] = useState(false)
  const [bulkFlipActive, setBulkFlipActive] = useState(false)

  const deckRef = useRef(null)
  /** Measured deck bounds for drop math (avoid reading ref during render) */
  const [deckRect, setDeckRect] = useState(null)
  const draggedIndexRef = useRef(null)
  const draggedCardIdRef = useRef(null)
  const isDraggingRef = useRef(false)
  const dragSessionRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const isFlippingRef = useRef(false)

  useEffect(() => {
    const ro = () => setLayoutWidth(window.innerWidth)
    window.addEventListener('resize', ro)
    return () => window.removeEventListener('resize', ro)
  }, [])

  useEffect(() => {
    const handleMove = (e) => {
      const x = e.clientX
      const y = e.clientY
      mouseXRef.current = x
      mouseYRef.current = y
      setMouseX(x)
      setMouseY(y)

      if (!draggedCardIdRef.current) return

      const dx = x - dragStartRef.current.x
      const dy = y - dragStartRef.current.y
      const distance = Math.sqrt(dx * dx + dy * dy)

      if (!isDraggingRef.current && distance > DRAG_THRESHOLD_PX) {
        isDraggingRef.current = true
        setIsDragging(true)
        const el = deckRef.current
        if (el) {
          const r = el.getBoundingClientRect()
          setDeckRect({ left: r.left, width: r.width })
        }
      }
    }

    window.addEventListener('mousemove', handleMove)
    return () => window.removeEventListener('mousemove', handleMove)
  }, [])

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

  const clearInteractionState = useCallback(() => {
    dragSessionRef.current = false
    draggedCardIdRef.current = null
    draggedIndexRef.current = null
    isDraggingRef.current = false
    setDraggedCardId(null)
    setDraggedIndex(null)
    setIsDragging(false)
    setDeckRect(null)
  }, [])

  const flipAll = useCallback(() => {
    if (isFlippingRef.current) return
    clearInteractionState()
    isFlippingRef.current = true
    setIsFlipping(true)
    setBulkFlipActive(true)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setDeck((prev) => prev.map((c) => ({ ...c, isFaceUp: !c.isFaceUp })))
      })
    })
    window.setTimeout(() => {
      isFlippingRef.current = false
      setIsFlipping(false)
      setBulkFlipActive(false)
    }, BULK_FLIP_MS + 40)
  }, [clearInteractionState])

  const resetDeck = useCallback(() => {
    clearInteractionState()
    isFlippingRef.current = false
    setIsFlipping(false)
    setBulkFlipActive(false)
    setIsFanned(false)
    setDeck(createDeck())
  }, [clearInteractionState])

  useImperativeHandle(
    ref,
    () => ({
      flipAll,
      resetDeck,
    }),
    [flipAll, resetDeck],
  )

  const handleDrop = useCallback(() => {
    const d = draggedIndexRef.current
    if (d == null) return

    setDeck((prev) => {
      const el = deckRef.current
      const r = el?.getBoundingClientRect()
      const rect = r ? { left: r.left, width: r.width } : null
      const dropIndex = computeDropIndex(
        mouseXRef.current,
        prev.length,
        rect,
      )
      const next = [...prev]
      const [movedCard] = next.splice(d, 1)
      const adjustedIndex = d < dropIndex ? dropIndex - 1 : dropIndex
      const clamped = Math.max(0, Math.min(adjustedIndex, next.length))
      next.splice(clamped, 0, movedCard)
      return next
    })
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
      setDeckRect(null)
    }

    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [flipCard, handleDrop])

  const total = deck.length
  const spread = 180
  const angleStep = total > 1 ? spread / (total - 1) : 0
  const radius = 630

  const getFanTransform = (i) => {
    const angle = -spread / 2 + i * angleStep
    const rad = (angle * Math.PI) / 180
    const x = Math.sin(rad) * radius
    const y = -Math.cos(rad) * radius * 0.35
    return `translate(${x}px, ${y}px) rotate(${angle}deg)`
  }

  const getStackTransform = (i) =>
    `translateY(${i * -3}px) translateX(${i * 1.2}px)`

  const liveDropIndex =
    isDragging && draggedIndex != null && deckRect
      ? computeDropIndex(mouseX, deck.length, deckRect)
      : null

  const resolvePositionTransform = (deckIndex, j, nFiltered) => {
    if (draggedCardId && isDragging && draggedIndex != null) {
      const drop =
        liveDropIndex != null ? liveDropIndex : draggedIndex
      const gapSlot = remainingInsertSlotFromDrop(drop, draggedIndex)
      return getTwoRowTransform(j, nFiltered, layoutWidth, gapSlot)
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
    <div
      ref={deckRef}
      className={`deck-container${isDragging ? ' is-dragging' : ''}`}
    >
      <div
        className={`deck-stack${bulkFlipActive ? ' is-bulk-flip' : ''}`}
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

          const staggerMs =
            bulkFlipActive && !isDragging ? i * FLIP_STAGGER_MS : 0

          return (
            <div
              key={card.id}
              className="deck-card-layer"
              style={{ zIndex: i }}
              data-deck-index={i}
            >
              <div
                className="card-position"
                style={{ transform: positionTransform }}
              >
                <PlayingCard
                  card={card}
                  isFloating={false}
                  flipStaggerMs={staggerMs}
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
                    mouseXRef.current = x
                    mouseYRef.current = y
                    setMouseX(x)
                    setMouseY(y)
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

      {isDragging &&
        draggedCardId &&
        draggedCard &&
        createPortal(
          <PlayingCard
            card={draggedCard}
            isFloating
            mouse={{ x: mouseX, y: mouseY }}
          />,
          document.body,
        )}
    </div>
  )
})

export default Deck
