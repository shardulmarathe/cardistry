import * as THREE from 'three'
import { faceQuat } from '../engine/layouts'

export function buildGuideGhosts(endPoses, cardIds, max = 6) {
  const picks = cardIds.slice(0, max)
  return picks.map((id) => {
    const p = endPoses.get(id)
    if (!p) return null
    return { id, pos: p.pos.clone(), quat: p.quat.clone(), bend: p.bend }
  }).filter(Boolean)
}

export function buildGuideArrows(fromPoses, toPoses, cardIds, max = 4) {
  const arrows = []
  for (const id of cardIds.slice(0, max)) {
    const a = fromPoses.get(id)
    const b = toPoses.get(id)
    if (!a || !b) continue
    arrows.push({ from: a.pos.clone(), to: b.pos.clone() })
  }
  return arrows
}

export function buildGuidePath(fromPoses, toPoses, cardId) {
  const a = fromPoses.get(cardId)
  const b = toPoses.get(cardId)
  if (!a || !b) return []
  const mid = a.pos.clone().lerp(b.pos, 0.5)
  mid.y += 0.25
  return [a.pos.clone(), mid, b.pos.clone()]
}

export function stackGhostPose(y = 0.5) {
  return {
    pos: new THREE.Vector3(0, y, 0),
    quat: faceQuat(false),
    bend: 0,
  }
}
