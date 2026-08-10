// Grip authoring probe. Solves a candidate grip and reports, per finger, whether
// the IK actually REACHED its target and what the resulting contact measures.
//
// Why this exists: a grip is authored by choosing a wrist orientation, an anchor
// and five contact targets, and the failure mode is silent. `solveFingerTo`
// always returns angles; when a target is out of reach it pins joints against
// JOINT_LIMITS and the pad lands somewhere else entirely, which renders as a
// finger pointing the wrong way and measures as a hover. The two numbers that
// tell you that happened are `error` (in-plane reach residual) and `planeError`
// (the component curls can never reach, because splay is fixed), and nothing in
// the authoring path printed either.
//
// Run: node --import ./scripts/verify/register.mjs scripts/inspect/gripProbe.mjs
import * as THREE from 'three'
import { FINGER_NAMES, FINGERS, HAND_SCALE } from '../../src/hands/handRigSpec.js'
import {
  fingerJointsWorld,
  fingertipWorld,
  solveFingerTo,
  solveThumbTo,
} from '../../src/hands/handKinematics.js'
import { getHandPose, cloneHandPose } from '../../src/hands/handPoses.js'
import { surfaceContact, cardSurfaceExtents, straddleGrip, packetGrip } from '../../src/lessons/authoring/contacts.js'
import { CARD_W, CARD_H, CARD_T, CARD_GAP } from '../../src/lib/constants.js'

const MM = 63.5 / CARD_W
const pad = (s, n) => String(s).padEnd(n)
const _j = [0, 1, 2, 3].map(() => new THREE.Vector3())
const _l = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _t = new THREE.Vector3()

// Deepest penetration of a pose into a set of cards, per finger.
function depths(pose, side, cards) {
  const out = {}
  for (const name of FINGER_NAMES) {
    fingerJointsWorld(pose, side, name, _j)
    const rad = FINGERS[name].rad
    let worst = 0
    for (let i = 0; i < 3; i++) {
      const r = rad[i] * HAND_SCALE
      for (let k = 0; k <= 6; k++) {
        const p = _l.copy(_j[i]).lerp(_j[i + 1], k / 6)
        for (const c of cards) {
          const pos = Array.isArray(c.pos) ? new THREE.Vector3(...c.pos) : c.pos
          const lp = new THREE.Vector3()
            .copy(p)
            .sub(pos)
            .applyQuaternion(_q.set(-c.quat.x, -c.quat.y, -c.quat.z, c.quat.w))
          const e = cardSurfaceExtents(lp, c.bend ?? 0)
          if (e.x > r || e.u > r || e.n > r) continue
          const d = Math.min(-e.x, -e.u, -e.n) + r
          if (d > worst) worst = d
        }
      }
    }
    out[name] = worst
  }
  return out
}

const PHAL = ['proximal', 'middle', 'distal']
// Which phalange of which finger is deepest, so a failure names itself.
function deepestWhere(pose, side, cards) {
  let worst = 0
  let where = 'clear'
  for (const name of FINGER_NAMES) {
    fingerJointsWorld(pose, side, name, _j)
    const rad = FINGERS[name].rad
    for (let i = 0; i < 3; i++) {
      const r = rad[i] * HAND_SCALE
      for (let k = 0; k <= 6; k++) {
        const p = _l.copy(_j[i]).lerp(_j[i + 1], k / 6)
        for (const c of cards) {
          const pos = Array.isArray(c.pos) ? new THREE.Vector3(...c.pos) : c.pos
          const lp = new THREE.Vector3().copy(p).sub(pos)
            .applyQuaternion(_q.set(-c.quat.x, -c.quat.y, -c.quat.z, c.quat.w))
          const e = cardSurfaceExtents(lp, c.bend ?? 0)
          if (e.x > r || e.u > r || e.n > r) continue
          const d = Math.min(-e.x, -e.u, -e.n) + r
          if (d > worst) { worst = d; where = `${name}[${PHAL[i]}]` }
        }
      }
    }
  }
  return { worst, where }
}

// Signed clearance from a fingertip SURFACE to the nearest card surface.
function tipGap(pose, side, name, cards) {
  fingertipWorld(pose, side, name, _t)
  let best = Infinity
  for (const c of cards) {
    const pos = Array.isArray(c.pos) ? new THREE.Vector3(...c.pos) : c.pos
    const lp = new THREE.Vector3()
      .copy(_t)
      .sub(pos)
      .applyQuaternion(_q.set(-c.quat.x, -c.quat.y, -c.quat.z, c.quat.w))
    const e = cardSurfaceExtents(lp, c.bend ?? 0)
    const ox = Math.max(e.x, 0)
    const ou = Math.max(e.u, 0)
    const on = Math.max(e.n, 0)
    const out = Math.hypot(ox, ou, on)
    const g = out > 0 ? out : Math.max(e.x, e.u, e.n)
    if (g < best) best = g
  }
  return best - FINGERS[name].rad[2] * HAND_SCALE
}

// Re-solve each contact on the FINAL pose and report the residual. Solving is
// order-dependent (each solve sees the wrist the previous ones left), so the
// honest number is measured against the pose as it ends up.
function report(label, pose, side, contacts, cards) {
  console.log(`\n=== ${label} ===`)
  console.log(
    pad('finger', 8),
    pad('reach err', 11),
    pad('plane err', 11),
    pad('tip gap', 10),
    'deepest',
  )
  const dep = depths(pose, side, cards)
  let worstReach = 0
  for (const name of FINGER_NAMES) {
    const target = contacts[name]
    let err = '-'
    let perr = '-'
    if (target) {
      _t.copy(target)
      if (side === 'left') _t.x = -_t.x
      const s =
        name === 'thumb'
          ? solveThumbTo(pose, side, _t, { oppRange: 1.1, steps: 33 })
          : solveFingerTo(pose, side, name, _t, { splay: true })
      err = s.error.toFixed(4)
      perr = (s.planeError ?? 0).toFixed(4)
      worstReach = Math.max(worstReach, s.error)
    }
    console.log(
      pad(name, 8),
      pad(err, 11),
      pad(perr, 11),
      pad(tipGap(pose, side, name, cards).toFixed(4), 10),
      dep[name].toFixed(4),
    )
  }
  const gaps = FINGER_NAMES.filter((n) => contacts[n]).map((n) => tipGap(pose, side, n, cards))
  const touching = gaps.filter((g) => Math.abs(g) < 0.025).length
  console.log(
    `  contact ${touching}/${gaps.length} pads within the 0.025 band` +
      `   worst reach residual ${worstReach.toFixed(4)} (${(worstReach * MM).toFixed(1)}mm)` +
      `   deepest ${Math.max(...Object.values(dep)).toFixed(4)}`,
  )
}

// --- The candidate ----------------------------------------------------------
// A 52-card PORTRAIT deck sitting where a straddle grip would hold it: off the
// table, in the hand.
const N = 52
const DECK = { x: 0, y: 1.0, z: 0 }
const deckH = (N - 1) * CARD_GAP
// Lay the deck FLAT: rotate -90 deg about world X so the card's face normal
// (local z) points up and its long axis (local y) runs away from the dealer.
// Its long EDGES are then the +/-x faces at world x = +/-CARD_W/2, and its short
// ENDS the +/-y faces. An identity quat stands the card on edge, which silently
// made the first run of this probe stack 52 cards along their own long axis.
const faceQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)
const cardAt = (h) => ({ pos: [DECK.x, DECK.y + h, DECK.z], quat: faceQ })
const AXES = ['x', 'y', 'z'].map((a, i) => {
  const v = new THREE.Vector3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0).applyQuaternion(faceQ)
  return `local ${a} -> world (${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`
})
const column = []
for (let i = 0; i < N; i += 6) column.push(cardAt(i * CARD_GAP))
column.push(cardAt(deckH))

console.log('card local axes at identity quat: x = width (long EDGES at ±x), y = long axis (short ENDS at ±y), z = face normal')
console.log(`deck: ${N} cards, ${deckH.toFixed(3)} tall, centred at y=${DECK.y}`)
console.log(`half-extents: x ${(CARD_W / 2).toFixed(3)}  y ${(CARD_H / 2).toFixed(3)}  z ${(CARD_T / 2).toFixed(4)}`)
AXES.forEach((l) => console.log('  ' + l))

// --- Sweep ------------------------------------------------------------------
// The three placement numbers interact (the thumb's reach depends on all of
// them), so sweep rather than guess. Score: reach residual first (an unreached
// target is a broken finger, not a loose one), then pads in contact, then depth.
function score(g) {
  let worstReach = 0
  for (const name of ['thumb', 'index']) {
    if (!g.contacts[name]) continue
    _t.copy(g.contacts[name])
    const s =
      name === 'thumb'
        ? solveThumbTo(g.pose, 'right', _t, { oppRange: 1.1, steps: 33 })
        : solveFingerTo(g.pose, 'right', name, _t, { splay: true })
    worstReach = Math.max(worstReach, s.error)
  }
  const dep = depths(g.pose, 'right', column)
  const gaps = ['thumb', 'index'].map((n) => tipGap(g.pose, 'right', n, column))
  return {
    reach: worstReach,
    touching: gaps.filter((x) => Math.abs(x) < 0.025).length,
    deepest: Math.max(...Object.values(dep)),
    gaps,
  }
}

let best = null
const results = []
for (let ko = -0.3; ko <= 0.4001; ko += 0.1) {
  for (let td = 0.0; td <= 0.7001; td += 0.1) {
    for (let al = -0.4; al <= 0.4001; al += 0.2) {
     for (let rl = -0.9; rl <= 0.9001; rl += 0.15) {
      const g = straddleGrip({
        centerX: DECK.x, centerZ: DECK.z, baseY: DECK.y, deckH,
        knuckleOut: ko, thumbDrop: td, along: al, roll: rl,
      })
      const s = score(g)
      results.push({ ko, td, al, rl, ...s })
     }
    }
  }
}
console.log(`\nswept ${results.length} placements`)
const reachable = results.filter((r) => r.reach <= 0.02)
console.log(`${reachable.length} reach both targets within 0.02`)
const clean = reachable.filter((r) => r.deepest <= 0.012)
console.log(`${clean.length} of those also stay within 0.012 of the cards (skin deep)`)
const pool = (clean.length ? clean : reachable)
const top = pool.sort((a, b) => b.touching - a.touching || a.deepest - b.deepest).slice(0, 10)
console.log('\n' + pad('knuckleOut', 12) + pad('thumbDrop', 11) + pad('along', 8) + pad('roll', 8) + pad('reach', 9) + pad('pads', 6) + 'deepest')
for (const r of top) {
  console.log(pad(r.ko.toFixed(2), 12) + pad(r.td.toFixed(2), 11) + pad(r.al.toFixed(2), 8) + pad(r.rl.toFixed(2), 8) + pad(r.reach.toFixed(4), 9) + pad(`${r.touching}/2`, 6) + r.deepest.toFixed(4))
}
const b2 = top[0]
console.log(`\nBEST: knuckleOut ${b2.ko.toFixed(2)}  thumbDrop ${b2.td.toFixed(2)}  along ${b2.al.toFixed(2)}  roll ${b2.rl.toFixed(2)}`)
const g = straddleGrip({ centerX: DECK.x, centerZ: DECK.z, baseY: DECK.y, deckH, knuckleOut: b2.ko, thumbDrop: b2.td, along: b2.al, roll: b2.rl })
report('straddleGrip (best)', g.pose, 'right', g.contacts, column)
console.log('\nanchor', g.anchor.map((v) => v.toFixed(3)).join(', '))
const dw = deepestWhere(g.pose, 'right', column)
console.log(`deepest capsule: ${dw.where} at ${dw.worst.toFixed(4)} (${(dw.worst * MM).toFixed(1)}mm)`)


// --- Head to head on the charlier's own deck --------------------------------
// The charlier holds a full PORTRAIT deck in the air. It currently carries with
// packetGrip (a face grip: thumb on the far long edge, four pads arching onto the
// near one) under the `packet` frame, which scores all five fingertips. Compare
// that with the straddle on identical geometry, each judged by the fingers ITS
// OWN frame claims to be holding.
import { GRIP_FRAME_TYPES } from '../../src/hands/handKinematics.js'
import { faceQuat } from '../../src/lessons/engine/layouts.js'

const CH = { x: 0.05, y: 0.85, z: 0.1 }
const chQ = faceQuat(false)
const chCard = (h) => ({ pos: [CH.x, CH.y + h, CH.z], quat: chQ })
const chColumn = []
for (let i = 0; i < N; i += 6) chColumn.push(chCard(i * CARD_GAP))
chColumn.push(chCard(deckH))
for (let h = -CARD_GAP * 4; CH.y + h > 0.012; h -= CARD_GAP * 4) chColumn.push(chCard(h))

function judge(label, pose, frameType, cards) {
  const scored = Object.keys(GRIP_FRAME_TYPES[frameType].pressure)
  const dep = depths(pose, 'right', cards)
  const gaps = {}
  for (const n of FINGER_NAMES) gaps[n] = tipGap(pose, 'right', n, cards)
  const touching = scored.filter((n) => Math.abs(gaps[n]) < 0.025)
  const dw = deepestWhere(pose, 'right', cards)
  console.log(`\n${label}   frame '${frameType}' scores [${scored.join(', ')}]`)
  console.log('  ' + FINGER_NAMES.map((n) => `${n} ${gaps[n].toFixed(3)}${scored.includes(n) ? '*' : ' '}`).join('  '))
  console.log(
    `  scored pads in contact ${touching.length}/${scored.length} (${((touching.length / scored.length) * 100).toFixed(0)}%)` +
      `   deepest ${dw.worst.toFixed(4)} ${dw.where}`,
  )
  return { frac: touching.length / scored.length, deepest: dw.worst }
}

console.log('\n\n########## charlier deck: packetGrip vs straddleGrip ##########')
console.log('(* = a finger this frame claims to be gripping with; gap <0.025 = touching)')
const pg = packetGrip({ centerX: CH.x, centerZ: CH.z, baseY: CH.y, deckH: deckH, squeeze: 0.55 })
const a = judge('packetGrip  (face grip, current)', pg.pose, 'packet', chColumn)
const sg = straddleGrip({ centerX: CH.x, centerZ: CH.z, baseY: CH.y, deckH: deckH, squeeze: 0.55, cardQuat: chQ })
const b = judge('straddleGrip (edge grip, new) ', sg.pose, 'straddle', chColumn)
console.log(
  `\nverdict: contact ${(a.frac * 100).toFixed(0)}% -> ${(b.frac * 100).toFixed(0)}%,` +
    ` deepest ${a.deepest.toFixed(4)} -> ${b.deepest.toFixed(4)}`,
)


// --- Re-sweep on the charlier's geometry AND squeeze -------------------------
// The optimum swept at squeeze 0 does NOT transfer: `squeezeAir` moves every
// contact target off its surface as the squeeze rises, and the wrist anchor is
// derived FROM the thumb target, so the whole placement shifts. Swept per
// station is the only honest way to place this grip.
console.log('\n\n########## re-sweep: charlier geometry, squeeze 0.55 ##########')
let bestCh = null
const rows = []
for (let ko = -0.3; ko <= 0.4001; ko += 0.1) {
  for (let td = 0.0; td <= 0.7001; td += 0.1) {
    for (let al = -0.6; al <= 0.6001; al += 0.2) {
      for (let rl = -0.9; rl <= 0.9001; rl += 0.15) {
        const g = straddleGrip({
          centerX: CH.x, centerZ: CH.z, baseY: CH.y, deckH, squeeze: 0.55, cardQuat: chQ,
          knuckleOut: ko, thumbDrop: td, along: al, roll: rl,
        })
        const dw = deepestWhere(g.pose, 'right', chColumn)
        const gt = tipGap(g.pose, 'right', 'thumb', chColumn)
        const gi = tipGap(g.pose, 'right', 'index', chColumn)
        const touching = [gt, gi].filter((x) => Math.abs(x) < 0.025).length
        rows.push({ ko, td, al, rl, deepest: dw.worst, where: dw.where, touching, gt, gi })
      }
    }
  }
}
const ok = rows.filter((r) => r.deepest <= 0.012)
console.log(`swept ${rows.length}; ${ok.length} stay within 0.012 of the cards`)
const best2 = (ok.length ? ok : rows)
  .sort((a, b) => b.touching - a.touching || a.deepest - b.deepest || Math.abs(a.gt) - Math.abs(b.gt))
  .slice(0, 6)
console.log('\n' + pad('kOut', 7) + pad('tDrop', 7) + pad('along', 7) + pad('roll', 7) + pad('pads', 6) + pad('deepest', 10) + pad('thumb gap', 11) + 'index gap')
for (const r of best2) {
  console.log(pad(r.ko.toFixed(2), 7) + pad(r.td.toFixed(2), 7) + pad(r.al.toFixed(2), 7) + pad(r.rl.toFixed(2), 7) + pad(`${r.touching}/2`, 6) + pad(r.deepest.toFixed(4), 10) + pad(r.gt.toFixed(4), 11) + r.gi.toFixed(4))
}
if (best2[0]) {
  const r = best2[0]
  const g = straddleGrip({ centerX: CH.x, centerZ: CH.z, baseY: CH.y, deckH, squeeze: 0.55, cardQuat: chQ, knuckleOut: r.ko, thumbDrop: r.td, along: r.al, roll: r.rl })
  judge('straddleGrip (re-swept for charlier)', g.pose, 'straddle', chColumn)
}
