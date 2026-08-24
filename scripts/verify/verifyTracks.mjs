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
import {
  FINGER_NAMES,
  FINGERS,
  HAND_SCALE,
  PALM_MM,
  THENAR_MM,
  WRIST_MM,
  mmToRig,
} from '../../src/hands/handRigSpec.js'
import {
  fingertipWorld,
  fingerJointsWorld,
  wristLocalToWorld,
  gripContacts,
  contactSurfaceWorld,
  contactSurfaceRadius,
} from '../../src/hands/handKinematics.js'
import { cardSurfaceExtents } from '../../src/lessons/authoring/contacts.js'
import { measureStacking } from '../inspect/cardClip.mjs'
import { CARD_W, CARD_H, CARD_T } from '../../src/lib/constants.js'
// IMPORTED, NOT REIMPLEMENTED. The card-vs-card geometry is ~200 lines with three
// known-answer scenarios attached to it, and this file has already been burned once
// by two tools that measured "the same" quantity differently (verify and tryLesson
// disagreeing on the charlier's penetration). One implementation means the number
// `npm run verify` prints and the number `scripts/inspect/cardClip.mjs` prints are
// the same number, sampled identically. That probe runs its CLI only when it is the
// entry module, so importing it is inert.
import { measureClipping, DEFECT } from '../inspect/cardClip.mjs'

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
  // 0.009 -> 0.005, measured 0.0034 on BOTH grids (verify and tryLesson agree here,
  // which they did not on the charlier). The lesson was rebuilt from a top PEEL into
  // the move real shufflers make - the pack lifted clear by its long edges, packets
  // falling onto a palm-up cradle - so this is a different pose set, not the old one
  // tuned. Ratchets down, as required.
  overhand: 0.001, // measured 0.0001 - the strip-to-the-side rebuild's face grip
  // (was 0.0016 before the card correction, via the holding cradle's thumb
  // `tighten` coming down 0.05 -> 0.012 and its idle to 0.3: that thumb is
  // seated TANGENT on the deck's near end face, so every radian of squeeze on
  // top is penetration by construction.)
  // 0.017 -> 0.0122: the 0.0162 was the closing thumb of the `handover` retake,
  // and that retake is gone (charlier.lesson.js `done`). What is left is the
  // `release` cradle at 0.0121.
  // 0.0122 = 4.1 CARD THICKNESSES, and unlike the riffle's this one is NOT a sustained
  // press. The whole figure is a sub-millisecond spike at 2100.5ms, exactly on the
  // `lift` -> `turn` boundary: at 2100ms every capsule is clear. It is the documented
  // "an interpolation between two solved poses is not itself solved" - both endpoints
  // are solved and the instant between them is not. A single-frame spike is far less
  // visible than the riffle's, which held 4.7 cards deep across two whole beats.
  //
  // NOT the thumb graze, though it looks like it: THUMB_GRAZE is 0.0123, almost exactly
  // this number. Swept it - 0.165 -> 0.10 of the pad radius changes the depth NOT AT
  // ALL, and 0.06 breaks 48 checks. The coincidence is a trap; the fix is a solved
  // waypoint at that boundary, not a smaller allowance.
  // 0.0122 -> 0.005, measured 0.0043. The old figure was 4.1 CARD THICKNESSES and
  // the lesson used 3.6 of them, all in one instant at the `lift` -> `turn` boundary.
  // The cause was not the pose at all: at the release the CARDS jumped 1.20mm - four
  // card thicknesses, in half a millisecond, with the wrist not moving - because
  // `bakeHoldReleases` skipped any card that had no travel segment to start. It now
  // bakes into the pose such a card HOLDS. Fixed at the cause; 3.6 cards -> 1.4.
  charlier: 0.004, // measured 0.0037 = 1.2 cards (the right index's PIVOT_SEAT graze)
  // Real contact grazes: flesh compresses and capsules do not, so a pad
  // genuinely ON a card reads as a small overlap here. This is raised as the
  // deliberate price of contact, and the contact it buys is asserted from below
  // by CONTACT_FLOOR. Well under the 0.0812 ceiling, so still binding.
  // The riffle is TABLED again, on user feedback (see CONTACT_FLOOR for the full
  // note). Unchanged at 0.017 and still binding: the tabled rebuild measures 0.0135,
  // which is tighter than the in-hands version's 0.0162 that this budget was set for.
  // 0.017 -> 0.005, measured 0.0036. THE UNITS ARE THE POINT: 0.017 permitted 5.7
  // CARD THICKNESSES of finger inside a deck that is only 0.156 tall, and the lesson
  // was using 4.7 of them. That is visible clipping, and it survived an entire pass of
  // realism work because 0.0142 looks like nothing in world units. Fixed at the cause
  // (the pinch's SQUEEZE, 0.26 -> 0.12 - see that lesson), not by relaxing anything.
  // 0.005 -> 0.003, measured 0.0025 = 0.8 CARD THICKNESSES. THE LESSON IS NO LONGER
  // A PINCH. It was re-authored off `edgePinchGrip` onto a `tableTop` grip
  // (handKinematics + `tableTopGrip` in authoring/contacts): fingers press the
  // packet's TOP FACE down, the thumb sits at the near long edge, and the FELT takes
  // the reaction. A tabled riffle has no second jaw, and authoring one as a two-jaw
  // clamp is what forced the hands in from the SIDES with their fingers flat across
  // the card faces - the largest realism debt in the app, found from reference
  // footage rather than from any metric.
  //
  // The depth came down because the SQUEEZE went away, not because a number was
  // tuned: `tableTop`'s pressure is deliberately feeble (index/middle/ring 0.1).
  // Swept, the contact percentage is FLAT at ~79% across every pressure, while
  // pinch-like weights drive the index distal 2.2 card thicknesses through the top
  // face. The squeeze was buying nothing and paying depth for it.
  //
  // Median gap 0.018 -> 0.013 and max boundary jump 0.0061 -> 0.0030 at the same
  // time, with 0 pierced, so this is not depth bought by backing the hand off.
  riffle: 0.0026, // measured 0.0025 = 0.8 cards, on the re-authored tableTop placement
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
// CARDS PIERCED, and why a depth budget is not enough on its own.
//
// `assertNoPenetration` above measures a true OVERLAP depth, which SATURATES.
// Once a capsule's centre reaches a card the reading pins at radius + CARD_T/2
// and does not move however much deeper into the STACK the capsule goes:
//
//   index / ring proximal          0.1007
//   thumb middle, middle proximal  0.1057
//   index / ring middle            0.0908
//   any distal                     0.0759
//
// Six consecutive fixes to the overhand rebuild each reported ~0.10 and the
// number never budged, which reads as "nothing I change matters". It was a
// PINNED GAUGE, not an unchanged pose. Cards pierced - the number of cards whose
// shell contains a capsule sample point - is monotone and unbounded, so it can
// tell "grazed one card" from "knuckle driven through twenty".
//
// THIS COMPLEMENTS THE DEPTH BUDGET, IT DOES NOT REPLACE IT. A capsule can
// overlap a card by nearly a full radius with its axis still outside every card,
// which pierces 0 and is still a finger inside the deck; equally a pad exactly on
// the surface pierces 0 and is correct. So both gates stand, and neither may be
// relaxed to satisfy the other. Ported from scripts/inspect/tryLesson.mjs, which
// is where the metric was worked out.
//
// Two things about the port, both verified rather than assumed:
//   - The capsule sampling matches tryLesson (5 points per phalange) and the two
//     cheap rejects below change nothing: checked frame-for-frame against the
//     unoptimised all-cards loop over the unwired `overhandNew` track, 161 of 161
//     frames identical.
//   - The TIME grid here is denser than tryLesson's (this harness samples ~250
//     instants plus every segment boundary; tryLesson samples 160), so this gate
//     can report a HIGHER count on the same lesson. Measured, again on
//     `overhandNew`: tryLesson finds 1 pierced card at 814ms, this finds 6 at
//     1200ms, an instant tryLesson's grid steps straight over. If the two
//     disagree, this one is the stricter reading, not a bug in either.
const PIERCE_SAMPLES = 5 // points per phalange axis, inclusive of both ends
const PIERCE_BUDGET = 0 // hard: no capsule axis may be inside a card, ever

// Worst pierce count over one sample, i.e. the most cards any single capsule
// point is inside of. Returns { count, where }.
function countPierced(scene) {
  let worst = 0
  let where = ''
  for (const side of ['left', 'right']) {
    const pose = scene.hands[side]
    if (!pose) continue
    for (const name of FINGER_NAMES) {
      fingerJointsWorld(pose, side, name, _pj)
      // Same two-stage reject as the depth test, minus the radius: a point
      // INSIDE a card is necessarily within CARD_RADIUS of its centre (a bowed
      // card's shell is an arc of the same rectangle, so it never reaches
      // further from the centre than the flat one does).
      _pc.copy(_pj[0]).add(_pj[3]).multiplyScalar(0.5)
      let fingerR = 0
      for (let i = 0; i < 4; i++) fingerR = Math.max(fingerR, _pc.distanceTo(_pj[i]))
      const reach = fingerR + CARD_RADIUS
      const reach2 = reach * reach
      const lim2 = CARD_RADIUS * CARD_RADIUS
      for (let s = 0; s < 3; s++) {
        for (let k = 0; k < PIERCE_SAMPLES; k++) {
          _pp.copy(_pj[s]).lerp(_pj[s + 1], k / (PIERCE_SAMPLES - 1))
          let pierced = 0
          let first = ''
          for (const [id, c] of scene.cards) {
            const gx = c.pos.x - _pc.x
            const gy = c.pos.y - _pc.y
            const gz = c.pos.z - _pc.z
            if (gx * gx + gy * gy + gz * gz > reach2) continue
            const dx = _pp.x - c.pos.x
            const dy = _pp.y - c.pos.y
            const dz = _pp.z - c.pos.z
            if (dx * dx + dy * dy + dz * dz > lim2) continue
            _pq.set(-c.quat.x, -c.quat.y, -c.quat.z, c.quat.w) // unit ⇒ inverse = conjugate
            _pl.set(dx, dy, dz).applyQuaternion(_pq)
            const e = cardSurfaceExtents(_pl, c.bend ?? 0)
            if (e.x <= 0 && e.u <= 0 && e.n <= 0) {
              pierced++
              if (!first) first = id
            }
          }
          if (pierced > worst) {
            worst = pierced
            where = `${side} ${name}[${PHALANGE[s]}] inside ${pierced} card(s), first ${first}`
          }
        }
      }
    }
  }
  return { count: worst, where }
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
// So: during every hold, for the SURFACES that frame type says are on the cards
// (`gripContacts(frame, hold.contacts)`, the honest set; an indexPivot's pinky is
// not holding anything and is not asked to), measure the clearance from that
// contact surface to the nearest surface of a card the hold is still carrying,
// and require a minimum fraction of those samples to be in contact. The surface
// is usually a fingertip, but may be a palm point or a phalange crest, and each
// owes a different radius - see `contactSurfaceRadius`.
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
  // 0.65 -> 0.80, measured 0.83. Deliberately NOT 0.82: a one-point margin turns
  // every unrelated tweak into a red suite, and a floor that cries wolf gets
  // relaxed. The gain is real and structural - the `pivot` beat went from 0%
  // contact at a median gap of 0.142 (14mm of visible air under the packet, the
  // single worst-looking thing in this lesson) to 100% at 0.001, by moving
  // `indexPivot`'s anchor from the index TIP to its dorsal CREST so the packet
  // rides the finger instead of hovering off its end. The set GAINED a surface
  // (`index:crest`); nothing was dropped to buy this.
  // 0.80 -> 0.81 on an IDENTICAL scored set and 2.9x the samples: 0.81 of 483, where it
  // was 0.83 of 169. A second, supporting hand was added at the user's direction, so
  // there are far more gripped frames to score - this is a widening, not the narrowing
  // this table warns about.
  // Held at 0.80 rather than raised to the printed 0.81: that figure is ROUNDED, and a
  // floor seeded at a rounded measurement has zero headroom and goes red on the next
  // unrelated tweak. Three budgets in this file were seeded that way in one sitting and
  // all three failed immediately.
  charlier: 0.8, // measured 0.81 (rounded) of 483, median gap 0.011
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
  // RAISED 0.30 -> 0.68, AND THIS NUMBER IS NOT COMPARABLE TO THE OLD ONE. Read the
  // next paragraph before quoting it anywhere.
  //
  // THE LIKE-FOR-LIKE IMPROVEMENT IS 37% -> 40%: THREE POINTS, NOT THIRTY-FIVE.
  // Measured directly, by scoring the CURRENT lesson under master's old definition
  // (`gripContacts(h.frame, null)`, i.e. ignoring the per-beat override) and under
  // today's. The two disagree on the ratio and AGREE ON THE NUMERATOR:
  //     as scored today       199 in contact of 275 samples = 72%
  //     master's definition   199 in contact of 501 samples = 40%
  // The in-contact sample COUNT is identical. The whole of 40 -> 72 is denominator:
  // the same hand, scored against fewer surfaces. Master measured 37% on the old
  // pose, so the POSE moved three points and the rest is bookkeeping.
  //
  // The narrowing below is still justified on its merits, and 0.68 is a tight, useful
  // guard against THIS lesson regressing into a hover. What it is not is evidence of a
  // large improvement - and in a table that otherwise only ever rises, a reader who
  // sees "0.30 -> 0.68" will assume exactly that. It also means a future change that
  // legitimately RE-WIDENS the scored set will fail this floor and must re-baseline it
  // rather than treat the failure as a regression.
  //
  // THE SET NARROWS TWICE, not once, and only one of the two is described below. The
  // second is `WEAVE_ON_CARDS` in the lesson (the weave beat scores on the MIDDLE
  // alone, dropping the index stabiliser that a hand opening to release necessarily
  // lifts - measured 0% at a median 0.043). That is argued at its own call site, and
  // the printed `scored on ...` line now reports each distinct set separately
  // (`[index middle]x216 + [middle]x59`) precisely so a per-beat narrowing cannot hide
  // inside a union.
  //
  // The set went [index middle thumb] -> [index middle]. That is not a floor being
  // bought cheaply: measured per surface over 161 samples of every gripped beat,
  // the THUMB is 0% in contact at all three of them, at a median gap of
  // 0.104 / 0.128 / 0.131 - a card-length off the cards on every single frame. It
  // cannot be otherwise, because `edgePinchGrip` derives its face coordinates in
  // WORLD axes against a PORTRAIT deck, so this lesson's ~90deg-yawed landscape
  // halves decouple from the hand: the auto-placer's own reach residual is 0.3094
  // here against 0.0004 for the identical solve on an unyawed deck. So the thumb was
  // the `indexPivot` mistake again - a pad nowhere near the cards counted as a holder
  // on every frame - and it was costing two thirds of this lesson's number at EVERY
  // beat, not just the release. It remains a carry anchor and it still visibly
  // squeezes; it is only removed from what is SCORED.
  //
  // `rotateGripRigid` would solve the orientation properly (100%/69%/32% per beat)
  // and is REJECTED: it needs one hand to span the table's centre line, so the two
  // now-opaque hands interpenetrate by 0.19 through every gripped beat, which is the
  // "two hands overlapping in the middle of frame" defect this whole lesson replaced.
  // Widening the halves to a GAP of 0.76 still leaves -0.071. Recorded, not blessed:
  // the honest fix is a pinch that can solve a yawed deck.
  // CUT 0.68 -> 0.55, and a cut in this table has to be argued. Measured 61%.
  //
  // It is the direct price of taking the pinch's squeeze from 0.26 to 0.12 to stop the
  // fingers clipping 4.7 cards into the deck - and part of the 72% it replaces was not
  // contact at all. This floor counts pads within 0.025 of a card, and a pad pressed
  // THROUGH a card is trivially within 0.025 of it, so a hard squeeze buys contact by
  // committing the exact fault the penetration budget exists to catch. The two ratchets
  // are in real opposition here and only accurate PLACEMENT satisfies both.
  //
  // Where the change actually landed, per beat (tryLesson):
  //     address  56% -> 82%  (median gap 0.018 -> 0.005)   BETTER
  //     bend     52% -> 67%  (median gap 0.024 -> 0.018)   BETTER
  //     weave    40% -> 17%  (median gap 0.029 -> 0.041)   worse
  // The two GRIPPED beats improved on both measures. The whole loss is in `weave`,
  // which is a RELEASE: a pad is ~0.074 across against a 0.025 band, so a hand that is
  // opening leaves the band almost immediately, and a looser initial squeeze means it
  // starts closer to the edge of it. That beat scoring low is the metric's documented
  // blind spot, not the pose getting worse - the cards it is pouring are measurably
  // closer to the hand than before.
  // 0.55 -> 0.74, measured 0.78 of 491, median gap 0.013. See
  // PENETRATION_BUDGET.riffle: the lesson is now a `tableTop` grip rather than an
  // edge pinch, so this is a different pose set and not the old one tuned.
  //
  // THE SCORED SET WIDENED, WHICH IS THE OPPOSITE OF THE PATTERN THIS TABLE WARNS
  // ABOUT, and it is why the sample count nearly doubled: [index middle] ->
  // [index middle ring thumb]. The pinch had to DROP its thumb, which measured 0% in
  // band at 0.104-0.131 clear because a pinch cannot solve a ~90deg-yawed landscape
  // half; on a top-face grip that thumb is genuinely on the cards. More surfaces
  // scored AND a higher percentage AND lower penetration is the one combination that
  // cannot be produced by narrowing what is measured.
  // 0.74 -> 0.88, measured 90% of 502, and the scored set WIDENED rather than narrowed
  // - the weave now scores [index middle] (110 samples, was 55 on [middle] alone).
  // Re-authoring the hands onto the footage's placement (thumbs at the inner-near
  // corners, finger row along the packet's LENGTH, wrists yawed outboard) improved
  // contact, penetration, median gap AND hand-vs-hand at the same time; nothing here
  // was bought by scoring less.
  riffle: 0.88, // measured 0.90 of 502, median gap 0.008
  // OVERHAND STILL SHIPS A HOVER and this floor records it rather than blessing
  // it. Its receiving hand models a top PEEL, and the sourced mechanics say the
  // real move is a bottom grasp-and-release onto a cradled pile (see
  // TECHNIQUE_REFERENCE.md), so the hover is a symptom of modelling the wrong
  // move rather than of a mis-tuned grip. Re-modelling it is queued work.
  // 0.07 -> 0.90, measured 100% of 562 with every one of sixteen beats at 100%.
  // Ten points of margin, deliberately: a floor with no margin cries wolf and then
  // gets relaxed.
  //
  // THE SCORED SET ALSO NARROWED HERE, so read the two facts together (this is the
  // pair the `scored on [...]` print exists to expose). It went
  // [index middle pinky ring thumb] -> [middle palm:palm thumb], i.e. 5 names to 4
  // surfaces across two hands. The narrowing is NOT what produced the number, and
  // that is the point:
  //   * With the dropped surface INCLUDED the lesson still measures 67%, against the
  //     old lesson's 8%. The improvement survives scoring the thing that was removed.
  //   * The dropped surface is the pinch's INDEX, measured 0.0721-0.0731 clear at
  //     every packet size, and it is clear BY CONSTRUCTION: `stabilise: false` omits
  //     it on purpose, because packets depart across the very face it would lie on.
  //   * Penetration moved the RIGHT way at the same time, 0.0079 -> 0.0034, with 0
  //     pierced. A set narrowed to flatter the floor does not also lower penetration.
  //   * For contrast, the OLD lesson's five scored fingertips measured left thumb
  //     1.0966, left ring 0.0787, left pinky 0.1801, right thumb 0.6436, right index
  //     0.1290, right ring 0.1322, right pinky 0.5877. Only the middle ever touched,
  //     at 16%. That set was scoring seven surfaces that were nowhere near a card.
  overhand: 0.9, // measured 1.00 of 562, median gap 0.014
}

// RATCHET, and it only ever goes DOWN. Seeded at what the catalog measures TODAY,
// which for two lessons is a recorded defect rather than a passing grade - the same
// convention CONTACT_FLOOR uses when it says a lesson at 0% is "recorded as broken,
// not passing". Read the printed `worst step` beside the number: it names the beat
// doing the authoring.
//
// What the numbers mean right now:
//   overhand   6%  - the rebuilt lesson. 77% of its card motion is gripped and another
//                    17% has a hand on it; what is left is the final settle.
//   charlier  24%  - concentrated in `pivot`, where the TOP half slides out along the
//                    opening fingers on an authored path while only the bottom half
//                    is gripped.
//   riffle    28%  - concentrated in `cut`, which carries a block along an authored
//                    path instead of on a grip.
//   wash      51%  - was 71%, and still the worst of the four. Nothing in it is
//                    gripped, so every honest sample has to be a hand ON a card, and
//                    that is now 46% of its card motion (was 26%). What remains is
//                    concentrated in `spread`, which DEALS cards out of a stack
//                    rather than raking them, and cannot use contact timing (below).
//
// THE WASH'S CAUSE IS NOW KNOWN PRECISELY, and it is none of the three things it
// looks like. Measured, on `smoosh-1`:
//   * It is NOT coverage. All 52 cards ARE reached - the closest a hand ever gets to
//     each card over the smoosh window has median 1.4mm and worst 4.0mm. Every card
//     is genuinely touched at some instant.
//   * It is NOT the falloff width. Tightening `RAKE_REACH` 0.5 -> 0.24 leaves
//     causality flat and destroys the shuffle instead (path median 1.470 -> 0.717,
//     8/52 cards barely raked).
//   * It is NOT the motion being too slow. Shortening the stagger `span` 0.3 -> 0.07
//     leaves causality flat (71% -> 72%) and path length identical.
//   * IT IS THE TIMING ALIGNMENT. The instant a hand is closest to a card and the
//     instant that card moves fastest are unrelated: median offset 0.233 of the pass
//     (~700ms of 3s), only 6/52 cards peak within 0.05 of being touched, and the mean
//     rank displacement between touch order and motion order is 20.4 of 52 - about
//     what random ordering would give.
// The reason was that the stagger was applied by RANK through `staggerWindow(k, count)`
// over an ordering from an ANALYTIC model of the palm's sweep (`passTime(orbit, ang)`),
// and that model had drifted from the hands it was meant to describe: `orbitOf`
// hardcodes `v0: 0` and a phase-independent centre, while the real orbit starts at the
// anchor and circles a centre offset by -amp*(cos 2πφ, sin 2πφ). The moment the wash
// gained an ANTIPHASE left hand, half its cards were timed against the wrong circle.
//
// FIXED by `stagger: { by: 'contact' }` (compileLesson), which samples the COMPILED
// HAND TRACK instead of modelling it - so there is no model left to drift. Worth
// 26% -> 46% hand-on-card at identical mixing, because it only re-times motion and
// never changes where a card ends up. It required compiling hand tracks BEFORE card
// tracks, which is why `compileLesson` now lays out step timings in a pre-pass.
//
// It is NOT a general replacement for rank staggering: applied to a DEAL (the wash's
// `spread`, where cards leave a squared stack) it drove a pinky 0.086 into a card,
// because re-timing a card's departure to the moment a hand arrives puts the hand
// where the card still is. Contact timing suits a RAKE; a deal needs the card gone
// before the hand gets there.
//                    `washRake` was hiding this and looked healthy while doing so: it
//                    reports a hand coming within 1.5-2.6mm of A card, which is a
//                    MINIMUM over all cards, where this is a COUNT over every card
//                    that moved. The lesson file's own comment claims "a card moves
//                    only when a pad crosses it"; it is 81% false.
//
// A note on why these are not lower, and what would make them so: an authored `to`
// layout moves cards by fiat. Any beat that wants to move cards honestly has to
// either declare a grip over them or put a hand surface on their path. That is a
// re-authoring job per beat, not a tuning pass.
const CAUSALITY_BUDGET = {
  default: 1,
  overhand: 0.03, // measured 0.01 - nothing in the lesson moves without a hand on it
  // 0.26 -> 0.27, and this is a REGRESSION being recorded rather than hidden. Baking
  // the release into the held pose (see PENETRATION_BUDGET.charlier) moves each card
  // to where the hand actually let go of it, which shifts the `pivot` beat's starting
  // poses slightly and costs about two points here. It is worth it: the same change
  // took penetration from 3.6 card thicknesses to 1.4 and removed a visible four-card
  // pop. The honest fix for what remains is to GRIP the top half during `pivot` - in
  // a real Charlier it rests on the thumb while the index levers the bottom half up,
  // so it should not be travelling on an authored path at all.
  // 0.27 -> 0.28, measured 0.27, and it buys a 32x cut in card-on-card clipping (see
  // CLIP_BUDGET.charlier). The `fall` now holds the packet level and high before
  // dropping it, which is one point more unattended hang time and 2100 fewer frames of
  // one packet inside another.
  // 0.28 -> 0.17, measured 0.16, and this is the largest single causality gain in the
  // catalog. Gripped samples went 59% -> 70%. The cause was TWO hovers, not one: `turn`
  // had the hand let go of the deck at working height and travel 1.72 out to the side to
  // turn palm-up, leaving the deck completely alone in mid-air for ~950ms, and
  // `release`/`pivot` left the top half 35mm above the highest capsule of the whole hand
  // for 1.8s. A second hand now carries the deck through both. The palm-down -> palm-up
  // turn is deleted outright: it only ever existed because ONE hand had to both lift the
  // deck off the felt (only possible from above) and hold it from below.
  charlier: 0.13, // measured 0.10 - one hand, and the only card that moves
  // untouched is the top half running down the fingers in `slide`
  // RAISED 0.30 -> 0.34, and a ratchet moving the wrong way has to be argued.
  // It is the price of a CLIPPING fix that a viewer can actually see. Raising the
  // weave's hand rise took card-vs-card clipping from 3674 defect pair-frames to 963
  // and its worst crossing from 22.7 card thicknesses to 19.8 (CLIP_BUDGET.riffle
  // ratcheted down to match). The cost is that released cards then fall further with
  // nothing on them, and their travel is horizontal-dominant rather than
  // downward-dominant, so it does not score as gravity.
  //
  // Both numbers describe the SAME underlying defect, which is why they trade against
  // each other: cards crossing the un-released half, and cards flying unattended, are
  // two readings of a merged stack forming in space a full-size half still occupies.
  // The thinning-packet primitive fixes both at once and would let both ratchets move
  // down together; until then this is the honest split.
  riffle: 0.34, // measured 0.33
  // 0.53 -> 0.52, measured 0.50. Ratchets down, as required. Two changes moved it:
  // the spread's cards are now FLAT with their heights handed out in stacking order
  // (see wash.lesson.js BEND_MAX) so there is no per-pass vertical
  // re-randomisation left to be unmotivated, and the smoosh stagger re-swept to
  // spread 0.55 / span 0.6. `spread` no longer owns the worst step either - it is
  // `smoosh-1` now, at 347 of 3946 moving samples, because the longer windows put
  // far more card motion inside the smooshes for the same total drift.
  wash: 0.52, // measured 0.50 - still the worst of the four
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

// ---------------------------------------------------------------------------
// TOP-CARD SWAPS. Two overlapping cards trade which one is on top between
// consecutive frames, with no intermediate state.
//
// This exists because the crossing metric above went VACUOUS and read as a pass. Once
// the wash's cards were made flat, every one of them had a normal of exactly +/-Y -
// measured max card-plane tilt 0.000 degrees - and two parallel planes at different
// heights cannot intersect, so an edge-vs-face test could only ever return zero however
// bad the picture was. The user was still seeing "clipping". `cardClip.mjs` now prints
// the max tilt FIRST, so that vacuity can never be misread as a clean bill again.
//
// What they were actually seeing: cards render as ZERO-THICKNESS planes that cast no
// shadow on one another, so occlusion is the ONLY cue that one card is above another.
// When an overlapping pair's heights cross, that cue inverts in a single frame with
// nothing in between - visually indistinguishable from the two cards passing through
// each other. Measured at 60fps the wash was doing this 133 times a second.
//
// Sampled at 60fps deliberately, because a swap is an event BETWEEN consecutive frames.
// A per-step grid of 16 points cannot see one: it sees two unrelated orderings 190ms
// apart with no way to tell a flip from a reshuffle.
const SWAP_BUDGET = {
  default: Infinity,
  // Its three smoosh passes and both lifts are at a HARD ZERO by construction, and that
  // is the part worth protecting: each card now gets ONE height rank, assigned once and
  // carried unchanged through every pass, so no pair's order can change and therefore
  // no pair can cross. The residue is `spread` (896) and the two `gather` beats (814),
  // which are GENUINE restacking during a staggered transition - a plowed card really
  // does climb onto the heap - and are not fixable by ordering. Those need card
  // THICKNESS so that riding over another card reads as riding over it.
  wash: 1750, // measured 1710; smoosh-1/2/3 and lift-1/2 are 0
  // WAS THE WORST RATE IN THE CATALOG (1116 swaps, 88.4/s, EVERY one covering more than
  // a quarter of a card face, median 83%) and is now the best-behaved of the flat
  // lessons. The cause was not re-drawn heights: a packet leaving the TOP of the block
  // began DESCENDING while still over the block, so it dropped through the cards it had
  // just been sitting on. Split laterally from vertically at the drops - `snapEase`
  // sideways, `yEase: 'easeInCubic'` down - and it is 221 swaps at 17.5/s with only 12
  // over a quarter face and the median down to 5%, i.e. corner slivers rather than
  // whole-card flips. Nothing else moved: contact still 100%, penetration 1.1 cards,
  // pierced 0, card-vs-card 0.
  overhand: 5, // measured 0 - a released packet falls as one block, so nothing crosses
  // ZERO, and not by effort: this lesson's cards are genuinely TILTED (max plane tilt
  // 42.3 degrees), so which card is in front is never ambiguous and there is no
  // occlusion cue to invert. Worth knowing as the shape of a fix - a real angle
  // removes the artefact outright.
  charlier: 0, // measured 0
  // Exactly at the measurement, so given 5 of margin rather than 0 - a budget with no
  // headroom turns any unrelated tweak red. All 120 are in `cut`; every other step is 0,
  // so that beat is the only place to look.
  riffle: 125, // measured 120, all of them in `cut`
}

// ---------------------------------------------------------------------------
// HAND VERSUS HAND. Every other metric here asks about a hand against the CARDS, so
// two hands driving through each other was invisible to all of them - a user looking
// at the riffle said "see how the thumbs are interweaved, that is not good" while the
// whole suite was green, and the measurement then put the two palms 84 CARD
// THICKNESSES inside one another.
//
// It matters more than it did. The hands used to be 55% translucent, which hid
// interpenetration; they are opaque and depth-writing now, so two hands sharing a
// volume reads as one melted shape. ARCHITECTURE has carried the rule for a long time
// ("converging palms need >= 0.5 x-separation") with nothing enforcing it, and this is
// what enforcing it looks like.
//
// Capsule-capsule clearance: segment-to-segment distance minus both radii, exact for
// the phalanges and conservative for the palm/thenar/wrist spheres. Budgets are the
// worst allowed clearance, so they are NEGATIVE where a lesson currently overlaps and
// they ratchet UP toward 0.
const CLASH_SAMPLES = 200
const _clA = new THREE.Vector3()
const _clB = new THREE.Vector3()
const _clR = new THREE.Vector3()
const _clJ = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
const _clW = new THREE.Vector3()

function segSegDist(p1, q1, p2, q2) {
  _clA.subVectors(q1, p1)
  _clB.subVectors(q2, p2)
  _clR.subVectors(p1, p2)
  const a = _clA.dot(_clA)
  const e = _clB.dot(_clB)
  const f = _clB.dot(_clR)
  const EPS = 1e-12
  let s = 0
  let t = 0
  if (a <= EPS && e <= EPS) return _clR.length()
  if (a <= EPS) {
    t = Math.min(1, Math.max(0, f / e))
  } else {
    const c = _clA.dot(_clR)
    if (e <= EPS) {
      s = Math.min(1, Math.max(0, -c / a))
    } else {
      const b = _clA.dot(_clB)
      const denom = a * e - b * b
      s = denom !== 0 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0
      t = (b * s + f) / e
      if (t < 0) {
        t = 0
        s = Math.min(1, Math.max(0, -c / a))
      } else if (t > 1) {
        t = 1
        s = Math.min(1, Math.max(0, (b - c) / a))
      }
    }
  }
  return _clA.multiplyScalar(s).add(p1).sub(_clB.multiplyScalar(t).add(p2)).length()
}

const CLASH_SLABS = []
for (const M of [PALM_MM, THENAR_MM]) {
  const [sx, sy, sz] = M.size.map(mmToRig)
  const [px, py, pz] = M.pos.map(mmToRig)
  const r = (Math.min(sx, sz) / 2) * HAND_SCALE
  for (let a = -1; a <= 1; a++) {
    for (let b = -1; b <= 1; b++) {
      CLASH_SLABS.push({ p: new THREE.Vector3(px + (a * sx) / 2, py + (b * sy) / 2, pz), r })
    }
  }
}
CLASH_SLABS.push({
  p: new THREE.Vector3(...WRIST_MM.pos.map(mmToRig)),
  r: mmToRig(WRIST_MM.dia / 2) * HAND_SCALE,
})

function handCapsules(pose, side, out) {
  out.length = 0
  for (const name of FINGER_NAMES) {
    fingerJointsWorld(pose, side, name, _clJ)
    for (let sg = 0; sg < 3; sg++) {
      out.push({
        a: _clJ[sg].clone(),
        b: _clJ[sg + 1].clone(),
        r: FINGERS[name].rad[sg] * HAND_SCALE,
        name: `${name}[${['prox', 'mid', 'dist'][sg]}]`,
      })
    }
  }
  for (const sp of CLASH_SLABS) {
    wristLocalToWorld(pose, side, sp.p, _clW)
    const v = _clW.clone()
    out.push({ a: v, b: v, r: sp.r, name: 'palm' })
  }
  return out
}

const _clL = []
const _clRt = []

function measureHandClash(track) {
  let worst = Infinity
  let where = ''
  let step = ''
  for (let i = 0; i <= CLASH_SAMPLES; i++) {
    const ms = (track.duration * i) / CLASH_SAMPLES
    const scene = sampleTrack(track, ms)
    const L = scene.hands.left
    const R = scene.hands.right
    if (!L || !R) continue
    handCapsules(L, 'left', _clL)
    handCapsules(R, 'right', _clRt)
    for (const x of _clL) {
      for (const y of _clRt) {
        const d = segSegDist(x.a, x.b, y.a, y.b) - x.r - y.r
        if (d < worst) {
          worst = d
          where = `L:${x.name} x R:${y.name}`
          step = track.steps.find((q) => ms >= q.tStart && ms <= q.tEnd)?.id ?? '?'
        }
      }
    }
  }
  return worst === Infinity ? null : { worst, where, step }
}

// Worst ALLOWED clearance, in world units. Negative admits overlap; ratchets UP to 0.
// Both non-zero entries are RECORDED AS BROKEN, not blessed - the same convention the
// rest of this file uses.
const CLASH_BUDGET = {
  default: 0,
  // FIXED, and ratcheted from -0.26 (84 CARD THICKNESSES of palm inside palm) to a
  // hard 0. This was the defect the user could see and describe - "the thumbs are
  // interweaved, that is not good" - while every other gate in this file was green,
  // because nothing here had ever compared a hand against the other hand.
  //
  // The cause was structural and is recorded in RiffleShuffle.md: the lesson had put
  // the thumbs on the OUTER ends SPECIFICALLY so the hands would not collide, and the
  // footage puts them at the INNER-near corners, so the whole hand placement was
  // authored converging on the junction with nothing keeping the two apart. Re-authored
  // onto the footage's placement it now measures +6.4mm CLEAR, and the closest pair is
  // thumb-tip to thumb-tip in the `weave` - which is exactly what the footage shows at
  // 140s ("thumbs meet tip-to-tip at the junction"). Closest-approach being the thumb
  // tips is the CORRECT answer; it was the palms that were wrong.
  riffle: 0.004, // measured +0.0635 = 6.4mm clear; held to a POSITIVE clearance now
  // Much smaller and only 3 frames, in the deepest smoosh pass. The wash's two palms
  // are designed to pass at PALM_GAP with the antiphase orbit keeping them apart; this
  // is that margin going slightly negative at the extreme of one pass.
  wash: -0.038, // measured -0.0356 = 11.8 cards inside (3.6mm)
  overhand: 0, // measured +23.6mm clear
}

// ---------------------------------------------------------------------------
// CAUSALITY: a card may only move because something MOVES IT.
//
// This is the principle the whole app rests on and it was, until now, the one
// thing nothing checked. Every other metric here asks "is a hand near a card";
// none asked the question that actually matters, which is "for each card that
// MOVED, was there anything to move it". A lesson can score 100% fingertip
// contact and still be a gesture performed beside a shuffle that happens by
// itself: contact is measured over the cards a grip DECLARES, while this is
// measured over every card that actually moved.
//
// THREE legitimate movers, and a card that moves outside them is unmotivated:
//
//   1. GRIPPED. It rides a contact frame, so it is attended by construction.
//   2. A HAND SURFACE IS ON IT - any phalange, the palm or the thenar, within
//      DRIVE_BAND of the card's SURFACE. Measuring to the surface and not the
//      centre is load-bearing: a pad on the corner of a card sits half a card
//      from its centre, so a centre-distance version of this metric reported the
//      overhand 100% unmotivated while it measured 100% contact.
//   3. GRAVITY. Downward-dominant motion - falling, or settling onto a pile.
//
// A FOURTH mover exists in the real world and NOT in this engine: card-on-card
// contact. In a real wash a palm pushes one card that nudges its neighbour. There
// is no card-card interaction here, so that motion is either authored (and lands
// in the unmotivated bucket, correctly) or driven by a pad. Do not add it as an
// exemption to make a number look better - it would exempt exactly the authored
// motion this metric exists to find.
//
// Velocity, not per-sample displacement, so the threshold does not move when the
// sample count does.
const MOVE_SPEED = 0.03 // world units per second; below this a card is standing still
const DRIVE_BAND = 0.05 // ~5mm, twice CONTACT_BAND: generous for "a hand is on this"
const CAUSALITY_SAMPLES = 200

// The palm and thenar as surface points in the LOCAL hand frame: the four corners,
// the edge midpoints and the centre of each slab's palmar face. Nine points per slab
// is enough to catch a pile resting anywhere on the palm without making this metric
// the slowest thing in the harness.
// THREE.Vector3, NOT arrays: `wristLocalToWorld` does `out.copy(p)`, which reads
// `.x/.y/.z`, so an array silently produces NaN. That bug cost this metric its palm
// AND, because `Math.min(x, NaN)` is NaN and `NaN > DRIVE_BAND` is false, it also
// broke the search loop early and skipped whichever hand was checked second.
const SLAB_LOCAL = []
for (const M of [PALM_MM, THENAR_MM]) {
  const [sx, sy, sz] = M.size.map(mmToRig)
  const [px, py, pz] = M.pos.map(mmToRig)
  for (let a = -1; a <= 1; a++) {
    for (let b = -1; b <= 1; b++) {
      SLAB_LOCAL.push(new THREE.Vector3(px + (a * sx) / 2, py + (b * sy) / 2, pz + sz / 2))
    }
  }
}

const _uPrev = new Map()
const _uPts = []
const _uP = new THREE.Vector3()
const _uJ = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]

// Every hand surface point this frame, as [x, y, z, radius]. `sides` narrows it,
// which INERT_CONTACT below needs: that metric only counts hands that are
// themselves moving, and a hand parked on a still card is not evidence of anything.
const BOTH_HANDS = ['left', 'right']
function handSurfacePoints(scene, out, sides = BOTH_HANDS) {
  out.length = 0
  for (const side of sides) {
    const pose = scene.hands[side]
    if (!pose) continue
    for (const name of FINGER_NAMES) {
      fingerJointsWorld(pose, side, name, _uJ)
      const rad = PHALANGE_RAD[name]
      for (let sg = 0; sg < 3; sg++) {
        for (let k = 0; k < CAPSULE_SAMPLES; k++) {
          _uP.copy(_uJ[sg]).lerp(_uJ[sg + 1], k / (CAPSULE_SAMPLES - 1))
          out.push([_uP.x, _uP.y, _uP.z, rad[sg]])
        }
      }
    }
    for (const q of SLAB_LOCAL) {
      wristLocalToWorld(pose, side, q, _uP)
      out.push([_uP.x, _uP.y, _uP.z, 0])
    }
  }
}

function measureCausality(track) {
  let moving = 0
  let gripped = 0
  let driven = 0
  let gravity = 0
  let unmotivated = 0
  const perStep = new Map()
  const dt = track.duration / CAUSALITY_SAMPLES / 1000 // seconds between samples
  _uPrev.clear()
  // SNAPSHOT PLAIN NUMBERS. `sampleTrack` reuses its card objects, so holding a
  // reference to the previous sample yields the CURRENT pose and every card reads
  // as motionless - the exact false negative that would make this metric vacuous.
  {
    const s0 = sampleTrack(track, 0)
    for (const [id, c] of s0.cards) _uPrev.set(id, [c.pos.x, c.pos.y, c.pos.z])
  }
  for (let i = 1; i <= CAUSALITY_SAMPLES; i++) {
    const ms = (track.duration * i) / CAUSALITY_SAMPLES
    const scene = sampleTrack(track, ms)
    const step = track.steps.find((q) => ms >= q.tStart && ms <= q.tEnd)
    const held = new Set()
    for (const h of track.holds ?? []) {
      if (ms < h.tStart || ms > h.tEnd) continue
      for (const [id] of h.offsets) if (ms <= (h.releases?.get(id) ?? h.tEnd)) held.add(id)
    }
    let pts = null
    for (const [id, c] of scene.cards) {
      const q = _uPrev.get(id)
      const x = c.pos.x
      const y = c.pos.y
      const z = c.pos.z
      if (!q) {
        _uPrev.set(id, [x, y, z])
        continue
      }
      const dx = x - q[0]
      const dy = y - q[1]
      const dz = z - q[2]
      q[0] = x
      q[1] = y
      q[2] = z
      if (Math.hypot(dx, dy, dz) / dt < MOVE_SPEED) continue
      moving++
      if (held.has(id)) {
        gripped++
        continue
      }
      if (!pts) {
        handSurfacePoints(scene, _uPts)
        pts = _uPts
      }
      let near = Infinity
      for (let k = 0; k < pts.length; k++) {
        const pt = pts[k]
        _uP.set(pt[0], pt[1], pt[2])
        const d = surfaceGap(_uP, c) - pt[3]
        // Guard the comparison rather than the accumulator: a NaN here used to make
        // `near` NaN for good, and every later point unreachable.
        if (Number.isFinite(d) && d < near) near = d
        if (near <= DRIVE_BAND) break
      }
      if (near <= DRIVE_BAND) {
        driven++
        continue
      }
      const horiz = Math.hypot(dx, dz)
      if (dy < 0 && Math.abs(dy) >= horiz) {
        gravity++
        continue
      }
      unmotivated++
      const sid = step?.id ?? '?'
      perStep.set(sid, (perStep.get(sid) ?? 0) + 1)
    }
  }
  if (!moving) return null
  const worst = [...perStep.entries()].sort((a, b) => b[1] - a[1])[0]
  return {
    moving,
    gripped,
    driven,
    gravity,
    unmotivated,
    frac: unmotivated / moving,
    worst: worst ? `${worst[0]} (${worst[1]})` : '-',
  }
}

// ---------------------------------------------------------------------------
// CARD-VS-CARD CLIPPING: two cards may not pass THROUGH each other.
//
// The gap this closes: every metric above measures a HAND against a card. The most
// obvious visual fault a user reported - "hard straight seams where one card's plane
// slices across another's face", dozens of them across the wash's spread - was
// invisible to all of them, and the suite was fully green while it was on screen.
//
// THE FIRST ATTEMPT AT MEASURING IT REPORTED 0.2mm ACROSS THE WHOLE CATALOG, i.e.
// "no problem", and the reason is worth keeping because it is a class of mistake:
// it sampled a 3x3 grid of points on each card and asked whether any was inside
// another card's slab. A card is 63.5 x 88.9mm and CARD_T is 0.30mm, so grid points
// 31mm apart cannot detect a 0.3mm plate crossed at an angle - two cards meeting in
// an X pass cleanly BETWEEN the samples. Point-in-volume is the wrong test for thin
// plates; EDGE-versus-FACE is the right one, and that is what `cardClip.mjs` does.
//
// WHAT IS BY DESIGN AND IS NOT FLAGGED. CARD_GAP (0.003) EQUALS CARD_T (0.003), so
// a squared stack is exactly flush with zero clearance and the gather HEAP is looser
// than flush. None of that is reported, and it needs no threshold to exclude: every
// card in a stack shares one normal (a yaw about world up leaves two face-down cards
// coplanar), and parallel surfaces have no crossing at all. The wash's `square` and
// `rest` steps are 52 flush cards and measure exactly 0.
//
// A MINIMUM ANGLE BETWEEN THE TWO CARDS WOULD BE THE WRONG THIRD FILTER, measured:
// the worst crossing angle anywhere in the wash was 6 degrees and an angle gate at 4
// discarded 98% of the real defect. A yaw cannot tilt a face-down card, so the only
// divergence available there is the bend. Shallow crossings are exactly what makes a
// LONG straight seam, which is what was being complained about.
//
// TWO RATCHETS, both DOWN only, because they fail differently:
//   depth  the worst crossing, in world units and printed in CARD THICKNESSES. It
//          catches one card driven deep through another.
//   pairs  how many ordered card pairs are clipping, summed over sampled frames. It
//          catches the opposite shape - a lesson that trades one deep crossing for
//          a hundred shallow ones - which a max cannot see. Comparable run to run
//          because the sampling is fixed (cardClip's default 16 frames per step).
const CLIP_BUDGET = {
  default: { depth: 0.09, pairs: 6000 },
  // ZERO, AND HELD AT ZERO, because it is zero BY CONSTRUCTION rather than by
  // tuning. The wash measured 15333 clipping pair-frames up to 3.9 CARD THICKNESSES
  // deep along seams up to 43.7mm long, in every step from `spread` to
  // `gather-left`. Fixed at the cause in wash.lesson.js: its cards are FLAT
  // (BEND_MAX 0.14 -> 0, where one card's 1.4mm arch was the entire height band all
  // 52 were distributed through) and their heights are handed out in STACKING ORDER
  // instead of drawn at random, so no two overlapping cards share a height. Parallel
  // planes at distinct heights cannot intersect, so this cannot creep back by
  // fractions - it can only come back if someone reintroduces a bend or a tilt, and
  // then it comes back loudly. Do not raise it to absorb one.
  wash: { depth: 0, pairs: 0 },
  overhand: { depth: 0, pairs: 0 }, // measured 0; its deepest RAW crossing is 0.2 cards
  // RECORDED AS BROKEN, NOT BLESSED - the same convention CONTACT_FLOOR uses.
  // 0.0678 is 22.6 CARD THICKNESSES, and that number is not a coincidence: it is
  // about the thickness of the packet being crossed (22 cards at CARD_GAP), i.e. one
  // card passing through the whole of the other half at 43 degrees, 952 pairs at
  // once in the worst frame. It is the `fall` beat and only the `fall` beat; `pivot`
  // measures 0. The wash's fix does NOT transfer - these cards are genuinely at large
  // angles to one another mid-move, and the honest repair is to sequence the fall so
  // a card is clear of the packet before it rotates into its plane, which is a
  // re-authoring job in a lesson this task did not own.
  // RATCHETED DOWN 32x after finding the cause, which is NOT the bow (these cards have
  // zero bend) but pure ROTATION: the falling half turned from on-edge to flat WHILE
  // descending onto the top half, so it passed through it at every angle in between.
  // Separating the two curves - `quatEase: 'snapEase'` to come level early, `ease:
  // 'easeInCubic'` to stay high until it is parallel - took it from 2172 pair-frames at
  // 22.6 card thicknesses to 68 at 10.2, for one point of CAUSALITY_BUDGET.
  // ZERO on both, since the one-handed rebuild: `FALL` is swept so the pivoted
  // half is level before it arrives, and the packet is released at the apex rather
  // than carried down onto the stack.
  charlier: { depth: 0, pairs: 0 }, // measured 0.0000, 0 pairs
  // ALSO RECORDED AS BROKEN. Same shape as the charlier and the same cause: the
  // `weave` interleaves two halves by moving cards through each other rather than
  // between each other (`bend` measures 0, `weave` owns all of it).
  //
  // RE-MEASURED AND RATCHETED DOWN, twice. The seed carried headroom because the
  // lesson was being re-authored while this gate landed (the same probe read
  // 0.0808/5472 and then 0.0679/3635 twenty minutes apart). It has since settled on a
  // `tableTop` grip, and then the weave's hand rise was raised specifically to reduce
  // this: 3674 defect pair-frames -> 963, worst crossing 22.7 -> 19.8 card
  // thicknesses, peak 636 pairs in a frame -> 189.
  //
  // RATCHETED DOWN AGAIN after finding the dominant cause: THE BOW. A card bowed `b`
  // stands its ends (1-cos((CARD_H/2)b))/b off its own centre plane, and a stack
  // spaces cards ONE thickness apart - so at BEND 1.1 the arch was 35 card
  // thicknesses and crossings were unavoidable. BEND 1.1 -> 0.8 (arch 35 -> 26) took
  // this from 963 pair-frames at 19.8 cards to 533 at 12.2, with the peak in one frame
  // 189 -> 89 and nothing else regressing. It is the same geometry as the wash's
  // clipping; the difference is that the riffle must KEEP a visible bow, so the arch
  // is traded down rather than removed.
  //
  // STILL NOT ZERO, and what remains is structural. 12.2 card thicknesses is still
  // about the height of the packet being crossed - a card passing through the other
  // half -
  // and it happens because an UN-RELEASED card keeps its full footprint at its half's
  // station while the merged stack grows underneath it. Swept and rejected: `midBend`
  // is irrelevant (0.35 -> 0 moves the depth by 0.2 of a card), and CONVERGING the
  // hands during the weave - which is what a dealer does - takes the suite to 44-80
  // failures because the closing hands press into the pile they are building. The real
  // repair is the THINNING PACKET primitive named in ARCHITECTURE's open work: a
  // draining half should shrink toward the junction rather than stand full-size until
  // its last card leaves. That removes the overlap instead of mitigating it.
  riffle: { depth: 0.019, pairs: 480 }, // measured 0.0184 = 6.1 cards, 471 pairs
}

// ---------------------------------------------------------------------------
// INERT CONTACT: a MOVING hand is ON a card and the card does not move.
//
// The RECIPROCAL of CAUSALITY_BUDGET, and the app needed both. That one asks "did a
// card that MOVED have anything to move it"; this asks whether a hand that is
// plainly pushing something is pushing anything. A lesson can satisfy the first
// completely and still show a palm sweeping straight through a static spread, which
// is what a user described as "the hands are moving while the cards are not and that
// doesn't make sense" - with every existing metric green.
//
// Only hands that are THEMSELVES moving are counted, so a hand resting on a still
// card is not a fault. Same DRIVE_BAND and MOVE_SPEED as the causality metric, so
// the two are reciprocal over exactly the same notion of "on" and "moving".
const HAND_MOVING = 0.05 // wu/s: below this the hand is not doing anything either
const INERT_SAMPLES = CAUSALITY_SAMPLES
const INERT_BUDGET = {
  default: 1,
  overhand: 0.19, // measured 0.17, worst `gather`
  charlier: 0.12, // measured 0.08, worst step `approach`
  riffle: 0.04, // measured 0.03, worst step `rest`
  // RECORDED AS BROKEN. 45% is the worst in the catalog by a factor of two, and the
  // wash now fails in BOTH directions at once: half its moving cards have nothing
  // moving them (CAUSALITY_BUDGET, 50%) and nearly half the time a moving hand is on
  // a card the card does not budge. Its hands and its cards are close to decoupled.
  //
  // RECORDED AS BROKEN AT 45% AND THEN HALF-FIXED IN THE SAME PASS. 45% was the
  // worst in the catalog by a factor of two, and the wash was failing in BOTH
  // directions at once: half its moving cards had nothing moving them
  // (CAUSALITY_BUDGET) and nearly half the time a moving hand was on a card the card
  // did not budge. Its hands and its cards were close to decoupled.
  //
  // Two changes, and it matters which did the work:
  //   * The clipping fix (flat cards, heights in stacking order) moved it ONE point,
  //     45.4% -> 44.9%. It removed the per-pass vertical re-randomisation, which is
  //     real and small. Recorded because the tempting story is that it did more.
  //   * The smoosh stagger came to spread 0.55 / span 0.6 from 0.7 / 0.4, and that
  //     took it 45% -> 30%. The reason has a size: a palm's pad patch is 0.77 x 0.79
  //     over a spread at 12x coverage, so about TEN cards sit under a hand at any
  //     instant, and a window that only moves one or two of them at a time leaves the
  //     rest inert under a palm that is demonstrably on them. Swept in the lesson at
  //     that call site, with causality held at 49-52% throughout.
  //
  // 30% IS STILL THE WORST IN THE CATALOG and the remaining cause is structural, not
  // a knob: `stagger: {by:'contact'}` gives every card the SAME span around its own
  // contact instant, so the two metrics pull against each other - lengthening frees
  // cards to drift unattended, shortening leaves more inert. The fix that improves
  // both is a PER-CARD span taken from how long the hand is actually over that card,
  // which lives in compileLesson's stagger and not here.
  wash: 0.32, // measured 0.30, worst smoosh-2
}

// ---------------------------------------------------------------------------

const _iPrevC = new Map()
const _iPrevH = new Map()
const _iPts = []
const _iP = new THREE.Vector3()
const _iSides = []

function measureInertContact(track) {
  const dt = track.duration / INERT_SAMPLES / 1000
  let onCard = 0
  let inert = 0
  const perStep = new Map()
  _iPrevC.clear()
  _iPrevH.clear()
  // SNAPSHOT PLAIN NUMBERS: `sampleTrack` reuses its card and hand objects, so a
  // retained reference reads the CURRENT pose and everything measures as motionless.
  {
    const s0 = sampleTrack(track, 0)
    for (const [id, c] of s0.cards) _iPrevC.set(id, [c.pos.x, c.pos.y, c.pos.z])
    for (const side of BOTH_HANDS) {
      const h = s0.hands[side]
      if (h) _iPrevH.set(side, [h.wrist.pos.x, h.wrist.pos.y, h.wrist.pos.z])
    }
  }
  for (let i = 1; i <= INERT_SAMPLES; i++) {
    const ms = (track.duration * i) / INERT_SAMPLES
    const scene = sampleTrack(track, ms)
    const step = track.steps.find((q) => ms >= q.tStart && ms <= q.tEnd)
    _iSides.length = 0
    for (const side of BOTH_HANDS) {
      const pose = scene.hands[side]
      if (!pose) continue
      const q = _iPrevH.get(side)
      const w = pose.wrist.pos
      const v = q ? Math.hypot(w.x - q[0], w.y - q[1], w.z - q[2]) / dt : 0
      if (q) {
        q[0] = w.x
        q[1] = w.y
        q[2] = w.z
      } else _iPrevH.set(side, [w.x, w.y, w.z])
      if (v >= HAND_MOVING) _iSides.push(side)
    }
    handSurfacePoints(scene, _iPts, _iSides)
    for (const [id, c] of scene.cards) {
      const q = _iPrevC.get(id)
      const v = q ? Math.hypot(c.pos.x - q[0], c.pos.y - q[1], c.pos.z - q[2]) / dt : 0
      if (q) {
        q[0] = c.pos.x
        q[1] = c.pos.y
        q[2] = c.pos.z
      } else _iPrevC.set(id, [c.pos.x, c.pos.y, c.pos.z])
      if (!_iPts.length) continue
      let near = Infinity
      for (let k = 0; k < _iPts.length; k++) {
        const pt = _iPts[k]
        _iP.set(pt[0], pt[1], pt[2])
        const d = surfaceGap(_iP, c) - pt[3]
        // Guard the comparison, not the accumulator: one NaN used to poison `near`
        // for good and break the loop early (see the causality note above).
        if (Number.isFinite(d) && d < near) near = d
        if (near <= DRIVE_BAND) break
      }
      if (near > DRIVE_BAND) continue
      onCard++
      if (v < MOVE_SPEED) {
        inert++
        const sid = step?.id ?? '?'
        perStep.set(sid, (perStep.get(sid) ?? 0) + 1)
      }
    }
  }
  if (!onCard) return null
  const worst = [...perStep.entries()].sort((a, b) => b[1] - a[1])[0]
  return {
    onCard,
    inert,
    frac: inert / onCard,
    worst: worst ? `${worst[0]} (${worst[1]})` : '-',
  }
}

// Fraction of gripping-fingertip samples in contact across a whole track, plus
// the median gap (the live signal for the ratchet above).
// WHY THE SURFACE SET IS REPORTED. `contacts` is scored-only: it no longer changes
// how a hand LOOKS (that is `pressure`), and `CONTACT_FLOOR` is a ratchet that only
// goes up. So the cheapest way to raise a floor is now to score FEWER surfaces, and
// it leaves no trace in the render. The printed `n` does not catch it either, because
// `n` moves with sample density, not with set size.
//
// This is not hypothetical. Switching the charlier's `indexPivot` from the index TIP
// to its CREST took the floor 74% -> 82%, which reads as an improvement, while the
// same change drove `max finger-in-card` 0.0162 -> 0.0908 and pierced a card. The
// floor REWARDED a phalange going 90mm into the deck. Only CARDS PIERCED caught it.
//
// So print the set. A silent drop from three surfaces to one is then visible in the
// one line anyone actually reads.
//
// AND PRINT IT PER SET, NOT AS A UNION, because the first version of this print was
// itself defeated. `contacts` can be overridden PER BEAT, so a lesson can score its
// hardest beat on one surface while every other beat keeps three - and a union then
// prints the wide set and hides the narrow one. The riffle does exactly that (its
// weave scores on the middle alone while the rest of the lesson scores index and
// middle), and the union read `[index middle]` with nothing to suggest otherwise.
// Each distinct set is now printed with its own sample count.
function measureContact(track) {
  const gaps = []
  // Keyed by the scored SET, not flattened into one union. A per-beat `contacts`
  // override can narrow one beat while the union still looks wide, which defeated
  // the whole point of printing this - see the note above the print.
  const bySet = new Map()
  let hits = 0
  for (let i = 0; i <= 200; i++) {
    const ms = (track.duration * i) / 200
    let scene = null
    for (const h of track.holds ?? []) {
      if (ms < h.tStart || ms > h.tEnd) continue
      // THE SCORED SET IS `contacts`, NOT `pressure`. Those used to be the same
      // map, which meant a grip could not say "these fingers squeeze but are not
      // the things touching the cards" - and a palm-up cradle, whose cards rest on
      // the PALM with no fingertip owning them, could not be expressed at all.
      // `gripContacts` falls back to `Object.keys(pressure)` read as fingertips
      // wherever a frame declares no `contacts`, so every pre-existing frame
      // scores exactly as it did. `h.contacts` lets one BEAT override the frame's
      // set, which is how a release window names only the surfaces still on the
      // cards instead of the floor being cut again.
      const grippers = gripContacts(h.frame, h.contacts)
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
      const setKey = Object.keys(grippers)
        .map((k) => {
          const d = grippers[k]
          return d.kind === 'tip' ? d.finger : `${d.finger ?? d.region ?? 'palm'}:${d.kind}`
        })
        .sort()
        .join(' ')
      bySet.set(setKey, (bySet.get(setKey) ?? 0) + Object.keys(grippers).length)
      for (const key of Object.keys(grippers)) {
        const desc = grippers[key]
        contactSurfaceWorld(pose, h.side, desc, _ct)
        let best = Infinity
        for (const c of held) best = Math.min(best, surfaceGap(_ct, c))
        // A tip descriptor's point is a JOINT CENTRE, so it owes its own distal
        // radius; a palm or crest point is already ON the skin and owes nothing.
        // Charging a radius for a palm point reports a grip that is touching as
        // one whole radius clear of the cards.
        const gap = best - contactSurfaceRadius(desc)
        gaps.push(gap)
        if (Math.abs(gap) < CONTACT_BAND) hits++
      }
    }
  }
  if (!gaps.length) return null
  gaps.sort((a, b) => a - b)
  return {
    frac: hits / gaps.length,
    median: gaps[gaps.length >> 1],
    n: gaps.length,
    // Largest set first, so the widest claim leads and any narrower one reads as
    // the exception it is.
    sets: [...bySet.entries()].sort((a, b) => b[1] - a[1]),
  }
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
  let maxPierce = 0
  let pierceWhere = ''
  let pierceAt = 0
  const snaps = new Map()
  for (const t of ordered) {
    const scene = sampleTrack(track, t)
    assertFinite(scene, `${lesson.id}@${t.toFixed(1)}`)
    assertAboveFelt(scene, `${lesson.id}@${t.toFixed(1)}`)
    maxPen = Math.max(maxPen, assertNoPenetration(scene, `${lesson.id}@${t.toFixed(1)}`, penBudget))
    const pierce = countPierced(scene)
    if (pierce.count > maxPierce) {
      maxPierce = pierce.count
      pierceWhere = pierce.where
      pierceAt = t
    }
    snaps.set(t, JSON.stringify(snapshot(scene)))
  }
  check(
    maxPierce <= PIERCE_BUDGET,
    `${lesson.id}: ${maxPierce} cards pierced at ${pierceAt.toFixed(0)}ms - ${pierceWhere} (budget ${PIERCE_BUDGET})`,
  )

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
  // Pass 5c: overlapping cards may not trade which one is on top.
  const stack = measureStacking(track, { fps: 60 })
  const swapBudget = SWAP_BUDGET[lesson.id] ?? SWAP_BUDGET.default
  if (stack) {
    check(
      stack.swaps <= swapBudget,
      `${lesson.id}: ${stack.swaps} top-card swaps (${stack.swapsPerSec.toFixed(1)}/s, budget ${swapBudget}); ` +
        `worst covered ${(100 * stack.swapAreaPct.max).toFixed(0)}% of a card face at ${Math.round(stack.worstSwapAt ?? 0)}ms`,
    )
  }

  // Pass 5b: the two hands may not share a volume.
  const clash = measureHandClash(track)
  const clashBudget = CLASH_BUDGET[lesson.id] ?? CLASH_BUDGET.default
  if (clash) {
    check(
      clash.worst >= clashBudget,
      `${lesson.id}: the hands INTERPENETRATE by ${(-clash.worst / CARD_T).toFixed(1)} card thicknesses ` +
        `(${clash.where} in ${clash.step}); worst allowed clearance ${clashBudget}`,
    )
  }

  // Pass 5: cards may only move because something moves them.
  const cause = measureCausality(track)
  const causeBudget = CAUSALITY_BUDGET[lesson.id] ?? CAUSALITY_BUDGET.default
  if (cause) {
    check(
      cause.frac <= causeBudget,
      `${lesson.id}: ${(cause.frac * 100).toFixed(0)}% of moving-card samples are UNMOTIVATED ` +
        `(no grip, no hand on the card, not gravity; budget ${(causeBudget * 100).toFixed(0)}%, worst step ${cause.worst})`,
    )
  }
  // Pass 6: no card may pass THROUGH another card.
  const clipBudget = CLIP_BUDGET[lesson.id] ?? CLIP_BUDGET.default
  const clip = measureClipping(track)
  check(
    clip.defect.worstDepth <= clipBudget.depth,
    `${lesson.id}: card clips ${clip.defect.worstDepth.toFixed(4)} = ${(clip.defect.worstDepth / CARD_T).toFixed(1)} cards through another ` +
      `(${clip.defect.worstDepthAt ? `${clip.defect.worstDepthAt.a} x ${clip.defect.worstDepthAt.b} @ ${clip.defect.worstDepthAt.ms.toFixed(0)}ms` : '-'}; ` +
      `budget ${clipBudget.depth} = ${(clipBudget.depth / CARD_T).toFixed(1)} cards)`,
  )
  check(
    clip.defect.pairs <= clipBudget.pairs,
    `${lesson.id}: ${clip.defect.pairs} clipping card pairs over ${clip.frames} frames ` +
      `(budget ${clipBudget.pairs}, worst step ${clip.steps.slice().sort((a, b) => b.raw.defects - a.raw.defects)[0]?.id ?? '-'})`,
  )
  // Pass 7: a moving hand on a card must actually move it.
  const inert = measureInertContact(track)
  const inertBudget = INERT_BUDGET[lesson.id] ?? INERT_BUDGET.default
  if (inert) {
    check(
      inert.frac <= inertBudget,
      `${lesson.id}: ${(inert.frac * 100).toFixed(0)}% of hand-on-card samples have the card INERT under a MOVING hand ` +
        `(budget ${(inertBudget * 100).toFixed(0)}%, worst step ${inert.worst})`,
    )
  }
  console.log(
    `  duration ${(track.duration / 1000).toFixed(1)}s, ${bounds.length} boundaries, max jump ${maxJump.toFixed(4)}` +
      // IN CARD THICKNESSES, always, beside the world-unit figure. A depth of
      // 0.0142 reads as negligible and is not: a card is CARD_T = 0.003 thick, so
      // that is nearly FIVE CARDS of finger inside the deck, and a 52-card deck is
      // only 0.156 tall - about 9% of its height. This unit was added after a whole
      // session of treating these numbers as small because they are small in world
      // units, while a viewer was plainly seeing fingers sink into the cards. A card
      // is the only object on screen with a known real size; it is the ruler here
      // exactly as it is in handRigSpec.
      `, max finger-in-card ${maxPen.toFixed(4)} = ${(maxPen / CARD_T).toFixed(1)} cards (budget ${penBudget} = ${(penBudget / CARD_T).toFixed(1)} cards)` +
      `, cards pierced ${maxPierce} (budget ${PIERCE_BUDGET})` +
      (contact
        ? `, contact ${(contact.frac * 100).toFixed(0)}% of ${contact.n} (floor ${(floor * 100).toFixed(0)}%), median gap ${contact.median.toFixed(3)}` +
          `, scored on ${contact.sets.map(([k, n]) => `[${k}]x${n}`).join(' + ')}`
        : ''),
  )
  // IN CARD THICKNESSES, for the same reason the line above is: a 0.0678 crossing
  // reads as nothing and is 22.6 cards of one card inside another.
  console.log(
    `    card-vs-card: worst clip ${clip.defect.worstDepth.toFixed(4)} = ${(clip.defect.worstDepth / CARD_T).toFixed(1)} cards ` +
      `(budget ${clipBudget.depth} = ${(clipBudget.depth / CARD_T).toFixed(1)} cards), ` +
      `${clip.defect.pairs} clipping pairs of ${clip.frames} frames (budget ${clipBudget.pairs}), ` +
      `worst seam ${(clip.defect.worstLength * 100.8).toFixed(1)}mm, peak ${clip.defect.peakDefectFrame} at once` +
      `; gate depth >= ${(DEFECT.depth / CARD_T).toFixed(1)} cards AND length >= ${(DEFECT.length * 100.8).toFixed(0)}mm`,
  )
  if (inert) {
    console.log(
      `    inert contact: ${inert.inert} of ${inert.onCard} hand-on-card samples have the card STILL under a moving hand - ` +
        `${(inert.frac * 100).toFixed(0)}% (budget ${(inertBudget * 100).toFixed(0)}%), worst ${inert.worst}`,
    )
  }
  if (stack) {
    console.log(
      `    top-card swaps: ${stack.swaps} = ${stack.swapsPerSec.toFixed(1)}/s (budget ${swapBudget})` +
        `, ${stack.bigSwaps} over a quarter of a face, median ${(100 * stack.swapAreaPct.p50).toFixed(0)}%` +
        `, max card-plane tilt ${stack.maxTiltDeg.toFixed(2)}deg`,
    )
  }
  if (clash) {
    const t =
      clash.worst < 0
        ? `${(-clash.worst / CARD_T).toFixed(1)} cards INSIDE`
        : `${(clash.worst * 100.79).toFixed(1)}mm clear`
    console.log(
      `    hand vs hand: ${t} (budget ${(-clashBudget / CARD_T).toFixed(1)} cards)` +
        `, worst ${clash.where} in ${clash.step}`,
    )
  }
  if (cause) {
    console.log(
      `    causality: ${cause.moving} moving samples - ` +
        `${((100 * cause.gripped) / cause.moving).toFixed(0)}% gripped, ` +
        `${((100 * cause.driven) / cause.moving).toFixed(0)}% hand on card, ` +
        `${((100 * cause.gravity) / cause.moving).toFixed(0)}% gravity, ` +
        `${(cause.frac * 100).toFixed(0)}% UNMOTIVATED (budget ${(causeBudget * 100).toFixed(0)}%)` +
        `, worst ${cause.worst}`,
    )
  }
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
  const stepAt = (id) => track.steps.find((s) => s.id === id)
  const release = stepAt('release')
  const pivot = stepAt('pivot')
  const fall = stepAt('fall')
  check(!!release && !!pivot && !!fall, 'charlier: release/pivot/fall steps missing')
  // WHICH 26 CARDS ARE THE BOTTOM PACKET IS READ OFF THE TABLE, not off the deck
  // array. This used to be `deck.slice(0, mid)` - the pristine order - which
  // silently assumes the lesson never reorders the deck before it cuts. The
  // charlier now TURNS THE DECK OVER first, and turning a deck over reverses it,
  // so that assumption picked the wrong half and this block failed on a lesson
  // that was doing exactly what it claims (min tip distance 0.739 - the far half,
  // clear across the hand). Taking the 26 LOWEST cards at the end of `release` is
  // both reorder-proof and closer to what the check means: the bottom packet is
  // the one that has just dropped into the crook.
  const atRelease = sampleTrack(track, release.tEnd)
  const byHeight = [...atRelease.cards.entries()]
    .map(([id, c]) => ({ id, y: c.pos.y }))
    .sort((a, b) => a.y - b.y)
  const bottomIds = byHeight.slice(0, mid).map((r) => r.id)
  const topIds = byHeight.slice(mid).map((r) => r.id)

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
