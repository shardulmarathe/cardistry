import * as THREE from 'three'
import { stackLayout, faceQuat } from '../engine/layouts'
import { poseWithContacts, rigMetrics, surfaceContact, wristAnchorForContact } from '../authoring/contacts'
import { splitIntoRandomBlocks } from '../../lib/shuffleMath'
import { CARD_GAP, CARD_H, CARD_T, CARD_W } from '../../lib/constants'
import { DECK_REST_DROP, DECK_APPROACH_DROP, DECK_REACH } from '../../hands/handPoses'
import { FINGERS, HAND_SCALE } from '../../hands/handRigSpec'

// Hindu shuffle, hand-carried end to end: the RIGHT hand picks the deck up and
// ferries it back and forth; over the LEFT palm it lets a packet slip out of
// the grip, which falls the last few centimetres onto the pile the left hand
// is cradling. Nothing ever levitates — a packet is either inside the right
// hand's grip or resting in the left palm, and the left hand finally carries
// the finished pile back to center.
//
// GEOMETRY NOTE (the thing this file is really about). A phalange capsule is
// FAT: the thumb's base is 0.221 in RADIUS — thicker than a squared 52-card
// deck is tall — so a finger whose axis passes anywhere inside a card's
// footprint within 0.224 of its plane is interpenetrating it. Nothing here may
// be a typed world constant, because every one of these offsets is a distance
// across the HAND and therefore scales linearly with HAND_SCALE. The last pass
// through this file fixed the two HEIGHTS that way and left the SIDEWAYS
// offsets typed; when the rig grew 2.83x those went stale and put the cradle's
// thumb 0.224 deep inside the centre deck (this lesson's whole budget). So:
//
//   * every hand-sized number below is `rigMetrics`'d off the rig under the
//     pose's own wrist quaternion, or is a fraction of the finger's own length;
//   * every card-sized number is written as a fraction of CARD_W / CARD_H;
//   * every contact is solved onto a card SURFACE (surfaceContact), which is
//     radius-aware and therefore scale-correct for free.

// Breathing room the idle overlay and the ease into a pose need — hand-sized,
// like the CONTACT_AIR that handPoses.js folds into DECK_REST_DROP.
const CONTACT_AIR = 0.003 * HAND_SCALE
// The middle finger's own length: the yardstick for every "how deep is the cup"
// question below.
const FINGER_LEN = FINGERS.middle.len.reduce((a, b) => a + b, 0) * HAND_SCALE
const TIP_R = FINGERS.middle.rad[2] * HAND_SCALE
// A grip's `pressure` adds up to PRESSURE_CURL·p of curl at RUNTIME on top of
// whatever the solve settled on, and the idle overlay adds ~0.021 more. On a
// finger this long that swings the pad by (curl delta)x(finger length) — which
// is hand-sized, so the shield that reserves room for it has to be too. Every
// solve below runs against one extra "shield" card floated SHIELD off the real
// stack; clearing that leaves exactly this much air for the squeeze to eat.
const SHIELD = FINGER_LEN * (0.14 * 0.25 + 0.021)

// Both hands reach IN from their own side of the table. A world-Y yaw applied
// AFTER the palm rotation (Euler order 'YXZ'), exactly as handPoses.js builds
// deckRest/deckApproach — it swings the whole hand about the vertical so the
// fingers point along the table instead of at the camera. Authored ONCE for the
// right hand; the engine's x-mirror gives the left hand the opposite yaw (never
// mirror a quaternion by hand).
//
// This is not cosmetic. A palm-DOWN hand's fingers start at +z and its thumb at
// −x; a palm-UP hand's fingers start at −z, so the two need OPPOSITE yaws to
// end up pointing the same way. Un-yawed, `palmCradle`'s thumb reaches 1.56
// straight at table centre, which is what buried it 0.224 inside the squared
// deck — and forcing the pile far enough left to dodge that pushed it clean off
// the side of the frame. Yawed, the thumb trails harmlessly to +z and the pile
// can sit where it belongs, with only the forearm out wide.
const PALM_DOWN = Math.PI / 2
const yawed = (pitch, yaw) =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'))
const HOLD_QUAT = yawed(PALM_DOWN + 0.12, -Math.PI / 2)
const CRADLE_QUAT = yawed(-PALM_DOWN + 0.12, Math.PI / 2)
// Measured off the rig under each pose's OWN wrist quaternion — the same hand
// reaches a completely different way once it is yawed 90 degrees.
const CRADLE_M = rigMetrics('palmCradle', CRADLE_QUAT)
const HOLD_M = rigMetrics('washFlat', HOLD_QUAT)

// Where the middle pad sits relative to the wrist when the finger is folded
// `angle` off the palm plane at `frac` of its own extension. Both hand poses
// here are authored almost STRAIGHT — measured, washFlat's middle tip is 1.205
// from its knuckle against a finger 1.209 long, i.e. 99.7% extended — so ANY
// contact target beyond that tip is unreachable, and solveFingerTo answers an
// unreachable target by pinning the knuckle at JOINT_LIMITS.max and
// hyperextending the rest. (That is exactly what happened here: the middle
// finger came out folded 95 degrees with its tip at y = −0.26, through the felt
// and a card-length behind the deck, and the hand was holding nothing.)
//
// So author the FOLD and let the wrist follow, instead of anchoring on a
// straight finger's tip and hoping. `lift` is +1 for a palm-up cup, −1 for a
// palm-down grip; the horizontal direction is read off the rig, so this works
// under any yaw. Both inputs are dimensionless, so the grip keeps its SHAPE at
// any HAND_SCALE.
function foldPad(m, angle, frac, lift) {
  const K = m.knuckle.middle
  const T = m.tip.middle
  const hx = T.x - K.x
  const hz = T.z - K.z
  const h = Math.hypot(hx, hz) || 1
  const r = FINGER_LEN * frac
  const flat = Math.cos(angle) * r
  return [K.x + (hx / h) * flat, K.y + lift * Math.sin(angle) * r, K.z + (hz / h) * flat]
}
export const hinduLesson = {
  id: 'hindu',
  title: 'Hindu Shuffle',
  technique: 'hindu',
  difficulty: 'beginner',
  randomizes: 'Weak',
  seed: 99,
  // The cradle holds the pile near y≈1 at this hand scale; dealerPOV aims at
  // 0.35 and pushes the whole shuffle into the top of the frame.
  cameraPreset: 'handsHigh',
  summary:
    'Hold the deck by its ends and draw packets off the top, letting them fall into your other hand. Elegant — but, like the overhand, it only moves blocks.',
  facts: [
    'The Hindu shuffle strips packets off the top and lets them cascade — the same block-transport family as the overhand, so it mixes weakly.',
    'Magicians exploit that weakness to keep a stack of cards intact while appearing to shuffle.',
  ],
  build: (deck, ctx) => {
    const rng = ctx.rng
    const N = deck.length
    const TABLE_TOP = 0.02 + (N - 1) * CARD_GAP

    const cardsOf = (x, baseY, z, n) =>
      Array.from({ length: n }, (_, i) => ({
        pos: [x, baseY + i * CARD_GAP, z],
        quat: faceQuat(false),
      }))
    const shielded = (cards, dy) => [
      ...cards,
      { pos: [cards[0].pos[0], (dy > 0 ? cards[cards.length - 1] : cards[0]).pos[1] + dy, cards[0].pos[2]], quat: faceQuat(false) },
    ]
    const cardAt = (x, y, z) => ({ pos: [x, y, z], quat: faceQuat(false) })
    // Where the wrist must be for `pose`'s middle pad to land on a given point
    // of a card, with y taken from that pose's measured DEEPEST surface rather
    // than the one pad being aimed. x/z come out of the rig, so they follow
    // HAND_SCALE; nothing here is typed.
    const padAnchor = (pose, card, spec, y) => {
      const a = wristAnchorForContact(
        pose,
        'right',
        'middle',
        surfaceContact(card, { finger: 'middle', ...spec }).toArray(),
      )
      return [a[0], y, a[2]]
    }

    // --- Left palm and the pile it cradles ---------------------------------
    const LPX = -(CARD_W * 1.5)
    const LPZ = 0.1
    // As low as the felt lets a palm-up hand go: its own deepest surface tangent
    // on the table, plus the air the idle overlay eats. No SHIELD here — that
    // reserves room for a grip's runtime squeeze to push a pad INTO a card, and
    // the felt is not a card. (Yawed, the thumb no longer has to clear the
    // centre deck sideways either, so this is the only constraint left on the
    // cradle's height — which matters, because everything else in the lesson
    // stacks on top of it: the pile rides a cup above the palm and the carried
    // deck rides a card's fall above the pile.)
    const CRADLE_Y = 0.012 + CRADLE_M.drop + CONTACT_AIR
    // The CUP the pile rests in — a gentle half-curl, not a fist.
    const CUP = foldPad(CRADLE_M, 0.25, 0.82, 1)
    const PILE_Y = CRADLE_Y + CUP[1] + TIP_R + CARD_T / 2 + SHIELD
    // Yawed, the four fingers spread along the pile's LONG axis (v) and their
    // curl plane is the one containing its WIDTH (u) — so v documents where each
    // finger's own splay lands it and u is the reachable half of the target.
    const PAD_U = -0.1
    const PAD_V = { index: -0.8, middle: -0.25, ring: 0.3, pinky: 0.85 }
    // Anchor for the wrist that carries a pile centred at (px, pz) — the whole
    // point of solving the pads first: at this scale the wrist sits 1.5 OUTBOARD
    // of the cards it is holding, so "put the wrist where the pile goes" (which
    // is what the carry-back beat used to do) parks the pile a hand-length wide
    // of its target.
    const cradleAt = (px, pz) => [
      -px + PAD_U * (CARD_W / 2) - CUP[0],
      CRADLE_Y,
      pz - CUP[2],
    ]
    const pileBottom = cardAt(-LPX, PILE_Y, LPZ)
    const CRADLE = cradleAt(LPX, LPZ)
    const cradle = poseWithContacts(
      'palmCradle',
      'left',
      {
        anchor: CRADLE,
        quat: CRADLE_QUAT,
        // Solved against the FULL pile plus a shield card floated BELOW it: the
        // fingers are relaxed until every phalange is under the cards instead
        // of through them.
        cards: shielded(cardsOf(LPX, PILE_Y, LPZ, N), -SHIELD),
        // clearance is a TOLERANCE, not a margin: resolvePenetration stops at
        // the first curl whose depth is <= clearance, so anything non-zero
        // literally buys penetration. Always 0 here.
        clearance: 0,
      },
      // '+z' is the card's DOWN face for a face-down card, so these four pads
      // are solved onto the pile's UNDERSIDE — the surface a cradle carries.
      Object.fromEntries(
        Object.entries(PAD_V).map(([f, v]) => [f, { card: pileBottom, face: '+z', u: PAD_U, v }]),
      ),
    )

    // --- Right hand's hold on the deck -------------------------------------
    // Even at 13 the hand cannot pinch a 0.63-wide deck thumb-to-fingertip
    // (every preset in this rig abducts the thumb; measured, washFlat's thumb
    // tip sits 0.98 ABOVE the top card no matter where the wrist goes), so the
    // honest grip stays the one from ABOVE: four pads across the top card, the
    // thumb aimed inward but riding clear. Every contact is on the one plane
    // the whole stack shares from above, so it stays a contact as the deck
    // shrinks under it.
    const HAND_DECK_X = 0.56
    const HAND_DECK_Z = 0.12
    // How far a packet falls out of the grip into the waiting palm. Card-sized:
    // it is a gap between two stacks of cards, not a reach across a hand.
    const FALL = CARD_H * 0.16
    // The deck rides at the height the left palm holds its pile, so each carry
    // is a near-horizontal ferry rather than a plunge and a haul back up.
    const HAND_DECK_TOP = PILE_Y + (N - 1) * CARD_GAP + FALL
    // The grip's fold, and the wrist that follows from it (see foldPad).
    const HOLD_PAD = foldPad(HOLD_M, 0.9, 0.8, -1)
    const holdAt = (x, top, z) => [
      x - HOLD_PAD[0],
      top + CARD_T / 2 + TIP_R - HOLD_PAD[1] + CONTACT_AIR,
      z - HOLD_PAD[2],
    ]
    const RH_HOME = holdAt(HAND_DECK_X, HAND_DECK_TOP, HAND_DECK_Z)
    const topCard = cardAt(HAND_DECK_X, HAND_DECK_TOP, HAND_DECK_Z)
    const hold = poseWithContacts(
      'washFlat',
      'right',
      {
        anchor: RH_HOME,
        quat: HOLD_QUAT,
        cards: shielded(cardsOf(HAND_DECK_X, HAND_DECK_TOP - (N - 1) * CARD_GAP, HAND_DECK_Z, N), SHIELD),
        clearance: 0,
      },
      // Yawed, the four fingers lie ACROSS the deck's long axis, so `v` only
      // documents where each finger's own splay lands it (it is off the curl
      // plane) and `u` — how far across the deck's width the pad reaches — is
      // the half the IK can actually solve. The THUMB is deliberately left
      // alone: every preset in this rig abducts it, washFlat's tip sits 0.98
      // ABOVE the top card wherever the wrist goes, and aiming it at the card
      // anyway just pins the knuckle at its limit (measured, three target
      // variants, all of them). A real end grip needs a pose this file does not
      // own; until then the honest thing is a natural thumb riding clear.
      {
        index: { card: topCard, u: 0, v: -0.8 },
        middle: { card: topCard, u: 0, v: -0.25 },
        ring: { card: topCard, u: 0, v: 0.3 },
        pinky: { card: topCard, u: 0, v: 0.85 },
      },
    )
    const RH_GRAB = holdAt(0, TABLE_TOP, 0)
    // The same hand with its AUTHORED (nearly straight) curls — an open hand in
    // the hold's own orientation. The approach uses this so the whole reach-in
    // is a pure translation plus a curl: see the note on `ready` below.
    const openHold = poseWithContacts('washFlat', 'right', { quat: HOLD_QUAT })
    // The open/rest poses are already yawed inward, and their exported DROP
    // constants are the same measurement plus its air. `padX` says where on the
    // deck's top card the pads land — card-relative, so two hands settling on
    // one deck put their fingers on their own sides of it.
    const DECK_PAD_X = CARD_W * 0.42
    // Clear of the deck's footprint altogether, for the beats where cards are
    // still moving through the space a settling hand would occupy.
    const WIDE_X = CARD_W * 1.6
    const openAt = (x, top, z, lift = 0) => {
      const a = padAnchor('deckApproach', cardAt(x, top, z), {}, top + DECK_APPROACH_DROP + lift)
      return a
    }
    const restAt = (x, top, z) => padAnchor('deckRest', cardAt(x, top, z), {}, top + DECK_REST_DROP)
    // The deck's in-hand stack, for `m` remaining cards (top pinned under the
    // pads, bottom rising as packets leave).
    const inHand = (cards) =>
      cards.map((c, i) => ({
        id: c.id,
        pos: new THREE.Vector3(
          HAND_DECK_X,
          HAND_DECK_TOP - (cards.length - 1 - i) * CARD_GAP,
          HAND_DECK_Z,
        ),
        quat: faceQuat(false),
        bend: 0,
      }))

    // Strip contiguous packets off the TOP of the deck (index 0 = bottom).
    const blocks = splitIntoRandomBlocks(deck, 4, rng)
    const stripOrder = [...blocks].reverse() // top block leaves first
    const newOrder = stripOrder.flat() // first stripped = bottom of the new pile

    const pilePoses = (block, piledCount) =>
      block.map((c, j) => ({
        id: c.id,
        pos: new THREE.Vector3(LPX, PILE_Y + (piledCount + j) * CARD_GAP, LPZ),
        quat: faceQuat(false),
        bend: 0,
      }))

    const steps = [
      {
        kind: 'hold',
        id: 'ready',
        label: 'Reach in — take the deck from above',
        duration: 1200,
        hands: {
          // The `at: 0` keyframes are load-bearing on BOTH sides. Without one
          // the compiler builds a lead-in FROM the pose carried forward, which
          // at the first step of a lesson is `relaxed` at its own default wrist
          // — a hand parked at x=±0.95 with its thumb base 1.57 inboard of
          // that, i.e. straight through the deck. Measured: that phantom frame
          // was this lesson's single deepest hit (0.2240, the metric's ceiling).
          // The right hand NEVER changes wrist orientation during this reach.
          // It used to arrive in `deckApproach` (yawed to reach in from +x) and
          // slerp into the hold (which comes down from -z) — a ~90 degree turn,
          // and slerping it takes the palm through a side-on tip that points
          // the fingers straight DOWN. Both endpoints were clear and the middle
          // finger still swept 0.158 through the deck halfway between them.
          // Holding one orientation makes the whole approach a translation plus
          // a curl, neither of which can do that.
          right: [
            { at: 0, pose: openHold, anchor: holdAt(CARD_W * 2, TABLE_TOP + CARD_H, 0) },
            { at: 0.45, pose: openHold, anchor: holdAt(0, TABLE_TOP + CARD_H * 0.55, 0) },
            { at: 1, pose: hold, anchor: RH_GRAB, ease: 'easeOutCubic' },
          ],
          left: [
            { at: 0, pose: cradle, anchor: [CRADLE[0] + CARD_W, CRADLE[1], CRADLE[2]] },
            { at: 0.7, pose: cradle, anchor: CRADLE, ease: 'easeOutCubic' },
          ],
        },
        annotations: [
          { text: 'Right hand takes the deck; the left palm waits to receive', appearAt: 0.15 },
        ],
      },
      {
        kind: 'move',
        id: 'lift',
        label: 'Pick the whole deck up',
        duration: 1200,
        ease: 'easeInOutCubic',
        // No grip: the deck rises on its own track exactly alongside the hand,
        // which lands the stack in a KNOWN place under the pads. (A weld here
        // would land it wherever the captured offset put it, and every later
        // re-seat would have to chase that.)
        to: (dk) => inHand(dk),
        hands: {
          right: [{ at: 1, pose: hold, anchor: RH_HOME, ease: 'easeOutCubic' }],
        },
      },
    ]

    let inHandCards = deck.slice()
    let piled = 0
    stripOrder.forEach((block, k) => {
      const blockIds = block.map((c) => c.id)
      const held = inHandCards.slice()
      const rest = inHandCards.filter((c) => !blockIds.includes(c.id))
      // Hover the deck's BOTTOM card a hair over the pile it is feeding, so
      // each packet falls a believable centimetre or two, not half the table.
      const pileTop = PILE_Y + Math.max(0, piled - 1) * CARD_GAP
      const overTop = pileTop + FALL + (held.length - 1) * CARD_GAP
      const RH_OVER = holdAt(LPX, overTop, LPZ)

      steps.push({
        kind: 'move',
        id: `carry-${k}`,
        label: 'Carry the deck over the waiting palm',
        duration: 850,
        ease: 'easeInOutCubic',
        to: () => [],
        grip: { right: { cards: blockIds.concat(rest.map((c) => c.id)), frame: 'packet', pressure: [{ at: 0, v: 0.18 }, { at: 1, v: 0.22 }] } },
        hands: {
          right: [{ at: 1, pose: hold, anchor: RH_OVER }],
        },
        annotations:
          k === 0
            ? [{ text: 'Bring the deck to the left hand — a packet slips off the top', appearAt: 0.2 }]
            : undefined,
      })

      const drop = pilePoses(block, piled)
      steps.push({
        kind: 'move',
        id: `strip-${k}`,
        label: 'A packet slips out and falls into the palm',
        duration: 850,
        ease: 'snapEase',
        // The stripped packet falls to the pile AND the remainder re-seats
        // under the pads back at home — with no grip, so both are honest
        // tracks. (While the deck was welded for the whole shuffle the top
        // card sank away from the fingers by one packet on every pass, and by
        // the last carry the hand was holding 0.2 of empty air.)
        to: () => [...drop, ...inHand(rest)],
        hands: {
          right: [
            { at: 0.18, pose: hold, anchor: RH_OVER },
            { at: 1, pose: hold, anchor: rest.length ? RH_HOME : holdAt(HAND_DECK_X + CARD_W * 0.3, HAND_DECK_TOP, HAND_DECK_Z), ease: 'easeInOutCubic' },
          ],
          // The cradle closes slightly around each arriving packet.
          left: [
            {
              at: 0.55,
              pose: cradle,
              anchor: CRADLE,
              // THUMB only. `tighten` adds curl, and on a palm-UP cradle more
              // curl lifts the fingers straight into the pile they are holding
              // (measured: it put the middle phalange 0.034 inside the stack).
              // The thumb lies well outboard and below, so it can still close.
              fingerMotion: [{ fingers: ['thumb'], type: 'tighten', amp: 0.07 }],
            },
          ],
        },
      })

      inHandCards = rest
      piled += blockIds.length
    })

    steps.push({
      kind: 'move',
      id: 'square',
      label: 'The left hand carries the pile back',
      duration: 1500,
      ease: 'easeInOutCubic',
      reorder: () => newOrder,
      // A pure HORIZONTAL carry: the palm keeps its height, so the pile never
      // has to descend through the fingers holding it up.
      to: (dk) => stackLayout(dk, PILE_Y),
      grip: { left: { cards: 'all', frame: 'packet', pressure: [{ at: 0, v: 0.15 }, { at: 1, v: 0.2 }] } },
      hands: {
        left: [{ at: 1, pose: cradle, anchor: cradleAt(0, 0) }],
        // WIDE, not merely beside: the left hand is carrying the pile through
        // table centre on this beat, and its thumb sweeps a hand-length across
        // to +x as it goes. Parking the right hand one card out left the two
        // translucent hands 0.07 INSIDE each other at the hand-off.
        right: [{ at: 1, pose: 'deckApproach', anchor: openAt(WIDE_X, TABLE_TOP, 0.1, CARD_H * 0.5) }],
      },
      annotations: [{ text: 'Blocks moved as blocks — the order barely mixed', appearAt: 0.35 }],
    })
    steps.push({
      kind: 'move',
      id: 'set-down',
      label: 'Set it down and square up',
      duration: 1100,
      // easeInCubic: the stack barely moves for the first third of the beat,
      // which is exactly the window the supporting palm needs to slide out
      // from under it. (Anything front-loaded drags the cards down through
      // the fingers still holding them.)
      ease: 'easeInCubic',
      to: (dk) => stackLayout(dk),
      // A palm-up hand of this size cannot follow the cards all the way to the
      // felt — its own fingers are under them, so the LOWEST a cradle can hold
      // a pile is CRADLE_Y + one cup depth. The stack therefore has real height
      // to lose here. easeInCubic buys the withdrawal its window: the cards
      // barely move for the first third while the palm slides out from under
      // them, and only then do they settle.
      hands: {
        left: [
          // An explicit at:0 keyframe: without one the lead-in segment inherits
          // the STEP's ease (easeInCubic here), so the palm dawdled under the
          // falling stack for the first third of the beat.
          { at: 0, pose: cradle, anchor: cradleAt(0, 0) },
          { at: 0.35, pose: cradle, anchor: cradleAt(-DECK_REACH, CARD_H * 0.3), ease: 'easeOutCubic' },
          // Both hands finish this beat WIDE — pads a full card outboard of the
          // deck's long edge — because the stack is still falling through the
          // airspace they would otherwise be settling into. They come down onto
          // it in `rest`, once it has landed.
          { at: 1, pose: 'deckApproach', anchor: openAt(WIDE_X, TABLE_TOP, 0.06, CARD_H * 0.5), ease: 'easeOutCubic' },
        ],
        right: [
          { at: 1, pose: 'deckApproach', anchor: openAt(WIDE_X, TABLE_TOP, 0.06, CARD_H * 0.5), ease: 'easeOutCubic' },
        ],
      },
    })
    steps.push({
      kind: 'hold',
      id: 'rest',
      label: 'Blocks moved — barely mixed',
      duration: 800,
      // The closing beat RESTS on the deck rather than floating beside it.
      hands: {
        left: [
          {
            at: 0.75,
            pose: 'deckRest',
            anchor: restAt(DECK_PAD_X, TABLE_TOP, 0),
            ease: 'easeOutCubic',
            fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tighten', amp: 0.04 }],
          },
        ],
        right: [
          {
            at: 0.75,
            pose: 'deckRest',
            anchor: restAt(DECK_PAD_X, TABLE_TOP, 0),
            ease: 'easeOutCubic',
            fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tighten', amp: 0.04 }],
          },
        ],
      },
    })
    return steps
  },
}
