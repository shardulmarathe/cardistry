import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
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
/** Matches Table.css `clamp(..., 188px)` upper bound — layout math scales below this width only. */
const DESIGN_CARD_W_PX = 188
/** Usable area vs these baselines → extra shrink only below ~“comfortable” full layout (fan + chrome). */
const DECK_VIEWPORT_PAD_X = 56
const DECK_VIEWPORT_PAD_Y = 200
/** ~min inner width where an unscaled 52-card fan fits; higher → more shrink on half-width (large desktops unchanged). */
const DECK_BASELINE_INNER_WIDTH = 1320
/** Loosened so common 768px-tall laptops stay at scale 1 when width is fine. */
const DECK_BASELINE_INNER_HEIGHT = 540
/** Below ratio 1, shrink more aggressively (half-window needs a stronger step than card clamp alone). */
const DECK_VIEWPORT_TIGHT_EXPONENT = 1.62
const DECK_VIEWPORT_TIGHT_FLOOR = 0.26
/** When width is the tight dimension, pinch a bit more (fan is wide). */
const DECK_WIDTH_LIMITED_BLEED = 0.86
const BULK_FLIP_MS = FLIP_MS + 51 * FLIP_STAGGER_MS

/** 1 when the window is roomy; <1 only when width or height is tight (full-size windows unchanged). */
function viewportDeckFitScale(innerW, innerH) {
  const uw = Math.max(260, innerW - DECK_VIEWPORT_PAD_X)
  const uh = Math.max(220, innerH - DECK_VIEWPORT_PAD_Y)
  const rw = uw / DECK_BASELINE_INNER_WIDTH
  const rh = uh / DECK_BASELINE_INNER_HEIGHT

  const tight = (r) => {
    if (r >= 1) return 1
    const x = Math.max(DECK_VIEWPORT_TIGHT_FLOOR, r)
    return x ** DECK_VIEWPORT_TIGHT_EXPONENT
  }

  const sw = tight(rw)
  const sh = tight(rh)
  let out = Math.min(sw, sh)
  if (out >= 1) return 1
  if (rw < 1 && rw <= rh) {
    out *= DECK_WIDTH_LIMITED_BLEED
  }
  return Math.min(1, out)
}

/** Drop index 0..deckLen from cursor X vs deck bounds (position-based, no hover) */
function computeDropIndex(mouseX, deckLen, rect, layoutScale = 1) {
  if (!rect || deckLen < 0) return 0
  const relativeX = mouseX - rect.left
  const s = layoutScale
  const effectiveWidth = (DROP_CARD_WIDTH - DROP_OVERLAP) * s
  if (effectiveWidth <= 0) return 0
  const index = Math.floor(relativeX / effectiveWidth)
  return Math.max(0, Math.min(deckLen, index))
}

/**
 * Insert-mode adjustments ONLY (does not affect getFanTransform).
 * Horizontal layout must match normal fan endpoints — duplicate geometry below.
 */
const INSERT_PEAK_HEIGHT = 100
/** Gaussian hover spread (insert mode only). */
const INSERT_HOVER_SIGMA = 150
const INSERT_HOVER_SPREAD_AMOUNT = 30
/** Global upward shift after insert layout (visibility only; insert mode only). */
const INSERT_SHIFT_Y = 160

/** Same numbers as getFanTransform — duplicate on purpose; do not change getFanTransform. */
const NORMAL_FAN_SPREAD = 180
const NORMAL_FAN_RADIUS = 570
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

/** Max |translateX| of fan slots at layout scale 1 (matches getFanTransform / getNormalFanSlotLocal). */
function computeFanMaxAbsXAtUnitScale(totalCards) {
  if (totalCards <= 1) return 0
  let maxAbs = 0
  for (let i = 0; i < totalCards; i++) {
    const angle = fanAngleFromIndex(i, totalCards, NORMAL_FAN_SPREAD)
    const rad = (angle * Math.PI) / 180
    const x = Math.sin(rad) * NORMAL_FAN_RADIUS
    maxAbs = Math.max(maxAbs, Math.abs(x))
  }
  return maxAbs
}

/**
 * Normal-fan local slot (same math as getFanTransform) for locking insert mode X / rotation.
 */
function getNormalFanSlotLocal(i, total, layoutScale = 1) {
  if (total <= 0) {
    return { x: 0, y: 0, rotationDeg: 0 }
  }
  const radius = NORMAL_FAN_RADIUS * layoutScale
  const angle = fanAngleFromIndex(i, total, NORMAL_FAN_SPREAD)
  const rad = (angle * Math.PI) / 180
  const x = Math.sin(rad) * radius
  const y = -Math.cos(rad) * radius * NORMAL_FAN_Y_FACTOR
  return { x, y, rotationDeg: angle }
}

/** Horizontal nudge from cursor — gaussian falloff, no effect far from pointer. */
function insertHoverSpreadDeltaX(baseLocalX, anchorCx, mouseX, layoutScale = 1) {
  const cardX = anchorCx + baseLocalX
  const dx = cardX - mouseX
  const sigma = INSERT_HOVER_SIGMA * layoutScale
  const influence = Math.exp(-(dx * dx) / (2 * sigma * sigma))
  if (dx === 0) return 0
  return influence * INSERT_HOVER_SPREAD_AMOUNT * layoutScale * Math.sign(dx)
}

function getInsertLayoutForSlot(i, count, anchorCx, mouseX, layoutScale = 1) {
  if (count <= 0) {
    return {
      localX: 0,
      localY: 0,
      rotationDeg: 0,
      screenX: anchorCx,
    }
  }
  const s = layoutScale
  const { x: baseX, y: baseY, rotationDeg } = getNormalFanSlotLocal(i, count, s)
  const t = count <= 1 ? 0 : i / (count - 1)
  const centerDist = Math.abs(t - 0.5) * 2
  const lift = (1 - centerDist) ** 2 * INSERT_PEAK_HEIGHT * s
  const localY = baseY - lift - INSERT_SHIFT_Y * s
  const offsetX = insertHoverSpreadDeltaX(baseX, anchorCx, mouseX, s)
  const localX = baseX + offsetX
  const screenX = anchorCx + localX
  return { localX, localY, rotationDeg, screenX }
}

function getInsertFanTransform(i, count, anchorCx, mouseX, layoutScale = 1) {
  if (count <= 0) return 'translate(0px, 0px) rotate(0deg)'
  const p = getInsertLayoutForSlot(i, count, anchorCx, mouseX, layoutScale)
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

  /**
   * Card-size ratio (from CSS) × viewport fit — both are 1 on a large maximized window;
   * half-screen gets a stronger combined shrink without changing full-size behavior.
   */
  const deckBaseLayoutScale = useMemo(() => {
    if (typeof window === 'undefined') return 1
    const rootStyle = window.getComputedStyle(document.documentElement)
    const w = Number.parseFloat(rootStyle.getPropertyValue('--card-w'))
    const cw = Number.isFinite(w) && w > 0 ? w : DESIGN_CARD_W_PX
    const cardScale = Math.min(1, cw / DESIGN_CARD_W_PX)
    const vp = viewportDeckFitScale(layoutWidth, layoutHeight)
    return cardScale * vp
  }, [layoutWidth, layoutHeight])

  /**
   * Hard cap from the real deck-stack width so the fanned arc cannot clip (Infinity = no cap).
   * Large windows: raw >= 1 → Infinity → final scale equals deckBaseLayoutScale (unchanged).
   */
  const [fanWidthCapScale, setFanWidthCapScale] = useState(Number.POSITIVE_INFINITY)

  const deckLayoutScale = useMemo(() => {
    if (!isFanned) return deckBaseLayoutScale
    if (
      !Number.isFinite(fanWidthCapScale) ||
      fanWidthCapScale === Number.POSITIVE_INFINITY
    ) {
      return deckBaseLayoutScale
    }
    return Math.min(deckBaseLayoutScale, fanWidthCapScale)
  }, [isFanned, deckBaseLayoutScale, fanWidthCapScale])

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

    if (!isFanned) {
      setFanWidthCapScale(Number.POSITIVE_INFINITY)
      return
    }

    const rootStyle = window.getComputedStyle(document.documentElement)
    const cwParsed = Number.parseFloat(rootStyle.getPropertyValue('--card-w'))
    const cw =
      Number.isFinite(cwParsed) && cwParsed > 0 ? cwParsed : DESIGN_CARD_W_PX

    const n = deck.length
    const maxFanX = computeFanMaxAbsXAtUnitScale(n)
    if (n <= 1 || maxFanX <= 0) {
      setFanWidthCapScale(Number.POSITIVE_INFINITY)
      return
    }

    /** Margins inside the stack box + rotated card corners vs pure translateX. */
    const horizontalBleedPx = 72
    const cornerFudgePx = cw * 0.58
    const usable = Math.max(72, r.width - horizontalBleedPx)
    const halfFootprintAtScale1 = maxFanX + cornerFudgePx
    let raw = (usable - cw) / (2 * halfFootprintAtScale1)
    raw *= 0.9

    if (!Number.isFinite(raw) || raw >= 1) {
      setFanWidthCapScale(Number.POSITIVE_INFINITY)
    } else {
      setFanWidthCapScale(Math.max(0.12, raw))
    }
  }, [
    isFanned,
    isDraggingCard,
    layoutWidth,
    layoutHeight,
    deck.length,
    bulkFlipActive,
    deckBaseLayoutScale,
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
          deckLayoutScale,
        )
        insertAt = d < dropIndex ? dropIndex - 1 : dropIndex
      }

      const clamped = Math.max(0, Math.min(insertAt, next.length))
      next.splice(clamped, 0, movedCard)
      return next
    })
  }, [deckLayoutScale])

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
  const radius = NORMAL_FAN_RADIUS * deckLayoutScale

  const getFanTransform = (i) => {
    const angle = fanAngleFromIndex(i, total, spread)
    const rad = (angle * Math.PI) / 180
    const x = Math.sin(rad) * radius
    const y = -Math.cos(rad) * radius * NORMAL_FAN_Y_FACTOR
    return `translate(${x}px, ${y}px) rotate(${angle}deg)`
  }

  const getStackTransform = (i) => getDeckStackTransform(i, deckLayoutScale)

  const nVisibleFan =
    isDraggingCard && draggedCardId ? deck.length - 1 : deck.length

  const isInserting =
    isDraggingCard && Boolean(draggedCardId) && isFanned && nVisibleFan > 0

  /** "normal" | "inserting" — inserting uses only the separate insert arc helpers above. */
  const layoutMode = isInserting ? 'inserting' : 'normal'

  const insertPositions =
    layoutMode === 'inserting'
      ? Array.from({ length: nVisibleFan }, (_, j) => ({
          x: getInsertLayoutForSlot(
            j,
            nVisibleFan,
            stackAnchor.cx,
            mouseX,
            deckLayoutScale,
          ).screenX,
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
        deckLayoutScale,
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
      style={{ '--deck-layout-scale': String(deckLayoutScale) }}
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
            layoutScale={deckLayoutScale}
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
