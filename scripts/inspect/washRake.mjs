// WASH RAKE PROBE. The wash is the one lesson the contact metrics cannot judge: nothing
// in it is gripped, so `tryLesson` reports "0% of 0" and a penetration of 0.0000 whether
// the hands are raking the cards or waving beside them. This measures the two things
// that actually decide whether it looks and works like a wash:
//
//   * PAD REACH vs CARD SPREAD - cards only move when a pad crosses them, so a spread
//     wider than the hands can rake leaves frozen cards at its edges.
//   * PATH LENGTH per card over the smoosh window, which is how you detect those.
//
// Usage: node --import ./scripts/verify/register.mjs scripts/inspect/washRake.mjs
import { createDeck } from '../../src/deckModel.js'
import { compileLesson } from '../../src/lessons/engine/compileLesson.js'
import { sampleTrack } from '../../src/lessons/engine/sampleTrack.js'
import { fingertipWorld } from '../../src/hands/handKinematics.js'
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

