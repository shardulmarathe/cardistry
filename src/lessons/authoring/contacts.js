import * as THREE from 'three'
import { getHandPose, cloneHandPose } from '../../hands/handPoses'
import {
  fingertipWorld,
  solveFingerTo,
  solveThumbTo,
} from '../../hands/handKinematics'

// Compile-time contact authoring: place fingers ON the cards instead of
// guessing joint angles. These run inside a lesson's build() against the real
// layout geometry, so poses stay correct when a layout constant changes.
// Everything is deterministic (fixed-iteration solvers) — the compiled track
// is still a pure function of the lesson source.
//
// Conventions: targets and anchors are authored in RIGHT-hand world coords;
// pass side:'left' and both are x-mirrored to match the engine's anchor rule.

export function eulerQuat(x, y = 0, z = 0) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z))
}

const _target = new THREE.Vector3()

// Resolve a base pose (preset name or pose object), optionally re-anchor and
// re-orient the wrist, then IK-solve each listed fingertip onto its target.
// contacts: { thumb: [x,y,z], index: [x,y,z], ... } (right-hand coords).
export function poseWithContacts(base, side, { anchor, quat } = {}, contacts = {}) {
  const pose = typeof base === 'string' ? getHandPose(base, side, anchor) : cloneHandPose(base)
  if (typeof base !== 'string' && anchor) {
    pose.wrist.pos.set(anchor[0], anchor[1], anchor[2])
    if (side === 'left') pose.wrist.pos.x *= -1
  }
  if (quat) pose.wrist.quat.copy(quat)
  for (const name of Object.keys(contacts)) {
    const c = contacts[name]
    _target.set(side === 'left' ? -c[0] : c[0], c[1], c[2])
    if (name === 'thumb') {
      const s = solveThumbTo(pose, side, _target, { oppRange: 1.1, steps: 33 })
      pose.fingers.thumb = s.angles
      pose.thumbOpp = { ...(pose.thumbOpp ?? {}), ...s.thumbOpp }
    } else {
      pose.fingers[name] = solveFingerTo(pose, side, name, _target).angles
    }
  }
  return pose
}

// Translation-only inverse: where must the wrist sit so `finger`'s tip (under
// this pose's curls) lands on `target`? Returns an anchor [x,y,z] in
// right-hand coords for the lesson's `anchor:` field.
const _tip = new THREE.Vector3()
export function wristAnchorForContact(base, side, finger, target) {
  const pose = typeof base === 'string' ? getHandPose(base, 'right') : cloneHandPose(base)
  pose.wrist.pos.set(0, 0, 0)
  fingertipWorld(pose, 'right', finger, _tip)
  return [target[0] - _tip.x, target[1] - _tip.y, target[2] - _tip.z]
}

// --- Shared solved grips for the standard table scene ------------------------
// (52-card deck on the felt; halves at ±gap; camera dealerPOV.)

// Dealer table grip: palm flat over a face-down half at x=+gap, fingertips
// resting on top, thumb owning the inner-near corner. `tilt` follows
// tableRiffleLayout's near-edge lift so the thumb stays ON the rising corner.
export function tableGrip({ gap = 0.5, tilt = 0 } = {}) {
  const anchor = [gap - 0.05, 0.38 + 0.06 * tilt, 0.03]
  const quat = eulerQuat(Math.PI / 2, 0.15, -0.3)
  const ty = 0.05 + 0.34 * tilt
  const fy = 0.04 + 0.23 * tilt
  const pose = poseWithContacts('twoHandsSupport', 'right', { anchor, quat }, {
    thumb: [gap - 0.26, ty, 0.36],
    index: [gap - 0.18, fy, 0.18],
    middle: [gap - 0.04, fy, 0.2],
    ring: [gap + 0.1, fy, 0.18],
    pinky: [gap + 0.23, fy, 0.14],
  })
  return { pose, anchor }
}

// Bridge/spring cage: hand cups the squared center deck's short end, thumb on
// top of the arch, fingers low against the end face.
export function cageGrip({ topY = 0.3 } = {}) {
  const anchor = [0.66, 0.42, -0.02]
  const quat = eulerQuat(Math.PI / 2, -Math.PI / 2, 0.18)
  const pose = poseWithContacts('bridgeCage', 'right', { anchor, quat }, {
    thumb: [0.2, topY, 0.02],
    index: [0.34, 0.12, 0.12],
    middle: [0.35, 0.1, 0.0],
    ring: [0.34, 0.12, -0.12],
    pinky: [0.32, 0.15, -0.22],
  })
  return { pose, anchor }
}

// Generate the weave's hand keyframes so the thumb ratchets open across
// EXACTLY the window in which the staggered cards release (staggerWindow:
// card k starts at k/(n-1)*spread through the step) — the thumb visibly
// "passes" each card as it falls. Alternating micro-jitter makes it read as a
// card-by-card ratchet rather than a smooth fade. Returns a keyframe array for
// step.hands.<side>; append/prepend extra keyframes freely.
export function thumbRatchetKeyframes({
  gripPose,
  openThumb = [0.12, 0.1, 0.06],
  openOpp = null,
  anchorFrom,
  anchorTo,
  spread = 0.55,
  span = 0.45,
  steps = 6,
  jitter = 0.03,
  fingerMotion = null,
}) {
  const window = Math.min(1, spread + span * 0.35)
  const fromThumb = gripPose.fingers.thumb
  const fromOpp = gripPose.thumbOpp ?? { x: 0, z: 0 }
  const kfs = []
  for (let k = 0; k <= steps; k++) {
    const f = k / steps
    const j = k === 0 || k === steps ? 0 : (k % 2 === 0 ? 1 : -1) * jitter
    const thumb = fromThumb.map((v, i) => v + (openThumb[i] - v) * f + j * (1 - f))
    const kf = { at: f * window, fingers: { thumb } }
    if (openOpp) {
      kf.thumbOpp = {
        x: (fromOpp.x ?? 0) + ((openOpp.x ?? 0) - (fromOpp.x ?? 0)) * f,
        z: (fromOpp.z ?? 0) + ((openOpp.z ?? 0) - (fromOpp.z ?? 0)) * f,
      }
    }
    if (anchorFrom && anchorTo) {
      kf.anchor = anchorFrom.map((v, i) => v + (anchorTo[i] - v) * f)
    }
    if (fingerMotion && k > 0 && k < steps) kf.fingerMotion = fingerMotion
    kfs.push(kf)
  }
  return kfs
}
