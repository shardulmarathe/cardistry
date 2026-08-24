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

// SKIN ALBEDO, not skin *brightness*, and the number that decides whether a
// palm reads as flesh or as a slab of soap. 0xf0cba6 (linear ~0.87,0.60,0.38)
// was chosen when hands rendered at alpha 0.55, where most of what reached the
// screen was the felt behind them. Opaque it is a diffuse reflectance no skin
// has, and this rig is bright: an up-facing surface collects key 2.7 (cos~0.8)
// + spot 135/d^2 ~3.4 + rim + hemi + ambient, ~2.2x irradiance all told. At the
// old albedo that clips hard, which is exactly what a broadside palm looked
// like - a featureless cream rectangle with no form in it.
//
// MEASURED at every step, not derived - ACES compresses the linear result and
// the sRGB transfer then lifts it again, so it is very easy to talk yourself
// into a value a full stop too hot. Sampled on the same up-facing palm pixel:
//
//   0xf0cba6 (was)  (255,247,202) - CLIPPED, and near-neutral: a cream slab
//   0xb3896c        (232,194,158) - still within 3 levels of the card's white
//   0x99694f (now)  ~(205,150,118) - clearly darker than paper, clearly skin
//
// The white border of a playing card is the reference that matters, because one
// is always in shot: paper is ~0.85 diffuse reflectance and skin is ~0.35-0.45,
// so a palm under the same key MUST read distinctly darker than the card next to
// it or the eye files it as painted plastic. 0x99694f is linear ~(0.32,0.14,0.08)
// and keeps skin's ~1 : 0.45 : 0.26 R:G:B ratio.
const HAND_COLOR = 0x99694f

// All rig dimensions (scale, finger table, thumb opposition, local-frame
// conventions) live in handRigSpec.js, the single source of truth shared with
// the pure FK module (handKinematics.js) and the verify harness. Keep this
// file about geometry/material construction only.

// One shared material across palm, thenar and all five fingers keeps the skin
// response identical everywhere (and is cheaper). The limb below the palm gets a
// SECOND instance from this same factory, differing only in three UNIFORMS: its
// per-frame opacity, a gentler x-ray strength, and a stronger fresnel rim (see
// the fade sections below). Same shader TEXT, so both still share one program.
function makeHandMaterial(xray = 1, rim = RIM_HAND) {
  const material = new THREE.MeshStandardMaterial({
    color: HAND_COLOR,
    transparent: true,
    // OPACITY 1, depthWrite ON, FrontSide. This was 0.55 / off / DoubleSide, and
    // that combination is why the hands read as ghosts made of floating beads
    // rather than as hands - see the block below for the reasoning. The x-ray is
    // NOT removed; it is made LOCAL, applied by the shader only where a fragment
    // actually sits between the camera and the cards.
    opacity: 1,
    depthWrite: true,
    // 0.42 was a wet-plastic sheen. Skin is a rough dielectric: 0.62 keeps a
    // broad soft highlight along a knuckle instead of a small hot one, which is
    // the difference between "flesh" and "moulded resin" on geometry this
    // smooth. Costs nothing.
    roughness: 0.62,
    metalness: 0,
    side: THREE.FrontSide,
  })
  addHandSurfaceShader(material, xray, rim)
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
// XRAY_FREE was 0.34, i.e. a hand covering NOTHING still lost a third of its
// alpha, on top of a 0.55 base. Broadside that left 0.55*0.66 = 0.36 - a hand
// two-thirds transparent while hiding nothing at all. It is now 0, so a hand
// away from the cards is simply a hand, and the x-ray only spends alpha where
// there is something behind it to see.
const XRAY_FREE = 0.0 // interior fade when covering nothing
// 0.88 -> 0.62 -> 0.25, and the last cut came from a REFERENCE COMPARISON rather
// than from a metric. Held against real table-riffle footage, the single most
// obviously wrong thing about the app was that you could see the CARD BACKS THROUGH
// THE FINGERS - which a viewer reads, correctly, as the cards clipping through the
// hand. Real fingers occlude. At 0.62 the fade was 38% alpha over the deck, enough
// to show a whole card back through a finger.
//
// The reason it was ever that high is worth keeping: the x-ray was compensating for
// a POSE problem. This lesson's fingers lie flat ACROSS the card faces and cover
// most of both halves, where in the footage a hand covers maybe a third of its half
// and the backs stay visible. So the fade was hiding a hand that should not have
// been there. Cutting it to 0.25 costs nothing in readability - captured and
// compared, the backs are still perfectly legible between and around the fingers -
// because the fingers were never the only thing over the cards.
// Fix the pose and this can go to 0.
// 0.88 -> 0.62 -> 0.25 -> 0.08, and this last cut is the one the comment above
// predicted: "fix the pose and this can go to 0". The poses have since been fixed. The
// riffle's hands were re-authored onto the footage's placement (on top of their own
// half, covering about a third of it) and the wash's palms now graze rather than
// sprawl, so the fade is no longer compensating for a hand that should not be over the
// cards in the first place.
//
// Verified by capture at the WORST CASE, which is the wash: both palms broadside
// (ndv ~ 1) and squarely over a full-field spread (over ~ 1), so the full fade applies
// across the whole hand. At 0.25 the card backs, the gold borders and the "S" read
// clearly THROUGH the fingers and palm - which a viewer reads, correctly, as the cards
// clipping through the hand, and which is what a user reported. At 0.08 the hands are
// solid and the spread is still entirely legible, because the cards a hand covers were
// never the only cards on screen.
// Kept just above 0 rather than removed: the mechanism is two lines and it is the only
// defence if a future pose does end up over the cards.
const XRAY_OVER = 0.08 // interior fade when squarely over the cards
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

// --- Fresnel rim ------------------------------------------------------------
// The rim is ADDED after tone mapping and colour conversion (it patches
// <dithering_fragment>, which runs last), so its strength is in DISPLAY units:
// 0.5 meant "+0.5 of pure gold at the silhouette". That was tuned to keep a
// hand legible at 0.07 alpha, where the rim was doing all the work of drawing
// the outline. On an OPAQUE surface it is a white-hot halo around every capsule,
// and a halo around each phalange is exactly what made a finger read as a string
// of beads. The strength is now a per-instance UNIFORM (same shader text, so one
// program still serves both materials):
//   * the hand keeps a faint warm edge - enough to separate one finger crossing
//     another, not enough to glow;
//   * the forearm/wrist, which still renders down at 0.07 alpha when broadside,
//     keeps most of the old strength, because there the rim IS the silhouette.
const RIM_HAND = 0.15
const RIM_FOREARM = 0.42

const glsl = (n) => n.toFixed(4)

function addHandSurfaceShader(material, xray, rim) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDeck = { value: DECK_VIEW }
    shader.uniforms.uXray = { value: xray }
    shader.uniforms.uRim = { value: rim }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform vec4 uDeck;
         uniform float uXray;
         uniform float uRim;`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         float ndv = abs(dot(normalize(vNormal), normalize(vViewPosition)));
         gl_FragColor.rgb += vec3(0.85, 0.65, 0.35) * pow(1.0 - ndv, 2.2) * uRim;
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
// DELIBERATELY DECOUPLED from the hand material's opacity, which is now 1.
// These two used to be kept equal (both 0.55) on the theory that a limb which
// does not match the palm it is attached to reads as a severed hand. That was
// true at 0.55. At 1.0 it is the wrong trade: the forearm is a ~1-world-unit
// capsule that carries NO teaching information and, opaque, it sweeps a solid
// bar across the frame - it was the worst part of the opaque prototype. So the
// hand is fully solid and the limb below the wrist is a HALF-WEIGHT presence:
// still plainly attached, never the brightest thing on screen. The seam is
// hidden by the fact that the wrist stub shares this material, so the falloff
// happens under the palm rather than at a hard edge across it.
const FOREARM_OPACITY_SOLID = 0.5
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
// Re-checked against the new floor. These thresholds were tuned when "solid"
// meant an effective ~0.4 alpha, so the whole ramp lived inside a range that was
// already faint; with the top of the ramp now an honest 0.5 the START matters
// more, and an arm only 25% broadside still paints a quarter of its length over
// the table. Pulled 0.32 -> 0.24 so the recede begins sooner. FULL is unchanged:
// it is the point where the arm is unambiguously side-on, and moving it would
// change the floor's reach, which was measured across every lesson.
const FADE_ACROSS_START = 0.24 // below this it foreshortens to a stub, stay solid
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
    // GROUNDING. Every phalange used to cast nothing, so a hand had no
    // relationship to the felt or to the deck and read as a decal floating over
    // the frame. Casting is what makes a pad look like it is ON a card.
    // receiveShadow matters just as much and is easy to miss: with it on, the
    // fingers shadow EACH OTHER and the palm slab behind them, which is most of
    // the form on geometry this smooth and untextured.
    // Cost: 15 capsules per hand in the key light's depth pass. They are
    // 6x12-segment capsules with a depth-only material, and the pass is already
    // re-rendering the scene, so this measured as noise next to the 52 cards.
    mesh.castShadow = true
    mesh.receiveShadow = true
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
  palm.castShadow = true
  // The single most valuable receiver in the rig: a palm is 80x106mm, so at any
  // camera looking down on a hand whose fingers reach around a packet it is a
  // card-sized broadside slab. Unshadowed it is a flat cream rectangle; taking
  // the fingers' shadows gives it depth for free.
  palm.receiveShadow = true
  wrist.add(palm)

  // Thenar eminence: the fleshy pad at the base of the thumb, for a full palm.
  const thenarGeo = new RoundedBoxGeometry(...THENAR_MM.size.map(mmToRig), 3, mmToRig(14))
  const thenar = new THREE.Mesh(thenarGeo, material)
  thenar.position.set(...THENAR_MM.pos.map(mmToRig))
  thenar.rotation.z = THENAR_MM.rotZ
  thenar.castShadow = true
  thenar.receiveShadow = true
  wrist.add(thenar)

  // The limb below the palm gets its OWN material instance (same factory, so it
  // is built by the same factory) purely so its opacity can be modulated
  // independently, see fadeAlongViewAxis. Same shader SOURCE, so it still shares
  // the compiled program under the 'hand-xray-rim' cache key; only uniforms
  // differ. The wrist stub rides the same material as the forearm so the arm
  // recedes as ONE piece instead of leaving a bright bead on a ghost tube; the
  // palm and thenar stay solid, which is what keeps the hand attached.
  // Its x-ray strength is dialled back: the two fades MULTIPLY, and a broadside
  // forearm already sitting at its 0.07 floor would otherwise cross the deck at
  // ~0.03 and read as nothing at all. Its rim is dialled UP for the same reason:
  // at that alpha the fresnel edge is the only thing still drawing the arm.
  const forearmMaterial = makeHandMaterial(0.55, RIM_FOREARM)

  // Wrist + forearm stub so the hand doesn't read as a severed palm. Capsules
  // are authored along +y, so they already trail down the -y axis below the palm.
  const wristGeo = new THREE.CapsuleGeometry(mmToRig(WRIST_MM.dia / 2), mmToRig(WRIST_MM.len), 6, 12)
  const wristMesh = new THREE.Mesh(wristGeo, forearmMaterial)
  wristMesh.position.set(...WRIST_MM.pos.map(mmToRig))
  // The limb RECEIVES but never CASTS. A shadow map has no notion of opacity, so
  // a caster at 0.07 alpha would throw the same jet-black bar a solid arm does -
  // the exact thing fadeAlongViewAxis exists to get rid of, reintroduced as a
  // shadow. Its own shadow is also never the informative one.
  wristMesh.receiveShadow = true
  wrist.add(wristMesh)

  const forearmGeo = new THREE.CapsuleGeometry(
    mmToRig(FOREARM_MM.dia / 2),
    mmToRig(FOREARM_MM.len),
    6,
    12,
  )
  const forearm = new THREE.Mesh(forearmGeo, forearmMaterial)
  forearm.position.set(...FOREARM_MM.pos.map(mmToRig))
  forearm.receiveShadow = true // casts nothing, see the wrist stub above
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
