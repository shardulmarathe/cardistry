import * as THREE from 'three'
import { getHandPose, cloneHandPose } from '../../hands/handPoses'
import {
  applyGripPressure,
  contactFrame,
  fingerJointsWorld,
  fingertipWorld,
  solveFingerTo,
  solveThumbTo,
  GRIP_FRAME_TYPES,
} from '../../hands/handKinematics'
import { FINGERS, FINGER_NAMES, HAND_SCALE } from '../../hands/handRigSpec'
import { CARD_W, CARD_H, CARD_T, CARD_GAP } from '../../lib/constants'

// Compile-time contact authoring: place fingers ON the cards instead of
// guessing joint angles. These run inside a lesson's build() against the real
// layout geometry, so poses stay correct when a layout constant changes.
// Everything is deterministic (fixed-iteration solvers), the compiled track
// is still a pure function of the lesson source.
//
// Conventions: targets and anchors are authored in RIGHT-hand world coords;
// pass side:'left' and both are x-mirrored to match the engine's anchor rule.
//
// FINGERS HAVE THICKNESS. The IK solves a fingertip's CENTER onto its target,
// so a target authored ON a card plane buries the whole capsule by its own
// radius (`FINGERS[name].rad[i] * HAND_SCALE`, up to 0.078 world units at the
// thumb, deeper than a squared deck). Author contacts through `surfaceContact`,
// which offsets the target off the face by the finger's radius, and clean up
// the joints the tip can't protect with `resolvePenetration`.

export function eulerQuat(x, y = 0, z = 0) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z))
}

// --- Radius-aware contact targets --------------------------------------------
// Card local frame: X = width (CARD_W), Y = long axis (CARD_H), Z = face normal
// (CARD_T). A face is named by its outward local axis: '+z' is the printed
// front, '-z' the back (the side facing UP for a face-down card on the felt),
// '±y' the short END faces, '±x' the long EDGE faces.
const HALF_EXTENT = { x: CARD_W / 2, y: CARD_H / 2, z: CARD_T / 2 }
// The two surface axes of each face, in x,y,z order: u first, then v.
const FACE_UV = { x: ['y', 'z'], y: ['x', 'z'], z: ['x', 'y'] }
const FACE_ALIAS = { front: '+z', back: '-z' }

const _surf = new THREE.Vector3()
const _cardPos = new THREE.Vector3()
const cardPosOf = (card) =>
  Array.isArray(card.pos) ? _cardPos.set(card.pos[0], card.pos[1], card.pos[2]) : card.pos

// Where a fingertip's CENTER must sit for the finger's SURFACE to rest tangent
// on a card face: the point on the face, pushed out along its normal by
// CARD_T/2 (or the relevant half-extent) plus the finger's own radius.
//
//   card  { pos, quat }  pos: THREE.Vector3 | [x,y,z]; quat: THREE.Quaternion
//   spec:
//     finger     'thumb'|'index'|'middle'|'ring'|'pinky'   (radius source)
//     face       '+z'|'-z'|'+x'|'-x'|'+y'|'-y' ('front'='+z', 'back'='-z');
//                default '-z', the up-facing side of a face-down card
//     u, v       -1..1 normalized coords ON that face (0,0 = face center);
//                they index the two remaining local axes in x,y,z order, each
//                normalized to its own half-extent
//     clearance  extra world units beyond tangency (default 0)
//     radius     override the finger radius (default distal, rad[2]*HAND_SCALE)
//     out        optional THREE.Vector3 to write into
//
// Returns a world point in RIGHT-hand coords, feed it straight to
// poseWithContacts, which mirrors it for side:'left' like any other target.
export function surfaceContact(
  card,
  { finger, face = '-z', u = 0, v = 0, clearance = 0, radius, out } = {},
) {
  const f = FACE_ALIAS[face] ?? face
  const axis = f[f.length - 1]
  const sign = f[0] === '-' ? -1 : 1
  const r = radius ?? FINGERS[finger].rad[2] * HAND_SCALE
  const [ua, va] = FACE_UV[axis]
  _surf.set(0, 0, 0)
  _surf[axis] = sign * (HALF_EXTENT[axis] + r + clearance)
  _surf[ua] += u * HALF_EXTENT[ua]
  _surf[va] += v * HALF_EXTENT[va]
  const o = out ?? new THREE.Vector3()
  return o.copy(_surf).applyQuaternion(card.quat).add(cardPosOf(card))
}

const _target = new THREE.Vector3()

// Resolve a base pose (preset name or pose object), optionally re-anchor and
// re-orient the wrist, then IK-solve each listed fingertip onto its target.
// contacts: { thumb: <target>, index: <target>, ... } (right-hand coords),
// where a target is EITHER
//   [x, y, z]                                    a raw world point, or
//   THREE.Vector3                                (e.g. a surfaceContact result)
//   { card, face?, u?, v?, clearance?, radius? } resolved via surfaceContact
//                                                for THAT finger's radius.
// Pass `cards` (world card poses for this side) to run resolvePenetration on
// the solved pose in the same call.
export function poseWithContacts(base, side, { anchor, quat, cards, clearance, splay = false } = {}, contacts = {}) {
  const pose = typeof base === 'string' ? getHandPose(base, side, anchor) : cloneHandPose(base)
  if (typeof base !== 'string' && anchor) {
    pose.wrist.pos.set(anchor[0], anchor[1], anchor[2])
    if (side === 'left') pose.wrist.pos.x *= -1
  }
  if (quat) pose.wrist.quat.copy(quat)
  for (const name of Object.keys(contacts)) {
    const c = contacts[name]
    if (Array.isArray(c)) _target.set(c[0], c[1], c[2])
    else if (c.isVector3) _target.copy(c)
    else surfaceContact(c.card, { finger: name, ...c, out: _target })
    if (side === 'left') _target.x = -_target.x
    if (name === 'thumb') {
      const s = solveThumbTo(pose, side, _target, { oppRange: 1.1, steps: 33 })
      pose.fingers.thumb = s.angles
      pose.thumbOpp = { ...(pose.thumbOpp ?? {}), ...s.thumbOpp }
    } else {
      // The solver picks a knuckle yaw as well as the curls (solveSplayFor);
      // it only reaches the target if that yaw is written back into the pose,
      // which is what knuckleEuler and applyHandPose read.
      const s = solveFingerTo(pose, side, name, _target, { splay })
      pose.fingers[name] = s.angles
      if (splay) pose.splay = { ...(pose.splay ?? {}), [name]: s.splay }
    }
  }
  if (cards) resolvePenetration(pose, side, cards, { clearance })
  return pose
}

// --- Post-solve penetration backoff ------------------------------------------
// Placing the TIP correctly is not enough: the deepest hits are at the PIP/MCP
// joints, whose capsules can still dip through a face the tip clears. This pass
// walks all three phalange capsules of each finger, measures the deepest
// penetration into any supplied card, and backs the finger off by scaling its
// curl angles (curl 0 = straight, positive = palmar, and JOINT_LIMITS brackets
// 0, so scaling toward 0 always lifts the finger off a surface it is pressing
// into). Fixed iteration counts, no randomness, the compiled track stays a
// pure function of the lesson source.

const HALF = [CARD_W / 2, CARD_H / 2, CARD_T / 2]
const _local = new THREE.Vector3()
const _invQ = new THREE.Quaternion()

// --- Where a card's surface actually IS --------------------------------------
// A BOWED card is not the flat rectangle every collision test in this project
// used to assume. The bend shader (cardMaterial.js) maps local (x, y, 0) to
//
//     (x,  sin(y·b)/b,  (1 − cos(y·b))/b)
//
// and that is exactly a CIRCULAR ARC: with R = 1/b, the image point minus the
// centre (Y=0, Z=R) is R·(sin θ, −cos θ) for θ = y·b, constant length R. So a
// bowed card is a cylindrical shell of radius |R| about an axis parallel to
// local X, spanning |θ| ≤ (CARD_H/2)·|b|.
//
// `assertAboveFelt` learned this once already (it was reporting the riffle
// bridge flush with the table while it sat 0.22 below it). Every finger-vs-card
// test had the same bug and nobody had noticed, because the only assertion was
// one-sided: a flat-box model of a card that is really an arc reports
// penetration where there is air and air where there is penetration, and only
// the penetration half was ever checked.
//
// Returns the three signed "how far outside" extents in the card's own frame -
// across the width, along the surface, and through the thickness, which the
// flat case (dx, dy, dz) is the b → 0 limit of.
const _ext = { x: 0, u: 0, n: 0 }
function surfaceExtents(local, bend) {
  _ext.x = Math.abs(local.x) - HALF[0]
  if (Math.abs(bend) <= 1e-4) {
    _ext.u = Math.abs(local.y) - HALF[1]
    _ext.n = Math.abs(local.z) - HALF[2]
    return _ext
  }
  const R = 1 / bend
  // Angle of `local` about the arc's centre, measured the same way as θ above.
  // On the surface local.y = R·sinθ and (R − local.z) = R·cosθ, so for R < 0
  // BOTH arguments flip sign and atan2 returns θ ± π, a point sitting exactly
  // on a SAGGING card reported up to 0.87 outside it, and `u` is what
  // cardDepth/resolvePenetration and the harness's contact metric read. Nothing
  // in the catalog bends a card the other way today, so this was latent; it
  // would have silently corrupted contact and penetration for the first lesson
  // that did. Normalise by the sign of R so θ is recovered for either bow.
  const s = Math.sign(R)
  const theta = Math.atan2(local.y * s, (R - local.z) * s)
  const halfTheta = HALF[1] * Math.abs(bend)
  // Along the surface: arc length past the card's own end (0 while inside).
  _ext.u = (Math.abs(theta) - halfTheta) * Math.abs(R)
  // Through the thickness: distance off the shell of radius |R|.
  const r = Math.hypot(local.y, local.z - R)
  _ext.n = Math.abs(r - Math.abs(R)) - HALF[2]
  return _ext
}

// Penetration depth of a sphere (p, r) into one card: 0 when clear, else how
// far the finger's surface has sunk past the nearest face. Depth 0 = exactly
// tangent, which is the goal. `card.bend` (default 0) bows it.
function cardDepth(p, r, card) {
  _local.copy(p).sub(cardPosOf(card)).applyQuaternion(_invQ.copy(card.quat).invert())
  const e = surfaceExtents(_local, card.bend ?? 0)
  if (e.x > r || e.u > r || e.n > r) return 0
  return Math.min(-e.x, -e.u, -e.n) + r
}

// Same geometry, for the verify harness (which needs the extents, not a depth).
export function cardSurfaceExtents(local, bend) {
  return surfaceExtents(local, bend)
}

const _joints = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
const _capsule = new THREE.Vector3()

// Deepest penetration of one finger's three phalange capsules into any card.
function fingerDepth(pose, side, name, cards, samples) {
  fingerJointsWorld(pose, side, name, _joints)
  const rad = FINGERS[name].rad
  let worst = 0
  for (let i = 0; i < 3; i++) {
    const r = rad[i] * HAND_SCALE
    for (let k = 0; k <= samples; k++) {
      _capsule.copy(_joints[i]).lerp(_joints[i + 1], k / samples)
      for (const card of cards) {
        const d = cardDepth(_capsule, r, card)
        if (d > worst) worst = d
      }
    }
  }
  return worst
}

// Back every listed finger off `cards` until its capsules are tangent or clear.
// Mutates and returns `pose`.
//
//   cards  [{ pos, quat }]  LITERAL world card poses for THIS `side`, unlike
//          contact targets they are NOT mirrored. A grip authored once as
//          'right' and mirrored by the engine should be resolved as 'right'
//          against the right-side cards (that is what tableGrip does).
//   opts:
//     fingers    finger names to relax (default all five)
//     clearance  TOLERANCE, not a margin (default 0): the scan STOPS at the
//                first curl whose depth is <= clearance, so a non-zero value
//                does not buy air, it buys that much PENETRATION. Always pass
//                0 and get margin from a shield card instead (an extra
//                representative card floated ~0.035 off the real stack), which
//                leaves real clearance for the runtime `pressure` squeeze (up
//                to 0.14 of extra curl) and the idle overlay.
//     min        lowest curl scale to try (default 0 = fully straight)
//     steps      coarse scan samples (default 8)
//     refine     bisection iterations (default 6)
//     samples    sample points per capsule axis (default 8 → 9 points)
export function resolvePenetration(
  pose,
  side,
  cards,
  { fingers = FINGER_NAMES, clearance = 0, min = 0, steps = 8, refine = 6, samples = 8 } = {},
) {
  if (!cards || cards.length === 0) return pose
  for (const name of fingers) {
    const base = pose.fingers[name]
    if (!base) continue
    const at = (s) => {
      pose.fingers[name] = [base[0] * s, base[1] * s, base[2] * s]
      return fingerDepth(pose, side, name, cards, samples)
    }
    // Coarse scan from the authored curl toward `min`, stopping at the first
    // scale that clears; remember the shallowest scale in case none does.
    let clearS = null
    let lastBad = 1
    let bestS = 1
    let bestD = Infinity
    for (let i = 0; i <= steps; i++) {
      const s = 1 + (min - 1) * (i / steps)
      const d = at(s)
      if (d < bestD) {
        bestD = d
        bestS = s
      }
      if (d <= clearance) {
        clearS = s
        break
      }
      lastBad = s
    }
    if (clearS === null) {
      // Nothing clears (the whole finger is inside the card), keep the
      // shallowest scale, largest first on ties.
      pose.fingers[name] = [base[0] * bestS, base[1] * bestS, base[2] * bestS]
      continue
    }
    if (clearS === 1) {
      pose.fingers[name] = base // already tangent or clear: leave it alone
      continue
    }
    // Bisect back toward the authored curl so we give up as little grip as
    // possible while staying clear.
    let lo = clearS
    let hi = lastBad
    for (let i = 0; i < refine; i++) {
      const mid = (lo + hi) / 2
      if (at(mid) <= clearance) lo = mid
      else hi = mid
    }
    pose.fingers[name] = [base[0] * lo, base[1] * lo, base[2] * lo]
  }
  return pose
}

// Translation-only inverse: where must the wrist sit so `finger`'s tip (under
// this pose's curls) lands on `target`? Returns an anchor [x,y,z] in
// right-hand coords for the lesson's `anchor:` field.
const _tip = new THREE.Vector3()
export function wristAnchorForContact(base, side, finger, target, quat = null) {
  const pose = typeof base === 'string' ? getHandPose(base, 'right') : cloneHandPose(base)
  pose.wrist.pos.set(0, 0, 0)
  if (quat) pose.wrist.quat.copy(quat)
  fingertipWorld(pose, 'right', finger, _tip)
  return [target[0] - _tip.x, target[1] - _tip.y, target[2] - _tip.z]
}

// Same idea for a CARRIED packet. A gripped packet does not ride the wrist, it
// rides the pose's contact frame (a weighted fingertip centroid, see
// GRIP_FRAME_TYPES), and `compileLesson` captures the card→frame offset at the
// grip's first frame. So the anchor that matters when a hand picks a packet up
// is the one that puts the FRAME on the cards, not the wrist near them: park
// the wrist instead and the packet flies along a metre away from the fingers
// that are supposedly holding it, which is exactly what the riffle/faro cut
// beats did once the rig grew (thumb tip 1.10 from its own packet).
const _fr = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() }
export function wristAnchorForFrame(base, frameType, target, quat = null) {
  const pose = typeof base === 'string' ? getHandPose(base, 'right') : cloneHandPose(base)
  pose.wrist.pos.set(0, 0, 0)
  if (quat) pose.wrist.quat.copy(quat)
  contactFrame(pose, 'right', frameType, _fr)
  return [target[0] - _fr.pos.x, target[1] - _fr.pos.y, target[2] - _fr.pos.z]
}

// --- Rig measurement: the only honest source of a hand-sized number ----------
// A grip needs quantities like "how far outboard of its contact does the wrist
// sit", "how high above the cards", "how wide is the finger array". Every one
// of those is a distance from the wrist to some part of the HAND, so every one
// scales linearly with HAND_SCALE, and every one of them used to be typed here
// as a world constant. That is what broke this file when the rig grew 2.83x:
// the anchors stayed put while the hand they positioned tripled, so the IK
// chased targets a metre out of reach and pinned every joint at its limit.
//
// Measure them off the rig instead, under the grip's OWN wrist quaternion (the
// same hand reaches a completely different way once it is yawed 90 degrees),
// and a scale change costs nothing. This is the trick handPoses.js already uses
// for DECK_REST_DROP / DECK_REACH, generalized so a grip builder can ask for
// any offset it needs.
//
// Returns, in WORLD axes with the wrist at the origin (right hand):
//   knuckle[name]  MCP position, the origin of that finger's reach
//   tip[name]      fingertip position under the base pose's own curls
//   drop           deepest finger SURFACE below the wrist (radius included):
//                  put the wrist this far above a plane and nothing dips in
//   span           index..pinky knuckle spread across the palm
const _rm = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
export function rigMetrics(base, quat = null) {
  const pose = typeof base === 'string' ? getHandPose(base, 'right') : cloneHandPose(base)
  pose.wrist.pos.set(0, 0, 0)
  if (quat) pose.wrist.quat.copy(quat)
  const knuckle = {}
  const tip = {}
  let drop = 0
  for (const name of FINGER_NAMES) {
    const j = fingerJointsWorld(pose, 'right', name, _rm)
    knuckle[name] = j[0].clone()
    tip[name] = j[3].clone()
    const rad = FINGERS[name].rad
    for (let k = 1; k < 4; k++) {
      drop = Math.max(drop, -j[k].y + rad[Math.min(k - 1, 2)] * HAND_SCALE)
    }
  }
  return { knuckle, tip, drop, span: knuckle.pinky.distanceTo(knuckle.index) }
}

// Breathing room a solved contact needs so the idle overlay and the ease into
// the pose cannot push a pad through a card. A bigger hand breathes bigger, so
// this is hand-sized (handPoses.js carries the same constant for the DECK_*
// drops).
//
// HALVED, from 0.003: at HAND_SCALE 11 the old value was 0.033 of permanent
// air, 5% of a card width, under EVERY pad in the catalog, on its own more
// than the 0.025 band anything could call "contact". The idle overlay's own pad
// travel is ~0.017 (IDLE_CURL_AMP 0.021 rad over a half-chain), so this still
// covers it, and the price of the rest is a graze rather than a hover. Contact
// grazes; that is what contact is.
const CONTACT_AIR = 0.0015 * HAND_SCALE

// The felt plane the engine clamps every card above (sampleTrack's FELT_Y) -
// i.e. the bottom of any column of cards a grip could be standing on.
const FELT_Y = 0.012

// --- Shared solved grips for the standard table scene ------------------------
// (52-card deck on the felt; halves at ±gap; camera dealerPOV.)
//
// SCALE NOTE, because this is what broke both grips when the rig grew 2.83x.
// A HAND_SCALE-13 hand is about two card-lengths from wrist to fingertip and
// its four knuckles span 0.87 against a 0.63-wide card, like a real hand,
// which is wider than a playing card and cannot lay all five pads on one half
// deck at once. Measured off this rig, a flat palm-down hand's thumb pad and
// middle pad sit ~1.7 apart; a half deck is 0.88 long. So the grips below do
// what a dealer's hands actually do at that ratio: the four fingers arch over
// the half and press it near ONE long edge, the pads that overhang the half
// carry on down to the felt, and the thumb comes in from the other side. Every
// wrist offset is read off the rig (rigMetrics) and every contact is a point on
// a real card surface, so the whole thing follows HAND_SCALE by itself.

// A landscape face-down card's orientation (long axis along world x, back
// facing up), the plane both shared grips rest on. `tilt` rolls it about world
// z exactly like tableRiffleLayout does. A card's yaw spins about its own face
// normal, so it never changes this plane.
function landscapeFaceQuat(tilt = 0) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, Math.PI / 2, 0, 'YXZ'))
  if (tilt) q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -tilt))
  return q
}

// Palm-down, fingers extending along +y of the hand frame.
const PALM_DOWN = Math.PI / 2
const eulerYXZ = (x, y = 0, z = 0) =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'YXZ'))

// Seed curls. ANGLES are the one hand quantity that does NOT change with
// HAND_SCALE, a closed hand is closed at any size, which is exactly why a
// grip's SHAPE is safe to author here while its POSITION never is. The contact
// IK re-solves these onto the real card surfaces; the seed only has to put each
// finger in the right basin (a hook, not a spike) and give rigMetrics a
// realistic reach to place the wrist from.
const TABLE_SEED = {
  // A hand RESTING on cards: knuckles barely bent, the fold at the PIP, thumb
  // nearly straight because the pad it has to hold is most of a thumb away.
  // Seeding the old fist-like shape instead left the middle finger's solve
  // stalled 0.4 from its target (Gauss-Newton is local; the seed is the basin).
  thumb: [0.3, 0.25, 0.18],
  index: [0.55, 1.3, 0.98],
  middle: [0.5, 1.4, 1.05],
  ring: [0.55, 1.3, 0.98],
  pinky: [0.7, 1.05, 0.79],
}
const CAGE_SEED = {
  thumb: [0.9, 0.7, 0.5],
  index: [1.35, 1.1, 0.8],
  middle: [1.4, 1.15, 0.85],
  ring: [1.35, 1.1, 0.8],
  pinky: [1.25, 1.0, 0.75],
}
function seeded(preset, curls, spread) {
  const p = getHandPose(preset, 'right')
  for (const name of FINGER_NAMES) p.fingers[name] = [...curls[name]]
  if (spread !== undefined) p.spread = spread
  return p
}

// Total length of a finger chain at world scale, how far a pad can ever get
// from its own knuckle. Used to place a wrist at a reach the hand actually has.
const chainLen = (name) =>
  (FINGERS[name].len[0] + FINGERS[name].len[1] + FINGERS[name].len[2]) * HAND_SCALE

// --- Squeeze air -------------------------------------------------------------
// A solved contact is TANGENT, and tangent is not quite where a pad can be
// left: both the runtime sampler and the compile-time grip capture add curl to
// a gripping finger AFTER the solve (handKinematics' applyGripPressure). So a
// pad is authored a little OFF its surface and the squeeze presses it home.
//
// HOW FAR off is the whole question, and the answer this file used to give, a
// fixed ANGLE times an assumed half-chain radius, was wrong twice over. It is
// worth writing both down, because between them they were the entire reason the
// hands hovered:
//
//  1. A fixed angle is not a fixed distance. `PRESSURE_CURL` is an angle, so
//     the world travel it implies scales with the rig: 0.064 at HAND_SCALE 4.6,
//     0.154 at 11. Every future scale change re-inflates it silently. MEASURE
//     the travel on the rig instead and a scale change costs nothing.
//
//  2. It reserved a full squeeze's travel for a pad that barely travels
//     relative to the thing it is holding. A gripped packet rides the hand's
//     CONTACT FRAME, a weighted fingertip centroid (GRIP_FRAME_TYPES), so
//     when the squeeze curls the fingers, THE CARDS CURL WITH THEM. What a held
//     card sees is only each pad's motion relative to that centroid, roughly
//     half the world travel; and even that is mostly normalized away, because
//     compileLesson captures the card→frame offset at the grip's first frame.
//     The true residual is the pressure VARIATION across a hold.
//
//     Measured on the riffle's `packet` grip at HAND_SCALE 11: the old formula
//     reserved 0.185 for every finger at squeeze 1.2, while the real
//     frame-relative travel is 0.070–0.086 and the pressure swing inside any
//     one hold costs under 0.02. That reservation WAS the hover, it is most of
//     why every pad in the riffle and the faro sat 0.19 off cards it was
//     supposedly gripping.
//
// So: MEASURE the frame-relative travel (squeezeTravel, below) and reserve a
// multiple of it, and for the four fingers that multiple is ZERO. A pad on a
// packet that rides the frame does not need to be authored off the surface at
// all; the capture already puts it where the squeeze will keep it. Measured
// across the catalog, going from the old formula to zero here takes the riffle
// from 0% of gripping fingertips in contact to 31% and the faro from 0% to 45%.
const SQUEEZE_RESERVE = 0

const _sqPose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() }
const _sqA = new THREE.Vector3()
const _sqB = new THREE.Vector3()
const _sqInv = new THREE.Quaternion()

// Per-finger distance each pad moves ACROSS a card riding `frameType` when the
// grip's pressure goes 0 → `squeeze`. Pure: clones before it perturbs.
export function squeezeTravel(base, side, frameType, squeeze) {
  const out = {}
  for (const name of FINGER_NAMES) out[name] = 0
  if (!squeeze || !GRIP_FRAME_TYPES[frameType]) return out
  const slack = cloneHandPose(base)
  const tight = applyGripPressure(cloneHandPose(base), frameType, squeeze)
  for (const [pose, key] of [[slack, 'a'], [tight, 'b']]) {
    contactFrame(pose, side, frameType, _sqPose)
    _sqInv.copy(_sqPose.quat).invert()
    for (const name of FINGER_NAMES) {
      const v = fingertipWorld(pose, side, name, key === 'a' ? _sqA : _sqB)
        .sub(_sqPose.pos)
        .applyQuaternion(_sqInv)
      if (key === 'a') out[name] = v.clone()
      else out[name] = out[name].distanceTo(v)
    }
  }
  return out
}

// THE THUMB IS NOT LIKE THE FOUR FINGERS and keeps a real reservation.
// Three reasons, all measured on this rig:
//   * it is the frame's dominant weight (0.5 of `packet`, 0.75 of `thumbPeel`),
//     so it is the one pad whose own motion mostly MOVES the frame instead of
//     moving across it, the capture-normalization argument above is weakest
//     exactly here;
//   * its world travel under a squeeze is 0.164 at squeeze 1.2, two to three
//     times any finger's (0.049–0.108), because applyGripPressure weights it 1.0
//     everywhere and its chain is short and fat (proximal radius 0.187);
//   * it is the joint that meets the NEIGHBOURING pile. A dealer's table grip
//     puts the thumb on the pile's inner long edge, which during the riffle's
//     and faro's `cut`/`slide` is a thumb's width from the half still sitting at
//     the table centre. Nothing about pad clearance can fix that collision, it
//     is a trajectory, but reserving here keeps it off the ceiling.
// Swept at HAND_SCALE 11 against the whole suite (riffle/faro contact% and
// worst finger-in-card): 1.2 → 30%/59%, 0.044/0.057, and it is the largest
// value at which the riffle's own thumb-near-its-packet fidelity check still
// passes, because more reservation pushes the thumb back OFF the packet.
//   1.2 → 30/59%  1.5 → 27/48%  2.0 → 31/50% (fidelity check fails at ≥1.5)
const THUMB_RESERVE = 1.2

// Clearance for one pad, given the travel table `squeezeTravel` measured for
// this grip.
const squeezeAir = (name, travel) =>
  CONTACT_AIR + (name === 'thumb' ? THUMB_RESERVE : SQUEEZE_RESERVE) * (travel?.[name] ?? 0)

// --- Dealer table / carry grip -----------------------------------------------
// Palm down over its own pile, yawed to lie ALONG it: the four knuckles arch
// across the pile's centre line and their pads come down on its NEAR long edge,
// while the thumb holds the FAR long edge from the other side. That straddle is
// the only five-point hold a HAND_SCALE-13 hand has on a 0.88 x 0.63 half, it
// is also what a dealer's hand actually does. `tilt` follows tableRiffleLayout's
// inner-end lift (pivot at the outer end) so the wrist and every pad ride the
// rising cards. The left hand is the engine's x-mirror of this pose, so it
// grips its own half the same way automatically.
//
// `cardYaw` is the world yaw of the cards this grip holds, and the hand is
// yawed WITH them. That is not a convenience: a gripped packet rides its hand's
// contact frame rigidly (grips.js), so the ONLY way a cut can lay a portrait
// stack down landscape is for the hand to turn through those 90°. Because the
// same builder produces both ends of that turn, the captured card→frame offset
// is identical at both, and the packet lands EXACTLY on the step's layout
// instead of wherever the hand happened to carry it. (Authoring the carry as a
// separate grip is what floated the riffle's halves 0.3 above the felt through
// the whole bend and weave.)
//
// Card-relative shape constants (fractions of a card. NOT hand-sized: a dealer
// holds the inner third of the pile whatever size the hand is):
const THUMB_MCP_V = 0.55 // thumb knuckle this far along the pile from its centre
const THUMB_PAD_V = 0.3 // ...and its pad this far, i.e. on the inner third
const KNUCKLE_U = 0 // the four knuckles arch over the pile's centre line...
const FINGER_PAD_U = -0.95 // ...and their pads come down on its NEAR edge
// Fraction of the thumb's own length spent on the drop from its knuckle to the
// card. Sets the wrist HEIGHT: the thumb is the SHORT chain, so it, not the
// fingers, decides how high the hand can float and still hold anything.
// (Deriving the height from a curled finger's drop instead, which is what
// handPoses' DECK_*_DROP do for a hand that only has to rest on a deck, puts
// the wrist 1.2 up, where the thumb cannot reach the cards at all.)
const THUMB_DROP = 0.82
//
// WHY THE THUMB IS ON THE FAR SIDE. With this rig a palm-down right hand whose
// thumb points along the pile has its fingers pointing at the dealer and its
// thumb knuckle 0.6 to the far side of the wrist: thumb far, fingers near. The
// opposite arrangement is not a rotation of this hand, it is its mirror, so
// asking for it, as this file used to, with a thumb target at z +0.24, just
// hands the solver a point 1.08 away from a 0.88 thumb, and it answers by
// pinning every joint at its limit and driving the tip through the felt.

const _Z = new THREE.Vector3(0, 0, 1)
// A face-down card at world yaw `cy`, rolled by `tilt` about world z exactly
// like tableRiffleLayout. cy = PI/2 is landscape (long axis on world x),
// cy = 0 is the portrait stack every lesson starts from.
function faceQuatAt(cy, tilt = 0) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, cy, 0, 'YXZ'))
  if (tilt) q.premultiply(new THREE.Quaternion().setFromAxisAngle(_Z, -tilt))
  return q
}
const _fwd = new THREE.Vector3()
const _long = new THREE.Vector3()
const _wide = new THREE.Vector3()
const _k = new THREE.Vector3()

// `baseY`/`deckH` describe the pile the hand holds: its bottom card's height and
// how far its TOP card sits above that; `gap`/`centerZ` where it sits; `yaw` its
// inward angle off landscape. Defaults match tableRiffleLayout.
export function tableGrip({
  gap = 0.5,
  centerZ = 0,
  tilt = 0,
  yaw = 0.12,
  cardYaw = Math.PI / 2 - yaw,
  baseY = 0.03,
  deckH = 25 * CARD_GAP,
  squeeze = 0,
  roll = false,
} = {}) {
  // Palm down, turned to lie along the pile.
  const quat = eulerYXZ(PALM_DOWN, cardYaw - Math.PI / 2, 0)
  // Every hand-sized offset below comes from HERE, under this grip's own
  // orientation, nothing about the wrist placement is typed by hand.
  const M = rigMetrics(seeded('twoHandsSupport', TABLE_SEED, 0.3), quat)
  // How far each pad really slides across the packet when the squeeze closes -
  // measured on this grip's own seed, not estimated from an angle.
  const travel = squeezeTravel(seeded('twoHandsSupport', TABLE_SEED, 0.3), 'right', 'packet', squeeze)
  // The pile is a STACK whose cards share one footprint and differ only in
  // height, so a representative card at height h describes every surface the
  // hand can touch there.
  const faceQ = faceQuatAt(cardYaw, tilt)
  const cardAt = (h) => ({
    pos: [
      gap + (CARD_H / 2) * (1 - Math.cos(tilt)) * 0.5,
      baseY + h + (CARD_H / 2) * Math.sin(tilt),
      centerZ,
    ],
    quat: faceQ,
  })
  const topCard = cardAt(deckH)
  const c = topCard.pos
  // World directions of the card's own axes: LONG is its long edge (local +y,
  // CARD_H), WIDE its short one (local +x, CARD_W). Everything below is stated
  // in those, so the grip is the same grip whatever the pile is turned to.
  _long.set(0, 1, 0).applyQuaternion(faceQ)
  _wide.set(1, 0, 0).applyQuaternion(faceQ)

  // Along the pile: the thumb knuckle sits a fixed fraction of it IN from the
  // centre, which puts the thumb pad on the inner third and, just as
  // important, keeps the two hands' fat thumb bases (r = 0.22 at HAND_SCALE
  // 13) off each other at the centre line.
  const alongT = -(CARD_H / 2) * THUMB_MCP_V - M.knuckle.thumb.dot(_long)
  // Across it: the four knuckles arch over the centre line so the pads travel
  // FORWARD and down onto the near edge. Parking them outside that edge instead
  // (the obvious "reach in from the side") asks every finger to hook back past
  // 90° to a point BEHIND its own knuckle, which is where this rig's
  // Gauss-Newton stalls, measured: every pad missed by 0.4 and buried itself
  // beside the deck.
  const acrossT = -(CARD_W / 2) * KNUCKLE_U - M.knuckle.middle.dot(_wide)
  const ax = c[0] + _long.x * alongT + _wide.x * acrossT
  const az = c[2] + _long.z * alongT + _wide.z * acrossT
  // The thumb holds the pile's FAR long edge, half way up the stack: '+x' in
  // card-local IS that face, and its `u` runs along the pile.
  const thumb = surfaceContact(cardAt(deckH * 0.5), {
    finger: 'thumb',
    face: '+x',
    u: -THUMB_PAD_V,
    clearance: squeezeAir('thumb', travel),
  })
  // y: a comfortable fraction of the thumb's own length above the pad it has to
  // reach, the one axis where the SHORT chain, not the long ones, is binding.
  const ay = thumb.y - M.knuckle.thumb.y + chainLen('thumb') * THUMB_DROP
  const anchor = [ax, ay, az]

  // Each finger keeps its own place along the pile (the solver bends curls only;
  // lateral demand is wasted as planeError and comes back as a pinned joint), so
  // a pad's `v` is decided by its own knuckle. A pad the pile has run out under
  // still rides the card's PLANE (|v| > 1 is a legal surfaceContact), so the
  // outer fingers trail off the end at deck height instead of stabbing at the
  // felt, the one place a 0.845-long pinky cannot reach from a knuckle 0.9
  // above it.
  const contacts = { thumb }
  for (const name of FINGER_NAMES) {
    if (name === 'thumb') continue
    _k.copy(M.knuckle[name]).add(new THREE.Vector3(ax - c[0], 0, az - c[2]))
    contacts[name] = surfaceContact(topCard, {
      finger: name,
      u: FINGER_PAD_U,
      v: _k.dot(_long) / ((CARD_H / 2) * Math.cos(tilt)),
      clearance: squeezeAir(name, travel),
    })
  }
  const pose = poseWithContacts(
    seeded('twoHandsSupport', TABLE_SEED, 0.3),
    'right',
    { anchor, quat, splay: true },
    contacts,
  )
  // Tips alone are not enough, a PIP can still sit inside the stack. Back every
  // finger off representative cards spanning the pile, so a capsule reaching in
  // UNDER the top card is caught too.
  //
  // And span the WHOLE COLUMN, from the felt up, not just this pile: a pile
  // whose `baseY` is off the table is standing on ANOTHER pile, and the thumb -
  // which holds the far edge half way up and hangs its distal capsule below
  // that pad, reaches straight into it. Nothing in this grip ever wants to go
  // UNDER the cards (the thumb takes the far edge, the four pads press the near
  // edge from above), so a solid column is both safe and the truth. This is
  // what the old, hugely over-sized squeeze air was silently paying for: with
  // the reservation measured honestly, the riffle's and faro's carry thumbs
  // went 0.10 into the half they had just cut away from.
  const column = [topCard, cardAt(deckH * 0.5), cardAt(0)]
  for (let h = -CARD_GAP * 4; baseY + h > FELT_Y; h -= CARD_GAP * 4) column.push(cardAt(h))
  resolvePenetration(pose, 'right', column)
  if (!tilt) return { pose, anchor }
  // TILT MOVES THE SOLVED HAND, it does not re-solve it, and by default it does
  // not ROTATE it either.
  //
  // Not re-solving: a gripped half rides this hand's FINGERTIP frame, so every
  // curl that differs between the flat grip and the tilted one slides the cards
  // under the pads holding them, the thumb alone moved 0.24 of curl between
  // the two, walking the whole packet 0.07 through the ring pad (measured 0.12
  // deep on the riffle's bend). Carrying the flat solve over keeps the
  // hand-to-packet relationship a constant, which is what a rigid grip means.
  //
  // Not rotating (`roll`, default off): the LEFT hand is the right rig under
  // root.scale.x < 0, and grips.js deliberately keeps its frame QUATERNION
  // unmirrored while its frame POSITION is mirrored. So a wrist roll of -tilt
  // turns the left hand +tilt on screen but turns the packet it is holding
  // -tilt, a 2*tilt error that put 0.17 of finger inside the riffle's own
  // halves through the entire bend and weave. Lift the hand with the rising
  // inner end instead; the bow supplies the read.
  const pivot = new THREE.Vector3(gap + CARD_H / 2, baseY, 0)
  const moved = new THREE.Vector3(anchor[0], anchor[1], anchor[2])
    .sub(pivot)
    .applyAxisAngle(_Z, -tilt)
    .add(pivot)
  if (roll) pose.wrist.quat.premultiply(new THREE.Quaternion().setFromAxisAngle(_Z, -tilt))
  pose.wrist.pos.copy(moved)
  return { pose, anchor: [moved.x, moved.y, moved.z] }
}

// The same grip on the squared PORTRAIT stack a lesson starts from, the carry
// hold for a cut. See the `cardYaw` note above for why this must be the SAME
// builder and not a second grip: it is what makes a carried packet land on its
// step's layout instead of wherever the hand took it.
export function packetGrip({ centerX = 0, centerZ = 0, baseY = 0.02, deckH = 0, squeeze = 0 } = {}) {
  return tableGrip({ gap: centerX, centerZ, cardYaw: 0, baseY, deckH, squeeze })
}

// --- Bridge / spring cage ----------------------------------------------------
// The same straddle, moved onto the END of the squared LANDSCAPE deck: the hand
// sits over x ≈ +CARD_H/2 with the thumb pressing the top of the arch along its
// far edge and the fingers arching across and pressing its near edge, the outer
// two trailing off the end. Cupping the END FACE instead, which is what this
// grip was authored to do, is not reachable at HAND_SCALE 13: to keep a
// wrapped finger's PIP out of the deck the wrist has to sit at x ≈ 1.33, and
// from there the thumb MCP is 1.04 from a deck it can only reach 0.88 into. So
// the hand holds the end from ABOVE, which is both reachable and what a spring
// actually looks like, the cards pour out from under the palm.
const CAGE_THUMB_MCP = 0.46 // thumb knuckle this far in from the deck's end
const CAGE_THUMB_V = 0.3 // ...and its pad this far, both as fractions of a half-deck
const CAGE_THUMB_U = 0.92 // thumb pad rides the deck's FAR edge
const CAGE_PAD_U = -0.92 // the four pads press its NEAR edge
const CAGE_DROP = 0.6 // fraction of the thumb chain spent dropping to the arch
export function cageGrip({ topY = 0.3, squeeze = 0 } = {}) {
  const quat = eulerYXZ(PALM_DOWN, 0, 0)
  const seed = seeded('bridgeCage', CAGE_SEED, 0.2)
  const M = rigMetrics(seed, quat)
  const travel = squeezeTravel(seed, 'right', 'packet', squeeze)
  const top = { pos: [0, topY, 0], quat: landscapeFaceQuat() }
  const end = CARD_H / 2
  // Thumb knuckle a fixed fraction of the deck IN from the end it is holding,
  // which is what leaves its pad on the arch and its base clear of the cards.
  const ax = end - (CARD_H / 2) * CAGE_THUMB_MCP - M.knuckle.thumb.x
  const az = -M.knuckle.middle.z
  const thumb = surfaceContact(top, {
    finger: 'thumb',
    u: CAGE_THUMB_U,
    v: (end - (CARD_H / 2) * CAGE_THUMB_V) / (CARD_H / 2),
    clearance: squeezeAir('thumb', travel),
  })
  const ay = thumb.y - M.knuckle.thumb.y + chainLen('thumb') * CAGE_DROP
  const anchor = [ax, ay, az]
  const contacts = { thumb }
  for (const name of FINGER_NAMES) {
    if (name === 'thumb') continue
    contacts[name] = surfaceContact(top, {
      finger: name,
      u: CAGE_PAD_U,
      v: (ax + M.knuckle[name].x) / (CARD_H / 2),
      clearance: squeezeAir(name, travel),
    })
  }
  const pose = poseWithContacts(seed, 'right', { anchor, quat, splay: true }, contacts)
  return { pose, anchor }
}

// TOTAL residual of an IK solve, in world units: the in-plane miss AND the
// sideways component a fixed curl plane can never reach. Both grip builders gate
// their placement sweeps on this. Reading `error` alone (which is what they did)
// makes the gate blind to the failure it exists to catch: a pad 0.09 to the side
// of its target reports 0.0000, so every placement looks equally reachable and
// the sweep ends up ranking on contact alone.
const miss = (s) => Math.hypot(s.error, s.planeError ?? 0)

// --- Straddle grip (edge grip) -----------------------------------------------
// THE GRIP EVERY OTHER GRIP IN THIS FILE IS NOT. See TECHNIQUE_REFERENCE.md.
//
// `tableGrip` and `cageGrip` both hold a deck by pressing pads onto its broad
// TOP FACE from above (the thumb takes one long edge, but the four fingers press
// '-z'). That is why the hands hover: a pad aimed at a broad face can only rest
// ON the deck, so the only way to keep it out is air, and it is why they occlude
// the cards badly enough to need an x-ray shader. Real card grips clamp the
// deck's PERIMETER with the hand behind it: thumb on the near long edge, fingers
// wrapped onto the far one, index over the short end, and the PALM carrying the
// bottom face. The reference frame is unmistakable, the deck's face is entirely
// unobscured.
//
// WHY THE PALM CARRIES THE BOTTOM, and why this is the reachable form. This rig
// curls a finger in ONE plane (pure local-X rotations) with at most SPLAY_LIMIT
// of yaw, so "reach in from the side and press inward on the far edge" is not a
// motion it has: pressing in -x with a finger whose curl sweeps +z/-y is exactly
// the stall tableGrip's own comment records ("every pad missed by 0.4 and buried
// itself beside the deck"). What IS reachable is the real thing anyway: with the
// palm UP under the deck, a finger extending past the far edge curls back over
// it, so the pad arrives on that edge travelling the way the joint actually
// moves. The clamp is palm-below against fingertips-around, which is what a
// dealer's grip is.
//
// The deck is PORTRAIT in the hand: its long axis runs out along the fingers
// (local +y of the card = away from the wrist), so its long edges are the ±x
// faces and its short ends the ±y faces.
// ON A LONG-EDGE FACE THE ALONG-DECK AXIS IS `u`, NOT `v`. FACE_UV maps the ±x
// faces to u = local y (the long axis) and v = local z (the card NORMAL), so a `v`
// here offsets by a fraction of a CARD THICKNESS -- 0.003 world units, i.e.
// nothing. Both edge grips were written with `v` and were silently pinning every
// edge contact to the middle of the deck.
const STRADDLE_THUMB_U = 0.18 // thumb pad this far along the deck from centre
const STRADDLE_INDEX_V = 0.86 // index sits near the far short end...
const STRADDLE_PAD_V = [0, 0.34, 0.02, -0.3] // ...then middle/ring/pinky trail back
// How far PAST the far long edge the knuckles are parked. The pads have to curl
// BACK onto that edge, so the knuckles must clear it; too little and the finger
// is asked to bend past 90° to a point behind its own knuckle (the stall above),
// too much and the chain cannot reach back.
const STRADDLE_KNUCKLE_OUT = 0.0
// Where the knuckle row sits ALONG the deck, as a fraction of a half-deck from
// its centre (+1 = the near short end). The palm has to be UNDER the deck, not
// beside it, or the thumb is asked to span the whole width from outside the far
// edge -- 1.19 world units against a 0.74 chain, measured.
const STRADDLE_ALONG = -0.4
const STRADDLE_ROLL = -0.6
// ALL FOUR PLACEMENT NUMBERS BELOW ARE SWEPT, NOT CHOSEN, by
// scripts/inspect/gripProbe.mjs, which solves this grip across thousands of
// placements and scores reach residual first, then pads in contact, then
// penetration depth.
//
// THEY ARE SQUEEZE-DEPENDENT AND MUST BE RE-SWEPT PER STATION. `squeezeAir`
// moves every contact target off its surface as the squeeze rises, and the wrist
// anchor is DERIVED from the thumb target, so the whole placement shifts with it.
// Measured: the optimum swept at squeeze 0 (0.10 / 0.50 / -0.40 / -0.45), which
// is clean there, puts the thumb's proximal capsule 0.1206 INSIDE the deck at
// squeeze 0.55 and leaves its pad 0.183 off the edge. A grip builder in this file
// that quietly carried one tuned placement across every caller would be exactly
// the failure mode the rest of these comments keep recording.
//
// PREFER `straddleGripAuto`, which sweeps this for you against the station's own
// geometry and squeeze (see below). The bare constants here are a sane default
// for a portrait deck held in the air, not a universal answer.
//
// Head to head against `packetGrip`, the face grip it replaces, on identical
// charlier geometry and judged by the fingers each frame CLAIMS to grip with:
//   packetGrip   ('packet' frame, 5 pads scored)   3/5 in contact, deepest 0.0000
//   straddleGrip ('straddle' frame, 2 pads scored) 2/2 in contact, deepest 0.0000
// Fraction of the thumb chain spent rising from its knuckle to the near edge.
const STRADDLE_THUMB_DROP = 0.5
// Seed shape: fingers HOOKED to wrap an edge (most of the fold at the MCP and
// PIP so the pad faces back toward the palm), thumb nearly straight because the
// near edge is close to a whole thumb away across the deck. Gauss-Newton is
// local, so this seed is choosing the basin, not the answer.
const STRADDLE_SEED = {
  thumb: [0.35, 0.3, 0.22],
  index: [0.95, 1.2, 0.9],
  middle: [1.0, 1.25, 0.94],
  ring: [1.0, 1.2, 0.9],
  pinky: [1.05, 1.1, 0.83],
}
// Palm UP, fingers extending away from the dealer. Under this the hand frame maps
// local +y (finger extension) -> world -z (away), local +z (palmar) -> world +y
// (up), local +x (pinky side) -> world +x. So the thumb is on -x and the four
// fingers run ALONG the deck on its +x side, curling up over that long edge.
const PALM_UP = -Math.PI / 2
// Face-down portrait, matching layouts.faceQuat(false): rotX(+90) puts the card's
// normal down and its long axis along world +z, i.e. long edges on ±x.
const PORTRAIT_FACE_DOWN = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(Math.PI / 2, 0, 0),
)

export function straddleGrip({
  centerX = 0,
  centerZ = 0,
  baseY = 0.02,
  deckH = 0,
  squeeze = 0,
  // The deck's own orientation. Default is face-down PORTRAIT, the same quat
  // `faceQuat(false)` produces, which is the only one the offsets below mean
  // anything against: it puts the long EDGES on the ±x faces and the short ENDS
  // on ±y, with local -y the end AWAY from the wrist.
  cardQuat = null,
  // Placement overrides, so scripts/inspect/gripProbe.mjs can sweep them instead
  // of the constants being hand-guessed. Defaults are the swept optimum.
  knuckleOut = STRADDLE_KNUCKLE_OUT,
  thumbDrop = STRADDLE_THUMB_DROP,
  along = STRADDLE_ALONG,
  // Roll about the hand's own forward axis. This is how a real thumb clears the
  // deck: rolling the palm brings the thumb around the near edge from OUTSIDE
  // instead of driving its metacarpal under the stack. Without it the pads reach
  // their targets perfectly and the thumb's proximal capsule still sits 4.2mm
  // inside the cards, which `resolvePenetration` cannot fix (it scales CURL, and
  // a thumb base is placed by the wrist).
  roll = STRADDLE_ROLL,
} = {}) {
  const quat = eulerYXZ(PALM_UP, 0, roll)
  const seed = seeded('deckRest', STRADDLE_SEED, 0.12)
  const M = rigMetrics(seed, quat)
  const travel = squeezeTravel(seed, 'right', 'packet', squeeze)
  const cq = cardQuat ?? PORTRAIT_FACE_DOWN
  const cardAt = (h) => ({ pos: [centerX, baseY + h, centerZ], quat: cq })
  const mid = cardAt(deckH * 0.5)
  const topCard = cardAt(deckH)

  // Across the deck: park the four knuckles just outside the FAR long edge
  // (+x), measured off the rig so it follows HAND_SCALE.
  const ax = centerX + CARD_W / 2 + knuckleOut - M.knuckle.middle.x
  // Along it: the middle knuckle sits level with the deck's centre, so the four
  // pads spread fore and aft of it along the deck rather than bunching.
  const az = centerZ + (CARD_H / 2) * along - M.knuckle.middle.z
  // The thumb takes the NEAR long edge (-x), half way up the stack.
  const thumb = surfaceContact(mid, {
    finger: 'thumb',
    face: '-x',
    u: STRADDLE_THUMB_U,
    clearance: squeezeAir('thumb', travel),
  })
  const ay = thumb.y - M.knuckle.thumb.y - chainLen('thumb') * thumbDrop
  const anchor = [ax, ay, az]

  const contacts = { thumb }
  // The index curls over the deck's FAR SHORT END (+y): the one contact besides
  // the thumb that the sources single out ("the forefinger resting on top",
  // "index fingers curled on top").
  contacts.index = surfaceContact(topCard, {
    finger: 'index',
    face: '-y',
    u: 0.55,
    clearance: squeezeAir('index', travel),
  })
  // MIDDLE, RING AND PINKY GET NO FINGERTIP TARGET, and that is the grip, not a
  // shortcut. In a real straddle the deck is trapped between the thumb, the palm
  // and the LATERAL surfaces of these three fingers lying along the far long
  // edge; their tips are past the edge and touch nothing. Aiming their tips at
  // that edge asks for a motion the rig does not have (the pad would have to
  // travel sideways in -x while a curl sweeps +z/-y) and the solver reports it
  // honestly as plane error it cannot spend: measured 0.18, 0.41 and 0.65, i.e.
  // up to a whole card width off. So they keep the seeded hook, which lays those
  // lateral surfaces along the edge, and `resolvePenetration` is what keeps them
  // out of the cards. The `straddle` grip frame scores thumb and index for this
  // reason -- a metric that demands five pads on the deck is asking for a grip
  // no hand uses.

  const pose = poseWithContacts(seed, 'right', { anchor, quat, splay: true }, contacts)
  // Report whether the two real contacts actually REACHED. An unreached target
  // is not a loose grip, it is a finger pointing somewhere else entirely (see
  // solveFingerTo's JOINT_LIMITS pinning), and it is silent unless measured.
  // `miss`, not `.error`: `error` is only the IN-PLANE residual, and `planeError`
  // is the sideways component a fixed curl plane can never reach. Reading error
  // alone made this gate blind to exactly the failure it exists to catch -- a pad
  // 0.09 to the side of its target reported a reach of 0.0000, so every placement
  // in the sweep looked equally reachable and `autoPlace` ranked on contact alone.
  const reach = Math.max(
    miss(solveThumbTo(pose, 'right', contacts.thumb, { oppRange: 1.1, steps: 33 })),
    miss(solveFingerTo(pose, 'right', 'index', contacts.index, { splay: true })),
  )
  // Resolve against THIS DECK ONLY, and emphatically NOT against a solid column
  // down to the felt the way `tableGrip` does. That column is correct there
  // because the hand comes from ABOVE, so anything below the pile is somewhere
  // the hand has no business being. A straddle is the opposite: the PALM IS
  // UNDERNEATH, carrying the bottom face, so a phantom column below the deck
  // claims cards exactly where the hand has to be. Including it made every
  // placement measure ~0.10 deep and drove the auto-placer to pick a hand parked
  // beside the deck rather than under it.
  const column = [topCard, mid, cardAt(0)]
  resolvePenetration(pose, 'right', column)
  return { pose, anchor, contacts, reach, column }
}

// --- Edge pinch grip ----------------------------------------------------------
// THE OTHER EDGE GRIP, and the one hindu and strip actually use. A straddle rests
// the deck in the palm; a PINCH holds it clear of the hand between two OPPOSING
// fingertips, which is what the sources describe for both:
//
//   hindu, holding hand: "the deck is held face down, with the middle finger on
//   one long edge and the thumb on the other"
//   strip / hindu, receiving hand: "take hold of the inner end of the deck by its
//   sides between the top joints of the thumb and second finger, the forefinger
//   resting on the top of the pack"
//
// So: thumb on one long edge, MIDDLE on the opposite long edge, index laid along
// the top face to stop the packet pivoting about them. Ring and pinky trail free,
// as the sources say outright ("the third and fourth fingers resting free") — so,
// as with the straddle, they get no fingertip target and are not scored.
//
// Two opposing pads is the whole point of a pinch, and unlike the straddle's far
// long edge these two ARE reachable: they face each other across the deck's
// width, so each pad arrives along its own curl plane rather than sideways.
//
// EITHER PAIR OF OPPOSING FACES WILL DO, and `axis` picks which:
//   'long'  thumb and middle on the two LONG EDGES (±x), opposing across the
//           deck's WIDTH. Hindu's holding hand, and hindu/strip's receiving hand.
//   'end'   thumb and middle on the two SHORT ENDS (±y), opposing along the
//           deck's LENGTH. The in-hands riffle, where each half is held by its
//           ends: thumb near one end, the fingers round the other.
//
// THE AXIS FACT THAT HAS COST THIS PROJECT TIME TWICE. `FACE_UV` maps the ±x
// faces to u = local y, v = local z and the ±y faces to u = local x, v = local z.
// So on BOTH edge-face pairs `v` IS THE CARD NORMAL and a `v` offset moves the
// target by a fraction of a card THICKNESS -- 0.0015 world units, i.e. nothing.
// The along-face axis is always `u`. On a long edge that `u` runs ALONG the deck;
// on a short end it runs ACROSS its width. Every offset below is stated as a
// world coordinate and converted per face, so neither axis can be written with
// the other's meaning.
//
// The two axes also want the hand in a DIFFERENT PLACE ACROSS THE DECK, because a
// curl sweeps in a fixed plane and cannot move a pad sideways at all (only splay
// can, by up to SPLAY_LIMIT of yaw), so where the knuckle row sits decides which
// faces are reachable at all. `across` is that position, as a signed fraction of a
// half-width from the deck's centre line, with `'edge'` meaning "the far long edge
// plus the middle pad's own radius":
//
//   'long'  the two pads' x is FIXED by the faces they are on, so the row belongs
//           at that edge -- `knuckleOut` 0 then puts the middle pad exactly ON the
//           '+x' face instead of a fingertip radius inside it.
//   'end'   the pads' x is free (an end face spans the whole width), so the row
//           can stay over the deck and let each pad's across-width offset be read
//           off its own knuckle. It still wants to be near the far edge: reaching
//           a whole card length costs the middle most of its chain, and a row
//           further in leaves the thumb spanning more than it has.
const PINCH_FACES = {
  long: { thumb: '-x', middle: '+x', across: 'edge' },
  // On the end axis the thumb takes whichever short end is on the WRIST's side and
  // the middle the far one, because the thumb knuckle sits BEHIND the four (0.64
  // behind, measured off the rig under this grip's own quaternion) and the fingers
  // are the ones with the reach. Which world end that is depends on the palm, so
  // the faces are resolved from the rig at build time rather than typed here.
  end: { thumb: null, middle: null, across: 1.0 },
}

// PALM DOWN, NOT PALM UP, and this is the change that made the index possible.
//
// A palm-UP pinch (which is what this grip was) puts the wrist BELOW the cards,
// because the thumb curls toward the palm and so can only reach a target ABOVE its
// own knuckle: the knuckle row therefore has to sit under the deck, and measured
// off the rig it lands at least CARD_T*n/2 + 0.039 below the deck's top face -
// 0.116 for a 52-card deck. From there the index has to climb over a long edge and
// hook back down onto the top face, and it arrives STEEPLY: the IK puts the tip
// centre a pad radius above the face, the rest of the distal phalange follows the
// finger's slope, and its DIP end ends up 0.03 to 0.05 INSIDE the cards while the
// pad is perfectly tangent. Swept over 23100 palm-up placements, including the
// index's own reach axis, the best any of them managed was 0.0335 of index
// penetration -- nearly half a pad radius, on every one.
//
// Palm DOWN is both reachable and what the sources describe: hindu's holding hand
// is a hand OVER the deck ("held face down, middle finger on one long edge and the
// thumb on the other"), and `tableGrip` already holds a pile this way. The thumb
// now curls DOWNWARD onto its edge from a wrist above the cards, the four knuckles
// sit above the top face, and the index lies ALONG that face instead of hooking
// over an edge to reach it.
const PINCH_PALM = PALM_DOWN
// A PINCH GRIPS THE DECK'S INNER END, NOT ITS MIDDLE, and that is not a detail:
// "take hold of the INNER END of the deck by its sides between the top joints of
// the thumb and second finger, the forefinger resting on the top". Aiming the two
// pads at the deck's centre instead (u 0.1 / -0.05, which is what this grip did)
// drags the whole hand in after them, and then THE KNUCKLE ROW SITS INSIDE THE
// DECK'S OWN FOOTPRINT: measured at every placement in the old grid, the index
// knuckle ended up 0.06 from the deck's centre line at deck height with its
// proximal capsule 0.09 INSIDE the cards. `resolvePenetration` answered the only
// way it can, by scaling that finger's curl toward straight, and that threw its
// pad 0.17 off the top face. That is what "the index competes with the pinch on a
// thick deck" was: not a competition for reach -- reach was 0.0000 -- but a hand
// parked inside the deck and a backoff pass doing its job.
//
// So no pad carries an absolute along-deck constant any more. Each is derived
// from its OWN KNUCKLE under the swept wrist placement, the way `tableGrip`
// derives its fingers' `v`, and the numbers below are fractions of a REACHING
// CHAIN (hand-sized, so they follow HAND_SCALE) rather than fractions of a deck.
const PINCH_THUMB_LEAD = 0.45 // thumb pad this far forward of its knuckle...
const PINCH_STAGGER = 0.1 // ...middle opposes it, a whisker further in
// How far forward the INDEX pad sits, and it is an OPTION rather than a placement
// axis because the sweep says it does not need to be one -- but only under a
// palm-down hand, which is worth recording because it was the obvious suspect and
// it was the wrong one. The IK puts the TIP CENTRE a pad radius above the face and
// the rest of the distal phalange follows the finger's own slope, so a finger
// arriving STEEPLY has its DIP end inside the cards while its pad is perfectly
// tangent. Reaching further should flatten it, so this went into the grid as a
// fifth axis; palm-up it bought almost nothing (0.0471 of index penetration at the
// old constant, 0.0335 at the best value anywhere in an 23100-placement sweep) and
// palm-down every value in 0.1..0.9 is equally clean, all 18 stations passing on
// this single default. The lesson is the one the file keeps re-learning: a knob
// that cannot fix a problem is not the problem's cause. The wrist was.
const PINCH_INDEX_LEAD = 0.35
// Keep every derived pad ON the card it is aimed at. |u| > 1 is a legal
// surfaceContact (the target rides the face's PLANE), which is right for the
// straddle's trailing fingers and wrong here: a pinch pad off the end of the deck
// is touching nothing at all.
const PINCH_U_MAX = 0.85
const PINCH_MAX_DEPTH = 0.012
const PINCH_SEED = {
  thumb: [0.42, 0.34, 0.24],
  index: [0.72, 0.95, 0.7],
  middle: [0.62, 0.9, 0.68],
  ring: [0.5, 0.7, 0.5],
  pinky: [0.42, 0.6, 0.44],
}
// THE PINCH DOES NOT RESERVE THE THUMB'S SQUEEZE TRAVEL, and that is measured,
// not a shortcut. `squeezeAir` bills the thumb THUMB_RESERVE (1.2) times its
// frame-relative travel, a figure swept for the `packet` frame on a CARRIED half
// deck where the thumb is half the frame and meets the NEIGHBOURING pile. Charged
// to a pinch it comes to 0.0569 of air at squeeze 0.3 and 0.0905 at 0.55, against
// a CONTACT_AIR of 0.0165: it authors the thumb pad up to 0.074 OFF the very edge
// it is meant to be pinching, three card widths of it, and no placement in any grid
// can put it back, because the anchor is derived from that same target. Measured
// with the placement otherwise unchanged, the thumb's gap went 0.0175 / 0.0571 /
// 0.0984 across squeeze 0 / 0.3 / 0.55 -- twice and four times outside the 0.025
// contact band, so the grip silently stopped touching the cards as it gripped
// harder. That is the second half of "the thumb loses its edge on thin packets"
// (the first half being that the old `reach` could not see the miss at all).
//
// A pinch is also the one grip that does not need the reservation: the deck is
// trapped BETWEEN two opposing pads, so a squeeze curls them into each other and
// the CARDS are what stops them, which is the whole reason an edge grip beats a
// face grip. What the squeeze really costs is a GRAZE, and a graze has to be
// measured rather than assumed, so `gripProbe.mjs` reports the depth of the
// SQUEEZED pose (applyGripPressure applied, i.e. the pose that RENDERS) beside the
// solved one. Priced across all 18 stations: nothing at squeeze 0, at most 0.019
// at squeeze 0.3, and 0.042-0.048 at 0.55, always the thumb's distal capsule --
// under a third of a pad radius at 0.3, and about 60% of one at 0.55. That is a
// real cost and it belongs to the FRAME, not to this standoff: `pinch`'s pressure
// weights (thumb 1, index 0.9, middle 0.35, in handKinematics.js) are a face
// grip's weights, and PRESSURE_CURL 0.14 moves a pad ~0.05 at squeeze 0.55, twice
// the whole contact band. See the NEEDS FROM LEAD note in the handoff.
const PINCH_RESERVE = 0
const pinchAir = (name, travel) => CONTACT_AIR + PINCH_RESERVE * (travel?.[name] ?? 0)

// A SHARED GRID FOR THE TWO AXES IS A FICTION. `thumbDrop` is NEGATIVE in both now
// -- the wrist sits ABOVE the thumb's pad, which is what palm-down means -- but the
// rest differ: a long-edge pinch takes the deck across its width with the hand
// square to it, while an end pinch has to span a whole card length and wants the
// palm rolled toward the deck (roll +0.6 to +0.9) to get the thumb over the near
// end. Each grid was bounded by sweeping WIDER than itself
// (`gripProbe.mjs pinchsweep <axis>`, 13k-56k placements) and keeping the region
// that needs no backoff at all. Winners are reported per station by the probe: the
// `end` grid deliberately carries cells past its winners (knuckleOut 0.45, roll
// 1.2, thumbDrop -0.3) BECAUSE they never win -- that is what says the optimum is
// inside the range rather than pressed against it. `long`'s do sit at the ends of
// their ranges, but dozens of its cells tie at 3/3 pads and zero penetration, so
// which one is returned is decided by the reach tie-break, not by the bound.
const PINCH_GRID = {
  long: {
    knuckleOut: [-0.2, -0.1, 0, 0.1],
    thumbDrop: [-0.8, -0.65, -0.5, -0.35],
    along: [-0.4, 0, 0.4, 0.8],
    roll: [-0.9, -0.6, -0.3],
  },
  end: {
    knuckleOut: [0, 0.15, 0.3, 0.45],
    thumbDrop: [-0.9, -0.75, -0.6, -0.45, -0.3],
    along: [0, 0.4, 0.8, 1.2],
    roll: [0.3, 0.6, 0.9, 1.2],
  },
}

// MEASURED, self-placing, per station, by `gripProbe.mjs pinch`. Three stations x
// three squeezes x both axis modes, and for each: the worst reach residual over the
// three claimed pads, how many of them are inside the 0.025 contact band, the
// deepest capsule AS SOLVED, and -- the check that makes the rest mean anything --
// which FACE each pad actually ended up on.
//
//   axis    station         squeeze     reach    pads  deepest  faces
//   long    52-card deck    0/.3/.55    0.0011   3/3   0.0000   -x / +x / -z
//   long    20-card block   0/.3/.55    0.0007   3/3   0.0000   -x / +x / -z
//   long    8-card packet   0/.3/.55    0.0003   3/3   0.0000   -x / +x / -z
//   end     52-card deck    0/.3/.55    0.0013   3/3   0.0000   -y / +y / -z
//   end     20-card block   0/.3/.55    0.0004   3/3   0.0000   -y / +y / -z
//   end     8-card packet   0/.3/.55    0.0004   3/3   0.0000   -y / +y / -z
//
// Every pad gap is 0.0153-0.0172, i.e. CONTACT_AIR and nothing else: the pads are
// exactly where they were aimed, and `resolvePenetration` has nothing to do at any
// of the eighteen. For comparison, the table this replaces (TECHNIQUE_REFERENCE.md)
// read 2/3, 1/3, 2/3 with pads 0.173, 0.174 and 0.175 off the cards.
export function edgePinchGrip({
  centerX = 0,
  centerZ = 0,
  baseY = 0.02,
  deckH = 0,
  squeeze = 0,
  cardQuat = null,
  // Which opposing face pair the thumb and middle take. See PINCH_FACES.
  axis = 'long',
  knuckleOut = 0,
  thumbDrop = 0,
  along = 0,
  roll = 0,
  indexLead = PINCH_INDEX_LEAD,
} = {}) {
  const faces = PINCH_FACES[axis]
  if (!faces) throw new Error(`edgePinchGrip: axis must be 'long' or 'end', got '${axis}'`)
  const quat = eulerYXZ(PINCH_PALM, 0, roll)
  const seed = seeded('deckRest', PINCH_SEED, 0.1)
  const M = rigMetrics(seed, quat)
  const travel = squeezeTravel(seed, 'right', 'pinch', squeeze)
  const air = {}
  for (const name of FINGER_NAMES) air[name] = pinchAir(name, travel)
  const cq = cardQuat ?? PORTRAIT_FACE_DOWN
  const cardAt = (h) => ({ pos: [centerX, baseY + h, centerZ], quat: cq })
  const mid = cardAt(deckH * 0.5)
  const topCard = cardAt(deckH)

  // ACROSS the deck's width. On the long axis, park the knuckle row outside the
  // far long edge BY THE MIDDLE PAD'S OWN RADIUS (plus its standoff), so
  // knuckleOut = 0 puts that pad exactly on the '+x' face rather than a fingertip
  // radius inside it: a curl cannot move a pad in x at all, so this is the one
  // offset the sweep must not have to discover, it is hand-sized (0.079 at
  // HAND_SCALE 11) and it belongs in the formula. On the end axis the row sits at a
  // fraction of a half-width instead, and each pad's across-width offset is read
  // off its own knuckle from there.
  const acrossRef =
    faces.across === 'edge'
      ? CARD_W / 2 + FINGERS.middle.rad[2] * HAND_SCALE + air.middle
      : (CARD_W / 2) * faces.across
  const ax = centerX + acrossRef + knuckleOut - M.knuckle.middle.x
  const az = centerZ + (CARD_H / 2) * along - M.knuckle.middle.z

  // Face coordinates from WORLD coordinates, for the portrait face-down deck
  // these offsets are stated against (local x = world x across the width, local
  // y = world z along the deck, local z the face normal).
  const clampU = (u) => Math.min(PINCH_U_MAX, Math.max(-PINCH_U_MAX, u))
  const alongU = (z) => clampU((z - centerZ) / (CARD_H / 2))
  const acrossU = (x) => clampU((x - centerX) / (CARD_W / 2))
  // Which way the fingers point, READ OFF THE WRIST QUATERNION rather than assumed:
  // local +y is finger extension, and the sign of its world z flips with the palm.
  // Hard-coding it is how an "along the deck" offset silently becomes an offset
  // backwards along the deck the moment the hand is turned over.
  const fwdZ = _fwd.set(0, 1, 0).applyQuaternion(quat).z
  // A pad leads its own knuckle by a fraction of its own chain, in that direction.
  const lead = (name, frac) => az + M.knuckle[name].z + fwdZ * chainLen(name) * frac
  const pinchAlong = alongU(lead('thumb', PINCH_THUMB_LEAD))
  // On the end axis, the thumb takes the short end on the wrist's side. `fwdZ > 0`
  // means the fingers reach toward +z, so the wrist is at -z and the thumb takes
  // the deck's '-y' face (local +y maps to world +z for a face-down portrait deck).
  const thumbFace = faces.thumb ?? (fwdZ > 0 ? '-y' : '+y')
  const middleFace = faces.middle ?? (fwdZ > 0 ? '+y' : '-y')

  const contacts = {
    // The two opposing pads. On the long edges their free coordinate is the
    // position ALONG the deck; on the short ends it is the position ACROSS its
    // width, and that one is set by the finger's own knuckle because x is exactly
    // what a curl cannot change.
    thumb: surfaceContact(mid, {
      finger: 'thumb',
      face: thumbFace,
      u: axis === 'long' ? pinchAlong : acrossU(ax + M.knuckle.thumb.x),
      clearance: air.thumb,
    }),
    middle: surfaceContact(mid, {
      finger: 'middle',
      face: middleFace,
      u: axis === 'long' ? clampU(pinchAlong - PINCH_STAGGER) : acrossU(ax + M.knuckle.middle.x),
      clearance: air.middle,
    }),
    // The index lies on the deck's TOP face and stops the packet pivoting about
    // the pinch. Both of its coordinates are derived: `u` across the width from
    // its own knuckle (unreachable by curl), `v` along the deck from how far
    // forward its chain reaches. On the top face `v` IS the along-deck axis --
    // this is the one face where that is true, which is exactly why the note
    // above is worth re-reading before editing any of it.
    index: surfaceContact(topCard, {
      finger: 'index',
      u: acrossU(ax + M.knuckle.index.x),
      v: alongU(lead('index', indexLead)),
      clearance: air.index,
    }),
  }
  const ay = contacts.thumb.y - M.knuckle.thumb.y - chainLen('thumb') * thumbDrop
  const anchor = [ax, ay, az]

  const pose = poseWithContacts(seed, 'right', { anchor, quat, splay: true }, contacts)
  // REACH IS hypot(error, planeError), NOT error. `solveFingerTo` splits its
  // residual in two: `error` is what the curls failed to close inside the
  // finger's own plane, `planeError` the component that plane cannot reach at all.
  // Reading `error` alone reported 0.0000 for a thumb whose pad was sitting 0.174
  // off the edge it was supposed to be pinching, because the whole miss was
  // sideways -- and `autoPlace` gates on this number, so every placement in the
  // grid looked equally reachable and it ranked them on contact alone. That was
  // the other half of "the thumb loses its edge on thin packets".
  const reach = Math.max(
    miss(solveThumbTo(pose, 'right', contacts.thumb, { oppRange: 1.1, steps: 33 })),
    miss(solveFingerTo(pose, 'right', 'middle', contacts.middle, { splay: true })),
    miss(solveFingerTo(pose, 'right', 'index', contacts.index, { splay: true })),
  )
  // A pinch holds the deck AWAY from the hand, so unlike the straddle there is no
  // palm under it and no reason to model anything but the deck itself.
  const column = [topCard, mid, cardAt(0)]
  // Keep the pose AS SOLVED, before the backoff. `reach` says the IK hit every
  // target; it does not say the pad is still THERE afterwards, because
  // resolvePenetration scales curl and so moves the pads with it. Handing both
  // poses back is what lets gripProbe.mjs attribute a lost pad to the placement or
  // to the backoff instead of guessing between them -- and, more importantly, what
  // lets `autoPlace` score the depth this placement really has rather than the ~0
  // the backoff leaves behind (see its note).
  const preResolve = cloneHandPose(pose)
  resolvePenetration(pose, 'right', column)
  return { pose, anchor, contacts, reach, column, preResolve, air }
}

// --- Self-placing straddle ----------------------------------------------------
// THE ADOPTION BLOCKER, REMOVED. A lesson calling `straddleGrip` directly has to
// carry four placement numbers per station, and they do NOT transfer: the anchor
// is derived from the thumb target and `squeezeAir` moves that target, so a
// placement swept at one squeeze can bury the thumb 0.12 deep at another. Four
// magic numbers per station that silently stop being right is exactly the class
// of bug the rest of this file is a monument to.
//
// So sweep at COMPILE time instead. One solve is ~1.6ms, the grid below is 144
// candidates, so a station costs ~0.3s once per lesson compile, and the result is
// a placement measured against the station's own geometry and squeeze rather than
// inherited from a different one. Deterministic (fixed grids, no randomness), so
// the compiled track stays a pure function of the lesson source.
//
// Scored in strict priority: REACH first (an unreached target is a finger
// pointing somewhere else, not a loose one), then pads in contact, then depth.
// Skin deep. Above this a placement is rejected outright, however well it scores
// on contact (see the gate below).
const STRADDLE_MAX_DEPTH = 0.012
const STRADDLE_GRID = {
  knuckleOut: [-0.2, 0, 0.2, 0.4],
  thumbDrop: [0.1, 0.3, 0.5, 0.7],
  along: [-0.4, -0.2, 0, 0.2, 0.4, 0.6],
  roll: [-0.6, -0.45, -0.3, -0.15, 0, 0.15, 0.3],
}
const _sg = new THREE.Vector3()

// Signed clearance from a fingertip SURFACE to the nearest of `cards`: >0 clear,
// <0 inside. NOT via `cardDepth`, which early-returns 0 for any point outside the
// card and so cannot measure clearance at all — using it here scored every pad as
// a whole radius away and reported a perfect grip as 0/2 in contact.
const _pgLocal = new THREE.Vector3()
const _pgInv = new THREE.Quaternion()
function padGap(pose, side, name, cards) {
  fingertipWorld(pose, side, name, _sg)
  let best = Infinity
  for (const c of cards) {
    _pgLocal.copy(_sg).sub(cardPosOf(c)).applyQuaternion(_pgInv.copy(c.quat).invert())
    const e = surfaceExtents(_pgLocal, c.bend ?? 0)
    const ox = Math.max(e.x, 0)
    const ou = Math.max(e.u, 0)
    const on = Math.max(e.n, 0)
    const outside = Math.hypot(ox, ou, on)
    const g = outside > 0 ? outside : Math.max(e.x, e.u, e.n)
    if (g < best) best = g
  }
  return best - FINGERS[name].rad[2] * HAND_SCALE
}

// Every combination in a placement grid, keys in declaration order with the last
// varying fastest -- i.e. exactly the order the nested loops this replaces
// visited, so a grip whose ranking ends in a first-seen tie keeps the same answer.
// Written as a product rather than four fixed loops because the grids are NOT the
// same shape: the pinch needs a fifth axis (see PINCH_INDEX_LEAD) and the straddle
// does not, and a grip should be able to say which knobs it has.
function gridPlacements(grid) {
  let out = [{}]
  for (const key of Object.keys(grid)) {
    const next = []
    for (const partial of out) for (const v of grid[key]) next.push({ ...partial, [key]: v })
    out = next
  }
  return out
}

// Shared self-placing sweep for the edge grips. `build` is the grip builder,
// `scored` the fingers whose pads that grip really claims, `grid` its placement
// axes and `maxDepth` its skin-deep gate.
//
// `byGap` (opt-in) adds a final tie-break on the WORST scored pad gap. Without it
// the ranking stops at "same number of pads inside the 0.025 band, same depth" and
// then keeps whichever candidate the grid happened to visit first, which on the
// pinch meant picking a pad 0.022 off the cards over an otherwise identical
// placement that had it at 0.001. It is off by default so `straddleGripAuto`
// keeps returning exactly the placement it was measured on.
function autoPlace(build, scored, grid, maxDepth, opts, { byGap = false } = {}) {
  let best = null
  for (const placement of gridPlacements(grid)) {
    const g = build({ ...opts, ...placement })
    // MEASURE THE POSE AS SOLVED, NOT AFTER THE BACKOFF. `resolvePenetration`
    // drives every depth to ~0 by construction, so scoring the returned pose asks
    // "did the backoff run?" (it always did) instead of "did this placement need
    // it?" -- and the backoff's bill is paid in PADS: it scales curl, so the
    // finger it rescues comes off the cards with it. Scoring the solved pose is
    // what lets the sweep prefer a hand that was never inside the deck.
    const scoredPose = g.preResolve ?? g.pose
    let deepest = 0
    for (const name of FINGER_NAMES) {
      deepest = Math.max(deepest, fingerDepth(scoredPose, 'right', name, g.column, 6))
    }
    const gaps = scored.map((n) => padGap(g.pose, 'right', n, g.column))
    const touching = gaps.filter((v) => Math.abs(v) < 0.025).length
    const worstGap = Math.max(...gaps.map(Math.abs))
    const cand = { g, reach: g.reach, touching, deepest, worstGap, placement }
    if (!best) {
      best = cand
      continue
    }
    const gate = (c) => (c.reach <= 0.02 ? 0 : 2) + (c.deepest <= maxDepth ? 0 : 1)
    if (gate(cand) !== gate(best)) {
      if (gate(cand) < gate(best)) best = cand
      continue
    }
    if (cand.touching !== best.touching) {
      if (cand.touching > best.touching) best = cand
      continue
    }
    if (Math.abs(cand.deepest - best.deepest) > 1e-9) {
      if (cand.deepest < best.deepest) best = cand
      continue
    }
    if (!byGap) continue
    // REACH BEFORE GAP, and the order is not arbitrary. Once a grip is placing
    // itself well, DOZENS of cells tie at 3/3 pads and zero penetration, and both
    // of these measure the same thing -- is the pad where it was aimed -- but
    // `reach` measures it against the TARGET while `worstGap` measures it against
    // the nearest card, and the gap of a pad sitting exactly on target is
    // CONTACT_AIR, not zero. Ranking on the gap first therefore trades real reach
    // for noise: it picked a 20-card placement 0.0166 off its targets over one
    // 0.0013 off them, to buy 0.002 of gap. Without either, a first-seen tie-break
    // returns whichever cell the grid lists first, which looks exactly like an
    // optimum pinned to the edge of a range.
    if (Math.abs(cand.reach - best.reach) > 1e-9) {
      if (cand.reach < best.reach) best = cand
      continue
    }
    if (cand.worstGap < best.worstGap - 1e-9) best = cand
  }
  return {
    ...best.g,
    placement: best.placement,
    measured: {
      reach: best.reach,
      touching: best.touching,
      of: scored.length,
      deepest: best.deepest,
      worstGap: best.worstGap,
    },
  }
}

// Self-placing pinch. Takes everything `edgePinchGrip` does; `axis` selects the
// opposing face pair ('long', the default, or 'end') and picks that axis's own
// placement grid with it, because the two want the hand in different places.
export const edgePinchGripAuto = (opts = {}) =>
  autoPlace(
    edgePinchGrip,
    ['thumb', 'middle', 'index'],
    PINCH_GRID[opts.axis ?? 'long'] ?? PINCH_GRID.long,
    PINCH_MAX_DEPTH,
    opts,
    { byGap: true },
  )

export const straddleGripAuto = (opts = {}) =>
  autoPlace(straddleGrip, ['thumb', 'index'], STRADDLE_GRID, STRADDLE_MAX_DEPTH, opts)

// Generate the weave's hand keyframes so the thumb ratchets open across
// EXACTLY the window in which the staggered cards release (staggerWindow:
// card k starts at k/(n-1)*spread through the step), the thumb visibly
// "passes" each card as it falls. Alternating micro-jitter makes it read as a
// card-by-card ratchet rather than a smooth fade. Returns a keyframe array for
// step.hands.<side>; append/prepend extra keyframes freely.
export function thumbRatchetKeyframes({
  gripPose,
  openFingers = null,
  openThumb = [0.12, 0.1, 0.06],
  openOpp = null,
  anchorFrom,
  anchorTo,
  spread = 0.55,
  span = 0.45,
  steps = 6,
  jitter = 0.03,
  fingerMotion = null,
}) {
  const window = Math.min(1, spread + span * 0.35)
  const fromThumb = gripPose.fingers.thumb
  const fromOpp = gripPose.thumbOpp ?? { x: 0, z: 0 }
  const kfs = []
  for (let k = 0; k <= steps; k++) {
    const f = k / steps
    const j = k === 0 || k === steps ? 0 : (k % 2 === 0 ? 1 : -1) * jitter
    const thumb = fromThumb.map((v, i) => v + (openThumb[i] - v) * f + j * (1 - f))
    const kf = { at: f * window, fingers: { thumb } }
    // The four fingers open WITH the thumb (a fraction of their own solved
    // curl, so "open" always means a fraction of THIS grip). Not decoration: a
    // thumbPeel frame is 0.75 thumb, so a ratcheting thumb walks the whole
    // still-held packet ~0.4 across pads that are standing still, and the pads
    // end up inside the cards they are pouring. Letting the hand open as the
    // half empties is both the fix and what a real release looks like.
    if (openFingers !== null) {
      for (const name of ['index', 'middle', 'ring', 'pinky']) {
        const from = gripPose.fingers[name]
        kf.fingers[name] = from.map((v) => v + (v * openFingers - v) * f)
      }
    }
    if (openOpp) {
      kf.thumbOpp = {
        x: (fromOpp.x ?? 0) + ((openOpp.x ?? 0) - (fromOpp.x ?? 0)) * f,
        z: (fromOpp.z ?? 0) + ((openOpp.z ?? 0) - (fromOpp.z ?? 0)) * f,
      }
    }
    if (anchorFrom && anchorTo) {
      kf.anchor = anchorFrom.map((v, i) => v + (anchorTo[i] - v) * f)
    }
    if (fingerMotion && k > 0 && k < steps) kf.fingerMotion = fingerMotion
    kfs.push(kf)
  }
  return kfs
}
