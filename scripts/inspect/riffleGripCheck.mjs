// Does a canonically-solved end-pinch, rotated rigidly by the layout's OWN
// composite rotation, actually land on the layout's cards?
//
// This is the gate before any in-hands riffle authoring. A riffle half is a roll
// about world Z composed with a yaw about world Y, and the pinch cannot solve that
// orientation directly (measured: at 68deg of yaw the reach residual is 0.3429 and
// the thumb slides onto the deck's broad face while still reporting 3/3 "contact").
// So the grip is solved flat and rotated. If the rotation is composed wrongly - and
// R_z*R_y != R_y*R_z, so it easily can be - the pads land nowhere and the only
// symptom is a visual one.
//
// Run: node --import ./scripts/verify/register.mjs scripts/inspect/riffleGripCheck.mjs
import * as THREE from 'three'
import { edgePinchGripAuto, rotateGripRigid, cardSurfaceExtents } from '../../src/lessons/authoring/contacts.js'
import { inHandsRiffleLayout, inHandsHalfReachX, inHandsHalfComposite, faceQuat } from '../../src/lessons/engine/layouts.js'
import { fingertipWorld } from '../../src/hands/handKinematics.js'
import { FINGERS, HAND_SCALE } from '../../src/hands/handRigSpec.js'
import { createDeck } from '../../src/deckModel.js'
import { CARD_GAP } from '../../src/lib/constants.js'

const AIR_Y = 1.0
const YAW = 0.22
const deck = createDeck()
const MID = Math.floor(deck.length / 2)
const halfH = (MID - 1) * CARD_GAP

const NAMES = ['thumb', 'middle', 'index']
const WANT = { thumb: 'u', middle: 'u', index: 'n' }
const faceOf = (e) => [['x', e.x], ['u', e.u], ['n', e.n]].sort((a, b) => b[1] - a[1])[0][0]
const _t = new THREE.Vector3()
function padOn(pose, side, name, cards) {
  fingertipWorld(pose, side, name, _t)
  let best = Infinity
  let face = '?'
  for (const c of cards) {
    const pos = c.pos.isVector3 ? c.pos : new THREE.Vector3(...c.pos)
    const lp = _t.clone().sub(pos).applyQuaternion(c.quat.clone().invert())
    const e = cardSurfaceExtents(lp, c.bend ?? 0)
    const o = Math.hypot(Math.max(e.x, 0), Math.max(e.u, 0), Math.max(e.n, 0))
    const g = o > 0 ? o : Math.max(e.x, e.u, e.n)
    if (g < best) { best = g; face = faceOf(e) }
  }
  return { gap: best - FINGERS[name].rad[2] * HAND_SCALE, face }
}

console.log('canonical solve + rigid composite rotation, checked against the real layout\n')
console.log('tilt   side   thumb            middle           index            verdict')

for (const tilt of [0.06, 0.2, 0.34]) {
  const layout = inHandsRiffleLayout(deck, { baseY: AIR_Y, yaw: YAW, tilt })
  const right = layout.slice(MID)
  const left = layout.slice(0, MID)
  const centre = inHandsHalfReachX(YAW, tilt, halfH) - 0.01

  // The layout's OWN composite, from the shared helper - not re-derived here.
  const composite = inHandsHalfComposite(YAW, tilt, 1)

  // Solve FLAT and portrait at the half's own centre, then rotate about that centre.
  const flat = edgePinchGripAuto({
    centerX: centre, centerZ: 0, baseY: AIR_Y, deckH: halfH,
    squeeze: 0.3, cardQuat: faceQuat(false), axis: 'end',
  })
  // Pivot on the BASE card: the canonical stack starts at baseY and grows +y,
  // and so does the layout's after rotation, so the base card is the fixed point.
  const pivot = [centre, AIR_Y, 0]
  const g = rotateGripRigid(flat, composite, pivot)

  for (const [side, cards] of [['right', right], ['left', left]]) {
    const pose = side === 'right' ? g.pose : (() => {
      const p = { ...g.pose, wrist: { pos: g.pose.wrist.pos.clone(), quat: g.pose.wrist.quat } }
      p.wrist.pos.x = -p.wrist.pos.x
      return p
    })()
    const r = NAMES.map((n) => padOn(pose, side, n, cards))
    const touching = r.filter((x) => Math.abs(x.gap) < 0.025).length
    const facesOk = NAMES.every((n, i) => r[i].face === WANT[n])
    console.log(
      `${tilt.toFixed(2)}   ${side.padEnd(6)} ` +
        r.map((x) => `${x.gap.toFixed(4)}${x.face}`.padEnd(17)).join('') +
        `${touching}/3 ${facesOk ? 'right faces' : 'WRONG FACES'}`,
    )
  }
}
