import * as THREE from 'three'
import { stackLayout, faceQuat } from '../engine/layouts'
import { splitIntoRandomBlocks } from '../../lib/shuffleMath'
import { CARD_GAP } from '../../lib/constants'

// Hindu shuffle, hand-carried end to end: the RIGHT hand picks the deck up and
// ferries it back and forth; over the LEFT palm it lets a packet slip out of
// the grip, which falls the last few centimetres onto the pile the left hand
// is cradling. Nothing ever levitates — a packet is either inside the right
// hand's grip or resting in the left palm, and the left hand finally carries
// the finished pile back to center.
export const hinduLesson = {
  id: 'hindu',
  title: 'Hindu Shuffle',
  technique: 'hindu',
  difficulty: 'beginner',
  randomizes: 'Weak',
  seed: 99,
  cameraPreset: 'dealerPOV',
  summary:
    'Hold the deck by its ends and draw packets off the top, letting them fall into your other hand. Elegant — but, like the overhand, it only moves blocks.',
  facts: [
    'The Hindu shuffle strips packets off the top and lets them cascade — the same block-transport family as the overhand, so it mixes weakly.',
    'Magicians exploit that weakness to keep a stack of cards intact while appearing to shuffle.',
  ],
  build: (deck, ctx) => {
    const rng = ctx.rng

    // Left palm pile (world coords; left-hand anchors mirror x).
    const LPX = -0.62
    const LPZ = 0.12
    const PILE_Y = 0.2
    const CRADLE = [0.62, 0.13, 0.12] // left palmCradle anchor (right-hand coords)

    // Right hand stations: over the table stack, hovering home, over the pile.
    const RH_GRAB = [0.06, 0.52, 0.0]
    const RH_HOME = [0.61, 0.84, 0.05]
    const RH_OVER_PILE = [LPX + 0.06, 0.82, LPZ]
    const HOME_BASE = new THREE.Vector3(0.55, 0.34, 0.05) // deck base while hovering

    // Strip contiguous packets off the TOP of the deck (index 0 = bottom).
    const blocks = splitIntoRandomBlocks(deck, 4, rng)
    const stripOrder = [...blocks].reverse() // top block leaves first
    const newOrder = stripOrder.flat() // first stripped = bottom of the new pile

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
        pos: new THREE.Vector3(LPX, PILE_Y + (piledCount + j) * CARD_GAP, LPZ),
        quat: faceQuat(c.isFaceUp),
        bend: 0,
      }))

    const allIds = deck.map((c) => c.id)
    const steps = [
      {
        kind: 'hold',
        id: 'ready',
        label: 'Reach in — end grip on the deck',
        duration: 1200,
        hands: {
          right: [
            { at: 0.25, pose: 'relaxed' },
            { at: 1, pose: 'packetGrab', anchor: RH_GRAB, ease: 'anticipate' },
          ],
          left: [{ at: 0.7, pose: 'palmCradle', anchor: CRADLE, ease: 'anticipate' }],
        },
        annotations: [
          { text: 'Right hand holds the deck by its ends; the left palm waits to receive', appearAt: 0.15 },
        ],
      },
      {
        kind: 'move',
        id: 'lift',
        label: 'Pick the whole deck up',
        duration: 1200,
        ease: 'easeInOutCubic',
        to: (dk) => raisedAt(dk, HOME_BASE),
        // The palm-down grab does not change orientation for the rest of the
        // shuffle, so gripping here keeps the deck flat through every carry.
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
      const held = inHand.slice() // ids in the right hand during this carry
      const rest = inHand.filter((id) => !blockIds.includes(id))

      steps.push({
        kind: 'move',
        id: `carry-${k}`,
        label: 'Carry the deck over the waiting palm',
        duration: 850,
        ease: 'easeInOutCubic',
        to: () => [],
        grip: { right: { cards: held, frame: 'pinch', pressure: [{ at: 0, v: 0.55 }, { at: 1, v: 0.55 }] } },
        hands: {
          right: [{ at: 1, pose: 'packetGrab', anchor: RH_OVER_PILE }],
        },
        annotations:
          k === 0
            ? [{ text: 'Bring the deck to the left hand — the left fingers strip the top packet', appearAt: 0.2 }]
            : undefined,
      })

      const drop = pilePoses(block, piled)
      steps.push({
        kind: 'move',
        id: `strip-${k}`,
        label: 'A packet slips out and falls into the palm',
        duration: 850,
        ease: 'snapEase',
        to: () => drop,
        // Only the REST stays gripped: the stripped packet leaves the hand the
        // instant this step begins (its fall start is baked from the grip
        // frame, so it detaches exactly where the hand held it).
        grip: rest.length
          ? { right: { cards: rest, frame: 'pinch', pressure: [{ at: 0, v: 0.55 }, { at: 1, v: 0.55 }] } }
          : undefined,
        hands: {
          right: [
            { at: 0.18, pose: 'packetGrab', anchor: RH_OVER_PILE },
            { at: 1, pose: 'packetGrab', anchor: rest.length ? RH_HOME : [0.7, 0.62, 0.1], ease: 'easeInOutCubic' },
          ],
          // The cradle closes slightly around each arriving packet.
          left: [
            {
              at: 0.55,
              pose: 'palmCradle',
              anchor: CRADLE,
              fingerMotion: [{ fingers: ['index', 'middle', 'ring'], type: 'tighten', amp: 0.06 }],
            },
          ],
        },
      })

      inHand = rest
      piled += blockIds.length
    })

    steps.push({
      kind: 'move',
      id: 'square',
      label: 'The left hand carries the pile back',
      duration: 1500,
      ease: 'easeInOutCubic',
      reorder: () => newOrder,
      to: (dk) => stackLayout(dk, 0.12),
      // The finished pile rides the LEFT palm to the center.
      grip: { left: { cards: 'all', frame: 'packet', pressure: [{ at: 0, v: 0.35 }, { at: 1, v: 0.45 }] } },
      hands: {
        // Anchor chosen so the welded pile lands exactly on the center stack.
        left: [{ at: 1, pose: 'palmCradle', anchor: [0.0, 0.09, 0.02] }],
        right: [{ at: 1, pose: 'relaxed' }],
      },
      annotations: [{ text: 'Blocks moved as blocks — the order barely mixed', appearAt: 0.35 }],
    })
    steps.push({
      kind: 'move',
      id: 'set-down',
      label: 'Set it down and square up',
      duration: 900,
      ease: 'snapEase',
      to: (dk) => stackLayout(dk),
      hands: {
        left: [
          { at: 0.5, pose: 'twoHandsSupport', anchor: [0.42, 0.3, 0.06] },
          { at: 1, pose: 'relaxed', ease: 'settle' },
        ],
        right: [
          {
            at: 0.5,
            pose: 'twoHandsSupport',
            anchor: [0.42, 0.3, 0.06],
            fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tighten', amp: 0.05 }],
          },
          { at: 1, pose: 'relaxed', ease: 'settle' },
        ],
      },
    })
    steps.push({
      kind: 'hold',
      id: 'rest',
      label: 'Blocks moved — barely mixed',
      duration: 800,
      hands: {
        left: [{ at: 1, pose: 'relaxed', ease: 'easeInOutCubic' }],
        right: [{ at: 1, pose: 'relaxed', ease: 'easeInOutCubic' }],
      },
    })
    return steps
  },
}
