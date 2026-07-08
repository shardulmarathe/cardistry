import * as THREE from 'three'
import { contactFrame, GRIP_FRAME_TYPES } from '../../hands/handKinematics'

// Rigid attachment of cards to a hand's "grip frame" — the deterministic core
// of making the procedural hands actually pick up and carry a packet.
//
// The grip frame is (handPose.wrist.pos, handPose.wrist.quat): a plain
// right-handed rigid transform. The left hand is mirrored purely by the rig's
// negative root.scale.x, and getHandPose('left') keeps the SAME wrist.quat
// (only wrist.pos.x is negated). So capture and apply are side-agnostic — never
// mirror the quat or negate the offset for the left hand (that double-mirrors).
//
// Offsets are captured once (at compile time, at grip start) and are constants
// thereafter, so the whole pipeline stays a pure function of (track, ms).

// Resolve which cards a grip spec refers to, against the deck order at the
// grip's step. Split point matches twoHalvesLayout / riffleOrder: mid=floor(n/2).
export function resolveGripCards(spec, deck) {
  if (typeof spec === 'function') return spec(deck).slice()
  if (Array.isArray(spec)) return spec.slice()
  const mid = Math.floor(deck.length / 2)
  switch (spec) {
    case 'firstHalf':
      return deck.slice(0, mid).map((c) => c.id)
    case 'secondHalf':
      return deck.slice(mid).map((c) => c.id)
    case 'all':
      return deck.map((c) => c.id)
    default:
      return []
  }
}

// The grip frame of a sampled hand pose (or null if the side has no hand).
// frameType 'wrist' (default) is the legacy rigid wrist weld; the contact
// types ('pinch' | 'packet' | 'thumbPeel') derive the frame from fingertip FK
// so finger curls move the held cards. Capture and apply MUST use the same
// (side, frameType) — consistency is what makes the attachment exact.
export function frameOf(handPose, side = 'right', frameType = 'wrist', out = null) {
  if (!handPose) return null
  if (frameType === 'wrist' || !GRIP_FRAME_TYPES[frameType]) {
    return { pos: handPose.wrist.pos, quat: handPose.wrist.quat }
  }
  const frame = out ?? { pos: new THREE.Vector3(), quat: new THREE.Quaternion() }
  return contactFrame(handPose, side, frameType, frame)
}

// Piecewise-linear pressure of a hold at an absolute ms (clamped to the first/
// last authored point; 0 when the hold has no pressure track).
export function pressureAt(hold, ms) {
  const pts = hold.pressurePts
  if (!pts || pts.length === 0) return 0
  if (ms <= pts[0].t) return pts[0].v
  const last = pts[pts.length - 1]
  if (ms >= last.t) return last.v
  for (let i = 0; i < pts.length - 1; i++) {
    if (ms <= pts[i + 1].t) {
      const span = Math.max(1e-6, pts[i + 1].t - pts[i].t)
      const f = (ms - pts[i].t) / span
      return pts[i].v + (pts[i + 1].v - pts[i].v) * f
    }
  }
  return last.v
}

// Capture a card's pose in the frame's local space: offset = frame⁻¹ ∘ cardPose.
export function captureGripOffset(frame, cardPose) {
  const invQ = frame.quat.clone().invert()
  const offsetPos = cardPose.pos.clone().sub(frame.pos).applyQuaternion(invQ)
  const offsetQuat = invQ.multiply(cardPose.quat).normalize()
  return { offsetPos, offsetQuat }
}

// Place a held card back in world space: world = frame ∘ offset. Writes into
// the provided out vectors (reused per frame — no allocation in the hot path).
export function applyGripFrame(frame, offset, outPos, outQuat) {
  outPos.copy(offset.offsetPos).applyQuaternion(frame.quat).add(frame.pos)
  outQuat.copy(frame.quat).multiply(offset.offsetQuat)
}

export { THREE }
