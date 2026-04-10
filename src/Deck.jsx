import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { createDeck } from './deckModel'
import PlayingCard from './PlayingCard'
import DeckStack, { getDeckStackTransform } from './DeckStack'

const DRAG_THRESHOLD_PX = 6
const FLIP_MS = 350
const FLIP_STAGGER_MS = 7
/** Position-based drop: matches spread math (card width − overlap step) */
const DROP_CARD_WIDTH = 140
const DROP_OVERLAP = 60
const BULK_FLIP_MS = FLIP_MS + 51 * FLIP_STAGGER_MS

/** Drop index 0..deckLen from cursor X vs deck bounds (position-based, no hover) */
function computeDropIndex(mouseX, deckLen, rect) {
  if (!rect || deckLen < 0) return 0
  const relativeX = mouseX - rect.left
  const effectiveWidth = DROP_CARD_WIDTH - DROP_OVERLAP
  if (effectiveWidth <= 0) return 0
  const index = Math.floor(relativeX / effectiveWidth)
  return Math.max(0, Math.min(deckLen, index))
}

/**
 * Insert-mode adjustments ONLY (does not affect getFanTransform).
 * Horizontal layout must match normal fan endpoints — duplicate geometry below.
 */
const INSERT_PEAK_HEIGHT = 150
/** Gaussian hover spread (insert mode only). */
const INSERT_HOVER_SIGMA = 150
const INSERT_HOVER_SPREAD_AMOUNT = 30
/** Global upward shift after insert layout (visibility only; insert mode only). */
const INSERT_SHIFT_Y = 160

/** Same numbers as getFanTransform — duplicate on purpose; do not change getFanTransform. */
const NORMAL_FAN_SPREAD = 180
const NORMAL_FAN_RADIUS = 510
const NORMAL_FAN_Y_FACTOR = 0.47
const NORMAL_FAN_EDGE_BIAS = 1.6
const NORMAL_FAN_EDGE_BLEND = 0.35

function fanAngleFromIndex(i, total, spread) {
  if (total <= 1) return 0
  const t = i / (total - 1) // 0..1
  const u = t * 2 - 1 // -1..1
  const centerOpen = Math.sign(u) * Math.abs(u) ** NORMAL_FAN_EDGE_BIAS
  const warped =
    u * (1 - NORMAL_FAN_EDGE_BLEND) + centerOpen * NORMAL_FAN_EDGE_BLEND
  return warped * (spread / 2)
}

/**
 * Normal-fan local slot (same math as getFanTransform) for locking insert mode X / rotation.
 */
function getNormalFanSlotLocal(i, total) {
  if (total <= 0) {
    return { x: 0, y: 0, rotationDeg: 0 }
  }
  const angle = fanAngleFromIndex(i, total, NORMAL_FAN_SPREAD)
  const rad = (angle * Math.PI) / 180
  const x = Math.sin(rad) * NORMAL_FAN_RADIUS
  const y = -Math.cos(rad) * NORMAL_FAN_RADIUS * NORMAL_FAN_Y_FACTOR
  return { x, y, rotationDeg: angle }
}

/** Horizontal nudge from cursor — gaussian falloff, no effect far from pointer. */
function insertHoverSpreadDeltaX(baseLocalX, anchorCx, mouseX) {
  const cardX = anchorCx + baseLocalX
  const dx = cardX - mouseX
  const sigma = INSERT_HOVER_SIGMA
  const influence = Math.exp(-(dx * dx) / (2 * sigma * sigma))
  if (dx === 0) return 0
  return influence * INSERT_HOVER_SPREAD_AMOUNT * Math.sign(dx)
}

function getInsertLayoutForSlot(i, count, anchorCx, mouseX) {
  if (count <= 0) {
    return {
      localX: 0,
      localY: 0,
      rotationDeg: 0,
      screenX: anchorCx,
    }
  }
  const { x: baseX, y: baseY, rotationDeg } = getNormalFanSlotLocal(i, count)
  const t = count <= 1 ? 0 : i / (count - 1)
  const centerDist = Math.abs(t - 0.5) * 2
  const lift = (1 - centerDist) ** 2 * INSERT_PEAK_HEIGHT
  const localY = baseY - lift - INSERT_SHIFT_Y
  const offsetX = insertHoverSpreadDeltaX(baseX, anchorCx, mouseX)
  const localX = baseX + offsetX
  const screenX = anchorCx + localX
  return { localX, localY, rotationDeg, screenX }
}

function getInsertFanTransform(i, count, anchorCx, mouseX) {
  if (count <= 0) return 'translate(0px, 0px) rotate(0deg)'
  const p = getInsertLayoutForSlot(i, count, anchorCx, mouseX)
  return `translate(${p.localX}px, ${p.localY}px) rotate(${p.rotationDeg}deg)`
}

/**
 * Layout-first drop: argmin_i |dragX - positions[i].x| → insert index (same order as fan slots).
 * dragX = pointer X (floating card follows cursor).
 */
function getInsertIndexFromLayout(dragX, positions) {
  if (!positions.length) return 0
  let closestIndex = 0
  let minDist = Infinity
  for (let i = 0; i < positions.length; i++) {
    const d = Math.abs(dragX - positions[i].x)
    if (d < minDist) {
      minDist = d
      closestIndex = i
    }
  }
  return closestIndex
}

const Deck = forwardRef(function Deck({ deck, setDeck }, ref) {
  const [isFanned, setIsFanned] = useState(false)
  const [layoutWidth, setLayoutWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1024,
  )
  const [layoutHeight, setLayoutHeight] = useState(
    typeof window !== 'undefined' ? window.innerHeight : 800,
  )
  /** Pivot: stack center X and bottom Y (client coords) for screen → local insert transforms */
  const [stackAnchor, setStackAnchor] = useState(() =>
    typeof window !== 'undefined'
      ? {
          cx: window.innerWidth / 2,
          by: window.innerHeight * 0.95,
        }
      : { cx: 0, by: 0 },
  )

  const [mouseX, setMouseX] = useState(0)
  const [mouseY, setMouseY] = useState(0)
  const mouseXRef = useRef(0)
  const mouseYRef = useRef(0)

  const [draggedCardId, setDraggedCardId] = useState(null)
  const [draggedIndex, setDraggedIndex] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  /** True only while actively dragging a card (after move threshold). Drives insert-arc layout. */
  const [isDraggingCard, setIsDraggingCard] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [isFlipping, setIsFlipping] = useState(false)
  const [bulkFlipActive, setBulkFlipActive] = useState(false)

  const deckRef = useRef(null)
  const deckStackRef = useRef(null)
  /** Screen X of each visible slot (same order as insert layout) — read on drop before state clears. */
  const insertDropPositionsRef = useRef([])
  const isFannedRef = useRef(false)
  const draggedIndexRef = useRef(null)
  const draggedCardIdRef = useRef(null)
  const isDraggingRef = useRef(false)
  const dragSessionRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const isFlippingRef = useRef(false)

  useEffect(() => {
    const ro = () => {
      setLayoutWidth(window.innerWidth)
      setLayoutHeight(window.innerHeight)
    }
    window.addEventListener('resize', ro)
    return () => window.removeEventListener('resize', ro)
  }, [])

  useLayoutEffect(() => {
    const el = deckStackRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setStackAnchor({
      cx: r.left + r.width / 2,
      by: r.bottom,
    })
  }, [
    isFanned,
    isDraggingCard,
    layoutWidth,
    layoutHeight,
    deck.length,
    bulkFlipActive,
  ])

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
        setIsDraggingCard(true)
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
    setIsDraggingCard(false)
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
  }, [clearInteractionState, setDeck])

  const resetDeck = useCallback(() => {
    clearInteractionState()
    isFlippingRef.current = false
    setIsFlipping(false)
    setBulkFlipActive(false)
    setIsFanned(false)
    setDeck(createDeck())
  }, [clearInteractionState, setDeck])

  useImperativeHandle(
    ref,
    () => ({
      flipAll,
      resetDeck,
    }),
    [flipAll, resetDeck],
  )

  isFannedRef.current = isFanned

  const handleDrop = useCallback(() => {
    const d = draggedIndexRef.current
    if (d == null) return

    setDeck((prev) => {
      const insertPositions = insertDropPositionsRef.current
      const useInsertDrop =
        isFannedRef.current &&
        insertPositions.length > 0 &&
        insertPositions.length === prev.length - 1

      const next = [...prev]
      const [movedCard] = next.splice(d, 1)

      let insertAt
      if (useInsertDrop) {
        insertAt = getInsertIndexFromLayout(mouseXRef.current, insertPositions)
      } else {
        const el = deckRef.current
        const r = el?.getBoundingClientRect()
        const rect = r ? { left: r.left, width: r.width } : null
        const dropIndex = computeDropIndex(
          mouseXRef.current,
          prev.length,
          rect,
        )
        insertAt = d < dropIndex ? dropIndex - 1 : dropIndex
      }

      const clamped = Math.max(0, Math.min(insertAt, next.length))
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
      setIsDraggingCard(false)
      draggedCardIdRef.current = null
      setDraggedCardId(null)
      draggedIndexRef.current = null
      setDraggedIndex(null)
    }

    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [flipCard, handleDrop])

  const total = deck.length
  const spread = NORMAL_FAN_SPREAD
  const radius = NORMAL_FAN_RADIUS

  const getFanTransform = (i) => {
    const angle = fanAngleFromIndex(i, total, spread)
    const rad = (angle * Math.PI) / 180
    const x = Math.sin(rad) * radius
    const y = -Math.cos(rad) * radius * NORMAL_FAN_Y_FACTOR
    return `translate(${x}px, ${y}px) rotate(${angle}deg)`
  }

  const getStackTransform = getDeckStackTransform

  const nVisibleFan =
    isDraggingCard && draggedCardId ? deck.length - 1 : deck.length

  const isInserting =
    isDraggingCard && Boolean(draggedCardId) && isFanned && nVisibleFan > 0

  /** "normal" | "inserting" — inserting uses only the separate insert arc helpers above. */
  const layoutMode = isInserting ? 'inserting' : 'normal'

  const insertPositions =
    layoutMode === 'inserting'
      ? Array.from({ length: nVisibleFan }, (_, j) => ({
          x: getInsertLayoutForSlot(j, nVisibleFan, stackAnchor.cx, mouseX)
            .screenX,
        }))
      : []

  insertDropPositionsRef.current = insertPositions

  const resolvePositionTransform = (deckIndex, slotIndex) => {
    if (layoutMode === 'inserting') {
      return getInsertFanTransform(
        slotIndex,
        nVisibleFan,
        stackAnchor.cx,
        mouseX,
      )
    }
    if (isFanned) return getFanTransform(deckIndex)
    return getStackTransform(deckIndex)
  }

  const draggedCard =
    isDragging && draggedCardId
      ? deck.find((c) => c.id === draggedCardId)
      : null

  return (
    <div
      ref={deckRef}
      className={`deck-container${isDragging ? ' is-dragging' : ''}${
        layoutMode === 'inserting' ? ' is-insert-arc' : ''
      }`}
    >
      <div className="deck-position-wrap">
        {!isFanned ? (
          <DeckStack
            ref={deckStackRef}
            cards={deck}
            className={bulkFlipActive ? ' is-bulk-flip' : ''}
            omitCardId={isDragging ? draggedCardId : undefined}
            isDragging={isDragging}
            bulkFlipActive={bulkFlipActive}
            flipStaggerMsStep={FLIP_STAGGER_MS}
            onStackClick={(e) => {
              if (draggedCardId) return
              if (e.target !== e.currentTarget) return
              setIsFanned(!isFanned)
            }}
            onCardMouseDown={(e, card, i) => {
              e.stopPropagation()
              e.preventDefault()
              const x = e.clientX
              const y = e.clientY
              dragStartRef.current = { x, y }
              setDragStart({ x, y })
              isDraggingRef.current = false
              setIsDragging(false)
              setIsDraggingCard(false)
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
            onCardKeyDown={(e, card) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                if (!isFlippingRef.current) flipCard(card.id)
              }
            }}
          />
        ) : (
          <div
            ref={deckStackRef}
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

              const slotIndex = deck
                .slice(0, i)
                .filter((c) => !(isDragging && c.id === draggedCardId)).length

              const positionTransform = resolvePositionTransform(i, slotIndex)

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
                        setIsDraggingCard(false)
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
        )}
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

export { default as PlayingCard } from './PlayingCard'
export default Deck
