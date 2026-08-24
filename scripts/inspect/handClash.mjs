// HAND VERSUS HAND. Nothing in this harness has ever measured it: every contact and
// penetration metric asks about a hand against the CARDS. Two hands driving through
// each other is invisible to all of them, and it is plainly visible on screen - a user
// looking at the riffle reported "see how the thumbs are interweaved, that is not
// good" while every gate was green.
//
// It matters more than it used to. The hands were 55%-translucent, which hid
// interpenetration; they are opaque and depth-writing now, so two hands sharing a
// volume reads as one melted shape. ARCHITECTURE has carried the rule for a long time
// ("converging palms need >= 0.5 x-separation") with nothing enforcing it.
//
// Method: every finger phalange is a CAPSULE (segment + radius) and the palm/thenar
// are slabs sampled as spheres. Capsule-capsule clearance is the segment-to-segment
// distance minus the two radii, which is exact for capsules and conservative for the
// slab spheres. Negative clearance is interpenetration, reported in CARD THICKNESSES
// as well as millimetres so it can be compared with every other depth in the app.
//
// Run: node --import ./scripts/verify/register.mjs scripts/inspect/handClash.mjs
import * as THREE from 'three'
import { compileLesson } from '../../src/lessons/engine/compileLesson.js'
import { sampleTrack } from '../../src/lessons/engine/sampleTrack.js'
import { createDeck } from '../../src/deckModel.js'
import { LESSONS } from '../../src/lessons/catalog/index.js'
import { fingerJointsWorld, wristLocalToWorld } from '../../src/hands/handKinematics.js'
import {
  FINGERS, FINGER_NAMES, HAND_SCALE, PALM_MM, THENAR_MM, WRIST_MM, mmToRig,
} from '../../src/hands/handRigSpec.js'
import { CARD_T } from '../../src/lib/constants.js'

const N = 200
const MM = 100.79

// Closest distance between two segments (Ericson, Real-Time Collision Detection).
function segSeg(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1)
  const d2 = q2.clone().sub(p2)
  const r = p1.clone().sub(p2)
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r)
  let s, t
  const EPS = 1e-12
  if (a <= EPS && e <= EPS) return r.length()
  if (a <= EPS) { s = 0; t = Math.min(1, Math.max(0, f / e)) }
  else {
    const c = d1.dot(r)
    if (e <= EPS) { t = 0; s = Math.min(1, Math.max(0, -c / a)) }
    else {
      const b = d1.dot(d2)
      const denom = a * e - b * b
      s = denom !== 0 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0
      t = (b * s + f) / e
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)) }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)) }
    }
  }
  return d1.multiplyScalar(s).add(p1).sub(d2.multiplyScalar(t).add(p2)).length()
}

const slabSpheres = (M) => {
  const [sx, sy, sz] = M.size.map(mmToRig)
  const [px, py, pz] = M.pos.map(mmToRig)
  const r = Math.min(sx, sz) / 2
  const out = []
  for (let a = -1; a <= 1; a++) {
    for (let b = -1; b <= 1; b++) out.push({ p: new THREE.Vector3(px + (a * sx) / 2, py + (b * sy) / 2, pz), r })
  }
  return out
}
const SLABS = [...slabSpheres(PALM_MM), ...slabSpheres(THENAR_MM)]
const WRIST_R = mmToRig(WRIST_MM.dia / 2)
const WRIST_P = WRIST_MM.pos.map(mmToRig)

const _j = [0, 1, 2, 3].map(() => new THREE.Vector3())
const _w = new THREE.Vector3()

// Every capsule of one hand as {a, b, r, name}, in world space.
function capsules(pose, side) {
  const out = []
  for (const name of FINGER_NAMES) {
    fingerJointsWorld(pose, side, name, _j)
    for (let s = 0; s < 3; s++) {
      out.push({
        a: _j[s].clone(), b: _j[s + 1].clone(),
        r: FINGERS[name].rad[s] * HAND_SCALE,
        name: `${name}[${['prox', 'mid', 'dist'][s]}]`,
      })
    }
  }
  for (const sp of SLABS) {
    wristLocalToWorld(pose, side, sp.p, _w)
    out.push({ a: _w.clone(), b: _w.clone(), r: sp.r * HAND_SCALE, name: 'palm' })
  }
  wristLocalToWorld(pose, side, new THREE.Vector3(WRIST_P[0], WRIST_P[1], WRIST_P[2]), _w)
  out.push({ a: _w.clone(), b: _w.clone(), r: WRIST_R * HAND_SCALE, name: 'wrist' })
  return out
}

console.log('HAND vs HAND clearance. Negative = the two hands share a volume.')
console.log('lesson      worst clearance            worst pair                        worst step')
for (const lesson of LESSONS) {
  const track = compileLesson(lesson, createDeck())
  let worst = Infinity, where = '', at = 0, step = ''
  const perStep = new Map()
  for (let i = 0; i <= N; i++) {
    const ms = (track.duration * i) / N
    const scene = sampleTrack(track, ms)
    const L = scene.hands.left, R = scene.hands.right
    if (!L || !R) continue
    const cl = capsules(L, 'left'), cr = capsules(R, 'right')
    let frameWorst = Infinity
    for (const x of cl) {
      for (const y of cr) {
        const d = segSeg(x.a, x.b, y.a, y.b) - x.r - y.r
        if (d < frameWorst) frameWorst = d
        if (d < worst) {
          worst = d
          where = `L:${x.name} x R:${y.name}`
          at = ms
          step = track.steps.find((q) => ms >= q.tStart && ms <= q.tEnd)?.id ?? '?'
        }
      }
    }
    if (frameWorst < 0) {
      const sid = track.steps.find((q) => ms >= q.tStart && ms <= q.tEnd)?.id ?? '?'
      perStep.set(sid, (perStep.get(sid) ?? 0) + 1)
    }
  }
  if (worst === Infinity) { console.log(`${lesson.id.padEnd(11)} single-handed lesson - no pair to measure`); continue }
  const ws = [...perStep.entries()].sort((a, b) => b[1] - a[1])[0]
  const tag = worst < 0 ? `${(worst * MM).toFixed(1)}mm = ${(-worst / CARD_T).toFixed(1)} cards INSIDE` : `${(worst * MM).toFixed(1)}mm clear`
  console.log(
    `${lesson.id.padEnd(11)} ${tag.padEnd(26)} ${where.padEnd(33)} ${step} @${Math.round(at)}ms` +
      (ws ? `   overlapping frames: ${ws[0]} (${ws[1]})` : ''),
  )
}
