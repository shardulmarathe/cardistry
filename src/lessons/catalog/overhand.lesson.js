import * as THREE from 'three'
import { stackLayout, faceQuat } from '../engine/layouts'
import {
  poseWithContacts,
  resolvePenetration,
  surfaceContact,
  wristAnchorForContact,
} from '../authoring/contacts'
import { CARD_GAP, CARD_H, CARD_T, CARD_W } from '../../lib/constants'
import { getHandPose, cloneHandPose, DECK_REST_DROP, DECK_APPROACH_DROP } from '../../hands/handPoses'
import { applyGripPressure, contactFrame, fingerJointsWorld, fingertipWorld } from '../../hands/handKinematics'
import { FINGERS, FINGER_NAMES, HAND_SCALE } from '../../hands/handRigSpec'

// Overhand shuffle, rebuilt as a real one: THE DECK NEVER TOUCHES THE TABLE, and
// every packet that leaves it is drawn off by a hand closing on it.
//
// WHAT THIS REPLACES. The shipped version was a pile transfer, one hand ferried
// packets between two piles on the felt, twelve wrist-flights across the table,
// 0.94 radians of finger articulation per unit of wrist travel. The block
// mathematics were right and the mechanics were not; a real overhand never sets
// cards down. It was left alone deliberately, because at HAND_SCALE 4.6 the
// graspable span was 0.50 against a 0.63-wide card and nothing in the rig could
// cradle a deck while another hand worked on it. At 11 that constraint is gone.
//
// THE MOVE, AS GEOMETRY.
//   * The LEFT hand cradles the deck from BELOW: four levelled pads under the
//     bottom card, thumb braced on its near end, and NOTHING above the top face
//     or in the corridor the packets travel through. That one requirement rules
//     out every hold-from-above in this codebase, including the one hindu and
//     strip use, anything resting on the top face pins the packet being drawn.
//   * The RIGHT hand works from ABOVE, palm down in the `deckRest` straddle, and
//     a peel is that hand CLOSING: five pads land on the deck's far half and
//     travel across it and past its near edge, carrying the top packet with them.
//   * The packet is welded to the `packet` contact frame, so where it goes IS
//     where the fingers go, measured, not typed. `deliveryOf` runs the exact
//     capture-and-apply the compiler will run (pressure included) and reports
//     where the hand will have left the cards; the pile's x and z are that
//     answer, so the packets land under the hand that dropped them.
//
// WHY THE FINGERS AND NOT THE THUMB (a real overhand's thumb does this, and this
// rig's cannot, worth writing down so nobody spends another day on it). A thumb
// is a chain from a knuckle at WRIST height, and its proximal capsule is the
// fattest thing on the hand: radius 0.187, a third of a card width.
//   * Aim its pad at the deck's FAR edge, where a real overhand thumb goes,
//     because that is what leaves the peeled packet on the palm side, and the
//     chain enters the stack through its underside. Swept 40 wrist heights x 6 IK
//     seeds: there is no height where the pad is on the card and the chain is out
//     of it.
//   * Aim it at the NEAR edge and the chain clears, but the packet then hangs
//     0.435 to the far side of the pad, and a peel welds the packet to a frame
//     that is 3/4 thumb TIP while the thumb's own base stays put. The arithmetic
//     is fixed: the tip travels 0.37 past the base over the stroke, the packet's
//     half-width is 0.315, so the delivered packet ALWAYS straddles the base.
// The four fingers have neither problem: their knuckles ride above the deck and
// they curl a full card width. A hand closing over the top of a deck and drawing
// a packet off it is what the move looks like from the front anyway.
//
// FOUR MEASUREMENTS DO ALL THE WORK, and nothing else in this file is typed.
//   1. THE SEAT (`crestOf` + `levelCurls`). Each finger's own capsules rise a
//      different amount above its pad, so one shared curl presents four seats at
//      four heights and a flat card can rest on only the highest. Pick each
//      finger's curl so the four seats agree, and the deck lands wherever that
//      cradle holds it. No deck height is typed anywhere.
//   2. THE WRIST (`recvWristFor`). DECK_REST_DROP is measured off the PRESET's
//      gentle curls; this stroke folds far deeper, so the same wrist leaves a PIP
//      0.10 inside the cards. Raise until the pose's own deepest surface is
//      tangent on the top card.
//   3. THE LIFT (`strokePose`). Solved flat onto the card's plane, the stroke
//      drops the packet 0.3 on its way out, the frame pitches as the fingers
//      fold, and a packet sinking a third of a card while still over the deck
//      has to be chased by a deck that lifts out of its way, which then has to
//      come back down through the air the packet is falling through. Solve each
//      rung's height off the plane instead and the packet leaves LEVEL.
//   4. THE DRAW (`DRAW_OUT`). Pad travel alone can only go as far as the thumb
//      can follow, which leaves each packet released just past the deck's near
//      edge, directly over the holding hand's knuckles, which the falling packet
//      then clips. Drawing the wrist back half a card carries the whole frame.
//
// The stroke is a LADDER of solved poses, not two keyframes: lerping between two
// poses that are each clear of the cards is not itself clear (the fingers are
// deepest half way through), and the rungs are also most of why the hands in this
// lesson articulate 12x more than they used to.
//
// WHAT IS NOT A REAL OVERHAND HERE: the drawn packets fall onto a pile on the
// felt rather than into the other hand. The receiving hand cannot be the holding
// hand (its own fingers are on the deck), and a third hand is not available.

const PALM_UP = -Math.PI / 2
const yawed = (p, y, r = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(p, y, r, 'YXZ'))
const rotZ = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a)

// The cradle that HOLDS the deck: palm up, fingers reaching along world +x under
// the cards (authored for the right hand; the engine's x-mirror turns it into
// the left hand reaching in from its own side), thumb trailing to +z where it
// can brace the deck's near end without ever crossing its top face.
const HOLD_QUAT = yawed(PALM_UP, Math.PI / 2, 0)
// The cradle that RECEIVES: palm up, fingers pointing away from the camera, and
// ROLLED toward the deck. The roll is the load-bearing part. A thumb's flexion
// sweeps across its palm AND up off it, so on a level palm-up hand the peel
// would carry every packet UPWARD and the pile would end up above the deck it
// came from. Rolling the palm to face up-and-inward tips that arc over: at 0.5
// the same stroke descends 0.19, which is what puts the pile beside and below
// the deck, where an overhand's packets actually go.
const RECV_ROLL = 0.5
const RECV_QUAT = rotZ(-RECV_ROLL).multiply(yawed(PALM_UP + 0.45, 0, 0))

// Hand-sized breathing room (the idle overlay + the ease into a pose), and the
// deeper reserve a solved contact needs so a grip's runtime squeeze cannot press
// a pad through a card. Both scale with the rig.
const CONTACT_AIR = 0.003 * HAND_SCALE
const chainLen = (name) => FINGERS[name].len.reduce((a, b) => a + b, 0) * HAND_SCALE
const SHIELD = chainLen('middle') * (0.14 * 0.25 + 0.021)
const CARRIERS = ['index', 'middle', 'ring', 'pinky']

// A finger curls as a chain, so one number drives all three joints in the rig's
// own proportion.
const curl = (c) => [c, c * 0.85, c * 0.6]

const _j = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
const _p = new THREE.Vector3()

// How far a finger's own geometry rises ABOVE its pad. A packet seated at
// fingertip height is impaled on the knuckles behind the tip; add this and it
// rests on the finger's crook, which is both what a cradle looks like and what
// keeps every capsule outside the cards.
function crestOf(pose, side, name) {
  fingerJointsWorld(pose, side, name, _j)
  let crest = 0
  for (let i = 0; i < 3; i++) {
    const r = FINGERS[name].rad[i] * HAND_SCALE
    for (let k = 0; k <= 6; k++) {
      _p.copy(_j[i]).lerp(_j[i + 1], k / 6)
      crest = Math.max(crest, _p.y + r - _j[3].y)
    }
  }
  return crest
}

// The lowest finger SURFACE under the wrist, how high the wrist has to ride for
// nothing to dip through the felt.
function floorOf(pose, side) {
  let lo = 0
  for (const name of FINGER_NAMES) {
    fingerJointsWorld(pose, side, name, _j)
    for (let i = 0; i < 3; i++) {
      const r = FINGERS[name].rad[i] * HAND_SCALE
      for (let k = 0; k <= 4; k++) {
        _p.copy(_j[i]).lerp(_j[i + 1], k / 4)
        lo = Math.min(lo, _p.y - r)
      }
    }
  }
  return lo
}

const tipOf = (pose, side, name) => fingertipWorld(pose, side, name, new THREE.Vector3())

// Absolute height of the lowest finger SURFACE of a posed hand, `floorOf`'s
// answer for a hand that is already standing somewhere, which is what a
// deep-curl grip needs: the DECK_*_DROP constants are measured off the PRESET's
// own curls, and a hand curled twice that deep hangs a lot further below its
// wrist than the preset ever does.
function lowestSurface(pose, side) {
  let lo = Infinity
  for (const name of FINGER_NAMES) {
    fingerJointsWorld(pose, side, name, _j)
    for (let i = 0; i < 3; i++) {
      const r = FINGERS[name].rad[i] * HAND_SCALE
      for (let k = 0; k <= 4; k++) {
        _p.copy(_j[i]).lerp(_j[i + 1], k / 4)
        lo = Math.min(lo, _p.y - r)
      }
    }
  }
  return lo
}

export const overhandLesson = {
  id: 'overhand',
  title: 'Overhand Shuffle',
  technique: 'overhand',
  difficulty: 'beginner',
  randomizes: 'Weak',
  seed: 21,
  // The deck is held in the air for the whole shuffle, so the action lives near
  // y≈1.1; `overview` aims at 0.15 and would push it into the top of the frame.
  // The whole shuffle happens a hand's height off the felt and finishes in a
  // pile ON it, a metre of vertical spread, with the lesson panel taking the
  // bottom of the frame. `handsCradle` frames the hands beautifully and crops
  // the pile; `overview` and `dealerPOV` aim at 0.15 and crop the deck. Overhead
  // is the one angle that holds the deck, both hands and the growing pile at
  // once, and it is also the angle that shows what this shuffle IS: packets
  // walking sideways off a deck one at a time.
  cameraPreset: 'topDown',
  summary:
    'The everyday shuffle: hold the deck in one hand and let the other thumb peel packets off the top into your palm, one after another. Easy — but it only moves blocks, so it barely randomizes.',
  facts: [
    'The overhand only transports blocks of cards, so cards that start together tend to stay together.',
    'Rigorously, it can take on the order of 2,500 overhand shuffles to truly randomize 52 cards — versus about 7 riffles.',
  ],
  build: (deck, ctx) => {
    const rng = ctx.rng
    const N = deck.length
    const DECK_H = (N - 1) * CARD_GAP
    const TABLE_TOP = 0.02 + DECK_H
    const FLAT = faceQuat(false)
    const cardAt = (x, y, z) => ({ pos: [x, y, z], quat: FLAT })

    // A pose under one of the two cradle orientations, with the four carriers
    // curled by a per-finger table and the thumb by a single number.
    const cradleBase = (quat, thumbC, curls) => {
      const p = getHandPose('palmCradle', 'right')
      p.wrist.quat.copy(quat)
      p.wrist.pos.set(0, 0, 0)
      p.fingers.thumb = curl(thumbC)
      for (const name of CARRIERS) p.fingers[name] = curl(curls[name])
      return p
    }

    // LEVEL THE PADS. The four fingers are different lengths, so one shared curl
    // presents four seats at four different heights and a flat card can only
    // rest on the highest, the other three end up inside it (or, once
    // `resolvePenetration` has backed them out, nowhere near it). Pick each
    // finger's own curl so all four seats agree, by scanning a ladder of curls
    // and keeping the closest: deterministic, and it re-solves itself if the rig
    // changes. The scan is deliberately restricted to DEEP curls, a shallow
    // finger reaches the same height by pointing straight out across the table,
    // which puts a fingertip in the corridor the peeled packets fall through.
    const levelCurls = (quat, side, base) => {
      const seatOf = (p, n) => tipOf(p, side, n).y + crestOf(p, side, n)
      const flat = (c) => Object.fromEntries(CARRIERS.map((n) => [n, c]))
      const target = seatOf(cradleBase(quat, 0.55, flat(base)), 'middle')
      const out = { middle: base }
      for (const name of ['index', 'ring', 'pinky']) {
        let best = base
        let bestD = Infinity
        for (let i = 0; i <= 32; i++) {
          const c = Math.max(1.0, base - 0.5) + (1.63 - Math.max(1.0, base - 0.5)) * (i / 32)
          const d = Math.abs(seatOf(cradleBase(quat, 0.55, flat(c)), name) - target)
          if (d < bestD) {
            bestD = d
            best = c
          }
        }
        out[name] = best
      }
      return { curls: out, seat: target }
    }

    // --- The holding hand, and the deck height that follows from it ----------
    // A DEEP cup, and that is a framing decision as much as an anatomical one: a
    // palm-up hand can only get its own knuckles to the felt, so the shallower
    // the cradle the higher the deck it is holding rides, at 1.25 the deck sits
    // at y=1.13 and the receiving hand's wrist at 2.5, which is off the top of
    // every camera preset in the catalog. Curling the cup brings the pads back
    // over the palm and the whole shuffle down into frame.
    const HOLD_LV = levelCurls(HOLD_QUAT, 'left', 1.55)
    const holdSeed = cradleBase(HOLD_QUAT, 0.55, HOLD_LV.curls)
    // As low as the felt lets a palm-up hand go. Everything else in the lesson
    // stacks on top of this one number.
    const HOLD_WRIST_Y = -floorOf(holdSeed, 'left') + 0.012 + CONTACT_AIR
    const DECK_Y = HOLD_WRIST_Y + HOLD_LV.seat + CARD_T / 2 + SHIELD
    // Centre the deck over the pads (measured), not over the wrist: at this
    // scale the two are 0.4 apart.
    const HOLD_MID = tipOf(holdSeed, 'left', 'middle')
    const DECK_X = 0
    // Nudged toward the camera: the shuffle happens a hand's height off the felt,
    // and from overhead a high object reads as displaced toward the camera's own
    // axis. This puts it back in the middle of the frame.
    const DECK_Z = 0.34
    // Left-hand geometry is authored MIRRORED in x (the engine negates anchor
    // and target x for side:'left'), so a world point goes through `Lp`/`Lc`.
    const Lp = (p) => [-p[0], p[1], p[2]]
    const Lc = (c) => ({ pos: [-c.pos[0], c.pos[1], c.pos[2]], quat: c.quat })
    // The pads sit in the deck's FAR half, not under its centre. That is the
    // whole of what keeps the holding hand out of the way: the peeled packets
    // land beside and below the deck, and a fingertip under the deck's near half
    // is exactly where the growing pile's edge wants to be.
    const HOLD_PAD_U = -1.0
    const HOLD_WRIST = Lp([
      DECK_X + HOLD_PAD_U * (CARD_W / 2) - HOLD_MID.x,
      HOLD_WRIST_Y,
      DECK_Z - HOLD_MID.z,
    ])

    const deckCards = (m, y) =>
      Array.from({ length: m }, (_, i) => cardAt(DECK_X, y + i * CARD_GAP, DECK_Z))
    const deckTopCard = (m, y) => cardAt(DECK_X, y + (m - 1) * CARD_GAP, DECK_Z)

    // The cradle itself: pads already seated by construction, thumb solved onto
    // the deck's near END face (the one surface a holding hand can brace without
    // reaching over the top), then every finger backed off a SHIELDED stack so
    // the idle overlay cannot press one home.
    const holdPose = (() => {
      const pose = poseWithContacts(holdSeed, 'left', { anchor: HOLD_WRIST, quat: HOLD_QUAT }, {
        thumb: { card: Lc(cardAt(DECK_X, DECK_Y + DECK_H * 0.45, DECK_Z)), face: '+y', u: 0, v: 0 },
      })
      // Resolve against the REAL stack only. The seat above already floats the
      // deck a SHIELD above the crest of these fingers, so adding a second
      // shield card below it double-counts the margin, and `resolvePenetration`
      // pays for margin by STRAIGHTENING, which on this cradle throws the
      // fingertips 0.7 outboard, straight into the corridor the peeled packets
      // travel through. (Measured: every packet clipped the middle fingertip.)
      resolvePenetration(pose, 'left', deckCards(N, DECK_Y), { clearance: 0 })
      return pose
    })()

    // --- The receiving hand ---------------------------------------------------
    // PALM DOWN, over the deck, fingers pointing at the table centre, the same
    // `deckRest` straddle every other lesson in this catalog settles a hand with,
    // and the ONE configuration in which a peel is geometrically possible.
    //
    // The thumb cannot do this move on this rig, and it is worth writing down why
    // so nobody spends another day on it. A thumb is a chain from a knuckle that
    // sits at WRIST height, and its proximal capsule is the fattest thing on the
    // hand (radius 0.187, a third of a card width):
    //   * aim its pad at the deck's FAR edge (where a real overhand thumb goes,
    //     because that is what leaves the peeled packet on the palm side) and the
    //     chain enters the stack through its underside. Measured over a 40-step
    //     sweep of wrist heights x 6 IK seeds: there is no height where the pad
    //     is on the card and the chain is out of it.
    //   * aim it at the NEAR edge and the chain stays clear, but then the packet
    //     hangs 0.435 to the far side of the pad, and since a peel welds the
    //     packet to a frame that is 3/4 thumb TIP while the thumb's own base
    //     stays put, the delivered packet always straddles that base. The
    //     arithmetic is fixed: the tip travels 0.37 past the base over the
    //     stroke, the packet's half-width is 0.315, so it cannot clear.
    // The four fingers have neither problem. Their knuckles ride ABOVE the deck,
    // they curl a full card-width, and a hand closing over the top of the deck
    // and drawing a packet off it is exactly what an overhand looks like.
    const RECV_SEED = 'deckRest'
    // Where each pad sits ACROSS the deck (u, in card half-widths) at the two
    // ends of the stroke, and where each sits ALONG it (v, per finger, so the
    // four spread over the card instead of stacking on one line).
    const PAD_OPEN_U = -0.55 // fingers land on the deck's FAR half…
    const PAD_DRAG_U = 3.2 // …and finish past its NEAR edge, packet in tow
    const PAD_V = { index: -0.62, middle: -0.2, ring: 0.22, pinky: 0.64 }
    // The thumb rides the deck's FAR short end. Not a free choice: `deckRest`
    // trails its thumb to -z (see handPoses), so a target at +z is on the wrong
    // side of the hand entirely, the solver answers by pinning the joints and
    // parking the tip half a hand ABOVE the cards, and since the `packet` frame
    // weights that tip at one HALF, the carried packet then hangs 0.5 under a
    // frame that pitches as the fingers fold. Measured, that one unreachable
    // target was the whole of the packet's 0.3 mid-stroke dive.
    const THUMB_V = -0.9
    const padTargets = (card, u, lift = 0) => {
      const out = {}
      for (const name of CARRIERS) {
        out[name] = surfaceContact(card, { finger: name, u, v: PAD_V[name], clearance: lift })
      }
      out.thumb = surfaceContact(card, { finger: 'thumb', u: u * 0.55, v: THUMB_V, clearance: lift })
      return out
    }
    // The wrist that puts this pose's middle pad on the deck's top card, at the
    // height where its DEEPEST capsule is tangent (DECK_REST_DROP is measured
    // off the rig for exactly this).
    const recvWristFor = (m, y, u = PAD_DRAG_U) => {
      const top = deckTopCard(m, y)
      const a = wristAnchorForContact(
        RECV_SEED,
        'right',
        'middle',
        surfaceContact(top, { finger: 'middle', u: PAD_OPEN_U, v: PAD_V.middle }).toArray(),
      )
      // DECK_REST_DROP is the right STARTING guess and the wrong final answer:
      // it is measured off `deckRest`'s own gentle curls, and this stroke folds
      // the fingers far deeper than that, so the same wrist leaves a PIP 0.10
      // inside the cards half way through. Raise until the pose's own deepest
      // surface is tangent on the top card, measured, on the deepest rung of
      // the stroke, so every shallower one clears for free.
      const wrist = [a[0], top.pos[1] + DECK_REST_DROP, a[2]]
      const want = top.pos[1] + CARD_T / 2 + CONTACT_AIR
      for (let i = 0; i < 5; i++) {
        const probe = poseWithContacts(RECV_SEED, 'right', { anchor: wrist }, padTargets(top, u))
        const need = want - lowestSurface(probe, 'right')
        if (need <= 0) break
        wrist[1] += need
      }
      return wrist
    }
    // A receiving pose: five pads solved onto the top card at `u`, then every
    // finger backed off a SHIELDED stack so the runtime squeeze and the idle
    // overlay have somewhere to go. The shield is what the `clearance` argument
    // is NOT: clearance is a tolerance, and a non-zero one buys penetration.
    const recvPose = (wrist, m, y, u, lift = 0) => {
      const top = deckTopCard(m, y)
      const pose = poseWithContacts(RECV_SEED, 'right', { anchor: wrist }, padTargets(top, u, lift))
      resolvePenetration(
        pose,
        'right',
        [...deckCards(m, y), cardAt(DECK_X, y + (m - 1) * CARD_GAP + SHIELD, DECK_Z)],
        { clearance: 0 },
      )
      return pose
    }

    // The grip's squeeze. Constant across a peel so the frame it produces is the
    // frame `holdFrameAt` will produce (it applies the same pressure at capture
    // AND at render), which is what lets the delivery below be MEASURED rather
    // than guessed.
    const PRESS = 0.22
    const FRAME = 'packet'
    const frameOf = (pose) => {
      const c = cloneHandPose(pose)
      applyGripPressure(c, FRAME, PRESS)
      return contactFrame(c, 'right', FRAME, {
        pos: new THREE.Vector3(),
        quat: new THREE.Quaternion(),
      })
    }
    // Where the fingers will have put a card that started at `start`: capture the
    // offset exactly as compileLesson does, then apply the closed frame.
    const deliveryOf = (openPose, dragPose, start) => {
      const a = frameOf(openPose)
      const b = frameOf(dragPose)
      return start.clone().sub(a.pos).applyQuaternion(a.quat.clone().invert()).applyQuaternion(b.quat).add(b.pos)
    }

    // --- The peel, measured once ---------------------------------------------
    // One representative stroke (full deck, top card) gives the two numbers the
    // rest of the lesson is built on: where a stripped packet ends up, and how
    // far the deck has to yield to stay off it.
    const probeWrist = recvWristFor(N, DECK_Y)
    const probeOpen = recvPose(probeWrist, N, DECK_Y, PAD_OPEN_U)
    const deckTopCentre = new THREE.Vector3(DECK_X, DECK_Y + DECK_H, DECK_Z)
    // ONE RUNG OF THE STROKE, with its lift SOLVED. The stroke is what moves the
    // cards, so the cards' path is this function's answer, not a number typed
    // beside it: for a pad position `u`, find the height off the card's plane at
    // which the frame delivers the packet LEVEL with the deck's top. Four passes
    // converge (the delivery follows the pads almost one for one). Without it the
    // packet dives 0.3 mid-stroke, under the deck it is being drawn off, and
    // through the fingers of the hand holding it.
    // The hand DRAWS BACK as it closes, half a card, no more. Without it the
    // stroke is pad-travel only, and the pads can only travel as far as the thumb
    // can follow (its target runs off the end of the card long before theirs
    // does), which leaves each packet released barely clear of the deck's near
    // edge, i.e. directly above the holding hand's own knuckles, which the
    // falling packet then clips. Drawing the wrist back carries the thumb with
    // it, so the whole frame keeps up with the fingers.
    const DRAW_OUT = CARD_W * 1.05
    const rungWrist = (w, f) => [w[0] + DRAW_OUT * f, w[1], w[2]]
    const strokePose = (wrist, m, y, u, openPose) => {
      const topCentre = new THREE.Vector3(DECK_X, y + (m - 1) * CARD_GAP, DECK_Z)
      const want = topCentre.y + CARD_T
      let lift = 0
      let pose = recvPose(wrist, m, y, u, 0)
      if (!openPose) return pose
      for (let i = 0; i < 4; i++) {
        const need = want - deliveryOf(openPose, pose, topCentre).y
        if (need <= 0) break
        lift += need
        pose = recvPose(wrist, m, y, u, lift)
      }
      return pose
    }

    // THE FINGERS LIFT AS THEY DRAW. Solved flat onto the card's own plane, the
    // stroke drops the packet 0.25 on its way out, the frame pitches as the
    // fingers fold, and a packet sinking a quarter of a card while it is still
    // over the deck has to be chased by a deck that lifts out of the way, which
    // in turn has to be un-lifted on the drop beat while the packet is falling
    // through the same air. Measured, that chase was every remaining hit in the
    // lesson. Lift the drag targets off the plane instead, by exactly the sink:
    // the packet then leaves the deck LEVEL, sliding off its top card, and the
    // deck only has to yield a couple of card thicknesses.
    const probeDrag = strokePose(rungWrist(probeWrist, 1), N, DECK_Y, PAD_DRAG_U, probeOpen)
    const DELIVERY = deliveryOf(probeOpen, probeDrag, deckTopCentre)
    // How far the packet SINKS as it is drawn off, and therefore how far the deck
    // must yield: the two overlap in plan view until the packet has travelled a
    // full card width, so the only separation available for the first part of the
    // stroke is vertical.
    const DECK_LIFT = Math.max(CARD_T * 3, DECK_Y + DECK_H - DELIVERY.y + CARD_T)
    // The pile is on the felt, directly under where the fingers let go, its x
    // and z are the DELIVERY's, not a chosen spot, so the cards land under the
    // hand that dropped them however the rig changes.
    const PILE_X = DELIVERY.x
    const PILE_Z = DELIVERY.z
    const PILE_Y = 0.02

    // --- Layout helpers -------------------------------------------------------
    // Full-deck pose arrays: `held` are still in the cradle, `piled` have landed.
    const layout = (held, heldY, piled) => {
      const out = []
      held.forEach((c, i) =>
        out.push({
          id: c.id,
          pos: new THREE.Vector3(DECK_X, heldY + i * CARD_GAP, DECK_Z),
          quat: faceQuat(c.isFaceUp),
          bend: 0,
        }),
      )
      piled.forEach((c, i) =>
        out.push({
          id: c.id,
          pos: new THREE.Vector3(PILE_X, PILE_Y + i * CARD_GAP, PILE_Z),
          quat: faceQuat(c.isFaceUp),
          bend: 0,
        }),
      )
      return out
    }

    // --- Stations for the table pickup and the set-down -----------------------
    // Same measured primitives the other lessons use: `wristAnchorForContact`
    // for reach, `top + DECK_*_DROP` for a drop that lands the pose's lowest
    // finger SURFACE tangent on the top card.
    const padAnchor = (poseName, x, top, z, drop) => {
      const a = wristAnchorForContact(
        poseName,
        'right',
        'middle',
        surfaceContact(cardAt(x, top, z), { finger: 'middle' }).toArray(),
      )
      return [a[0], top + drop, a[2]]
    }
    const restAt = (x, top, z) => padAnchor('deckRest', x, top, z, DECK_REST_DROP)
    const openAt = (x, top, z, lift = 0) => padAnchor('deckApproach', x, top, z, DECK_APPROACH_DROP + lift)
    // …and the same two stations for the LEFT hand, which is authored mirrored:
    // pass the WORLD x you want its pads at and the negation happens once, here,
    // instead of at five call sites where a sign slip sends the holding hand
    // across the table and through the deck (it did).
    const leftRest = (wx, top, z) => restAt(-wx, top, z)
    const leftOpen = (wx, top, z, lift = 0) => openAt(-wx, top, z, lift)
    // Clear of the deck's column by more than a card, the only place the left
    // hand is allowed to turn over. A grip is NEVER held across that turn: a
    // fingertip frame carries the deck rigidly, so a 180° wrist turn would stand
    // it on edge. The deck waits, squared, while the hand goes around it.
    const SIDE_X = CARD_W * 1.75
    // Move the solved cradle bodily: its anchor is one measured point, so any
    // station is that point plus a world offset.
    const cradleAt = (dx, dy, dz) => [HOLD_WRIST[0] - dx, HOLD_WRIST[1] + dy, HOLD_WRIST[2] + dz]
    const liftedCradle = cradleAt(0, DECK_LIFT, 0)

    // --- Blocks ---------------------------------------------------------------
    // Peel from the TOP: the first packet stripped ends up at the BOTTOM of the
    // new pile, which is the whole of what an overhand does to the order.
    const PACKETS = 7
    // NOT `splitIntoRandomBlocks`: it draws each block uniformly from 1 to
    // "everything that is left", which routinely hands the first draw 45 of 52
    // cards, and the packets are stripped from the TOP, so the first peel then
    // tries to drag most of the deck off in one go (measured: 51 cards welded to
    // one thumb). A shuffler takes roughly even packets, so take roughly even
    // packets: the nominal share of what is left, jittered by up to a quarter of
    // itself, with the last block taking the remainder.
    const blocks = []
    let unsplit = N
    let cut = 0
    for (let i = 0; i < PACKETS; i++) {
      const left = PACKETS - i
      const nominal = unsplit / left
      const size =
        left === 1
          ? unsplit
          : Math.max(2, Math.min(unsplit - (left - 1) * 2, Math.round(nominal * (1 + (rng() - 0.5) * 0.5))))
      blocks.push(deck.slice(cut, cut + size))
      cut += size
      unsplit -= size
    }
    const stripOrder = [...blocks].reverse()
    const newOrder = stripOrder.flat()

    const steps = []
    const NOTE = { appearAt: 0.2 }

    steps.push({
      kind: 'hold',
      id: 'ready',
      label: 'Reach in and take the deck',
      duration: 1100,
      camera: 'overview',
      hands: {
        // The at:0 keyframes are load-bearing on both sides. Without one the
        // compiler builds a lead-in FROM the pose carried forward, which at the
        // first step of a lesson is `relaxed` at its own default wrist, a hand
        // parked at x=±0.95 with its thumb base 1.57 inboard of that, i.e.
        // straight through the deck. That phantom frame alone used to be this
        // lesson's whole penetration budget.
        left: [
          { at: 0, pose: 'deckApproach', anchor: leftOpen(-CARD_W * 2.2, TABLE_TOP, -CARD_H * 0.2, CARD_H * 0.5) },
          { at: 1, pose: 'deckRest', anchor: leftRest(0, TABLE_TOP, 0), ease: 'easeOutCubic' },
        ],
        right: [
          { at: 0, pose: 'deckApproach', anchor: openAt(CARD_W * 2.6, TABLE_TOP, CARD_H * 0.3, CARD_H * 0.9) },
          { at: 1, pose: 'deckApproach', anchor: openAt(CARD_W * 2.6, TABLE_TOP, CARD_H * 0.3, CARD_H * 0.9) },
        ],
      },
      annotations: [{ text: 'The deck stays in the hand — an overhand never puts it down', ...NOTE }],
    })

    steps.push({
      kind: 'move',
      id: 'lift',
      label: 'Lift it to working height',
      duration: 1200,
      ease: 'easeInOutCubic',
      camera: 'topDown',
      // Hand and deck travel between two stations exactly one deck-travel apart,
      // welded to a fingertip frame, so the offset is constant for the flight.
      grip: { left: { cards: 'all', frame: 'packet', pressure: [{ at: 0, v: 0.2 }, { at: 1, v: 0.2 }] } },
      to: layout(deck.slice(), DECK_Y, []),
      hands: {
        left: [{ at: 1, pose: 'deckRest', anchor: leftRest(DECK_X, DECK_Y + DECK_H, DECK_Z) }],
      },
    })

    steps.push({
      kind: 'hold',
      id: 'turn',
      label: 'Turn the hand under the deck',
      duration: 1200,
      hands: {
        left: [
          // out of the deck's column, still palm-down…
          { at: 0.3, pose: 'deckRest', anchor: leftRest(-SIDE_X, DECK_Y + DECK_H, DECK_Z) },
          // …turn palm-up out there, at the cradle's own height…
          { at: 0.68, pose: holdPose, anchor: cradleAt(-SIDE_X, 0, 0), ease: 'easeInOutCubic' },
          // …and slide in LAST, horizontally, so the pads travel in UNDER the
          // bottom card and stop one measured seat below it.
          { at: 1, pose: holdPose, anchor: HOLD_WRIST, ease: 'easeInCubic' },
        ],
        // The receiving hand comes in wide and high, then drops into its station
        //, never across the deck's column.
        right: [
          { at: 0.5, pose: 'deckApproach', anchor: openAt(CARD_W * 2.6, DECK_Y + DECK_H, CARD_H * 0.3, CARD_H * 0.5) },
          {
            at: 1,
            pose: recvPose(recvWristFor(N, DECK_Y), N, DECK_Y, PAD_OPEN_U),
            anchor: recvWristFor(N, DECK_Y),
            ease: 'easeOutCubic',
          },
        ],
      },
      annotations: [{ text: 'Deck on the fingers, thumb braced on its near end', appearAt: 0.55 }],
    })

    let held = deck.slice()
    let piled = []
    stripOrder.forEach((block, k) => {
      const size = block.length
      const ids = block.map((c) => c.id)
      const rest = held.slice(0, held.length - size)
      // SNAPSHOTS, and `to:` below takes the ARRAY rather than a thunk. `piled`
      // is a mutating loop variable and the compiler resolves a `to` function
      // AFTER build() returns, so a closure over it hands every step the FINAL
      // pile and the whole deck teleports into the palm on the first peel. (The
      // exact trap this lesson's previous incarnation was rebuilt to avoid; see
      // the session-4 note in HANDS_HANDOFF.md.)
      const before = piled.slice()
      const landed = piled.concat(block)
      // The deck's top sinks by one packet on every pass, so BOTH ends of the
      // stroke are re-solved against the card the pads will actually touch, and
      // the wrist comes down with it. That descent is the only wrist motion the
      // receiving hand makes in the whole shuffle: 0.03 per peel, the thickness
      // of the packet that just left.
      const wristNow = recvWristFor(held.length, DECK_Y)
      // THE STROKE AS A LADDER, not two keyframes. Lerping between two poses
      // that are each clear of the cards is NOT clear: solved only at its ends,
      // this stroke folds the fingers deepest half way through and the PIPs sit
      // 0.13 inside the deck there. Solving four rungs pins the curl the fingers
      // actually pass through, and costs nothing at compile time.
      const RUNGS = 5
      const openNow = recvPose(wristNow, held.length, DECK_Y, PAD_OPEN_U, 0)
      // Each rung gets its OWN wrist height: the hand comes down onto the deck
      // at the start of the stroke and rises with its own fingers as they fold
      // under. Measuring every rung against the deepest one instead parks the
      // whole hand 0.6 up, out of the top of every camera preset, for the
      // entire lesson.
      // ONE wrist height for the whole stroke, measured on its DEEPEST rung.
      // Per-rung heights are prettier, the hand comes down onto the deck and
      // rises with its own fingers, and they put the delivery back inside the
      // holding hand: the release ends 0.15 short and every packet clips the
      // cradle's index on its way down. The stroke keeps one station.
      const rungAt = (i) => rungWrist(wristNow, i / RUNGS)
      const stroke = Array.from({ length: RUNGS + 1 }, (_, i) =>
        i === 0
          ? openNow
          : strokePose(
              rungAt(i),
              held.length,
              DECK_Y,
              PAD_OPEN_U + (PAD_DRAG_U - PAD_OPEN_U) * (i / RUNGS),
              openNow,
            ),
      )
      const drag = stroke[RUNGS]
      // The return keyframe of the drop: the hand opening back over what is left.
      const restCount = Math.max(1, rest.length)
      const nextWrist = recvWristFor(restCount, DECK_Y)
      const nextOpen = recvPose(nextWrist, restCount, DECK_Y, PAD_OPEN_U)
      // The return, solved on the deck the fingers are coming back to.
      const back = Array.from({ length: RUNGS }, (_, i) => {
        const f = (RUNGS - 1 - i) / RUNGS
        return i === RUNGS - 1
          ? nextOpen
          : strokePose(
              rungWrist(nextWrist, f),
              restCount,
              DECK_Y,
              PAD_OPEN_U + (PAD_DRAG_U - PAD_OPEN_U) * f,
              nextOpen,
            )
      })

      steps.push({
        kind: 'move',
        id: `peel-${k}`,
        label: 'Draw a packet off the top',
        duration: 780,
        // ONE ease for the whole beat, and that is not cosmetic: the packet sinks
        // as it is drawn off while it is still inside the deck's footprint, and
        // the only thing keeping the deck off it is the yield running on the same
        // curve.
        ease: 'easeInOutCubic',
        grip: {
          right: {
            cards: ids,
            frame: FRAME,
            pressure: [{ at: 0, v: PRESS }, { at: 1, v: PRESS }],
          },
        },
        // The packet's `to` is nominal and never reached, while it is held it
        // goes exactly where the fingers go.
        to: layout(rest, DECK_Y + DECK_LIFT, before),
        hands: {
          // The explicit at:0 matters twice over: the grip captures its offset
          // against whatever pose the frame is in at that instant, and the rungs
          // in between are what keep the fingers out of the cards.
          right: stroke.map((pose, i) => ({
            at: i / RUNGS,
            pose,
            anchor: rungAt(i),
            fingerMotion:
              i === RUNGS
                ? [{ fingers: ['index', 'middle'], type: 'tremor', amp: 0.02, cycles: 2 }]
                : undefined,
          })),
          left: [{ at: 1, pose: holdPose, anchor: liftedCradle }],
        },
        annotations:
          k === 0
            ? [{ text: 'The fingers do all of it — close on the top packet and draw it back', ...NOTE }]
            : undefined,
      })

      steps.push({
        kind: 'move',
        id: `drop-${k}`,
        label: 'Let it drop onto the pile',
        duration: 620,
        // snapEase: the packet is most of the way down by t=0.3, which is the
        // window the hand needs before it opens back over the deck through the
        // airspace the packet just left.
        ease: 'snapEase',
        reorder: k === stripOrder.length - 1 ? () => newOrder : undefined,
        to: layout(rest, DECK_Y, landed),
        hands: {
          // Hold station while the packet leaves, then extend back over the
          // deck's new top down the same ladder in reverse, the return half of
          // the stroke, and half of why this lesson's hands articulate at all.
          right: [
            { at: 0.18, pose: drag, anchor: rungAt(RUNGS) },
            ...back.map((pose, i) => ({
              at: 0.18 + (0.82 * (i + 1)) / back.length,
              pose,
              anchor: rungWrist(nextWrist, (back.length - 1 - i) / RUNGS),
              ease: 'easeInOutCubic',
              fingerMotion:
                i === back.length - 1
                  ? [{ fingers: ['ring', 'pinky'], type: 'curlRipple', amp: 0.05, cycles: 1 }]
                  : undefined,
            })),
          ],
          // The cradle comes back down on the CARDS' OWN curve. It is holding
          // them: give the hand a gentler ease than the deck it is under and the
          // deck arrives first, sinking into fingers that are still on their way
          // down (measured 0.15 deep, every drop beat in the lesson).
          left: [
            { at: 0.3, pose: holdPose, anchor: liftedCradle },
            {
              at: 1,
              pose: holdPose,
              anchor: HOLD_WRIST,
              ease: 'snapEase',
              fingerMotion: [{ fingers: ['thumb'], type: 'tighten', amp: 0.05 }],
            },
          ],
        },
      })

      held = rest
      piled = landed
    })

    // --- Square up ------------------------------------------------------------
    // The pile is already on the felt, under the hand that dropped it, nothing
    // to carry down. Both hands come in and square it, which is what a shuffler
    // does at the end of a pass.
    const PILE_TOP = PILE_Y + DECK_H
    steps.push({
      kind: 'move',
      id: 'square',
      label: 'Square the pile',
      duration: 1300,
      ease: 'easeInOutCubic',
      camera: 'overview',
      to: (dk) => stackLayout(dk).map((e) => ({ ...e, pos: e.pos.clone().setX(PILE_X).setZ(PILE_Z) })),
      hands: {
        // The receiving hand lifts clear of the column the last packet is still
        // falling through, then comes down on the pile's near long edge.
        right: [
          { at: 0.35, pose: 'deckApproach', anchor: openAt(PILE_X + CARD_W * 1.5, PILE_TOP, PILE_Z, CARD_H * 0.4) },
          { at: 1, pose: 'deckRest', anchor: restAt(PILE_X + CARD_W * 0.4, PILE_TOP, PILE_Z), ease: 'easeOutCubic' },
        ],
        // The empty cradle turns back over out at the side and comes in low.
        left: [
          { at: 0.4, pose: holdPose, anchor: cradleAt(-SIDE_X, 0, 0) },
          { at: 0.75, pose: 'deckApproach', anchor: leftOpen(PILE_X - CARD_W * 1.5, PILE_TOP, PILE_Z, CARD_H * 0.4), ease: 'easeInOutCubic' },
          { at: 1, pose: 'deckRest', anchor: leftRest(PILE_X - CARD_W * 0.4, PILE_TOP, PILE_Z), ease: 'easeOutCubic' },
        ],
      },
      annotations: [{ text: 'Blocks moved as blocks — neighbours stayed together', appearAt: 0.3 }],
    })

    steps.push({
      kind: 'move',
      id: 'centre',
      label: 'Bring it back to the middle',
      duration: 1000,
      ease: 'easeInOutCubic',
      to: (dk) => stackLayout(dk),
      hands: {
        right: [{ at: 1, pose: 'deckRest', anchor: restAt(CARD_W * 0.4, TABLE_TOP, 0) }],
        left: [{ at: 1, pose: 'deckRest', anchor: leftRest(-CARD_W * 0.4, TABLE_TOP, 0) }],
      },
    })

    steps.push({
      kind: 'hold',
      id: 'rest',
      label: 'Shuffled — one pass through',
      duration: 900,
      // The closing beat RESTS on the deck rather than floating beside it.
      hands: {
        left: [
          {
            at: 0.7,
            pose: 'deckRest',
            anchor: leftRest(-CARD_W * 0.4, TABLE_TOP, 0),
            ease: 'easeOutCubic',
            fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tighten', amp: 0.04 }],
          },
        ],
        right: [
          {
            at: 0.7,
            pose: 'deckRest',
            anchor: restAt(CARD_W * 0.4, TABLE_TOP, 0),
            ease: 'easeOutCubic',
            fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tighten', amp: 0.04 }],
          },
        ],
      },
      annotations: [
        { text: 'Repeat it a dozen times and it still barely mixes — that is the overhand', appearAt: 0.1 },
      ],
    })

    return steps
  },
}
