// Deep-dive ONE frame of one lesson: every finger, every phalange, its depth into
// each card, and WHICH HALF that card belongs to. Written because the in-hands
// riffle's bend beat sat at exactly 0.0523 through three separate hypotheses, and
// guessing a fourth time is worse than measuring once.
//
// Run: node --import ./scripts/verify/register.mjs scripts/inspect/deepFrame.mjs <path> <export> <ms>
import * as THREE from 'three'
import { compileLesson } from '../../src/lessons/engine/compileLesson.js'
import { sampleTrack } from '../../src/lessons/engine/sampleTrack.js'
import { createDeck } from '../../src/deckModel.js'
import { FINGER_NAMES, FINGERS, HAND_SCALE } from '../../src/hands/handRigSpec.js'
import { fingerJointsWorld } from '../../src/hands/handKinematics.js'
import { cardSurfaceExtents } from '../../src/lessons/authoring/contacts.js'

const [path, name, msArg] = process.argv.slice(2)
const mod = await import(path.startsWith('/') ? path : `../../${path}`)
const lesson = mod[name]
const deck = createDeck()
const MID = Math.floor(deck.length / 2)
const halfOf = new Map(deck.map((c, i) => [c.id, i < MID ? 'first' : 'second']))
const track = compileLesson(lesson, deck)
const ms = Number(msArg)
const scene = sampleTrack(track, ms)
let step = track.steps[0]
for (const s of track.steps) if (ms >= s.tStart) step = s
console.log(`${lesson.id} @ ${ms}ms  (step "${step.id}")\n`)

const PH = ['proximal', 'middle', 'distal']
const _j = [0, 1, 2, 3].map(() => new THREE.Vector3())
const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const faceOf = (e) => [['x', e.x], ['u', e.u], ['n', e.n]].sort((a, b) => b[1] - a[1])[0][0]

for (const side of ['left', 'right']) {
  const pose = scene.hands[side]
  if (!pose) { console.log(`${side}: no hand`); continue }
  console.log(`${side} hand  (wrist ${[...pose.wrist.pos].map((v) => v.toFixed(2)).join(', ')})`)
  for (const nm of FINGER_NAMES) {
    fingerJointsWorld(pose, side, nm, _j)
    const rad = FINGERS[nm].rad
    const rows = []
    for (let s = 0; s < 3; s++) {
      const r = rad[s] * HAND_SCALE
      let worst = 0, wid = '-', wface = '-', wHalf = '-'
      let nearest = Infinity, nid = '-'
      for (let k = 0; k <= 4; k++) {
        _p.copy(_j[s]).lerp(_j[s + 1], k / 4)
        for (const [id, c] of scene.cards) {
          const lp = _p.clone().sub(c.pos).applyQuaternion(_q.set(-c.quat.x, -c.quat.y, -c.quat.z, c.quat.w))
          const e = cardSurfaceExtents(lp, c.bend ?? 0)
          const ox = Math.max(e.x, 0), ou = Math.max(e.u, 0), on = Math.max(e.n, 0)
          const out = Math.hypot(ox, ou, on)
          const gap = out - r
          if (gap < nearest) { nearest = gap; nid = id }
          if (e.x > r || e.u > r || e.n > r) continue
          const d = out > 0 ? Math.max(0, r - out) : Math.min(-e.x, -e.u, -e.n) + r
          if (d > worst) { worst = d; wid = id; wface = faceOf(e); wHalf = halfOf.get(id) }
        }
      }
      rows.push(
        `    ${PH[s].padEnd(9)} r ${r.toFixed(3)}  deepest ${worst.toFixed(4)}` +
          (worst > 0.001 ? ` into ${wid} (${wHalf} half, face ${wface})` : `  clear, nearest ${nearest.toFixed(4)} (${nid})`),
      )
    }
    const any = rows.some((r) => !r.includes('clear'))
    console.log(`  ${nm}${any ? '' : '  (clear)'}`)
    for (const r of rows) console.log(r)
  }
}
