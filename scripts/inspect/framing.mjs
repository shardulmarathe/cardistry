// Where is each lesson's action, actually, and does ALL OF IT fit in shot?
//
// Two questions, and this tool used to answer only the first badly. A camera
// preset aimed at the felt (y ~ 0.3) frames a move that happens in the air
// (y ~ 1.0) against the top of the frame with a third of the shot empty table,
// so it measures the real bounding box of every card over a whole track and
// derives the aim from the move instead of guessing it.
//
// WHY THE HAND MEASUREMENT CHANGED. It used to report `wrists y`: the wrist
// JOINT position, one point per hand. A wrist joint is the one part of a hand
// that is never the thing sticking out of frame - the fingers are, and the palm
// and forearm slabs behind them are the largest single masses in the rig. So the
// tool cheerfully printed "aim ok" for the overhand while, in a real capture,
// the drawing hand is ENTIRELY above the top edge at every `peel-*` beat with
// two fingertips showing. A diagnostic that cannot see a whole hand leave the
// frame is not a diagnostic. It now builds the true world-space extent of
// everything that renders - all 5 fingers' joints AND tips, each inflated by its
// own capsule radius, plus the palm, thenar, wrist and forearm masses from
// handRigSpec - and projects that through the ACTIVE preset's frustum PER STEP,
// because a lesson that changes shot mid-track cannot be judged on one camera.
//
// Three distinctions keep the output readable, and each one exists because
// dropping it made this tool flag all 76 steps in the catalog and so say nothing:
// the HAND PROPER is scored and the ARM STUB is only reported (an arm running off
// the side of frame is what real card footage looks like); a hand more than a
// card-length from any card is PARKED, not in the shot yet; and the crop is
// judged under both the documented "panel takes the bottom 40%" model and the
// geometry the app actually renders, which loses the top of the frame too.
//
// Run: node --import ./scripts/verify/register.mjs scripts/inspect/framing.mjs
import { LESSONS } from '../../src/lessons/catalog/index.js'
import { compileLesson } from '../../src/lessons/engine/compileLesson.js'
import { sampleTrack } from '../../src/lessons/engine/sampleTrack.js'
import { createDeck } from '../../src/deckModel.js'
import { CAMERA_PRESETS } from '../../src/lib/constants.js'
import { CARD_H } from '../../src/lib/constants.js'
import {
  FINGER_NAMES,
  FINGERS,
  HAND_SCALE,
  mmToRig,
  PALM_MM,
  THENAR_MM,
  WRIST_MM,
  FOREARM_MM,
} from '../../src/hands/handRigSpec.js'
import { fingerJointsWorld, wristLocalToWorld } from '../../src/hands/handKinematics.js'
import * as THREE from 'three'

const pad = (s, n) => String(s).padEnd(n)
const N = 120
// Frames per step for the hand-extent pass, sampled at (i+0.5)/STEP_SAMPLES so
// no sample lands exactly on a step boundary (which belongs to the next step's
// camera). Fixed count, no clock, no rng: identical output every run.
const STEP_SAMPLES = 12

// Reference viewport. The app's canvas is the whole window; this is a desktop
// 1200x860 content box, the shape every preset in constants.js was tuned at.
const VIEW_W = 1200
const VIEW_H = 860
// The PANEL inset in pixels, i.e. what `TransportBar` publishes as `uiInset` and
// `ResponsiveCamera` hands to `setViewOffset` as the extra virtual height. 200px of
// an 860px canvas is what PANEL_FRAC 0.19 below is derived from.
const VIEW_INSET = 200

// THE APP'S ACTUAL PROJECTION, not the preset's declared one. This tool used to
// build `new PerspectiveCamera(P.fov, VIEW_W / VIEW_H, ...)`, and BOTH of those
// arguments are wrong at runtime, which made every horizontal CROPPED figure
// optimistic - it believed the frame was 11-18% wider than it is, and this is the
// tool whose whole job is to be honest about what leaves the frame.
//
//  * `fov`: ResponsiveCamera OVERWRITES every preset's fov with
//    `fovForAspect(canvasAspect)`, which holds the HORIZONTAL field constant below
//    a 1.5 reference aspect. So `CAMERA_PRESETS[*].fov` is dead at runtime except
//    as the initial Canvas seed. At 1200x860 the real vertical fov is ~37.45, not
//    the 34-38 the presets declare.
//  * `aspect`: `setViewOffset(w, h + inset, ...)` re-assigns
//    `camera.aspect = fullWidth / fullHeight` as its first statement, so the real
//    aspect is w/(h+inset) = 1.132, not w/h = 1.395.
//
// Both are reproduced below so the projection here is the projection on screen.
const BASE_FOV = 35 // ResponsiveCamera's BASE_FOV
const REF_ASPECT = 1.5 // ResponsiveCamera's REF_ASPECT
const MAX_FOV = 78
const fovForAspect = (aspect) => {
  if (!Number.isFinite(aspect) || aspect >= REF_ASPECT) return BASE_FOV
  const hFov = 2 * Math.atan(Math.tan((BASE_FOV * Math.PI) / 360) * REF_ASPECT)
  return Math.min(MAX_FOV, (2 * Math.atan(Math.tan(hFov / 2) / aspect) * 180) / Math.PI)
}
// The fov is chosen from the CANVAS aspect (what ResponsiveCamera sees), while the
// projection is built with the VIEW-OFFSET aspect (what setViewOffset assigns).
const RUNTIME_FOV = fovForAspect(VIEW_W / VIEW_H)
const ASPECT = VIEW_W / (VIEW_H + VIEW_INSET)

// HOW MUCH OF THE FRAME THE TRANSPORT PANEL TAKES. Two models, and they
// disagree, which is the single most useful thing this tool now prints.
//
// (a) THE DOCUMENTED MODEL, and the gate. "The panel covers the bottom 40%, so
// the usable frame is the fov frame minus its bottom 40%." Every preset in
// constants.js was tuned against exactly this and several of their comments
// quote usable half-heights derived from it, so it stays the gate: changing it
// would silently re-score every preset in the same commit as a hand fix. The
// real panel is ~200-260px tall at desktop (16/20/18px of padding, a 40px button
// row, title + step + fact lines, and it GROWS with the mixing strip and the
// replay history, which is why TransportBar measures itself instead of assuming
// a height), so 0.40 is conservative on the panel's actual share of an 860px
// viewport. Re-derive it in the pass that re-derives the presets, not before.
const TRANSPORT_RESERVE = 0.4
// NDC y below this is behind the panel. NDC y runs -1 (bottom) .. +1 (top).
const USABLE_Y_MIN = -1 + 2 * TRANSPORT_RESERVE

// (b) WHAT THE APP ACTUALLY RENDERS, which loses the TOP of the frame as well,
// and no version of this tool has ever accounted for it.
//
// ResponsiveCamera calls `camera.setViewOffset(w, h + inset, 0, inset, w, h)`
// with `inset` = the panel's measured height. three's makePerspective applies
// `fov` to the FULL virtual height (h + inset) and then carves out the sub-window
// starting `inset` from its TOP. So the camera's aim - the preset's `target` -
// lands at virtual row (h+inset)/2, which is `inset/2` ABOVE the middle of the
// visible canvas: the subject is pushed UP out from behind the panel, which is
// the intent. The consequence nothing had measured is that the top `inset` of the
// fov frame is now off-canvas entirely. Usable virtual rows are [inset, h] of
// [0, h+inset], i.e. NDC y in +-(1 - 2*PANEL_FRAC): SYMMETRIC, and much tighter
// at the top than model (a)'s +1.
//
// That is not a quibble, it is the overhand. Measured below, the drawing hand at
// every `peel-*` beat spans NDC y 0.09..1.19: model (a) calls that "over the top
// by 0.19, 91% of the hand in shot" and model (b) calls it "everything above
// 0.62 is gone", which is a hand out of shot with its fingertips hanging into the
// top edge - exactly what the capture shows. Model (a) was not wrong about the
// panel; it was blind to the other end of the frame.
//
// 0.19 = 200px of panel over an 860px canvas plus that same 200px of virtual
// frame (200/1060). Kept separate from TRANSPORT_RESERVE on purpose: this one is
// a measurement of the app, that one is the historical tuning basis.
const PANEL_FRAC = 0.19
const REAL_Y_MAX = 1 - 2 * PANEL_FRAC
const REAL_Y_MIN = -REAL_Y_MAX
// A "BUG" THAT WAS CLAIMED HERE AND IS NOT REAL. Recorded so nobody rediscovers
// it and "fixes" it. The reasoning was: r3f sets `camera.aspect = w/h` (the
// canvas), while the view offset leaves the projection's horizontal extent at
// `aspect * (h + inset)` against a visible vertical extent of only `h`, so the
// image should be stretched ~1.23x vertically at 1200x860 with a 200px panel.
//
// That is wrong, because `PerspectiveCamera.setViewOffset` ITSELF re-assigns
// `this.aspect = fullWidth / fullHeight` as its very first statement
// (three/src/cameras/PerspectiveCamera.js). ResponsiveCamera passes
// `fullHeight = height + inset`, so the aspect is ALREADY w/(h+inset) by the
// time the projection matrix is built, and whatever r3f set is overwritten.
// Verified numerically: a 1x1 world square facing the camera renders 336.2px by
// 336.2px, ratio 1.0000, both with and without the "fix". Do not change the
// aspect in ResponsiveCamera.
//
// What IS real is the asymmetry above: `offsetY = inset` means the visible band
// is cut from the virtual frame such that the top `inset/(h+inset)` of the fov
// frame is never rendered. That is the intended recentring, and it is why the
// bottom-40% reserve model disagrees with a capture.

// ---------------------------------------------------------------------------
// The hand's renderable masses, in the LOCAL (pre-wrist) frame, in rig units.
//
// Boxes have to be carried as 8 corners because the wrist quaternion rotates
// them; capsules are carried as their two sphere centres plus a radius, which
// is exact under rotation and does not over-box a capsule lying diagonally.
function boxCorners(sizeMM, posMM, rotZ = 0) {
  const h = sizeMM.map((v) => mmToRig(v) / 2)
  const p = posMM.map(mmToRig)
  const c = Math.cos(rotZ)
  const s = Math.sin(rotZ)
  const out = []
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = sx * h[0]
        const y = sy * h[1]
        out.push(new THREE.Vector3(p[0] + x * c - y * s, p[1] + x * s + y * c, p[2] + sz * h[2]))
      }
  return out
}
// Capsules are authored along local +y (see handRig.js), so the two sphere
// centres sit at pos ± len/2 on y and the radius is dia/2.
function capsuleSpheres(spec) {
  const r = mmToRig(spec.dia / 2)
  const half = mmToRig(spec.len) / 2
  const p = spec.pos.map(mmToRig)
  return [
    { c: new THREE.Vector3(p[0], p[1] - half, p[2]), r },
    { c: new THREE.Vector3(p[0], p[1] + half, p[2]), r },
  ]
}
// HAND PROPER vs ARM STUB, and the split is the difference between a bug and
// footage. A forearm running off the side of frame is what every piece of real
// card footage looks like - the arms come from outside the shot. A cropped HAND
// is the failure. Scored separately: only the hand proper (fingers + palm +
// thenar) raises CROPPED; the wrist and forearm capsules are measured, reported
// when they are the only thing leaving frame, and not treated as an error.
const HAND_MASS_PTS = [
  ...boxCorners(PALM_MM.size, PALM_MM.pos).map((c) => ({ c, r: 0 })),
  ...boxCorners(THENAR_MM.size, THENAR_MM.pos, THENAR_MM.rotZ).map((c) => ({ c, r: 0 })),
]
const ARM_PTS = [...capsuleSpheres(WRIST_MM), ...capsuleSpheres(FOREARM_MM)]
// Finger joints come out of FK as [knuckle, PIP, DIP, tip]; joint i is inflated
// by phalange i's radius (the tip by the distal's, which is what the fingertip
// capsule's cap actually is). FINGERS[].rad is UNSCALED rig units.
const JOINT_RAD = Object.fromEntries(
  FINGER_NAMES.map((n) => [n, [0, 1, 2, 2].map((i) => FINGERS[n].rad[i] * HAND_SCALE)]),
)

const _j = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
const _w = new THREE.Vector3()

// Every renderable point of one hand, as { world position, world radius }, into
// a caller-owned array of {p: Vector3, r: number} so nothing allocates per frame.
// The HAND PROPER comes first and the arm stub last, so the caller can score the
// two separately: returns { n, hand } with `hand` = the count of leading points
// that are hand rather than arm.
function handPoints(pose, side, out) {
  let n = 0
  const put = (v, r) => {
    if (!out[n]) out[n] = { p: new THREE.Vector3(), r: 0 }
    out[n].p.copy(v)
    out[n].r = r
    n++
  }
  for (const name of FINGER_NAMES) {
    fingerJointsWorld(pose, side, name, _j)
    const rad = JOINT_RAD[name]
    for (let i = 0; i < 4; i++) put(_j[i], rad[i])
  }
  for (const m of HAND_MASS_PTS) put(wristLocalToWorld(pose, side, m.c, _w), m.r * HAND_SCALE)
  const hand = n
  for (const m of ARM_PTS) put(wristLocalToWorld(pose, side, m.c, _w), m.r * HAND_SCALE)
  return { n, hand }
}

// ---------------------------------------------------------------------------
// Frustum projection. PerspectiveCamera is pure matrix math, no WebGL, so this
// stays headless.
const CAMERAS = new Map()
function cameraFor(name) {
  if (CAMERAS.has(name)) return CAMERAS.get(name)
  const P = CAMERA_PRESETS[name]
  if (!P) {
    CAMERAS.set(name, null)
    return null
  }
  const cam = new THREE.PerspectiveCamera(RUNTIME_FOV, ASPECT, 0.1, 100)
  cam.position.set(...P.position)
  cam.up.set(0, 1, 0)
  cam.lookAt(new THREE.Vector3(...P.target))
  cam.updateMatrixWorld()
  cam.updateProjectionMatrix()
  CAMERAS.set(name, cam)
  return cam
}
const _v = new THREE.Vector3()
// A sphere's screen box: project the centre, then convert its world radius into
// NDC at the centre's own view depth. Doing it per point rather than boxing the
// whole hand first is what makes "two fingertips inside the frame" measurable.
function projectSphere(cam, p, r, box) {
  _v.copy(p).applyMatrix4(cam.matrixWorldInverse)
  const depth = -_v.z
  if (depth <= cam.near) return // behind the lens: nothing sane to report
  const halfH = Math.tan((cam.fov * Math.PI) / 360) * depth
  const ry = r / halfH
  const rx = r / (halfH * cam.aspect)
  _v.copy(p).project(cam)
  const lo = { x: _v.x - rx, y: _v.y - ry }
  const hi = { x: _v.x + rx, y: _v.y + ry }
  box.minX = Math.min(box.minX, lo.x)
  box.maxX = Math.max(box.maxX, hi.x)
  box.minY = Math.min(box.minY, lo.y)
  box.maxY = Math.max(box.maxY, hi.y)
  box.n++
  if (lo.x >= -1 && hi.x <= 1 && lo.y >= USABLE_Y_MIN && hi.y <= 1) box.inDoc++
  if (lo.x >= -1 && hi.x <= 1 && lo.y >= REAL_Y_MIN && hi.y <= REAL_Y_MAX) box.inReal++
}
const newBox = () => ({
  minX: Infinity,
  maxX: -Infinity,
  minY: Infinity,
  maxY: -Infinity,
  n: 0,
  inDoc: 0,
  inReal: 0,
})
// Which way, and by how much, in NDC (2 = a full frame width or height).
// EDGE_TOL of slop, because 0.01 of NDC is 4px of an 860px frame and reporting
// "cropped by 0.00" as a finding is how a real one gets skipped.
const EDGE_TOL = 0.02
function overflows(box, yMin, yMax) {
  const o = []
  if (box.maxY > yMax + EDGE_TOL) o.push(`top ${(box.maxY - yMax).toFixed(2)}`)
  if (box.minY < yMin - EDGE_TOL) o.push(`bottom ${(yMin - box.minY).toFixed(2)}`)
  if (box.minX < -1 - EDGE_TOL) o.push(`left ${(-1 - box.minX).toFixed(2)}`)
  if (box.maxX > 1 + EDGE_TOL) o.push(`right ${(box.maxX - 1).toFixed(2)}`)
  return o
}
// WHICH HANDS COUNT. Both hands start and end the catalog parked off the table
// (the overhand's right wrist sits at x 2.92 during `ready`, a card-and-a-half
// outside the widest preset), and a hand that has not entered the shot yet is
// not a framing bug - flagging it made this tool print CROPPED for all 76 steps
// in the catalog, which is the same uselessness as the AIM OFF line above. A
// hand is part of the SUBJECT when its geometry comes within a card-length of
// the cards; that is geometric and needs no per-lesson list of "the active hand".
const SUBJECT_REACH = CARD_H
// Distance between two AABBs, 0 if they touch.
function boxDist(a, b) {
  const dx = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x)
  const dy = Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y)
  const dz = Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z)
  return Math.hypot(dx, dy, dz)
}
const emptyBounds = () => ({
  min: { x: Infinity, y: Infinity, z: Infinity },
  max: { x: -Infinity, y: -Infinity, z: -Infinity },
})
function growBounds(b, x, y, z, r = 0) {
  b.min.x = Math.min(b.min.x, x - r)
  b.min.y = Math.min(b.min.y, y - r)
  b.min.z = Math.min(b.min.z, z - r)
  b.max.x = Math.max(b.max.x, x + r)
  b.max.y = Math.max(b.max.y, y + r)
  b.max.z = Math.max(b.max.z, z + r)
}

const verdict = (box, yMin, yMax, inside) => {
  const o = overflows(box, yMin, yMax)
  return o.length ? `${o.join(' + ')}, ${Math.round((100 * inside) / box.n)}% in shot` : 'fits'
}

console.log(
  pad('lesson', 10),
  pad('cards y', 16),
  pad('cards x', 16),
  pad('hand y', 16),
  pad('busiest y', 10),
  'presets used -> their targets',
)
for (const l of LESSONS) {
  const track = compileLesson(l, createDeck())
  let cy = [Infinity, -Infinity]
  let cx = [Infinity, -Infinity]
  let cz = [Infinity, -Infinity]
  let hy = [Infinity, -Infinity]
  // Weight by how much card mass sits at each height: the "busiest" band is what
  // the camera should actually aim at, not the midpoint of the extremes.
  const bins = new Map()
  const wsamp = []
  const pts = []
  for (let i = 0; i <= N; i++) {
    const scene = sampleTrack(track, (track.duration * i) / N)
    for (const [, c] of scene.cards) {
      cy = [Math.min(cy[0], c.pos.y), Math.max(cy[1], c.pos.y)]
      cx = [Math.min(cx[0], c.pos.x), Math.max(cx[1], c.pos.x)]
      cz = [Math.min(cz[0], c.pos.z), Math.max(cz[1], c.pos.z)]
      const b = Math.round(c.pos.y * 10) / 10
      bins.set(b, (bins.get(b) ?? 0) + 1)
    }
    for (const side of ['left', 'right']) {
      const h = scene.hands[side]
      if (!h) continue
      wsamp.push(h.wrist.pos.y)
      // The reported band is the WHOLE renderable rig's y extent, arm stub
      // included, not the wrist joint's.
      const { n } = handPoints(h, side, pts)
      for (let k = 0; k < n; k++) {
        hy = [Math.min(hy[0], pts[k].p.y - pts[k].r), Math.max(hy[1], pts[k].p.y + pts[k].r)]
      }
    }
  }
  const busiest = [...bins.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const presets = new Set([l.cameraPreset, ...track.cameraByStep.map((c) => c.preset)])
  const shown = [...presets]
    .filter(Boolean)
    .map((p) => `${p}(y${CAMERA_PRESETS[p] ? CAMERA_PRESETS[p].target[1] : '?'})`)
    .join(' ')
  // KNOWN FALSE POSITIVE: the verdict takes the WORST aim across every preset a
  // lesson uses, so a lesson that legitimately changes shot gets flagged. Charlier
  // reports "off by 0.72" because it ends on `overview` (y 0.15) as the deck is set
  // down on the table, which is the correct shot for that beat. Judging per-preset
  // against only the steps that use it would fix this; until then, read the flag as
  // "look at this lesson", not "this lesson is wrong".
  //
  // Judge on ROBUST CENTRES, not extremes. A whole-track min/max sweeps in every
  // transient - a hand lifting away at the end of the overhand touches y 1.90 - so
  // an extremes-based verdict flags every lesson and means nothing. The busiest
  // card band and the MEDIAN wrist height are what the shot has to hold.
  wsamp.sort((a, b) => a - b)
  const wMed = wsamp.length ? wsamp[wsamp.length >> 1] : null
  const centre = wMed === null ? busiest : (busiest + wMed) / 2
  const aims = [...presets].filter(Boolean).map((p) => CAMERA_PRESETS[p]?.target[1]).filter((v) => v !== undefined)
  const worstAim = aims.length ? Math.max(...aims.map((a) => Math.abs(centre - a))) : 0
  console.log(
    pad(l.id, 10),
    pad(`${cy[0].toFixed(2)} .. ${cy[1].toFixed(2)}`, 16),
    pad(`${cx[0].toFixed(2)} .. ${cx[1].toFixed(2)}`, 16),
    pad(hy[0] === Infinity ? 'none' : `${hy[0].toFixed(2)} .. ${hy[1].toFixed(2)}`, 16),
    pad(busiest.toFixed(1), 10),
    shown,
    `| z ${cz[0].toFixed(2)}..${cz[1].toFixed(2)}` +
      ` | wrist med ${wMed === null ? ' - ' : wMed.toFixed(2)} want ~${centre.toFixed(2)}` +
      (worstAim > 0.35 ? ` AIM OFF ${worstAim.toFixed(2)}` : ' aim ok') +
      // DOES THE SUBJECT FIT? Aim is only half of framing. An earlier version of
      // this tool checked the aim alone and passed the wash, whose spread overflows
      // the frame on three sides. Compare the subject's half-extents against what
      // each preset can see at the subject's own distance.
      (() => {
        const spanX = Math.max(Math.abs(cx[0]), Math.abs(cx[1])) + CARD_H / 2
        const spanZ = Math.max(Math.abs(cz[0]), Math.abs(cz[1])) + CARD_H / 2
        const bad = []
        for (const p of presets) {
          const P = CAMERA_PRESETS[p]
          if (!P) continue
          const eye = new THREE.Vector3(...P.position)
          const tgt = new THREE.Vector3(...P.target)
          const d = eye.distanceTo(tgt)
          const halfH = d * Math.tan((RUNTIME_FOV * Math.PI) / 360)
          const halfW = halfH * ASPECT
          // The transport panel covers the bottom TRANSPORT_RESERVE of the frame,
          // so only the rest of the frame height is usable for the subject.
          if (spanX > halfW || spanZ > halfH * (1 - TRANSPORT_RESERVE)) bad.push(p)
        }
        return bad.length ? `  <-- OVERFLOWS ${bad.join(',')}` : ''
      })(),
  )

  // ---------------------------------------------------------------------------
  // PER STEP, PER HAND: does the whole hand fit the frustum of the preset that
  // step is actually shot on?
  const cropped = []
  const parked = []
  const armOnly = []
  for (const step of track.steps) {
    // The preset in force during a step: cameraByStep is sparse (only steps that
    // declare a camera push an entry), so the active one is the last entry at or
    // before this step's start, falling back to the lesson's own preset. The 0.9s
    // tween CameraController runs between presets is ignored on purpose - a shot
    // that crops mid-tween is a symptom of the shot it is heading for.
    let preset = l.cameraPreset
    for (const c of track.cameraByStep) if (step.tStart >= c.tStart) preset = c.preset
    const cam = cameraFor(preset)
    if (!cam) continue
    const hands = { left: newBox(), right: newBox() }
    const arms = { left: newBox(), right: newBox() }
    const reach = { left: Infinity, right: Infinity }
    for (let i = 0; i < STEP_SAMPLES; i++) {
      const ms = step.tStart + (step.tEnd - step.tStart) * ((i + 0.5) / STEP_SAMPLES)
      const scene = sampleTrack(track, ms)
      const cardBox = emptyBounds()
      // Snapshot the card extent for THIS instant before touching the hands:
      // sampleTrack reuses its output objects, so nothing here may outlive the
      // sample it came from.
      for (const [, c] of scene.cards) growBounds(cardBox, c.pos.x, c.pos.y, c.pos.z, CARD_H / 2)
      for (const side of ['left', 'right']) {
        const h = scene.hands[side]
        if (!h) continue
        const { n, hand } = handPoints(h, side, pts)
        const handBox = emptyBounds()
        for (let k = 0; k < n; k++) {
          const { p, r } = pts[k]
          projectSphere(cam, p, r, k < hand ? hands[side] : arms[side])
          if (k < hand) growBounds(handBox, p.x, p.y, p.z, r)
        }
        reach[side] = Math.min(reach[side], boxDist(handBox, cardBox))
      }
    }
    for (const side of ['left', 'right']) {
      const box = hands[side]
      if (!box.n) continue
      const doc = verdict(box, USABLE_Y_MIN, 1, box.inDoc)
      const real = verdict(box, REAL_Y_MIN, REAL_Y_MAX, box.inReal)
      // ONLY THE AS-RENDERED MODEL RAISES `CROPPED`. Requiring both models to fit
      // flagged 40 of the catalog's 50 steps, which is a wall rather than a
      // diagnostic - and 16 of those were wash rows reading "as rendered fits",
      // failed solely by the model this file itself calls the historical tuning
      // basis. Letting a model you have declared obsolete raise the alarm is how an
      // alarm stops being read. The panel-reserve verdict is still PRINTED on every
      // line (it is what the preset comments were tuned against, so it is the number
      // to use when re-tuning a preset) - it just no longer decides.
      if (real === 'fits') {
        const arm = arms[side]
        if (verdict(arm, REAL_Y_MIN, REAL_Y_MAX, arm.inReal) !== 'fits')
          armOnly.push(`${step.id}/${side}`)
        continue
      }
      if (reach[side] > SUBJECT_REACH) {
        parked.push(`${step.id}/${side}`)
        continue
      }
      cropped.push(
        `  CROPPED ${l.id} step ${step.id} ${side} hand on ${preset}:` +
          ` panel-reserve model ${doc} | as rendered ${real}` +
          ` | ndc x ${box.minX.toFixed(2)}..${box.maxX.toFixed(2)} y ${box.minY.toFixed(2)}..${box.maxY.toFixed(2)}`,
      )
    }
  }
  if (cropped.length) for (const line of cropped) console.log(line)
  else console.log('  hands in frame: every step, both hands')
  // Neither of these is an error, but say them out loud rather than filtering
  // them away silently - a reader has to be able to tell "not scored" from "fine".
  if (parked.length)
    console.log(
      `  parked hands part-out-of-frame but >${SUBJECT_REACH.toFixed(2)} from any card, so not in the shot yet: ${parked.join(' ')}`,
    )
  if (armOnly.length) console.log(`  arm stub only off frame (expected): ${armOnly.join(' ')}`)
}
