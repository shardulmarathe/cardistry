import * as THREE from 'three'
import { stackLayout, faceQuat } from '../engine/layouts'
import { poseWithContacts, surfaceContact, wristAnchorForContact } from '../authoring/contacts'
import { splitIntoRandomBlocks } from '../../lib/shuffleMath'
import { CARD_GAP, CARD_H, CARD_T, CARD_W } from '../../lib/constants'
import { getHandPose } from '../../hands/handPoses'
import { fingerJointsWorld, fingertipWorld } from '../../hands/handKinematics'
import { FINGERS, FINGER_NAMES, HAND_SCALE } from '../../hands/handRigSpec'

// Hindu shuffle — TWO HANDS THAT OPEN AND CLOSE, and this file is built
// backwards from that.
//
// WHAT THE OLD VERSION DID. The right hand ferried the whole deck back and
// forth across the table (22 world-units of wrist travel) while a packet "slipped
// out of the grip" — a phrase that described nothing, because no digit did
// anything: the only finger motion in the lesson was a 0.07 thumb `tighten`
// per pass. Measured, 0.88 radians of articulation per unit of wrist travel.
// Worse, the cradle was not holding the pile at all: solved onto the pile's
// underside and then relaxed by resolvePenetration until it cleared, its
// fingertips ended up 0.33 BELOW the cards they were supposed to be carrying.
//
// WHAT DRIVES IT NOW. Two curl scalars, one per hand, and everything else is
// measured from them:
//
//   hand    curl    what it means
//   left    -0.18   palm dropped open, out of the way of the arriving block
//   left    +0.14   fingers closed up under the pile — where the pile rests
//   right   +0.62   four pads pressed flat on the deck's top card
//   right   +0.02   pads straightened off it: the beat where a block is let go
//
// A packet is no longer "released" by an invisible change of bookkeeping: the
// right hand's pads visibly come off the top card and the deck slides out from
// under the block, which stays behind and falls the measured FALL into the cup
// the left hand is closing around it. And the deck is drawn only the width of
// half a card, the way a real Hindu draws it, instead of being flown home
// between passes.
//
// EVERY HEIGHT IS A MEASUREMENT, NOT A NUMBER.
//   * `CUP` — the cradle's own SEAT: four per-finger curls chosen so the four
//     PADS present at one height, and the lowest such height at which nothing
//     else on the hand (at any point of the open-to-closed cycle) reaches above
//     them. The pile's bottom card sits one pad's clearance above that plane, so
//     the four fingertips are genuinely under the cards they carry — measured,
//     0% of gripping fingertips in contact before this, 62% after, median gap
//     0.164 -> 0.021.
//   * `dropAt` — the mirror image for the palm-down hand: the deepest finger
//     SURFACE below its wrist at a given curl, sampled along every capsule
//     (rigMetrics samples joints only and under-reads a slanted phalange by
//     ~0.02, which is most of this lesson's air).
//   * `cupFloor` — the same for the cradle, because a palm-up hand is the
//     other way up and it is the heel that has to clear the felt. That single
//     measurement is what sets how high the whole shuffle happens.
//
// MIRRORING. Anchors and contact TARGETS are authored in right-hand coords and
// the engine x-mirrors them for the left hand, so a left-hand contact is solved
// on the card's true world surface and then the POINT is mirrored — never the
// card. `cards` passed to resolvePenetration are the opposite: literal world
// poses for that side, unmirrored.

// A world-Y yaw applied AFTER the palm rotation (Euler order 'YXZ'), exactly as
// handPoses builds deckRest/deckApproach: it swings the whole hand about the
// vertical so the fingers point along the table instead of at the camera. A
// palm-DOWN hand's fingers start at +z and a palm-UP hand's at −z, so the two
// need OPPOSITE yaws to end up pointing the same way. Authored ONCE for the
// right hand; the engine's x-mirror gives the left hand its own.
const PALM_DOWN = Math.PI / 2
const yawed = (pitch, yaw) => new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'))
const HOLD_QUAT = yawed(PALM_DOWN + 0.12, -Math.PI / 2)
const CRADLE_QUAT = yawed(-PALM_DOWN + 0.12, Math.PI / 2)

const FOUR = ['index', 'middle', 'ring', 'pinky']
const chain = (c) => [c, c * 0.85, c * 0.6]
const thumbChain = (c) => [c * 0.7, c * 0.6, c * 0.4]
const chainLen = (name) => FINGERS[name].len.reduce((a, b) => a + b, 0) * HAND_SCALE
// Room for the idle-breathing overlay: it adds IDLE_CURL of curl down the
// chain, swinging a pad through roughly (half the chain) x that angle — a
// hand-sized distance, so it is measured off the chain rather than typed.
const IDLE_CURL = 0.021
const JOINT_SUM = 1 + 0.7 + 0.45
const swingOf = (curl) => chainLen('middle') * 0.5 * curl * JOINT_SUM
const PAD_AIR = swingOf(IDLE_CURL)
// A `fingerMotion` overlay is a second, larger swing on top of that, so any
// pose carrying one is authored this much further off its surface.
const MOTION_AMP = 0.035
const MOTION_AIR = swingOf(MOTION_AMP)
// THE ONLY AIR A RESTING PAD IS ALLOWED, and it is the same number
// contacts.js uses. The idle overlay's own pad travel is ~0.017, so this
// covers the one thing that can press a pad through a card it is not holding —
// and it is inside the 0.025 band the suite calls "touching", which
// PAD_AIR + 2*MOTION_AIR (0.100, four times a card's thickness) was not. That
// stack of margins WAS this lesson's hover: the pile floated a tenth of a unit
// over fingers that were supposedly carrying it.
const CONTACT_AIR = 0.0015 * HAND_SCALE
// How much of the global idle-breathing overlay this lesson's CRADLE runs at.
// See the note beside the loop that applies it, at the end of build().
const CUP_IDLE = 0.6

// One curl scalar drives all three joints of every finger in the rig's own
// proportion; `base` only supplies the splay and the wrist frame. `curls`
// overrides individual fingers — which is what levelling the cup needs, since
// four fingers of four lengths do NOT present their pads at one height under
// one shared curl.
const shaped = (preset, quat, c, curls = null) => {
  const p = getHandPose(preset, 'right')
  p.wrist.quat.copy(quat)
  p.fingers.thumb = thumbChain(c)
  for (const n of FOUR) p.fingers[n] = chain(curls?.[n] ?? c)
  return p
}

// --- Measuring the hand's own extent -----------------------------------------
// `lo`/`hi` are the lowest and highest finger SURFACES relative to the wrist,
// sampled along every capsule. `cx`/`cz`, when given, restrict the answer to a
// card footprint centred there — which is the whole trick behind a cup that can
// open and close without moving the pile it is holding.
const _j = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
const _p = new THREE.Vector3()
function extent(pose, side, cx = null, cz = null) {
  let lo = Infinity
  let hi = -Infinity
  for (const name of FINGER_NAMES) {
    fingerJointsWorld(pose, side, name, _j)
    for (let i = 0; i < 3; i++) {
      const r = FINGERS[name].rad[i] * HAND_SCALE
      for (let k = 0; k <= 8; k++) {
        _p.copy(_j[i]).lerp(_j[i + 1], k / 8)
        if (cx !== null && (Math.abs(_p.x - cx) > CARD_W / 2 + r || Math.abs(_p.z - cz) > CARD_H / 2 + r)) continue
        lo = Math.min(lo, _p.y - r)
        hi = Math.max(hi, _p.y + r)
      }
    }
  }
  return { lo, hi }
}
const atOrigin = (pose) => {
  const p = { ...pose, wrist: { pos: new THREE.Vector3(), quat: pose.wrist.quat.clone() } }
  return p
}
// Palm-down hand: how far its deepest surface hangs below the wrist.
const _drop = new Map()
const dropAt = (c) => {
  if (!_drop.has(c)) _drop.set(c, -extent(atOrigin(shaped('deckRest', HOLD_QUAT, c)), 'right').lo)
  return _drop.get(c)
}
// Palm-up cradle: how far its heel hangs below the wrist (what has to clear the
// felt), and how high it reaches inside the pile's footprint (what carries the
// cards). Both taken with the wrist at the origin, so the footprint is stated
// relative to the wrist and the caller adds its own x/z.
const cupFloor = (c, curls = null) =>
  -extent(atOrigin(shaped('palmCradle', CRADLE_QUAT, c, curls)), 'left').lo

// THE CUP IS SHALLOW, AND IT HAS TO BE. A palm-up hand's fingers curl UP, so a
// deep cup sweeps its own fingertips straight through the pile they are
// carrying — and putting the pile above the DEEPEST such sweep floats it at
// y = 1.4, a whole card-width over where a cradle can sensibly hold anything.
// So the closing half of the cycle is the pile's seat, and the OPENING half
// hyperextends the fingers slightly DOWNWARD (JOINT_LIMITS allows −0.25, and
// real fingers do bend back a touch), which drops the palm away from the block
// coming down into it without ever rising into it.
const C_FLAT = -0.05 // palm dropped open to receive
const C_CUP = 0.14 // seed curl for the closed cup — LEVELLED per finger below
const C_PRESS = 0.62 // right-hand pads pressed on the deck's top card
const C_LET = 0.02 // ...straightened, and lifted off it: a block is let go
// The cradle is now driven by a BLEND parameter rather than a raw curl, because
// its closed shape is four different curls (one per finger, so the four pads
// present at one height). 0 is the dropped palm, 1 the levelled cup.
const CUP_OPEN = 0
const CUP_CLOSED = 1

export const hinduLesson = {
  id: 'hindu',
  title: 'Hindu Shuffle',
  technique: 'hindu',
  difficulty: 'beginner',
  randomizes: 'Weak',
  seed: 99,
  // A cradle that genuinely CARRIES its pile cannot hold it lower than the felt
  // plus its own heel plus its own cup — measured, y ≈ 1.17 at this rig size —
  // and the deck rides a fall above that again. `handsHigh` is aimed at 0.95 but
  // sits only 4.1 out with a 35 degree fov, so its half-height of 1.30 puts the
  // DECK through the top of the frame. `overview` is 6.4 out for a half-height
  // of 2.02: the same reading angle, enough headroom for both hands.
  cameraPreset: 'handsCradle',
  summary:
    'Hold the deck by its ends over your other palm and let the fingers release a block on every pass — it falls into the waiting cup. Elegant, but it only moves blocks.',
  facts: [
    'The Hindu shuffle strips packets off the top and lets them cascade — the same block-transport family as the overhand, so it mixes weakly.',
    'Magicians exploit that weakness to keep a stack of cards intact while appearing to shuffle.',
  ],
  build: (deck, ctx) => {
    const rng = ctx.rng
    const N = deck.length
    const TABLE_TOP = 0.02 + (N - 1) * CARD_GAP
    const cardAt = (x, y, z) => ({ pos: [x, y, z], quat: faceQuat(false) })
    const stackOf = (x, base, n, z) => Array.from({ length: n }, (_, i) => cardAt(x, base + i * CARD_GAP, z))

    // --- Where the shuffle happens -------------------------------------------
    // As low as the felt lets a palm-up hand go — its own deepest surface
    // tangent on the table plus the air the idle overlay eats — and then the
    // pile rides one measured cup above that. Everything else in the lesson
    // stacks on top of this one number.
    // The shuffle happens LEFT of centre and a little toward the dealer — far
    // enough that the two hands have their own room, close enough that a cradle
    // holding its pile a full cup above the felt still sits inside the frame
    // `handsHigh` gives it.
    const LPX = -(CARD_W * 0.9)
    const LPZ = 0.62

    // How far across the pile's width the OPEN palm's middle pad reaches under
    // it. The four fingers spread along the pile's LONG axis at this yaw, so `u`
    // is the only axis the aim has to choose.
    const PAD_U = 0.3
    // ONE wrist station for the cradle, taken from the OPEN palm — and it never
    // moves again. That is not a saving, it is the whole mechanism: the pile
    // rests where the FLAT hand puts it, and closing the cup then has to be pure
    // finger motion, which is what makes the catch read as fingers rather than
    // as an arm. (Re-anchoring per curl instead — putting the middle PAD under
    // the pile at every closedness — keeps a deeply curled fingertip inside the
    // pile's footprint at all times, and the pile then has to ride the tip of a
    // closed fist: measured, it floated at y = 1.5, half a metre over the felt
    // and clean out of the top of the frame.)
    const CRADLE_XZ0 = (() => {
      const seed = shaped('palmCradle', CRADLE_QUAT, C_FLAT)
      // '+z' is the card's DOWN face for a face-down card — the surface a cup
      // carries. Left-hand targets are authored x-mirrored.
      const t = surfaceContact(cardAt(LPX, 0, LPZ), { finger: 'middle', face: '+z', u: PAD_U, v: 0 })
      t.x = -t.x
      return wristAnchorForContact(seed, 'right', 'middle', t.toArray())
    })()
    // --- LEVELLING THE CUP, and why the pile used to hover ------------------
    // The pile's seat used to be `extent().hi` — the highest FINGER SURFACE
    // inside its footprint — plus PAD_AIR plus twice MOTION_AIR. Both halves of
    // that were wrong in the same direction:
    //
    //   * `hi` at one shared curl is set by whichever finger happens to reach
    //     highest, and the other three then sit BELOW it — measured, the index
    //     0.068 and the pinky 0.195 below the middle. A pile seated on the
    //     highest is a pile only one finger is touching.
    //   * 0.100 of stacked margin on top of that (PAD_AIR + 2·MOTION_AIR = four
    //     card thicknesses) put even that one finger out of reach of the cards
    //     it was carrying. The suite measured 0% of gripping fingertips in
    //     contact, median gap 0.164 — a quarter of a card width of daylight
    //     under a hand that is supposed to be holding the deck up.
    //
    // So level the four TIPS instead: pick each finger's own curl so its pad's
    // top surface reaches one common plane, and seat the pile on that plane
    // with only the idle overlay's own travel to spare. The plane is found by
    // iteration because levelling can itself lift a knuckle above the tips —
    // three rounds converge, and the answer is the honest one: the height at
    // which four pads and nothing else are touching the bottom card.
    const cupPose = (station, c, curls) =>
      poseWithContacts(shaped('palmCradle', CRADLE_QUAT, c, curls), 'left', {
        anchor: [station[0], 0, station[2]],
        quat: CRADLE_QUAT,
      })
    // Top of a finger's PAD (tip centre + its distal radius) above the wrist.
    // Only that finger's own curl moves it, so the rest of the hand is irrelevant.
    const _tt = new THREE.Vector3()
    const tipTop = (name, c) =>
      fingertipWorld(cupPose(CRADLE_XZ0, C_CUP, { [name]: c }), 'left', name, _tt).y +
      FINGERS[name].rad[2] * HAND_SCALE
    // The curl at which THIS finger presents its pad at `top`. A pad rises with
    // curl up to the curl that stands the finger vertical and falls after, so a
    // fixed ladder plus "keep the closest" is exact and deterministic — and a
    // finger too short to reach the plane simply stops at its own highest.
    const curlForTop = (name, top) => {
      const scan = (lo, hi, steps) => {
        let best = lo
        let bestD = Infinity
        for (let i = 0; i <= steps; i++) {
          const c = lo + (hi - lo) * (i / steps)
          const d = Math.abs(tipTop(name, c) - top)
          if (d < bestD) {
            bestD = d
            best = c
          }
        }
        return best
      }
      // Coarse ladder, then one refinement pass inside the winning cell: a step
      // of the coarse ladder is ~0.011 of pad height, which is most of a contact
      // band all by itself.
      const step = (1.4 - C_FLAT) / 96
      const c0 = scan(C_FLAT, 1.4, 96)
      return scan(Math.max(C_FLAT, c0 - step), Math.min(1.4, c0 + step), 24)
    }
    // CENTRE THE FOUR PADS ON THE PILE, then ask how much of each still hangs
    // off it. The station above puts the MIDDLE pad under the pile's centre,
    // which leaves the pinky — three knuckles away along a hand that spans 0.74
    // against a card 0.88 long — off the near end; and the deeper a finger has
    // to curl to reach the seat, the further its tip retracts across the card,
    // so the four tips are not a tidy row either. Slide the whole station until
    // their bounding box is centred on the footprint (a pure translation, which
    // cannot change the levelling) and measure what is left over. A pad off the
    // card is not touching it however well its height is levelled.
    const centred = (pose) => {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
      for (const n of FOUR) {
        const t = fingertipWorld(pose, 'left', n, _tt)
        x0 = Math.min(x0, t.x); x1 = Math.max(x1, t.x)
        z0 = Math.min(z0, t.z); z1 = Math.max(z1, t.z)
      }
      const dx = LPX - (x0 + x1) / 2
      const dz = LPZ - (z0 + z1) / 2
      const over = {}
      for (const n of FOUR) {
        const t = fingertipWorld(pose, 'left', n, _tt)
        over[n] = Math.hypot(
          Math.max(0, Math.abs(t.x + dx - LPX) - CARD_W / 2),
          Math.max(0, Math.abs(t.z + dz - LPZ) - CARD_H / 2),
        )
      }
      // World +dx is an authored −dx for the mirrored left hand; z is not
      // mirrored.
      return { station: [CRADLE_XZ0[0] - dx, CRADLE_XZ0[1], CRADLE_XZ0[2] + dz], over }
    }
    // HOW HIGH THE PLANE GOES IS A COMPROMISE, and both ends of it are real.
    // Low: the four pads lie almost flat across the pile, the pinky (0.72 long
    // against the middle's 1.02) can still reach, but every pad's idle swing is
    // vertical and the seat has to pay for it. High: the pads curl up, the idle
    // stops mattering — and the pinky can only reach by standing straight up,
    // which retracts its tip 0.9 back toward the wrist and clean off the pile
    // (measured, gap 0.909).
    //
    // So do not pick an end. Scan the plane and score each candidate by the gap
    // the SUITE will measure — the pad's own idle air plus whatever of the tip
    // hangs off the card — and keep the best. Deterministic, and it re-solves
    // itself if the rig or the card changes.
    // Sampled over the WHOLE open-to-closed blend, not just its ends: the hand
    // is at every one of those curls at some point, and depth is not linear in
    // curl (measured, the mid-blend sags below both endpoints).
    const CUP_BLEND = Array.from({ length: 13 }, (_, i) => i / 12)
    const blendOf = (curls, f) =>
      Object.fromEntries(FOUR.map((n) => [n, C_FLAT + (curls[n] - C_FLAT) * f]))
    // HOW HIGH THE PLANE GOES IS THE PINKY'S DECISION, not the middle's, and
    // that is the second half of why this cradle used to hover. The middle
    // finger is 1.02 long and the pinky 0.72, and the pinky's knuckle already
    // sits most of the way up to the middle's pad. So a plane set by the
    // middle's own comfortable curl is one the pinky can only reach by standing
    // straight up — which retracts its tip 0.9 back toward the wrist, clean off
    // the far side of the pile (measured: pinky curl 1.27, tip 0.97 outside the
    // footprint, gap 0.909, versus 0.002 once the plane comes down to meet it).
    //
    // So scan the plane UPWARD from flat and take the LOWEST one that is still a
    // PAD plane: the first at which nothing else on the hand — at any point of
    // the open-to-closed cycle — reaches above the four levelled tips. That is
    // the shallowest cup this rig can seat a deck on, it is the one all four
    // fingers can reach without curling out from under the cards, and it keeps
    // the whole shuffle low enough to stay in frame.
    const CUP = (() => {
      let out = null
      for (let i = 0; i <= 32; i++) {
        const plane = tipTop('middle', C_FLAT + (C_CUP - C_FLAT) * (i / 32))
        const curls = Object.fromEntries(FOUR.map((n) => [n, curlForTop(n, plane)]))
        const rise = Math.max(
          ...CUP_BLEND.map(
            (f) =>
              extent(cupPose(CRADLE_XZ0, C_FLAT + (C_CUP - C_FLAT) * f, blendOf(curls, f)), 'left', LPX, LPZ).hi,
          ),
        )
        const { station } = centred(cupPose(CRADLE_XZ0, C_CUP, curls))
        out = { curls, rise: Math.max(plane, rise), station }
        if (rise <= plane + 1e-3) break
      }
      return out
    })()
    const CRADLE_XZ = CUP.station
    const blendCurls = (f) => blendOf(CUP.curls, f)
    const CRADLE_Y =
      0.012 + Math.max(...CUP_BLEND.map((f) => cupFloor(C_FLAT + (C_CUP - C_FLAT) * f, blendCurls(f)))) + PAD_AIR
    // Moving the cup to another column is a MINUS in x, not a plus: anchors are
    // authored in right-hand coords and the engine negates x for the left hand,
    // so a world step of +dx is an authored step of −dx. (Getting this backwards
    // sent the pile the wrong way down the table on the carry-back, with the
    // whole finished stack still welded to the hand.)
    const cradleWrist = (px, pz) => [CRADLE_XZ[0] - (px - LPX), CRADLE_Y, CRADLE_XZ[2] + (pz - LPZ)]
    // Nothing in the open half of the cycle may reach ABOVE the closed cup's
    // pads, or the pile would have to ride the opening hand instead of resting
    // on the closed one; assert it by taking the max over the blend.
    const CUP_RISE = CUP.rise
    const PILE_Y = CRADLE_Y + CUP_RISE + CARD_T / 2 + CONTACT_AIR
    const pileTop = (n) => PILE_Y + Math.max(0, n - 1) * CARD_GAP

    // `c` is the OPEN-to-CLOSED blend parameter now, not a raw curl: 0 is the
    // dropped palm, 1 the levelled cup the pile rests on.
    const cradle = (c, n, px = LPX, pz = LPZ) =>
      poseWithContacts(shaped('palmCradle', CRADLE_QUAT, C_FLAT + (C_CUP - C_FLAT) * c, blendCurls(c)), 'left', {
        anchor: cradleWrist(px, pz),
        quat: CRADLE_QUAT,
        cards: n ? stackOf(px, PILE_Y, n, pz) : null,
        clearance: 0,
      })

    // --- The right hand's hold on the deck -----------------------------------
    // Four pads laid across the top card, thumb riding clear. Even at this scale
    // the hand cannot pinch a 0.63-wide deck thumb-to-fingertip (measured, every
    // preset abducts the thumb and its tip sits ~1.0 ABOVE the top card wherever
    // the wrist goes), so the honest grip stays the one from above — and the
    // release is therefore the PADS COMING OFF, which is exactly the beat this
    // lesson needed.
    const DECK_U = 0
    const holdOn = (card, c, { lift = 0, cards = null } = {}) => {
      const seed = shaped('deckRest', HOLD_QUAT, c)
      const t = surfaceContact(card, { finger: 'middle', u: DECK_U, v: 0 })
      const w = wristAnchorForContact(seed, 'right', 'middle', t.toArray())
      return poseWithContacts(seed, 'right', {
        anchor: [w[0], card.pos[1] + CARD_T / 2 + dropAt(c) + PAD_AIR + lift, w[2]],
        quat: HOLD_QUAT,
        cards,
        clearance: 0,
      })
    }

    // Straighten a solved hold in place — curls only, wrist untouched. Scaling
    // every curl toward straight always lifts a pad OFF whatever it is pressing
    // (JOINT_LIMITS brackets 0), so this can never be the thing that buries one.
    const openedFrom = (pose, c) => {
      const p = { ...pose, wrist: { pos: pose.wrist.pos.clone(), quat: pose.wrist.quat.clone() }, fingers: {} }
      p.fingers.thumb = thumbChain(c)
      for (const n of FOUR) p.fingers[n] = chain(c)
      return p
    }
    const shifted = (pose, dx) => ({
      ...pose,
      wrist: { pos: pose.wrist.pos.clone().setX(pose.wrist.pos.x + dx), quat: pose.wrist.quat.clone() },
    })

    // --- The deck's two stations ---------------------------------------------
    // A real Hindu draws the deck back the width of half a card on each pass,
    // not across the table. `OVER` is directly above the cup; `AWAY` is where
    // the hand has drawn it to once the block has been left behind.
    const DRAW_X = CARD_W * 0.62
    // How far a released block falls into the cup — card-sized: it is a gap
    // between two stacks of cards, not a reach across a hand.
    const FALL = CARD_H * 0.08
    // The deck's BOTTOM rides one fall above whatever the pile has grown to, so
    // its TOP sinks as it thins — and the pads that hold that top card have to
    // follow it down by curling, which is the other half of the finger work.
    const deckBase = (piled) => pileTop(piled) + FALL
    const deckStack = (cards, piled, x) =>
      cards.map((c, i) => ({
        id: c.id,
        pos: new THREE.Vector3(x, deckBase(piled) + i * CARD_GAP, LPZ),
        quat: faceQuat(false),
        bend: 0,
      }))

    const blocks = splitIntoRandomBlocks(deck, 4, rng)
    const stripOrder = [...blocks].reverse() // the top block leaves first
    const newOrder = stripOrder.flat() // first stripped = bottom of the new pile
    const pilePoses = (block, piled) =>
      block.map((c, j) => ({
        id: c.id,
        pos: new THREE.Vector3(LPX, PILE_Y + (piled + j) * CARD_GAP, LPZ),
        quat: faceQuat(false),
        bend: 0,
      }))

    // --- Stations for the approach and the set-down --------------------------
    const WIDE = CARD_W * 1.5
    const openHold = (x, top, z, lift = 0) => holdOn(cardAt(x, top, z), C_LET, { lift })
    const RH_GRAB = holdOn(cardAt(0, TABLE_TOP, 0), C_PRESS, { cards: stackOf(0, 0.02, N, 0) })
    const steps = [
      {
        kind: 'hold',
        id: 'ready',
        label: 'Reach in — take the deck from above',
        duration: 1100,
        hands: {
          // The at:0 keyframes are load-bearing on BOTH sides. Without one the
          // compiler builds a lead-in FROM the pose carried forward, which at
          // the first step of a lesson is `relaxed` at its own default wrist —
          // a hand parked with its thumb base straight through the deck. And
          // the right hand NEVER changes wrist orientation during this reach:
          // arriving in one yaw and slerping into another takes the palm through
          // a side-on tip that points the fingers straight DOWN, which swept the
          // middle finger 0.158 through the deck between two clear endpoints.
          right: [
            { at: 0, pose: openHold(CARD_W * 2, TABLE_TOP + CARD_H * 0.75, 0) },
            { at: 0.5, pose: openHold(0, TABLE_TOP, 0, CARD_H * 0.3) },
            { at: 1, pose: RH_GRAB, ease: 'easeOutCubic', fingerMotion: [{ fingers: FOUR, type: 'tighten', amp: MOTION_AMP }] },
          ],
          left: [
            // OUTBOARD, not inboard: the deck's whole flight from table centre
            // to the palm passes through the cup's column, so the cup waits
            // clear of it and slides in underneath afterwards.
            { at: 0, pose: cradle(CUP_OPEN, 0, LPX - CARD_W * 1.2, LPZ) },
            { at: 1, pose: cradle(CUP_OPEN, 0, LPX - CARD_W * 1.2, LPZ), ease: 'easeOutCubic' },
          ],
        },
        annotations: [{ text: 'Right hand takes the deck; the left palm opens to receive', appearAt: 0.15 }],
      },
      {
        kind: 'move',
        id: 'lift',
        label: 'Bring the deck over the waiting palm',
        duration: 1200,
        ease: 'easeInOutCubic',
        // No grip: the deck rises on its own track exactly alongside the hand,
        // which lands the stack in a KNOWN place under the pads. (A weld here
        // would land it wherever the captured offset put it, and every later
        // re-seat would have to chase that.)
        to: (dk) => deckStack(dk, 0, LPX),
        hands: {
          right: [{ at: 1, pose: holdOn(cardAt(LPX, deckBase(0) + (N - 1) * CARD_GAP, LPZ), C_PRESS), ease: 'easeOutCubic' }],
          // Still clear: the deck is climbing THROUGH this column on its way
          // over, and a cup parked in it is a cup the deck flies through
          // (measured 0.107 of middle finger inside the rising stack).
          left: [{ at: 1, pose: cradle(CUP_OPEN, 0, LPX - CARD_W * 1.2, LPZ) }],
        },
      },
    ]

    let inHand = deck.slice()
    let piled = 0
    let piledIds = []
    stripOrder.forEach((block, k) => {
      const n = block.length
      const held = inHand.length
      const ids = new Set(block.map((c) => c.id))
      const rest = inHand.filter((c) => !ids.has(c.id))
      const deckTop = (x, count, base) => cardAt(x, deckBase(base) + (count - 1) * CARD_GAP, LPZ)
      // The deck's TOP barely moves all lesson: its bottom rides one fall above
      // a pile that grows by exactly the block that just left it, so the two
      // changes cancel. That is deliberate — it means the right hand holds ONE
      // station for the whole shuffle and every world-unit it does travel is a
      // draw, not a commute.
      const over = deckTop(LPX, held, piled)
      const away = deckTop(LPX + DRAW_X, rest.length, piled + n)
      const deckCards = stackOf(LPX, deckBase(piled), held, LPZ)
      const pressed = holdOn(over, C_PRESS, { lift: MOTION_AIR, cards: deckCards })
      // THE RELEASE, and it is the whole point — and it is done WITHOUT MOVING
      // THE WRIST. Straightening the fingers from C_PRESS to C_LET lifts the
      // pads by (dropAt(C_PRESS) - dropAt(C_LET)) = a third of a card all on its
      // own, so re-anchoring the hand for the new curl would only sink the arm
      // to cancel the very motion that is the point of the beat. Same wrist,
      // straighter fingers: the pads come off the card and nothing else moves.
      const letGo = openedFrom(pressed, C_LET)
      const drawnAway = shifted(letGo, DRAW_X)
      // Computed EAGERLY. `piled` and `inHand` are mutating loop variables, so
      // a `() => ...` thunk would resolve after build() returns and see the
      // FINAL values for every pass — every block would land on top of the
      // finished pile (the stale-closure trap — see ARCHITECTURE.md).
      const settleTo = deckStack(inHand, piled, LPX)
      const stripTo = [...pilePoses(block, piled), ...deckStack(rest, piled + n, LPX + DRAW_X)]
      const regrip = holdOn(away, C_PRESS, {
        lift: MOTION_AIR,
        cards: stackOf(LPX + DRAW_X, deckBase(piled + n), rest.length, LPZ),
      })

      steps.push({
        kind: 'move',
        id: `settle-${k}`,
        label: 'Bring the deck back over the palm and press on its top card',
        duration: 620,
        ease: 'easeInOutCubic',
        // The deck slides back over the cup; the pads come down on its top card.
        to: settleTo,
        hands: {
          right: [
            { at: 1, pose: pressed, ease: 'easeOutCubic', fingerMotion: [{ fingers: FOUR, type: 'tighten', amp: MOTION_AMP }] },
          ],
          // The cup opens flat to receive — the block has to have somewhere to
          // land, and an open palm is also what a Hindu's left hand looks like
          // at this instant.
          left: [{ at: 1, pose: cradle(CUP_OPEN, piled) }],
        },
        annotations:
          k === 0
            ? [{ text: 'The pads press the top card — that is all that holds the block', appearAt: 0.3 }]
            : undefined,
      })

      steps.push({
        kind: 'move',
        id: `strip-${k}`,
        label: 'The pads lift — the deck slides out from over the block',
        duration: 900,
        ease: 'easeInOutCubic',
        // The block stays where it was and falls the last FALL into the cup
        // while the rest of the deck travels out with the hand. Both are honest
        // tracks: the separation IS the right hand's pads opening, and the catch
        // IS the left hand's fingers closing.
        to: stripTo,
        hands: {
          right: [
            // The pads come off FIRST (0.22), and only then does the deck move —
            // a hand that translates while still pressed drags the block along
            // with it instead of leaving it behind.
            { at: 0.22, pose: letGo },
            { at: 1, pose: drawnAway, ease: 'easeInOutCubic' },
          ],
          // THE RIPPLE BELONGS ON THE CLOSING BEAT, not on the closed one. A
          // fingerMotion overlay peaks in the MIDDLE of its own segment
          // (sin²(πt)) and dies at both ends, so here it fires while the cup is
          // still half open and a whole cup below the pile — free room. On the
          // `square` beat below the cup is already closed and its four pads are
          // tangent under the block for the entire segment, so the same 0.035
          // of ripple is 0.038 of finger driven straight up into cards that are
          // resting on it (measured 0.0575, thirty times the budget). That is
          // what the old PILE_Y bought with 2·MOTION_AIR of permanent hover.
          //
          // And it closes on the STEP's own ease, not easeOutCubic. That is not
          // a taste call: easeOutCubic is 83% closed by the time the ripple
          // peaks, so the overlay fires with 0.015 of room and needs 0.038 — it
          // put the middle finger 0.033 up inside the pile. On the step's
          // easeInOutCubic the cup is 40% closed at the peak, which is both
          // enough room and what catching a falling block looks like.
          left: [
            {
              at: 1,
              pose: cradle(CUP_CLOSED, piled + n),
              fingerMotion: [{ fingers: FOUR, type: 'curlRipple', amp: MOTION_AMP, cycles: 1 }],
            },
          ],
        },
        annotations:
          k === 0 ? [{ text: 'It falls into the closing cup — nothing is carried there', appearAt: 0.45 }] : undefined,
      })

      steps.push({
        kind: 'move',
        id: `square-${k}`,
        label: 'The cup squares the block; the pads find the new top card',
        duration: 560,
        ease: 'easeInOutCubic',
        to: () => [],
        // THE CUP IS HOLDING THIS PILE, so say so. Two things follow, and the
        // second is the one that mattered: the pile visibly rides the fingers
        // that are under it, and the idle-breathing overlay can no longer press
        // those pads THROUGH it — a welded packet rides the hand's contact frame,
        // so when the overlay lifts the pads the cards lift with them. Without
        // the weld the seat has to reserve the overlay's whole pad travel
        // (measured 0.031 for a cradle finger lying almost flat across the pile,
        // where the swing is straight up), and that reservation is bigger than
        // the band the suite calls contact — i.e. the hand can be safe or it can
        // be touching, but not both.
        grip: { left: { cards: piledIds.concat(block.map((c) => c.id)), frame: 'packet' } },
        hands: {
          right: [{ at: 1, pose: regrip, fingerMotion: [{ fingers: FOUR, type: 'tighten', amp: MOTION_AMP }] }],
          // NO fingerMotion on the cup here, and that is the weld's price. The
          // pile rides the `packet` contact frame, which is HALF THUMB — so a
          // ripple on the thumb walks the whole welded pile 0.025 sideways into
          // four pads that are standing still, and a ripple on the four fingers
          // moves the frame half as far as the pads and buries them by the
          // difference. The cup's own articulation lives on the CLOSING beat
          // above, where it is free; here the hand is holding something.
          left: [{ at: 1, pose: cradle(CUP_CLOSED, piled + n) }],
        },
      })

      inHand = rest
      piled += n
      piledIds = piledIds.concat(block.map((c) => c.id))
    })

    steps.push({
      kind: 'move',
      id: 'carry',
      label: 'The left hand carries the pile back to centre',
      duration: 1400,
      ease: 'easeInOutCubic',
      reorder: () => newOrder,
      // A pure HORIZONTAL carry: the palm keeps its height, so the pile never
      // has to descend through the fingers holding it up.
      to: (dk) => stackLayout(dk, PILE_Y).map((p) => ({ ...p, pos: p.pos.clone().setZ(LPZ) })),
      grip: { left: { cards: 'all', frame: 'packet' } },
      hands: {
        left: [{ at: 1, pose: cradle(CUP_CLOSED, N, 0, LPZ) }],
        // WIDE, not merely beside: the left hand carries the pile through table
        // centre on this beat and its thumb sweeps a hand-length across as it
        // goes. Parking the right hand one card out left the two translucent
        // hands inside each other at the hand-off.
        right: [{ at: 1, pose: openHold(WIDE, TABLE_TOP, 0.1, CARD_H * 0.5) }],
      },
      annotations: [{ text: 'Blocks moved as blocks — the order barely mixed', appearAt: 0.35 }],
    })
    steps.push({
      kind: 'move',
      id: 'set-down',
      label: 'Open the palm and set it down',
      duration: 1200,
      // easeInCubic: the stack barely moves for the first third of the beat,
      // which is exactly the window the supporting palm needs to slide out from
      // under it. Anything front-loaded drags the cards down through the fingers
      // still holding them.
      ease: 'easeInCubic',
      to: (dk) => stackLayout(dk),
      hands: {
        left: [
          // An explicit at:0 keyframe: without one the lead-in segment inherits
          // the STEP's ease, so the palm dawdled under the falling stack.
          { at: 0, pose: cradle(CUP_CLOSED, N, 0, LPZ) },
          // OUT FIRST, and out of the stack's FOOTPRINT, not merely open. The
          // pile has a full cup's height to lose here, and easeInCubic buys the
          // withdrawal its window — but only if the palm actually leaves: an
          // opened cup still parked under the column is a hand the whole stack
          // descends through (measured 0.135 deep).
          { at: 0.34, pose: cradle(CUP_OPEN, 0, -CARD_W * 1.25, LPZ), ease: 'easeOutCubic' },
          { at: 1, pose: cradle(CUP_OPEN, 0, -WIDE, LPZ + CARD_H * 0.3), ease: 'easeOutCubic' },
        ],
        right: [{ at: 1, pose: openHold(WIDE, TABLE_TOP, 0.06, CARD_H * 0.5), ease: 'easeOutCubic' }],
      },
    })
    steps.push({
      kind: 'hold',
      id: 'rest',
      label: 'Blocks moved — barely mixed',
      duration: 800,
      // The closing beat RESTS on the deck rather than floating beside it.
      hands: {
        right: [
          {
            at: 0.75,
            pose: holdOn(cardAt(0, TABLE_TOP, 0), C_PRESS, { lift: MOTION_AIR, cards: stackOf(0, 0.02, N, 0) }),
            ease: 'easeOutCubic',
            fingerMotion: [{ fingers: FOUR, type: 'curlRipple', amp: MOTION_AMP, cycles: 1 }],
          },
        ],
      },
    })
    // THE CRADLE BREATHES AT HALF AMPLITUDE, and that is the price of a hand
    // that actually carries the deck. The idle overlay staggers its phase per
    // FINGER (handMotion's FINGER_PHASE), so on a hand holding a packet the pads
    // and the contact frame the packet rides drift apart by up to 0.03 — more
    // than the 0.025 the suite calls contact, and a seat big enough to absorb it
    // is by definition a seat that never touches. Damping this ONE hand keeps
    // that drift inside a pad's own clearance. It is applied to every left
    // keyframe in the lesson, so the overlay stays continuous (a scale that
    // changes between segments would pop the whole pile, which rides the hand).
    for (const st of steps) {
      for (const kf of st.hands?.left ?? []) kf.idleScale = CUP_IDLE
    }
    return steps
  },
}
