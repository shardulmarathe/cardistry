import * as THREE from 'three'
import { CARD_GAP, CARD_W, CARD_H } from '../../lib/constants'

// Per-card Y lift prevents z-fighting when cards overlap in spread layouts.
// Keep this tiny: in fan/ring/spiral layouts consecutive cards visually touch,
// so a large lift creates real depth separation that exposes a dark sliver of
// background between them (looked like a black outline tracing every card).
const LIFT = (i) => 0.02 + i * CARD_GAP * 0.4

// Card geometry is in the XY plane (front normal +Z). To lie flat on the table
// we rotate about X: -90° => face up (front points +Y), +90° => face down.
// A flip is therefore a PI rotation about X — a natural table turn-over.
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

// On-edge orientations for a riffle grip: the card long axis (local Y) points
// up (world +Y) and the FACE (local +Z normal) points to the side (world ±X)
// toward each hand — a real bridge, not a flat pile facing the ceiling. Built
// as a ±90° turn about world Y. With faces along ±X, the existing long-axis
// bend bows the standing card so its arch profile faces the dealer (normal ≈
// world Z) — the bow "faces the sides", per design.
export const ON_EDGE = {
  left: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2),
  right: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
}

// Two on-edge half-decks, one per hand, ready to bow into a riffle bridge. Each
// half is stacked along world X (its face-normal axis) so cards don't z-fight.
export function riffleGripLayout(deck, { gap = 0.5, baseY = 0.5, lean = 0 } = {}) {
  const mid = Math.floor(deck.length / 2)
  return deck.map((card, i) => {
    const inLeft = i < mid
    const local = inLeft ? i : i - mid
    const sign = inLeft ? -1 : 1
    const quat = ON_EDGE[inLeft ? 'left' : 'right'].clone()
    if (lean) {
      quat.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -sign * lean))
    }
    return {
      id: card.id,
      pos: new THREE.Vector3(sign * gap + sign * local * CARD_GAP, baseY, 0),
      quat,
      bend: 0,
    }
  })
}

// TABLE riffle: two face-down halves FLAT on the felt, side by side, inner
// corners angled toward each other — the real casino grip. `tilt` lifts each
// half's NEAR (+z, dealer-side) edge as the thumbs bend the cards up to load
// the spring; the far edge stays on the table (position compensates the pivot).
export function tableRiffleLayout(deck, { gap = 0.5, yaw = 0.22, baseY = 0.02, tilt = 0 } = {}) {
  const mid = Math.floor(deck.length / 2)
  const tiltQ = tilt ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -tilt) : null
  return deck.map((card, i) => {
    const inLeft = i < mid
    const local = inLeft ? i : i - mid
    const s = inLeft ? -1 : 1
    const quat = faceQuat(card.isFaceUp, s * yaw)
    let y = baseY + local * CARD_GAP
    let z = 0
    if (tiltQ) {
      quat.premultiply(tiltQ)
      // pivot at the far edge: center rises by half the lifted-edge height
      y += (CARD_H / 2) * Math.sin(tilt)
      z -= (CARD_H / 2) * (1 - Math.cos(tilt)) * 0.5
    }
    return { id: card.id, pos: new THREE.Vector3(s * gap, y, z), quat, bend: 0 }
  })
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

// A full ring / mandala — cards radiate outward around the table center.
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

// A tidy grid — spacing must exceed card footprint to avoid overlap / z-fighting.
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

// Pressure fan: cards bloom from a pivot corner into a tight arc.
export function pressureFanLayout(deck, { spread = Math.PI * 0.55, radius = 1.4, progress = 1 } = {}) {
  const n = deck.length
  return deck.map((card, i) => {
    const t = n <= 1 ? 0.5 : i / (n - 1)
    const ang = t * spread * progress
    const x = Math.sin(ang) * radius * progress + 0.35
    const z = -Math.cos(ang) * radius * 0.5 * progress
    const y = 0.02 + i * CARD_GAP * 0.4
    return {
      id: card.id,
      pos: new THREE.Vector3(x, y, z),
      quat: faceQuat(card.isFaceUp, -ang + 0.2),
      bend: 0,
    }
  })
}

// Spring arch: the whole deck bowed between two hands.
export function springArchLayout(deck, bend = 2.8, baseY = 0.02) {
  return deck.map((card, i) => ({
    id: card.id,
    pos: new THREE.Vector3(0, baseY + i * CARD_GAP, 0),
    quat: faceQuat(card.isFaceUp),
    bend,
  }))
}

// Cascade release: cards fan out downward between hands.
export function cascadeLayout(deck, progress = 1) {
  const n = deck.length
  return deck.map((card, i) => {
    const t = i / Math.max(1, n - 1)
    const x = (t - 0.5) * 1.8 * progress
    const y = 0.35 - t * 0.55 * progress
    const z = 0.15 + Math.sin(t * Math.PI) * 0.4 * progress
    return {
      id: card.id,
      pos: new THREE.Vector3(x, y, z),
      quat: faceQuat(card.isFaceUp, (t - 0.5) * 0.6 * progress),
      bend: Math.sin(t * Math.PI) * 1.8 * progress,
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
