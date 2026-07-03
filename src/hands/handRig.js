import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

const HAND_COLOR = 0xf0cba6
// Whole-rig scale: the rig is authored in small "anatomical" units (a middle
// finger is ~0.09 long, a palm ~0.10 tall); a real hand is roughly a card-and-
// a-half wide, so we scale it up to cradle a ~0.63-wide card.
const HAND_SCALE = 4.6

// --- Local hand frame (before the wrist quaternion) --------------------------
//   +y : the direction fingers extend from their knuckles (fingers point "up").
//   +z : the PALMAR direction — the palm faces +z and fingers curl toward +z
//        (a positive joint rotation about local X sweeps the tip toward +z).
//   +x : toward the pinky (ulnar) side; the thumb sits on the -x (radial) side.
// The wrist sits at the origin, knuckles near y≈+0.05, forearm trails to -y.
// The left hand is produced by mirroring the whole rig on X (root.scale.x < 0).
//
//   base : knuckle position on the palm  [x across, y up, z palmar]
//   len  : phalange lengths [proximal, middle, distal]  (middle finger longest)
//   rad  : phalange radii   [proximal, middle, distal]  (tapers to the tip)
//   splay: sideways knuckle splay weight (scaled by pose.spread)
const FINGERS = {
  // Thumb is short + thick and sits low on the radial side; a base rotation
  // (THUMB_BASE_ROT) swings it across the palm so its curl opposes the fingers.
  thumb: { base: [-0.046, -0.012, 0.008], len: [0.03, 0.022, 0.016], rad: [0.017, 0.0145, 0.011], splay: -0.35 },
  index: { base: [-0.033, 0.049, 0.004], len: [0.04, 0.024, 0.018], rad: [0.0135, 0.0115, 0.0092], splay: -0.16 },
  middle: { base: [-0.01, 0.052, 0.006], len: [0.046, 0.028, 0.019], rad: [0.0142, 0.012, 0.0095], splay: -0.03 },
  ring: { base: [0.013, 0.049, 0.005], len: [0.041, 0.025, 0.019], rad: [0.0132, 0.0112, 0.009], splay: 0.11 },
  pinky: { base: [0.034, 0.043, 0.0], len: [0.031, 0.019, 0.015], rad: [0.0112, 0.0096, 0.0078], splay: 0.26 },
}
const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky']

// Opposable thumb: swing the metacarpal across the palm (z) and forward (x) so
// its curl presses toward the fingers — a real pinch/grip rather than a spike.
const THUMB_BASE_ROT = { z: 1.2, x: -0.55 }

// One shared translucent material for the whole hand keeps the gold-fresnel rim
// perfectly consistent across palm, fingers and forearm (and is cheaper).
function makeHandMaterial() {
  const material = new THREE.MeshStandardMaterial({
    color: HAND_COLOR,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    roughness: 0.42,
    metalness: 0,
    side: THREE.DoubleSide,
  })
  addFresnelRim(material)
  return material
}

function addFresnelRim(material) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
       float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.2);
       gl_FragColor.rgb += vec3(0.85, 0.65, 0.35) * fresnel * 0.5;`,
    )
  }
  material.customProgramCacheKey = () => 'hand-fresnel-rim'
}

// A finger is a kinematic chain of 3 tapered capsules (proximal→middle→distal),
// each in its own joint group so applyHandPose can curl them about local X.
function buildFinger(name, spec, material) {
  const group = new THREE.Group()
  group.name = name
  group.position.set(...spec.base)
  group.rotation.y = spec.splay

  const joints = []
  let y = 0
  for (let i = 0; i < 3; i++) {
    const len = spec.len[i]
    const geo = new THREE.CapsuleGeometry(spec.rad[i], len, 6, 12)
    const mesh = new THREE.Mesh(geo, material)
    mesh.position.y = y + len / 2
    mesh.castShadow = false
    const joint = new THREE.Group()
    joint.add(mesh)
    if (i === 0) group.add(joint)
    else joints[i - 1].add(joint)
    joints.push(joint)
    y += len
  }
  return { group, joints, splay: spec.splay }
}

// Build a procedural hand rig: forearm → wrist → palm + 5 articulated fingers.
export function buildHandRig(side = 'right') {
  const root = new THREE.Group()
  root.name = `hand-${side}`
  const material = makeHandMaterial()

  const wrist = new THREE.Group()
  wrist.name = 'wrist'
  root.add(wrist)

  // Palm: a flattened, slightly domed slab — thin along the palmar axis (z),
  // wide across (x), tall from wrist (-y) to the knuckle line (+y≈0.05).
  const palmGeo = new RoundedBoxGeometry(0.092, 0.1, 0.026, 4, 0.012)
  const palm = new THREE.Mesh(palmGeo, material)
  palm.position.set(-0.002, 0.0, 0.0)
  wrist.add(palm)

  // Thenar eminence: the fleshy pad at the base of the thumb, for a full palm.
  const thenarGeo = new RoundedBoxGeometry(0.034, 0.06, 0.03, 3, 0.014)
  const thenar = new THREE.Mesh(thenarGeo, material)
  thenar.position.set(-0.034, -0.018, 0.008)
  thenar.rotation.z = -0.3
  wrist.add(thenar)

  // Wrist + forearm stub so the hand doesn't read as a severed palm. Capsules
  // are authored along +y, so they already trail down the -y axis below the palm.
  const wristGeo = new THREE.CapsuleGeometry(0.03, 0.03, 6, 12)
  const wristMesh = new THREE.Mesh(wristGeo, material)
  wristMesh.position.set(0, -0.07, 0.002)
  wrist.add(wristMesh)

  const forearmGeo = new THREE.CapsuleGeometry(0.032, 0.16, 6, 12)
  const forearm = new THREE.Mesh(forearmGeo, material)
  forearm.position.set(0, -0.19, 0.004)
  wrist.add(forearm)

  const fingers = {}
  for (const name of FINGER_NAMES) {
    fingers[name] = buildFinger(name, FINGERS[name], material)
    wrist.add(fingers[name].group)
  }

  // Swing the thumb metacarpal across + forward so it opposes the fingers.
  fingers.thumb.group.rotation.z = THUMB_BASE_ROT.z
  fingers.thumb.group.rotation.x = THUMB_BASE_ROT.x

  // Scale the whole rig up (and mirror X for the left hand).
  root.scale.set(side === 'left' ? -HAND_SCALE : HAND_SCALE, HAND_SCALE, HAND_SCALE)
  // Stay hidden until a lesson supplies a pose for this side.
  root.visible = false

  return { root, wrist, fingers, materials: [material] }
}

export function applyHandPose(rig, pose) {
  const { wrist, fingers, root } = rig
  root.position.copy(pose.wrist.pos)
  wrist.quaternion.copy(pose.wrist.quat)

  for (const name of FINGER_NAMES) {
    const { group, joints, splay } = fingers[name]
    const angles = pose.fingers[name]
    // Spread only fans the four fingers; the thumb keeps its opposed base yaw.
    if (name !== 'thumb') group.rotation.y = splay * pose.spread
    for (let i = 0; i < joints.length; i++) {
      // No per-side sign flip: the left rig is mirrored by root.scale.x < 0,
      // which already reverses the sense of a curl about local X.
      joints[i].rotation.x = angles[i]
    }
  }
}
