// CARD-VS-CARD CLIPPING PROBE. Do two cards pass THROUGH one another?
//
// This is the one collision in the app that nothing measured. Every existing
// metric asks about a HAND against a card (penetration, pierce, contact,
// causality); the user's most obvious visual complaint is a card slicing across
// another card's face, and no number in the harness could see it.
//
// ===========================================================================
// THIS FILE MEASURES TWO DIFFERENT DEFECTS, AND THE SECOND ONE EXISTS BECAUSE
// THE FIRST ONE READ A HARD ZERO WHILE THE USER WAS STILL LOOKING AT CLIPPING.
//
//   1. measureClipping  - CROSSING. An edge of one card passes through another
//      card's surface. Geometric interpenetration. See the note below.
//
//   2. measureStacking  - COPLANARITY and TOP-CARD SWAPS. Two cards that OVERLAP
//      in plan view sit at almost the same height, or exchange which of them is
//      above the other. No edge crosses anything; the cards are still visually
//      inside one another.
//
// WHY (1) ALONE IS NOT ENOUGH, and this is the important part. `measureClipping`
// is EXACTLY ZERO for any set of PARALLEL cards, at any heights, for all time.
// That is not a passing grade, it is an identity: two parallel planes at
// different heights never meet, and the wash relies on precisely that argument
// (see BEND_MAX in wash.lesson.js, which is 0 for this reason). So the moment a
// lesson flattens its cards, metric (1) becomes VACUOUS there - it cannot report
// anything but zero, however bad the picture is. `measureStacking` reports the
// max card-plane TILT alongside its numbers so this vacuity is visible instead
// of being mistaken for a fix.
//
// WHAT THE VIEWER ACTUALLY SEES, given that cards render as ZERO-THICKNESS
// planes (src/card/Card.jsx: two coincident single-sided meshes, CARD_T exists
// only in the collision maths). With no thickness there is no edge, no side, and
// cards do not cast onto each other - so the ONLY cue that card A is on top of
// card B is that A occludes B. Two consequences:
//
//   * A pair separated by a small fraction of CARD_T is visually COPLANAR. It is
//     not "a card resting on a card", it is one flat sheet, and which of the two
//     wins a given pixel is decided by depth-buffer quantisation and draw order
//     (Card.jsx sets renderOrder = stackIndex, frozen at mount, so it does NOT
//     track the height order a lesson gives its cards).
//   * The instant an overlapping pair's heights CROSS, the occlusion flips. With
//     thickness that is a card sliding over a card; with zero thickness it is
//     indistinguishable from a card sliding THROUGH one, because there is no
//     intermediate state to see. That flip is what `swaps` counts, and it is the
//     defect a user describes as "the cards intersect each other".
// ===========================================================================
//
// ===========================================================================
// WHY POINT-IN-VOLUME SAMPLING CANNOT FIND THIS, which is how the first attempt
// at this measurement reported 0.2mm across the whole catalog and called it fine
// while a screenshot of the wash showed hard seams everywhere.
//
// That probe sampled a 3x3 grid on each card's mid-surface and asked whether any
// sample was inside another card's slab. A card is 63.5 x 88.9mm and CARD_T is
// 0.003wu = 0.30mm THICK. Grid points 31mm apart cannot detect a 0.3mm slab
// crossed at an angle: two cards meeting in an X pass cleanly BETWEEN the
// samples. Refining the grid does not fix it either - the measure-zero set you
// are trying to hit stays measure zero, you just pay more for the same miss.
//
// THE RIGHT TEST FOR THIN PLATES IS EDGE VERSUS FACE. Two rectangles in 3-space
// interpenetrate if and only if an edge of one crosses the other's surface
// inside that surface's extents. That is a codimension-1 condition on a
// 1-parameter curve, so a polyline of a dozen samples along each edge finds it
// robustly instead of by luck.
//
// CARDS BEND, so "the other's plane" is not a plane. The bend shader maps local
// (x, y, 0) -> (x, sin(y*b)/b, (1 - cos(y*b))/b), a cylindrical shell of radius
// 1/b about an axis parallel to local X. Both sides of the test respect that:
// A's edges are sampled THROUGH that mapping (so a bowed card's long edges are
// arcs, not chords), and B's surface is evaluated with `cardSurfaceExtents`, the
// same shell geometry `cardDepth` and the contact metric use. Testing bent cards
// as flat rectangles invents crossings where two bowed cards nest, and misses
// the ones where a bow lifts an end through a neighbour.
//
// ONE THING IS DERIVED HERE RATHER THAN IMPORTED, and it has to be.
// `cardSurfaceExtents` returns `n` = |distance off the shell| - CARD_T/2, an
// UNSIGNED distance through the thickness. A crossing IS a sign change, so an
// unsigned reading cannot see one. `signedNormal` below recovers the sign from
// the same shell parameters, and `selfTest()` asserts the two agree to 1e-12 on
// random points of random bows, so this file cannot silently drift from the
// geometry the rest of the engine uses.
// ===========================================================================
//
// UNITS. Every depth is printed in CARD THICKNESSES beside its world value.
// CARD_T is 0.003wu = 0.30mm and a whole 52-card deck is 0.156wu tall, so a
// figure like 0.02 is not "small", it is seven cards deep - two thirds of the
// way through half a deck. This convention is `verifyTracks`' and it exists
// because a whole session was spent dismissing 0.0142 as negligible.
//
// Usage:
//   node --import ./scripts/verify/register.mjs scripts/inspect/cardClip.mjs
//   ... --lessons wash,riffle    only these
//   ... --per-step 24            frames sampled inside each step (default 16)
//   ... --hist                   distributions of angle / depth / length, which
//                                is how the DEFECT thresholds below were chosen
//   ... --fps 60                 frame rate for the STACKING pass (swaps are
//                                between-frame events, so this one needs real
//                                consecutive frames, not per-step samples)
//   ... --no-stacking            crossing pass only, for a fast run
import * as THREE from 'three'
import { pathToFileURL } from 'node:url'
import { LESSONS } from '../../src/lessons/catalog/index.js'
import { compileLesson } from '../../src/lessons/engine/compileLesson.js'
import { sampleTrack } from '../../src/lessons/engine/sampleTrack.js'
import { createDeck } from '../../src/deckModel.js'
import { cardSurfaceExtents } from '../../src/lessons/authoring/contacts.js'
import { CARD_W, CARD_H, CARD_T } from '../../src/lib/constants.js'

const HALF_X = CARD_W / 2
const HALF_Y = CARD_H / 2
const HALF_Z = CARD_T / 2
// Bound for cheap pair rejection. The bend mapping SHORTENS a card along its
// long axis (|sin(yb)/b| <= |y|) and swings the ends by less than it shortens,
// so the flat corner radius bounds every bow too.
const CARD_RADIUS = Math.hypot(HALF_X, HALF_Y, HALF_Z)
const PAIR_REACH = (2 * CARD_RADIUS) ** 2

// ---------------------------------------------------------------------------
// WHAT COUNTS AS A DEFECT, AND WHAT IS BY DESIGN.
//
// CARD_GAP (0.003) EQUALS CARD_T (0.003), so cards in a squared stack are
// exactly flush with ZERO clearance, and a heap is looser still. Neighbours
// touching, or grazing by a fraction of a card thickness, is the intended look
// of a deck and must not be reported. One fact makes that separation free:
//
//   A STACK IS EXACTLY PARALLEL. Every card in the deck, the heap and the
//   squared pile shares one normal - `faceQuat(false, yaw)` yaws about WORLD UP,
//   which leaves two face-down cards coplanar - and parallel surfaces have no
//   sign change. A flush stack therefore produces literally ZERO crossings from
//   this test, with no threshold involved. Confirmed empirically: the wash's
//   `square` and `rest` steps, which are nothing but a 52-card flush stack,
//   report 0 crossings while every spread step reports thousands.
//
// So the raw crossing count is already free of the by-design case, and a
// crossing is called a DEFECT when both of these hold:
//
//   DEPTH >= CARD_T  One full card thickness past the other card's mid-surface,
//                    which puts the crossing edge CARD_T/2 clear of the far
//                    FACE - genuinely through it rather than resting in it.
//                    Below this the two cards are in contact, which real cards
//                    on a table are.
//   LENGTH >= 0.05   ~5mm of edge on the far side. Visibility scales with the
//                    length of the seam; under a twelfth of a card's width the
//                    corner is nicking a neighbour. This is the threshold with
//                    the most judgement in it and the one to lower if a fix
//                    looks clean by the numbers and wrong on screen.
//
// A MINIMUM ANGLE BETWEEN THE NORMALS WAS THE OBVIOUS THIRD CRITERION AND IT IS
// WRONG. It was tried at 4 degrees and it discarded 98% of the real defect, so
// the number is recorded rather than the rule. Measured over the whole catalog,
// the WORST crossing angle anywhere is 6 degrees and 90% of crossings are under
// 4, for the same reason the parallel argument above works: a yaw cannot tilt a
// face-down card, so the ONLY source of angular divergence in the wash is the
// bend, and +-0.14 rad over CARD_H/2 is +-3.6 degrees at the very end of a card.
//
// The user's phrase was "hard straight seams", and a shallow crossing is exactly
// what produces one: two nearly-parallel surfaces meet in a LONG straight line,
// so the shallower the angle the more seam there is to see. An angle gate would
// have filtered out precisely the thing being complained about while reporting
// the catalog clean. `worst angle` is still printed, as information.
//
// What the gate DOES exclude, stated plainly: a corner poking under a card
// thickness through a neighbour, and any crossing shorter than 5mm. Both are
// hairlines at the app's framing; neither is what the screenshot shows. Both are
// still counted in the RAW columns, which is where to look if this ever seems
// too generous.
export const DEFECT = { depth: CARD_T, length: 0.05 }

// Samples per card edge, measured rather than picked. Swept on the pre-fix wash:
//
//   segs   worst depth        worst seam   crossing pair-frames
//    6     0.0114 (-1.7%)     44.3mm       51147 (-10%)
//   12     0.0116             43.7mm       56791
//   24     0.0116  (0.0%)     44.3mm       59530 (+4.8%)
//
// The two numbers the gate reads - worst DEPTH and worst LENGTH - are converged
// at 12 (depth identical to 24, length within 1.4%). The PAIR COUNT is not
// converged and never will be: a finer polyline keeps finding more marginal
// crossings, so it is a census at a fixed sampling density rather than a limit.
// That is why it is gated at a fixed EDGE_SEGS and read as an indicator.
const EDGE_SEGS = 12

// --- Shell geometry ---------------------------------------------------------

// A point on a card's bent mid-surface, in the card's own frame.
function shellPoint(x, y, bend, out) {
  if (Math.abs(bend) <= 1e-4) return out.set(x, y, 0)
  return out.set(x, Math.sin(y * bend) / bend, (1 - Math.cos(y * bend)) / bend)
}

// The outward surface normal at that point, in the card's own frame. The shell's
// tangent along the long axis is (cos t, sin t) in (y, z) for t = y*bend, so the
// normal is (-sin t, cos t) - which reduces to +z for a flat card.
function shellNormal(y, bend, out) {
  if (Math.abs(bend) <= 1e-4) return out.set(0, 0, 1)
  const t = y * bend
  return out.set(0, -Math.sin(t), Math.cos(t))
}

// SIGNED distance from a card-local point to that card's mid-surface: positive
// on the +z side, negative on the -z side. This is the piece `cardSurfaceExtents`
// cannot supply (its `n` is unsigned) and the only thing a crossing test needs
// that the engine does not already export. `selfTest` pins the two together.
function signedNormal(local, bend) {
  if (Math.abs(bend) <= 1e-4) return local.z
  const R = 1 / bend
  const r = Math.hypot(local.y, local.z - R)
  return -Math.sign(R) * (r - Math.abs(R))
}

const _stx = new THREE.Vector3()
// Assert the derived sign agrees with the engine's unsigned magnitude. Runs on
// every invocation; it is 400 evaluations and it is the reason this file may be
// trusted against `contacts.js`.
function selfTest() {
  let a = 12345
  const rnd = () => {
    a = (a * 1103515245 + 12345) & 0x7fffffff
    return a / 0x7fffffff
  }
  let worst = 0
  for (let i = 0; i < 400; i++) {
    const bend = (rnd() - 0.5) * 0.8
    _stx.set((rnd() - 0.5) * 2 * CARD_W, (rnd() - 0.5) * 2 * CARD_H, (rnd() - 0.5) * 0.4)
    const e = cardSurfaceExtents(_stx, bend)
    const d = Math.abs(Math.abs(signedNormal(_stx, bend)) - HALF_Z - e.n)
    if (d > worst) worst = d
  }
  if (!(worst < 1e-12)) {
    throw new Error(`cardClip: signedNormal disagrees with cardSurfaceExtents by ${worst}`)
  }
  return worst
}

// --- Known-answer scenarios -------------------------------------------------
// The previous attempt at this measurement was WRONG and reported the catalog
// clean, so this one is checked against configurations whose answer is known in
// closed form before it is believed about anything.
//
//   1. A flush parallel STACK must report ZERO. This is the by-design case, and
//      a probe that fires on it is useless as a gate.
//   2. An X CROSSING at a known tilt must report the closed-form depth, length
//      and angle. Card A is rotated by t about the axis along B's width and slid
//      0.01 inboard, so exactly one of A's long edges lies over B and exactly one
//      of B's lies over A - TWO ordered crossings, since this test is asymmetric
//      by construction and each direction is a separate reading. Either edge runs
//      (const, y*cos t, y*sin t) in the other's frame, so its signed distance is
//      y*sin t: depth (CARD_H/2)*sin t on each side, length CARD_H/2, angle t.
//   3. TWO EQUAL BOWS stacked along their own NORMAL must report ZERO. Equal
//      circles offset radially meet only near their equators, ~90deg round, and a
//      card spans just (CARD_H/2)*b = 3.6deg of arc. A flat-rectangle test
//      invents a crossing here, because it sees two chords at an angle.
//   4. TWO OPPOSITE BOWS stacked the same CARD_T apart MUST report a crossing,
//      and this is the wash's actual failure mode. Their quaternions are
//      IDENTICAL, so a flat-plane model sees two parallel planes CARD_T apart and
//      reports them clean; the shells cross because the bows differ. This is the
//      case that makes modelling the bend mandatory rather than tidy.
const SCENARIO_TILT = 0.2
function scenarioTest() {
  const card = (id, pos, quat, bend = 0) => [id, { pos: new THREE.Vector3(...pos), quat, bend }]
  const flat = new THREE.Quaternion()
  const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(SCENARIO_TILT, 0, 0))
  const run = (entries) => {
    const f = new Frame(entries.length)
    f.load(entries)
    const out = []
    for (let a = 0; a < f.n; a++) {
      for (let b = 0; b < f.n; b++) {
        if (a === b) continue
        const c = pairCrossing(f, a, b)
        if (c) out.push(c)
      }
    }
    return out
  }
  const near = (got, want, tol, what) => {
    if (Math.abs(got - want) > tol) throw new Error(`cardClip scenario: ${what} got ${got}, want ${want}`)
  }
  const stack = run([card('a', [0, 0, 0], flat), card('b', [0, CARD_T, 0], flat)])
  if (stack.length) throw new Error(`cardClip scenario: a flush stack reported ${stack.length} crossings`)
  const cross = run([card('a', [0.01, 0, 0], tilt), card('b', [0, 0, 0], flat)])
  if (cross.length !== 2) throw new Error(`cardClip scenario: X crossing reported ${cross.length} crossings, want 2`)
  for (const c of cross) {
    near(c.depth, (CARD_H / 2) * Math.sin(SCENARIO_TILT), 1e-9, 'X depth')
    near(c.length, CARD_H / 2, 1e-9, 'X length')
    near(c.angleDeg, (SCENARIO_TILT * 180) / Math.PI, 1e-9, 'X angle')
  }
  // Offset along the NORMAL (local +z at identity), which is what "stacked"
  // means. Offsetting along local Y instead slides one card along the other's
  // LENGTH, and two equal arcs slid along themselves genuinely do cross near
  // their midpoint - a correct reading that took a wrong scenario to explain.
  const same = run([card('a', [0, 0, 0], flat, 0.14), card('b', [0, 0, CARD_T], flat, 0.14)])
  if (same.length) throw new Error(`cardClip scenario: two equal bows stacked reported ${same.length} crossings`)
  const opp = run([card('a', [0, 0, 0], flat, 0.14), card('b', [0, 0, CARD_T], flat, -0.14)])
  if (!opp.length) throw new Error('cardClip scenario: two opposite bows CARD_T apart reported no crossing')
  const oppWorst = Math.max(...opp.map((c) => c.depth))
  return (
    `stack 0, X ${(cross[0].depth / CARD_T).toFixed(1)} cards over ${(cross[0].length * 100.8).toFixed(1)}mm ` +
    `at ${cross[0].angleDeg.toFixed(1)}deg, equal bows 0, opposite bows ${(oppWorst / CARD_T).toFixed(1)} cards`
  )
}

// --- Per-frame edge cache ---------------------------------------------------
// The four boundary edges of a card's mid-surface, as one flat polyline buffer
// per card: the two LONG edges (x = +-W/2, y sweeping, arcs under bend) and the
// two END edges (y = +-H/2, x sweeping, straight at any bend since y is fixed).
const EDGE_PTS = EDGE_SEGS + 1
const EDGE_COUNT = 4
const PTS_PER_CARD = EDGE_COUNT * EDGE_PTS

// Which (x, y) each buffer slot parameterises, filled once.
const EDGE_LOCAL = []
for (let e = 0; e < EDGE_COUNT; e++) {
  for (let i = 0; i < EDGE_PTS; i++) {
    const f = (i / EDGE_SEGS) * 2 - 1
    EDGE_LOCAL.push(e < 2 ? [e === 0 ? -HALF_X : HALF_X, f * HALF_Y] : [f * HALF_X, e === 2 ? -HALF_Y : HALF_Y])
  }
}

const _p = new THREE.Vector3()
const _n = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _lp = new THREE.Vector3()
const _ln = new THREE.Vector3()
const _cen = new THREE.Vector3()

class Frame {
  constructor(n) {
    this.n = 0
    this.id = new Array(n)
    this.pos = new Float64Array(n * 3)
    this.quat = new Float64Array(n * 4)
    this.bend = new Float64Array(n)
    this.pts = new Float64Array(n * PTS_PER_CARD * 3)
    this.nrm = new Float64Array(n * PTS_PER_CARD * 3)
  }

  // Snapshot a sampled scene into PLAIN NUMBERS. `sampleTrack` hands back reused
  // Vector3s and reused card objects, so anything that outlives one sample must
  // copy - this has produced false readings in this repo at least twice,
  // including a probe that reported all 52 wash cards frozen at exactly 0.000.
  // Takes anything iterable as [id, { pos, quat, bend }], which is what
  // `scene.cards` is and what `scenarioTest` hands it.
  load(entries) {
    let k = 0
    for (const [id, c] of entries) {
      this.id[k] = id
      this.pos[k * 3] = c.pos.x
      this.pos[k * 3 + 1] = c.pos.y
      this.pos[k * 3 + 2] = c.pos.z
      this.quat[k * 4] = c.quat.x
      this.quat[k * 4 + 1] = c.quat.y
      this.quat[k * 4 + 2] = c.quat.z
      this.quat[k * 4 + 3] = c.quat.w
      const bend = c.bend ?? 0
      this.bend[k] = bend
      _q.set(c.quat.x, c.quat.y, c.quat.z, c.quat.w)
      const base = k * PTS_PER_CARD * 3
      for (let s = 0; s < PTS_PER_CARD; s++) {
        const [lx, ly] = EDGE_LOCAL[s]
        shellPoint(lx, ly, bend, _p).applyQuaternion(_q).add(c.pos)
        shellNormal(ly, bend, _n).applyQuaternion(_q)
        this.pts[base + s * 3] = _p.x
        this.pts[base + s * 3 + 1] = _p.y
        this.pts[base + s * 3 + 2] = _p.z
        this.nrm[base + s * 3] = _n.x
        this.nrm[base + s * 3 + 1] = _n.y
        this.nrm[base + s * 3 + 2] = _n.z
      }
      k++
    }
    this.n = k
  }
}

// --- The test ---------------------------------------------------------------
// Per-edge scratch, so the inner loop allocates nothing.
const _sn = new Float64Array(EDGE_PTS)
const _in = new Uint8Array(EDGE_PTS)
// SIDE, not the sign of the product. `_sn[i] * _sn[i-1] < 0` looks equivalent and
// is not: a sample landing EXACTLY on the other card's surface makes the product
// 0 and hides the crossing, which is not a rare case but the SYMMETRIC one - the
// polyline has an odd number of points, so a card crossing another through its
// own centre puts a sample dead on the surface every time. It made the
// known-answer X scenario below report 0 crossings. Folding 0 into the +1 side
// keeps two genuinely COPLANAR cards (every sample exactly 0) reporting nothing,
// which is correct: coplanar is one surface, not a seam.
const _sd = new Int8Array(EDGE_PTS)

// Does any edge of card A cross card B's surface inside B's extents? Returns the
// worst crossing as { depth, length, angleDeg } or null.
//
//   depth   min over the two sides of (max |signed distance| among samples that
//           are laterally inside B). Taking the MINIMUM of the two sides is what
//           makes this "how far past B's surface A reaches": the deep side is
//           just A being a card, the shallow side is the bit that poked through.
//   length  min over the two sides of the polyline length inside B. This is the
//           number that tracks VISIBILITY - a seam is a line, and a crossing
//           that only clips a corner leaves a millimetre of it.
function pairCrossing(F, ai, bi) {
  const bx = F.pos[bi * 3]
  const by = F.pos[bi * 3 + 1]
  const bz = F.pos[bi * 3 + 2]
  const dx = F.pos[ai * 3] - bx
  const dy = F.pos[ai * 3 + 1] - by
  const dz = F.pos[ai * 3 + 2] - bz
  if (dx * dx + dy * dy + dz * dz > PAIR_REACH) return null
  const bend = F.bend[bi]
  _q.set(-F.quat[bi * 4], -F.quat[bi * 4 + 1], -F.quat[bi * 4 + 2], F.quat[bi * 4 + 3])
  const abase = ai * PTS_PER_CARD * 3
  let best = null
  for (let e = 0; e < EDGE_COUNT; e++) {
    let straddles = false
    for (let i = 0; i < EDGE_PTS; i++) {
      const o = abase + (e * EDGE_PTS + i) * 3
      _lp.set(F.pts[o] - bx, F.pts[o + 1] - by, F.pts[o + 2] - bz).applyQuaternion(_q)
      _sn[i] = signedNormal(_lp, bend)
      const ext = cardSurfaceExtents(_lp, bend)
      _in[i] = ext.x <= 0 && ext.u <= 0 ? 1 : 0
      _sd[i] = _sn[i] >= 0 ? 1 : -1
      if (i > 0 && _in[i] && _in[i - 1] && _sd[i] !== _sd[i - 1]) straddles = true
    }
    if (!straddles) continue
    // Accumulate each side separately: worst reach and total length, counting
    // only the stretches that are laterally over B's face.
    let dPos = 0
    let dNeg = 0
    let lPos = 0
    let lNeg = 0
    for (let i = 0; i < EDGE_PTS; i++) {
      if (!_in[i]) continue
      const s = Math.abs(_sn[i])
      if (_sd[i] > 0) {
        if (s > dPos) dPos = s
      } else if (s > dNeg) dNeg = s
      if (i === 0) continue
      if (!_in[i - 1]) continue
      const o = abase + (e * EDGE_PTS + i) * 3
      const q = o - 3
      const seg = Math.hypot(F.pts[o] - F.pts[q], F.pts[o + 1] - F.pts[q + 1], F.pts[o + 2] - F.pts[q + 2])
      // A segment spanning the surface splits between the sides by |s|.
      if (_sd[i] !== _sd[i - 1]) {
        const f = Math.abs(_sn[i - 1]) / (Math.abs(_sn[i - 1]) + Math.abs(_sn[i]))
        if (_sd[i - 1] > 0) {
          lPos += seg * f
          lNeg += seg * (1 - f)
        } else {
          lNeg += seg * f
          lPos += seg * (1 - f)
        }
      } else if (_sd[i] > 0) lPos += seg
      else lNeg += seg
    }
    const depth = Math.min(dPos, dNeg)
    const length = Math.min(lPos, lNeg)
    if (best && best.length >= length && best.depth >= depth) continue
    // Angle between the two surfaces at the crossing: A's normal at the deepest
    // sample of the shallow side against B's normal there. Acute, because a card
    // is two-sided and a 175 deg meeting looks exactly like a 5 deg one.
    let wi = 0
    let wd = -1
    const shallowPos = lPos <= lNeg
    for (let i = 0; i < EDGE_PTS; i++) {
      if (!_in[i]) continue
      if ((_sd[i] > 0) !== shallowPos) continue
      if (Math.abs(_sn[i]) > wd) {
        wd = Math.abs(_sn[i])
        wi = i
      }
    }
    const o = abase + (e * EDGE_PTS + wi) * 3
    _lp.set(F.pts[o] - bx, F.pts[o + 1] - by, F.pts[o + 2] - bz).applyQuaternion(_q)
    // B's own normal where A's edge lands, recovered from the shell parameters.
    const yB = Math.abs(bend) <= 1e-4 ? _lp.y : Math.atan2(_lp.y * Math.sign(bend), (1 / bend - _lp.z) * Math.sign(bend)) / bend
    shellNormal(yB, bend, _ln)
    _n.set(F.nrm[o], F.nrm[o + 1], F.nrm[o + 2]).applyQuaternion(_q)
    const dot = Math.min(1, Math.abs(_n.dot(_ln)))
    const angleDeg = (Math.acos(dot) * 180) / Math.PI
    if (!best || length > best.length || depth > best.depth) {
      best = { depth, length, angleDeg }
    }
  }
  return best
}

const blank = () => ({
  pairs: 0,
  defects: 0,
  worstDepth: 0,
  worstDepthAt: null,
  worstLength: 0,
  worstLengthAt: null,
  worstAngle: 0,
  peakDefectFrame: 0,
  peakDefectAt: 0,
})

function fold(acc, c, at) {
  acc.pairs++
  if (c.depth > acc.worstDepth) {
    acc.worstDepth = c.depth
    acc.worstDepthAt = at
  }
  if (c.length > acc.worstLength) {
    acc.worstLength = c.length
    acc.worstLengthAt = at
  }
  if (c.angleDeg > acc.worstAngle) acc.worstAngle = c.angleDeg
}

// Measure one compiled track. `perStep` frames inside every step; steps are the
// reporting unit because a lesson is authored per step and a fix lands on one.
export function measureClipping(track, opts = {}) {
  const perStep = opts.perStep ?? 16
  const hist = opts.hist ? { angle: [], depth: [], length: [] } : null
  const steps = (track.steps ?? []).length
    ? track.steps
    : [{ id: 'all', tStart: 0, tEnd: track.duration }]
  const frame = new Frame(64)
  const total = blank()
  const perStepOut = []
  // Defect-filtered totals, kept apart from the raw ones on purpose: the raw
  // count includes flush piles grazing themselves, which is by design.
  const filtered = blank()
  for (const step of steps) {
    const acc = blank()
    const facc = blank()
    for (let i = 0; i < perStep; i++) {
      // Interior samples only. Step boundaries are shared poses, so sampling
      // them double-counts and, worse, reports a crossing under the id of
      // whichever step happens to come first.
      const ms = step.tStart + ((step.tEnd - step.tStart) * (i + 0.5)) / perStep
      frame.load(sampleTrack(track, ms).cards)
      let frameDefects = 0
      for (let a = 0; a < frame.n; a++) {
        for (let b = 0; b < frame.n; b++) {
          if (a === b) continue
          const c = pairCrossing(frame, a, b)
          if (!c) continue
          const at = { ms, a: frame.id[a], b: frame.id[b] }
          fold(acc, c, at)
          fold(total, c, at)
          if (hist) {
            hist.angle.push(c.angleDeg)
            hist.depth.push(c.depth)
            hist.length.push(c.length)
          }
          if (c.depth >= DEFECT.depth && c.length >= DEFECT.length) {
            frameDefects++
            fold(facc, c, at)
            fold(filtered, c, at)
            acc.defects++
            total.defects++
          }
        }
      }
      if (frameDefects > acc.peakDefectFrame) {
        acc.peakDefectFrame = frameDefects
        acc.peakDefectAt = ms
      }
      if (frameDefects > total.peakDefectFrame) {
        total.peakDefectFrame = frameDefects
        total.peakDefectAt = ms
      }
    }
    perStepOut.push({ id: step.id, raw: acc, defect: facc })
    if (acc.peakDefectFrame > filtered.peakDefectFrame) {
      filtered.peakDefectFrame = acc.peakDefectFrame
      filtered.peakDefectAt = acc.peakDefectAt
    }
  }
  return { frames: steps.length * perStep, steps: perStepOut, raw: total, defect: filtered, hist }
}

// --- Coplanarity and top-card swaps -----------------------------------------
// See the second half of this file's header. Everything below asks about pairs
// that OVERLAP IN PLAN VIEW, which is the only pair a viewer can see one card
// through the other of.

// A card's plan-view footprint, as the four corners of its mid-surface projected
// onto the felt. Exact for a flat card, which is the only case this measurement
// claims to describe - a bowed card's footprint is not a quad, and a bowed card
// is `measureClipping`'s business anyway. `maxTiltDeg` below is what stops that
// caveat from being silent.
const _fq = new THREE.Quaternion()
const _fv = new THREE.Vector3()
const FOOT_LOCAL = [
  [-HALF_X, -HALF_Y],
  [HALF_X, -HALF_Y],
  [HALF_X, HALF_Y],
  [-HALF_X, HALF_Y],
]

function footprint(F, k, out) {
  _fq.set(F.quat[k * 4], F.quat[k * 4 + 1], F.quat[k * 4 + 2], F.quat[k * 4 + 3])
  for (let i = 0; i < 4; i++) {
    _fv.set(FOOT_LOCAL[i][0], FOOT_LOCAL[i][1], 0).applyQuaternion(_fq)
    out[i * 2] = _fv.x + F.pos[k * 3]
    out[i * 2 + 1] = _fv.z + F.pos[k * 3 + 2]
  }
}

const shoelace = (p) => {
  let s = 0
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length
    s += p[i][0] * p[j][1] - p[j][0] * p[i][1]
  }
  return s / 2
}

// Overlap AREA of two convex quads, by Sutherland-Hodgman. Area and not a
// boolean because the size of the overlap is the whole question: two cards
// sharing a 2mm corner sliver are not what anybody is complaining about, and a
// boolean test buries that pair with one sharing most of a face.
function overlapArea(a, b) {
  let poly = [
    [a[0], a[1]],
    [a[2], a[3]],
    [a[4], a[5]],
    [a[6], a[7]],
  ]
  let B = [
    [b[0], b[1]],
    [b[2], b[3]],
    [b[4], b[5]],
    [b[6], b[7]],
  ]
  if (shoelace(B) < 0) B = B.slice().reverse()
  for (let e = 0; e < 4 && poly.length; e++) {
    const p0 = B[e]
    const p1 = B[(e + 1) % 4]
    const ex = p1[0] - p0[0]
    const ez = p1[1] - p0[1]
    const next = []
    for (let i = 0; i < poly.length; i++) {
      const c = poly[i]
      const n = poly[(i + 1) % poly.length]
      const ci = ex * (c[1] - p0[1]) - ez * (c[0] - p0[0]) >= 0
      const ni = ex * (n[1] - p0[1]) - ez * (n[0] - p0[0]) >= 0
      if (ci) next.push(c)
      if (ci !== ni) {
        const dx = n[0] - c[0]
        const dz = n[1] - c[1]
        const den = ex * dz - ez * dx
        if (Math.abs(den) > 1e-15) {
          const t = (ex * (c[1] - p0[1]) - ez * (c[0] - p0[0])) / -den
          next.push([c[0] + dx * t, c[1] + dz * t])
        }
      }
    }
    poly = next
  }
  return poly.length ? Math.abs(shoelace(poly)) : 0
}

const CARD_AREA = CARD_W * CARD_H
// How much shared footprint makes a pair worth reporting. A 5%-of-a-face overlap
// is a 28mm x 10mm patch - big enough to read as one card lying on another, and
// well above the corner slivers that a spread produces by the hundred.
export const OVERLAP_MIN = 0.05 * CARD_AREA
// The depth buffer's own resolution, so "coplanar" has a number behind it rather
// than a feeling. Window-space depth for a perspective camera is
// z = (1/near - 1/d) / (1/near - 1/far), so the smallest world separation it can
// still tell apart at eye distance d is dz * d^2 * (1/near - 1/far). CanvasRoot
// runs near 0.1 / far 100 and the table sits about 2wu from the lens, which puts
// a 24-bit buffer at 2.4e-6wu (0.0008 CARD_T) and a 16-bit one at 6.1e-4wu (0.20
// CARD_T). So strict z-fighting needs a REALLY small gap on the 24-bit buffer
// three.js normally gets - which is why the bands below go down to a thousandth
// of a card thickness, and why the SWAP count matters more than the gap alone.
export const DEPTH_EPS_24 = (2 ** -24) * 2 * 2 * (1 / 0.1 - 1 / 100)
// A pair closer than this is not "stacked" in any sense a viewer would accept:
// two real cards that overlap are a full CARD_T apart, centre to centre.
export const STACK_BUDGET = { gap: CARD_T, swaps: 0 }

// `fps`, not `perStep`: a SWAP is an event BETWEEN two consecutive frames, so
// this has to walk the track at the rate the app actually presents it. Sampling
// a step's interior at 16 points cannot see a flip - it sees two unrelated
// orderings 190ms apart and has no way to tell a flip from a reshuffle.
export function measureStacking(track, opts = {}) {
  const fps = opts.fps ?? 60
  const minArea = opts.minArea ?? OVERLAP_MIN
  const dt = 1000 / fps
  const steps = (track.steps ?? []).length
    ? track.steps
    : [{ id: 'all', tStart: 0, tEnd: track.duration }]
  const dur = steps[steps.length - 1].tEnd
  const frame = new Frame(64)
  const foot = Array.from({ length: 64 }, () => new Float64Array(8))
  // Previous frame's sign of (yA - yB) per overlapping pair, keyed by index pair.
  // `sampleTrack` hands back the SAME card objects and Vector3s every call, so
  // nothing here may outlive a frame except these plain numbers.
  let prevSign = new Map()
  // CARDS WELDED TO THE SAME HOLD CANNOT SWAP, and without this the metric reports
  // a rigid rotation as catastrophe. A hold captures each card's offset ONCE, at
  // grip start, and projects it through the hand's frame thereafter - so two cards
  // in one hold are rigidly fixed relative to each other and physically cannot
  // cross. When such a stack is turned over (the charlier's flip beat rolls the
  // whole deck through 180 degrees in one grip), every pair's height order inverts
  // exactly once: measured 1326 swaps on a 52-card deck, which is exactly
  // C(52,2) - one clean inversion of the stack, not 1326 cards passing through
  // each other. Counting those describes the deck turning over, which is the thing
  // the beat is FOR.
  //
  // This is an exclusion, not a mask: the pair is still counted and its gap still
  // measured, only the SWAP is skipped, and only while both cards are provably
  // welded to one frame. A card released early (`release: 'stagger'`) leaves the
  // hold at its own release time and is fair game from then on.
  const holds = track.holds ?? []
  const weldedTogether = (idA, idB, ms) => {
    for (const h of holds) {
      if (ms < h.tStart || ms > h.tEnd) continue
      if (!h.offsets.has(idA) || !h.offsets.has(idB)) continue
      if (ms > (h.releases?.get(idA) ?? h.tEnd)) continue
      if (ms > (h.releases?.get(idB) ?? h.tEnd)) continue
      return true
    }
    return false
  }
  const perStepOut = new Map()
  const bump = (id, k, v = 1) => {
    if (!perStepOut.has(id)) {
      perStepOut.set(id, { id, frames: 0, pairs: 0, swaps: 0, swapArea: 0, minGap: Infinity, gapSum: 0 })
    }
    perStepOut.get(id)[k] += v
    return perStepOut.get(id)
  }
  const gaps = []
  const swapAreas = []
  let swaps = 0
  let pairs = 0
  let frames = 0
  let maxTilt = 0
  let minGap = Infinity
  let minGapAt = null
  let worstSwapAt = null
  let worstSwapArea = 0
  let si = 0
  for (let ms = 0; ms <= dur; ms += dt) {
    while (si < steps.length - 1 && ms >= steps[si].tEnd) si++
    const stepId = steps[si].id
    frame.load(sampleTrack(track, ms).cards)
    frames++
    const st = bump(stepId, 'frames')
    for (let k = 0; k < frame.n; k++) {
      footprint(frame, k, foot[k])
      // Deviation of this card's own plane from horizontal. `shellNormal(0)` is
      // the mid-surface normal, so this is the tilt the crossing test needs in
      // order to be able to report anything at all.
      _fq.set(frame.quat[k * 4], frame.quat[k * 4 + 1], frame.quat[k * 4 + 2], frame.quat[k * 4 + 3])
      shellNormal(0, frame.bend[k], _n).applyQuaternion(_fq)
      const tilt = (Math.acos(Math.min(1, Math.abs(_n.y))) * 180) / Math.PI
      if (tilt > maxTilt) maxTilt = tilt
    }
    const sign = new Map()
    for (let a = 0; a < frame.n; a++) {
      for (let b = a + 1; b < frame.n; b++) {
        const dx = frame.pos[a * 3] - frame.pos[b * 3]
        const dz = frame.pos[a * 3 + 2] - frame.pos[b * 3 + 2]
        if (dx * dx + dz * dz > PAIR_REACH) continue
        const area = overlapArea(foot[a], foot[b])
        if (area < minArea) continue
        const key = a * 64 + b
        const d = frame.pos[a * 3 + 1] - frame.pos[b * 3 + 1]
        const gap = Math.abs(d)
        pairs++
        gaps.push(gap)
        st.pairs++
        st.gapSum += gap
        if (gap < st.minGap) st.minGap = gap
        if (gap < minGap) {
          minGap = gap
          minGapAt = { ms, a: frame.id[a], b: frame.id[b], area }
        }
        const s = d > 0 ? 1 : d < 0 ? -1 : 0
        sign.set(key, s)
        const p = prevSign.get(key)
        if (p !== undefined && s !== 0 && p !== 0 && s !== p && !weldedTogether(frame.id[a], frame.id[b], ms)) {
          swaps++
          swapAreas.push(area)
          st.swaps++
          st.swapArea += area
          if (area > worstSwapArea) {
            worstSwapArea = area
            worstSwapAt = { ms, a: frame.id[a], b: frame.id[b], area }
          }
        }
      }
    }
    prevSign = sign
  }
  const pct = (arr, q) => {
    if (!arr.length) return 0
    const s = arr.slice().sort((x, y) => x - y)
    return s[Math.min(s.length - 1, Math.floor(q * s.length))]
  }
  const under = (t) => gaps.filter((g) => g < t * CARD_T).length
  return {
    fps,
    frames,
    durationMs: dur,
    maxTiltDeg: maxTilt,
    pairs,
    pairsPerFrame: pairs / Math.max(1, frames),
    minGap,
    minGapAt,
    gapPct: { p1: pct(gaps, 0.01), p10: pct(gaps, 0.1), p50: pct(gaps, 0.5) },
    under: { e3: under(0.001), e2: under(0.01), tenth: under(0.1), half: under(0.5), one: under(1) },
    swaps,
    swapsPerSec: swaps / Math.max(1, dur / 1000),
    swapAreaPct: { p50: pct(swapAreas, 0.5), max: worstSwapArea },
    bigSwaps: swapAreas.filter((a) => a > 0.25 * CARD_AREA).length,
    worstSwapAt,
    steps: [...perStepOut.values()],
  }
}

// --- CLI -------------------------------------------------------------------

const cards = (v) => `${v.toFixed(4)} = ${(v / CARD_T).toFixed(1)} cards`
const mm = (v) => `${(v * 100.8).toFixed(1)}mm`
const where = (at) => (at ? `${at.a} x ${at.b} @ ${at.ms.toFixed(0)}ms` : '-')

function report(id, m) {
  console.log(`lesson: ${id}   (${m.frames} frames, defect gate: depth >= ${cards(DEFECT.depth)} AND length >= ${mm(DEFECT.length)})`)
  console.log(
    `  DEFECT  pair-frames ${m.defect.pairs}, worst depth ${cards(m.defect.worstDepth)} (${where(m.defect.worstDepthAt)}), ` +
      `worst length ${mm(m.defect.worstLength)} (${where(m.defect.worstLengthAt)}), peak ${m.defect.peakDefectFrame} pairs in one frame @ ${m.defect.peakDefectAt.toFixed(0)}ms`,
  )
  console.log(
    `  raw     pair-frames ${m.raw.pairs}, worst depth ${cards(m.raw.worstDepth)}, worst length ${mm(m.raw.worstLength)}, worst angle ${m.raw.worstAngle.toFixed(0)}deg`,
  )
  const rows = m.steps.filter((s) => s.raw.pairs > 0)
  if (!rows.length) {
    console.log('  no crossings in any step')
    return
  }
  console.log('  step            defects  worstDepth        worstLen   rawPairs  worst pair')
  for (const s of rows) {
    console.log(
      `  ${s.id.padEnd(14)}  ${String(s.raw.defects).padStart(7)}  ${cards(s.defect.worstDepth).padEnd(17)} ${mm(s.defect.worstLength).padStart(8)}  ${String(s.raw.pairs).padStart(8)}  ${where(s.defect.worstDepthAt || s.raw.worstDepthAt)}`,
    )
  }
}

const facePct = (a) => `${((a / CARD_AREA) * 100).toFixed(0)}% of a face`

function reportStacking(id, s) {
  console.log(
    `  STACKING (${s.frames} frames at ${s.fps}fps over ${(s.durationMs / 1000).toFixed(1)}s; ` +
      `overlap gate ${((OVERLAP_MIN / CARD_AREA) * 100).toFixed(0)}% of a card face)`,
  )
  // Printed FIRST and unconditionally: if this is ~0 the crossing numbers above
  // are an identity, not a result, and every reading of this file should start by
  // knowing which of those it is looking at.
  console.log(
    `    max card-plane tilt ${s.maxTiltDeg.toFixed(3)}deg` +
      (s.maxTiltDeg < 0.01
        ? '  -- CARDS ARE PARALLEL, so the CROSSING numbers above are ZERO BY CONSTRUCTION'
        : ''),
  )
  console.log(`    overlapping pairs ${s.pairs} (${s.pairsPerFrame.toFixed(0)}/frame)`)
  console.log(
    `    gap between overlapping cards: min ${cards(s.minGap)} (${where(s.minGapAt)}), ` +
      `p1 ${cards(s.gapPct.p1)}, p10 ${cards(s.gapPct.p10)}, median ${cards(s.gapPct.p50)}`,
  )
  console.log(
    `    pairs closer than  0.001T ${s.under.e3}   0.01T ${s.under.e2}   0.1T ${s.under.tenth}   ` +
      `0.5T ${s.under.half}   1T ${s.under.one}  (24-bit depth resolves ${(DEPTH_EPS_24 / CARD_T).toFixed(4)}T)`,
  )
  console.log(
    `    TOP-CARD SWAPS ${s.swaps} = ${s.swapsPerSec.toFixed(1)}/s;  ` +
      `${s.bigSwaps} over >1/4 of a face;  median swap overlap ${facePct(s.swapAreaPct.p50)};  worst ${where(s.worstSwapAt)} (${facePct(s.swapAreaPct.max)})`,
  )
  const rows = s.steps.filter((r) => r.pairs > 0)
  if (!rows.length) return
  console.log('    step            swaps    /s     minGap        meanGap    pairs/frame')
  for (const r of rows) {
    const secs = r.frames / s.fps
    console.log(
      `    ${r.id.padEnd(14)} ${String(r.swaps).padStart(6)} ${(r.swaps / Math.max(secs, 1e-9)).toFixed(1).padStart(6)}  ` +
        `${cards(r.minGap === Infinity ? 0 : r.minGap).padEnd(17)} ${cards(r.gapSum / r.pairs).padEnd(17)} ${(r.pairs / r.frames).toFixed(0)}`,
    )
  }
}

function histogram(label, vals, edges, fmt) {
  if (!vals.length) return
  const counts = new Array(edges.length + 1).fill(0)
  for (const v of vals) {
    let k = 0
    while (k < edges.length && v >= edges[k]) k++
    counts[k]++
  }
  const parts = counts.map((c, i) => `${i === 0 ? '<' + fmt(edges[0]) : i === edges.length ? '>=' + fmt(edges[edges.length - 1]) : fmt(edges[i - 1]) + '-' + fmt(edges[i])}: ${c}`)
  console.log(`  ${label}  ${parts.join('  ')}`)
}

function main() {
  const argv = process.argv.slice(2)
  const arg = (k, d) => {
    const i = argv.indexOf(k)
    return i >= 0 ? argv[i + 1] : d
  }
  const only = arg('--lessons', '')
    .split(',')
    .filter(Boolean)
  const perStep = Number(arg('--per-step', 16))
  const hist = argv.includes('--hist')
  // The stacking pass walks the track at a real frame rate, so it costs more than
  // the crossing pass. It is on by DEFAULT anyway: a silent coplanarity number is
  // how the wash came to report a hard zero while the user was still looking at
  // cards inside each other. `--no-stacking` is there for a fast crossing-only run.
  const stacking = !argv.includes('--no-stacking')
  const fps = Number(arg('--fps', 60))
  console.log(`cardClip: EDGE-vs-FACE, ${EDGE_SEGS} samples per card edge; signedNormal agrees with cardSurfaceExtents to ${selfTest().toExponential(1)}`)
  console.log(`  known-answer scenarios: ${scenarioTest()}`)
  for (const lesson of LESSONS) {
    if (only.length && !only.includes(lesson.id)) continue
    const track = compileLesson(lesson, createDeck())
    const m = measureClipping(track, { perStep, hist })
    report(lesson.id, m)
    if (m.hist) {
      histogram('angle(deg) ', m.hist.angle, [1, 2, 4, 10, 30, 60], (v) => String(v))
      histogram('depth(cards)', m.hist.depth.map((d) => d / CARD_T), [0.5, 1, 2, 5, 20], (v) => String(v))
      histogram('length(mm) ', m.hist.length.map((l) => l * 100.8), [1, 5, 20, 50], (v) => String(v))
    }
    if (stacking) reportStacking(lesson.id, measureStacking(track, { fps }))
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
