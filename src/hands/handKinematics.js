import * as THREE from 'three'
import { HAND_SCALE, FINGERS, FINGER_NAMES, THUMB_BASE_ROT, JOINT_LIMITS } from './handRigSpec'

// Pure forward kinematics for the procedural hand — where every knuckle and
// fingertip is in WORLD space, as a pure function of (pose, side). Mirrors the
// exact scene-graph chain built in handRig.js:
//
//   world = T(wrist.pos) · S(±HAND_SCALE) · R(wrist.quat)
//           · T(finger.base) · R_euler(fingerX, splayY, fingerZ, 'XYZ')
//           · [ R_x(a0) · T(0,len0,0) · R_x(a1) · T(0,len1,0) · R_x(a2) ] · p
//
// Runs headless (THREE math classes only) so the compile step and the verify
// harness can reason about contact without a renderer. fkParity.test.mjs
// asserts this module and the real rig agree to <1e-6 — keep them in lockstep.
//
// MIRROR POLICY (the load-bearing rule): the left hand is the right rig under
// root.scale.x<0, so left WORLD POINTS are the exact X-mirror of right's and
// are safe to compute (negate x after rotate+scale). But a mirrored basis is
// left-handed — never build an orientation by decomposing mirrored axes into a
// quaternion. Any orientation derived here is composed as
// wrist.quat ∘ f(joint angles) only (angles are never mirrored; the rig's
// negative scale does all the mirroring).

const _eul = new THREE.Euler()
const _rx = new THREE.Quaternion()
const _seg = new THREE.Vector3()
const _xAxis = new THREE.Vector3(1, 0, 0)

// Effective knuckle rotation for a finger under a pose (v2-ready: optional
// pose.splay per-finger additive yaw, pose.thumbOpp additive opposition).
function knuckleEuler(name, pose, out) {
  const spec = FINGERS[name]
  const extraSplay = pose.splay?.[name] ?? 0
  if (name === 'thumb') {
    const opp = pose.thumbOpp
    out.set(
      THUMB_BASE_ROT.x + (opp?.x ?? 0),
      spec.splay + extraSplay,
      THUMB_BASE_ROT.z + (opp?.z ?? 0),
      'XYZ',
    )
  } else {
    out.set(0, spec.splay * pose.spread + extraSplay, 0, 'XYZ')
  }
  return out
}

// Joint positions of one finger in WRIST-LOCAL space (unscaled, unmirrored):
// out[0]=knuckle, out[1]=PIP, out[2]=DIP, out[3]=tip. `outQuat`, if given,
// receives the distal phalange's orientation in the same frame.
export function fingerJointsLocal(pose, name, out, outQuat = null) {
  const spec = FINGERS[name]
  const angles = pose.fingers[name]
  const q = (outQuat ?? _tmpQuat).setFromEuler(knuckleEuler(name, pose, _eul))
  out[0].set(spec.base[0], spec.base[1], spec.base[2])
  let prev = out[0]
  for (let i = 0; i < 3; i++) {
    q.multiply(_rx.setFromAxisAngle(_xAxis, angles[i]))
    out[i + 1].copy(_seg.set(0, spec.len[i], 0).applyQuaternion(q)).add(prev)
    prev = out[i + 1]
  }
  return out
}
const _tmpQuat = new THREE.Quaternion()

// Map a wrist-local point to WORLD space for a side: rotate by the wrist quat,
// scale, mirror x for the left hand, translate. (Scale is OUTSIDE the wrist
// rotation in the rig: root carries position+scale, the wrist group the quat.)
export function wristLocalToWorld(pose, side, p, out) {
  out.copy(p).applyQuaternion(pose.wrist.quat).multiplyScalar(HAND_SCALE)
  if (side === 'left') out.x = -out.x
  return out.add(pose.wrist.pos)
}

// World-space joint positions for one finger: [knuckle, PIP, DIP, tip].
export function fingerJointsWorld(pose, side, name, out) {
  fingerJointsLocal(pose, name, out)
  for (let i = 0; i < 4; i++) wristLocalToWorld(pose, side, out[i], out[i])
  return out
}

const _joints = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]

// World-space fingertip position for one finger.
export function fingertipWorld(pose, side, name, out) {
  fingerJointsLocal(pose, name, _joints)
  return wristLocalToWorld(pose, side, _joints[3], out.copy(_joints[3]))
}

// Convenience for harness/authoring code (allocates — not for the hot path).
export function allFingertipsWorld(pose, side) {
  const tips = {}
  for (const name of FINGER_NAMES) {
    tips[name] = fingertipWorld(pose, side, name, new THREE.Vector3())
  }
  return tips
}

// Mean curl of a finger set (0=straight, ~1.65=full fist per joint) — used to
// pitch contact frames as the grip tightens/opens.
export function meanCurl(pose, names) {
  let sum = 0
  let n = 0
  for (const name of names) {
    const a = pose.fingers[name]
    sum += (a[0] + a[1] + a[2]) / 3
    n++
  }
  return n ? sum / n : 0
}

// ---------------------------------------------------------------------------
// Contact frames: where a GRIPPED packet rides. Instead of welding cards to
// the wrist, a hold can pick a frame derived from fingertip world positions —
// then a thumb ratchet or a finger curl visibly moves the held cards. The
// orientation is composed as wrist.quat ∘ R_x(pitch(curl)) — never decomposed
// from (possibly mirrored) tip positions — so it obeys the mirror policy and
// pitches the packet as the grip curls open/closed.
//
// Weights per frame type: which fingertips define the carry position, and
// which fingers a grip's `pressure` visibly tightens.
export const GRIP_FRAME_TYPES = {
  pinch: {
    tips: { thumb: 0.5, index: 0.5 },
    pitchFrom: ['thumb', 'index'],
    pitchGain: 0.3,
    pressure: { thumb: 1, index: 0.9, middle: 0.35 },
  },
  packet: {
    tips: { thumb: 0.5, index: 0.25, middle: 0.25 },
    pitchFrom: ['index', 'middle'],
    pitchGain: 0.3,
    pressure: { thumb: 1, index: 0.8, middle: 0.8, ring: 0.5, pinky: 0.3 },
  },
  thumbPeel: {
    tips: { thumb: 0.75, index: 0.125, middle: 0.125 },
    pitchFrom: ['thumb'],
    pitchGain: 0.35,
    pressure: { thumb: 1, index: 0.3, middle: 0.3 },
  },
  // Charlier pivot: the packet rides the INDEX fingertip, and extending the
  // finger swings it — the high pitch gain converts the index's curl change
  // into the packet's up-and-over rotation (one-handed cuts).
  indexPivot: {
    tips: { index: 1 },
    pitchFrom: ['index'],
    // Negative: as the index EXTENDS (curl falls), the packet's swing must
    // compound with the fingertip's own arc, not cancel it — sign chosen
    // empirically against the charlier up-and-over trajectory check.
    pitchGain: -2.2,
    pressure: { index: 1, middle: 0.4 },
  },
}

const _tipAcc = new THREE.Vector3()
const _tipOne = new THREE.Vector3()
const _pitchQ = new THREE.Quaternion()

// Compute the contact frame for a pose. type 'wrist' (or unknown) falls back
// to the legacy wrist frame. Writes into out {pos, quat} and returns it.
export function contactFrame(pose, side, type, out) {
  const spec = GRIP_FRAME_TYPES[type]
  if (!spec) {
    out.pos.copy(pose.wrist.pos)
    out.quat.copy(pose.wrist.quat)
    return out
  }
  _tipAcc.set(0, 0, 0)
  for (const name in spec.tips) {
    fingertipWorld(pose, side, name, _tipOne)
    _tipAcc.addScaledVector(_tipOne, spec.tips[name])
  }
  out.pos.copy(_tipAcc)
  const pitch = spec.pitchGain * meanCurl(pose, spec.pitchFrom)
  out.quat.copy(pose.wrist.quat).multiply(_pitchQ.setFromAxisAngle(_xAxis, pitch))
  return out
}

// Visibly tighten a grip: pressure p (0..1) adds curl to the frame type's
// gripping fingers. Mutates the (already-cloned, sampled) pose. Applied by BOTH
// the runtime sampler and compile-time grip capture, in the same order, so
// captured offsets always match what renders.
const PRESSURE_CURL = 0.14
const PRESSURE_JOINT_WEIGHTS = [1, 0.7, 0.45]
export function applyGripPressure(pose, type, p) {
  const spec = GRIP_FRAME_TYPES[type]
  if (!spec || !p) return pose
  for (const name in spec.pressure) {
    const angles = pose.fingers[name]
    const d = PRESSURE_CURL * p * spec.pressure[name]
    for (let j = 0; j < 3; j++) angles[j] += d * PRESSURE_JOINT_WEIGHTS[j]
  }
  return pose
}

// ---------------------------------------------------------------------------
// Analytic fingertip IK (compile-time authoring — NOT run per frame).
//
// Curls are pure local-X rotations, so a finger's chain lives in the plane
// x=0 of its post-splay knuckle frame: a rotation by cumulative angle t sends
// a phalange (0,L,0) to (0, L·cos t, L·sin t). With the human-like coupling
// a2 = DIST_COUPLING·a1 the tip is a closed-form function of (a0, a1):
//   tip(a0,a1) = Σ Lᵢ·(cos tᵢ, sin tᵢ),  t₀=a0, t₁=a0+a1, t₂=a0+(1+r)·a1
// solved with a fixed-iteration damped Gauss–Newton (deterministic, pure).
// The knuckle-frame X component of the target is unreachable by curls (splay
// is fixed by the pose) and is reported back as `planeError`.

export const DIST_COUPLING = 0.75

const _inv = new THREE.Quaternion()
const _kq = new THREE.Quaternion()
const _t = new THREE.Vector3()

// Map a WORLD point into a finger's knuckle-local frame for a pose/side.
export function worldToKnuckle(pose, side, name, world, out) {
  const spec = FINGERS[name]
  out.copy(world).sub(pose.wrist.pos)
  if (side === 'left') out.x = -out.x
  out.multiplyScalar(1 / HAND_SCALE)
  out.applyQuaternion(_inv.copy(pose.wrist.quat).invert())
  out.sub(_t.set(spec.base[0], spec.base[1], spec.base[2]))
  _kq.setFromEuler(knuckleEuler(name, pose, _eul))
  return out.applyQuaternion(_inv.copy(_kq).invert())
}

const clampJoint = (a) => Math.min(JOINT_LIMITS.max, Math.max(JOINT_LIMITS.min, a))

// Solve joint angles [a0,a1,a2] so `name`'s tip lands on targetWorld (as close
// as curls allow). Returns { angles, error, planeError }. Pure + deterministic:
// fixed 24 Gauss–Newton iterations from the pose's current curl.
export function solveFingerTo(pose, side, name, targetWorld) {
  const spec = FINGERS[name]
  const [L0, L1, L2] = spec.len
  const v = worldToKnuckle(pose, side, name, targetWorld, new THREE.Vector3())
  const ty = v.y
  const tz = v.z
  const r = DIST_COUPLING

  let a0 = pose.fingers[name][0]
  let a1 = pose.fingers[name][1]
  const tip = (p0, p1) => {
    const t0 = p0
    const t1 = p0 + p1
    const t2 = p0 + (1 + r) * p1
    return [
      L0 * Math.cos(t0) + L1 * Math.cos(t1) + L2 * Math.cos(t2),
      L0 * Math.sin(t0) + L1 * Math.sin(t1) + L2 * Math.sin(t2),
    ]
  }
  for (let it = 0; it < 24; it++) {
    const [y, z] = tip(a0, a1)
    const ey = ty - y
    const ez = tz - z
    // Jacobian of (y,z) wrt (a0,a1), closed form.
    const t0 = a0
    const t1 = a0 + a1
    const t2 = a0 + (1 + r) * a1
    const dy0 = -L0 * Math.sin(t0) - L1 * Math.sin(t1) - L2 * Math.sin(t2)
    const dz0 = L0 * Math.cos(t0) + L1 * Math.cos(t1) + L2 * Math.cos(t2)
    const dy1 = -L1 * Math.sin(t1) - (1 + r) * L2 * Math.sin(t2)
    const dz1 = L1 * Math.cos(t1) + (1 + r) * L2 * Math.cos(t2)
    const det = dy0 * dz1 - dy1 * dz0
    if (Math.abs(det) < 1e-9) break
    // Damped Newton step (0.8 keeps it stable near the straight-arm singularity).
    a0 = clampJoint(a0 + (0.8 * (ey * dz1 - ez * dy1)) / det)
    a1 = clampJoint(a1 + (0.8 * (ez * dy0 - ey * dz0)) / det)
  }
  const [y, z] = tip(a0, a1)
  const angles = [a0, a1, r * a1]
  return {
    angles,
    error: Math.hypot(ty - y, tz - z) * HAND_SCALE,
    planeError: Math.abs(v.x) * HAND_SCALE,
  }
}

// Thumb IK: the thumb's curl plane is set by its opposition (thumbOpp swings
// the whole metacarpal), so a planar solve alone can't reach an off-plane
// target. Grid-search thumbOpp.z (± about the rig's base opposition), planar-
// solve inside each candidate plane, keep the best total error. Returns
// { angles, thumbOpp, error } — write both into the pose.
export function solveThumbTo(pose, side, targetWorld, { oppRange = 0.9, steps = 25 } = {}) {
  let best = null
  const probe = { ...pose, thumbOpp: { x: pose.thumbOpp?.x ?? 0, z: 0 } }
  for (let i = 0; i < steps; i++) {
    const oppZ = -oppRange + (2 * oppRange * i) / (steps - 1)
    probe.thumbOpp = { x: pose.thumbOpp?.x ?? 0, z: oppZ }
    const s = solveFingerTo(probe, side, 'thumb', targetWorld)
    const total = Math.hypot(s.error, s.planeError)
    if (!best || total < best.total) {
      best = { angles: s.angles, thumbOpp: { ...probe.thumbOpp }, error: s.error, planeError: s.planeError, total }
    }
  }
  return best
}
