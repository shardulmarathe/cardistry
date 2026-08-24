// WASH RAKE PROBE. The wash is the one lesson the contact metrics cannot judge: nothing
// in it is gripped, so `tryLesson` reports "0% of 0" and a penetration of 0.0000 whether
// the hands are raking the cards or waving beside them. This measures the two things
// that actually decide whether it looks and works like a wash:
//
//   * PAD REACH vs CARD SPREAD - cards only move when a pad crosses them, so a spread
//     wider than the hands can rake leaves frozen cards at its edges.
//   * PATH LENGTH per card over the smoosh window, which is how you detect those.
//   * PAD-TO-CARD CLEARANCE per step, added because neither of the other two can see a
//     HOVER. Reach and path length were both satisfied by a lesson whose palms never
//     came within 16mm of a card: the pads swept the right area and the cards moved,
//     so both numbers looked healthy while the hands were plainly floating. A single
//     authored constant (CONTACT_AIR) was being quoted as if it were a measurement.
//     This reports the closest approach AND the median, per step, because the minimum
//     alone is reached for a few frames of one pass and says nothing about the other
//     three seconds.
//
// Usage: node --import ./scripts/verify/register.mjs scripts/inspect/washRake.mjs
import { createDeck } from '../../src/deckModel.js'
import { compileLesson } from '../../src/lessons/engine/compileLesson.js'
import { sampleTrack } from '../../src/lessons/engine/sampleTrack.js'
import { fingertipWorld, fingerJointsWorld } from '../../src/hands/handKinematics.js'
import { FINGERS, FINGER_NAMES, HAND_SCALE } from '../../src/hands/handRigSpec.js'
import { cardSurfaceExtents } from '../../src/lessons/authoring/contacts.js'
import { washLesson } from '../../src/lessons/catalog/wash.lesson.js'
import * as THREE from 'three'

const track = compileLesson(washLesson, createDeck())
const t = new THREE.Vector3()
let padX = 0, padZ = [Infinity, -Infinity]
let cardX = 0, cardZ = [Infinity, -Infinity]
for (let i = 0; i <= 300; i++) {
  const ms = (track.duration * i) / 300
  const s = sampleTrack(track, ms)
  for (const side of ['left', 'right']) {
    const pose = s.hands[side]
    if (!pose) continue
    for (const nm of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
      fingertipWorld(pose, side, nm, t)
      padX = Math.max(padX, Math.abs(t.x))
      padZ = [Math.min(padZ[0], t.z), Math.max(padZ[1], t.z)]
    }
  }
  for (const [, c] of s.cards) {
    cardX = Math.max(cardX, Math.abs(c.pos.x))
    cardZ = [Math.min(cardZ[0], c.pos.z), Math.max(cardZ[1], c.pos.z)]
  }
}
console.log(`pads   |x| <= ${padX.toFixed(2)}   z ${padZ[0].toFixed(2)}..${padZ[1].toFixed(2)}`)
console.log(`cards  |x| <= ${cardX.toFixed(2)}   z ${cardZ[0].toFixed(2)}..${cardZ[1].toFixed(2)}`)

// FROZEN CARDS, measured as PATH LENGTH and not net displacement. Net is the wrong
// metric here and measuring it first was a mistake worth recording: `smoosh-2` runs
// with cyc -1, counter-rotating `smoosh-1`, so cards orbit out and come back and the
// net travel of all 52 is under 0.05 by design. Traced, one card runs
// (0.652, 0.109) -> (0.574, -0.307) -> (0.632, 0.089) across the two passes.
//
// What matters for the look is whether a pad ever crosses a card at all, because that
// is the only thing that moves one. So this sums each card's travel over the smoosh
// window; a card the hands never reach has a path length of ~0 no matter what the
// orbits do.
const steps = track.steps ?? []
const spreadEnd = steps.find((s) => s.id === 'spread')
const gather = steps.find((s) => s.id?.startsWith('gather'))
const tA = spreadEnd ? spreadEnd.tEnd : 0
const tB = gather ? gather.tStart : track.duration
// SNAPSHOT THE NUMBERS. `sampleTrack` hands back reused card objects, so keeping a
// reference to a previous sample gives you the CURRENT pose - both of this probe's
// first two attempts reported every card frozen at exactly 0.000 for that reason, and
// a hand-trace of one card disproved it.
const snap = (ms) => {
  const m = new Map()
  for (const [id, c] of sampleTrack(track, ms).cards) m.set(id, [c.pos.x, c.pos.z])
  return m
}
const path = new Map()
let prev = snap(tA)
const STEPS = 120
for (let i = 1; i <= STEPS; i++) {
  const cur = snap(tA + ((tB - tA) * i) / STEPS)
  for (const [id, c] of cur) {
    const q = prev.get(id)
    if (!q) continue
    path.set(id, (path.get(id) ?? 0) + Math.hypot(c[0] - q[0], c[1] - q[1]))
  }
  prev = cur
}
const moved = [...path.values()].sort((x, y) => x - y)
const frozen = moved.filter((d) => d < 0.05).length
console.log(`smoosh PATH  median ${moved[moved.length >> 1].toFixed(3)}  min ${moved[0].toFixed(3)}  barely-raked(<0.05) ${frozen}/${moved.length}`)

// --- PAD-TO-CARD CLEARANCE, per step ----------------------------------------------
// Whole-finger, not fingertip: a flat raking hand touches with the pads of the middle
// phalanges as much as with its tips, and a tip-only reading calls that a hover.
const _cl = new THREE.Vector3()
const _cq = new THREE.Quaternion()
const _j = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
const _pp = new THREE.Vector3()
const surfGap = (pt, c) => {
  _cl.copy(pt).sub(c.pos).applyQuaternion(_cq.set(-c.quat.x, -c.quat.y, -c.quat.z, c.quat.w))
  const e = cardSurfaceExtents(_cl, c.bend ?? 0)
  const o = Math.hypot(Math.max(e.x, 0), Math.max(e.u, 0), Math.max(e.n, 0))
  return o > 0 ? o : Math.max(e.x, e.u, e.n)
}
// BOTH DEFINITIONS ARE PRINTED, for the same reason `tryLesson` prints both: a flat
// raking hand touches the felt with the pads of its MIDDLE phalanges as much as with
// its tips, so a tip-only reading of a correct wash overstates the air by ~4x
// (measured: smoosh medians 7.4-9.3mm tip-only against 1.5-2.6mm whole-finger). A
// review of this lesson reported "typically 15-26mm of air" and that number could not
// be reproduced under either definition; printing both is how the next reader settles
// it in one command instead of arguing.
const perStep = new Map()
const perStepTip = new Map()
for (let i = 0; i <= 400; i++) {
  const ms = (track.duration * i) / 400
  const step = track.steps.find((q) => ms >= q.tStart && ms <= q.tEnd)
  if (!step) continue
  const s2 = sampleTrack(track, ms)
  let best = Infinity
  let bestTip = Infinity
  for (const side of ['left', 'right']) {
    const pose = s2.hands[side]
    if (!pose) continue
    for (const nm of FINGER_NAMES) {
      fingertipWorld(pose, side, nm, _pp)
      const rTip = FINGERS[nm].rad[2] * HAND_SCALE
      for (const [, c] of s2.cards) bestTip = Math.min(bestTip, surfGap(_pp, c) - rTip)
      fingerJointsWorld(pose, side, nm, _j)
      for (let sg = 0; sg < 3; sg++) {
        const r = FINGERS[nm].rad[sg] * HAND_SCALE
        for (let k = 0; k <= 4; k++) {
          _pp.copy(_j[sg]).lerp(_j[sg + 1], k / 4)
          for (const [, c] of s2.cards) best = Math.min(best, surfGap(_pp, c) - r)
        }
      }
    }
  }
  if (best < Infinity) {
    if (!perStep.has(step.id)) perStep.set(step.id, [])
    perStep.get(step.id).push(best)
    if (!perStepTip.has(step.id)) perStepTip.set(step.id, [])
    perStepTip.get(step.id).push(bestTip)
  }
}
const mm = (v) => (v * 100.8).toFixed(1)
console.log('pad-to-card clearance per step (mm)      TIP-ONLY        WHOLE-FINGER')
for (const [id, arr] of perStep) {
  arr.sort((a, b) => a - b)
  const tip = perStepTip.get(id).sort((a, b) => a - b)
  console.log(
    `  ${id.padEnd(14)}` +
      `  min ${mm(tip[0]).padStart(6)} med ${mm(tip[tip.length >> 1]).padStart(6)}` +
      `   |  min ${mm(arr[0]).padStart(6)} med ${mm(arr[arr.length >> 1]).padStart(6)}`,
  )
}
