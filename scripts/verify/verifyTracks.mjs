// Headless verification of every lesson's compiled track: purity (bidirectional
// scrub safety), NaN/normalization hygiene, and motion continuity. Thresholds
// are sanity-level for the catalog at large and tightened per-flagship as the
// finger-driven system lands.
//
// Run: node --import ./scripts/verify/register.mjs scripts/verify/verifyTracks.mjs
import * as THREE from 'three'
import { LESSONS } from '../../src/lessons/catalog/index.js'
import { compileLesson } from '../../src/lessons/engine/compileLesson.js'
import { sampleTrack } from '../../src/lessons/engine/sampleTrack.js'
import { createDeck } from '../../src/deckModel.js'
import { FINGER_NAMES, FINGERS, HAND_SCALE } from '../../src/hands/handRigSpec.js'
import { fingertipWorld, fingerJointsWorld, GRIP_FRAME_TYPES } from '../../src/hands/handKinematics.js'
import { cardSurfaceExtents } from '../../src/lessons/authoring/contacts.js'
import { CARD_W, CARD_H, CARD_T } from '../../src/lib/constants.js'

let failures = 0
let checks = 0
const fail = (msg) => {
  failures++
  console.error(`  ✗ ${msg}`)
}
const check = (ok, msg) => {
  checks++
  if (!ok) fail(msg)
}

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Serialize a sample into plain numbers IMMEDIATELY, sampleTrack reuses
// cached output objects per card id, so holding references across samples
// silently reads the LAST sample (an earlier version of this harness fell for it).
function snapshot(scene) {
  const rows = []
  for (const [id, c] of scene.cards) {
    rows.push(id, c.pos.x, c.pos.y, c.pos.z, c.quat.x, c.quat.y, c.quat.z, c.quat.w, c.bend)
  }
  for (const side of ['left', 'right']) {
    const h = scene.hands[side]
    if (!h) {
      rows.push(side, null)
      continue
    }
    rows.push(side, h.wrist.pos.x, h.wrist.pos.y, h.wrist.pos.z)
    rows.push(h.wrist.quat.x, h.wrist.quat.y, h.wrist.quat.z, h.wrist.quat.w, h.spread)
    for (const f of FINGER_NAMES) rows.push(...h.fingers[f])
  }
  return rows
}

function assertFinite(scene, label) {
  for (const [id, c] of scene.cards) {
    const vals = [c.pos.x, c.pos.y, c.pos.z, c.quat.x, c.quat.y, c.quat.z, c.quat.w, c.bend]
    check(vals.every(Number.isFinite), `${label}: card ${id} non-finite`)
    const n = Math.hypot(c.quat.x, c.quat.y, c.quat.z, c.quat.w)
    check(Math.abs(n - 1) < 1e-6, `${label}: card ${id} quat |q|=${n.toFixed(8)}`)
  }
  for (const side of ['left', 'right']) {
    const h = scene.hands[side]
    if (!h) continue
    const vals = [h.wrist.pos.x, h.wrist.pos.y, h.wrist.pos.z, h.wrist.quat.x, h.wrist.quat.y, h.wrist.quat.z, h.wrist.quat.w, h.spread]
    for (const f of FINGER_NAMES) vals.push(...h.fingers[f])
    check(vals.every(Number.isFinite), `${label}: hand ${side} non-finite`)
    const n = Math.hypot(h.wrist.quat.x, h.wrist.quat.y, h.wrist.quat.z, h.wrist.quat.w)
    check(Math.abs(n - 1) < 1e-4, `${label}: hand ${side} quat |q|=${n.toFixed(8)}`)
  }
}

// The felt is the plane y=0 and no card corner may ever poke through it
// (sampleTrack's clampAboveFelt guarantees ≥0.012; assert with float slop).
//
// A BOWED card is NOT the flat rectangle this used to measure. The bend shader
// maps local (x, y, 0) to (x, sin(y·b)/b, (1 − cos(y·b))/b): the card shortens
// along its long axis and its ends swing toward local +Z. `1 − cos` never
// changes sign, so that swing is one-directional, on a face-down card local
// +Z points at world −Y and the ends curl straight DOWN. This assertion used
// the same flat model as the clamp it was checking, so the two agreed with
// each other while the riffle bridge sat 0.22 and the waterfall arch 0.29
// below the table, a third of a card length buried, on more than half the
// sampled frames of half the catalog. Measure the TRUE bowed geometry.
const _aw = new THREE.Vector3()
const _al = new THREE.Vector3()
const _an = new THREE.Vector3()
function assertAboveFelt(scene, label) {
  for (const [id, c] of scene.cards) {
    _aw.set(1, 0, 0).applyQuaternion(c.quat)
    _al.set(0, 1, 0).applyQuaternion(c.quat)
    let halfLen = CARD_H / 2
    let bowDrop = 0
    const b = c.bend
    if (Math.abs(b) > 1e-4) {
      const half = (CARD_H / 2) * b
      halfLen = Math.abs(Math.sin(half) / b)
      _an.set(0, 0, 1).applyQuaternion(c.quat)
      const bow = (1 - Math.cos(half)) / b // signed: ends travel 0 → bow along +Z
      bowDrop = Math.max(0, -_an.y * bow) // only counts while that points down
    }
    const lowest = c.pos.y - (Math.abs(_aw.y) * (CARD_W / 2) + Math.abs(_al.y) * halfLen + bowDrop)
    check(lowest > 0.0115, `${label}: card ${id} pokes through the felt (lowest ${lowest.toFixed(4)}, bend ${b.toFixed(2)})`)
  }
}

// Fingers must TOUCH cards, never pass THROUGH them. Every phalange capsule of
// every finger is tested against every card's oriented box (card local frame:
// x = width, y = long axis, z = face normal). Depth 0 means exactly tangent -
// resting ON the card, which is what a correct grip looks like; positive means
// the geometry is interpenetrating.
//
// CEILING: a card is only CARD_T thick, so the deepest reading this metric can
// EVER produce is CARD_T/2 + the fattest phalange radius -- a thumb-proximal
// capsule centred inside a card. With a real card (CARD_T 0.003) and the
// anatomical rig (thumb proximal 24mm diameter, so 0.119 wu of radius) that is
// 0.0015 + 0.119 = 0.1205. Any budget >= 0.1205 therefore CANNOT FAIL.
// (The figure quoted here was 0.0812 and its arithmetic never added up even for
// the rig it was written against; recomputed rather than carried forward.)
//
// RATCHET: the budgets below are seeded at the values measured the day this
// assertion landed, so a clean checkout passes. They only ever go DOWN, never
// up. Entries marked "at the ceiling" are non-binding by the paragraph above:
// for those lessons a green suite proves NOTHING, the finger geometry is still
// buried inside the cards, and the live signal is the "max finger-in-card"
// number printed per lesson in the summary line below. As each lesson is
// re-authored onto the contact system, read that printed number and lower this
// entry to just above it. The target is under 0.005 everywhere (skin-deep
// contact); until a lesson's budget is under 0.005, that lesson is NOT fixed.
// ===========================================================================
// RE-BASELINED ONCE, when the rig's finger geometry was corrected to anatomy
// (handRigSpec.js). Every number in BOTH tables below had been calibrated
// against a rig whose fingers were 1.38-1.53x too THICK with spherical
// fingertips, and this metric charges a full capsule radius the moment a pad
// centre enters a card's slab -- so the old budgets measured a systematically
// inflated quantity, and clearing an over-fat capsule left a geometric margin
// that silently absorbed the idle overlay. Both effects went away with the fat.
//
// The "only ever DOWN" rule holds from that baseline. Correcting the geometry
// cut measured penetration by 2-2.5x on the lessons that carried raised budgets:
//   riffle  0.0440 -> 0.0203      charlier  0.0355 -> 0.0162
//   overhand 0.0276 -> 0.0016     (its braced thumb was passing through the deck)
//
// Trimmed with the catalog: the hindu, strip, waterfall and faro entries went
// with their lessons. Their reasoning is preserved in git and in
// TECHNIQUE_REFERENCE.md; keeping dead ratchet rows here only invites someone to
// tune against a lesson that no longer exists.
// ===========================================================================
const PENETRATION_BUDGET = {
  default: 0.085,
  wash: 0.002, // measured 0.0000, re-authored onto contact-height anchors
  // RATCHETED DOWN from 0.021, and the raise it is coming down from is worth
  // keeping in view. It was raised when CARD_T/CARD_GAP were corrected to a real
  // card: poses solved against the old, taller stack re-solved lower and the
  // drawing hand's middle pad grazed the deck by 0.0201.
  //
  // Most of that 0.0201 was never real. The penetration rule measured depth past
  // the NEAREST FACE PLANE, which over-charges every edge and corner contact
  // (outside across two axes it bills r - max(ex,ey) where the truth is
  // r - hypot(ex,ey)), and a pad grazing a card's EDGE is precisely that case.
  // With true sphere-vs-shell depth the same contact measures 0.0079 - and the
  // solved poses improved too, because `resolvePenetration` had been acting on
  // the same wrong number and backing fingers off edges harder than warranted.
  //
  // Still above the 0.005 target, and this lesson is still queued to be
  // RE-MODELLED (its top peel is the wrong move; see TECHNIQUE_REFERENCE.md), so
  // the remaining 0.0079 is expected to go with the re-model rather than be tuned.
  overhand: 0.009, // measured 0.0079
  // (was 0.0016 before the card correction, via the holding cradle's thumb
  // `tighten` coming down 0.05 -> 0.012 and its idle to 0.3: that thumb is
  // seated TANGENT on the deck's near end face, so every radian of squeeze on
  // top is penetration by construction.)
  charlier: 0.017, // measured 0.0162 (was 0.0355 on the over-fat rig)
  // Real contact grazes: flesh compresses and capsules do not, so a pad
  // genuinely ON a card reads as a small overlap here. This is raised as the
  // deliberate price of contact, and the contact it buys is asserted from below
  // by CONTACT_FLOOR. Well under the 0.0812 ceiling, so still binding.
  // The riffle is TABLED again, on user feedback (see CONTACT_FLOOR for the full
  // note). Unchanged at 0.017 and still binding: the tabled rebuild measures 0.0135,
  // which is tighter than the in-hands version's 0.0162 that this budget was set for.
  riffle: 0.017, // measured 0.0135
}

const CARD_HX = CARD_W / 2
const CARD_HY = CARD_H / 2
const CARD_HZ = CARD_T / 2
const CARD_RADIUS = Math.hypot(CARD_HX, CARD_HY, CARD_HZ) // bound for cheap rejects
const PHALANGE = ['proximal', 'middle', 'distal']
const CAPSULE_SAMPLES = 3 // both ends + the midpoint of each phalange
// FINGERS[].rad is in UNSCALED rig units; the rig renders under HAND_SCALE.
const PHALANGE_RAD = {}
const FINGER_MAX_RAD = {}
for (const name of FINGER_NAMES) {
  PHALANGE_RAD[name] = FINGERS[name].rad.map((r) => r * HAND_SCALE)
  FINGER_MAX_RAD[name] = Math.max(...PHALANGE_RAD[name])
}
// fingerJointsWorld requires a pre-allocated [knuckle, PIP, DIP, tip], allocate once.
const _pj = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
const _pc = new THREE.Vector3()
const _pp = new THREE.Vector3()
const _pl = new THREE.Vector3()
const _pq = new THREE.Quaternion()

// Returns this sample's worst penetration depth (feeds the ratchet print).
function assertNoPenetration(scene, label, budget) {
  let worstAll = 0
  for (const side of ['left', 'right']) {
    const pose = scene.hands[side]
    if (!pose) continue
    let worst = 0
    let where = ''
    for (const name of FINGER_NAMES) {
      fingerJointsWorld(pose, side, name, _pj)
      // Reject 1: one sphere around the whole finger vs each card's centre.
      _pc.copy(_pj[0]).add(_pj[3]).multiplyScalar(0.5)
      let fingerR = 0
      for (let i = 0; i < 4; i++) fingerR = Math.max(fingerR, _pc.distanceTo(_pj[i]))
      const reach = fingerR + FINGER_MAX_RAD[name] + CARD_RADIUS
      const reach2 = reach * reach
      for (const [id, c] of scene.cards) {
        const gx = c.pos.x - _pc.x
        const gy = c.pos.y - _pc.y
        const gz = c.pos.z - _pc.z
        if (gx * gx + gy * gy + gz * gz > reach2) continue
        _pq.set(-c.quat.x, -c.quat.y, -c.quat.z, c.quat.w) // unit quat ⇒ inverse = conjugate
        for (let s = 0; s < 3; s++) {
          const r = PHALANGE_RAD[name][s]
          const lim2 = (CARD_RADIUS + r) * (CARD_RADIUS + r)
          for (let k = 0; k < CAPSULE_SAMPLES; k++) {
            _pp.copy(_pj[s]).lerp(_pj[s + 1], k / (CAPSULE_SAMPLES - 1))
            const dx = _pp.x - c.pos.x
            const dy = _pp.y - c.pos.y
            const dz = _pp.z - c.pos.z
            if (dx * dx + dy * dy + dz * dz > lim2) continue // Reject 2, pre-transform
            _pl.set(dx, dy, dz).applyQuaternion(_pq)
            // TRUE geometry, bow included: a bent card is a cylindrical shell,
            // not the flat rectangle this test used to measure. See
            // cardSurfaceExtents. (assertAboveFelt already carried this fix;
            // this test did not, so on every bowed beat, the riffle bridge,
            // the waterfall arch, it was reporting depth against a rectangle
            // the cards had long since curled away from.)
            const e = cardSurfaceExtents(_pl, c.bend ?? 0)
            const ex = e.x
            const ey = e.u
            const ez = e.n
            if (ex > r || ey > r || ez > r) continue // clear of the card
            // TRUE sphere-vs-shell depth, not depth past the NEAREST FACE PLANE.
            // `min(-ex,-ey,-ez) + r` is right for a centre inside the shell or
            // outside across ONE axis, and over-charges every edge and corner:
            // outside across two axes it bills `r - max(ex,ey)` where the truth is
            // `r - hypot(ex,ey)`. Measured roughly DOUBLE on a real sample (0.021
            // against 0.010 true). It over-charged exactly the edge contacts this
            // catalog is moving to, and `resolvePenetration` in contacts.js acted
            // on the same wrong rule, so grips were being backed off harder than
            // the geometry warranted. Both sites fixed together, on purpose: they
            // have to agree or the harness and the authoring pass disagree about
            // what "touching" means.
            const ox = Math.max(ex, 0)
            const oy = Math.max(ey, 0)
            const oz = Math.max(ez, 0)
            const outside = Math.hypot(ox, oy, oz)
            const depth =
              outside > 0 ? Math.max(0, r - outside) : Math.min(-ex, -ey, -ez) + r
            if (depth > worst) {
              worst = depth
              where = `${side} ${name}[${PHALANGE[s]}] into card ${id}`
            }
          }
        }
      }
    }
    check(worst <= budget, `${label}: ${where} by ${worst.toFixed(4)} (budget ${budget})`)
    if (worst > worstAll) worstAll = worst
  }
  return worstAll
}

// ---------------------------------------------------------------------------
// THE OTHER HALF OF THE ASSERTION: are the hands actually TOUCHING?
//
// Everything above this line is one-sided. `resolvePenetration` works by backing
// a finger OFF until it is clear, shield cards add air on top, and pads used to
// be authored a whole squeeze-arc off their surfaces, so nothing in the
// pipeline, and nothing in this harness, ever stopped a grip from settling into
// a HOVER. It did: measured the day this assertion landed, six of the eight
// lessons had ZERO percent of their gripping fingertips within a card-thickness
// of the cards they were holding, and medians of 0.16–0.39 against a card
// 0.63 wide. A green suite meant "no finger is inside a card", which two
// mannequin hands a foot above the table also satisfy.
//
// So: during every hold, for the fingers that frame type says are GRIPPING
// (GRIP_FRAME_TYPES[frame].pressure, the honest set; an indexPivot's pinky is
// not holding anything and is not asked to), measure the clearance from the
// fingertip SURFACE to the nearest surface of a card that hold is still
// carrying, and require a minimum fraction of those samples to be in contact.
//
// RATCHET, same rule as PENETRATION_BUDGET but the other way up: these are
// seeded at what the catalog measures today and may only ever go UP. A lesson
// at 0 is not "passing", it is RECORDED AS BROKEN, read the printed number and
// raise its floor as it is re-authored. The target is over 45% everywhere.
const CONTACT_BAND = 0.025 // within this of a card surface = touching
// RE-BASELINED with PENETRATION_BUDGET above, same reason. Read the printed
// MEDIAN GAP alongside every number here, because this is a THRESHOLD COUNT
// against a hard 0.025 band and the two can disagree sharply: a bimodal gap
// distribution can shift TOWARD the cards while the count falls.
//
// Where count and median agree, they moved up together on the corrected rig:
//   charlier  62% -> 69% (median 0.017 -> 0.013)
//   overhand   2% ->  8% (median 0.349 -> 0.156)
//
// Correcting CARD_T/CARD_GAP to a real card moved the medians again, all in the
// right direction, because a thinner deck lets a hand sit where it should:
//   overhand median 0.241 -> 0.156     riffle median 0.127 -> 0.088
const CONTACT_FLOOR = {
  default: 0,
  charlier: 0.65, // measured 0.69, median gap 0.014
  // RE-BASELINED DOWNWARD, 0.87 -> 0.50, and that needs justifying because floors in
  // this table otherwise only ever rise.
  //
  // The riffle was replaced on direct user feedback: the in-hands version put the
  // shuffle in mid-air with the two hands overlapping in the middle of frame and no
  // visible card bend, none of which is what a basic riffle looks like. The tabled
  // version that replaced it is a DIFFERENT MOVE, so the 0.87 described a lesson that
  // no longer exists rather than a standard this one is failing.
  //
  // The drop is structural, not slack. A bend is only expressible along a card's own
  // long axis (the shader maps local y, so the cylinder axis is local x), which forces
  // the thumb and fingers to the two SHORT ENDS - `axis: 'end'`. That axis is harder to
  // score than the `long` axis validated across 18/18 stations: the pinch's three
  // scored pads sit at 50% in band through the bend and weave regardless of squeeze
  // (swept 0.26 / 0.38 / 0.50), while the MEDIAN gap stays inside the 0.025 band at
  // 0.018. So the typical pad is on the cards and one pad of three is not.
  //
  // What did NOT get relaxed: penetration. The tabled version measures 0.0135 worst
  // against the same 0.017 budget, which is better than the in-hands version's 0.0162,
  // with 0 cards pierced.
  // 0.50 -> 0.30, and this second drop is a different thing from the first: it is the
  // metric failing to describe a RELEASE, not the pose getting worse.
  //
  // The weave now RATCHETS open - the thumb and fingers walk out in eight increments
  // across the release window, so the cards leave one at a time instead of the hand
  // gliding from closed to open while clamped. That is what the move actually is, and
  // it was asked for directly. But a pad is ~0.074 across and the contact band is
  // 0.025, so opening a digit by even 12% of its solved curl puts that pad outside the
  // band: measured three ways (absolute open pose, reduced anchor travel, and a subtle
  // 0.88x/0.94x fraction of the solved curls), the weave scores 0-7% every time while
  // address and bend hold at 56% and 52%.
  //
  // The metric only scores cards still HELD, so this is not released cards dragging it
  // down - it is that our remaining cards sit at their layout positions while the hand
  // opens, whereas a real emptying packet thins TOWARD the pads and stays in contact.
  // Fixing that properly means either excluding release windows from this floor or
  // letting a thinning packet track the hand; both are harness changes, so the floor
  // records the gap rather than pretending it is not there.
  //
  // Penetration went the other way and is not relaxed: the weave measures 0.0000 (was
  // 0.0020) and the push 0.0033 (was 0.0130), because an opening hand is also a hand
  // getting out of the way.
  riffle: 0.3, // measured 0.37, median gap 0.043
  // OVERHAND STILL SHIPS A HOVER and this floor records it rather than blessing
  // it. Its receiving hand models a top PEEL, and the sourced mechanics say the
  // real move is a bottom grasp-and-release onto a cradled pile (see
  // TECHNIQUE_REFERENCE.md), so the hover is a symptom of modelling the wrong
  // move rather than of a mis-tuned grip. Re-modelling it is queued work.
  overhand: 0.07, // measured 0.08, median gap 0.156
}

const _cj = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
const _cl = new THREE.Vector3()
const _cq = new THREE.Quaternion()
const _ct = new THREE.Vector3()

// Signed clearance from a world point to a card's SURFACE (>0 outside, <0 in).
function surfaceGap(p, c) {
  _cl.copy(p).sub(c.pos).applyQuaternion(_cq.set(-c.quat.x, -c.quat.y, -c.quat.z, c.quat.w))
  const e = cardSurfaceExtents(_cl, c.bend ?? 0)
  const ox = Math.max(e.x, 0)
  const ou = Math.max(e.u, 0)
  const on = Math.max(e.n, 0)
  const out = Math.hypot(ox, ou, on)
  return out > 0 ? out : Math.max(e.x, e.u, e.n)
}

// Fraction of gripping-fingertip samples in contact across a whole track, plus
// the median gap (the live signal for the ratchet above).
function measureContact(track) {
  const gaps = []
  let hits = 0
  for (let i = 0; i <= 200; i++) {
    const ms = (track.duration * i) / 200
    let scene = null
    for (const h of track.holds ?? []) {
      if (ms < h.tStart || ms > h.tEnd) continue
      const grippers = GRIP_FRAME_TYPES[h.frame]?.pressure
      if (!grippers) continue // 'wrist' welds carry no finger claim
      scene = scene ?? sampleTrack(track, ms)
      const pose = scene.hands[h.side]
      if (!pose) continue
      const held = []
      for (const [id] of h.offsets) {
        if (ms > (h.releases?.get(id) ?? h.tEnd)) continue
        held.push(scene.cards.get(id))
      }
      if (!held.length) continue
      for (const name of Object.keys(grippers)) {
        fingertipWorld(pose, h.side, name, _ct)
        let best = Infinity
        for (const c of held) best = Math.min(best, surfaceGap(_ct, c))
        const gap = best - FINGERS[name].rad[2] * HAND_SCALE
        gaps.push(gap)
        if (Math.abs(gap) < CONTACT_BAND) hits++
      }
    }
  }
  if (!gaps.length) return null
  gaps.sort((a, b) => a - b)
  return { frac: hits / gaps.length, median: gaps[gaps.length >> 1], n: gaps.length }
}

// Boundary times where pops would hide: card/hand segment edges + hold edges.
function boundaryTimes(track) {
  const ts = new Set()
  for (const segs of track.cards.values()) {
    for (const s of segs) {
      ts.add(s.tStart)
      ts.add(s.tEnd)
    }
  }
  for (const side of ['left', 'right']) {
    for (const s of track.hands?.[side] ?? []) {
      ts.add(s.tStart)
      ts.add(s.tEnd)
    }
  }
  for (const h of track.holds ?? []) {
    ts.add(h.tStart)
    ts.add(h.tEnd)
  }
  return [...ts].filter((t) => t > 1 && t < track.duration - 1).sort((a, b) => a - b)
}

// Continuity thresholds. Boundary = |pos(t+0.5ms) − pos(t−0.5ms)|. The legacy
// grip-release snap measured ~0.15 before this overhaul; flagships get strict
// budgets as they are re-authored on the contact system.
const BOUNDARY_TOL = { default: 0.2, riffle: 0.2, charlier: 0.2 }

for (const lesson of LESSONS) {
  console.log(`lesson: ${lesson.id}`)
  const deck = createDeck()
  const track = compileLesson(lesson, deck)
  check(Number.isFinite(track.duration) && track.duration > 0, `${lesson.id}: bad duration`)

  const bounds = boundaryTimes(track)
  const times = [0, track.duration]
  for (let i = 0; i <= 250; i++) times.push((track.duration * i) / 250)
  for (const b of bounds) times.push(b - 0.5, b + 0.5)
  const ordered = [...new Set(times)].sort((a, b) => a - b)

  // Pass 1 (forward order): snapshots + hygiene.
  const penBudget = PENETRATION_BUDGET[lesson.id] ?? PENETRATION_BUDGET.default
  let maxPen = 0
  const snaps = new Map()
  for (const t of ordered) {
    const scene = sampleTrack(track, t)
    assertFinite(scene, `${lesson.id}@${t.toFixed(1)}`)
    assertAboveFelt(scene, `${lesson.id}@${t.toFixed(1)}`)
    maxPen = Math.max(maxPen, assertNoPenetration(scene, `${lesson.id}@${t.toFixed(1)}`, penBudget))
    snaps.set(t, JSON.stringify(snapshot(scene)))
  }

  // Pass 2: same times, shuffled order, byte-identical (scrub purity: no
  // hidden state, no cache mutation, direction independence).
  const shuffled = [...ordered]
  const rand = mulberry32(99)
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  let pureOk = true
  for (const t of shuffled) {
    if (JSON.stringify(snapshot(sampleTrack(track, t))) !== snaps.get(t)) {
      pureOk = false
      fail(`${lesson.id}: sample at ${t.toFixed(1)}ms differs on re-sample (impure)`)
      break
    }
  }
  check(pureOk, `${lesson.id}: purity`)

  // Pass 3: continuity across every boundary.
  const tol = BOUNDARY_TOL[lesson.id] ?? BOUNDARY_TOL.default
  let maxJump = 0
  let maxJumpAt = 0
  for (const b of bounds) {
    const before = sampleTrack(track, b - 0.5)
    const posBefore = new Map()
    for (const [id, c] of before.cards) posBefore.set(id, [c.pos.x, c.pos.y, c.pos.z])
    const after = sampleTrack(track, b + 0.5)
    for (const [id, c] of after.cards) {
      const p = posBefore.get(id)
      const d = Math.hypot(c.pos.x - p[0], c.pos.y - p[1], c.pos.z - p[2])
      if (d > maxJump) {
        maxJump = d
        maxJumpAt = b
      }
    }
  }
  check(
    maxJump < tol,
    `${lesson.id}: boundary jump ${maxJump.toFixed(4)} at ${maxJumpAt.toFixed(0)}ms (tol ${tol})`,
  )
  // Pass 4: the hands must actually be ON the cards they claim to hold.
  const contact = measureContact(track)
  const floor = CONTACT_FLOOR[lesson.id] ?? CONTACT_FLOOR.default
  if (contact) {
    check(
      contact.frac >= floor,
      `${lesson.id}: only ${(contact.frac * 100).toFixed(0)}% of gripping fingertips in contact during holds (floor ${(floor * 100).toFixed(0)}%, median gap ${contact.median.toFixed(3)})`,
    )
  }
  console.log(
    `  duration ${(track.duration / 1000).toFixed(1)}s, ${bounds.length} boundaries, max jump ${maxJump.toFixed(4)}, max finger-in-card ${maxPen.toFixed(4)} (budget ${penBudget})` +
      (contact
        ? `, fingertips in contact ${(contact.frac * 100).toFixed(0)}% of ${contact.n} (floor ${(floor * 100).toFixed(0)}%), median gap ${contact.median.toFixed(3)}`
        : ''),
  )
}

// ---------------------------------------------------------------------------
// Riffle grip fidelity: the flagship must actually LOOK finger-driven -
// fingertips near the packets they hold, and per-card releases ordered and
// close to the releasing thumb.
{
  const track = compileLesson(LESSONS.find((l) => l.id === 'riffle'), createDeck())
  const tipV = new THREE.Vector3()

  // nearest distance from a fingertip to a set of card centers
  const nearestCard = (scene, ids, tip) => {
    let best = Infinity
    for (const id of ids) {
      const c = scene.cards.get(id)
      const d = Math.hypot(c.pos.x - tip.x, c.pos.y - tip.y, c.pos.z - tip.z)
      if (d < best) best = d
    }
    return best
  }

  // 1. During every contact-frame hold, thumb + index stay near the held cards.
  for (const h of track.holds ?? []) {
    if (h.frame === 'wrist') continue
    const ids = [...h.offsets.keys()]
    for (const f of [0.15, 0.5, 0.85]) {
      const ms = h.tStart + (h.tEnd - h.tStart) * f
      const scene = sampleTrack(track, ms)
      const pose = scene.hands[h.side]
      check(!!pose, `riffle-grip: no ${h.side} hand pose during its hold @${ms.toFixed(0)}`)
      if (!pose) continue
      // only judge cards still held at this ms
      const heldNow = ids.filter((id) => ms <= (h.releases?.get(id) ?? h.tEnd))
      if (heldNow.length === 0) continue
      for (const finger of ['thumb', 'index']) {
        fingertipWorld(pose, h.side, finger, tipV)
        const d = nearestCard(scene, heldNow, tipV)
        // Distance is tip → nearest card CENTER. The deck is LANDSCAPE in the
        // bridge/cascade (cards 0.88 long, short ends toward the hands), so a
        // fingertip cupping an end face is ~0.45 from the nearest center.
        check(
          d < 0.7,
          `riffle-grip: ${h.side} ${finger} tip ${d.toFixed(3)} from its ${h.frame} packet @${ms.toFixed(0)}ms`,
        )
      }
    }
  }

  // 2. Per-card releases: strictly increasing per side, and each card releases
  //    within reach of that side's thumb.
  for (const h of track.holds ?? []) {
    if (!h.releases) continue
    const rel = [...h.releases.values()]
    const sorted = [...rel].sort((a, b) => a - b)
    check(
      rel.every((v, i) => i === 0 || v >= rel[i - 1]) || String(rel) === String(sorted),
      `riffle-release: ${h.side} release times not monotonic`,
    )
    let step = 0
    for (const [id, tRel] of h.releases) {
      if (step++ % 5 !== 0) continue // sample every 5th card
      const scene = sampleTrack(track, Math.max(h.tStart, tRel - 0.5))
      const pose = scene.hands[h.side]
      if (!pose) continue
      fingertipWorld(pose, h.side, 'thumb', tipV)
      const c = scene.cards.get(id)
      const d = Math.hypot(c.pos.x - tipV.x, c.pos.y - tipV.y, c.pos.z - tipV.z)
      check(d < 0.9, `riffle-release: card ${id} released ${d.toFixed(3)} from ${h.side} thumb @${tRel.toFixed(0)}ms`)
    }
  }
}

// ---------------------------------------------------------------------------
// Charlier fidelity: the cut must be FINGER-driven, the bottom packet rides
// the index fingertip up and over the top half while the wrist holds still.
{
  const deck = createDeck()
  const track = compileLesson(LESSONS.find((l) => l.id === 'charlier'), deck)
  const mid = Math.floor(deck.length / 2)
  const bottomIds = deck.slice(0, mid).map((c) => c.id)
  const topIds = deck.slice(mid).map((c) => c.id)
  const stepAt = (id) => track.steps.find((s) => s.id === id)
  const release = stepAt('release')
  const pivot = stepAt('pivot')
  const fall = stepAt('fall')
  check(!!release && !!pivot && !!fall, 'charlier: release/pivot/fall steps missing')

  const tipV = new THREE.Vector3()
  const centroid = (scene, ids) => {
    const c = new THREE.Vector3()
    for (const id of ids) c.add(scene.cards.get(id).pos)
    return c.multiplyScalar(1 / ids.length)
  }

  // 1. Wrist stillness: from thumb release through the pivot, the cut is in
  //    the fingers, the wrist may drift only a whisker (idle breathing).
  const base = sampleTrack(track, release.tStart).hands.right.wrist.pos.clone()
  let maxDrift = 0
  for (let f = 0; f <= 10; f++) {
    const ms = release.tStart + ((fall.tEnd - release.tStart) * f) / 10
    const w = sampleTrack(track, ms).hands.right.wrist.pos
    maxDrift = Math.max(maxDrift, w.distanceTo(base))
  }
  check(maxDrift < 0.09, `charlier: wrist drifted ${maxDrift.toFixed(3)} during the finger beats (max 0.09)`)

  // 2. The packet rides the index tip...
  let minTipDist = Infinity
  let crossed = false
  for (let f = 0.1; f <= 0.95; f += 0.05) {
    const ms = pivot.tStart + (pivot.tEnd - pivot.tStart) * f
    const scene = sampleTrack(track, ms)
    fingertipWorld(scene.hands.right, 'right', 'index', tipV)
    const bc = centroid(scene, bottomIds)
    minTipDist = Math.min(minTipDist, bc.distanceTo(tipV))
    // ...and swings ABOVE the top packet on its way over.
    let topMax = -Infinity
    for (const id of topIds) topMax = Math.max(topMax, scene.cards.get(id).pos.y)
    if (bc.y > topMax + 0.04) crossed = true
  }
  check(minTipDist < 0.45, `charlier: bottom packet never near the index tip (min ${minTipDist.toFixed(3)})`)
  check(crossed, 'charlier: bottom packet never swung above the top half')
}

// ---------------------------------------------------------------------------
// Regression: a deck left FACE-UP by the visualizer must not somersault cards
// through the felt, compileLesson normalizes faces down, so the riffle track
// must stay flat and above the table exactly like a face-down deck's.
{
  const deck = createDeck().map((c) => ({ ...c, isFaceUp: true }))
  const track = compileLesson(LESSONS.find((l) => l.id === 'riffle'), deck)
  check(track.finalDeck.every((c) => !c.isFaceUp), 'riffle-faceup: final deck not normalized face-down')
  for (let i = 0; i <= 150; i++) {
    assertAboveFelt(sampleTrack(track, (track.duration * i) / 150), `riffle-faceup@${i}`)
  }
}

// ---------------------------------------------------------------------------
// Regression: a bowed card is a circular arc, and the arc maths must work for
// BOTH bow directions. `surfaceExtents` takes theta = atan2(local.y, R − z);
// on the surface those are R·sinθ and R·cosθ, so for a SAGGING card (bend < 0,
// R < 0) both arguments flip sign and atan2 returns θ ± π, a point sitting
// exactly on the card reported up to 0.87 OUTSIDE it. `u` is what cardDepth,
// resolvePenetration and the contact metric above all read, so every one of
// them would have been wrong for the first lesson that sagged a card. Nothing
// in the catalog does today, which is exactly why this needs a test: the bug
// was invisible and would have surfaced as an inexplicable grip failure.
//
// Test: place points ON the surface via the bend shader's own mapping and
// require the extents to agree for +bend and −bend.
{
  const _p = new THREE.Vector3()
  for (const mag of [1.2, 2.4, 3.6]) {
    for (const y of [0, 0.15, 0.3, CARD_H / 2]) {
      const ext = {}
      for (const bend of [mag, -mag]) {
        const ang = y * bend
        _p.set(0, Math.sin(ang) / bend, (1 - Math.cos(ang)) / bend)
        const e = cardSurfaceExtents(_p, bend)
        ext[bend > 0 ? 'arch' : 'sag'] = { u: e.u, n: e.n }
      }
      check(
        Math.abs(ext.sag.n + CARD_T / 2) < 1e-9,
        `bend-sign: sag bend ${mag} at y=${y} is ${ext.sag.n.toFixed(4)} off its own shell (want ${(-CARD_T / 2).toFixed(4)})`,
      )
      check(
        Math.abs(ext.sag.u - ext.arch.u) < 1e-9,
        `bend-sign: sag bend ${mag} at y=${y} reports arc extent ${ext.sag.u.toFixed(4)} vs arch's ${ext.arch.u.toFixed(4)}`,
      )
    }
  }
}

if (failures > 0) {
  console.error(`\nverifyTracks: ${failures} FAILED of ${checks} checks`)
  process.exit(1)
}
console.log(`\nverifyTracks: ${checks} checks passed`)
