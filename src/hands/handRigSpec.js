// Single source of truth for every number that determines WHERE the hand's
// geometry sits: the rig builder (handRig.js), the pure forward-kinematics
// module (handKinematics.js), and the headless verification harness all import
// from here. Pure data — no THREE, no geometry, safe to import anywhere.
//
// Local hand frame (before the wrist quaternion):
//   +y : the direction fingers extend from their knuckles (fingers point "up").
//   +z : the PALMAR direction — the palm faces +z and fingers curl toward +z
//        (a positive joint rotation about local X sweeps the tip toward +z).
//   +x : toward the pinky (ulnar) side; the thumb sits on the -x (radial) side.
// The wrist sits at the origin, knuckles near y≈+0.05, forearm trails to -y.
// The left hand is produced by mirroring the whole rig on X (root.scale.x < 0).

// Whole-rig scale: the rig is authored in small "anatomical" units (a middle
// finger is ~0.09 long, a palm ~0.10 tall); a real hand is roughly a card-and-
// a-half wide, so we scale it up to cradle a ~0.63-wide card.
export const HAND_SCALE = 4.6

//   base : knuckle position on the palm  [x across, y up, z palmar]
//   len  : phalange lengths [proximal, middle, distal]  (middle finger longest)
//   rad  : phalange radii   [proximal, middle, distal]  (tapers to the tip)
//   splay: sideways knuckle splay weight (scaled by pose.spread)
export const FINGERS = {
  // Thumb is short + thick and sits low on the radial side; a base rotation
  // (THUMB_BASE_ROT) swings it across the palm so its curl opposes the fingers.
  thumb: { base: [-0.046, -0.012, 0.008], len: [0.03, 0.022, 0.016], rad: [0.017, 0.0145, 0.011], splay: -0.35 },
  index: { base: [-0.033, 0.049, 0.004], len: [0.04, 0.024, 0.018], rad: [0.0135, 0.0115, 0.0092], splay: -0.16 },
  middle: { base: [-0.01, 0.052, 0.006], len: [0.046, 0.028, 0.019], rad: [0.0142, 0.012, 0.0095], splay: -0.03 },
  ring: { base: [0.013, 0.049, 0.005], len: [0.041, 0.025, 0.019], rad: [0.0132, 0.0112, 0.009], splay: 0.11 },
  pinky: { base: [0.034, 0.043, 0.0], len: [0.031, 0.019, 0.015], rad: [0.0112, 0.0096, 0.0078], splay: 0.26 },
}

export const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky']

// Opposable thumb: swing the metacarpal across the palm (z) and forward (x) so
// its curl presses toward the fingers — a real pinch/grip rather than a spike.
// The rig applies this as a partial Euler over the build-time splay yaw, so the
// thumb group's full rotation is Euler(x, y:splay, z, 'XYZ').
export const THUMB_BASE_ROT = { z: 1.2, x: -0.55 }

// Curl limits per joint (radians about local X). Slight hyperextension is
// allowed (real fingers bend back a touch); flexion tops out below a full fist
// so IK solutions can't fold a phalange through the palm.
export const JOINT_LIMITS = { min: -0.25, max: 1.65 }

// The pivot of joint i sits at the END of the previous phalange (0 for the
// proximal joint, which pivots at the knuckle itself).
export function jointPivotY(spec, i) {
  return i === 0 ? 0 : spec.len[i - 1]
}
