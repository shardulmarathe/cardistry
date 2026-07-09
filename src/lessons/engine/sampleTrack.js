import * as THREE from 'three'
import { getEase, clamp01 } from '../../lib/ease'
import { CARD_W, CARD_H } from '../../lib/constants'
import { lerpHandPose, cloneHandPose } from '../../hands/handPoses'
import { applyIdle, applyFingerMotion } from '../../hands/handMotion'
import { applyGripPressure } from '../../hands/handKinematics'
import { frameOf, applyGripFrame, pressureAt } from './grips'

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

// A procedural wrist-position overlay, evaluated as a pure function of the
// segment-local, UN-eased t. Every shape uses integer `cycles`, so the offset
// is exactly zero at t=0 and t=1 — segment boundaries, step jumps, gaps, and
// reverse scrubbing all stay pop-free, and the whole pipeline stays a pure
// function of ms. `sx` (baked at compile) mirrors x for the left hand.
const _motionV = new THREE.Vector3()
function motionOffset(m, t, out) {
  out.set(0, 0, 0)
  const amp = m.amp ?? 0
  const cycles = m.cycles ?? 1
  const sx = m.sx ?? 1
  const phase = m.phase ?? 0
  if (m.type === 'orbit') {
    const ph = 2 * Math.PI * phase
    const ang = 2 * Math.PI * (cycles * t + phase)
    out.x = (Math.cos(ang) - Math.cos(ph)) * amp * sx
    out.z = (Math.sin(ang) - Math.sin(ph)) * amp
  } else if (m.type === 'rock') {
    const s = Math.sin(2 * Math.PI * cycles * t) * amp
    const axis = m.axis || 'y'
    if (axis === 'x') out.x = s * sx
    else if (axis === 'z') out.z = s
    else out.y = s
  } else if (m.type === 'jitter') {
    out.x = (Math.sin(2 * Math.PI * cycles * t) * 0.6 + Math.sin(2 * Math.PI * 2 * cycles * t) * 0.4) * amp * sx
    out.y = Math.sin(2 * Math.PI * (cycles + 1) * t) * amp * 0.5
  }
  return out
}

// The global idle overlay runs on ABSOLUTE ms (continuous everywhere — no
// boundary pops possible) and is applied to EVERY returned pose, including the
// clamped before/after branches, so hands breathe even while "holding still".
// Those branches must clone: segment poses are shared track data and the idle
// mutates. Grip capture goes through this same function (sampleHandSegments),
// so offsets are always captured against the exact pose the viewer sees.
function handFromSegments(segs, ms, side) {
  if (segs.length === 0) return null
  if (ms <= segs[0].tStart) {
    return applyIdle(cloneHandPose(segs[0].from), ms, side, segs[0].idleScale ?? 1)
  }
  const last = segs[segs.length - 1]
  if (ms >= last.tEnd) return applyIdle(cloneHandPose(last.to), ms, side, last.idleScale ?? 1)
  let seg = segs[0]
  for (let i = 0; i < segs.length; i++) {
    if (ms >= segs[i].tStart) seg = segs[i]
    else break
  }
  if (ms >= seg.tEnd) return applyIdle(cloneHandPose(seg.to), ms, side, seg.idleScale ?? 1)
  const span = Math.max(1, seg.tEnd - seg.tStart)
  const localT = clamp01((ms - seg.tStart) / span)
  const e = getEase(seg.ease)(localT)
  const out = lerpHandPose(seg.from, seg.to, e)
  if (seg.motion) out.wrist.pos.add(motionOffset(seg.motion, localT, _motionV))
  if (seg.fingerMotion) applyFingerMotion(out, seg.fingerMotion, localT)
  return applyIdle(out, ms, side, seg.idleScale ?? 1)
}

// Pure samplers the compiler needs to capture grip offsets at compile time.
export function sampleHandSegments(segs, ms, side = 'right') {
  return handFromSegments(segs, ms, side)
}
export function sampleCardSegments(segs, ms) {
  const out = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), bend: 0 }
  return poseFromSegments(segs, ms, out)
}

// The felt is a plane at y=0 and cards may NEVER poke through it. This is the
// engine-level guarantee: given the card's orientation, find how far its
// lowest corner hangs below its center (the y-reach of the rotated width and
// length axes) and push the card up if that corner would dip under the felt.
// Pure and continuous in the pose, so scrub purity and boundary continuity
// are preserved; flat resting cards (drop = 0) are untouched.
const FELT_Y = 0.012
const _axW = new THREE.Vector3()
const _axL = new THREE.Vector3()
function clampAboveFelt(out) {
  _axW.set(1, 0, 0).applyQuaternion(out.quat)
  _axL.set(0, 1, 0).applyQuaternion(out.quat) // card local Y = long axis
  const drop = Math.abs(_axW.y) * (CARD_W / 2) + Math.abs(_axL.y) * (CARD_H / 2)
  const lowest = out.pos.y - drop
  if (lowest < FELT_Y) out.pos.y += FELT_Y - lowest
}

const outputCache = new Map()

export function sampleTrack(track, ms) {
  // Hands are sampled FIRST: held cards read the live grip frame from them.
  const hands = {
    left: handFromSegments(track.hands?.left ?? [], ms, 'left'),
    right: handFromSegments(track.hands?.right ?? [], ms, 'right'),
  }

  // Which cards are attached to a hand right now (id -> {hold, offset}), plus
  // grip pressure per side. Pressure visibly tightens the rendered hand's
  // gripping fingers BEFORE contact frames are computed — the same order the
  // compiler used at capture time (holdFrameAt), so the weld stays exact.
  const active = new Map()
  const sidePressure = { left: 0, right: 0 }
  if (track.holds) {
    for (const h of track.holds) {
      if (ms < h.tStart || ms > h.tEnd) continue
      const p = pressureAt(h, ms)
      if (p > sidePressure[h.side]) sidePressure[h.side] = p
      for (const [id, off] of h.offsets) {
        // Per-card release: after its own moment, the card has left this hand.
        if (ms > (h.releases?.get(id) ?? h.tEnd)) continue
        if (off) active.set(id, { hold: h, offset: off, pressure: p })
      }
    }
  }
  for (const side of ['left', 'right']) {
    if (hands[side] && sidePressure[side]) {
      // find the pressured frame type of this side's most-pressured hold
      let type = null
      for (const h of track.holds) {
        if (ms >= h.tStart && ms <= h.tEnd && h.side === side && pressureAt(h, ms) === sidePressure[side]) {
          type = h.frame
          break
        }
      }
      if (type) applyGripPressure(hands[side], type, sidePressure[side])
    }
  }

  // One contact frame per (side, frameType) per sample — not per card.
  const frameCache = new Map()
  const gripFrame = (hold) => {
    const key = `${hold.side}|${hold.frame}`
    let fr = frameCache.get(key)
    if (fr === undefined) {
      fr = frameOf(hands[hold.side], hold.side, hold.frame)
      frameCache.set(key, fr)
    }
    return fr
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
    // bend stays with the card's own track, plus the grip's pressure bow.
    const held = active.get(id)
    if (held) {
      const fr = gripFrame(held.hold)
      if (fr) {
        applyGripFrame(fr, held.offset, out.pos, out.quat)
        if (held.hold.bendGain) out.bend += held.pressure * held.hold.bendGain
      }
    }
    clampAboveFelt(out)
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
