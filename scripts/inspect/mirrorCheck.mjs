// DOES A RIGHT-AUTHORED GRIP SURVIVE MIRRORING ONTO THE LEFT HAND?
//
// This is the first blocker on any two-handed lesson, and the codebase warns about
// it without ever measuring it: `grips.js` mirrors a grip frame's POSITION but not
// its QUATERNION, and tableGrip's `tilt` note records a 2x error from exactly that
// ("a wrist roll of -tilt turns the left hand +tilt on screen but turns the packet
// it is holding -tilt ... 0.17 of finger inside the riffle's own halves").
//
// The engine's rule: a lesson hands the SAME pose object to both sides. The left
// hand is the right rig under root.scale.x < 0, its anchor's x is negated, and its
// joint angles are identical. So a right-authored grip is correct on the left hand
// if and only if the cards it grips are the exact x-mirror of the right-hand case.
//
// Measured here: solve a pinch on a packet at +x, then evaluate the SAME pose as
// 'left' against the x-mirrored packet, and compare pad gaps. Equal gaps means the
// mirror is safe and two-handed grips can share one solve. Unequal means every
// left-hand grip needs its own.
//
// Run: node --import ./scripts/verify/register.mjs scripts/inspect/mirrorCheck.mjs
import * as THREE from 'three'
import { edgePinchGripAuto } from '../../src/lessons/authoring/contacts.js'
import { faceQuat } from '../../src/lessons/engine/layouts.js'
import { fingertipWorld } from '../../src/hands/handKinematics.js'
import { FINGERS, HAND_SCALE } from '../../src/hands/handRigSpec.js'
import { cardSurfaceExtents } from '../../src/lessons/authoring/contacts.js'
import { CARD_GAP } from '../../src/lib/constants.js'

const M = new THREE.Matrix4().makeScale(-1, 1, 1)
// The x-mirror of a rotation is M R M. Expressed as a quaternion this negates the
// x and w... no: derive it numerically so no algebra can be wrong.
function mirrorQuat(q) {
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q)
  const mm = new THREE.Matrix4().multiplyMatrices(M, new THREE.Matrix4().multiplyMatrices(m, M))
  // M R M is a rotation (det = +1) whenever R is, so this round-trips cleanly.
  return new THREE.Quaternion().setFromRotationMatrix(mm)
}

// WHICH FACE a pad is really on, not just how far it is from the nearest card.
// Distance alone scores a finger resting on the deck's BACK as a pad in contact,
// which is how a grip that missed every target by a third of a card can still
// report 3/3. Agent B's probe caught two false passes this way.
function faceOf(e) {
  const ax = [['x', e.x], ['u', e.u], ['n', e.n]].sort((a, b) => b[1] - a[1])[0]
  return ax[0]
}
const _t = new THREE.Vector3()
function gapFace(pose, side, name, cards) {
  fingertipWorld(pose, side, name, _t)
  let best = Infinity
  let face = '?'
  for (const c of cards) {
    const lp = _t.clone().sub(c.pos).applyQuaternion(c.quat.clone().invert())
    const e = cardSurfaceExtents(lp, c.bend ?? 0)
    const o = Math.hypot(Math.max(e.x, 0), Math.max(e.u, 0), Math.max(e.n, 0))
    const g = o > 0 ? o : Math.max(e.x, e.u, e.n)
    if (g < best) { best = g; face = faceOf(e) }
  }
  return { gap: best - FINGERS[name].rad[2] * HAND_SCALE, face }
}
function gap(pose, side, name, cards) {
  fingertipWorld(pose, side, name, _t)
  let best = Infinity
  for (const c of cards) {
    const lp = _t.clone().sub(c.pos).applyQuaternion(c.quat.clone().invert())
    const e = cardSurfaceExtents(lp, c.bend ?? 0)
    const o = Math.hypot(Math.max(e.x, 0), Math.max(e.u, 0), Math.max(e.n, 0))
    const g = o > 0 ? o : Math.max(e.x, e.u, e.n)
    if (g < best) best = g
  }
  return best - FINGERS[name].rad[2] * HAND_SCALE
}

const HALF = 26
const deckH = (HALF - 1) * CARD_GAP
const pad = (s, n) => String(s).padEnd(n)

console.log('A right-authored pinch, then the SAME pose evaluated as the LEFT hand')
console.log('against the x-mirrored packet. Equal gaps => one solve serves both.\n')
console.log(pad('packet quat', 30), pad('side', 6), pad('thumb', 9), pad('middle', 9), 'index')

for (const [label, q] of [
  ['portrait face-down', faceQuat(false)],
  ['landscape (yaw 90)', faceQuat(false, Math.PI / 2)],
  ['riffle half (yaw 90-0.22)', faceQuat(false, Math.PI / 2 - 0.22)],
]) {
  const CX = 0.45
  const g = edgePinchGripAuto({
    centerX: CX, centerZ: 0, baseY: 1.0, deckH, squeeze: 0.3, cardQuat: q, axis: 'end',
  })
  const right = [0, 0.5, 1].map((f) => ({ pos: new THREE.Vector3(CX, 1.0 + deckH * f, 0), quat: q, bend: 0 }))
  const mq = mirrorQuat(q)
  const left = [0, 0.5, 1].map((f) => ({ pos: new THREE.Vector3(-CX, 1.0 + deckH * f, 0), quat: mq, bend: 0 }))

  const names = ['thumb', 'middle', 'index']
  const rg = names.map((n) => gap(g.pose, 'right', n, right))
  // The engine gives the left hand the SAME pose object with its anchor x negated;
  // fingertipWorld('left') applies the rig's negative x-scale. Replicate exactly.
  const lp = {
    ...g.pose,
    wrist: { pos: g.pose.wrist.pos.clone().setX(-g.pose.wrist.pos.x), quat: g.pose.wrist.quat },
  }
  const lg = names.map((n) => gap(lp, 'left', n, left))
  console.log(pad(label, 30), pad('right', 6), ...rg.map((v) => pad(v.toFixed(4), 9)))
  console.log(pad('', 30), pad('left', 6), ...lg.map((v) => pad(v.toFixed(4), 9)))
  const worst = Math.max(...names.map((_, i) => Math.abs(rg[i] - lg[i])))
  console.log(pad('', 30), `mirror discrepancy ${worst.toFixed(4)}` + (worst < 0.002 ? '  SAFE' : '  <-- NOT SAFE'))
}

// --- Is a YAWED packet still a problem for the pinch? -----------------------
// TECHNIQUE_REFERENCE.md records reach 0.3429 for a 90deg-yawed packet, which was
// measured on the PRE-REWRITE pinch. Re-measure against the current one.
console.log('\nyawed packets, reach residual on the CURRENT pinch:')
for (const [label, q] of [
  ['portrait (canonical)', faceQuat(false)],
  ['yaw 45', faceQuat(false, Math.PI / 4)],
  ['yaw 90-0.22 (riffle half)', faceQuat(false, Math.PI / 2 - 0.22)],
  ['yaw 90', faceQuat(false, Math.PI / 2)],
]) {
  const g = edgePinchGripAuto({
    centerX: 0.45, centerZ: 0, baseY: 1.0, deckH, squeeze: 0.3, cardQuat: q, axis: 'end',
  })
  const m = g.measured
  const cards = [0, 0.5, 1].map((f) => ({ pos: new THREE.Vector3(0.45, 1.0 + deckH * f, 0), quat: q, bend: 0 }))
  // An `end` pinch wants thumb on one END face (u), middle on the other (u), and
  // the index on the broad face (n). Any other combination is a false pass.
  const faces = ['thumb', 'middle', 'index'].map((n) => gapFace(g.pose, 'right', n, cards).face)
  const wanted = ['u', 'u', 'n']
  const ok = faces.every((f, i) => f === wanted[i])
  console.log(
    `  ${pad(label, 26)} reach ${m.reach.toFixed(4)}  pads ${m.touching}/${m.of}  deepest ${m.deepest.toFixed(4)}` +
      `  faces ${faces.join('/')} ${ok ? '(right faces)' : '<-- WRONG FACES, false pass'}`,
  )
}
