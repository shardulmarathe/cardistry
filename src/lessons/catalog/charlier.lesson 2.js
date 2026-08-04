import * as THREE from 'three'
import { stackLayout, faceQuat } from '../engine/layouts'
import {
  packetGrip,
  poseWithContacts,
  resolvePenetration,
  surfaceContact,
  wristAnchorForContact,
} from '../authoring/contacts'
import { CARD_GAP, CARD_W, CARD_H, CARD_T } from '../../lib/constants'
import { getHandPose, cloneHandPose, DECK_REST_DROP } from '../../hands/handPoses'
import { contactFrame, fingerJointsWorld, fingertipWorld } from '../../hands/handKinematics'
import { FINGERS, FINGER_NAMES, HAND_SCALE } from '../../hands/handRigSpec'

// Charlier cut, the one-handed flourish. THE INDEX FINGER DOES THE CUT, and
// this file is built backwards from that one requirement.
//
// WHY THE OLD VERSION READ AS "the cards just move on their own". The bottom
// packet was welded to `indexPivot`, whose position IS the index fingertip -
// but the captured offset was 0.81, so the packet orbited a remote pivot
// instead of resting on a finger, and its whole swing came from that frame's
// `pitchGain × meanCurl(index)`: a GAIN on how curled the finger was, not a
// consequence of where the finger went. Extending the index to "push" therefore
// made the cut SMALLER, and the packet stopped clearing the top half at all.
//
// WHAT DRIVES IT NOW. At HAND_SCALE 13 the index is long enough to carry a
// packet, so the packet is seated ON the finger and the cut is literally the
// finger's TRAJECTORY. One scalar, the index curl, drives everything:
//
//   curl    pad (rel. wrist)   what the packet is doing
//   1.15    (0.46, 0.87)       deck resting on the four fingers
//   1.55    (0.16, 0.51)       fingers give way; the half settles into the crook
//   1.15    (0.46, 0.87)       swept back up, the half is over the other one
//
// The pad travels a circular arc of radius 0.80 centred 0.90 ahead of and 0.16
// above the wrist, in a plane of constant z, so the swing is broadside to the
// camera instead of foreshortened. Uncurling 1.55 → 1.15 lifts the packet 0.30
// and carries it 0.24 forward while `pitchGain` rolls it 41° about that same
// pad. Nothing in the pivot is authored as a card position: the packet's `to`
// is nominal and never reached, because while it is held it goes exactly where
// the finger goes. Every downstream landmark, where the half lands when the
// fingers give way, where the finished stack sits, where the thumb catches, is
// COMPUTED from that trajectory (`carriedTo`), not typed in, so the cut cannot
// drift out of agreement with the hand doing it.
//
// HOW FAR TO SWEEP IS SET BY THE ROLL, NOT THE LIFT. `pitchGain` is −2.2 per
// radian of mean curl, so a big sweep stands the packet most of the way onto
// its edge, and a packet on edge hangs a third of a card BELOW its own seat,
// which is exactly where the finger carrying it is. Sweeping to curl 0.85 (a
// 67° roll) cost 0.18 of the arc's lift to `SEAT × (1 − cos θ)` AND drove the
// pad 0.12 through the packet as it flattened again. Stopping at 1.15 (41°)
// keeps almost the same lift, and the flatter packet no longer sweeps its own
// carrier. See the HANDS_HANDOFF note: a smaller |pitchGain| would buy back
// both, and let the cut be bigger.
//
// THE SEAT IS MEASURED, NOT ASSUMED. A packet resting at fingertip height is
// impaled on the finger: past about curl 1.25 the DIP knuckle rises ABOVE the
// pad, and seating the packet on the pad alone put the middle phalange 0.15
// inside it. `seatOf` measures how far the finger's own capsules rise above its
// pad, so the packet sits on the finger's crook, which is where a real
// Charlier's lower half sits, and no phalange can enter it.
export const charlierLesson = {
  id: 'charlier',
  title: 'Charlier Cut',
  technique: 'charlier',
  difficulty: 'beginner',
  randomizes: 'None — a cut',
  seed: 14,
  // NOT `handCut`: that preset sits 3.7 from its target with a 32° fov, i.e. a
  // half-height of 1.05, it was framed for a hand a third of this size, and at
  // HAND_SCALE 13 the palm alone overflows it and the cut runs off the top of
  // the frame. `dealerPOV` is 6.4 out with a half-height of 2.2, which holds the
  // whole hand AND the table deck it starts from.
  cameraPreset: 'dealerPOV',
  summary:
    'A one-handed cut, not a shuffle: the thumb drops the bottom half into the palm, the index finger pivots it up and over the top. Deterministic — it only cuts.',
  facts: [
    'The Charlier is a flourish cut, not a randomizer — the deck ends in a known half-and-half swap.',
    'It is a gateway move in cardistry: one hand, one fluid pivot, all in the fingers.',
  ],
  build: (deck) => {
    const N = deck.length
    const mid = Math.floor(N / 2)
    const cutOrder = [...deck.slice(mid), ...deck.slice(0, mid)]
    const TABLE_TOP = 0.02 + (N - 1) * CARD_GAP
    const DECK_H = (N - 1) * CARD_GAP
    const HALF_H = mid * CARD_GAP

    // --- The cradle's orientation --------------------------------------------
    // Palm UP, fingers pointing +x, thumb trailing to −z. Two consequences, both
    // load-bearing:
    //  * the index's curl arc lies in a plane of constant z, so the cut happens
    //    broadside to the camera instead of toward it;
    //  * `contactFrame` rolls a held packet about the WRIST's local x, which
    //    this quat sends to world +z, and a face-down card's LONG axis is world
    //    z too, so the packet rolls over its own long edge (the Charlier
    //    motion) instead of tumbling end over end.
    const CRADLE_QUAT = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-Math.PI / 2, 0, -Math.PI / 2),
    )

    // A finger curls as a chain, so one number drives all three joints in the
    // rig's own proportion, and that number is the whole cut.
    const idx = (c) => [c, c * 0.85, c * 0.6]
    const C_HOLD = 1.15 // deck resting on the fingers, thumb braced on its edge
    const C_DROP = 1.55 // fingers give way, the bottom half settles into the crook
    const C_APEX = 1.15 // index swept back up, packet over the other half
    const C_OPEN = 1.45 // index curls back into the palm, clear of the stack ahead of it

    // All four fingers start from the same curl, scaled by chain length so the
    // pads line up across the card. This is a SEED as much as a pose: the
    // fingertip IK is a damped Gauss–Newton from wherever the base pose already
    // is, and seeded from `palmCradle`'s half-open curls it converged to
    // nonsense for the deeply-curled targets, the middle pad came out 0.43
    // past the deck's long edge and grazing it. Seeded near the answer it lands
    // on the answer.
    const cradleBase = (c) => {
      const p = getHandPose('palmCradle', 'right')
      p.wrist.quat.copy(CRADLE_QUAT)
      p.fingers.index = idx(c)
      p.fingers.middle = idx(c * 0.95)
      p.fingers.ring = idx(c * 0.95)
      p.fingers.pinky = idx(c * 0.9)
      return p
    }
    const vec = (v) => [v.x, v.y, v.z]
    // Where a finger's pad sits relative to the wrist under a pose.
    // (wristAnchorForContact aimed at the origin is exactly the negated offset.)
    const padOffset = (pose, finger) => {
      const a = wristAnchorForContact(pose, 'right', finger, [0, 0, 0])
      return new THREE.Vector3(-a[0], -a[1], -a[2])
    }

    // How far the index's own geometry rises ABOVE its pad at a given curl -
    // measured over every capsule of every phalange, so it scales with the rig.
    // Add a card's half-thickness and you have the height a packet must sit at
    // for the finger to CARRY it rather than pass through it.
    const _cj = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
    const _cp = new THREE.Vector3()
    const seatOf = (c) => {
      const p = cradleBase(c)
      p.wrist.pos.set(0, 0, 0)
      fingerJointsWorld(p, 'right', 'index', _cj)
      let crest = 0
      for (let i = 0; i < 3; i++) {
        const r = FINGERS.index.rad[i] * HAND_SCALE
        for (let k = 0; k <= 8; k++) {
          _cp.copy(_cj[i]).lerp(_cj[i + 1], k / 8)
          crest = Math.max(crest, _cp.y + r - _cj[3].y)
        }
      }
      return crest + CARD_T / 2
    }

    const PAD_HOLD = padOffset(cradleBase(C_HOLD), 'index')
    const PAD_DROP = padOffset(cradleBase(C_DROP), 'index')
    // ONE seat, taken at the DEEPEST curl the cut uses. Two reasons it has to be
    // the deepest rather than per-curl:
    //  * the packet is welded at that height for the whole ride, so it must fit
    //    the worst curl or the finger grows into it mid-sweep;
    //  * it lifts the DECK clear of the pad's entire arc. Seated at the shallow
    //    curl the deck sat only 0.12 over the arc, and the finger's own crest
    //    came back up through it 0.02 away, inside the idle overlay's wobble.
    //    Seated at the deep curl there is 0.19 of air over every point the pad
    //    can reach, so the sweep cannot touch the half it is cutting away from.
    const SEAT = seatOf(C_DROP)

    // How far the WHOLE hand hangs below the wrist in this cradle, the same
    // measurement `DECK_REST_DROP` makes for the palm-down poses, taken here
    // because a palm-up hand is the other way up: the cards ride ABOVE the wrist
    // and it is the heel and the opened thumb that have to clear the felt.
    const OPEN_THUMB = [0.5, 0.36, 0.22]
    const floorOf = (pose) => {
      let lo = 0
      for (const name of FINGER_NAMES) {
        fingerJointsWorld(pose, 'right', name, _cj)
        for (let i = 0; i < 3; i++) {
          const r = FINGERS[name].rad[i] * HAND_SCALE
          for (let k = 0; k <= 4; k++) {
            _cp.copy(_cj[i]).lerp(_cj[i + 1], k / 4)
            lo = Math.min(lo, _cp.y - r)
          }
        }
      }
      return lo
    }
    const CRADLE_FLOOR = Math.min(
      ...[C_HOLD, C_DROP, C_APEX, C_OPEN].map((c) => {
        const p = cradleBase(c)
        p.wrist.pos.set(0, 0, 0)
        p.fingers.thumb = OPEN_THUMB
        return floorOf(p)
      }),
    )

    // --- Where the cut happens ------------------------------------------------
    const DX = 0.05
    const DZ = 0.1
    // The cut happens as high as it has to and no higher: put the heel of the
    // hand on the felt, and the deck lands wherever the curled fingers hold it.
    // (A one-handed cut IS done up in the air, this is the rig's own answer to
    // how far up, rather than a number that goes stale when HAND_SCALE moves.)
    const WRIST_Y = -CRADLE_FLOOR + CARD_T
    const cardAt = (y, x = DX, z = DZ) => ({ pos: [x, y, z], quat: faceQuat(false) })

    // The index takes the packet a little toward the thumb end of its long axis;
    // the other three knuckles are 0.87 apart across a card 0.88 long, so the
    // hand spans the packet and each finger gets its own patch.
    const SEAT_V = -0.45
    const DY = WRIST_Y + PAD_HOLD.y + SEAT
    const seatPoint = (card) => {
      const p = surfaceContact(card, { finger: 'index', face: '+z', u: 0, v: SEAT_V })
      // surfaceContact backs off by the PAD's radius; this finger needs the
      // whole crest, so re-drop it to the measured seat.
      p.y = card.pos[1] - SEAT
      return p
    }
    const W = wristAnchorForContact(cradleBase(C_HOLD), 'right', 'index', vec(seatPoint(cardAt(DY))))
    const wristV = new THREE.Vector3(W[0], W[1], W[2])

    // Where the fingers give way to: the pad's own position at C_DROP. No drop
    // distance is typed in, the half lands wherever the finger goes.
    const PALM = new THREE.Vector3(W[0] + PAD_DROP.x, W[1] + PAD_DROP.y + SEAT, DZ)

    // --- The pivot, solved forward from the finger ---------------------------
    // The exact grip frame the engine will use, at any curl.
    const frameAt = (c) => {
      const p = cradleBase(c)
      p.wrist.pos.copy(wristV)
      return contactFrame(p, 'right', 'indexPivot', {
        pos: new THREE.Vector3(),
        quat: new THREE.Quaternion(),
      })
    }
    const F_DROP = frameAt(C_DROP)
    // The packet's pose in that frame, captured exactly as compileLesson will.
    const SEATED = PALM.clone().sub(F_DROP.pos).applyQuaternion(F_DROP.quat.clone().invert())
    const carriedTo = (c) => {
      const f = frameAt(c)
      return SEATED.clone().applyQuaternion(f.quat).add(f.pos)
    }
    const APEX = carriedTo(C_APEX) // where the finger will have put the packet

    // Room for the idle overlay and a `tighten`, hand-sized, so hand-derived.
    const PAD_AIR = DECK_REST_DROP * 0.075

    // How far FORWARD the index's own surface reaches at a curl, counting only
    // the capsules that are LEVEL with the finished stack. Both halves of that
    // matter: it is never the pad that collides (at these curls the PIP and DIP
    // swing out well past the fingertip), and the PIP is also far too low to
    // reach the stack, so measuring the raw front would shove the landing spot a
    // third of a card further out than it needs to be, out of the other
    // fingers' reach.
    const frontOf = (c, lo, hi) => {
      const p = cradleBase(c)
      p.wrist.pos.copy(wristV)
      fingerJointsWorld(p, 'right', 'index', _cj)
      let front = -Infinity
      for (let i = 0; i < 3; i++) {
        const r = FINGERS.index.rad[i] * HAND_SCALE
        for (let k = 0; k <= 8; k++) {
          _cp.copy(_cj[i]).lerp(_cj[i + 1], k / 8)
          if (_cp.y + r < lo || _cp.y - r > hi) continue
          front = Math.max(front, _cp.x + r)
        }
      }
      return front
    }

    // The finished stack sits BELOW the apex and AHEAD of it, out toward the
    // fingertips.
    //  * below by FALL, so the packet has visibly cleared the top half rather
    //    than grazing it and the `fall` beat has something to do;
    //  * ahead by exactly as much as the INDEX NEEDS. Landing the half under the
    //    apex buried the finger holding it (0.12 through the distal phalange)
    //    and let the rolling packet sweep the carriers (0.07); landing it behind
    //    the apex put it somewhere the other fingers physically cannot fold back
    //    to. So put its near long edge just past the front of the index, at
    //    every curl the finger visits from the apex to where it folds away.
    //
    //    This is the number that used to be typed in (CARD_W × 1.2), and it is
    //    the one that broke when HAND_SCALE moved 13 → 8: the clearance a finger
    //    needs is HAND-sized, not card-sized, so a card-fraction went stale by
    //    0.035 the moment the rig changed. Measured, it tracks the rig for free.
    const FALL = CARD_W * 0.04
    const STACK_Y = APEX.y - HALF_H - FALL
    const SWEPT = [0, 0.25, 0.5, 0.75, 1].map((f) => C_APEX + (C_OPEN - C_APEX) * f)
    const INDEX_FRONT = Math.max(...SWEPT.map((c) => frontOf(c, STACK_Y - CARD_T, STACK_Y + DECK_H)))
    const STACK = new THREE.Vector3(
      Math.max(APEX.x, INDEX_FRONT + CARD_W / 2 + PAD_AIR),
      STACK_Y,
      APEX.z,
    )

    // --- Poses ----------------------------------------------------------------
    // The fingers press UP into these stacks, so a SHIELD card goes BELOW each:
    // a finger relaxed until it clears the shield ends up that much under the
    // real card, which is the room the idle overlay, `tighten` and grip
    // `pressure` need. It is hand-sized (a curl of θ moves a pad by θ × the
    // finger's length), so it scales with the rig instead of going stale.
    const SHIELD = DECK_REST_DROP * 0.09
    const stackOf = (base, n) =>
      Array.from({ length: n }, (_, i) => cardAt(base.y + i * CARD_GAP, base.x, base.z))
    const deckBase = new THREE.Vector3(DX, DY, DZ)
    const heldDeck = [...stackOf(deckBase, N), cardAt(DY - SHIELD)]
    const dropped = [
      ...stackOf(PALM, mid),
      ...stackOf(new THREE.Vector3(DX, DY + HALF_H, DZ), mid),
      cardAt(PALM.y - SHIELD, PALM.x),
      cardAt(DY + HALF_H - SHIELD),
    ]
    const settled = [...stackOf(STACK, N), cardAt(STACK.y - SHIELD, STACK.x, STACK.z)]

    // Three pads under whichever card the hand is carrying, plus (when it is
    // holding) the thumb braced on that stack's near long edge, the edge the
    // thumb lets go of. `resolvePenetration` never touches the INDEX: its seat
    // IS the grip frame, and relaxing it would slide the packet off the finger.
    const CARRIERS = ['middle', 'ring', 'pinky']
    const PATCH = { middle: [0.55, 0.1], ring: [0.6, 0.7], pinky: [0.5, 0.98] }
    const nearEdge = (card) => surfaceContact(card, { finger: 'thumb', face: '-x', u: 0, v: 0 })

    // SEEDED fingertip IK. `solveFingerTo` is a damped Gauss–Newton from
    // whatever curl the pose already has, and for a pad target tucked back over
    // the palm, which is every target in this cradle, it happily settles on
    // the mirror solution with the tip 0.35 from where it was asked for, up over
    // the deck's long edge instead of under it. Sweeping a fixed ladder of seed
    // curls and keeping the one that lands nearest costs nothing at compile time
    // and is just as deterministic.
    const _tw = new THREE.Vector3()
    const solveOnto = (pose, finger, target) => {
      let best = null
      for (const s of [0.3, 0.6, 0.9, 1.2, 1.5]) {
        const probe = cloneHandPose(pose)
        probe.fingers[finger] = idx(s)
        const solved = poseWithContacts(probe, 'right', { anchor: W, quat: CRADLE_QUAT }, { [finger]: target })
        fingertipWorld(solved, 'right', finger, _tw)
        const err = _tw.distanceTo(target)
        if (!best || err < best.err) best = { err, angles: solved.fingers[finger] }
      }
      pose.fingers[finger] = best.angles
    }

    // Every curled finger has a crest, the point where its own middle phalange
    // rises above its pad, and a card seated at pad height is impaled on it.
    // `SEAT` handles that for the index (whose crest is fixed by the grip); the
    // carriers change curl with every pose, so measure each one's crest at the
    // curl the solve actually returned and re-aim. Three passes converge; a card
    // then rests on the WHOLE finger instead of only on the fingertip, which is
    // both what a real cradle looks like and what keeps the knuckles outside it.
    const crestOf = (pose, finger) => {
      fingerJointsWorld(pose, 'right', finger, _cj)
      let crest = 0
      for (let i = 0; i < 3; i++) {
        const r = FINGERS[finger].rad[i] * HAND_SCALE
        for (let k = 0; k <= 8; k++) {
          _cp.copy(_cj[i]).lerp(_cj[i + 1], k / 8)
          crest = Math.max(crest, _cp.y + r - _cj[3].y)
        }
      }
      return crest
    }
    const seatCarrier = (pose, name, card) => {
      const [u, v] = PATCH[name]
      const target = surfaceContact(card, { finger: name, face: '+z', u, v })
      for (let it = 0; it < 3; it++) {
        solveOnto(pose, name, target)
        target.y = card.pos[1] - CARD_T / 2 - crestOf(pose, name) - PAD_AIR
      }
    }

    const cradle = (c, { card, cards, thumb }) => {
      const pose = poseWithContacts(cradleBase(c), 'right', { anchor: W, quat: CRADLE_QUAT }, {})
      for (const name of CARRIERS) seatCarrier(pose, name, card)
      if (thumb) {
        const solved = poseWithContacts(pose, 'right', { anchor: W, quat: CRADLE_QUAT }, { thumb })
        pose.fingers.thumb = solved.fingers.thumb
        pose.thumbOpp = solved.thumbOpp
      } else {
        // Thumb open, the release. Swung off the edge and uncurled enough that
        // it visibly is not holding anything, but not so far that it hangs
        // through the felt (it is the lowest thing on a palm-up hand).
        pose.fingers.thumb = [...OPEN_THUMB]
        pose.thumbOpp = { ...(pose.thumbOpp ?? {}), z: (pose.thumbOpp?.z ?? 0) - 0.5 }
      }
      // Never the INDEX: its seat IS the grip frame, and relaxing it would slide
      // the packet off the finger that is supposed to be carrying it.
      resolvePenetration(pose, 'right', cards, { fingers: [...CARRIERS, 'thumb'] })
      return pose
    }

    const holdPose = cradle(C_HOLD, {
      card: cardAt(DY),
      cards: heldDeck,
      thumb: nearEdge(cardAt(DY)),
    })
    const stackCard = cardAt(STACK.y, STACK.x, STACK.z)
    // The carriers reach for the landing spot from the RELEASE onward, not from
    // the pivot: moving them mid-sweep walked them straight into the half that
    // was sliding down onto them. Only the index moves during the cut.
    const openPose = cradle(C_DROP, { card: stackCard, cards: dropped })
    // At the apex the carriers are already reaching forward for where the top
    // half is about to land; the index is up, holding the packet over it.
    const apexPose = cradle(C_APEX, { card: stackCard, cards: settled })
    // …then the index folds back into the palm. It has to go SOMEWHERE: the
    // finished stack is out at the fingertips, so straightening would drive the
    // pad straight into it; curling back leaves the deck sitting on the other
    // three fingers with the index tucked under the near edge, which is where a
    // real Charlier leaves it.
    const openEndPose = cradle(C_OPEN, { card: stackCard, cards: settled })
    const catchPose = cradle(C_OPEN, {
      card: stackCard,
      cards: settled,
      thumb: nearEdge(stackCard),
    })

    // --- Card layouts ---------------------------------------------------------
    const raised = (dk) =>
      dk.map((c, i) => ({
        id: c.id,
        pos: new THREE.Vector3(DX, DY + i * CARD_GAP, DZ),
        quat: faceQuat(c.isFaceUp),
        bend: 0,
      }))
    // Bottom half only: it lands exactly on the pad's new position, so the grip
    // that picks it up next captures a SEATED offset, the packet rides the
    // finger instead of floating beside it.
    const dropBottom = (dk) =>
      dk.slice(0, mid).map((c, i) => ({
        id: c.id,
        pos: new THREE.Vector3(PALM.x, PALM.y + i * CARD_GAP, PALM.z),
        quat: faceQuat(c.isFaceUp),
        bend: 0,
      }))
    // End of the cut: top half on the palm, original bottom half above it.
    const palmStack = (dk) =>
      dk.map((c, i) => ({
        id: c.id,
        pos: new THREE.Vector3(STACK.x, STACK.y + (i < mid ? mid + i : i - mid) * CARD_GAP, STACK.z),
        quat: faceQuat(c.isFaceUp),
        bend: 0,
      }))

    // --- Stations for the approach and the set-down ---------------------------
    // Same two measured primitives the strip lesson uses: `wristAnchorForContact`
    // for reach, `top + DECK_*_DROP` for a drop that puts the pose's lowest
    // finger SURFACE tangent on the top card, so no capsule can be inside it.
    const wristFor = (pose, x, top, z, drop) => {
      const a = wristAnchorForContact(pose, 'right', 'middle', [x, 0, z])
      return [a[0], top + drop, a[2]]
    }
    const restWrist = (x, top, z) => wristFor('deckRest', x, top, z, DECK_REST_DROP)
    const overWrist = (x, top, z) => wristFor('deckApproach', x, top, z, DECK_REST_DROP)
    const GRIP_PRESSURE = 0.2

    // --- The two CARRY holds: a real grip, not a hand resting near the deck ---
    // `deckRest` is a PRESET, and `DECK_REST_DROP` only guarantees that the
    // pose's LOWEST finger surface is tangent on the top card. That is one pad
    // on the cards and four in the air, which is exactly what the carry beats
    // measured: over `lift` and `lower` the thumb sat 1.30 from the deck it was
    // supposedly holding, the pinky 0.39, the index 0.16, and only the middle
    // finger ever touched (7% of gripping fingertips in contact, median gap
    // 0.168). A drop that clears the deck is not a grip, it is a hover with a
    // floor under it.
    //
    // `packetGrip` is the shared solved straddle the riffle and faro carry with:
    // thumb on the pile's far long edge, the four pads arching over its centre
    // line onto the near one, every target a point on a REAL card surface and
    // every wrist offset read off the rig. Solve it once per station.
    //
    // …with one correction, for the one pad that is still off after it. The
    // thumb keeps a real reservation inside `tableGrip`, 1.2x its measured
    // squeeze travel, because on the riffle's carries a tightening thumb
    // drives into the half still sitting at the table centre. There is no
    // neighbouring half here, and measured on THIS grip the pressure curl moves
    // the thumb tip AWAY from the edge it holds (x 0.476 → 0.488), so the
    // reservation is air that is never spent: 0.040 static, 0.055 with the
    // squeeze on, while every other pad sits inside 0.018. Re-solve the thumb
    // onto the edge itself and keep `resolvePenetration` as the guard.
    const deckColumn = (x, y, z) => {
      const cards = [0, 0.5, 1].map((f) => cardAt(y + DECK_H * f, x, z))
      // Down to the felt: a deck held in the air is still a solid column as far
      // as the thumb is concerned, and its distal capsule hangs below its pad.
      for (let h = -CARD_GAP * 4; y + h > 0.012; h -= CARD_GAP * 4) cards.push(cardAt(y + h, x, z))
      return cards
    }
    // HOW FAR OFF THE THUMB CAN BE SEATED IS SET BY ITS KNUCKLE, NOT ITS PAD,
    // and this is why the reservation looked like a free 0.040 and is not.
    // Swept on this grip: at any pad clearance under 0.030 the tip lands on the
    // edge (0.009-0.015 off it) but the thumb's IP joint, the far end of the
    // fat middle phalange, radius 0.187 unscaled, sinks 0.007 into the cards,
    // and `resolvePenetration` answers by STRAIGHTENING the whole thumb, which
    // throws the tip 0.50 away and off the deck's end entirely: worse than the
    // hover it was meant to cure. Only at 0.030+ is the thumb strictly clear,
    // and that is exactly the standoff that was hovering.
    //
    // So take the documented trade instead of pretending it is not there: a
    // fingertip that is really ON a card reads as a small overlap to a rigid
    // capsule model, because flesh compresses and capsules do not. Aim the PAD
    // at the edge itself (clearance 0) and let the KNUCKLE graze, bounded by a
    // sixth of the thumb's own pad radius, so the allowance follows the rig -
    // with `resolvePenetration` still the guard that nothing goes DEEPER than
    // that. Note the tolerance is doing the opposite of its usual job here: it
    // is a deliberate, measured graze budget, not the accidental one the
    // contacts.js note warns about. Measured: pad gap 0.009 solved / 0.020 with
    // the squeeze on (inside the 0.025 contact band), knuckle graze 0.012,
    // against a 0.038 budget whose binding case is the `fall` index at 0.036.
    const THUMB_GRAZE = FINGERS.thumb.rad[2] * HAND_SCALE * 0.165
    const deckGrip = (x, y, z) => {
      const g = packetGrip({ centerX: x, centerZ: z, baseY: y, deckH: DECK_H, squeeze: GRIP_PRESSURE })
      // Same face, same `u` as tableGrip's own thumb target (the pile's far long
      // edge, half way up the stack, on its inner third), only the standoff
      // differs.
      const pose = poseWithContacts(g.pose, 'right', {}, {
        thumb: surfaceContact(cardAt(y + DECK_H * 0.5, x, z), { finger: 'thumb', face: '+x', u: -0.3 }),
      })
      resolvePenetration(pose, 'right', deckColumn(x, y, z), {
        fingers: ['thumb'],
        clearance: THUMB_GRAZE,
      })
      return { pose, anchor: g.anchor }
    }
    // TRANSLATE a solved grip to its far station; never re-solve there. A
    // gripped deck rides the hand's contact frame rigidly, so moving hand and
    // deck together by the same vector keeps the captured card→frame offset
    // exact, while a second solve would return different curls and walk the
    // deck straight through the pads that are holding it (the same trap
    // tableGrip's `tilt` note describes).
    const gripAt = (g, dx, dy, dz) => [g.anchor[0] + dx, g.anchor[1] + dy, g.anchor[2] + dz]
    // Clear of the deck's column by more than a card: the only place the hand is
    // allowed to turn over. A grip is NEVER held across that turn, a fingertip
    // frame carries the deck rigidly, so a 180° wrist turn would stand the deck
    // on its edge. The deck simply waits, squared, while the hand goes around.
    const SIDE_X = Math.max(DX, STACK.x) + CARD_W * 1.7
    const cradleAt = (x, y, z) => [W[0] + (x - DX), W[1] + (y - DY), W[2] + (z - DZ)]
    const HOVER_Y = 0.02 + CARD_W * 0.35
    const NOTE_Y = DY + CARD_H * 0.75
    // The two decks this hand ever carries, and the stations each is carried to.
    const TABLE_GRIP = deckGrip(0, 0.02, 0) // the squared deck on the felt
    const STACK_GRIP = deckGrip(STACK.x, STACK.y, STACK.z) // the finished cut
    const LIFTED = gripAt(TABLE_GRIP, DX, DY - 0.02, DZ) // …up at working height
    const ASIDE = gripAt(TABLE_GRIP, SIDE_X, DY - 0.02, DZ) // …and out of its column
    const RETAKE = gripAt(STACK_GRIP, SIDE_X - STACK.x, 0, 0) // coming back from the side
    const HOVER = gripAt(STACK_GRIP, -STACK.x, HOVER_Y - STACK.y, DZ - STACK.z) // over the felt

    return [
      {
        kind: 'hold',
        id: 'approach',
        label: 'Reach in over the deck',
        duration: 900,
        hands: {
          right: [
            // An at:0 keyframe: without one the first segment starts from the
            // carried-forward `relaxed` default, which at this rig size opens
            // the lesson with a whole fist inside the deck.
            { at: 0, pose: 'deckApproach', anchor: overWrist(CARD_W * 2.4, TABLE_TOP, -CARD_H * 0.2) },
            // CLOSE THE FINGERS IN THE AIR, THEN DESCEND. A straight lerp from
            // an open `deckApproach` to a curled grip travels through every
            // pose in between, and those are not poses anything solved: the
            // middle pad swung 0.046 through the top card on the way in.
            // Finishing the morph a half-card up and coming down vertically in
            // the SOLVED pose means the pads meet the top face from directly
            // above, where they are already tangent.
            {
              at: 0.55,
              pose: TABLE_GRIP.pose,
              anchor: [TABLE_GRIP.anchor[0], TABLE_GRIP.anchor[1] + CARD_W * 0.5, TABLE_GRIP.anchor[2]],
              ease: 'easeInOutCubic',
            },
            // Arrive IN the grip, not above it: this frame is where the `lift`
            // hold captures its card→frame offsets, so whatever the hand is
            // doing here is what "holding the deck" means for the whole carry.
            { at: 1, pose: TABLE_GRIP.pose, anchor: TABLE_GRIP.anchor, ease: 'easeOutCubic' },
          ],
        },
      },
      {
        kind: 'move',
        id: 'lift',
        label: 'Take the deck up to working height',
        duration: 1200,
        ease: 'easeInOutCubic',
        to: (dk) => raised(dk),
        // Hand and deck travel between two stations exactly one deck-travel
        // apart, on the step's own curve, welded to a fingertip frame, so the
        // offset is constant for the whole flight and "clear at both ends"
        // really does mean clear throughout.
        grip: { right: { cards: 'all', frame: 'packet', pressure: [{ at: 0, v: GRIP_PRESSURE }, { at: 1, v: GRIP_PRESSURE }] } },
        hands: {
          right: [{ at: 1, pose: TABLE_GRIP.pose, anchor: LIFTED }],
        },
      },
      {
        kind: 'hold',
        id: 'turn',
        label: 'Turn the hand palm-up under the deck',
        duration: 1100,
        camera: 'dealerPOV',
        hands: {
          right: [
            // 1) out of the deck's column, still palm-down and still in the
            //    grip's own pose, the pads slide out along the top card's own
            //    plane and the thumb leaves the far edge it was holding.
            { at: 0.3, pose: TABLE_GRIP.pose, anchor: ASIDE },
            // 2) turn palm-up out there, at the cradle's own height,
            { at: 0.68, pose: holdPose, anchor: cradleAt(SIDE_X, DY, DZ), ease: 'easeInOutCubic' },
            // 3) slide in LAST, horizontally: the pads travel in under the
            //    deck's bottom card and stop one measured seat below it.
            { at: 1, pose: holdPose, anchor: W, ease: 'easeInCubic' },
          ],
        },
        annotations: [
          { text: 'Deck on the fingers, thumb braced on the near edge', at: [0, NOTE_Y, 0.6], appearAt: 0.55 },
        ],
      },
      {
        kind: 'hold',
        id: 'settle-grip',
        label: 'Settle the cradle',
        duration: 450,
        hands: {
          right: [
            {
              at: 1,
              pose: holdPose,
              anchor: W,
              fingerMotion: [{ fingers: ['thumb'], type: 'tighten', amp: 0.04 }],
            },
          ],
        },
      },
      {
        kind: 'move',
        id: 'release',
        label: 'Thumb relaxes — the bottom half settles into the fingers',
        duration: 800,
        ease: 'snapEase',
        to: (dk) => dropBottom(dk),
        // No grip: this beat IS gravity. The fingers give way (C_HOLD → C_DROP)
        // and the half lands exactly on the pad's new position, which is what
        // makes the next step's capture a seated one.
        hands: {
          right: [{ at: 1, pose: openPose, anchor: W, ease: 'snapEase' }],
        },
        annotations: [
          { text: 'Let gravity do it — the thumb just lets go', at: [0, NOTE_Y, 0.6], appearAt: 0.25 },
        ],
      },
      {
        kind: 'move',
        id: 'pivot',
        label: 'Index finger carries the packet up and over',
        duration: 1000,
        // The order of the two motions is load-bearing, and this is where the
        // eases earn their keep. The top half slides OUT along the opening
        // fingers as it settles, and the index's pad sweeps up through the
        // column it is leaving, so the half goes FIRST (snapEase: 88% of the
        // way across by t=0.35, while the pad is still low) and the sweep
        // follows on its own easeOutCubic. Run on one curve they meet in the
        // middle and the finger goes through the packet (measured 0.12 deep).
        ease: 'snapEase',
        // `to` for the bottom half is nominal and never reached: while it is
        // held it goes exactly where the finger goes.
        to: (dk) =>
          palmStack(dk).map((e, i) => (i < mid ? { ...e, pos: e.pos.clone().setY(e.pos.y + FALL) } : e)),
        grip: { right: { cards: 'firstHalf', frame: 'indexPivot' } },
        hands: {
          right: [
            {
              at: 1,
              pose: apexPose,
              anchor: W,
              ease: 'easeOutCubic',
              fingerMotion: [{ fingers: ['index'], type: 'tremor', amp: 0.012, cycles: 2 }],
            },
          ],
        },
        annotations: [
          { text: 'One finger does the cut — the packet rides the index', at: [0, NOTE_Y, 0.6], appearAt: 0.3 },
        ],
      },
      {
        kind: 'move',
        id: 'fall',
        label: 'Let it fall square onto the top half',
        duration: 700,
        // The PACKET goes first here. It leaves the apex rolled most of the way
        // onto its edge, so it is a tall thin slab standing on the finger, and
        // the index's only way out of that slab is back down its own arc, i.e.
        // straight through it. snapEase drops the packet flat and forward onto
        // the stack while the finger is still holding station (easeInCubic: 3%
        // moved at t=0.3), and the withdrawal then happens behind it.
        ease: 'snapEase',
        to: (dk) => palmStack(dk),
        hands: {
          right: [{ at: 1, pose: openEndPose, anchor: W, ease: 'easeInCubic' }],
        },
      },
      {
        kind: 'hold',
        id: 'catch',
        label: 'Thumb catches — squeeze the halves square',
        duration: 800,
        hands: {
          right: [
            {
              at: 0.6,
              pose: catchPose,
              anchor: W,
              ease: 'easeOutCubic',
              fingerMotion: [{ fingers: ['thumb'], type: 'tighten', amp: 0.04 }],
            },
          ],
        },
      },
      {
        kind: 'hold',
        id: 'handover',
        label: 'Take it back from above',
        duration: 1000,
        // Mirror of `turn`: cards perfectly still, hand goes around them.
        hands: {
          right: [
            // DOWN first, out from under the deck, and only then sideways -
            // sliding straight out to the side drags the whole cradle through
            // the stack it is carrying (measured 0.15 through the thumb).
            { at: 0.22, pose: catchPose, anchor: cradleAt(DX, DY - CARD_H * 0.7, DZ) },
            { at: 0.44, pose: catchPose, anchor: cradleAt(SIDE_X, DY - CARD_H * 0.7, DZ) },
            { at: 0.72, pose: STACK_GRIP.pose, anchor: RETAKE, ease: 'easeInOutCubic' },
            // …and close IN to the grip along the stack's own top plane, so the
            // four pads arrive tangent and the thumb meets the far edge
            // head-on. This frame is the `lower` hold's capture.
            { at: 1, pose: STACK_GRIP.pose, anchor: STACK_GRIP.anchor, ease: 'easeOutCubic' },
          ],
        },
      },
      {
        kind: 'move',
        id: 'lower',
        label: 'Lower the cut deck toward the table',
        duration: 1200,
        ease: 'easeInOutCubic',
        reorder: () => cutOrder,
        to: (dk) => stackLayout(dk, HOVER_Y).map((p) => ({ ...p, pos: p.pos.clone().setZ(DZ) })),
        camera: 'overview',
        grip: { right: { cards: 'all', frame: 'packet', pressure: [{ at: 0, v: GRIP_PRESSURE }, { at: 1, v: GRIP_PRESSURE }] } },
        hands: {
          right: [{ at: 1, pose: STACK_GRIP.pose, anchor: HOVER }],
        },
      },
      {
        kind: 'move',
        id: 'set-down',
        label: 'Set it down and let go',
        duration: 1000,
        // easeInCubic: the stack barely moves for the first third of the beat,
        // which is exactly the window the supporting hand needs to leave. It
        // goes out along +x, back along its own fingers, the only direction
        // that pulls the whole hand out of the stack's footprint at once, then
        // rises clear before crossing the table.
        to: (dk) => stackLayout(dk),
        hands: {
          right: [
            { at: 0, pose: STACK_GRIP.pose, anchor: HOVER },
            { at: 0.36, pose: STACK_GRIP.pose, anchor: [HOVER[0] + CARD_W * 1.6, HOVER[1], HOVER[2]], ease: 'easeOutCubic' },
            { at: 1, pose: 'deckApproach', anchor: overWrist(CARD_W * 1.9, TABLE_TOP, -CARD_H * 0.15), ease: 'easeInOutCubic' },
          ],
        },
      },
      {
        kind: 'hold',
        id: 'rest',
        label: 'Cut complete — bottom half is now on top',
        duration: 800,
        // The closing beat RESTS on the deck rather than floating beside it.
        hands: {
          right: [
            {
              at: 0.7,
              pose: 'deckRest',
              anchor: restWrist(0, TABLE_TOP, 0),
              ease: 'easeOutCubic',
              fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tighten', amp: 0.04 }],
            },
          ],
        },
      },
    ]
  },
}
