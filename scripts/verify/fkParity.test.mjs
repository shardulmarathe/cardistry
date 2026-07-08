// FK ↔ rig parity: the pure FK module (handKinematics.js) must agree with the
// REAL scene-graph rig (handRig.js) to <1e-6 for every preset and a sweep of
// randomized poses, on both hands. This is the guard that makes blind
// authoring safe: if it passes, compile-time contact math is talking about the
// same fingertips the user sees.
//
// Run: node --import ./scripts/verify/register.mjs scripts/verify/fkParity.test.mjs
import * as THREE from 'three'
import { buildHandRig, applyHandPose } from '../../src/hands/handRig.js'
import { HAND_POSES, getHandPose } from '../../src/hands/handPoses.js'
import { FINGERS, FINGER_NAMES, JOINT_LIMITS } from '../../src/hands/handRigSpec.js'
import { fingerJointsWorld, fingertipWorld, solveFingerTo, DIST_COUPLING } from '../../src/hands/handKinematics.js'

let failures = 0
let checks = 0

function fail(msg) {
  failures++
  console.error(`  ✗ ${msg}`)
}

function assertClose(a, b, tol, label) {
  checks++
  const d = a.distanceTo(b)
  if (!(d < tol)) fail(`${label}: |Δ|=${d.toExponential(3)} (tol ${tol})`)
}

// Deterministic PRNG (same generator the lesson engine uses for seeds).
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Read a joint-chain point off the real rig: p in joint i's local space.
function rigPointWorld(rig, finger, jointIndex, p, out) {
  rig.root.updateWorldMatrix(true, true)
  return out.copy(p).applyMatrix4(rig.fingers[finger].joints[jointIndex].matrixWorld)
}

const rigs = { right: buildHandRig('right'), left: buildHandRig('left') }
const _tip = new THREE.Vector3()
const _fk = new THREE.Vector3()
const _p = new THREE.Vector3()
const _fkJoints = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]

function checkPose(pose, side, label) {
  const rig = rigs[side]
  applyHandPose(rig, pose)
  for (const name of FINGER_NAMES) {
    const spec = FINGERS[name]
    // Fingertip: (0, len2, 0) in the distal joint's local space.
    rigPointWorld(rig, name, 2, _p.set(0, spec.len[2], 0), _tip)
    fingertipWorld(pose, side, name, _fk)
    assertClose(_fk, _tip, 1e-6, `${label}/${side}/${name} tip`)

    // Every joint pivot along the chain.
    fingerJointsWorld(pose, side, name, _fkJoints)
    for (let i = 0; i < 3; i++) {
      rigPointWorld(rig, name, i, _p.set(0, 0, 0), _tip)
      assertClose(_fkJoints[i], _tip, 1e-6, `${label}/${side}/${name} joint${i}`)
    }
  }
}

// 1. All named presets, both sides.
for (const name of Object.keys(HAND_POSES)) {
  for (const side of ['right', 'left']) {
    checkPose(getHandPose(name, side), side, `preset:${name}`)
  }
}

// 2. Randomized poses: random wrist transform, curls, spread — plus the v2
//    fields (per-finger splay, thumb opposition) so FK stays honest when the
//    rig learns them.
const rand = mulberry32(1234)
const range = (lo, hi) => lo + rand() * (hi - lo)
for (let k = 0; k < 60; k++) {
  const pose = getHandPose('relaxed', 'right')
  pose.wrist.pos.set(range(-2, 2), range(0, 2), range(-2, 2))
  pose.wrist.quat
    .set(range(-1, 1), range(-1, 1), range(-1, 1), range(-1, 1))
    .normalize()
  pose.spread = range(0, 0.46)
  for (const name of FINGER_NAMES) {
    pose.fingers[name] = [
      range(JOINT_LIMITS.min, JOINT_LIMITS.max),
      range(JOINT_LIMITS.min, JOINT_LIMITS.max),
      range(JOINT_LIMITS.min, JOINT_LIMITS.max),
    ]
  }
  // Pose-v2 fields on odd iterations (even ones keep them absent → legacy path).
  if (k % 2 === 1) {
    pose.splay = {}
    for (const name of FINGER_NAMES) pose.splay[name] = range(-0.3, 0.3)
    pose.thumbOpp = { x: range(-0.4, 0.4), z: range(-0.4, 0.4) }
  }
  for (const side of ['right', 'left']) {
    const p = side === 'left' ? { ...pose, wrist: { pos: pose.wrist.pos.clone().setX(-pose.wrist.pos.x), quat: pose.wrist.quat } } : pose
    checkPose(p, side, `random:${k}`)
  }
}

// 3. Mirror invariant: left tips are the exact X-mirror of right tips.
const _l = new THREE.Vector3()
const _r = new THREE.Vector3()
for (const name of Object.keys(HAND_POSES)) {
  const right = getHandPose(name, 'right')
  const left = getHandPose(name, 'left')
  for (const finger of FINGER_NAMES) {
    fingertipWorld(right, 'right', finger, _r)
    fingertipWorld(left, 'left', finger, _l)
    _r.x = -_r.x
    assertClose(_l, _r, 1e-9, `mirror:${name}/${finger}`)
  }
}

// 4. IK round-trip: generate a reachable target with FK (random curls obeying
//    the distal coupling), then solveFingerTo must recover it to <1mm world.
const ikRand = mulberry32(777)
const ikRange = (lo, hi) => lo + ikRand() * (hi - lo)
const _target = new THREE.Vector3()
for (let k = 0; k < 40; k++) {
  const pose = getHandPose('relaxed', 'right')
  pose.spread = ikRange(0.1, 0.4)
  pose.wrist.pos.set(ikRange(-1, 1), ikRange(0, 1), ikRange(-1, 1))
  pose.wrist.quat.set(ikRange(-1, 1), ikRange(-1, 1), ikRange(-1, 1), ikRange(-1, 1)).normalize()
  for (const side of ['right', 'left']) {
    for (const finger of FINGER_NAMES) {
      const a0 = ikRange(0.05, 1.1)
      const a1 = ikRange(0.05, 1.0)
      const truth = { ...pose, fingers: { ...pose.fingers, [finger]: [a0, a1, DIST_COUPLING * a1] } }
      fingertipWorld(truth, side, finger, _target)
      const solved = solveFingerTo(pose, side, finger, _target)
      checks++
      if (!(solved.error < 1e-3 && solved.planeError < 1e-3)) {
        fail(`ik:${k}/${side}/${finger}: error=${solved.error.toExponential(2)} plane=${solved.planeError.toExponential(2)}`)
      }
    }
  }
}

if (failures > 0) {
  console.error(`\nfkParity: ${failures} FAILED of ${checks} checks`)
  process.exit(1)
}
console.log(`fkParity: ${checks} checks passed`)
