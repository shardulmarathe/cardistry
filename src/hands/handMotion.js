// Micro-animation for the hands: a global idle "breathing" overlay so hands
// never freeze, and per-segment finger-motion overlays (tremor, ripple,
// tighten) that add life to a held pose. Everything here is a PURE function of
// its time argument — no state, no randomness — so bidirectional scrubbing and
// compile-time grip capture stay exact.
//
// Boundary rule: segment-local finger motion multiplies by sin²(πt), which is
// 0 (with zero slope) at t=0 and t=1 — any inner phase offsets are safe and
// segment edges never pop. The idle overlay instead runs on ABSOLUTE ms and is
// continuous everywhere by construction, so it needs no boundary treatment.

import { FINGER_NAMES } from './handRigSpec'

// Curl deltas distribute over [proximal, middle, distal] in this ratio — a
// whole-finger flex reads more natural than bending a single joint.
const JOINT_WEIGHTS = [1, 0.7, 0.45]

// --- Global idle -------------------------------------------------------------
// Two incommensurate slow sines per finger (periods ~2.9s and ~4.7s), phase-
// staggered per finger and per side, plus a faint wrist drift. Subtle enough
// to survive 0.25× study speed without reading as a tremor.
const IDLE_W1 = (2 * Math.PI) / 2900
const IDLE_W2 = (2 * Math.PI) / 4700
const IDLE_CURL_AMP = 0.021
const IDLE_WRIST_AMP = 0.0045
const SIDE_PHASE = { right: 0, left: 2.4 }
const FINGER_PHASE = [0.0, 1.3, 2.5, 3.7, 4.9]

export function applyIdle(pose, ms, side, scale = 1) {
  if (!scale) return pose
  const sp = SIDE_PHASE[side] ?? 0
  for (let fi = 0; fi < FINGER_NAMES.length; fi++) {
    const angles = pose.fingers[FINGER_NAMES[fi]]
    const phase = FINGER_PHASE[fi] + sp
    const d =
      IDLE_CURL_AMP *
      scale *
      (0.62 * Math.sin(IDLE_W1 * ms + phase) + 0.38 * Math.sin(IDLE_W2 * ms + 1.7 * phase))
    for (let j = 0; j < 3; j++) angles[j] += d * JOINT_WEIGHTS[j]
  }
  const wa = IDLE_WRIST_AMP * scale
  pose.wrist.pos.x += wa * Math.sin(IDLE_W2 * ms + 0.9 + sp)
  pose.wrist.pos.y += wa * 0.8 * Math.sin(IDLE_W1 * ms + 2.1 + sp)
  pose.wrist.pos.z += wa * 0.6 * Math.sin(IDLE_W2 * ms * 1.31 + 4.2 + sp)
  pose.spread += 0.008 * scale * Math.sin(IDLE_W2 * ms + 5.1 + sp)
  return pose
}

// --- Segment finger motion ---------------------------------------------------
// A keyframe/segment carries fingerMotion: [{ fingers, type, amp, cycles,
// phase }] with type one of:
//   'tremor'     — effortful shake of the listed fingers (grip under load)
//   'curlRipple' — the wave running index→pinky (drumming/rippling fingers)
//   'tighten'    — a mid-segment squeeze that fully relaxes by the boundary
// Evaluated on the segment's UN-eased local t (like wrist `motion` overlays).
export function applyFingerMotion(pose, fingerMotion, t) {
  const env = Math.sin(Math.PI * t) ** 2
  if (!env) return pose
  for (const m of fingerMotion) {
    const amp = (m.amp ?? 0.05) * env
    const cycles = m.cycles ?? 2
    const names = m.fingers ?? FINGER_NAMES
    for (let k = 0; k < names.length; k++) {
      const angles = pose.fingers[names[k]]
      if (!angles) continue
      let d
      if (m.type === 'curlRipple') {
        d = amp * Math.sin(2 * Math.PI * cycles * t - k * (m.phase ?? 0.9))
      } else if (m.type === 'tighten') {
        d = amp
      } else {
        // tremor
        d =
          amp *
          (0.6 * Math.sin(2 * Math.PI * cycles * t + k * 1.1 + (m.phase ?? 0)) +
            0.4 * Math.sin(2 * Math.PI * 2.3 * cycles * t + k * 2.3))
      }
      for (let j = 0; j < 3; j++) angles[j] += d * JOINT_WEIGHTS[j]
    }
  }
  return pose
}
