import * as THREE from 'three'
import { stackLayout, faceQuat } from '../engine/layouts'
import { poseWithContacts, surfaceContact, wristAnchorForContact } from '../authoring/contacts'
import { splitIntoRandomBlocks } from '../../lib/shuffleMath'
import { CARD_GAP, CARD_H, CARD_T, CARD_W } from '../../lib/constants'
import { getHandPose } from '../../hands/handPoses'
import { fingerJointsWorld } from '../../hands/handKinematics'
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
//   * `riseIn` — how high the cradle's own geometry reaches INSIDE the pile's
//     footprint, sampled over EVERY curl between open and closed rather than
//     just the two ends. The pile's bottom card sits exactly that far above the
//     wrist, so the hand carries it and no part of the cycle can reach into it.
//     Restricting to the footprint is what keeps the answer a palm's depth: a
//     fingertip that has curled up past the pile's near edge is outside it and
//     no longer part of the question.
//   * `dropAt` — the mirror image for the palm-down hand: the deepest finger
//     SURFACE below its wrist at a given curl, sampled along every capsule
//     (rigMetrics samples joints only and under-reads a slanted phalange by
//     ~0.02, which is most of this lesson's air).
//   * `cupAt().floor` — the same for the cradle, because a palm-up hand is the
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

// One curl scalar drives all three joints of every finger in the rig's own
// proportion; `base` only supplies the splay and the wrist frame.
const shaped = (preset, quat, c) => {
  const p = getHandPose(preset, 'right')
  p.wrist.quat.copy(quat)
  p.fingers.thumb = thumbChain(c)
  for (const n of FOUR) p.fingers[n] = chain(c)
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
const _cup = new Map()
const cupAt = (c) => {
  if (!_cup.has(c)) {
    const p = atOrigin(shaped('palmCradle', CRADLE_QUAT, c))
    _cup.set(c, { pose: p, floor: -extent(p, 'left').lo })
  }
  return _cup.get(c)
}

// THE CUP IS SHALLOW, AND IT HAS TO BE. A palm-up hand's fingers curl UP, so a
// deep cup sweeps its own fingertips straight through the pile they are
// carrying — and putting the pile above the DEEPEST such sweep floats it at
// y = 1.4, a whole card-width over where a cradle can sensibly hold anything.
// So the closing half of the cycle is the pile's seat, and the OPENING half
// hyperextends the fingers slightly DOWNWARD (JOINT_LIMITS allows −0.25, and
// real fingers do bend back a touch), which drops the palm away from the block
// coming down into it without ever rising into it.
const C_FLAT = -0.05 // palm dropped open to receive
const C_CUP = 0.14 // fingers closed up under the pile — where it rests
const C_PRESS = 0.62 // right-hand pads pressed on the deck's top card
const C_LET = 0.02 // ...straightened, and lifted off it: a block is let go

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
    // Sampled over the WHOLE open-to-closed blend, not just its ends: the hand
    // is at every one of those curls at some point, and depth is not linear in
    // curl (measured, the mid-blend sags below both endpoints).
    const CUP_BLEND = Array.from({ length: 13 }, (_, i) => C_FLAT + ((C_CUP - C_FLAT) * i) / 12)
    const CRADLE_Y = 0.012 + Math.max(...CUP_BLEND.map((c) => cupAt(c).floor)) + PAD_AIR

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
    const CRADLE_XZ = (() => {
      const seed = shaped('palmCradle', CRADLE_QUAT, C_FLAT)
      // '+z' is the card's DOWN face for a face-down card — the surface a cup
      // carries. Left-hand targets are authored x-mirrored.
      const t = surfaceContact(cardAt(LPX, 0, LPZ), { finger: 'middle', face: '+z', u: PAD_U, v: 0 })
      t.x = -t.x
      return wristAnchorForContact(seed, 'right', 'middle', t.toArray())
    })()
    // Moving the cup to another column is a MINUS in x, not a plus: anchors are
    // authored in right-hand coords and the engine negates x for the left hand,
    // so a world step of +dx is an authored step of −dx. (Getting this backwards
    // sent the pile the wrong way down the table on the carry-back, with the
    // whole finished stack still welded to the hand.)
    const cradleWrist = (px, pz) => [CRADLE_XZ[0] - (px - LPX), CRADLE_Y, CRADLE_XZ[2] + (pz - LPZ)]
    // The cradle's own reach INSIDE the pile's footprint decides where the pile
    // sits: put the bottom card exactly there and the hand carries it. Taken
    // over EVERY curl the lesson uses, so opening and closing can only ever add
    // clearance — the pile never has to move to let the fingers work. Closing
    // the cup swings the fingertips up and BACK, out past the pile's near edge
    // and therefore out of the footprint, which is why the answer stays a
    // sensible palm's depth instead of a fist's.
    const riseIn = (c) => {
      const p = poseWithContacts(shaped('palmCradle', CRADLE_QUAT, c), 'left', {
        anchor: [CRADLE_XZ[0], 0, CRADLE_XZ[2]],
        quat: CRADLE_QUAT,
      })
      return extent(p, 'left', LPX, LPZ).hi
    }
    const CUP_RISE = Math.max(...CUP_BLEND.map(riseIn))
    // Twice the motion air: a `fingerMotion` ripple rides ON TOP of a blend
    // between two shaped hands, and that blend already sags below both of its
    // own endpoints.
    const PILE_Y = CRADLE_Y + CUP_RISE + CARD_T / 2 + PAD_AIR + 2 * MOTION_AIR
    const pileTop = (n) => PILE_Y + Math.max(0, n - 1) * CARD_GAP

    const cradle = (c, n, px = LPX, pz = LPZ) =>
      poseWithContacts(shaped('palmCradle', CRADLE_QUAT, c), 'left', {
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
            { at: 0, pose: cradle(C_FLAT, 0, LPX - CARD_W * 1.2, LPZ) },
            { at: 1, pose: cradle(C_FLAT, 0, LPX - CARD_W * 1.2, LPZ), ease: 'easeOutCubic' },
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
          left: [{ at: 1, pose: cradle(C_FLAT, 0, LPX - CARD_W * 1.2, LPZ) }],
        },
      },
    ]

    let inHand = deck.slice()
    let piled = 0
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
      // finished pile (the stale-closure trap (see ARCHITECTURE.md)).
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
          left: [{ at: 1, pose: cradle(C_FLAT, piled) }],
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
          left: [{ at: 1, pose: cradle(C_CUP, piled + n), ease: 'easeOutCubic' }],
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
        hands: {
          right: [{ at: 1, pose: regrip, fingerMotion: [{ fingers: FOUR, type: 'tighten', amp: MOTION_AMP }] }],
          left: [
            {
              at: 1,
              pose: cradle(C_CUP, piled + n),
              fingerMotion: [{ fingers: FOUR, type: 'curlRipple', amp: MOTION_AMP, cycles: 1 }],
            },
          ],
        },
      })

      inHand = rest
      piled += n
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
        left: [{ at: 1, pose: cradle(C_CUP, N, 0, LPZ) }],
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
          { at: 0, pose: cradle(C_CUP, N, 0, LPZ) },
          // OUT FIRST, and out of the stack's FOOTPRINT, not merely open. The
          // pile has a full cup's height to lose here, and easeInCubic buys the
          // withdrawal its window — but only if the palm actually leaves: an
          // opened cup still parked under the column is a hand the whole stack
          // descends through (measured 0.135 deep).
          { at: 0.34, pose: cradle(C_FLAT, 0, -CARD_W * 1.25, LPZ), ease: 'easeOutCubic' },
          { at: 1, pose: cradle(C_FLAT, 0, -WIDE, LPZ + CARD_H * 0.3), ease: 'easeOutCubic' },
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
    return steps
  },
}
