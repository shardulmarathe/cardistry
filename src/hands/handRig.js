import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import {
  HAND_SCALE,
  FINGERS,
  FINGER_NAMES,
  THUMB_BASE_ROT,
  jointPivotY,
  mmToRig,
  PALM_MM,
  THENAR_MM,
  WRIST_MM,
  FOREARM_MM,
} from './handRigSpec'
import { getRegistry } from '../card/cardRegistry'
import { CARD_W, CARD_H } from '../lib/constants'

const HAND_COLOR = 0xf0cba6

// All rig dimensions (scale, finger table, thumb opposition, local-frame
// conventions) live in handRigSpec.js, the single source of truth shared with
// the pure FK module (handKinematics.js) and the verify harness. Keep this
// file about geometry/material construction only.

// One shared translucent material across palm, thenar and all five fingers keeps
// the gold-fresnel rim perfectly consistent (and is cheaper). The limb below the
// palm gets a SECOND instance from this same factory, identical in every way
// except for its per-frame opacity and a gentler x-ray strength (see the two
// fade sections below). Same shader TEXT, so both still share one program.
function makeHandMaterial(xray = 1) {
  const material = new THREE.MeshStandardMaterial({
    color: HAND_COLOR,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    roughness: 0.42,
    metalness: 0,
    side: THREE.DoubleSide,
  })
  addHandSurfaceShader(material, xray)
  return material
}

// --- Card x-ray -------------------------------------------------------------
// A hand at HAND_SCALE is genuinely bigger than the card it works on, so the
// parts that grip also HIDE. Two things made that worse than it had to be:
//
//  1. Every capsule is DoubleSide with depthWrite off, so one finger already
//     paints two layers at 0.55. Four overlapping fingers is eight layers -
//     1 - 0.45^8 ≈ 0.998, and the whole hand collapses into one opaque mass
//     with no fingers legible inside it. (Riffle's bridge beat was solid cream.)
//  2. Nothing distinguished a finger lying ACROSS the deck from one lying
//     beside it, so lessons could only fix it by moving the hand.
//
// So alpha is modulated per fragment by two signals that multiply:
//
//  * ndv = |dot(normal, viewDir)|, how BROADSIDE the surface is. This is the
//    same quantity the gold rim already computes, so it is free. Fade the
//    flat-on interior of a capsule and keep its silhouette: you look through
//    the body but the outline, and therefore the finger, still reads. Because
//    each overlapping capsule contributes its own bright rim, a stack of them
//    reads as separate fingers instead of one slab, this is what fixes (1),
//    and it fixes it for the palm and thenar slabs too, which are the big
//    masses in the waterfall squeeze.
//  * how much this fragment sits BETWEEN THE CAMERA AND THE CARDS. Anything
//    that actually occludes a card is, necessarily, in front of it (cards are
//    opaque and depth-write; hand fragments behind them are already discarded),
//    so "in front of the deck AND inside the cone the deck subtends" is a tight
//    proxy for "covering something the lesson is teaching". Hands that are
//    merely near the cards, or resting on felt beside them, keep most of their
//    weight, the point is to see THROUGH a hand, never to delete one.
//
// Both are continuous and derived only from (camera, card positions, pose), so
// there is no state to pop and a backwards scrub renders identically.
const XRAY_FREE = 0.34 // interior fade when covering nothing
const XRAY_OVER = 0.88 // interior fade when squarely over the cards
// View-space depth in front of the deck centre, in world units. A finger
// capsule is ~0.13 thick at HAND_SCALE, so a finger resting ON the deck lands
// near the top of this ramp. It starts slightly BEHIND the centre because a
// bowed/spread deck is deep, and a fragment level with its middle is still in
// front of the far half of it.
const FRONT_START = -0.1
const FRONT_FULL = 0.18
// Distance from the deck's view axis, in deck radii, measured at the deck's own
// depth (so it is the cone the deck subtends, not a flat screen circle).
const LAT_INNER = 1.0
const LAT_OUTER = 2.1

// Deck bounding sphere in VIEW space: xyz = centre, w = radius. One shared
// value object across every hand material, it is the same for all of them, so
// updateDeckFocus writes it once per frame and every hand picks it up.
const DECK_VIEW = new THREE.Vector4(0, 0, -1, 0)

const glsl = (n) => n.toFixed(4)

function addHandSurfaceShader(material, xray) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDeck = { value: DECK_VIEW }
    shader.uniforms.uXray = { value: xray }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform vec4 uDeck;
         uniform float uXray;`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         float ndv = abs(dot(normalize(vNormal), normalize(vViewPosition)));
         gl_FragColor.rgb += vec3(0.85, 0.65, 0.35) * pow(1.0 - ndv, 2.2) * 0.5;
         // vViewPosition is -mvPosition, so negating it recovers the fragment's
         // view-space position. Camera looks down -z: a LARGER z is nearer.
         vec3 xrayPos = -vViewPosition;
         float front = smoothstep(${glsl(FRONT_START)}, ${glsl(FRONT_FULL)}, xrayPos.z - uDeck.z);
         // Perspective-divide both to the same unit plane, then rescale to world
         // units at the deck's depth, that makes lat read in deck radii.
         vec2 fragDir = xrayPos.xy / max(1e-4, -xrayPos.z);
         vec2 deckDir = uDeck.xy / max(1e-4, -uDeck.z);
         float lat = length(fragDir - deckDir) * (-uDeck.z) / max(1e-4, uDeck.w);
         float over = front * (1.0 - smoothstep(${glsl(LAT_INNER)}, ${glsl(LAT_OUTER)}, lat));
         float fade = ndv * mix(${glsl(XRAY_FREE)}, ${glsl(XRAY_OVER)}, over) * uXray;
         gl_FragColor.a *= 1.0 - fade;`,
      )
  }
  // Both hand materials emit IDENTICAL shader text and differ only in uniform
  // values, so one program is correct for both.
  material.customProgramCacheKey = () => 'hand-xray-rim'
}

// A card is registered by its CENTRE, so a deck's bounding sphere is the box of
// those centres inflated by one card's own circumscribed radius.
const CARD_RADIUS = 0.5 * Math.hypot(CARD_W, CARD_H)
const _lo = new THREE.Vector3()
const _hi = new THREE.Vector3()
const _mid = new THREE.Vector3()
let _deckFrame = -1

// Refresh DECK_VIEW for this render frame. Both hands call it and the frame
// guard makes the second call free; `frameId` comes from the renderer's own
// counter so it is one sweep of the 52 card positions per frame, whatever is
// mounted. Cards live as direct children of one untransformed group, so their
// local positions ARE their world positions.
export function updateDeckFocus(camera, frameId) {
  if (frameId === _deckFrame || !camera?.isPerspectiveCamera) return
  _deckFrame = frameId
  const registry = getRegistry()
  if (registry.size === 0) {
    DECK_VIEW.w = 0 // radius 0 disables the "over the cards" term entirely
    return
  }
  _lo.set(Infinity, Infinity, Infinity)
  _hi.set(-Infinity, -Infinity, -Infinity)
  for (const handle of registry.values()) {
    _lo.min(handle.mesh.position)
    _hi.max(handle.mesh.position)
  }
  _mid.addVectors(_lo, _hi).multiplyScalar(0.5)
  const radius = 0.5 * _lo.distanceTo(_hi) + CARD_RADIUS
  _mid.applyMatrix4(camera.matrixWorldInverse)
  DECK_VIEW.set(_mid.x, _mid.y, _mid.z, radius)
}

// --- Forearm fade -----------------------------------------------------------
// The forearm capsule is ~1 world unit long, longer than a card. When its axis
// runs BROADSIDE to the camera it sweeps clear across the frame and hides the
// exact moment a lesson is teaching (the faro interlace, the Charlier cut). When
// it points toward/away from the viewer it foreshortens to a harmless stub. So
// fade it by how side-on it is, and never all the way out: the stub is what
// keeps the hand from reading as a severed palm.
// This is purely a RENDER concern, it runs off the camera in onBeforeRender and
// never touches pose data or FK positions.
const FOREARM_OPACITY_SOLID = 0.55 // identical to the shared hand material
// 0.07, halved from 0.14. Measured across every lesson and camera, the fade is
// already pinned at this floor almost everywhere (wash, overhand and charlier all
// sit on it), so the floor IS the value that matters, and at 0.14 two forearms
// lying broadside still read as solid bars across a top-down shot - the wash's
// worst remaining intrusion after the stub was halved. Halving the stub again
// would start to read as severed hands; halving the floor does not, because the
// gold fresnel rim in the shared shader keeps the silhouette legible even at very
// low alpha.
const FOREARM_OPACITY_EDGEON = 0.07
// The signal is sin(angle between the arm axis and the view ray), i.e. the
// FRACTION OF ITS LENGTH the arm sweeps across the frame. Not the raw dot
// product: at the faro interlace the arms sit 42° off the view ray, which sounds
// end-on but still paints 67% of a full arm straight over the cards.
const FADE_ACROSS_START = 0.32 // below this it foreshortens to a stub, stay solid
const FADE_ACROSS_FULL = 0.78 // at/above this it lies broadside, maximum fade

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
// phalange), its capsule is centered len/2 up its own +y. Rotating a joint
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
  const material = makeHandMaterial(1)

  const wrist = new THREE.Group()
  wrist.name = 'wrist'
  root.add(wrist)

  // Palm: a flattened, slightly domed slab, thin along the palmar axis (z),
  // wide across (x), tall from the wrist crease (-y) to the knuckle line (+y).
  // Dimensions come from PALM_MM in the spec, in millimetres, so the palm and
  // the fingers cannot drift out of proportion with each other.
  const palmGeo = new RoundedBoxGeometry(...PALM_MM.size.map(mmToRig), 4, mmToRig(12))
  const palm = new THREE.Mesh(palmGeo, material)
  palm.position.set(...PALM_MM.pos.map(mmToRig))
  wrist.add(palm)

  // Thenar eminence: the fleshy pad at the base of the thumb, for a full palm.
  const thenarGeo = new RoundedBoxGeometry(...THENAR_MM.size.map(mmToRig), 3, mmToRig(14))
  const thenar = new THREE.Mesh(thenarGeo, material)
  thenar.position.set(...THENAR_MM.pos.map(mmToRig))
  thenar.rotation.z = THENAR_MM.rotZ
  wrist.add(thenar)

  // The limb below the palm gets its OWN material instance (same factory, so it
  // is visually identical) purely so its opacity can be modulated independently
  //, see fadeAlongViewAxis. Same shader source, so it still shares the compiled
  // program under the 'hand-fresnel-rim' cache key; only the opacity uniform
  // differs. The wrist stub rides the same material as the forearm so the arm
  // recedes as ONE piece instead of leaving a bright bead on a ghost tube; the
  // palm and thenar stay solid, which is what keeps the hand attached.
  // Its x-ray strength is dialled back: the two fades MULTIPLY, and a broadside
  // forearm already sitting at 0.14 would otherwise cross the deck at ~0.02 and
  // read as nothing at all.
  const forearmMaterial = makeHandMaterial(0.55)

  // Wrist + forearm stub so the hand doesn't read as a severed palm. Capsules
  // are authored along +y, so they already trail down the -y axis below the palm.
  const wristGeo = new THREE.CapsuleGeometry(mmToRig(WRIST_MM.dia / 2), mmToRig(WRIST_MM.len), 6, 12)
  const wristMesh = new THREE.Mesh(wristGeo, forearmMaterial)
  wristMesh.position.set(...WRIST_MM.pos.map(mmToRig))
  wrist.add(wristMesh)

  const forearmGeo = new THREE.CapsuleGeometry(
    mmToRig(FOREARM_MM.dia / 2),
    mmToRig(FOREARM_MM.len),
    6,
    12,
  )
  const forearm = new THREE.Mesh(forearmGeo, forearmMaterial)
  forearm.position.set(...FOREARM_MM.pos.map(mmToRig))
  // The forearm is the only writer of forearmMaterial.opacity (the wrist stub
  // shares the material and rides this value, it has the same axis, being a
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
