import * as THREE from 'three'
import { getEase, clamp01 } from '../../lib/ease'
import { CARD_W, CARD_H, FELT_Y } from '../../lib/constants'
import { lerpHandPose, cloneHandPose } from '../../hands/handPoses'
import { applyIdle, applyFingerMotion } from '../../hands/handMotion'
import { applyGripPressure, reseatGrippingTips, grippingFingers } from '../../hands/handKinematics'
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
  // HEIGHT CAN RUN ON ITS OWN CURVE, and it is a card-clipping fix of the same shape
  // as `quatEase` below: when two things have to pass each other, separate their
  // motions in time.
  //
  // A packet leaving the TOP of a block has to get laterally clear of that block
  // before it descends, or it drops straight through the cards it was just sitting on.
  // Measured on the overhand's `drop-0`: 5-spades starts 1 card ABOVE 4-spades in the
  // bulk and falls to the pile while their footprints still overlap, so the two trade
  // which is on top - 1116 such swaps across the lesson, 88 a second, every one of
  // them covering more than a quarter of a card face. `yEase: 'easeInCubic'` against a
  // lateral `easeOutCubic` sends the card sideways first and down second, which is
  // both what a stripped packet does and what stops the crossing.
  //
  // Defaults to the position ease, so every existing segment is unchanged. `arcLift`
  // still applies on top of whichever curve is used.
  if (seg.yEase) {
    out.pos.y = seg.from.pos.y + (seg.to.pos.y - seg.from.pos.y) * getEase(seg.yEase)(localT)
  }
  // ROTATION CAN RUN ON ITS OWN CURVE, and it is a card-clipping fix.
  // Sharing the position ease means a packet that has to both TURN and TRAVEL does
  // both at once - so a half rotating from on-edge to flat while descending onto
  // another half passes THROUGH it on the way, at every angle in between. Measured on
  // the charlier's `fall`: 2172 clipping pair-frames up to 22.6 CARD THICKNESSES deep,
  // at 43 degrees, with zero bend involved (so unlike the wash and the riffle this one
  // is pure rotation, not arch).
  //
  // Splitting the curves lets a lesson say "come level FIRST, then come down", which
  // is both what the move looks like and what stops the crossing. Same shape as the
  // fix for a hand and a card arriving together. Defaults to the position ease, so
  // every existing segment is unchanged.
  out.quat.copy(seg.from.quat).slerp(seg.to.quat, seg.quatEase ? getEase(seg.quatEase)(localT) : e)
  out.bend = seg.from.bend + (seg.to.bend - seg.from.bend) * e
  if (seg.midBend) out.bend += Math.sin(localT * Math.PI) * seg.midBend
  if (seg.arcLift) out.pos.y += Math.sin(localT * Math.PI) * seg.arcLift
  return out
}

// A procedural wrist-position overlay, evaluated as a pure function of the
// segment-local, UN-eased t. Every shape uses integer `cycles`, so the offset
// is exactly zero at t=0 and t=1, segment boundaries, step jumps, gaps, and
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
    // Deliberately CIRCULAR. An elliptical `ampZ` was added here to stop the wash's
    // pads overshooting the near edge of the card band by 0.23, and then removed,
    // because deriving the honest limit shows the cure is worse: a hand's pad patch
    // is 0.783 deep in z (the thumb pad sits ~78mm behind the middle fingertip -
    // anatomy, not a pose), and the wash's card band is only 0.9 deep, so keeping
    // the whole pad envelope inside the band allows ampZ <= 0.0585 against an x amp
    // of 0.40. That is a 7:1 ellipse, i.e. a one-dimensional sweep - and "cards move
    // freely in TWO dimensions" is the wash's entire teaching point. The overshoot
    // wants a DEEPER CARD SPREAD (widen ROW_Z/ROW_HALF and re-check framing), not a
    // flatter orbit. Do not re-add the option without the deeper spread.
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

// The global idle overlay runs on ABSOLUTE ms (continuous everywhere, no
// boundary pops possible) and is applied to EVERY returned pose, including the
// clamped before/after branches, so hands breathe even while "holding still".
// Those branches must clone: segment poses are shared track data and the idle
// mutates. Grip capture goes through this same function (sampleHandSegments),
// so offsets are always captured against the exact pose the viewer sees.
// `gripFrameType`, when supplied, switches the gripping fingers from joint-angle
// interpolation to TASK-SPACE interpolation of their fingertips (see
// reseatGrippingTips). Only the branch that actually blends two rungs is
// affected; every clamped branch returns a rung pose, where the two agree by
// construction. The compiler's grip capture passes the same argument through
// sampleHandSegments, so capture, release baking and rendering cannot disagree.
function handFromSegments(segs, ms, side, gripFrameType = null) {
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
  if (gripFrameType) {
    const names = grippingFingers(gripFrameType)
    if (names) reseatGrippingTips(out, seg.from, seg.to, side, e, names)
  }
  if (seg.motion) out.wrist.pos.add(motionOffset(seg.motion, localT, _motionV))
  if (seg.fingerMotion) applyFingerMotion(out, seg.fingerMotion, localT)
  return applyIdle(out, ms, side, seg.idleScale ?? 1)
}

// Pure samplers the compiler needs to capture grip offsets at compile time.
export function sampleHandSegments(segs, ms, side = 'right', gripFrameType = null) {
  return handFromSegments(segs, ms, side, gripFrameType)
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
const _axW = new THREE.Vector3()
const _axL = new THREE.Vector3()
const _axN = new THREE.Vector3()
function clampAboveFelt(out) {
  _axW.set(1, 0, 0).applyQuaternion(out.quat)
  _axL.set(0, 1, 0).applyQuaternion(out.quat) // card local Y = long axis
  // A BOWED card is not the flat rectangle this clamp used to assume. The bend
  // shader (cardMaterial.js) maps local (x, y, 0) to
  //   (x, sin(y·b)/b, (1 − cos(y·b))/b)
  // so the card shortens along its long axis AND its ends swing toward local
  // +Z. Since (1 − cos) never changes sign, that swing is one-directional: on a
  // face-down card local +Z points at world −Y, so the ends curl DOWN. Ignoring
  // it put the riffle bridge 0.22 and the waterfall 0.29 below the felt, a
  // third of a card length buried, while this clamp reported it flush, because
  // the flat model only ever measured the (unbent) rectangle.
  //
  // Accounting for it makes the bow rest ON the table: the ends touch the felt
  // and the arch rises above, which is what a real bridge does.
  let halfLen = CARD_H / 2
  let bowDrop = 0
  const b = out.bend
  if (Math.abs(b) > 1e-4) {
    const half = (CARD_H / 2) * b
    halfLen = Math.abs(Math.sin(half) / b)
    _axN.set(0, 0, 1).applyQuaternion(out.quat)
    const bow = (1 - Math.cos(half)) / b // signed: ends travel 0 → bow along +Z
    bowDrop = Math.max(0, -_axN.y * bow) // counts only while that points down
  }
  const drop = Math.abs(_axW.y) * (CARD_W / 2) + Math.abs(_axL.y) * halfLen + bowDrop
  const lowest = out.pos.y - drop
  if (lowest < FELT_Y) out.pos.y += FELT_Y - lowest
}

const outputCache = new Map()

export function sampleTrack(track, ms) {
  // The hold scan runs FIRST. It needs no hands (holds carry their own times,
  // side, frame and offsets), and the hand sampler needs its result: a hand
  // that is gripping interpolates its gripping fingers through their fingertips
  // rather than through joint angles.
  //
  // Which cards are attached to a hand right now (id -> {hold, offset}), plus
  // grip pressure per side. Pressure visibly tightens the rendered hand's
  // gripping fingers BEFORE contact frames are computed, the same order the
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
  // The frame type of each side's most-pressured live hold. One per side: it
  // selects both the pressure curl (as before) and the task-space reseat, and
  // the two must agree or the weld and the render would use different poses.
  const sideFrame = { left: null, right: null }
  if (track.holds) {
    for (const side of ['left', 'right']) {
      if (!sidePressure[side]) continue
      for (const h of track.holds) {
        if (ms >= h.tStart && ms <= h.tEnd && h.side === side && pressureAt(h, ms) === sidePressure[side]) {
          sideFrame[side] = h.frame
          break
        }
      }
    }
  }

  const hands = {
    left: handFromSegments(track.hands?.left ?? [], ms, 'left', sideFrame.left),
    right: handFromSegments(track.hands?.right ?? [], ms, 'right', sideFrame.right),
  }

  for (const side of ['left', 'right']) {
    if (hands[side] && sidePressure[side] && sideFrame[side]) {
      applyGripPressure(hands[side], sideFrame[side], sidePressure[side])
    }
  }

  // One contact frame per (side, frameType) per sample, not per card.
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
