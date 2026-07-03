import * as THREE from 'three'

// Named hand pose presets. Each pose defines wrist transform + per-finger joint
// angles (3 segments each) and a spread factor for the knuckle splay.
// Angles are local Euler rotations in radians: [proximal, middle, distal].

const WRIST_DOWN = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(-Math.PI / 2, 0, 0),
)

function pose(wristPos, wristRot, fingers, spread = 0.28) {
  return {
    wrist: {
      pos: new THREE.Vector3(...wristPos),
      quat: wristRot.clone(),
    },
    fingers,
    spread,
  }
}

function f(
  thumb = [0.2, 0.15, 0.1],
  index = [0.5, 0.35, 0.2],
  middle = [0.55, 0.38, 0.22],
  ring = [0.5, 0.35, 0.2],
  pinky = [0.42, 0.3, 0.18],
) {
  return { thumb, index, middle, ring, pinky }
}

export const HAND_POSES = {
  relaxed: pose(
    [0, 0.55, 0.35],
    WRIST_DOWN,
    f([0.15, 0.1, 0.05], [0.35, 0.2, 0.1], [0.38, 0.22, 0.1], [0.35, 0.2, 0.1], [0.3, 0.18, 0.08]),
    0.22,
  ),

  twoHandsSupport: pose(
    [0, 0.62, 0.28],
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2.1, 0, 0)),
    f([0.1, 0.08, 0.05], [0.25, 0.15, 0.08], [0.28, 0.16, 0.08], [0.25, 0.15, 0.08], [0.22, 0.12, 0.06]),
    0.18,
  ),

  pinchCut: pose(
    [0, 0.68, 0.22],
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2.3, 0.15, 0)),
    f([0.55, 0.35, 0.2], [0.7, 0.45, 0.25], [0.15, 0.1, 0.05], [0.1, 0.08, 0.04], [0.08, 0.05, 0.03]),
    0.12,
  ),

  riffleArch: pose(
    [0, 0.7, 0.18],
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2.4, 0.2, 0)),
    f([0.35, 0.25, 0.15], [0.45, 0.3, 0.18], [0.42, 0.28, 0.16], [0.38, 0.25, 0.14], [0.32, 0.2, 0.1]),
    0.2,
  ),

  bridgeRelease: pose(
    [0, 0.75, 0.15],
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2.5, 0, 0)),
    f([0.2, 0.15, 0.1], [0.6, 0.4, 0.22], [0.62, 0.42, 0.24], [0.58, 0.38, 0.2], [0.5, 0.32, 0.16]),
    0.25,
  ),

  overhandPull: pose(
    [0, 0.72, 0.2],
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2.2, -0.25, 0)),
    f([0.25, 0.18, 0.1], [0.55, 0.38, 0.2], [0.5, 0.35, 0.18], [0.45, 0.3, 0.15], [0.38, 0.25, 0.12]),
    0.2,
  ),

  washFlat: pose(
    [0, 0.58, 0.4],
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 1.85, 0, 0)),
    f([0.12, 0.08, 0.04], [0.2, 0.12, 0.06], [0.22, 0.14, 0.07], [0.2, 0.12, 0.06], [0.18, 0.1, 0.05]),
    0.35,
  ),

  fanSpread: pose(
    [0, 0.65, 0.25],
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2.15, 0.1, 0)),
    f([0.3, 0.2, 0.12], [0.4, 0.28, 0.15], [0.35, 0.25, 0.14], [0.3, 0.22, 0.12], [0.25, 0.18, 0.1]),
    0.42,
  ),

  springRelease: pose(
    [0, 0.7, 0.16],
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2.35, 0, 0)),
    f([0.15, 0.1, 0.06], [0.65, 0.42, 0.22], [0.68, 0.45, 0.24], [0.62, 0.4, 0.2], [0.55, 0.35, 0.16]),
    0.22,
  ),
}

// Mirror a right-hand pose to the left (flip X, adjust wrist yaw).
export function mirrorPose(p) {
  const pos = p.wrist.pos.clone()
  pos.x *= -1
  const quat = p.wrist.quat.clone()
  const e = new THREE.Euler().setFromQuaternion(quat)
  e.y *= -1
  e.z *= -1
  const mirrored = {
    wrist: { pos, quat: new THREE.Quaternion().setFromEuler(e) },
    fingers: { ...p.fingers },
    spread: p.spread,
  }
  return mirrored
}

export function getHandPose(name, side = 'right') {
  const base = HAND_POSES[name] || HAND_POSES.relaxed
  const sideOffset = side === 'left' ? -0.66 : 0.66
  if (side === 'left') {
    const p = mirrorPose(base)
    p.wrist.pos.x += sideOffset
    return p
  }
  return {
    wrist: {
      pos: base.wrist.pos.clone().add(new THREE.Vector3(sideOffset, 0, 0)),
      quat: base.wrist.quat.clone(),
    },
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
