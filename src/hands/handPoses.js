import * as THREE from 'three'
import { fingerJointsWorld } from './handKinematics'
import { FINGERS, FINGER_NAMES, HAND_SCALE } from './handRigSpec'
import { CARD_T } from '../lib/constants'

// Named hand pose presets. Each pose defines a wrist transform + per-finger
// joint angles (3 segments each) and a spread factor for the knuckle splay.
// Angles are local Euler X-rotations in radians: [proximal, middle, distal];
// larger = more curl toward the palm (see the frame notes in handRig.js).
//
// MIRRORING: the left hand is the right rig mirrored by root.scale.x < 0, so it
// uses the SAME wrist quaternion and the SAME finger angles, only its wrist X
// position is negated (getHandPose). Do NOT mirror the quaternion or negate
// curls; that double-mirrors and flips the grip (verified headlessly).

// Palm-down base: fingers hang down and curl further down/inward, thumb sweeps
// toward the deck center, the natural two-handed table grip.
function euler(x, y = 0, z = 0) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z))
}
// Palm-down FIRST, then a world-Y yaw (order 'YXZ'), the yaw swings the whole
// palm-down hand about the vertical, so the fingers point along the table
// instead of at the camera while the palm keeps facing the felt. Authoring the
// yaw the other way round (plain 'XYZ') tips the palm on edge instead.
function eulerYXZ(x, y = 0, z = 0) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'YXZ'))
}
const PALM_DOWN = Math.PI / 2
// Fingers point at the table centre (−x for the right hand; the engine's
// x-mirror makes the left hand point +x, so one authored yaw serves both).
const REACH_IN = -Math.PI / 2

function pose(wristPos, wristRot, fingers, spread = 0.28) {
  return {
    wrist: { pos: new THREE.Vector3(...wristPos), quat: wristRot.clone() },
    fingers,
    spread,
  }
}

// finger-angle helper: [proximal, middle, distal] per finger.
function f(
  thumb = [0.3, 0.3, 0.2],
  index = [0.6, 0.5, 0.3],
  middle = [0.62, 0.52, 0.32],
  ring = [0.58, 0.48, 0.3],
  pinky = [0.5, 0.42, 0.26],
) {
  return { thumb, index, middle, ring, pinky }
}

export const HAND_POSES = {
  // Resting off to the side, tilted, gently curled.
  relaxed: pose(
    [0.95, 0.5, 0.42],
    euler(PALM_DOWN - 0.35, 0, 0.12),
    f([0.25, 0.22, 0.14], [0.32, 0.24, 0.14], [0.34, 0.26, 0.15], [0.32, 0.24, 0.14], [0.28, 0.2, 0.12]),
    0.3,
  ),

  // Flat cradle: palm over a half-deck, fingers draping down its outer edge,
  // thumb reaching toward the deck's inner (center) edge to steady it.
  twoHandsSupport: pose(
    [0.5, 0.42, 0.06],
    euler(PALM_DOWN, 0, 0),
    f([0.4, 0.45, 0.3], [0.55, 0.45, 0.28], [0.58, 0.48, 0.3], [0.55, 0.45, 0.28], [0.5, 0.4, 0.26]),
    0.26,
  ),

  // Pinch: thumb + index oppose to peel/grip a packet; other fingers relaxed.
  pinchCut: pose(
    [0.5, 0.44, 0.05],
    euler(PALM_DOWN, 0.1, 0),
    f([0.55, 0.6, 0.4], [0.75, 0.6, 0.4], [0.35, 0.28, 0.18], [0.3, 0.24, 0.15], [0.28, 0.22, 0.14]),
    0.16,
  ),

  // Riffle arch: firm grip that bows the half, fingers wrap the outer edge,
  // thumb presses the inner edge down. This is the grip that loads the spring.
  riffleArch: pose(
    [0.52, 0.44, 0.02],
    euler(PALM_DOWN, 0, 0),
    f([0.5, 0.55, 0.4], [0.85, 0.7, 0.45], [0.9, 0.75, 0.48], [0.85, 0.7, 0.45], [0.78, 0.62, 0.4]),
    0.22,
  ),

  // Bridge release: thumbs lift/extend to let the cards riffle off the inner
  // edge; fingers stay bent, supporting the cascade.
  bridgeRelease: pose(
    [0.46, 0.47, 0.0],
    euler(PALM_DOWN, 0, 0),
    f([0.12, 0.1, 0.06], [0.7, 0.55, 0.35], [0.74, 0.58, 0.36], [0.7, 0.55, 0.35], [0.64, 0.5, 0.32]),
    0.24,
  ),

  // Overhand pull: hand tips a peeled packet back onto the pile; thumb up.
  overhandPull: pose(
    [0.16, 0.46, 0.12],
    euler(PALM_DOWN, -0.2, 0),
    f([0.18, 0.15, 0.1], [0.62, 0.5, 0.3], [0.58, 0.46, 0.28], [0.52, 0.42, 0.26], [0.46, 0.36, 0.22]),
    0.22,
  ),

  // Flat, splayed palm hovering over a table wash.
  washFlat: pose(
    [0.5, 0.4, 0.2],
    euler(PALM_DOWN + 0.12, 0, 0),
    f([0.1, 0.08, 0.05], [0.18, 0.12, 0.06], [0.2, 0.14, 0.07], [0.18, 0.12, 0.06], [0.16, 0.1, 0.05]),
    0.4,
  ),

  // Packet grab: palm down, all fingers curled to cage a small packet from
  // above with the thumb opposing, the overhand "pick it up and carry it" grip.
  packetGrab: pose(
    [0.5, 0.44, 0.05],
    euler(PALM_DOWN, 0, 0),
    f([0.5, 0.6, 0.45], [0.85, 0.85, 0.6], [0.9, 0.9, 0.62], [0.85, 0.85, 0.6], [0.76, 0.76, 0.54]),
    0.12,
  ),

  // Bridge cage: both hands cup the squared, arched deck for the waterfall, the
  // thumb presses down on the top edge while the four fingers curl well under
  // the far edge, caging the spring so it can cascade out under control.
  bridgeCage: pose(
    [0.28, 0.5, 0.02],
    euler(PALM_DOWN + 0.08, 0, 0),
    f([0.45, 0.4, 0.28], [0.95, 0.78, 0.5], [1.0, 0.82, 0.52], [0.95, 0.78, 0.5], [0.86, 0.68, 0.44]),
    0.2,
  ),

  // Palm cradle: palm UP, fingers curling gently upward to cup a packet that
  // rests on the palm, the hindu/strip receiving hand. Fingers point away
  // from the dealer (-z) so the cupped pile faces the camera.
  palmCradle: pose(
    [0.62, 0.13, 0.12],
    euler(-PALM_DOWN + 0.12, 0, 0),
    f([0.3, 0.25, 0.15], [0.5, 0.45, 0.28], [0.55, 0.5, 0.3], [0.5, 0.45, 0.28], [0.44, 0.38, 0.24]),
    0.3,
  ),

  // Wash press: palm laid FLAT on the spread cards (washFlat only hovers),
  // fingers nearly straight so the whole hand slides the cards around.
  washPress: pose(
    [0.85, 0.2, 0.3],
    euler(PALM_DOWN + 0.06, 0, 0),
    f([0.12, 0.1, 0.06], [0.14, 0.1, 0.05], [0.16, 0.11, 0.06], [0.14, 0.1, 0.05], [0.12, 0.09, 0.05]),
    0.46,
  ),

  // Wide fan: fingers spread hard to bloom a pressure fan.
  fanSpread: pose(
    [0.45, 0.44, 0.15],
    euler(PALM_DOWN, 0.1, 0),
    f([0.3, 0.28, 0.18], [0.4, 0.3, 0.18], [0.35, 0.28, 0.16], [0.3, 0.24, 0.14], [0.26, 0.2, 0.12]),
    0.46,
  ),

  // --- Shared approach / rest grip -------------------------------------------
  // Every lesson used to open and close with both hands parked in `relaxed`,
  // a full card-width of air (0.66) between the nearest fingertip and the
  // nearest card, two mannequin hands floating beside a deck they never
  // touch. These two presets are the fix: the hand comes in from its own side
  // of the table, YAWED so the fingers point at the deck instead of at the
  // camera, and settles with the fingertips ON the top card.
  //
  // Geometry that lessons anchor against (world offsets from the wrist, right
  // hand, measured off this rig, see the note on `deckRest` below):
  //   fingertips reach ~0.60 inward (−x) and hang ~0.24 below the wrist;
  //   the thumb trails to −z, its fat base capsule staying above the fingers.
  // So `anchor.y = topCardY + DECK_REST_DROP` lands the tips tangent on a
  // squared deck, and any |anchor.x| ≳ 0.7 keeps the thumb off it entirely.

  // Approach: fingers flat and splayed, hovering, the pose a hand arrives in.
  deckApproach: pose(
    [0.98, 0.5, 0.06],
    eulerYXZ(PALM_DOWN + 0.1, REACH_IN, 0),
    f([0.14, 0.11, 0.07], [0.2, 0.14, 0.08], [0.22, 0.15, 0.09], [0.2, 0.14, 0.08], [0.17, 0.12, 0.07]),
    0.44,
  ),

  // Rest: the same hand closed onto the deck, fingers curled just enough that
  // the pads (not the knuckles) carry the contact, thumb braced outside the
  // long edge. This is what "the hands are holding something" looks like at
  // the start and end of a lesson.
  deckRest: pose(
    [0.78, 0.42, 0.02],
    eulerYXZ(PALM_DOWN + 0.12, REACH_IN, 0),
    f([0.24, 0.2, 0.13], [0.32, 0.24, 0.15], [0.35, 0.26, 0.16], [0.32, 0.24, 0.15], [0.27, 0.2, 0.12]),
    0.34,
  ),

  // Spring release: a firm bowed grip that lets the deck cascade.
  springRelease: pose(
    [0.5, 0.46, 0.02],
    euler(PALM_DOWN, 0, 0),
    f([0.2, 0.16, 0.1], [0.8, 0.62, 0.38], [0.84, 0.66, 0.4], [0.8, 0.62, 0.38], [0.72, 0.56, 0.34]),
    0.22,
  ),
}

// How far below the wrist each approach/rest preset's LOWEST finger surface
// hangs, plus a card's own half-thickness, i.e. how high above a top card's
// CENTRE the wrist must sit for the fingertips to land exactly tangent on it.
// Measured off the rig (handKinematics FK, all three capsules of all five
// fingers); a lesson anchors `y = topCardCentreY + DECK_*_DROP` and gets a
// contact instead of a fingertip buried in the stack.
// (Exact tangency is 0.352 / 0.269; both carry ~0.014 of extra air so the idle
// breathing overlay and the ease into the pose can't push a pad through a card.)
// DERIVED, not hardcoded: every one of these is a wrist-to-finger-surface
// distance, so it scales linearly with HAND_SCALE. Measuring them off the rig
// means HAND_SCALE is a single knob, change it and every lesson that anchors
// off these constants follows automatically, instead of 40-odd hand-tuned
// offsets silently going stale. (At HAND_SCALE 4.6 these reproduce the values
// they replace: 0.366 / 0.283 / 0.574.)
const _mj = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
function measureReach(p) {
  let drop = 0
  let reach = 0
  for (const name of FINGER_NAMES) {
    const j = fingerJointsWorld(p, 'right', name, _mj)
    const rad = FINGERS[name].rad
    for (let k = 1; k < 4; k++) {
      const r = rad[Math.min(k - 1, 2)] * HAND_SCALE
      drop = Math.max(drop, p.wrist.pos.y - j[k].y + r)
      reach = Math.max(reach, p.wrist.pos.x - j[k].x)
    }
  }
  return { drop, reach }
}
// Clearance so the idle-breathing overlay and the ease into a pose can't push a
// pad through a card. Scales with the hand: a bigger hand breathes bigger.
const CONTACT_AIR = 0.00296 * HAND_SCALE
const _rest = measureReach(HAND_POSES.deckRest)
const _approach = measureReach(HAND_POSES.deckApproach)

export const DECK_REST_DROP = _rest.drop + CARD_T / 2 + CONTACT_AIR
export const DECK_APPROACH_DROP = _approach.drop + CARD_T / 2 + CONTACT_AIR
// How far the fingertips reach toward the table centre (−x, right hand) from
// the wrist in these poses, pick |anchor.x| ≈ DECK_REACH + a little so the
// tips land on the deck while the fat thumb base stays outside its footprint.
export const DECK_REACH = _rest.reach

// Same idea for the `packetGrab` cage, which riffle/faro/overhand all anchor
// against (they each had their own hardcoded 0.465). The cage carries more air
// than a rest contact because it closes AROUND a packet rather than settling on
// one, that extra is hand-sized, so it scales here too.
export const PACKET_GRAB_DROP =
  measureReach(HAND_POSES.packetGrab).drop + CARD_T / 2 + 0.00908 * HAND_SCALE

// Resolve a named pose for a side, optionally re-anchoring the wrist to a world
// position supplied by the lesson step (lets each lesson place the hands on its
// own deck geometry, the fix for "hands don't sit at the deck halves").
export function getHandPose(name, side = 'right', anchor = null) {
  const base = HAND_POSES[name] || HAND_POSES.relaxed
  const pos = anchor
    ? new THREE.Vector3(anchor[0], anchor[1], anchor[2])
    : base.wrist.pos.clone()
  if (side === 'left') pos.x *= -1
  const out = {
    wrist: { pos, quat: base.wrist.quat.clone() },
    fingers: {
      thumb: [...base.fingers.thumb],
      index: [...base.fingers.index],
      middle: [...base.fingers.middle],
      ring: [...base.fingers.ring],
      pinky: [...base.fingers.pinky],
    },
    spread: base.spread,
  }
  // Optional pose-v2 fields (per-finger splay, animatable thumb opposition):
  // absent = zeros, so legacy presets stay byte-compatible.
  if (base.splay) out.splay = { ...base.splay }
  if (base.thumbOpp) out.thumbOpp = { ...base.thumbOpp }
  return out
}

// Deep-clone a pose (v2 fields included). Shared by the compiler and the
// sampler's idle overlay (which must never mutate a track's segment poses).
export function cloneHandPose(p) {
  const out = {
    wrist: { pos: p.wrist.pos.clone(), quat: p.wrist.quat.clone() },
    fingers: {
      thumb: [...p.fingers.thumb],
      index: [...p.fingers.index],
      middle: [...p.fingers.middle],
      ring: [...p.fingers.ring],
      pinky: [...p.fingers.pinky],
    },
    spread: p.spread,
  }
  if (p.splay) out.splay = { ...p.splay }
  if (p.thumbOpp) out.thumbOpp = { ...p.thumbOpp }
  return out
}

// Lerp two optional sparse-number records (missing key = 0). Returns undefined
// when both sides are absent so legacy poses stay lean.
function lerpSparse(a, b, t, keys) {
  if (!a && !b) return undefined
  const out = {}
  for (const k of keys) {
    const va = a?.[k] ?? 0
    out[k] = va + ((b?.[k] ?? 0) - va) * t
  }
  return out
}

// Interpolate two poses, slerp wrist, lerp joint angles.
export function lerpHandPose(a, b, t) {
  const out = {
    wrist: {
      pos: a.wrist.pos.clone().lerp(b.wrist.pos, t),
      quat: a.wrist.quat.clone().slerp(b.wrist.quat, t),
    },
    fingers: {},
    spread: a.spread + (b.spread - a.spread) * t,
  }
  for (const name of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
    out.fingers[name] = a.fingers[name].map((v, i) => v + (b.fingers[name][i] - v) * t)
  }
  const splay = lerpSparse(a.splay, b.splay, t, ['thumb', 'index', 'middle', 'ring', 'pinky'])
  if (splay) out.splay = splay
  const thumbOpp = lerpSparse(a.thumbOpp, b.thumbOpp, t, ['x', 'z'])
  if (thumbOpp) out.thumbOpp = thumbOpp
  return out
}
