import * as THREE from 'three'
import { CARD_GAP, CARD_W, CARD_H } from '../../lib/constants'

// Per-card Y lift prevents z-fighting when cards overlap in spread layouts.
// Keep this tiny: in fan/ring/spiral layouts consecutive cards visually touch,
// so a large lift creates real depth separation that exposes a dark sliver of
// background between them (looked like a black outline tracing every card).
const LIFT = (i) => 0.02 + i * CARD_GAP * 0.4

// Card geometry is in the XY plane (front normal +Z). To lie flat on the table
// we rotate about X: -90° => face up (front points +Y), +90° => face down.
// A flip is therefore a PI rotation about X, a natural table turn-over.
const RX_UP = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
const RX_DOWN = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0))

export function faceQuat(isFaceUp, yaw = 0) {
  const q = (isFaceUp ? RX_UP : RX_DOWN).clone()
  if (yaw) {
    const y = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0))
    q.premultiply(y)
  }
  return q
}

// A squared, face-down (or per-card) resting stack at table center.
export function stackLayout(deck, baseY = 0.02) {
  return deck.map((card, i) => ({
    id: card.id,
    pos: new THREE.Vector3(0, baseY + i * CARD_GAP, 0),
    quat: faceQuat(card.isFaceUp),
    bend: 0,
  }))
}

// Two squared half-stacks, side by side (riffle/faro start). gap in world units.
export function twoHalvesLayout(deck, gap = 0.95, baseY = 0.02) {
  const mid = Math.floor(deck.length / 2)
  return deck.map((card, i) => {
    const inLeft = i < mid
    const localIndex = inLeft ? i : i - mid
    return {
      id: card.id,
      pos: new THREE.Vector3(inLeft ? -gap : gap, baseY + localIndex * CARD_GAP, 0),
      quat: faceQuat(card.isFaceUp),
      bend: 0,
    }
  })
}



// IN-HANDS riffle: two half-decks held IN THE AIR, one per hand, brought corner
// to corner ready to interlace. This is the version people mean by "riffle
// shuffle", and it is a different object from `tableRiffleLayout` in three ways
// that all matter:
//
//   * The halves are OFF THE FELT (`baseY` ~ 1.0), so nothing here may rely on
//     the table to hold a card up, and `clampAboveFelt` never fires.
//   * They meet at a shallow V, not parallel. Reference footage shows the two
//     packets butt-jointed at their inner corners forming a dog-leg of ~2*`yaw`,
//     which is what lets a single corner of each interleave with the other while
//     the far ends stay apart in the hands.
//   * Each half is ROLLED about its own long axis (`tilt`), inner edge up: that
//     is the thumbs loading the spring. The roll is per-half and mirrored, so the
//     two inner edges rise toward each other.
//
// Cards stack along the half's own face NORMAL (not world Y), because a packet
// held at a tilt is a slab in its own frame — stacking along world Y would shear
// it. `telescope` is how far each half slides inward for the finishing push.
// How far a landscape half reaches along world X from its own centre, given the
// inward yaw and the roll. DERIVED by evaluating the card's four corners rather
// than typed: the roll about world Z changes the x extent too, so the closed form
// is not just (CARD_H/2)*cos(yaw), and a typed gap silently stops meaning "the
// ends touch" the moment either angle is tuned. (Measured the wrong way first:
// a typed 0.42 overlapped the two halves by 0.156.)
export function inHandsHalfReachX(yaw = 0.22, tilt = 0.3, stack = 0) {
  const q = faceQuat(false, Math.PI / 2 - yaw)
  q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -tilt))
  const v = new THREE.Vector3()
  let reach = 0
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      v.set((sx * CARD_W) / 2, (sy * CARD_H) / 2, 0).applyQuaternion(q)
      reach = Math.max(reach, Math.abs(v.x))
    }
  }
  // A ROLLED STACK LEANS. Cards are stacked along the half's own face normal, and
  // once the half is rolled that normal has an x component, so the outermost card
  // of a 26-card half sits further out than the innermost. Ignoring it cost 0.022
  // per side and the "just touching" default overlapped by 0.064.
  v.set(0, 0, 1).applyQuaternion(q)
  return reach + Math.abs(v.x) * stack
}

export function inHandsRiffleLayout(
  deck,
  { gap = null, baseY = 1.0, yaw = 0.22, tilt = 0.3, z = 0, telescope = 0, overlap = 0.01 } = {},
) {
  const mid = Math.floor(deck.length / 2)
  // Default: inner ends just touching, minus a hair of bite. A real riffle brings
  // the corners into contact BEFORE the thumbs release; the interleave happens
  // where they touch.
  const centre = gap ?? inHandsHalfReachX(yaw, tilt, (mid - 1) * CARD_GAP) - overlap
  const _n = new THREE.Vector3()
  return deck.map((card, i) => {
    const inLeft = i < mid
    const local = inLeft ? i : i - mid
    const s = inLeft ? -1 : 1
    // LANDSCAPE, like tableRiffleLayout: `faceQuat`'s own yaw is measured off the
    // portrait orientation, whose long axis runs along world Z, so a small yaw
    // leaves the halves side by side across their WIDTH and their short ends
    // never meet. It has to be a quarter turn MINUS the inward angle, which puts
    // the long axes along X with the inner ends pointing at each other.
    const quat = faceQuat(false, s * (Math.PI / 2 - yaw))
    quat.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -s * tilt))
    // Stack along this half's own face normal.
    _n.set(0, 0, 1).applyQuaternion(quat).multiplyScalar(local * CARD_GAP)
    // `telescope` is a DISTANCE each half slides inward, not a fraction of the
    // gap: the finishing push moves the halves together by about a tenth of a
    // card, and scaling the whole gap by a progress term drove them a full card
    // length through each other.
    const reach = centre - telescope
    return {
      id: card.id,
      pos: new THREE.Vector3(s * reach + _n.x, baseY + _n.y, z + _n.z),
      quat,
      bend: 0,
    }
  })
}

// TABLE riffle: two halves FLAT on the felt, turned LANDSCAPE (long axis
// left-right, the way riffles look in videos), one half moved left and the
// other right so their inner short ends meet at the center. `yaw` is the small
// inward angle off 90° that points the inner ends at each other. `tilt` lifts
// each half's INNER end as the thumbs load the spring, pivoting on the OUTER
// end, which stays exactly on the felt, so no corner can dip under the table.
// Always face-down: a riffle is dealt face-down however the deck arrived.
export function tableRiffleLayout(deck, { gap = 0.5, yaw = 0.12, baseY = 0.03, tilt = 0 } = {}) {
  const mid = Math.floor(deck.length / 2)
  return deck.map((card, i) => {
    const inLeft = i < mid
    const local = inLeft ? i : i - mid
    const s = inLeft ? -1 : 1
    const quat = faceQuat(false, s * (Math.PI / 2 - yaw))
    let y = baseY + local * CARD_GAP
    let x = s * gap
    if (tilt) {
      // rotZ lifts the +x side for a positive angle; the inner end of each
      // half faces the center (-s·x), so lift it with -s·tilt and compensate
      // the center so the outer end keeps sitting on the table.
      quat.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -s * tilt))
      y += (CARD_H / 2) * Math.sin(tilt)
      x += s * (CARD_H / 2) * (1 - Math.cos(tilt)) * 0.5
    }
    return { id: card.id, pos: new THREE.Vector3(x, y, 0), quat, bend: 0 }
  })
}

// A squared landscape stack at center, where a table riffle's weave lands and
// the bridge/cascade finish happens (short ends facing the hands at ±x).
export function landscapeStackLayout(deck, { baseY = 0.02, bend = 0 } = {}) {
  return deck.map((card, i) => ({
    id: card.id,
    pos: new THREE.Vector3(0, baseY + i * CARD_GAP, 0),
    quat: faceQuat(false, Math.PI / 2),
    bend,
  }))
}

// A dealer's arc spread flat on the table (the visualizer "fan"). Wider spread +
// larger radius + a stronger per-card lift so every card peeks out of the fan
// instead of collapsing into one overlapping sliver.
export function fanLayout(deck, { spread = Math.PI * 0.92, radius = 2.0 } = {}) {
  const n = deck.length
  return deck.map((card, i) => {
    const t = n <= 1 ? 0.5 : i / (n - 1)
    const ang = (t - 0.5) * spread
    const x = Math.sin(ang) * radius
    const z = -Math.cos(ang) * radius + radius * 0.72
    const y = 0.02 + i * CARD_GAP * 0.9
    return {
      id: card.id,
      pos: new THREE.Vector3(x, y, z),
      quat: faceQuat(card.isFaceUp, -ang),
      bend: 0,
    }
  })
}

// Lay a set of contiguous packets out in a row (overhand / hindu / strip).
export function blocksRowLayout(blocks, { spacing = 0.66, z = 0.12 } = {}) {
  const B = blocks.length
  const poses = []
  blocks.forEach((block, b) => {
    const x = (b - (B - 1) / 2) * spacing
    block.forEach((card, i) => {
      poses.push({
        id: card.id,
        pos: new THREE.Vector3(x, 0.02 + i * CARD_GAP, z),
        quat: faceQuat(card.isFaceUp),
        bend: 0,
      })
    })
  })
  return poses
}

// A full ring / mandala, cards radiate outward around the table center.
export function circleLayout(deck, { radius = 2.15 } = {}) {
  const n = deck.length
  return deck.map((card, i) => {
    const a = (i / n) * Math.PI * 2
    return {
      id: card.id,
      pos: new THREE.Vector3(Math.sin(a) * radius, LIFT(i), Math.cos(a) * radius),
      quat: faceQuat(card.isFaceUp, a),
      bend: 0,
    }
  })
}

// A long straight ribbon spread across the table.
export function ribbonLayout(deck, { step = 0.14 } = {}) {
  const n = deck.length
  return deck.map((card, i) => ({
    id: card.id,
    pos: new THREE.Vector3((i - (n - 1) / 2) * step, LIFT(i), 0),
    quat: faceQuat(card.isFaceUp, 0),
    bend: 0,
  }))
}

// An Archimedean spiral coiling out from the center.
export function spiralLayout(deck) {
  return deck.map((card, i) => {
    const a = i * 0.42
    const r = 0.18 + i * 0.032
    return {
      id: card.id,
      pos: new THREE.Vector3(Math.cos(a) * r, LIFT(i), Math.sin(a) * r),
      quat: faceQuat(card.isFaceUp, -a),
      bend: 0,
    }
  })
}

// A tidy grid, spacing must exceed card footprint to avoid overlap / z-fighting.
export function gridLayout(deck, { cols = 13 } = {}) {
  const colStep = CARD_W + 0.08
  const rowStep = CARD_H + 0.1
  return deck.map((card, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    return {
      id: card.id,
      pos: new THREE.Vector3((col - (cols - 1) / 2) * colStep, LIFT(i), (row - 1.5) * rowStep),
      quat: faceQuat(card.isFaceUp, 0),
      bend: 0,
    }
  })
}

// Deal round-robin into N piles laid out in a row.
export function pilesLayout(deck, pileCount = 4, { spacing = 0.85 } = {}) {
  const piles = Array.from({ length: pileCount }, () => [])
  deck.forEach((card, i) => piles[i % pileCount].push(card))
  const poses = []
  piles.forEach((pile, p) => {
    const x = (p - (pileCount - 1) / 2) * spacing
    pile.forEach((card, i) => {
      poses.push({
        id: card.id,
        pos: new THREE.Vector3(x, 0.02 + i * CARD_GAP, 0.1),
        quat: faceQuat(card.isFaceUp),
        bend: 0,
      })
    })
  })
  return poses
}

// Charlier cut: bottom half pivots up and over to the top (one-handed cut pose).
export function charlierLayout(deck, progress = 1, baseY = 0.02) {
  const mid = Math.floor(deck.length / 2)
  const lift = progress * 0.9
  const tilt = progress * Math.PI * 0.55
  return deck.map((card, i) => {
    const isBottom = i < mid
    const localIndex = isBottom ? i : i - mid
    if (isBottom) {
      const x = -0.15 + progress * 0.3
      const y = baseY + localIndex * CARD_GAP + lift
      const z = 0.12 + progress * 0.2
      const q = faceQuat(card.isFaceUp)
      const pivot = new THREE.Quaternion().setFromEuler(new THREE.Euler(-tilt, 0.3 * progress, 0))
      q.premultiply(pivot)
      return { id: card.id, pos: new THREE.Vector3(x, y, z), quat: q, bend: progress * 1.2 }
    }
    return {
      id: card.id,
      pos: new THREE.Vector3(0.08, baseY + localIndex * CARD_GAP, 0),
      quat: faceQuat(card.isFaceUp),
      bend: 0,
    }
  })
}



export const VISUALIZER_LAYOUTS = [
  { id: 'fan', label: 'Fan' },
  { id: 'circle', label: 'Ring' },
  { id: 'ribbon', label: 'Ribbon' },
  { id: 'spiral', label: 'Spiral' },
  { id: 'grid', label: 'Grid' },
  { id: 'stack', label: 'Stack' },
]

export function buildVizLayout(id, deck) {
  switch (id) {
    case 'circle':
      return circleLayout(deck)
    case 'ribbon':
      return ribbonLayout(deck)
    case 'spiral':
      return spiralLayout(deck)
    case 'grid':
      return gridLayout(deck)
    case 'stack':
      return stackLayout(deck)
    case 'fan':
    default:
      return fanLayout(deck)
  }
}

// Convert a pose array into a Map<id, pose> for O(1) lookup.
export function toPoseMap(poses) {
  const m = new Map()
  for (const p of poses) m.set(p.id, p)
  return m
}
