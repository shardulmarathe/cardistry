import * as THREE from 'three'

// Named hand pose presets. Each pose defines a wrist transform + per-finger
// joint angles (3 segments each) and a spread factor for the knuckle splay.
// Angles are local Euler X-rotations in radians: [proximal, middle, distal];
// larger = more curl toward the palm (see the frame notes in handRig.js).
//
// MIRRORING: the left hand is the right rig mirrored by root.scale.x < 0, so it
// uses the SAME wrist quaternion and the SAME finger angles — only its wrist X
// position is negated (getHandPose). Do NOT mirror the quaternion or negate
// curls; that double-mirrors and flips the grip (verified headlessly).

// Palm-down base: fingers hang down and curl further down/inward, thumb sweeps
// toward the deck center — the natural two-handed table grip.
function euler(x, y = 0, z = 0) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z))
}
const PALM_DOWN = Math.PI / 2

function pose(wristPos, wristRot, fingers, spread = 0.28) {
  return {
    wrist: { pos: new THREE.Vector3(...wristPos), quat: wristRot.clone() },
    fingers,
    spread,
  }
}

// finger-angle helper: [proximal, middle, distal] per finger.
function f(
  thumb = [0.3, 0.3, 0.2],
  index = [0.6, 0.5, 0.3],
  middle = [0.62, 0.52, 0.32],
  ring = [0.58, 0.48, 0.3],
  pinky = [0.5, 0.42, 0.26],
) {
  return { thumb, index, middle, ring, pinky }
}

export const HAND_POSES = {
  // Resting off to the side, tilted, gently curled.
  relaxed: pose(
    [0.95, 0.5, 0.42],
    euler(PALM_DOWN - 0.35, 0, 0.12),
    f([0.25, 0.22, 0.14], [0.32, 0.24, 0.14], [0.34, 0.26, 0.15], [0.32, 0.24, 0.14], [0.28, 0.2, 0.12]),
    0.3,
  ),

  // Flat cradle: palm over a half-deck, fingers draping down its outer edge,
  // thumb reaching toward the deck's inner (center) edge to steady it.
  twoHandsSupport: pose(
    [0.5, 0.42, 0.06],
    euler(PALM_DOWN, 0, 0),
    f([0.4, 0.45, 0.3], [0.55, 0.45, 0.28], [0.58, 0.48, 0.3], [0.55, 0.45, 0.28], [0.5, 0.4, 0.26]),
    0.26,
  ),

  // Pinch: thumb + index oppose to peel/grip a packet; other fingers relaxed.
  pinchCut: pose(
    [0.5, 0.44, 0.05],
    euler(PALM_DOWN, 0.1, 0),
    f([0.55, 0.6, 0.4], [0.75, 0.6, 0.4], [0.35, 0.28, 0.18], [0.3, 0.24, 0.15], [0.28, 0.22, 0.14]),
    0.16,
  ),

  // Riffle arch: firm grip that bows the half — fingers wrap the outer edge,
  // thumb presses the inner edge down. This is the grip that loads the spring.
  riffleArch: pose(
    [0.52, 0.44, 0.02],
    euler(PALM_DOWN, 0, 0),
    f([0.5, 0.55, 0.4], [0.85, 0.7, 0.45], [0.9, 0.75, 0.48], [0.85, 0.7, 0.45], [0.78, 0.62, 0.4]),
    0.22,
  ),

  // Bridge release: thumbs lift/extend to let the cards riffle off the inner
  // edge; fingers stay bent, supporting the cascade.
  bridgeRelease: pose(
    [0.46, 0.47, 0.0],
    euler(PALM_DOWN, 0, 0),
    f([0.12, 0.1, 0.06], [0.7, 0.55, 0.35], [0.74, 0.58, 0.36], [0.7, 0.55, 0.35], [0.64, 0.5, 0.32]),
    0.24,
  ),

  // Overhand pull: hand tips a peeled packet back onto the pile; thumb up.
  overhandPull: pose(
    [0.16, 0.46, 0.12],
    euler(PALM_DOWN, -0.2, 0),
    f([0.18, 0.15, 0.1], [0.62, 0.5, 0.3], [0.58, 0.46, 0.28], [0.52, 0.42, 0.26], [0.46, 0.36, 0.22]),
    0.22,
  ),

  // Flat, splayed palm hovering over a table wash.
  washFlat: pose(
    [0.5, 0.4, 0.2],
    euler(PALM_DOWN + 0.12, 0, 0),
    f([0.1, 0.08, 0.05], [0.18, 0.12, 0.06], [0.2, 0.14, 0.07], [0.18, 0.12, 0.06], [0.16, 0.1, 0.05]),
    0.4,
  ),

  // Wide fan: fingers spread hard to bloom a pressure fan.
  fanSpread: pose(
    [0.45, 0.44, 0.15],
    euler(PALM_DOWN, 0.1, 0),
    f([0.3, 0.28, 0.18], [0.4, 0.3, 0.18], [0.35, 0.28, 0.16], [0.3, 0.24, 0.14], [0.26, 0.2, 0.12]),
    0.46,
  ),

  // Spring release: a firm bowed grip that lets the deck cascade.
  springRelease: pose(
    [0.5, 0.46, 0.02],
    euler(PALM_DOWN, 0, 0),
    f([0.2, 0.16, 0.1], [0.8, 0.62, 0.38], [0.84, 0.66, 0.4], [0.8, 0.62, 0.38], [0.72, 0.56, 0.34]),
    0.22,
  ),
}

// Resolve a named pose for a side, optionally re-anchoring the wrist to a world
// position supplied by the lesson step (lets each lesson place the hands on its
// own deck geometry — the fix for "hands don't sit at the deck halves").
export function getHandPose(name, side = 'right', anchor = null) {
  const base = HAND_POSES[name] || HAND_POSES.relaxed
  const pos = anchor
    ? new THREE.Vector3(anchor[0], anchor[1], anchor[2])
    : base.wrist.pos.clone()
  if (side === 'left') pos.x *= -1
  return {
    wrist: { pos, quat: base.wrist.quat.clone() },
    fingers: {
      thumb: [...base.fingers.thumb],
      index: [...base.fingers.index],
      middle: [...base.fingers.middle],
      ring: [...base.fingers.ring],
      pinky: [...base.fingers.pinky],
    },
    spread: base.spread,
  }
}

// Interpolate two poses — slerp wrist, lerp joint angles.
export function lerpHandPose(a, b, t) {
  const out = {
    wrist: {
      pos: a.wrist.pos.clone().lerp(b.wrist.pos, t),
      quat: a.wrist.quat.clone().slerp(b.wrist.quat, t),
    },
    fingers: {},
    spread: a.spread + (b.spread - a.spread) * t,
  }
  for (const name of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
    out.fingers[name] = a.fingers[name].map((v, i) => v + (b.fingers[name][i] - v) * t)
  }
  return out
}
