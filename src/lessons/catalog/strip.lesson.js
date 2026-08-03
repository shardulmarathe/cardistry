import * as THREE from 'three'
import { stackLayout, faceQuat } from '../engine/layouts'
import { wristAnchorForContact } from '../authoring/contacts'
import { splitIntoRandomBlocks } from '../../lib/shuffleMath'
import { CARD_GAP, CARD_W, CARD_H } from '../../lib/constants'
import { DECK_REST_DROP, DECK_APPROACH_DROP } from '../../hands/handPoses'

// Table strip shuffle with BOTH hands doing real work: the right hand carries
// the whole deck and lets a big packet slip out of its grip over the table;
// the left hand presses each dropped packet square onto the growing pile, and
// at the end both hands push the pile back together from the sides. A packet
// is always either inside the right grip, falling the last few centimetres,
// or being pinned by the left palm.
//
// NOT ONE HAND HEIGHT OR REACH IS TYPED IN. Every station is built by two
// measured primitives, so the whole lesson re-solves itself when HAND_SCALE
// moves (it went 4.6 → 13 and this file needed no new magic numbers):
//
//   restWrist / pressWrist(x, top, z)
//     `wristAnchorForContact` answers "where must the wrist sit for the MIDDLE
//     fingertip to land at (x, ·, z)" — that is the rig's REACH, measured.
//     `top + DECK_*_DROP` is the rig's DROP: DECK_REST_DROP is the largest
//     (wrist.y − joint.y + radius) over every phalange of every finger, so a
//     wrist at that height puts the pose's lowest SURFACE exactly tangent on
//     the top card. No capsule of that hand can be inside the stack, at any
//     x/z — the clearance is structural, not tuned.
//
// The two rules that follow from it, and that this lesson never breaks:
//   1. A hand that is not gripping stays at or above `stackTop + DECK_REST_DROP`
//      in a pose whose drop is no larger — provably clear, including MID-LERP,
//      because a linear blend of two clear heights is clear.
//   2. A hand and the cards it carries travel on the SAME ease, between two
//      stations that are the same affine offset apart. The offset is then
//      constant for the whole segment, so "clear at both ends" really does mean
//      clear throughout (this is the one thing a lerp does preserve).
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
    const N = deck.length

    // --- Table geometry (card-sized; these must NOT scale with the hand) -----
    const PX = 0
    const PZ = 0.15
    const pileTopAt = (n) => 0.02 + Math.max(0, n - 1) * CARD_GAP
    const FULL_TOP = pileTopAt(N)
    // The deck's home column, a card-and-a-third right of the pile, so the two
    // footprints never overlap and the carry is a real journey.
    const DECK_X = PX + CARD_W * 1.35
    // How far the deck's bottom card hangs over the pile before a packet is let
    // go: far enough to read as a drop, short enough to look controlled.
    const HOVER = CARD_W * 0.35

    // --- Hand stations (hand-sized; ALL measured off the rig) ----------------
    // Anchors are authored in RIGHT-hand coords; the engine x-mirrors them for
    // the left hand, so a left-hand target at world x lands by asking for −x.
    const wristFor = (pose, x, top, z, drop) => {
      const a = wristAnchorForContact(pose, 'right', 'middle', [x, 0, z])
      return [a[0], top + drop, a[2]]
    }
    // Closed on the deck: pads carry the contact, hand lies across the card.
    const restWrist = (x, top, z) => wristFor('deckRest', x, top, z, DECK_REST_DROP)
    // Same, plus the room a grip's squeeze needs. `pressure` adds up to
    // PRESSURE_CURL(0.14)·p radians of curl to the gripping fingers ON TOP of
    // the solved pose, and DECK_REST_DROP only certifies the UNPRESSED hand —
    // so a pressed pad sinks by roughly (that angle × the finger chain), which
    // is a hand-sized length and scales with the rig. Carry the deck that much
    // lower in the hand and the squeeze has somewhere to go.
    const GRIP_PRESSURE = 0.2
    const SQUEEZE_AIR = DECK_REST_DROP * 0.14 * GRIP_PRESSURE
    const holdWrist = (x, top, z) => {
      const a = restWrist(x, top, z)
      return [a[0], a[1] + SQUEEZE_AIR, a[2]]
    }
    // Open and flat: the pose a hand arrives, presses and waits in.
    const pressWrist = (x, top, z) => wristFor('deckApproach', x, top, z, DECK_APPROACH_DROP)
    // Parked clear: same flat pose held at the CLOSED pose's height, which is
    // strictly higher — rule 1, so the travel in and out can never clip a card.
    const overWrist = (x, top, z) => wristFor('deckApproach', x, top, z, DECK_REST_DROP)

    // --- The right hand's hold on the deck -----------------------------------
    // The deck rides one measured hand-drop above the finished pile: high
    // enough that the whole rig clears the table, low enough that a packet
    // falls rather than plummets. The hold is `deckRest` — four pads laid
    // across the top card, thumb braced outside its near long edge — anchored
    // by restWrist, so it is tangent by construction and needs no back-off pass.
    const CARRY_TOP = FULL_TOP + DECK_APPROACH_DROP
    const RH_HOME = holdWrist(DECK_X, CARRY_TOP, PZ)
    const RH_GRAB = restWrist(PX, FULL_TOP, PZ)

    const inHand = (cards) =>
      cards.map((c, i) => ({
        id: c.id,
        pos: new THREE.Vector3(DECK_X, CARRY_TOP - (cards.length - 1 - i) * CARD_GAP, PZ),
        quat: faceQuat(false),
        bend: 0,
      }))

    // --- The left hand -------------------------------------------------------
    // It waits well out to its own side — clear of the pile column IN X, which
    // is the only axis that matters, since the yawed pose reaches along it —
    // then comes down flat on each landed packet and lifts off again.
    const GUARD_X = PX + CARD_W * 1.2
    const LEFT_GUARD = overWrist(GUARD_X, FULL_TOP, PZ + CARD_H * 0.2)
    const LEFT_LIFT = (top) => overWrist(GUARD_X * 0.7, top, PZ + CARD_H * 0.1)
    const pressAt = (n) => pressWrist(PX, pileTopAt(n), PZ)
    // Both hands squeeze the finished pile from opposite sides: authored once
    // in right-hand coords, mirrored to meet in the middle.
    const SQUARE_X = CARD_W * 0.3
    const RH_SQUARE = restWrist(SQUARE_X, FULL_TOP, PZ)
    // Where each hand starts the lesson, before it has been asked to do
    // anything — off its own side of the table and above everything.
    const RH_WING = overWrist(PX + CARD_W * 2.4, FULL_TOP, PZ - CARD_H * 0.2)
    const LH_WING = overWrist(PX + CARD_W * 2.4, FULL_TOP, PZ + CARD_H * 0.3)

    const blocks = splitIntoRandomBlocks(deck, 4, rng)
    const stripOrder = [...blocks].reverse() // packets leave from the TOP
    const newOrder = stripOrder.flat()

    const pilePoses = (block, piledCount) =>
      block.map((c, j) => ({
        id: c.id,
        pos: new THREE.Vector3(PX, 0.02 + (piledCount + j) * CARD_GAP, PZ),
        quat: faceQuat(false),
        bend: 0,
      }))

    const steps = [
      {
        kind: 'hold',
        id: 'ready',
        label: 'Take the deck from above; the other palm stands by',
        duration: 1200,
        hands: {
          // at:0 keyframes matter: without one the hand's first segment starts
          // from the carried-forward `relaxed` default, which at this rig size
          // parks a whole fist inside the deck on frame one.
          right: [
            { at: 0, pose: 'deckApproach', anchor: RH_WING },
            { at: 1, pose: 'deckRest', anchor: RH_GRAB, ease: 'easeOutCubic' },
          ],
          left: [
            { at: 0, pose: 'deckApproach', anchor: LH_WING },
            { at: 1, pose: 'deckApproach', anchor: LEFT_GUARD, ease: 'easeOutCubic' },
          ],
        },
        annotations: [
          { text: 'Strips move big blocks — quick, but a weak mix', at: [0, 1.6, 0.7], appearAt: 0.2 },
        ],
      },
      {
        kind: 'move',
        id: 'lift',
        label: 'Pick the whole deck up',
        duration: 1100,
        ease: 'easeInOutCubic',
        // No grip, and NO per-keyframe ease: the deck rises on its own track
        // while the hand travels between two stations exactly one deck-travel
        // apart, on the step's own curve. Same curve + same offset = the pads
        // stay welded to the top card the whole way without a grip frame.
        to: (dk) => inHand(dk),
        hands: {
          right: [{ at: 1, pose: 'deckRest', anchor: RH_HOME }],
          left: [{ at: 1, pose: 'deckApproach', anchor: LEFT_GUARD }],
        },
      },
    ]

    let inHandCards = deck.slice()
    let piled = 0
    stripOrder.forEach((block, k) => {
      const blockIds = block.map((c) => c.id)
      const held = inHandCards.slice()
      const rest = inHandCards.filter((c) => !blockIds.includes(c.id))
      const pileBefore = pileTopAt(piled)
      const pileAfter = pileTopAt(piled + blockIds.length)
      // Hover the deck's BOTTOM card just over the pile it is feeding.
      const overTop = pileBefore + HOVER + (held.length - 1) * CARD_GAP
      const RH_OVER = holdWrist(PX, overTop, PZ)
      // Computed EAGERLY at push time. `piled` is a mutating loop variable, so
      // a `() => pilePoses(block, piled)` thunk would resolve after build()
      // returns and see 52 for every packet — the pile would build itself 0.2
      // above the felt (the stale-closure trap documented in the handoff).
      const drop = pilePoses(block, piled)
      const seat = inHand(rest)

      steps.push({
        kind: 'move',
        id: `carry-${k}`,
        label: 'Carry the deck over the pile',
        duration: 800,
        ease: 'easeInOutCubic',
        to: () => [],
        // Welded to the fingertip frame with a CONSTANT pressure. A ramping
        // pressure re-curls the gripping fingers, which walks the frame — and
        // therefore the whole deck — relative to the pads holding it; at this
        // rig size that walk is ~0.2, a third of a card.
        grip: { right: { cards: held.map((c) => c.id), frame: 'packet', pressure: [{ at: 0, v: GRIP_PRESSURE }, { at: 1, v: GRIP_PRESSURE }] } },
        hands: {
          right: [{ at: 1, pose: 'deckRest', anchor: RH_OVER }],
          // The left hand hovers well off the pile while the deck flies in.
          left: [{ at: 1, pose: 'deckApproach', anchor: LEFT_GUARD }],
        },
        annotations:
          k === 0
            ? [{ text: 'A big packet slips off the top on every pass', at: [0, 1.6, 0.7], appearAt: 0.2 }]
            : undefined,
      })

      steps.push({
        kind: 'move',
        id: `strip-${k}`,
        label: 'Drop the packet — the free hand squares it',
        duration: 950,
        ease: 'snapEase',
        // The stripped packet falls to the pile AND the remainder re-seats
        // under the pads back at home — both as honest tracks, no grip. (While
        // the deck stayed welded for the whole shuffle, its top card sank away
        // from the fingers by one packet on every pass.)
        to: [...drop, ...seat],
        hands: {
          // ONE keyframe, on the step's own ease: the hand and the deck it is
          // still holding have to travel home on the SAME curve. With the hand
          // on easeInOutCubic and the cards on snapEase they diverged for
          // ~200ms mid-flight and the deck sliced through the ring finger.
          right: [{ at: 1, pose: 'deckRest', anchor: RH_HOME }],
          // Once the packet has landed — snapEase is 99.99% done by 0.85 — the
          // left palm comes down flat on it, then lifts away.
          left: [
            { at: 0.5, pose: 'deckApproach', anchor: LEFT_GUARD },
            { at: 0.85, pose: 'deckApproach', anchor: pressAt(piled + blockIds.length), ease: 'snapEase' },
            { at: 1, pose: 'deckApproach', anchor: LEFT_LIFT(pileAfter), ease: 'easeOutCubic' },
          ],
        },
      })

      inHandCards = rest
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
            pose: 'deckRest',
            anchor: RH_SQUARE,
            // tighten rides on thumb+index only. They are NOT the rig's lowest
            // fingers — the middle is, by 0.15 — so the squeeze has somewhere
            // to go without pushing a pad through the top card.
            fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tighten', amp: 0.05 }],
          },
        ],
        right: [
          {
            at: 0.55,
            pose: 'deckRest',
            anchor: RH_SQUARE,
            fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tighten', amp: 0.05 }],
          },
        ],
      },
      annotations: [{ text: 'Same neighbours, new block order — that is all a strip does', at: [0, 1.6, 0.7], appearAt: 0.3 }],
    })
    steps.push({
      kind: 'hold',
      id: 'rest',
      label: 'Restacked — same neighbours, new order',
      duration: 900,
      // The closing beat RESTS on the deck rather than drifting off it.
      hands: {
        left: [{ at: 1, pose: 'deckRest', anchor: RH_SQUARE }],
        right: [{ at: 1, pose: 'deckRest', anchor: RH_SQUARE }],
      },
    })
    return steps
  },
}
