import * as THREE from 'three'
import { getEase, clamp01 } from '../../lib/ease'
import { lerpHandPose } from '../../hands/handPoses'
import { frameOf, applyGripFrame } from './grips'

function poseFromSegments(segs, ms, out) {
  if (segs.length === 0) return null
  if (ms <= segs[0].tStart) {
    out.pos.copy(segs[0].from.pos)
    out.quat.copy(segs[0].from.quat)
    out.bend = segs[0].from.bend
    return out
  }
  const last = segs[segs.length - 1]
  if (ms >= last.tEnd) {
    out.pos.copy(last.to.pos)
    out.quat.copy(last.to.quat)
    out.bend = last.to.bend
    return out
  }
  let seg = segs[0]
  for (let i = 0; i < segs.length; i++) {
    if (ms >= segs[i].tStart) seg = segs[i]
    else break
  }
  if (ms >= seg.tEnd) {
    out.pos.copy(seg.to.pos)
    out.quat.copy(seg.to.quat)
    out.bend = seg.to.bend
    return out
  }
  const span = Math.max(1, seg.tEnd - seg.tStart)
  const localT = clamp01((ms - seg.tStart) / span)
  const e = getEase(seg.ease)(localT)
  out.pos.lerpVectors(seg.from.pos, seg.to.pos, e)
  out.quat.copy(seg.from.quat).slerp(seg.to.quat, e)
  out.bend = seg.from.bend + (seg.to.bend - seg.from.bend) * e
  if (seg.midBend) out.bend += Math.sin(localT * Math.PI) * seg.midBend
  if (seg.arcLift) out.pos.y += Math.sin(localT * Math.PI) * seg.arcLift
  return out
}

function handFromSegments(segs, ms) {
  if (segs.length === 0) return null
  if (ms <= segs[0].tStart) return segs[0].from
  const last = segs[segs.length - 1]
  if (ms >= last.tEnd) return last.to
  let seg = segs[0]
  for (let i = 0; i < segs.length; i++) {
    if (ms >= segs[i].tStart) seg = segs[i]
    else break
  }
  if (ms >= seg.tEnd) return seg.to
  const span = Math.max(1, seg.tEnd - seg.tStart)
  const localT = clamp01((ms - seg.tStart) / span)
  const e = getEase(seg.ease)(localT)
  return lerpHandPose(seg.from, seg.to, e)
}

// Pure samplers the compiler needs to capture grip offsets at compile time.
export function sampleHandSegments(segs, ms) {
  return handFromSegments(segs, ms)
}
export function sampleCardSegments(segs, ms) {
  const out = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), bend: 0 }
  return poseFromSegments(segs, ms, out)
}

const outputCache = new Map()

export function sampleTrack(track, ms) {
  // Hands are sampled FIRST: held cards read the live grip frame from them.
  const hands = {
    left: handFromSegments(track.hands?.left ?? [], ms),
    right: handFromSegments(track.hands?.right ?? [], ms),
  }

  // Which cards are attached to a hand right now (id -> {side, offset}).
  const active = new Map()
  if (track.holds) {
    for (const h of track.holds) {
      if (ms < h.tStart || ms > h.tEnd) continue
      for (const [id, off] of h.offsets) if (off) active.set(id, { side: h.side, offset: off })
    }
  }

  const cards = new Map()
  for (const [id, segs] of track.cards) {
    let out = outputCache.get(id)
    if (!out) {
      out = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), bend: 0 }
      outputCache.set(id, out)
    }
    poseFromSegments(segs, ms, out)
    // If this card is gripped, override pos/quat from the hand frame ∘ offset.
    // bend is left to the card's own track (the packet still bows in-hand).
    const held = active.get(id)
    if (held) {
      const fr = frameOf(hands[held.side])
      if (fr) applyGripFrame(fr, held.offset, out.pos, out.quat)
    }
    cards.set(id, out)
  }

  const annotations = []
  for (const a of track.annotations) {
    if (ms >= a.tStart && ms <= a.tEnd) {
      const fadeIn = clamp01((ms - a.tStart) / 220)
      const fadeOut = clamp01((a.tEnd - ms) / 220)
      annotations.push({
        id: a.id,
        text: a.text,
        worldPos: a.worldPos,
        opacity: Math.min(fadeIn, fadeOut),
      })
    }
  }

  return { cards, annotations, hands, stepIndex: stepIndexAt(track, ms) }
}

export function stepIndexAt(track, ms) {
  const steps = track.steps
  for (let i = steps.length - 1; i >= 0; i--) {
    if (ms >= steps[i].tStart) return i
  }
  return 0
}
