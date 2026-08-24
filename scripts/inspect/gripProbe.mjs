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
//      ...gripProbe.mjs pinch      just the edge-pinch station table (fast)
import * as THREE from 'three'
import { FINGER_NAMES, FINGERS, HAND_SCALE } from '../../src/hands/handRigSpec.js'
import {
  fingerJointsWorld,
  fingertipWorld,
  solveFingerTo,
  solveThumbTo,
  applyGripPressure,
  GRIP_FRAME_TYPES,
  gripContacts,
} from '../../src/hands/handKinematics.js'
import { cloneHandPose } from '../../src/hands/handPoses.js'
import {
  cardSurfaceExtents,
  straddleGrip,
  packetGrip,
  edgePinchGrip,
  edgePinchGripAuto,
} from '../../src/lessons/authoring/contacts.js'
import { faceQuat } from '../../src/lessons/engine/layouts.js'
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

// WHICH FACE a pad is actually resting on. `tipGap` measures the distance to the
// nearest card SURFACE and does not care which one, so a finger buried against the
// deck's top face scores exactly like a finger pinching the edge it was aimed at -
// and that is not hypothetical: it is how the pinch's own auto-placer came to
// prefer a middle finger lying on the deck's back over one on its long edge, and
// report it as a pad in contact. A grip claims a FACE per finger; check the face.
const FACE_OF = { x: ['-x', '+x'], u: ['-y', '+y'], n: ['-z', '+z'] }
function padFace(pose, side, name, cards) {
  fingertipWorld(pose, side, name, _t)
  let best = null
  for (const c of cards) {
    const pos = Array.isArray(c.pos) ? new THREE.Vector3(...c.pos) : c.pos
    const lp = new THREE.Vector3().copy(_t).sub(pos)
      .applyQuaternion(_q.set(-c.quat.x, -c.quat.y, -c.quat.z, c.quat.w))
    const e = cardSurfaceExtents(lp, c.bend ?? 0)
    const ox = Math.max(e.x, 0)
    const ou = Math.max(e.u, 0)
    const on = Math.max(e.n, 0)
    const out = Math.hypot(ox, ou, on)
    const g = out > 0 ? out : Math.max(e.x, e.u, e.n)
    if (best && g >= best.g) continue
    // The face the pad is outside of by the most: on an edge contact that is the
    // edge, on a face contact the face. `u` is local y in the flat case.
    const sign = [lp.x, lp.y, lp.z]
    const keys = ['x', 'u', 'n']
    const vals = [e.x, e.u, e.n]
    let k = 0
    for (let i = 1; i < 3; i++) if (vals[i] > vals[k]) k = i
    best = { g, face: FACE_OF[keys[k]][sign[k] >= 0 ? 1 : 0] }
  }
  return best.face
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

// --- Edge pinch: every station, every squeeze, both axis modes ---------------
// The pinch's own acceptance table. `edgePinchGripAuto` places itself, so there
// is nothing to sweep here: the question is only whether the placement it picks
// puts all THREE claimed pads on the cards without burying a phalange, and it
// has to answer that on a thick deck and a thin packet alike, on either axis.
//
// Prints the pads BEFORE and AFTER resolvePenetration. That distinction is the
// whole diagnostic: `reach` 0.0000 with a 0.17 gap means the IK hit the target
// and the backoff then walked the finger off it, which is a different bug from a
// placement the hand cannot reach.
const PINCH_SCORED = ['thumb', 'middle', 'index']
const PINCH_BAND = 0.025
const PINCH_DEPTH_GATE = 0.012
const PINCH_STATIONS = [
  { label: '52-card deck', n: 52, baseY: 1.0 },
  { label: '20-card block', n: 20, baseY: 0.9 },
  { label: '8-card packet', n: 8, baseY: 0.85 },
]
const PINCH_SQUEEZES = [0, 0.3, 0.55]
// The face each claimed pad must end up on, per axis mode. Anything else is a
// finger touching the deck somewhere it was not aimed, which is not a grip.
const PINCH_WANT_FACE = {
  long: { thumb: '-x', middle: '+x', index: '-z' },
  // Palm down puts the wrist at -z, so the thumb takes the deck's '-y' short end
  // (the one on its own side) and the middle reaches past the '+y' one.
  end: { thumb: '-y', middle: '+y', index: '-z' },
}

function pinchSection() {
  console.log('########## edgePinchGripAuto: stations x squeezes x axis modes ##########')
  console.log(
    `(pads within ${PINCH_BAND} of a card count as touching; deepest capsule must stay <= ${PINCH_DEPTH_GATE})`,
  )
  console.log(
    'distal radii (world): ' +
      FINGER_NAMES.map((n) => `${n} ${(FINGERS[n].rad[2] * HAND_SCALE).toFixed(4)}`).join('  '),
  )
  const cq = faceQuat(false)
  let fails = 0
  let rows = 0
  for (const axis of ['long', 'end']) {
    console.log(`\n--- axis '${axis}' ---`)
    console.log(
      pad('station', 15) +
        pad('sq', 6) +
        pad('reach', 8) +
        pad('pads', 6) +
        pad('deepest', 9) +
        pad('where', 18) +
        pad('thumb', 9) +
        pad('middle', 9) +
        pad('index', 9) +
        'placement   (gap is suffixed with the face the pad is really on)',
    )
    for (const st of PINCH_STATIONS) {
      const deckH = (st.n - 1) * CARD_GAP
      for (const squeeze of PINCH_SQUEEZES) {
        const opts = { centerX: 0, centerZ: 0, baseY: st.baseY, deckH, squeeze, cardQuat: cq, axis }
        const g = edgePinchGripAuto(opts)
        const dw = deepestWhere(g.pose, 'right', g.column)
        const gaps = PINCH_SCORED.map((n) => tipGap(g.pose, 'right', n, g.column))
        const faces = PINCH_SCORED.map((n) => padFace(g.pose, 'right', n, g.column))
        const wrongFace = PINCH_SCORED.filter((n, i) => faces[i] !== PINCH_WANT_FACE[axis][n])
        const touching = gaps.filter((x) => Math.abs(x) < PINCH_BAND).length
        const bad = touching < 3 || dw.worst > PINCH_DEPTH_GATE || wrongFace.length > 0
        rows++
        if (bad) fails++
        console.log(
          pad(st.label, 15) +
            pad(squeeze.toFixed(2), 6) +
            pad(g.measured.reach.toFixed(4), 8) +
            pad(`${touching}/3${bad ? ' !' : ''}`, 6) +
            pad(dw.worst.toFixed(4), 9) +
            pad(dw.where, 18) +
            gaps.map((v, i) => pad(`${v.toFixed(4)}${faces[i]}`, 9)).join('') +
            JSON.stringify(g.placement),
        )
        if (wrongFace.length) {
          console.log(
            pad('', 15) +
              `WRONG FACE: ` +
              wrongFace
                .map((n) => `${n} on ${faces[PINCH_SCORED.indexOf(n)]}, wanted ${PINCH_WANT_FACE[axis][n]}`)
                .join('; '),
          )
        }
        // Where did a lost pad go? Compare the solved pose with the backed-off
        // one, and name the capsule that forced the backoff.
        if (g.preResolve) {
          const pre = PINCH_SCORED.map((n) => tipGap(g.preResolve, 'right', n, g.column))
          const pdw = deepestWhere(g.preResolve, 'right', g.column)
          const moved = pre.some((v, i) => Math.abs(v - gaps[i]) > 0.002)
          if (moved || bad) {
            console.log(
              pad('', 15) +
                pad('as solved', 6 + 8) +
                pad('', 6) +
                pad(pdw.worst.toFixed(4), 9) +
                pad(pdw.where, 18) +
                pre.map((v) => pad(v.toFixed(4), 9)).join(''),
            )
          }
        }
        // THE PRICE OF NOT RESERVING SQUEEZE AIR. The runtime sampler adds curl to
        // a gripping finger AFTER the pose is solved (applyGripPressure), so the
        // pose that RENDERS is not the pose that was measured. A pinch authored
        // tangent therefore grazes, and a graze is only defensible if it is
        // bounded: this is the number that bounds it.
        if (squeeze) {
          const tight = applyGripPressure(cloneHandPose(g.pose), 'pinch', squeeze)
          const tdw = deepestWhere(tight, 'right', g.column)
          const tg = PINCH_SCORED.map((n) => tipGap(tight, 'right', n, g.column))
          console.log(
            pad('', 15) +
              pad(`+squeeze`, 6 + 8) +
              pad('', 6) +
              pad(tdw.worst.toFixed(4), 9) +
              pad(tdw.where, 18) +
              tg.map((v) => pad(v.toFixed(4), 9)).join(''),
          )
        }
        if (bad) {
          // As-solved, per finger: which finger the backoff had a reason to move,
          // and therefore which pad it is allowed to have taken with it.
          const dep = depths(g.preResolve ?? g.pose, 'right', g.column)
          const face = PINCH_SCORED.map((n) => padFace(g.preResolve ?? g.pose, 'right', n, g.column))
          console.log(
            pad('', 15) +
              'as-solved depth  ' +
              FINGER_NAMES.map((n) => `${n} ${dep[n].toFixed(4)}`).join(' ') +
              `  faces ${face.join('/')}` +
              `  air ${PINCH_SCORED.map((n) => g.air[n].toFixed(4)).join('/')}`,
          )
        }
      }
    }
  }
  console.log(`\n${rows - fails}/${rows} stations hit 3/3 pads within ${PINCH_BAND} and <= ${PINCH_DEPTH_GATE} deep`)
  return fails
}

// --- Edge pinch: raw placement sweep ----------------------------------------
// What the acceptance table cannot tell you: whether a placement exists that
// needs NO backoff at all. `autoPlace` measures penetration on the pose AFTER
// resolvePenetration, which is always ~0 by construction, so its depth term
// cannot distinguish a hand that never touched the cards' insides from one the
// backoff dragged out of them -- and the backoff's bill is paid in pads. This
// sweep scores the pose AS SOLVED, and prints where each pad ended up, so the
// question "is 3/3 with a flat index reachable here" gets an answer instead of an
// opinion. Run: gripProbe.mjs pinchsweep [axis]
function pinchSweepSection(axis = 'long') {
  const cq = faceQuat(false)
  const st = { label: '52-card deck', n: 52, baseY: 1.0 }
  const deckH = (st.n - 1) * CARD_GAP
  const rows = []
  const range = (a, b, s) => {
    const out = []
    for (let v = a; v <= b + 1e-9; v += s) out.push(Number(v.toFixed(3)))
    return out
  }
  const grid =
    axis === 'long'
      ? { ko: range(-0.45, 0.3, 0.15), td: range(-1.4, 0.3, 0.15), al: range(0, 1.6, 0.4), rl: range(-1.2, 0.6, 0.3), il: range(0, 0.9, 0.2) }
      : { ko: range(-0.45, 0.45, 0.15), td: range(-1.2, 0.1, 0.15), al: range(-0.8, 1.2, 0.4), rl: range(-0.6, 1.2, 0.3), il: range(0, 0.9, 0.2) }
  for (const knuckleOut of grid.ko) {
    for (const thumbDrop of grid.td) {
      for (const along of grid.al) {
        for (const roll of grid.rl) {
         for (const indexLead of grid.il) {
          const g = edgePinchGrip({
            centerX: 0, centerZ: 0, baseY: st.baseY, deckH, squeeze: 0, cardQuat: cq, axis,
            knuckleOut, thumbDrop, along, roll, indexLead,
          })
          const solved = g.preResolve
          const dep = depths(solved, 'right', g.column)
          const solvedDeep = Math.max(...FINGER_NAMES.map((n) => dep[n]))
          const sGaps = PINCH_SCORED.map((n) => tipGap(solved, 'right', n, g.column))
          const sFaces = PINCH_SCORED.map((n) => padFace(solved, 'right', n, g.column))
          const gaps = PINCH_SCORED.map((n) => tipGap(g.pose, 'right', n, g.column))
          const faces = PINCH_SCORED.map((n) => padFace(g.pose, 'right', n, g.column))
          const right = PINCH_SCORED.every((n, i) => faces[i] === PINCH_WANT_FACE[axis][n])
          const sRight = PINCH_SCORED.every((n, i) => sFaces[i] === PINCH_WANT_FACE[axis][n])
          rows.push({
            knuckleOut, thumbDrop, along, roll, indexLead,
            reach: g.reach,
            solvedDeep,
            indexDeep: dep.index,
            thumbDeep: dep.thumb,
            touching: gaps.filter((v) => Math.abs(v) < PINCH_BAND).length,
            sTouching: sGaps.filter((v) => Math.abs(v) < PINCH_BAND).length,
            right,
            sRight,
            gaps,
            sGaps,
            faces,
            sFaces,
          })
         }
        }
      }
    }
  }
  const reachable = rows.filter((r) => r.reach <= 0.02)
  const solvedOk = reachable.filter((r) => r.sRight && r.sTouching === 3)
  console.log(
    `\n########## pinch raw sweep, axis '${axis}', ${st.label} ##########\n` +
      `swept ${rows.length}; ${reachable.length} reach all three targets; ` +
      `${solvedOk.length} of those put 3/3 pads on the RIGHT faces AS SOLVED`,
  )
  const clean = solvedOk.filter((r) => r.solvedDeep <= PINCH_DEPTH_GATE)
  console.log(
    `${clean.length} of those need no backoff at all (as-solved depth <= ${PINCH_DEPTH_GATE});` +
      ` ${solvedOk.filter((r) => r.right && r.touching === 3).length} survive the backoff with 3/3 on the right faces`,
  )
  const nRight = (r) => PINCH_SCORED.filter((n, i) => r.sFaces[i] === PINCH_WANT_FACE[axis][n]).length
  const top = (clean.length ? clean : solvedOk.length ? solvedOk : reachable)
    .sort((a, b) => nRight(b) - nRight(a) || a.solvedDeep - b.solvedDeep || Math.max(...a.gaps.map(Math.abs)) - Math.max(...b.gaps.map(Math.abs)))
    .slice(0, 14)
  console.log(
    '\n' + pad('kOut', 7) + pad('tDrop', 7) + pad('along', 7) + pad('roll', 7) + pad('iLead', 7) +
      pad('reach', 8) + pad('deep(idx/thb)', 15) + pad('post-backoff gaps', 26) + 'faces after',
  )
  for (const r of top) {
    console.log(
      pad(r.knuckleOut.toFixed(2), 7) + pad(r.thumbDrop.toFixed(2), 7) + pad(r.along.toFixed(2), 7) +
        pad(r.roll.toFixed(2), 7) + pad(r.indexLead.toFixed(2), 7) + pad(r.reach.toFixed(4), 8) +
        pad(`${r.indexDeep.toFixed(4)}/${r.thumbDeep.toFixed(4)}`, 15) +
        pad(r.gaps.map((v) => v.toFixed(4)).join(' '), 26) + r.faces.join('/') + '  solved ' + r.sFaces.join('/'),
    )
  }
}

// --- Edge pinch: one placement, joint by joint -------------------------------
// When a finger's pad is exactly on target and the finger is still inside the
// cards, the only useful question is WHICH PART, and against WHICH card. Prints
// every joint of every scored finger in the TOP card's own frame (so z is height
// above its mid-plane and a joint is inside the deck when |x| < 0.315,
// |y| < 0.44 and z is between the top and bottom cards), with each phalange's
// radius beside it. Run: gripProbe.mjs pinchone [axis] [k=v ...]
function pinchOneSection(axis, over) {
  const cq = faceQuat(false)
  const baseY = 1.0
  const deckH = 51 * CARD_GAP
  const g = edgePinchGrip({ centerX: 0, centerZ: 0, baseY, deckH, squeeze: 0, cardQuat: cq, axis, ...over })
  const solved = g.preResolve
  const top = g.column[0]
  const topPos = new THREE.Vector3(...top.pos)
  const inv = _q.set(-top.quat.x, -top.quat.y, -top.quat.z, top.quat.w).clone()
  console.log(`\n########## pinch, axis '${axis}', ${JSON.stringify(over)} ##########`)
  console.log(`deck: 52 cards, top card at y=${topPos.y.toFixed(4)}, bottom at y=${baseY.toFixed(4)}`)
  console.log(`half-extents x ${(CARD_W / 2).toFixed(3)}  y ${(CARD_H / 2).toFixed(3)}  z ${(CARD_T / 2).toFixed(4)}`)
  console.log(`reach ${g.reach.toFixed(4)}   anchor ${g.anchor.map((v) => v.toFixed(3)).join(', ')}`)
  for (const name of PINCH_SCORED) {
    const t = new THREE.Vector3().copy(g.contacts[name]).sub(topPos).applyQuaternion(inv)
    console.log(
      `\n${name}: target in top-card frame  x ${t.x.toFixed(4)}  y ${t.y.toFixed(4)}  z ${t.z.toFixed(4)}` +
        `   (pad radius ${(FINGERS[name].rad[2] * HAND_SCALE).toFixed(4)})`,
    )
    fingerJointsWorld(solved, 'right', name, _j)
    const label = ['knuckle', 'PIP', 'DIP', 'tip']
    for (let i = 0; i < 4; i++) {
      const l = new THREE.Vector3().copy(_j[i]).sub(topPos).applyQuaternion(inv)
      const r = FINGERS[name].rad[Math.min(i, 2)] * HAND_SCALE
      let worst = 0
      for (const c of g.column) {
        const pos = Array.isArray(c.pos) ? new THREE.Vector3(...c.pos) : c.pos
        const lp = new THREE.Vector3().copy(_j[i]).sub(pos)
          .applyQuaternion(_q.set(-c.quat.x, -c.quat.y, -c.quat.z, c.quat.w))
        const e = cardSurfaceExtents(lp, c.bend ?? 0)
        if (e.x > r || e.u > r || e.n > r) continue
        worst = Math.max(worst, Math.min(-e.x, -e.u, -e.n) + r)
      }
      console.log(
        `  ${pad(label[i], 8)} x ${l.x.toFixed(4)}  y ${l.y.toFixed(4)}  z ${l.z.toFixed(4)}` +
          `   r ${r.toFixed(4)}   joint depth ${worst.toFixed(4)}`,
      )
    }
    console.log(`  as-solved worst capsule depth ${depths(solved, 'right', g.column)[name].toFixed(4)}`)
  }
}

// `pinch` alone skips the straddle sweeps below (they cost ~10s and are not this
// grip's business).
const ONLY = process.argv.slice(2)
if (ONLY.includes('pinchone')) {
  const over = {}
  for (const a of ONLY.slice(2)) {
    const [k, v] = a.split('=')
    over[k] = Number(v)
  }
  pinchOneSection(ONLY[1] ?? 'long', over)
  process.exit(0)
}
if (ONLY.includes('pinchsweep')) {
  pinchSweepSection(ONLY[1] ?? 'long')
  process.exit(0)
}
if (ONLY.includes('pinch')) {
  process.exitCode = pinchSection() ? 1 : 0
  process.exit(process.exitCode)
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
const CH = { x: 0.05, y: 0.85, z: 0.1 }
const chQ = faceQuat(false)
const chCard = (h) => ({ pos: [CH.x, CH.y + h, CH.z], quat: chQ })
const chColumn = []
for (let i = 0; i < N; i += 6) chColumn.push(chCard(i * CARD_GAP))
chColumn.push(chCard(deckH))
for (let h = -CARD_GAP * 4; CH.y + h > 0.012; h -= CARD_GAP * 4) chColumn.push(chCard(h))

function judge(label, pose, frameType, cards) {
  // `tipGap` walks phalanges, so this probe scores FINGERTIPS only: take the
  // frame's contact set (which falls back to `pressure` where a frame declares
  // none) and keep the surfaces that actually name a finger. A palm contact has
  // no pad to measure here and is skipped rather than faked.
  const contacts = gripContacts(frameType) ?? {}
  const scored = Object.keys(contacts).filter((k) => contacts[k].finger).map((k) => contacts[k].finger)
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

console.log('\n')
pinchSection()
