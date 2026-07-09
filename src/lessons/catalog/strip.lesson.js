import * as THREE from 'three'
import { stackLayout, faceQuat } from '../engine/layouts'
import { splitIntoRandomBlocks } from '../../lib/shuffleMath'
import { CARD_GAP } from '../../lib/constants'

// Table strip shuffle with BOTH hands doing real work: the right hand carries
// the whole deck and lets a big packet slip out of its grip over the table;
// the left hand presses each dropped packet square onto the growing pile, and
// at the end both hands push the pile back together from the sides. A packet
// is always either inside the right grip, falling the last few centimetres,
// or being pinned by the left palm.
export const stripLesson = {
  id: 'strip',
  title: 'Strip Shuffle',
  technique: 'strip',
  difficulty: 'beginner',
  randomizes: 'Weak',
  seed: 33,
  cameraPreset: 'dealerPOV',
  summary:
    'Like the overhand, but you strip off larger packets and drop them — fewer, bigger blocks move, so mixing stays weak.',
  facts: [
    'Strip shuffles move fewer, larger packets than the overhand — same block-transport weakness.',
    'Running cuts are the same family: packets lifted off and re-stacked without true interleaving.',
  ],
  build: (deck, ctx) => {
    const rng = ctx.rng

    // Pile grows at table center; the right hand shuttles between HOME (right
    // of the pile) and OVER the pile.
    const PX = 0
    const PZ = 0.15
    const HOME_BASE = new THREE.Vector3(0.55, 0.3, 0.1)
    const RH_GRAB = [0.06, 0.52, 0.0]
    const RH_HOME = [0.61, 0.8, 0.1]
    const RH_OVER_PILE = [PX + 0.08, 0.78, PZ]
    const LEFT_GUARD = [0.6, 0.24, PZ + 0.1] // left hand waits well clear of the pile

    const blocks = splitIntoRandomBlocks(deck, 4, rng)
    const stripOrder = [...blocks].reverse() // packets leave from the TOP
    const newOrder = stripOrder.flat()

    const raisedAt = (dk, base) =>
      dk.map((c, i) => ({
        id: c.id,
        pos: new THREE.Vector3(base.x, base.y + i * CARD_GAP, base.z),
        quat: faceQuat(c.isFaceUp),
        bend: 0,
      }))
    const pilePoses = (block, piledCount) =>
      block.map((c, j) => ({
        id: c.id,
        pos: new THREE.Vector3(PX, 0.02 + (piledCount + j) * CARD_GAP, PZ),
        quat: faceQuat(c.isFaceUp),
        bend: 0,
      }))

    const allIds = deck.map((c) => c.id)
    const steps = [
      {
        kind: 'hold',
        id: 'ready',
        label: 'Grip the deck; the other palm stands by',
        duration: 1200,
        hands: {
          right: [
            { at: 0.25, pose: 'relaxed' },
            { at: 1, pose: 'packetGrab', anchor: RH_GRAB, ease: 'anticipate' },
          ],
          left: [{ at: 0.7, pose: 'washFlat', anchor: LEFT_GUARD, ease: 'anticipate' }],
        },
        annotations: [
          { text: 'Strips move big blocks — quick, but a weak mix', appearAt: 0.2 },
        ],
      },
      {
        kind: 'move',
        id: 'lift',
        label: 'Pick the whole deck up',
        duration: 1100,
        ease: 'easeInOutCubic',
        to: (dk) => raisedAt(dk, HOME_BASE),
        grip: { right: { cards: 'all', frame: 'pinch', pressure: [{ at: 0, v: 0.3 }, { at: 1, v: 0.55 }] } },
        hands: {
          right: [{ at: 1, pose: 'packetGrab', anchor: RH_HOME, ease: 'easeOutBackSoft' }],
        },
      },
    ]

    let inHand = allIds.slice()
    let piled = 0
    stripOrder.forEach((block, k) => {
      const blockIds = block.map((c) => c.id)
      const held = inHand.slice()
      const rest = inHand.filter((id) => !blockIds.includes(id))
      const pileTopY = 0.02 + (piled + blockIds.length) * CARD_GAP

      steps.push({
        kind: 'move',
        id: `carry-${k}`,
        label: 'Carry the deck over the pile',
        duration: 800,
        ease: 'easeInOutCubic',
        to: () => [],
        grip: { right: { cards: held, frame: 'pinch', pressure: [{ at: 0, v: 0.55 }, { at: 1, v: 0.55 }] } },
        hands: {
          right: [{ at: 1, pose: 'packetGrab', anchor: RH_OVER_PILE }],
          // The left hand hovers off the pile while the deck flies in.
          left: [{ at: 1, pose: 'washFlat', anchor: LEFT_GUARD }],
        },
        annotations:
          k === 0
            ? [{ text: 'A big packet slips off the top on every pass', appearAt: 0.2 }]
            : undefined,
      })

      const drop = pilePoses(block, piled)
      steps.push({
        kind: 'move',
        id: `strip-${k}`,
        label: 'Drop the packet — the free hand squares it',
        duration: 950,
        ease: 'snapEase',
        to: () => drop,
        grip: rest.length
          ? { right: { cards: rest, frame: 'pinch', pressure: [{ at: 0, v: 0.55 }, { at: 1, v: 0.55 }] } }
          : undefined,
        hands: {
          // The right hand clears out quickly so the left can move in — the
          // two hands never share the space over the pile.
          right: [
            { at: 0.12, pose: 'packetGrab', anchor: RH_OVER_PILE },
            { at: 0.55, pose: 'packetGrab', anchor: rest.length ? RH_HOME : [0.68, 0.6, 0.12], ease: 'easeInOutCubic' },
            { at: 1, pose: 'packetGrab', anchor: rest.length ? RH_HOME : [0.68, 0.6, 0.12] },
          ],
          // Once the packet has landed, the left palm presses it flat.
          left: [
            { at: 0.45, pose: 'washFlat', anchor: LEFT_GUARD },
            { at: 0.8, pose: 'washFlat', anchor: [0.06, pileTopY + 0.32, PZ], ease: 'snapEase' },
            { at: 1, pose: 'washFlat', anchor: [0.34, pileTopY + 0.38, PZ + 0.06] },
          ],
        },
      })

      inHand = rest
      piled += blockIds.length
    })

    steps.push({
      kind: 'move',
      id: 'square',
      label: 'Both hands push the pile back together',
      duration: 1300,
      ease: 'easeInOutCubic',
      reorder: () => newOrder,
      to: (dk) => stackLayout(dk).map((p) => ({ ...p, pos: p.pos.clone().setZ(PZ) })),
      hands: {
        left: [
          {
            at: 0.55,
            pose: 'twoHandsSupport',
            anchor: [0.42, 0.3, PZ - 0.04],
            fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tighten', amp: 0.05 }],
          },
        ],
        right: [
          {
            at: 0.55,
            pose: 'twoHandsSupport',
            anchor: [0.42, 0.3, PZ - 0.04],
            fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tighten', amp: 0.05 }],
          },
        ],
      },
      annotations: [{ text: 'Same neighbours, new block order — that is all a strip does', appearAt: 0.3 }],
    })
    steps.push({
      kind: 'hold',
      id: 'rest',
      label: 'Restacked — same neighbours, new order',
      duration: 900,
      hands: {
        left: [{ at: 1, pose: 'relaxed', ease: 'easeInOutCubic' }],
        right: [{ at: 1, pose: 'relaxed', ease: 'easeInOutCubic' }],
      },
    })
    return steps
  },
}
