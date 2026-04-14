import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import DeckStack from './DeckStack'
import PlayingCard from './PlayingCard'

const MOVE_MS = 420
const SPLIT_PAUSE_MS = 420
const SPREAD_MS = 450
const MERGE_MS = 420
const RETURN_MS = 420
const STAGGER_MS = 26
const OVERHAND_ROUNDS_MIN = 3
const OVERHAND_ROUNDS_MAX = 7
const OVERHAND_SPLIT_MS = 620
const OVERHAND_COLLECT_STAGGER_MS = 46
const WASH_SCATTER_MS = 620
const WASH_HOLD_MS = 520
const WASH_GATHER_STAGGER_MS = 26
const WASH_FINAL_COMPRESS_MS = 360

function wait(ms) {
  return new Promise((r) => window.setTimeout(r, ms))
}

/** Strict alternating interleave */
function alternateMerge(left, right) {
  const L = [...left]
  const R = [...right]
  const out = []
  while (L.length || R.length) {
    if (L.length) out.push(L.shift())
    if (R.length) out.push(R.shift())
  }
  return out
}

function randRot() {
  return Math.random() * 6 - 3
}

function makeRotMap(cards) {
  const rots = {}
  for (const card of cards) rots[card.id] = randRot()
  return rots
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

function readCardSize() {
  if (typeof document === 'undefined') {
    return { w: 235, h: 339 }
  }
  const rootStyle = window.getComputedStyle(document.documentElement)
  const w = Number.parseFloat(rootStyle.getPropertyValue('--card-w'))
  const h = Number.parseFloat(rootStyle.getPropertyValue('--card-h'))
  const safeW = Number.isFinite(w) && w > 0 ? w : 235
  const safeH = Number.isFinite(h) && h > 0 ? h : safeW * 1.444444
  return { w: safeW, h: safeH }
}

function splitIntoRandomBlocks(cards, requestedBlocks) {
  const blocks = []
  let cursor = 0
  let remainingCards = cards.length
  let remainingBlocks = requestedBlocks

  while (remainingBlocks > 0) {
    const minSize = 1
    const maxSize = remainingCards - (remainingBlocks - 1)
    const blockSize = randInt(minSize, maxSize)
    blocks.push(cards.slice(cursor, cursor + blockSize))
    cursor += blockSize
    remainingCards -= blockSize
    remainingBlocks -= 1
  }

  return blocks
}

function shuffleArray(items) {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(0, i)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function hasSameCardSet(baseDeck, candidateDeck) {
  if (baseDeck.length !== candidateDeck.length) return false
  const baseIds = new Set(baseDeck.map((c) => c.id))
  const candidateIds = candidateDeck.map((c) => c.id)
  if (candidateIds.length !== baseIds.size) return false
  return candidateIds.every((id) => baseIds.has(id))
}

export default function ShuffleView({ deck, setDeck }) {
  const [phase, setPhase] = useState('idle')
  const [moverSlot, setMoverSlot] = useState('center')
  const [leftHalf, setLeftHalf] = useState([])
  const [rightHalf, setRightHalf] = useState([])
  const [centerBuild, setCenterBuild] = useState([])
  const [overhandPiles, setOverhandPiles] = useState([])
  const [washCards, setWashCards] = useState([])
  const [landRot, setLandRot] = useState({})
  const [mergePulse, setMergePulse] = useState(false)
  const [splitSpread, setSplitSpread] = useState(false)
  const runningRef = useRef(false)

  const busy = phase !== 'idle'

  const runRiffle = useCallback(async () => {
    if (runningRef.current || deck.length < 2) return
    runningRef.current = true

    const snapshot = [...deck]
    const mid = Math.floor(snapshot.length / 2)
    const L0 = snapshot.slice(0, mid)
    const R0 = snapshot.slice(mid)
    const shuffled = alternateMerge(L0, R0)

    try {
      setCenterBuild([])
      setOverhandPiles([])
      setWashCards([])
      setLandRot({})
      setMergePulse(false)
      setSplitSpread(false)

      setPhase('move-center')
      setMoverSlot('center')
      await wait(MOVE_MS)

      setLeftHalf(L0)
      setRightHalf(R0)
      setPhase('split')
      await wait(SPLIT_PAUSE_MS)

      setSplitSpread(true)
      await wait(SPREAD_MS)

      setPhase('riffling')
      let dL = [...L0]
      let dR = [...R0]
      setLandRot(makeRotMap(shuffled))

      for (let k = 0; k < shuffled.length; k++) {
        const card = shuffled[k]

        if (dL.length && dL[0].id === card.id) {
          dL.shift()
        } else if (dR.length && dR[0].id === card.id) {
          dR.shift()
        }
        setLeftHalf([...dL])
        setRightHalf([...dR])
        setCenterBuild(shuffled.slice(0, k + 1))
        await wait(STAGGER_MS)
      }

      setDeck(shuffled)
      setLeftHalf([])
      setRightHalf([])
      setCenterBuild([])
      setOverhandPiles([])
      setWashCards([])
      setLandRot({})
      setSplitSpread(false)

      setPhase('merge')
      setMoverSlot('center')
      setMergePulse(true)
      await wait(MERGE_MS)
      setMergePulse(false)

      setPhase('returning')
      setMoverSlot('center')
      await wait(RETURN_MS)
    } finally {
      setPhase('idle')
      runningRef.current = false
    }
  }, [deck, setDeck])

  const runOverhand = useCallback(async () => {
    if (runningRef.current || deck.length < 2) return
    runningRef.current = true

    const snapshot = [...deck]
    let currentDeck = [...snapshot]
    const rounds = randInt(OVERHAND_ROUNDS_MIN, OVERHAND_ROUNDS_MAX)

    try {
      setLeftHalf([])
      setRightHalf([])
      setCenterBuild([])
      setOverhandPiles([])
      setWashCards([])
      setLandRot({})
      setMergePulse(false)
      setSplitSpread(false)

      setPhase('move-center')
      setMoverSlot('center')
      await wait(MOVE_MS + 120)

      for (let round = 0; round < rounds; round++) {
        const maxBlocks = Math.min(5, currentDeck.length)
        const minBlocks = Math.min(3, maxBlocks)
        const blockCount = randInt(minBlocks, maxBlocks)
        const baseBlocks = splitIntoRandomBlocks(currentDeck, blockCount)
        const shuffledBlocks = shuffleArray(baseBlocks)
        const roundDeck = shuffledBlocks.flat()
        const piles = baseBlocks.map((b) => [...b])
        setLandRot(makeRotMap(roundDeck))

        setPhase('overhand-split')
        setCenterBuild([])
        setOverhandPiles(piles.map((p) => [...p]))
        await wait(OVERHAND_SPLIT_MS)

        setPhase('overhand-collect')
        for (let k = 0; k < roundDeck.length; k++) {
          const card = roundDeck[k]

          const sourceIdx = piles.findIndex(
            (pile) => pile.length && pile[0].id === card.id,
          )
          if (sourceIdx >= 0) {
            piles[sourceIdx].shift()
          }
          setOverhandPiles(piles.map((p) => [...p]))
          setCenterBuild(roundDeck.slice(0, k + 1))
          await wait(OVERHAND_COLLECT_STAGGER_MS)
        }

        // Integrity guard: never carry a broken deck into the next round.
        if (hasSameCardSet(snapshot, roundDeck)) {
          currentDeck = roundDeck
        }
      }

      // Final integrity guard: keep all original cards even if a round failed.
      const finalDeck = hasSameCardSet(snapshot, currentDeck) ? currentDeck : snapshot
      setDeck(finalDeck)
      setOverhandPiles([])
      setCenterBuild([])
      setWashCards([])
      setLandRot({})

      setPhase('merge')
      setMergePulse(true)
      await wait(MERGE_MS + 180)
      setMergePulse(false)

      setPhase('returning')
      setMoverSlot('center')
      await wait(RETURN_MS + 120)
    } finally {
      setPhase('idle')
      runningRef.current = false
    }
  }, [deck, setDeck])

  const runCardWash = useCallback(async () => {
    if (runningRef.current || deck.length < 2) return
    runningRef.current = true

    const snapshot = [...deck]
    const shuffledDeck = shuffleArray(snapshot)

    try {
      setLeftHalf([])
      setRightHalf([])
      setCenterBuild([])
      setOverhandPiles([])
      setWashCards([])
      setLandRot({})
      setMergePulse(false)
      setSplitSpread(false)

      setPhase('move-center')
      setMoverSlot('center')
      await wait(MOVE_MS)

      const vw = window.innerWidth
      const vh = window.innerHeight
      const { w: cardW, h: cardH } = readCardSize()
      const centerX = vw / 2
      const baseY = vh * 0.28
      const scatterWidth = Math.min(vw * 0.35, 350)
      const scatterHeight = randInt(120, 180)
      const margin = 60
      const minX = margin + cardW / 2
      const maxX = vw - margin - cardW / 2
      const minY = margin + cardH / 2
      const maxY = vh - margin - cardH / 2

      const scattered = snapshot.map((card, i) => {
        const rawX = centerX + randInt(-scatterWidth, scatterWidth)
        const rawY = baseY + randInt(-scatterHeight, scatterHeight)
        return {
          id: card.id,
          card,
          x: clamp(rawX, minX, maxX),
          y: clamp(rawY, minY, maxY),
          rotate: randInt(-25, 25),
          z: i,
        }
      })

      setPhase('wash-scatter')
      setWashCards(scattered)
      await wait(WASH_SCATTER_MS)

      setPhase('wash-hold')
      await wait(WASH_HOLD_MS)

      setPhase('wash-gather')
      const working = [...scattered]
      for (let i = 0; i < shuffledDeck.length; i++) {
        const card = shuffledDeck[i]
        const idx = working.findIndex((entry) => entry.id === card.id)
        if (idx < 0) continue
        working[idx] = {
          ...working[idx],
          x: centerX,
          y: baseY + i * 0.5,
          rotate: 0,
          z: i,
        }
        setWashCards([...working])
        await wait(WASH_GATHER_STAGGER_MS)
      }

      const compressed = working.map((entry, i) => ({
        ...entry,
        x: centerX,
        y: baseY + i * 0.18,
        rotate: 0,
        z: i,
      }))
      setWashCards(compressed)
      await wait(WASH_FINAL_COMPRESS_MS)

      setDeck(shuffledDeck)
      setWashCards([])

      setPhase('merge')
      setMergePulse(true)
      await wait(MERGE_MS)
      setMergePulse(false)

      setPhase('returning')
      setMoverSlot('center')
      await wait(RETURN_MS)
    } finally {
      setPhase('idle')
      runningRef.current = false
    }
  }, [deck, setDeck])

  const methods = [
    { id: 'riffle', label: 'Riffle Shuffle', active: true, onClick: runRiffle },
    { id: 'overhand', label: 'Overhand Shuffle', active: true, onClick: runOverhand },
    { id: 'card-wash', label: 'Card Wash', active: true, onClick: runCardWash },
  ]

  const showFloatingDeck =
    phase === 'idle' ||
    phase === 'move-center' ||
    phase === 'merge' ||
    phase === 'returning'

  const showSplit = phase === 'split' || phase === 'riffling'
  const showCenterRiffle = phase === 'riffling' && centerBuild.length > 0
  const showOverhandPiles =
    (phase === 'overhand-split' || phase === 'overhand-collect') &&
    overhandPiles.length > 0
  const showOverhandCenter = phase === 'overhand-collect' && centerBuild.length > 0
  const showCardWash =
    (phase === 'wash-scatter' || phase === 'wash-hold' || phase === 'wash-gather') &&
    washCards.length > 0

  const layerStyleForRiffle = (i, card, baseT) => {
    const r = landRot[card.id]
    const ease = 'cubic-bezier(0.45, 0, 0.55, 1)'
    if (r == null) return { transform: baseT, transition: `transform 0.38s ${ease}` }
    return {
      transform: `${baseT} rotate(${r}deg)`,
      transition: `transform 0.38s ${ease}`,
    }
  }

  const riffleOverlay =
    typeof document !== 'undefined' &&
    (
      showSplit ||
      showCenterRiffle ||
      showOverhandPiles ||
      showOverhandCenter ||
      showCardWash
    ) &&
    createPortal(
      <div className="shuffle-riffle-root">
        {showSplit && (
          <div className="shuffle-riffle-band">
            <div
              className={`shuffle-riffle-pair${
                splitSpread ? ' shuffle-riffle-pair--spread' : ''
              }`}
            >
              <div className="shuffle-split-pile">
                <DeckStack cards={leftHalf} />
              </div>
              <div className="shuffle-split-pile">
                <DeckStack cards={rightHalf} />
              </div>
            </div>
          </div>
        )}
        {showCenterRiffle && (
          <div className="shuffle-riffle-center-wrap">
            <DeckStack
              cards={centerBuild}
              className="shuffle-riffle-center-stack"
              getLayerStyle={(i, card, baseT) =>
                layerStyleForRiffle(i, card, baseT)
              }
            />
          </div>
        )}
        {showOverhandPiles && (
          <div className="shuffle-overhand-band">
            <div className="shuffle-overhand-row">
              {overhandPiles.map((pile, idx) => (
                pile.length > 0 ? (
                  <div key={`overhand-pile-${idx}`} className="shuffle-overhand-pile">
                    <DeckStack cards={pile} />
                  </div>
                ) : null
              ))}
            </div>
          </div>
        )}
        {showOverhandCenter && (
          <div className="shuffle-overhand-center-wrap">
            <DeckStack
              cards={centerBuild}
              className="shuffle-riffle-center-stack"
              getLayerStyle={(i, card, baseT) =>
                layerStyleForRiffle(i, card, baseT)
              }
            />
          </div>
        )}
        {showCardWash && (
          <div className="shuffle-wash-layer">
            {washCards.map((entry) => (
              <div
                key={entry.id}
                className="shuffle-wash-card"
                style={{
                  left: `${entry.x}px`,
                  top: `${entry.y}px`,
                  transform: `translate(-50%, -50%) rotate(${entry.rotate}deg)`,
                  zIndex: entry.z + 1,
                }}
              >
                <PlayingCard card={entry.card} isFloating={false} />
              </div>
            ))}
          </div>
        )}
      </div>,
      document.body,
    )

  return (
    <div className="shuffle-view">
      {showFloatingDeck && (
        <div
          className={`shuffle-deck-mover shuffle-deck-mover--${moverSlot}${
            mergePulse ? ' shuffle-deck-mover--merge' : ''
          }`}
        >
          <div className="shuffle-deck">
            <DeckStack cards={deck} />
          </div>
        </div>
      )}

      {riffleOverlay}

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
