import * as THREE from 'three'
import { CARD_W, CARD_H } from '../lib/constants'

// Rounded-rect card mesh (like the original CSS border-radius + overflow:hidden).
// Segmented along Y so the bend shader can still bow the long axis.
const RADIUS = 0.045
const Y_SEGS = 24
const X_SEGS = 6

let cached = null

function halfWidthAtY(y, w, h, r) {
  const halfH = h / 2
  const halfW = w / 2
  const innerH = halfH - r
  const ay = Math.abs(y)
  if (ay <= innerH) return halfW
  const dy = ay - innerH
  return halfW - r + Math.sqrt(Math.max(0, r * r - dy * dy))
}

function buildRoundedCardGeometry(w, h, r, ySegs, xSegs) {
  const positions = []
  const uvs = []
  const indices = []
  const rowVerts = []

  for (let j = 0; j <= ySegs; j++) {
    const y = -h / 2 + (j / ySegs) * h
    const xHalf = halfWidthAtY(y, w, h, r)
    const row = []
    for (let i = 0; i <= xSegs; i++) {
      const x = -xHalf + (i / xSegs) * 2 * xHalf
      const idx = positions.length / 3
      positions.push(x, y, 0)
      // Standard convention (matches PlaneGeometry + CanvasTexture flipY): v
      // increases with +y. An earlier `1 - ...` here rendered every card
      // texture upside-down (invisible on symmetric art, obvious on the S/rank).
      uvs.push((x + w / 2) / w, (y + h / 2) / h)
      row.push(idx)
    }
    rowVerts.push(row)
  }

  // a=bottom-left, b=bottom-right, c=top-left, d=top-right (y increases with j).
  // CCW winding as seen from +Z gives a +Z face normal, matching the "front
  // normal +Z" convention every layout/bend calc in this codebase assumes.
  for (let j = 0; j < ySegs; j++) {
    for (let i = 0; i < xSegs; i++) {
      const a = rowVerts[j][i]
      const b = rowVerts[j][i + 1]
      const c = rowVerts[j + 1][i]
      const d = rowVerts[j + 1][i + 1]
      indices.push(a, b, d, a, d, c)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

export function getCardGeometry() {
  if (!cached) {
    cached = buildRoundedCardGeometry(CARD_W, CARD_H, RADIUS, Y_SEGS, X_SEGS)
  }
  return cached
}
