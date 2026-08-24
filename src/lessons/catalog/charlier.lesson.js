import * as THREE from 'three'
import { stackLayout, faceQuat } from '../engine/layouts'
import {
  packetGrip,
  poseWithContacts,
  rotateGripRigid,
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
  randomizes: 'None',
  seed: 14,
  // NOT `handCut`: that preset sits 3.7 from its target with a 32° fov, i.e. a
  // half-height of 1.05, it was framed for a hand a third of this size, and at
  // HAND_SCALE 13 the palm alone overflows it and the cut runs off the top of
  // the frame. `dealerPOV` is 6.4 out with a half-height of 2.2, which holds the
  // whole hand AND the table deck it starts from.
  cameraPreset: 'handCut',
  summary:
    'A one-handed cut, not a shuffle: the thumb drops the bottom half into the palm, the index finger pivots it up and over the top. Deterministic — it only cuts.',
  facts: [
    'The Charlier is a flourish cut, not a randomizer — the deck ends in a known half-and-half swap.',
    'It is a gateway move in cardistry: one hand, one fluid pivot, all in the fingers.',
  ],
  build: (deck) => {
    const N = deck.length
    const mid = Math.floor(N / 2)
    // THE CUT, AS A FUNCTION OF THE DECK AT THAT MOMENT. This was a constant built
    // from the pristine array, which was safe only while nothing reordered the deck
    // before the cut - and `flip` now reverses it (turning a deck over swaps its top
    // and bottom). A captured constant would hand `finalDeck` a permutation that no
    // longer matches the cards on the table, and `finalDeck` is what the visualizer
    // and the mixing dock's write-back read.
    const cutOrder = (dk) => [...dk.slice(mid), ...dk.slice(0, mid)]
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
    // HOW FAR THE PACKET FALLS from the apex onto the top half, and it is SWEPT,
    // because it trades two failures against each other. Too short and the packet
    // is still rotating out of its on-edge attitude when it arrives, so it passes
    // through the half it is landing on; too long and the landing spot (derived
    // below as APEX minus this) sinks onto the fingers holding it. Measured on the
    // compiled track - penetration / cards pierced / worst clip / clipping pairs:
    //
    //   0.04W   0.0037  0   0.0344  123   <- was this: clipping, over budget
    //   0.08W   0.0037  0   0.0319   56
    //   0.10W   0.0037  0   0.0237   12
    //   0.12W   0.0037  0   0.0236    5
    //   0.16W   0.0037  0   0.0000    0
    //   0.17W   0.0749  0   0.0000    0   <- a HOLE, see below
    //   0.18W   0.0037  0   0.0000    0
    //   0.19W   0.0037  0   0.0000    0
    //   0.20W   0.0037  0   0.0000    0   <- this
    //   0.21W   0.0037  0   0.0000    0
    //   0.22W   0.0758  1   0.0000    0   <- another hole
    //   0.23W   0.0037  0   0.0000    0
    //
    // THIS PARAMETER IS NOT SMOOTH, and that is worth knowing before anyone
    // "optimises" it. 0.17 and 0.22 are isolated failures with clean neighbours on
    // both sides: the carriers are placed by a Gauss-Newton solve against the stack
    // at STACK_Y, and moving that target a hundredth can drop the solve into a
    // different basin - a ring finger that folds under the stack instead of beside
    // it (0.075, 25 card thicknesses). So this is NOT chosen as the middle of a
    // window (0.17 IS the middle of 0.16..0.18 and it is the worst value in the
    // table); it is chosen as a measured value with measured neighbours.
    const FALL = CARD_W * 0.2
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
    // The same cradle with NO thumb contact: the four fingers under the cards and
    // the thumb still free. This is what the hand arrives in out of the flip, so
    // the thumb never has to cross the deck to get to its edge (see `to-cradle`).
    const openHandPose = cradle(C_HOLD, { card: cardAt(DY), cards: heldDeck })
    // …and the same hand with the thumb swung well clear of the cards. The flip
    // hands the deck over with `TABLE_GRIP`'s curls and the cradle wants its own,
    // and it is that CURL morph - not the wrist, which needs no rotation at all
    // (pickup and cradle are exactly 180 degrees apart about world z, which is the
    // flip) - that drives the thumb's distal through the deck: measured 0.0630
    // into K-spades 98ms into the hand-off. Passing through an opened thumb keeps
    // it outside the cards until the fingers have taken their new shape.
    const stackCard = cardAt(STACK.y, STACK.x, STACK.z)
    // The carriers reach for the landing spot from the RELEASE onward, not from
    // the pivot: moving them mid-sweep walked them straight into the half that
    // was sliding down onto them. Only the index moves during the cut.
    const openPose = cradle(C_DROP, { card: stackCard, cards: dropped })
    // THE SAME OPEN HAND, RESOLVED AGAINST THE HALF THAT LANDS ON IT. `openPose`
    // is resolved against `dropped` - the bottom half in the crook - because that
    // is all there is at the moment the fingers give way. Once the top half has
    // run down them to the landing spot there is a whole stack sitting on those
    // pads, and a hand that was never backed off it is inside it: measured 0.0759
    // of right ring through 3-clubs, one card pierced. Resolved against `settled`
    // (the full column at the landing spot, which is the tallest it ever gets) the
    // same reach target lands the pads under its bottom card instead.
    const landedPose = cradle(C_DROP, { card: stackCard, cards: settled })
    // THE HAND OPENS BEFORE IT REACHES OUT, and the two have to be separate poses.
    //
    // `release` used to end at `openPose`, whose carriers are already extended to
    // the LANDING SPOT - so the ring finger swept from under the deck column all
    // the way out there while the top half was still sitting at the column, and
    // went straight through it: 0.0479 into A-hearts. The fix is to let the index
    // give way (which is the whole beat - it is what the bottom half drops onto)
    // while the three carriers stay put UNDER the top half, and only reach out on
    // the next beat, with the half riding them.
    //
    // The top half settles onto those carriers as the bottom half leaves, which is
    // a fall of one half-deck. It is also the honest reading of the move: take the
    // bottom half away and what was above it comes down onto your fingers.
    const topAtColumn = [...stackOf(deckBase, N - mid), cardAt(DY - SHIELD)]
    const crookPose = cradle(C_DROP, { card: cardAt(DY), cards: topAtColumn })
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
    // WHERE THE BOTTOM HALF LANDS IS MEASURED OFF THE INDEX PAD, not authored.
    // `PALM` is derived from the wrist anchor plus a fixed PAD_DROP, and the comment
    // on the `release` beat claimed the half therefore "lands exactly on the pad's new
    // position, which is what makes the next step's capture a seated one". Measured,
    // that was false by 0.285 - the half landed 0.22 above the pad and 0.19 toward +z
    // of it. Since `indexPivot` rides the index tip and the hold captures whatever
    // offset exists at its first frame, the packet then tracked the finger rigidly at
    // that distance for the entire pivot. It is why the pivot measured 0% contact with
    // a median gap of 0.517 while the beats either side of it sat at 80% and 0.012.
    //
    // Taking the pad position from the pose actually on screen at that instant -
    // `openPose` at anchor W - fixes the z error: the half now lands at the pad's z
    // instead of 0.19 in front of it, and the index's distance to it falls 0.285 ->
    // 0.218.
    //
    // THE REMAINING 0.218 IS CORRECT AND MUST NOT BE "FIXED". It is SEAT, the existing
    // correction for the index's crest, and it is 0.22 because a curled finger's middle
    // phalange rises that far above its own pad - a card resting at bare pad height is
    // impaled on it. Seating on tip tangency instead was measured: pivot contact does
    // rise 0% -> 50%, and the card is driven 0.0907 into the index's middle phalange
    // with the lesson's first ever pierced card. So the packet genuinely rests on the
    // FINGER, not on the fingertip.
    //
    // Which means most of the pivot's 0% was never a lesson defect at all: the contact
    // metric measures FINGERTIPS, and a correctly seated card here is a crest-height
    // away from the tip by necessity. Two things follow, neither of them fixable in this
    // file:
    //   * contact should measure the nearest point on the whole finger, not the tip,
    //     for frames whose cards ride a curled phalange.
    //   * `indexPivot` declared `pressure: { index: 1, middle: 0.4 }`, and the middle
    //     fingertip measures 0.88-0.94 from the packet throughout the pivot - it sits at
    //     x 0.75 while the cards are at x -0.15, supporting the OTHER half. Scoring a
    //     finger a world unit away as a holder pinned this beat's median gap near 0.5.
    //     Fixed in `handKinematics`: median 0.518 -> 0.142, lesson contact 69% -> 74%.
    //
    // AND THE BEAT STILL READS 0%, WHICH IS THE METRIC BEING INAPPLICABLE RATHER THAN
    // THE POSE BEING WRONG. Measured against every phalange capsule and not just the
    // tip, the pivot is still 0% at the same 0.142 - the packet floats clear of the
    // WHOLE finger. That is deliberate and documented a hundred lines above: SEAT is
    // taken at the DEEPEST curl the cut uses, because the packet is welded at one height
    // for the whole ride, so it has to fit the worst curl or the finger grows into it
    // mid-sweep. The clearance is what stops the sweeping pad touching the half it is
    // cutting away from.
    //
    // So a welded-packet-on-a-moving-finger grip cannot score contact: it rides at a
    // clearance sized for a curl it is not currently at. The honest fix is not a
    // tolerance, it is for `indexPivot` to ride the finger's CREST rather than its TIP,
    // which would let the packet stay in contact through the whole sweep and need no
    // clearance at all. That is a grip-frame redesign, not a lesson edit, and it is also
    // the thing that would make the packet stop looking detached on screen - 0.142 is
    // 14mm of visible air.
    const _pad = new THREE.Vector3()
    const indexPadOf = (pose) => {
      const solved = poseWithContacts(cloneHandPose(pose), 'right', { anchor: W, quat: CRADLE_QUAT }, {})
      fingertipWorld(solved, 'right', 'index', _pad)
      return _pad.clone()
    }
    const DROP_PAD = indexPadOf(openPose)
    const dropBottom = (dk) =>
      dk.slice(0, mid).map((c, i) => ({
        id: c.id,
        pos: new THREE.Vector3(
          DROP_PAD.x,
          DROP_PAD.y + SEAT + CARD_T / 2 + i * CARD_GAP,
          DROP_PAD.z,
        ),
        quat: faceQuat(c.isFaceUp),
        bend: 0,
      }))
    // The top half ALONE, settled onto the carriers where the deck was - one
    // half-deck lower, because the half it was resting on has just left.
    const settleTop = (dk) =>
      dk.slice(mid).map((c, i) => ({
        id: c.id,
        pos: new THREE.Vector3(DX, DY + i * CARD_GAP, DZ),
        quat: faceQuat(c.isFaceUp),
        bend: 0,
      }))
    // The top half ALONE, at the landing spot. Only the cards named here move:
    // `compileLesson` holds every card not in a step's destination array, so the
    // bottom half stays in the crook the release dropped it into.
    const layTop = (dk) =>
      dk.slice(mid).map((c, i) => ({
        id: c.id,
        pos: new THREE.Vector3(STACK.x, STACK.y + i * CARD_GAP, STACK.z),
        quat: faceQuat(c.isFaceUp),
        bend: 0,
      }))
    // The finished cut where it already sits, taking each card's face from the
    // deck - so it reads face-up before the unflip and face-down after it.
    const cutStackAt = (dk) =>
      dk.map((c, i) => ({
        id: c.id,
        pos: new THREE.Vector3(STACK.x, STACK.y + i * CARD_GAP, STACK.z),
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
    const HOVER_Y = 0.02 + CARD_W * 0.35
    const NOTE_Y = DY + CARD_H * 0.75
    // The two decks this hand ever carries, and the stations each is carried to.
    const TABLE_GRIP = deckGrip(0, 0.02, 0) // the squared deck on the felt
    const STACK_GRIP = deckGrip(STACK.x, STACK.y, STACK.z) // the finished cut
    const LIFTED = gripAt(TABLE_GRIP, DX, DY - 0.02, DZ) // …up at working height
    // ---- THE FLIP -----------------------------------------------------------
    // THE HAND TURNS THE WHOLE DECK OVER WITHOUT LETTING GO OF IT, and that is
    // what replaced this lesson's worst frame.
    //
    // One hand has to do two incompatible things: LIFT the deck off the felt,
    // which is only possible from ABOVE (a grip that wraps needs room under the
    // bottom card and on the felt there is none), and then HOLD it from BELOW to
    // cut it. The old `turn` beat got between those by letting go: the hand slid
    // out of the deck's column, travelled 1.7 out to the side, turned palm-up out
    // there and came back in underneath - leaving the deck completely alone in
    // mid-air, at working height, with the hand at the edge of frame. Measured off
    // the compiled track it was the single worst frame in the lesson, and it is
    // the one that got this lesson a second hand.
    //
    // A RIGID ROTATION does the same job with the deck still in the hand the whole
    // way: `rotateGripRigid` turns hand and cards together about one axis, so the
    // captured card->frame offsets stay exact and no pad ever moves relative to a
    // card it is holding. Measured on this rotation: zero penetration at every
    // sample, and the lowest surface the sweep reaches is y 0.171 - the arc clears
    // the felt with room to spare, which is the one thing that could have killed it.
    //
    // ABOUT THE DECK'S LONG AXIS (world z), and the choice is measured. The long
    // axis lands the hand 0.34 from the cradle station it has to hand off to; the
    // short axis lands it 0.91 away, and that transfer is the one beat where the
    // hand is changing its relationship to the cards, so shorter is strictly
    // better. The cost is that a long-axis flip leaves the deck rotated 180 degrees
    // IN PLANE from `faceQuat(true)` - and that is invisible, because a card is a
    // rectangle (identical footprint either way) and a playing card's face is
    // designed to read upside down. So every layout below can go on using
    // `faceQuat`, and no contact changes side: both faceQuat(false) and
    // faceQuat(true) map the card's local +x to world +x, so the thumb's near edge
    // is the same edge before and after.
    // How far below its station the hand takes its cradle shape before rising
    // into the cards. Hand-sized, because what has to clear is a hand.
    const CLEAR_UNDER = DECK_REST_DROP * 0.3
    const FLIP_AXIS = new THREE.Vector3(0, 0, 1)
    const FLIP_Q = new THREE.Quaternion().setFromAxisAngle(FLIP_AXIS, Math.PI)
    const FLIP_PIVOT = [DX, DY + DECK_H / 2, DZ]
    const FLIPPED = rotateGripRigid({ pose: TABLE_GRIP.pose, anchor: LIFTED }, FLIP_Q, FLIP_PIVOT)
    // A mid-flip rung so the turn reads as a roll rather than a slerp: the same
    // rigid transform at 90 degrees, which is where the deck is standing on edge.
    const FLIP_HALF = rotateGripRigid(
      { pose: TABLE_GRIP.pose, anchor: LIFTED },
      new THREE.Quaternion().setFromAxisAngle(FLIP_AXIS, Math.PI / 2),
      FLIP_PIVOT,
    )
    // THE FLIP'S OWN HAND WITH ITS THUMB SWUNG OFF THE EDGE, in place, before
    // anything translates. `TABLE_GRIP`'s thumb is braced on the deck's long edge,
    // and after the flip that edge is above it - so uncurling the thumb on the way
    // to the cradle swings it INTO the deck's underside (0.0199 into 4-clubs, 49ms
    // in). Abducting it instead (`thumbOpp.z`, the same lever `cradle`'s own open
    // thumb uses) takes it off the edge sideways, where there is nothing.
    // AND THE MIRROR OF IT, on the finished cut where it now sits. Turning a deck
    // over reverses it, so a lesson that flips ONCE hands back a deck in the
    // opposite order - and `mixing.js` reads the deck order by HEIGHT, so the dock
    // scored this display cut as 51 rising sequences of a possible 26, i.e. more
    // scrambled than random, for a technique whose whole claim is that it does not
    // mix at all. Flipping back makes the net order a pure cut (2 rising sequences,
    // which is what a cut is) and leaves the deck face-down the way it was found.
    // It also retires `handover`, the one beat left in this lesson where the cards
    // sat still while the hand travelled around them.
    const UNFLIP_PIVOT = [STACK.x, STACK.y + DECK_H / 2, STACK.z]
    const STACK_FLIPPED = rotateGripRigid(STACK_GRIP, FLIP_Q, UNFLIP_PIVOT)
    const STACK_HALF = rotateGripRigid(
      STACK_GRIP,
      new THREE.Quaternion().setFromAxisAngle(FLIP_AXIS, -Math.PI / 2),
      UNFLIP_PIVOT,
    )
    const stackThumbOut = {
      ...STACK_FLIPPED.pose,
      fingers: { ...STACK_FLIPPED.pose.fingers },
      thumbOpp: { ...(STACK_FLIPPED.pose.thumbOpp ?? {}), z: (STACK_FLIPPED.pose.thumbOpp?.z ?? 0) - 0.9 },
    }
    const flipThumbOut = {
      ...FLIPPED.pose,
      fingers: { ...FLIPPED.pose.fingers },
      thumbOpp: { ...(FLIPPED.pose.thumbOpp ?? {}), z: (FLIPPED.pose.thumbOpp?.z ?? 0) - 0.9 },
    }
    const ASIDE = gripAt(TABLE_GRIP, SIDE_X, DY - 0.02, DZ) // …and out of its column
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
        kind: 'move',
        id: 'flip',
        label: 'Turn the whole deck over in the hand',
        duration: 1100,
        camera: 'handCut',
        ease: 'easeInOutCubic',
        // Nominal: while it is gripped the deck goes exactly where the hand goes.
        // Stated anyway so the beat declares its own end state, and stated as
        // FACE UP because that is what turning it over means - which is also the
        // point of the beat, since a face-up deck is one you can read while it is
        // being cut.
        to: (dk) => raised(dk),
        // TURNING A DECK OVER REVERSES IT, and this is the whole of that fact.
        // The card that was on top is now on the bottom, so the array - which
        // every layout in this file reads as "index 0 is the lowest card" - has to
        // be reversed here or the geometry and the bookkeeping disagree by a full
        // inversion. Measured when it was missing: a 0.157 positional jump (one
        // whole DECK_H) at this step's boundary as 52 cards snapped from where the
        // grip had actually left them to where `raised` said they were, and 1326
        // top-card swaps in that single frame - exactly C(52,2), i.e. every pair
        // in the deck inverting at once, which is the signature of this bug and
        // not of anything physical.
        reorder: (dk) => [...dk].reverse().map((c) => (c.isFaceUp ? c : { ...c, isFaceUp: true })),
        grip: { right: { cards: 'all', frame: 'packet', pressure: [{ at: 0, v: GRIP_PRESSURE }, { at: 1, v: GRIP_PRESSURE }] } },
        hands: {
          right: [
            { at: 0, pose: TABLE_GRIP.pose, anchor: LIFTED },
            { at: 0.5, pose: FLIP_HALF.pose, anchor: FLIP_HALF.anchor, ease: 'easeInOutCubic' },
            { at: 1, pose: FLIPPED.pose, anchor: FLIPPED.anchor, ease: 'easeInOutCubic' },
          ],
        },
        annotations: [
          { text: 'The hand rolls the deck over — face up, so you can see the cut', at: [0, NOTE_Y, 0.6], appearAt: 0.4 },
        ],
      },
      {
        kind: 'hold',
        id: 'to-cradle',
        label: 'Settle it into the cutting grip',
        duration: 520,
        // The one beat where the hand changes its relationship to the cards: it
        // arrives from the flip holding the deck on its pads and closes into the
        // cradle that will cut it. The DECK DOES NOT MOVE (this is a `hold`), and
        // the two stations are only 0.34 apart, so the pads stay under the cards
        // the whole way - which is the difference between this and the beat it
        // replaced, where the hand travelled 1.7 with nothing under the deck.
        // THE THUMB ARRIVES LAST, and that is a measured fix rather than a
        // flourish. `TABLE_GRIP`'s thumb holds the deck's FAR long edge and the
        // cradle's holds its NEAR one, so interpolating straight between the two
        // poses walks the thumb across the deck at the deck's own height - measured
        // 0.0561 into K-spades, twelve times the budget. `openHandPose` is the same
        // cradle with no thumb contact at all, so the hand closes its four fingers
        // under the cards first and the thumb only comes up onto the near edge in
        // `settle-grip`, from below and outside, where there is nothing in its way.
        // AND IT COMES UP FROM UNDERNEATH. Interpolating straight from the flip's
        // pose to the cradle's swings the whole hand through the deck's own height
        // - the thumb was measured 0.0616 into 9-clubs, twelve times the budget.
        // Taking the cradle's SHAPE first, a hand's depth below the cards, and
        // only then rising into contact keeps every capsule under the deck for the
        // whole move: the hand is never beside the cards, only below them.
        hands: {
          right: [
            { at: 0, pose: FLIPPED.pose, anchor: FLIPPED.anchor },
            // Thumb off the edge FIRST, without the hand moving at all.
            { at: 0.3, pose: flipThumbOut, anchor: FLIPPED.anchor, ease: 'easeOutCubic' },
            // …then travel, still with the thumb out and a hand's depth low.
            { at: 0.72, pose: flipThumbOut, anchor: [W[0], W[1] - CLEAR_UNDER, W[2]], ease: 'easeInOutCubic' },
            // …and only now take the cradle's shape and rise into the cards.
            { at: 1, pose: openHandPose, anchor: W, ease: 'easeOutCubic' },
          ],
        },
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
        // GRAVITY EASES IN, and getting this wrong put the index THROUGH the card.
        // This was `snapEase`, which commits 88% of the travel by t=0.35 - so the
        // half arrived at its C_DROP height while the fingers were still up near
        // C_HOLD, and the index's distal was left occupying space the card had
        // already reached: measured 0.0242 into A-hearts' face. It is the same
        // collision `pivot` documents ("run on one curve they meet in the middle
        // and the finger goes through the packet") and it wants the same
        // treatment. A dropped half also genuinely ACCELERATES, so `easeInCubic`
        // is both the fix and the honest curve.
        ease: 'easeInCubic',
        to: (dk) => [...dropBottom(dk), ...settleTop(dk)],
        // No grip: this beat IS gravity. The fingers give way (C_HOLD → C_DROP)
        // and the half lands exactly on the pad's new position, which is what
        // makes the next step's capture a seated one.
        hands: {
          right: [
            // Thumb off the edge FIRST, fingers still holding station, so the
            // thumb is not still braced on the near long edge while the half is
            // already sliding past it.
            { at: 0.2, pose: openHandPose, anchor: W, ease: 'easeOutCubic' },
            { at: 1, pose: crookPose, anchor: W, ease: 'easeOutCubic' },
          ],
        },
        annotations: [
          { text: 'Let gravity do it — the thumb just lets go', at: [0, NOTE_Y, 0.6], appearAt: 0.25 },
        ],
      },
      {
        // THE TOP HALF TRAVELS ON ITS OWN BEAT, and that one change is what makes
        // this cut one-handed.
        //
        // It always had to travel: the cut happens in the palm, 0.29 BELOW where
        // the deck is held (the index's carry arc peaks 0.248 under the top of the
        // held deck, measured), and it has to land clear of that arc or the sweep
        // goes through it - `INDEX_FRONT` is not about the landing burying the
        // finger, it is about the finger's PATH. Swept every offset from under the
        // deck column outward: 0.066 deep at 0.15 and 0.30, 0.057 at 0.45, and only
        // clean again at 0.60. So the landing stays out at the fingertips.
        //
        // What was wrong was doing it DURING the pivot. The half slid out while the
        // index swept up through the same volume, and the two met: 0.0522 of right
        // ring straight through A-hearts, which is the penetration the one-handed
        // version of this lesson always had. Given its own beat the two motions are
        // separated in time - the same rule `release`, `pivot` and `fall` are each
        // already built on - and the sweep is left alone with the one thing it was
        // ever about.
        //
        // AND IT SLIDES DOWN THE FINGERS THAT ARE ALREADY UNDER IT. `openPose`
        // reaches the three carriers out to the landing spot back at `release`, so
        // they are extended along the whole path before the half starts moving: the
        // half runs down them to the fingertips rather than crossing open air. That
        // is what a second hand was added to do, and the fingers were doing it
        // anyway.
        kind: 'move',
        id: 'slide',
        label: 'The top half slides down the fingers',
        duration: 620,
        ease: 'easeInOutCubic',
        to: (dk) => layTop(dk),
        hands: {
          right: [
            { at: 0, pose: crookPose, anchor: W },
            { at: 1, pose: landedPose, anchor: W, ease: 'easeOutCubic' },
          ],
        },
        annotations: [
          { text: 'The open fingers carry the top half out — nothing else is holding it', at: [0, NOTE_Y, 0.6], appearAt: 0.35 },
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
        //
        // TURN FIRST, THEN COME DOWN - a card-clipping fix worth 32x. Both curves
        // used to be `snapEase`, so the packet rotated from on-edge to flat WHILE
        // descending onto the top half and passed through it at every angle in
        // between: 2154 clipping pair-frames, up to 22.6 CARD THICKNESSES deep.
        // There is no BEND involved here, unlike the wash's and the riffle's
        // clipping - this one is pure rotation. Splitting them (`quatEase` in
        // sampleTrack) lets the packet snap LEVEL early while `easeInCubic` keeps
        // it high, so it is already parallel to the stack before it arrives.
        // Same rule as "a hand and a card must not arrive together".
        ease: 'easeInCubic',
        quatEase: 'snapEase',
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
        id: 'from-cradle',
        label: 'Take hold of it to turn it back',
        duration: 520,
        // The exact mirror of `to-cradle`: the hand stays UNDER the cards and
        // changes shape, thumb swung clear, so nothing has to travel around the
        // stack it is carrying. `handover` used to do that travel - down, out to
        // the side, up and back in over the top - with the finished deck sitting
        // motionless in mid-air for half a second, which was this lesson's second
        // hover and its worst penetration (0.0162, the closing thumb).
        hands: {
          right: [
            { at: 0, pose: catchPose, anchor: W },
            // Thumb off the near edge FIRST, in place - the same routing
            // `to-cradle` needs, for the same reason.
            { at: 0.25, pose: openEndPose, anchor: W, ease: 'easeOutCubic' },
            { at: 0.62, pose: stackThumbOut, anchor: [STACK_FLIPPED.anchor[0], STACK_FLIPPED.anchor[1] - CLEAR_UNDER, STACK_FLIPPED.anchor[2]], ease: 'easeInOutCubic' },
            // ARRIVES WITH THE THUMB STILL CLEAR. `STACK_GRIP` carries a
            // deliberate thumb graze (`THUMB_GRAZE`) resolved against the column
            // BELOW the stack, and the flip puts that column ABOVE the hand - so
            // the same pose grazes from underneath instead: 0.0073, against a
            // 0.0045 budget, and dropping the whole hand does not help because the
            // intrusion is lateral, at the stack's edge. Holding the thumb out for
            // the whole approach removes it outright. It closes at this beat's
            // boundary, where `unflip`'s grip captures - so the deck is not yet
            // riding the hand when the thumb arrives, and nothing snaps.
            { at: 1, pose: stackThumbOut, anchor: STACK_FLIPPED.anchor, ease: 'easeOutCubic' },
          ],
        },
      },
      {
        kind: 'move',
        id: 'unflip',
        label: 'Roll it back face-down',
        duration: 1000,
        ease: 'easeInOutCubic',
        to: (dk) => cutStackAt(dk),
        // Reverses the array again, and clears the faces, so the deck goes back
        // exactly as it came: the two flips cancel and what is left is the cut.
        reorder: (dk) => [...dk].reverse().map((c) => (c.isFaceUp ? { ...c, isFaceUp: false } : c)),
        grip: { right: { cards: 'all', frame: 'packet', pressure: [{ at: 0, v: GRIP_PRESSURE }, { at: 1, v: GRIP_PRESSURE }] } },
        hands: {
          right: [
            { at: 0, pose: STACK_FLIPPED.pose, anchor: STACK_FLIPPED.anchor },
            { at: 0.5, pose: STACK_HALF.pose, anchor: STACK_HALF.anchor, ease: 'easeInOutCubic' },
            { at: 1, pose: STACK_GRIP.pose, anchor: STACK_GRIP.anchor, ease: 'easeInOutCubic' },
          ],
        },
        annotations: [
          { text: 'Rolled back over — the two turns cancel, so all that is left is the cut', at: [0, NOTE_Y, 0.6], appearAt: 0.45 },
        ],
      },
      {
        kind: 'move',
        id: 'lower',
        label: 'Lower the cut deck toward the table',
        duration: 1200,
        ease: 'easeInOutCubic',
        reorder: (dk) => cutOrder(dk),
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
