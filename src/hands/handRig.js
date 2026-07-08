import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { HAND_SCALE, FINGERS, FINGER_NAMES, THUMB_BASE_ROT, jointPivotY } from './handRigSpec'

const HAND_COLOR = 0xf0cba6

// All rig dimensions (scale, finger table, thumb opposition, local-frame
// conventions) live in handRigSpec.js — the single source of truth shared with
// the pure FK module (handKinematics.js) and the verify harness. Keep this
// file about geometry/material construction only.

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
// Each joint group PIVOTS AT ITS PHALANGE'S BASE (the end of the previous
// phalange) — its capsule is centered len/2 up its own +y. Rotating a joint
// therefore hinges the phalange at its own knuckle/PIP/DIP, so fingers curl
// instead of fanning three capsules about the base knuckle.
function buildFinger(name, spec, material) {
  const group = new THREE.Group()
  group.name = name
  group.position.set(...spec.base)
  group.rotation.y = spec.splay

  const joints = []
  for (let i = 0; i < 3; i++) {
    const len = spec.len[i]
    const geo = new THREE.CapsuleGeometry(spec.rad[i], len, 6, 12)
    const mesh = new THREE.Mesh(geo, material)
    mesh.position.y = len / 2
    mesh.castShadow = false
    const joint = new THREE.Group()
    joint.position.y = jointPivotY(spec, i)
    joint.add(mesh)
    if (i === 0) group.add(joint)
    else joints[i - 1].add(joint)
    joints.push(joint)
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
    // Optional pose-v2 fields: per-finger additive splay and a 2-DOF animatable
    // thumb opposition on top of the rig's base constants. Absent fields are
    // zeros, so legacy poses render exactly as before.
    const extraSplay = pose.splay?.[name] ?? 0
    if (name === 'thumb') {
      // Spread never fans the thumb; it keeps its opposed base yaw.
      group.rotation.y = splay + extraSplay
      group.rotation.x = THUMB_BASE_ROT.x + (pose.thumbOpp?.x ?? 0)
      group.rotation.z = THUMB_BASE_ROT.z + (pose.thumbOpp?.z ?? 0)
    } else {
      group.rotation.y = splay * pose.spread + extraSplay
    }
    for (let i = 0; i < joints.length; i++) {
      // No per-side sign flip: the left rig is mirrored by root.scale.x < 0,
      // which already reverses the sense of a curl about local X.
      joints[i].rotation.x = angles[i]
    }
  }
}
