import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { HAND_SCALE, FINGERS, FINGER_NAMES, THUMB_BASE_ROT, jointPivotY } from './handRigSpec'

const HAND_COLOR = 0xf0cba6

// All rig dimensions (scale, finger table, thumb opposition, local-frame
// conventions) live in handRigSpec.js — the single source of truth shared with
// the pure FK module (handKinematics.js) and the verify harness. Keep this
// file about geometry/material construction only.

// One shared translucent material across palm, thenar and all five fingers keeps
// the gold-fresnel rim perfectly consistent (and is cheaper). The limb below the
// palm gets a SECOND instance from this same factory — identical in every way
// except that its opacity is modulated per frame (see "Forearm fade" below).
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

// --- Forearm fade -----------------------------------------------------------
// The forearm capsule is ~1 world unit long — longer than a card. When its axis
// runs BROADSIDE to the camera it sweeps clear across the frame and hides the
// exact moment a lesson is teaching (the faro interlace, the Charlier cut). When
// it points toward/away from the viewer it foreshortens to a harmless stub. So
// fade it by how side-on it is, and never all the way out: the stub is what
// keeps the hand from reading as a severed palm.
// This is purely a RENDER concern — it runs off the camera in onBeforeRender and
// never touches pose data or FK positions.
const FOREARM_OPACITY_SOLID = 0.55 // identical to the shared hand material
const FOREARM_OPACITY_EDGEON = 0.14 // fully broadside — faint, but still attached
// The signal is sin(angle between the arm axis and the view ray) — i.e. the
// FRACTION OF ITS LENGTH the arm sweeps across the frame. Not the raw dot
// product: at the faro interlace the arms sit 42° off the view ray, which sounds
// end-on but still paints 67% of a full arm straight over the cards.
const FADE_ACROSS_START = 0.32 // below this it foreshortens to a stub — stay solid
const FADE_ACROSS_FULL = 0.78 // at/above this it lies broadside — maximum fade

const _armAxis = new THREE.Vector3()
const _armToCam = new THREE.Vector3()

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

// Modulate `material.opacity` from how side-on `mesh`'s +y axis is to `camera`.
// Stateless and smoothstep-shaped, so it eases instead of popping as a wrist
// rotates and lands on the same value every time for a given frame.
function fadeAlongViewAxis(mesh, material, camera) {
  // Capsules are authored along +y, so column 1 of the world matrix is the arm
  // axis (correct for the mirrored left hand too, whose root.scale.x is < 0).
  _armAxis.setFromMatrixColumn(mesh.matrixWorld, 1).normalize()
  _armToCam.setFromMatrixPosition(mesh.matrixWorld).sub(camera.position).normalize()
  // |a × b| of two unit vectors is sin(angle): 0 = pointing at/away from the
  // camera, 1 = fully broadside.
  const across = _armAxis.cross(_armToCam).length()
  const t = smoothstep(FADE_ACROSS_START, FADE_ACROSS_FULL, across)
  material.opacity = FOREARM_OPACITY_SOLID + t * (FOREARM_OPACITY_EDGEON - FOREARM_OPACITY_SOLID)
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

  // The limb below the palm gets its OWN material instance (same factory, so it
  // is visually identical) purely so its opacity can be modulated independently
  // — see fadeAlongViewAxis. Same shader source, so it still shares the compiled
  // program under the 'hand-fresnel-rim' cache key; only the opacity uniform
  // differs. The wrist stub rides the same material as the forearm so the arm
  // recedes as ONE piece instead of leaving a bright bead on a ghost tube; the
  // palm and thenar stay solid, which is what keeps the hand attached.
  const forearmMaterial = makeHandMaterial()

  // Wrist + forearm stub so the hand doesn't read as a severed palm. Capsules
  // are authored along +y, so they already trail down the -y axis below the palm.
  const wristGeo = new THREE.CapsuleGeometry(0.03, 0.03, 6, 12)
  const wristMesh = new THREE.Mesh(wristGeo, forearmMaterial)
  wristMesh.position.set(0, -0.07, 0.002)
  wrist.add(wristMesh)

  const forearmGeo = new THREE.CapsuleGeometry(0.032, 0.16, 6, 12)
  const forearm = new THREE.Mesh(forearmGeo, forearmMaterial)
  forearm.position.set(0, -0.19, 0.004)
  // The forearm is the only writer of forearmMaterial.opacity (the wrist stub
  // shares the material and rides this value — it has the same axis, being a
  // sibling under the same wrist group with no local rotation of its own).
  forearm.onBeforeRender = (renderer, scene, camera) => {
    // Only the main perspective pass may set the fade: ContactShadows re-renders
    // the whole scene every frame through an orthographic camera, and shadow
    // passes route through here too.
    if (!camera?.isPerspectiveCamera) return
    fadeAlongViewAxis(forearm, forearmMaterial, camera)
  }
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

  return { root, wrist, fingers, materials: [material, forearmMaterial] }
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
