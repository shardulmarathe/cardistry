import * as THREE from 'three'
import { stackLayout, faceQuat } from '../engine/layouts'
import {
  poseWithContacts,
  resolvePenetration,
  surfaceContact,
  wristAnchorForContact,
} from '../authoring/contacts'
import { splitIntoRandomBlocks } from '../../lib/shuffleMath'
import { CARD_GAP, CARD_W, CARD_H, CARD_T } from '../../lib/constants'
import { getHandPose, DECK_REST_DROP } from '../../hands/handPoses'
import { contactFrame, fingerJointsWorld, fingertipWorld } from '../../hands/handKinematics'
import { FINGERS, FINGER_NAMES, HAND_SCALE } from '../../hands/handRigSpec'

// Strip shuffle — THE FINGERS TAKE THE PACKET, and this file is built backwards
// from that one requirement.
//
// WHAT THE OLD VERSION DID. The right hand picked the whole deck up, flew it
// across the table over the pile, and a packet "slipped out of the grip" — i.e.
// the packet's whole journey was a wrist translation, and the only thing any
// digit did all lesson was a 0.05 `tighten` at the very end. Measured, the hand
// articulated 0.47 radians per world-unit of wrist travel: the worst number in
// the catalog, and it looked like it — a rigid shape being flown around.
//
// WHAT DRIVES IT NOW. The deck never moves. It stays squared where the lesson
// starts it, the right hand holds its far edge down, and the LEFT hand strips
// packets off the top one at a time, each strip a close-and-draw of the four
// fingers. One scalar drives the beat — how far the hand is closed — and a
// small table maps it to what the pads are doing:
//
//   curl   middle pad (rel. wrist)   what the packet is doing
//   0.16   (-1.48, -0.56)            hand open, reaching over the deck
//   0.34   (-1.36, -0.73)            pads down on the top card
//   0.85   (-0.68, -1.02)            fingers closed, packet drawn back over the pile
//
// Curling 0.34 -> 0.85 retracts the pads 0.68 toward the palm, which is why the
// pile is built to the LEFT of the deck: for a left hand the fingers point at
// +x, so closing them draws whatever they are holding at −x. The packet is not
// animated to the pile — it is WELDED to the hand's `packet` contact frame, so
// while it is held it goes exactly where the fingertips go, and the last beat's
// drop onto the pile is the fingers opening again.
//
// NOTHING DOWNSTREAM IS TYPED. Every station comes out of the rig:
// `wristAnchorForContact` answers "where must the wrist be for this curl to put
// the middle pad HERE" and `dropAt` answers "how high for its deepest surface to
// rest on that card", so the wrist only ever supplies the travel the fingers
// cannot. `carryOver` then slides the closed hand in PLAN until the block it is
// holding arrives over the pile — a pure translation, so the curls and
// therefore the grip are untouched — and `LH_U` is derived from how far the
// pads slide across the block on the way, so they start and finish on it.
//
// PENETRATION. Every pad is authored PAD_AIR off the surface it rests on rather
// than tangent on it, because the idle-breathing overlay swings a pad about its
// own knuckle by (0.021 rad x the joint weights x half the finger's chain) —
// hand-sized, so the margin is measured off the chain instead of typed. The
// grips carry NO `pressure`, so that overlay is the only thing that can push a
// pad in, and resolvePenetration then runs against the real stacks as a net.

// The one wrist orientation this whole lesson uses: palm down, yawed so the
// fingers point along the table at the deck. Holding ONE orientation makes
// every beat a translation plus a curl, and neither of those can sweep a pad
// through a card the way a slerp between two orientations does.
const PALM_QUAT = getHandPose('deckRest', 'right').wrist.quat.clone()
const FOUR = ['index', 'middle', 'ring', 'pinky']
const chainLen = (name) => FINGERS[name].len.reduce((a, b) => a + b, 0) * HAND_SCALE
// Room for the idle overlay: it adds IDLE_CURL of curl distributed down the
// chain, which swings a pad through roughly (half the chain) x (that angle).
const IDLE_CURL = 0.021
const JOINT_SUM = 1 + 0.7 + 0.45
// A pad sits roughly half a chain from its knuckle in these open grips, and
// arc = radius x angle.
const swingOf = (curl) => chainLen('middle') * 0.5 * curl * JOINT_SUM
// HALVED, to the same number contacts.js uses. `swingOf` assumes a pad sits
// half a chain from its knuckle, which is true of a curled grip and not of the
// nearly straight hand this lesson opens with — and the difference is paid for
// twice, because it is added on top of MOTION_AIR and the solved LIFT. The idle
// overlay is instead DAMPED on the hand that does the gripping (LH_IDLE below),
// which is what makes this small a margin honest.
const PAD_AIR = 0.0015 * HAND_SCALE
// How much of the global idle-breathing overlay the STRIPPING hand runs at. The
// overlay staggers its phase per finger, so on a hand carrying a welded block
// the pads and the contact frame the block rides drift apart by more than the
// band the suite calls contact; a margin big enough to absorb that is a margin
// that never touches. Applied to every left keyframe so the overlay stays
// continuous — a scale that changed between segments would pop the block.
const LH_IDLE = 0.45
// A `fingerMotion` overlay is a second, larger swing on top of that, so any
// pose that carries one is authored this much further off its surface.
const MOTION_AMP = 0.03
const MOTION_AIR = swingOf(MOTION_AMP)

// A finger curls as a chain, so ONE number drives all three joints in the rig's
// own proportion — and that number is the whole strip.
const chain = (c) => [c, c * 0.85, c * 0.6]
const thumbChain = (c) => [c * 0.7, c * 0.6, c * 0.4]
const _tip = new THREE.Vector3()
// A held block rides this contact frame — a weighted fingertip centroid — so
// while it is held it goes exactly where the fingertips go.
const FRAME = 'packet'
const _fr = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() }
const atOrigin = (pose) => ({
  ...pose,
  wrist: { pos: new THREE.Vector3(), quat: pose.wrist.quat.clone() },
})

// --- How deep a hand hangs, measured over its whole surface -------------------
// `rigMetrics().drop` samples JOINTS only and therefore under-reads a slanted
// phalange by ~0.02. Sample along every capsule instead, exactly as handPoses'
// own DECK_*_DROP measurement does.
const _j = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
const _p = new THREE.Vector3()
// How deep a hand's own geometry sinks into a SLAB of cards it is carrying —
// the block modelled as one box, which it is (52 identical footprints stacked
// 0.004 apart). Same depth convention as resolvePenetration: 0 = tangent.
const slabDepth = (pose, side, cx, cy, cz, halfY) => {
  let worst = 0
  for (const name of FINGER_NAMES) {
    fingerJointsWorld(pose, side, name, _j)
    for (let i = 0; i < 3; i++) {
      const r = FINGERS[name].rad[i] * HAND_SCALE
      for (let k = 0; k <= 8; k++) {
        _p.copy(_j[i]).lerp(_j[i + 1], k / 8)
        const dx = Math.abs(_p.x - cx) - CARD_W / 2
        const dz = Math.abs(_p.z - cz) - CARD_H / 2
        const dy = Math.abs(_p.y - cy) - halfY
        if (dx > r || dy > r || dz > r) continue
        worst = Math.max(worst, Math.min(-dx, -dy, -dz) + r)
      }
    }
  }
  return worst
}
// Blend two shaped hands the way the compiler will — angles and wrist lerped.
const blendPose = (a, b, f) => {
  const p = {
    ...a,
    wrist: { pos: a.wrist.pos.clone().lerp(b.wrist.pos, f), quat: a.wrist.quat.clone() },
    fingers: {},
  }
  for (const name of FINGER_NAMES) p.fingers[name] = a.fingers[name].map((v, i) => v + (b.fingers[name][i] - v) * f)
  return p
}
// ...and the same for the PAD alone: how far this finger's fingertip SURFACE
// hangs below the wrist. This is the number that had to replace the one above,
// and the difference between them is exactly what the suite was measuring as a
// hover. `floorOf` is the deepest point of the WHOLE finger, which on a table
// grip is usually a knuckle or a mid-phalange, not the pad — so levelling four
// fingers by it presents four PADS at four different heights and only the
// luckiest of them is on the card. Measured on this lesson before the change:
// middle 0.086 off the block it was holding, index 0.211, ring 0.170, pinky
// 0.454. Levelling the pads instead is what puts all four on the cards.
const _pt = new THREE.Vector3()
const oneTip = (name, c) => {
  const p = getHandPose('deckRest', 'right')
  p.wrist.pos.set(0, 0, 0)
  p.fingers[name] = name === 'thumb' ? thumbChain(c) : chain(c)
  return -(fingertipWorld(p, 'right', name, _pt).y - FINGERS[name].rad[2] * HAND_SCALE)
}
// LEVEL THE PADS, and let each finger find its own curl to do it.
//
// The obvious thing — IK every fingertip onto the same plane — does not work on
// this rig, and the failure is not subtle: at the curls a table grip uses, a
// finger is already ~98% extended (the index's tip sits 0.0803 from its knuckle
// against a chain of 0.082), so a target even 0.10 lower is simply OUT OF
// REACH. solveFingerTo answers an unreachable target by pinning both joints at
// JOINT_LIMITS, which stands the finger straight down: measured, that put the
// index and ring 0.10 inside the pile they were reaching over.
//
// A finger can only get deeper by CURLING, so ask it for the curl instead of
// the point. Depth rises monotonically with curl up to the curl where the pad
// is directly under the knuckle and then falls again, so a fixed ladder plus a
// bisection is exact and deterministic. A finger too short to reach the plane
// (the pinky, usually) stops at its own deepest — hovering, never below.
const DEEPEST = {}
for (const name of FINGER_NAMES) {
  let best = { c: 0, d: 0 }
  for (let i = 0; i <= 40; i++) {
    const c = (1.5 * i) / 40
    const d = oneTip(name, c)
    if (d > best.d) best = { c, d }
  }
  DEEPEST[name] = best
}
const curlForDepth = (name, d) => {
  const peak = DEEPEST[name]
  if (d >= peak.d) return peak.c
  let lo = 0
  let hi = peak.c
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (oneTip(name, mid) < d) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
// The hand at "closedness" c: the MIDDLE finger takes that curl and sets the
// plane; every other finger curls until its own pad reaches the same plane.
const _shaped = new Map()
// The pads that CAN share a plane are the index, middle and ring; the pinky is
// 0.72 long against the middle's 1.02 and its own deepest pad position is 0.37
// shallower than the middle's at a full close, so asking it to join simply pins
// it. Cap the plane at the shallowest of the three instead — otherwise the
// middle, which reaches deepest, sets a plane the other two cannot make, and at
// the DRAW end of the stroke (where every finger is already at its own peak
// curl) they finish 0.10-0.14 above the block they are carrying. Measured, that
// one effect was most of this lesson's remaining gap: middle 0.065 versus index
// 0.185 and ring 0.145.
const shapedAt = (c) => {
  if (_shaped.has(c)) return _shaped.get(c)
  const d = oneTip('middle', c)
  const p = getHandPose('deckRest', 'right')
  p.fingers.thumb = thumbChain(c)
  p.fingers.middle = chain(c)
  for (const n of ['index', 'ring', 'pinky']) p.fingers[n] = chain(curlForDepth(n, d))
  _shaped.set(c, p)
  return p
}
// How far the whole hand hangs below its wrist at that closedness — the same
// measurement DECK_REST_DROP makes, taken per curl, so a wrist placed at
// (card top + this) leaves the deepest SURFACE exactly tangent on the card.
// How far the PADS hang below the wrist at that closedness — so a wrist placed
// at (card top + this) leaves the four fingertips exactly tangent on the card.
//
// This used to be `floorOf`, the deepest surface of the whole hand, and on this
// grip that is a knuckle: measuring by it lifted the wrist far enough for the
// knuckle to clear and left every pad hanging above the deck. The knuckles and
// the thumb are not forgotten — they are handed to `resolvePenetration` in
// `layOn`, which relaxes the individual fingers that actually reach into the
// stack instead of lifting the whole hand out of contact to protect them.
const _dropAt = new Map()
const dropAt = (c) => {
  if (!_dropAt.has(c)) {
    const p = shapedAt(c)
    p.wrist.pos.set(0, 0, 0)
    _dropAt.set(c, Math.max(...FOUR.map((n) => oneTip(n, p.fingers[n][0]))))
  }
  return _dropAt.get(c)
}
const C_OPEN = 0.16 // hand open, reaching over the deck
const C_GRIP = 0.34 // pads down on the top card
const C_DRAW = 0.85 // fingers closed, the packet drawn back over the pile
// How far the pads DROP between those last two — the whole reason the draw
// needs a peel: closing the hand on a card sinks them by this much, and if the
// deck is still under them that is straight through it.
const PAD_DROP = dropAt(C_DRAW) - dropAt(C_GRIP)

export const stripLesson = {
  id: 'strip',
  title: 'Strip Shuffle',
  technique: 'strip',
  difficulty: 'beginner',
  randomizes: 'Weak',
  seed: 33,
  cameraPreset: 'dealerPOV',
  summary:
    'The free hand closes on the top of the deck, draws a whole block off with its fingertips and drops it on a new pile — big blocks, so the mix stays weak.',
  facts: [
    'Strip shuffles move fewer, larger packets than the overhand — same block-transport weakness.',
    'Running cuts are the same family: packets stripped off and re-stacked without true interleaving.',
  ],
  build: (deck, ctx) => {
    const rng = ctx.rng
    const N = deck.length

    // --- Table geometry (card-sized; these must NOT scale with the hand) -----
    // The deck stays exactly where the lesson starts it (stackLayout's column),
    // so there is no pick-up and no ferry: every world-unit the hands travel
    // from here on is a unit they NEEDED to travel.
    const DECK_X = 0
    const DECK_Z = 0
    // The pile builds to the LEFT — the direction a left hand's fingertips
    // retract when they close. A card-and-a-tenth clear of the deck's column,
    // so the two footprints never overlap.
    const PILE_X = -(CARD_W * 1.55)
    const PILE_Z = 0
    const topAt = (n) => 0.02 + Math.max(0, n - 1) * CARD_GAP
    const FULL_TOP = topAt(N)
    const cardAt = (x, y, z) => ({ pos: [x, y, z], quat: faceQuat(false) })
    // EVERY card of a stack, not three representatives. A stack shares one
    // footprint, but it is 0.2 tall and each card is only 0.006 thick, so three
    // samples leave two 0.1-deep gaps a curled finger drops straight into
    // without touching any of them (measured: 0.11 of ring finger inside the
    // deck while resolvePenetration reported it clear).
    const spanOf = (x, n, z) => Array.from({ length: n }, (_, i) => cardAt(x, 0.02 + i * CARD_GAP, z))

    // --- Where the two hands sit on the top card -----------------------------
    // THE PADS DO NOT TRAVEL WITH THE BLOCK THEY CARRY, and this is the number
    // that had to be measured rather than guessed. A held block rides the
    // `packet` contact frame, and that frame is HALF THUMB — the thumb barely
    // retracts as the four fingers close — so the frame only moves about half as
    // far as the fingertips do, and a pad therefore SLIDES ACROSS the block by
    // the difference. Authored at the obvious spot (the near-centre of the top
    // card) the pads finished a quarter of a card PAST the block's near edge,
    // with the block floating in front of a hand that was no longer under it.
    //
    // So measure that slide and start the pads exactly that far the other way:
    // the hand closes on the deck's FAR half and finishes on the block's near
    // third, which is both a real strip and a hand that never leaves its block.
    const padVsFrame = (c) => {
      const p = atOrigin(shapedAt(c))
      fingertipWorld(p, 'right', 'middle', _tip)
      contactFrame(p, 'right', FRAME, _fr)
      return _tip.x - _fr.pos.x
    }
    const U_END = -0.8 // where the pads finish: the block's near third
    const LH_U = U_END + (padVsFrame(C_DRAW) - padVsFrame(C_GRIP)) / (CARD_W / 2)
    // The right hand braces the deck's far long edge, well outside the top
    // card's footprint, so its fingers and the left hand's never share a place.
    const DRAW_U = U_END
    // Squaring at the end is the one beat where both hands press the same stack;
    // they take a long edge each.
    const SQUARE_U = 0.55

    // --- Laying a hand on a card, measured off the rig -----------------------
    // Contacts are authored in RIGHT-hand coords and the engine mirrors them for
    // the left hand, so a left-hand contact is solved on the card's TRUE world
    // surface and then the POINT is mirrored — never the card.
    const aimAt = (side, card, finger, u, v, air) => {
      const p = surfaceContact(card, { finger, u, v, clearance: air })
      if (side === 'left') p.x = -p.x
      return p
    }
    // A hand laid across `card` at closedness `c`, its middle pad over `u`. The
    // SHAPE comes from `shapedAt` (pads levelled by curl) and the HEIGHT from
    // `dropAt` (the deepest surface tangent on the card's face plus its air) —
    // so the contact is structural, not solved, and no capsule of that hand can
    // be inside the stack at any x/z. Only the horizontal aim is IK-free
    // arithmetic: `wristAnchorForContact` says where the wrist must be for the
    // middle pad to land over `u`.
    const layOn = (side, card, c, u, { lift = 0, cards = null, anchor = null } = {}) => {
      const seed = shapedAt(c)
      const w =
        anchor ?? wristAnchorForContact(seed, 'right', 'middle', aimAt(side, card, 'middle', u, 0, 0).toArray())
      const a = [w[0], card.pos[1] + CARD_T / 2 + dropAt(c) + PAD_AIR + lift, w[2]]
      return poseWithContacts(seed, side, { anchor: a, quat: PALM_QUAT, cards, clearance: 0 })
    }

    // --- The weld: a held packet goes exactly where the fingertips go --------
    const frameAt = (pose, side) => {
      contactFrame(pose, side, FRAME, _fr)
      return { pos: _fr.pos.clone(), quat: _fr.quat.clone() }
    }
    // The packet's position in the grip frame, captured exactly as
    // compileLesson will capture it.
    const seatIn = (pose, side, card) => {
      const f = frameAt(pose, side)
      return {
        f,
        pos: new THREE.Vector3(card.pos[0], card.pos[1], card.pos[2])
          .sub(f.pos)
          .applyQuaternion(f.quat.clone().invert()),
      }
    }
    const carriedTo = (pose, side, seat) => {
      const f = frameAt(pose, side)
      return seat.pos.clone().applyQuaternion(f.quat).add(f.pos)
    }
    // Slide a solved hand until the packet it carries arrives OVER `target`.
    // A pure TRANSLATION, so the curls — and therefore the grip — are untouched
    // and this cannot walk the packet through the pads holding it.
    //
    // ONLY x AND z ARE FREE, and that is the whole trick. The frame is a
    // weighted fingertip centroid whose THUMB is half of it, and the thumb does
    // not travel with the four fingers as they close — so between the two poses
    // the packet's seat rises ~0.1 relative to the pads carrying it. Correcting
    // the height too would answer that by pushing the hand DOWN through the
    // pile (measured 0.107 deep). Correcting only the ground plan leaves the
    // block hanging exactly that much ABOVE the pile, held in the fingertips —
    // which is where a stripped block genuinely is, and the drop is then the
    // fingers opening in the next beat rather than a number typed here.
    const carryOver = (pose, side, seat, target, cards) => {
      const d = target.clone().sub(carriedTo(pose, side, seat))
      pose.wrist.pos.x += d.x
      pose.wrist.pos.z += d.z
      // ...unless the packet would arrive UNDER the pile, in which case the
      // whole hand rises (which only ever adds clearance).
      if (d.y > 0) pose.wrist.pos.y += d.y
      if (cards) resolvePenetration(pose, side, cards, { clearance: 0 })
      return carriedTo(pose, side, seat).y - target.y
    }

    // --- Packets -------------------------------------------------------------
    const blocks = splitIntoRandomBlocks(deck, 4, rng)
    const stripOrder = [...blocks].reverse() // packets leave from the TOP
    const newOrder = stripOrder.flat()

    const pilePoses = (block, piledCount) =>
      block.map((c, j) => ({
        id: c.id,
        pos: new THREE.Vector3(PILE_X, topAt(piledCount + j + 1), PILE_Z),
        quat: faceQuat(false),
        bend: 0,
      }))

    // --- The right hand: fingertips braced against the deck's FAR EDGE -------
    // Not on the top card, which is what every other hold in this catalog does.
    // The top card is exactly what LEAVES on every pass, so a hand resting on
    // it is a hand the block has to be lifted straight through — measured, 0.107
    // of right-hand finger inside the rising block, fifty times the budget.
    // Bracing the far long edge leaves the whole top face free for the hand
    // that is doing the work, and is what a hand steadying a deck actually
    // does. It also follows the stack DOWN as the deck thins: the brace is on
    // the middle of the remaining edge, so the hold is re-aimed every pass.
    const deckSpan = (n) => spanOf(DECK_X, n, DECK_Z)
    const rhEdge = (n, c = C_GRIP) => {
      // The last block empties the deck; there is no edge left to brace, so the
      // hand simply stays where the last card was and opens.
      if (n <= 0) return layOn('right', cardAt(DECK_X, FULL_TOP, DECK_Z), C_OPEN, SQUARE_U, { lift: CARD_H * 0.2 })
      const mid = cardAt(DECK_X, (0.02 + topAt(n)) / 2, DECK_Z)
      const seed = shapedAt(c)
      // '+x' is the card's far long-edge face; its `u` runs along the deck.
      const aim = surfaceContact(mid, { finger: 'middle', face: '+x', u: 0, clearance: PAD_AIR })
      const a = wristAnchorForContact(seed, 'right', 'middle', aim.toArray())
      return poseWithContacts(seed, 'right', { anchor: a, quat: PALM_QUAT, cards: deckSpan(n), clearance: 0 })
    }
    // Clear of everything, on its own side — where a hand waits before it has
    // been asked to do anything.
    const WING = CARD_W * 2.2
    const RH_WING = layOn('right', cardAt(DECK_X + WING, FULL_TOP, DECK_Z), C_OPEN, 0, { lift: CARD_H * 0.45 })
    const LH_WING = layOn('left', cardAt(PILE_X - WING * 0.5, FULL_TOP, PILE_Z), C_OPEN, 0, { lift: CARD_H * 0.45 })

    const NOTE = [0, 1.6, 0.7]
    const steps = [
      {
        kind: 'hold',
        id: 'ready',
        label: 'One hand pins the deck; the other opens over it',
        duration: 1100,
        hands: {
          // The at:0 keyframes are load-bearing: without one the first segment
          // starts from the carried-forward `relaxed` default, which at this
          // rig size opens the lesson with a whole fist inside the deck.
          right: [
            { at: 0, pose: RH_WING },
            { at: 1, pose: rhEdge(N), ease: 'easeOutCubic' },
          ],
          left: [
            { at: 0, pose: LH_WING },
            { at: 1, pose: layOn('left', cardAt(DECK_X, FULL_TOP, DECK_Z), C_OPEN, LH_U, { lift: CARD_H * 0.32 }), ease: 'easeOutCubic' },
          ],
        },
        annotations: [{ text: 'Strips move big blocks — quick, but a weak mix', at: NOTE, appearAt: 0.2 }],
      },
    ]

    let held = N
    let piled = 0
    stripOrder.forEach((block, k) => {
      const n = block.length
      const deckTop = cardAt(DECK_X, topAt(held), DECK_Z)
      const rest = held - n
      // The packet's top card: the one the pads land on, at the deck and then
      // on the pile. Everything else in the block rides along rigidly.
      const landed = cardAt(PILE_X, topAt(piled + n), PILE_Z)
      const pileSpan = spanOf(PILE_X, piled + n, PILE_Z)
      // The hand crosses BOTH columns on its way back, and by the last pass the
      // pile is the taller of the two — so every travelling station is measured
      // off whichever stack is currently highest, not off the one it happens to
      // be over. (Hovering over the deck alone put the returning index 0.06
      // inside the pile's near edge on the last pass.)
      const travelTop = cardAt(DECK_X, Math.max(topAt(held), topAt(piled + n)), DECK_Z)
      const TRAVEL_LIFT = DECK_REST_DROP * 0.36

      const hover = layOn('left', travelTop, C_OPEN, LH_U, { lift: TRAVEL_LIFT })
      const at = (pose, x, y, z) => ({
        ...pose,
        wrist: { pos: new THREE.Vector3(x, y, z), quat: pose.wrist.quat.clone() },
      })
      // THE WHOLE DRAW, built as a function of ONE unknown — how far off the
      // deck the hand takes the block — because that is exactly what the draw
      // itself decides.
      //
      // While the block is welded it rides the `packet` contact frame, and that
      // frame is HALF THUMB: the thumb does not travel with the four fingers as
      // they close, so the block's seat walks vertically relative to the pads
      // carrying it — measured, the pads end up 0.09 UNDER the block's own top
      // card halfway through the close, which is the pads inside the block.
      // Raising the grip pose by L lowers the seat by exactly L (the seat is
      // captured against the frame, and the block is not moving), so the
      // shortfall is linear in L: measure it at L = 0, then build the pass again
      // with that much air and the pads ride the block for the whole draw.
      const pass = (L) => {
        // NO MOTION_AIR here. The `tighten` overlay that this pose carries peaks
        // in the MIDDLE of the segment that arrives at it (sin²(πt)), and at that
        // instant the hand is still half way down from `hover` — a whole
        // TRAVEL_LIFT above the deck. Reserving for it at the pose's own station
        // reserves it where it is never needed, and that reservation lands
        // squarely on the beat the suite measures: this is the pose the grip
        // captures against, so every unit of air here is a unit of gap for the
        // whole strip.
        const grip = layOn('left', deckTop, C_GRIP, LH_U, { lift: L, cards: deckSpan(held) })
        const seat = seatIn(grip, 'left', deckTop)
        // The delivery: a closed hand set over the pile at the height its own
        // deepest surface can go, then slid in plan until it is carrying the
        // block there. Nothing about the landing spot is typed into the hand,
        // and nothing about the hand is typed into the pile.
        const drawn = layOn('left', landed, C_DRAW, DRAW_U, { lift: PAD_AIR })
        const fall = carryOver(
          drawn,
          'left',
          seat,
          new THREE.Vector3(landed.pos[0], landed.pos[1], landed.pos[2]),
          pileSpan,
        )
        // THE PEEL, and it is the one beat that has to happen before the curl.
        // Closing the hand sinks the pads by PAD_DROP about their own knuckles;
        // with the deck still underneath, that is the fingers going straight
        // down through it (measured 0.065 on the first pass). So the hand first
        // lifts the block STRAIGHT UP with its curl unchanged, and only then
        // closes — which is also exactly how a block comes off a deck.
        const carryY = Math.max(grip.wrist.pos.y + PAD_DROP, drawn.wrist.pos.y) + CARD_W * 0.12
        const peeled = at(grip, grip.wrist.pos.x, carryY, grip.wrist.pos.z)
        // ...then the fingers close and draw it back, high over both columns.
        const carried = at(
          drawn,
          (drawn.wrist.pos.x + grip.wrist.pos.x) / 2,
          carryY,
          (drawn.wrist.pos.z + grip.wrist.pos.z) / 2,
        )
        // The block is a slab (n-1)*CARD_GAP tall whose TOP card is where the
        // grip frame carries it, so the whole thing is one box to test against.
        const half = ((n - 1) * CARD_GAP + CARD_T) / 2
        // Relax whatever of the hand is inside the block it is holding, against
        // the block AT THE PLACE THE GRIP FRAME CARRIES IT — not at its layout
        // position, which it left the instant the weld captured.
        for (const st of [grip, drawn]) {
          const t = carriedTo(st, 'left', seat)
          resolvePenetration(
            st,
            'left',
            Array.from({ length: 3 }, (_, i) => ({
              pos: [t.x, t.y - (i * (n - 1) * CARD_GAP) / 2, t.z],
              quat: faceQuat(false),
            })),
            { clearance: 0 },
          )
        }
        let short = 0
        const stations = [peeled, carried, drawn]
        for (let i = 0; i < stations.length - 1; i++) {
          for (let f = 0; f <= 8; f++) {
            const p = blendPose(stations[i], stations[i + 1], f / 8)
            const top = carriedTo(p, 'left', seat)
            short = Math.max(short, slabDepth(p, 'left', top.x, top.y - half + CARD_T / 2, top.z, half))
          }
        }
        return { grip, drawn, fall, peeled, carried, short }
      }
      // `carryOver` only nudges the height when the block would otherwise land
      // UNDER the pile, so the relation is piecewise linear rather than linear —
      // repeat until the pads ride clear (three rounds is always enough).
      // LIFT IS A LAST RESORT, and it used to be the first one. `short` is the
      // deepest any part of the hand reaches into the block it is carrying, and
      // it is ONE finger: the middle, 0.055 in at the draw, because the middle
      // is the longest and the wrist is placed by its own pad. Answering that by
      // raising the WHOLE hand charges all five pads for one finger's overreach
      // — 0.06 of air on the beat the grip captures against, i.e. 0.06 of gap
      // for the whole strip. Relax the offending finger against the block where
      // the frame actually carries it first, and only lift for what is left.
      let out = pass(0)
      let LIFT = 0
      for (let i = 0; i < 3 && out.short > CARD_T; i++) {
        LIFT += out.short - CARD_T
        out = pass(LIFT)
      }
      const { grip, drawn, peeled, carried } = out
      // THE RELEASE, in that order too. Opening a closed hand sweeps its pads
      // 0.70 FORWARD as they rise — straight back across the pile they have
      // just built — and the blend between two shaped hands sags 0.14 below
      // either end on the way (depth is concave in curl). So the hand first
      // lifts off the block it is no longer holding, and only then opens, up at
      // travelling height where neither of those can reach a card.
      const lifted = at(drawn, drawn.wrist.pos.x, drawn.wrist.pos.y + PAD_DROP + CARD_W * 0.1, drawn.wrist.pos.z)
      const opened = at(
        layOn('left', travelTop, C_OPEN, LH_U, { lift: TRAVEL_LIFT }),
        drawn.wrist.pos.x,
        Math.max(lifted.wrist.pos.y, travelTop.pos[1] + CARD_T / 2 + dropAt(C_OPEN) + PAD_AIR + TRAVEL_LIFT),
        drawn.wrist.pos.z,
      )

      steps.push({
        kind: 'hold',
        id: `reach-${k}`,
        label: 'Reach over the deck and close on the top block',
        duration: 700,
        hands: {
          left: [
            { at: 0.45, pose: hover },
            // NOT easeOutCubic. A `tighten` overlay peaks in the middle of its own
            // segment, and easeOutCubic has the hand 96% of the way down by then —
            // so the squeeze fires with almost nothing left to give and presses the
            // pads into the deck (measured 0.007 in). On the default ease the hand
            // is half way down when it peaks, which is both clear and what closing
            // on a block looks like.
            { at: 1, pose: grip, fingerMotion: [{ fingers: FOUR, type: 'tighten', amp: MOTION_AMP }] },
          ],
          right: [{ at: 1, pose: rhEdge(held) }],
        },
        annotations:
          k === 0
            ? [{ text: 'The fingertips take the block — nothing is lifted by the arm', at: NOTE, appearAt: 0.35 }]
            : undefined,
      })

      steps.push({
        kind: 'move',
        id: `strip-${k}`,
        label: 'Draw the block off with the fingertips',
        duration: 950,
        ease: 'easeInOutCubic',
        // The deck itself never moves: its bottom is pinned and the block
        // simply leaves from the top.
        to: () => [],
        // Welded to the fingertip frame with NO pressure: a ramping squeeze
        // re-curls the gripping fingers, which walks the frame — and so the
        // whole packet — relative to the pads that are supposed to be holding
        // it, and the idle overlay is then the only thing PAD_AIR has to cover.
        grip: { left: { cards: block.map((c) => c.id), frame: FRAME } },
        hands: {
          left: [
            { at: 0.26, pose: peeled, ease: 'easeInOutCubic' },
            { at: 0.62, pose: carried, ease: 'easeInOutCubic' },
            { at: 1, pose: drawn, ease: 'easeInOutCubic' },
          ],
          // The hold has to LOOSEN for a block to be strippable — the pads lift
          // off the top card and settle back on the new one in `place`.
          right: [
            { at: 0.35, pose: rhEdge(held, C_GRIP * 0.5) },
            { at: 1, pose: rhEdge(held, C_GRIP * 0.72) },
          ],
        },
      })

      steps.push({
        kind: 'move',
        id: `place-${k}`,
        label: 'Open the fingers — the block drops square on the pile',
        duration: 650,
        ease: 'easeOutCubic',
        // Computed EAGERLY. `piled` is a mutating loop variable, so a
        // `() => pilePoses(block, piled)` thunk would resolve after build()
        // returns and see 52 for every block — the pile would build itself off
        // the top of the frame (the stale-closure trap (see ARCHITECTURE.md)).
        to: pilePoses(block, piled),
        hands: {
          left: [
            { at: 0.42, pose: lifted, ease: 'easeOutCubic' },
            { at: 1, pose: opened, ease: 'easeInOutCubic' },
          ],
          // ...and the right hand closes back down onto the card the block was
          // hiding, one packet lower than the one it was holding a beat ago.
          // It re-aims OPEN first: lerping straight from one solved hold to the
          // next runs the pads down an arc that bulges under both of them.
          right: [
            { at: 0.5, pose: rhEdge(rest, C_GRIP * 0.62) },
            { at: 1, pose: rhEdge(rest), fingerMotion: [{ fingers: FOUR, type: 'tighten', amp: MOTION_AMP }] },
          ],
        },
        annotations:
          k === 0 ? [{ text: 'Same neighbours, new block order — that is all a strip does', at: NOTE, appearAt: 0.4 }] : undefined,
      })

      held = rest
      piled += n
    })

    // --- Square up -----------------------------------------------------------
    const FINAL = cardAt(0, FULL_TOP, 0)
    const finalSpan = spanOf(0, N, 0)
    steps.push({
      kind: 'move',
      id: 'square',
      label: 'Both hands push the pile back together',
      duration: 1300,
      ease: 'easeInOutCubic',
      reorder: () => newOrder,
      to: (dk) => stackLayout(dk),
      hands: {
        left: [
          { at: 0.35, pose: layOn('left', FINAL, C_OPEN, -SQUARE_U, { lift: CARD_H * 0.3 }) },
          {
            at: 1,
            pose: layOn('left', FINAL, C_GRIP, -SQUARE_U, { lift: MOTION_AIR, cards: finalSpan }),
            ease: 'easeOutCubic',
            fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tighten', amp: MOTION_AMP }],
          },
        ],
        right: [
          { at: 0.35, pose: layOn('right', FINAL, C_OPEN, SQUARE_U, { lift: CARD_H * 0.3 }) },
          {
            at: 1,
            pose: layOn('right', FINAL, C_GRIP, SQUARE_U, { lift: MOTION_AIR, cards: finalSpan }),
            ease: 'easeOutCubic',
            fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tighten', amp: MOTION_AMP }],
          },
        ],
      },
      annotations: [{ text: 'Blocks moved as blocks — the order barely mixed', at: NOTE, appearAt: 0.35 }],
    })
    steps.push({
      kind: 'hold',
      id: 'rest',
      label: 'Restacked — same neighbours, new order',
      duration: 800,
      // The closing beat RESTS on the deck rather than drifting off it, and the
      // fingers settle onto it one after another instead of freezing.
      hands: {
        left: [
          {
            at: 1,
            pose: layOn('left', FINAL, C_GRIP, -SQUARE_U, { lift: MOTION_AIR, cards: finalSpan }),
            fingerMotion: [{ fingers: FOUR, type: 'curlRipple', amp: MOTION_AMP, cycles: 1 }],
          },
        ],
        right: [
          {
            at: 1,
            pose: layOn('right', FINAL, C_GRIP, SQUARE_U, { lift: MOTION_AIR, cards: finalSpan }),
            fingerMotion: [{ fingers: FOUR, type: 'curlRipple', amp: MOTION_AMP, cycles: 1 }],
          },
        ],
      },
    })
    for (const st of steps) {
      for (const kf of st.hands?.left ?? []) kf.idleScale = LH_IDLE
    }
    return steps
  },
}
