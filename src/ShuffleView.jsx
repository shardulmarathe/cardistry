import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import DeckStack from './DeckStack'

const MOVE_MS = 300
const SPLIT_PAUSE_MS = 300
const SPREAD_MS = 320
const MERGE_MS = 320
const RETURN_MS = 320
const STAGGER_MS = 15

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

export default function ShuffleView({ deck, setDeck }) {
  const [phase, setPhase] = useState('idle')
  const [moverSlot, setMoverSlot] = useState('center')
  const [leftHalf, setLeftHalf] = useState([])
  const [rightHalf, setRightHalf] = useState([])
  const [centerBuild, setCenterBuild] = useState([])
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
      const rots = {}

      for (let k = 0; k < shuffled.length; k++) {
        const card = shuffled[k]
        rots[card.id] = randRot()
        setLandRot({ ...rots })

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

  const methods = [
    { id: 'riffle', label: 'Riffle Shuffle', active: true, onClick: runRiffle },
    { id: 'overhand', label: 'Overhand', active: false },
    { id: 'hindu', label: 'Hindu', active: false },
    { id: 'pile', label: 'Pile', active: false },
    { id: 'faro', label: 'Faro', active: false },
    { id: 'random', label: 'Random', active: false },
  ]

  const showFloatingDeck =
    phase === 'idle' ||
    phase === 'move-center' ||
    phase === 'merge' ||
    phase === 'returning'

  const showSplit = phase === 'split' || phase === 'riffling'
  const showCenterRiffle = phase === 'riffling' && centerBuild.length > 0

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
    (showSplit || showCenterRiffle) &&
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
