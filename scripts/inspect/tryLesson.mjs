// Compile and score ONE lesson without wiring it into the catalog, so a work in
// progress can be measured without ever putting the repo in a red state.
// Run: node --import ./scripts/verify/register.mjs scripts/inspect/tryLesson.mjs <path> <exportName>
import * as THREE from 'three'
import { compileLesson } from '../../src/lessons/engine/compileLesson.js'
import { sampleTrack } from '../../src/lessons/engine/sampleTrack.js'
import { createDeck } from '../../src/deckModel.js'
import { FINGER_NAMES, FINGERS, HAND_SCALE } from '../../src/hands/handRigSpec.js'
import { fingerJointsWorld, fingertipWorld, GRIP_FRAME_TYPES } from '../../src/hands/handKinematics.js'
import { cardSurfaceExtents } from '../../src/lessons/authoring/contacts.js'
import { CARD_W, CARD_H, CARD_T } from '../../src/lib/constants.js'

const [path, name] = process.argv.slice(2)
const mod = await import(path.startsWith('/') ? path : `../../${path}`)
const lesson = mod[name]
if (!lesson) { console.error(`no export "${name}" in ${path}`); process.exit(1) }

const deck = createDeck()
const t0 = Date.now()
const track = compileLesson(lesson, deck)
console.log(`compiled "${lesson.id}" in ${Date.now() - t0}ms: ${(track.duration / 1000).toFixed(2)}s, ${track.steps.length} steps, ${track.holds?.length ?? 0} holds`)
console.log(`  steps: ${track.steps.map((s) => `${s.id}:${Math.round(s.tEnd - s.tStart)}`).join(' ')}`)

const _j = [0, 1, 2, 3].map(() => new THREE.Vector3())
const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _t = new THREE.Vector3()
let nonFinite = 0, belowFelt = 0, worstPen = 0, penWhere = ''
// PIERCE COUNT: how many cards contain a capsule CENTRE, at the worst instant.
//
// `worstPen` alone cannot answer "how bad": it is a true overlap depth, so a capsule
// whose centre sits on a 0.003-thick card reads r + CARD_T/2 and STAYS there however
// much further into the STACK the capsule goes. Those ceilings are 0.1007 for an
// index proximal and 0.1057 for a thumb middle, which is exactly what the overhand
// rebuild kept reporting through six different fixes - a pinned gauge, not an
// unchanged pose. Cards pierced is monotone and unbounded, so it can tell "grazed one
// card" from "knuckle driven through twenty".
let worstPierce = 0, pierceWhere = ''
const stepGaps = new Map()
const stepIdAt = (ms) => {
  let id = track.steps[0]?.id ?? '-'
  for (const st of track.steps) if (ms >= st.tStart) id = st.id
  return id
}
const gaps = []

const N = 160
for (let i = 0; i <= N; i++) {
  const ms = (track.duration * i) / N
  const scene = sampleTrack(track, ms)
  for (const [, c] of scene.cards) {
    if (![c.pos.x, c.pos.y, c.pos.z, c.quat.x, c.quat.y, c.quat.z, c.quat.w, c.bend].every(Number.isFinite)) nonFinite++
    if (c.pos.y < -0.05) belowFelt++
  }
  for (const side of ['left', 'right']) {
    const pose = scene.hands[side]
    if (!pose) continue
    for (const nm of FINGER_NAMES) {
      fingerJointsWorld(pose, side, nm, _j)
      const rad = FINGERS[nm].rad
      for (let s = 0; s < 3; s++) {
        const r = rad[s] * HAND_SCALE
        for (let k = 0; k <= 4; k++) {
          _p.copy(_j[s]).lerp(_j[s + 1], k / 4)
          let pierced = 0
          for (const [id, c] of scene.cards) {
            const lp = _p.clone().sub(c.pos).applyQuaternion(_q.set(-c.quat.x, -c.quat.y, -c.quat.z, c.quat.w))
            const e = cardSurfaceExtents(lp, c.bend ?? 0)
            if (e.x <= 0 && e.u <= 0 && e.n <= 0) pierced++
            if (e.x > r || e.u > r || e.n > r) continue
            const ox = Math.max(e.x, 0), ou = Math.max(e.u, 0), on = Math.max(e.n, 0)
            const out = Math.hypot(ox, ou, on)
            const d = out > 0 ? Math.max(0, r - out) : Math.min(-e.x, -e.u, -e.n) + r
            if (d > worstPen) { worstPen = d; penWhere = `${side} ${nm}[${s}] into ${id} @${Math.round(ms)}ms` }
          }
          if (pierced > worstPierce) {
            worstPierce = pierced
            pierceWhere = `${side} ${nm}[${s}] @${Math.round(ms)}ms`
          }
        }
      }
    }
  }
  for (const h of track.holds ?? []) {
    if (ms < h.tStart || ms > h.tEnd) continue
    const grippers = GRIP_FRAME_TYPES[h.frame]?.pressure
    if (!grippers) continue
    const pose = scene.hands[h.side]
    if (!pose) continue
    const held = [...h.offsets.keys()].filter((id) => ms <= (h.releases?.get(id) ?? h.tEnd)).map((id) => scene.cards.get(id)).filter(Boolean)
    if (!held.length) continue
    for (const nm of Object.keys(grippers)) {
      fingertipWorld(pose, h.side, nm, _t)
      let best = Infinity
      for (const c of held) {
        const lp = _t.clone().sub(c.pos).applyQuaternion(_q.set(-c.quat.x, -c.quat.y, -c.quat.z, c.quat.w))
        const e = cardSurfaceExtents(lp, c.bend ?? 0)
        const o = Math.hypot(Math.max(e.x, 0), Math.max(e.u, 0), Math.max(e.n, 0))
        best = Math.min(best, o > 0 ? o : Math.max(e.x, e.u, e.n))
      }
      const gap = best - FINGERS[nm].rad[2] * HAND_SCALE
      gaps.push(gap)
      // Per-step too. An aggregate contact percentage hides WHICH beat is detached,
      // and that is the thing a capture shows you and a single number does not: the
      // charlier reads 69% overall while its pivot has the packets visibly clear of
      // the fingers.
      let bucket = stepGaps.get(stepIdAt(ms))
      if (!bucket) stepGaps.set(stepIdAt(ms), (bucket = []))
      bucket.push(gap)
    }
  }
}
gaps.sort((a, b) => a - b)
const frac = gaps.length ? gaps.filter((g) => Math.abs(g) < 0.025).length / gaps.length : 0
console.log(`  non-finite ${nonFinite}   below felt ${belowFelt}`)
console.log(`  worst finger-in-card ${worstPen.toFixed(4)}  ${penWhere}`)
console.log(`  worst cards pierced  ${worstPierce}  ${pierceWhere}`)
// Per-step worst, so a single bad beat is named rather than a single timestamp.
const perStep = new Map()
for (let i = 0; i <= N; i++) {
  const ms = (track.duration * i) / N
  let step = track.steps[0]
  for (const st of track.steps) if (ms >= st.tStart) step = st
  const scene = sampleTrack(track, ms)
  let w = 0
  for (const side of ['left', 'right']) {
    const pose = scene.hands[side]; if (!pose) continue
    for (const nm of FINGER_NAMES) {
      fingerJointsWorld(pose, side, nm, _j)
      const rad = FINGERS[nm].rad
      for (let sg = 0; sg < 3; sg++) {
        const r = rad[sg] * HAND_SCALE
        for (let k = 0; k <= 4; k++) {
          _p.copy(_j[sg]).lerp(_j[sg + 1], k / 4)
          for (const [, c] of scene.cards) {
            const lp = _p.clone().sub(c.pos).applyQuaternion(_q.set(-c.quat.x, -c.quat.y, -c.quat.z, c.quat.w))
            const e = cardSurfaceExtents(lp, c.bend ?? 0)
            if (e.x > r || e.u > r || e.n > r) continue
            const ox = Math.max(e.x, 0), ou = Math.max(e.u, 0), on = Math.max(e.n, 0)
            const out = Math.hypot(ox, ou, on)
            const d = out > 0 ? Math.max(0, r - out) : Math.min(-e.x, -e.u, -e.n) + r
            if (d > w) w = d
          }
        }
      }
    }
  }
  perStep.set(step.id, Math.max(perStep.get(step.id) ?? 0, w))
}
console.log('  per-step worst: ' + [...perStep].map(([k, v]) => `${k} ${v.toFixed(4)}`).join('  '))
if (stepGaps.size) {
  const line = [...stepGaps].map(([k, v]) => {
    const pct = Math.round((100 * v.filter((g) => Math.abs(g) < 0.025).length) / v.length)
    const med = [...v].sort((a, b) => a - b)[v.length >> 1]
    return `${k} ${pct}% (med ${med.toFixed(3)})`
  })
  console.log('  per-step contact: ' + line.join('  '))
}
console.log(`  gripping fingertips in contact ${(frac * 100).toFixed(0)}% of ${gaps.length}, median gap ${gaps.length ? gaps[gaps.length >> 1].toFixed(3) : '-'}`)
