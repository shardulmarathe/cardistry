import * as THREE from 'three'
import { faceQuat } from '../engine/layouts'
import { shuffleArray } from '../../lib/shuffleMath'
import { CARD_GAP, CARD_H, CARD_T, CARD_W, FELT_Y } from '../../lib/constants'
import { DECK_REST_DROP, DECK_APPROACH_DROP } from '../../hands/handPoses'
import { FINGERS, FINGER_NAMES, HAND_SCALE } from '../../hands/handRigSpec'
import { poseWithContacts, rigMetrics, surfaceContact, wristAnchorForContact } from '../authoring/contacts'
import { fingerJointsWorld, fingertipWorld } from '../../hands/handKinematics'
import { IDLE_WRIST_AMP } from '../../hands/handMotion'

// Card wash where the HANDS do the washing. Each palm owns one half of the
// table and circles over it; a card only moves when that palm passes over it:
// its swirl is centred on the hand's orbit, scaled by how close it sits to the
// hand's actual path, and its motion window is staggered to the moment the
// hand sweeps through its angle. The gather is two plow sweeps, each hand
// pushes its half of the spread into the middle, nearest-to-the-hand first.

// --- The smoosh hand ---------------------------------------------------------
// `washPress` is authored palm-down with the fingers pointing at the CAMERA and
// the thumb abducted straight out to −x, where it is a whole hand long: at the
// old rig scale it stuck out 0.55 and the two mirrored palms merely brushed, and
// it grew with the rig until both thumbs would have swept clean through each
// other across the middle of the table. Yaw the press INWARD instead, the same
// REACH_IN turn deckRest and the plow already use, and each hand reaches in from
// its own side with the fingertips leading. (The thumb is then dealt with
// properly, by tucking it — see THUMB_FLAT below. Yawing the hand only moved the
// problem: it put the thumb outboard instead of across the table.) Authored
// ONCE, for the right hand: the engine's x-mirror gives the left hand the
// correct opposite yaw (never mirror a quaternion by hand).
const PALM_DOWN = Math.PI / 2
const REACH_IN = Math.PI
const PRESS_QUAT = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(PALM_DOWN + 0.06, REACH_IN, 0, 'YXZ'),
)

// --- The rake ----------------------------------------------------------------
// A wash IS palm-driven, there is no finger trick hiding in it, but a palm is
// not a paddle. Real hands rake: the fingers splay and flex through the spread
// while the heel drives it, and cards move because a PAD crossed them, not
// because a rigid shape flew over them. So the press pose is a family, not a
// constant: one curl parameter, one splay parameter, and every hand height in
// this file is re-measured for whichever member of the family is on screen.
//
// THE CURL SITS SLIGHTLY BACK. `fingerMotion` is a SINE, it swings a joint both
// ways around the pose it is applied to, and on a palm-down hand curling drives
// the pads DOWN, i.e. into the felt and through the cards. Authoring the rake
// around a small hyperextension (JOINT_LIMITS allows -0.25) means the downswing
// only brings the fingers back to flat, and the anchor below is measured at the
// DEEPEST phase, so the whole oscillation happens above the cards.
//
// THE AMPLITUDE IS 0.08, DOWN FROM 0.17, and that is a measurement rather than
// a preference. `applyFingerMotion` spreads its swing over three joints as
// [1, 0.7, 0.45], so a 0.17 amplitude bent the whole chain by ±0.37 rad, and on
// a 0.9-long finger that flew the pads through a 0.40 arc in y — 40mm, most of
// a card width, above cards whose top faces sit at y 0.05. Since the anchor is
// measured at the deepest phase, all 40mm of it was AIR: the pads touched at one
// instant per ripple and hovered a card-width up for the rest. At 0.08 the swing
// is 0.19, the hand still reads as raking rather than sliding, and the palm
// stays where a wash keeps it, which is on the cards.
const RAKE_BASE = -0.09
const RAKE_AMP = 0.08
// THE THUMB IS PART OF THE SQUEEGEE, not a hitchhiker. `washPress` inherits the
// rig's default opposition (THUMB_BASE_ROT z 1.2), which under this palm-down
// yaw cocks the thumb UP and OUTBOARD: measured with the wrist at the origin,
// its tip sat at (1.13, +0.32, 0.05), i.e. 0.32 ABOVE the wrist and a whole
// card-length outboard of the index. That one digit was most of this lesson's
// rake footprint — it alone put pads at |x| 2.53 and z 1.71 while the cards
// stopped at 1.33 and 0.40 — and it touched nothing the whole lesson.
//
// Nothing is gripped in a wash, so opposition has no job here at all. Swinging
// it back (thumbOpp.z) and down (thumbOpp.x) lays the thumb alongside the index
// with its pad on the felt: tip (0.31, -0.04, -0.58), and its own deepest
// surface within 0.005 of the four fingers' at the deepest rake phase, so it
// rakes WITH them and does not lift the hand off them. Swept, not typed: at
// z -1.3 the thumb still leads the index by 0.10, at z -1.6 it hides under the
// palm, and thumbOpp.x below 0.35 leaves the pad in the air.
const THUMB_FLAT = { z: -1.45, x: 0.35 }
const rakeCurl = (c) => [c, c * 0.8, c * 0.55]
// `spread` is nearly inert on a straight-fingered hand and that is a rig fact
// worth writing down rather than re-discovering: the rig's abduction is a
// knuckle yaw about the finger's OWN axis (handKinematics' knuckleEuler puts it
// in the Y slot), so it rotates the plane a finger curls in and leaves a
// straight finger exactly where it was. Measured: every fingertip of this pose
// is identical at spread 0.5 and 0.7. It is kept because it does separate the
// pads once the ripple curls them, and because a pass wants to look different
// from the pass before it.
function rakePose(c, spread) {
  const p = poseWithContacts('washPress', 'right', { quat: PRESS_QUAT })
  for (const name of FINGER_NAMES) {
    p.fingers[name] = rakeCurl(name === 'thumb' ? c * 0.7 : c)
  }
  p.spread = spread
  p.thumbOpp = { ...THUMB_FLAT }
  return p
}
// The phase of the rake that reaches DEEPEST, the one the hand height must be
// measured against, since `applyFingerMotion` distributes its swing over the
// three joints as [1, 0.7, 0.45].
const rakeDeepest = (c, spread) => {
  const p = rakePose(c, spread)
  for (const name of FINGER_NAMES) {
    const a = p.fingers[name]
    p.fingers[name] = [a[0] + RAKE_AMP, a[1] + RAKE_AMP * 0.7, a[2] + RAKE_AMP * 0.45]
  }
  return p
}
const PRESS_POSE = rakePose(RAKE_BASE, 0.5)
// Measured under that yaw, on the deepest phase of the rake, the press pose's
// own DECK_REST_DROP.
const PRESS = rigMetrics(rakeDeepest(RAKE_BASE, 0.5), PRESS_QUAT)
// Breathing room the idle overlay and the ease into a pose need. Hand-sized:
// a bigger hand breathes bigger.
//
// HALVED to match `contacts.js`, which halved its own copy of this and recorded
// why: at HAND_SCALE 11, 0.003 is 0.033 of permanent air, 5% of a card width,
// under every pad — on its own more than the 0.025 band anything could call
// contact. Measured on this lesson before the change, the lowest finger surface
// in the whole smoosh was 0.0585 against a top card face at 0.0355: the palms
// were raking 23mm of air above the cards they were supposedly pushing. At
// 0.0015 the deepest rake phase closes to 6mm, which is a graze, and a graze is
// what contact is. The idle overlay's own pad travel is ~0.017 at full curl
// amplitude and this rake runs at half that, so it still cannot push a pad
// through a card.
const CONTACT_AIR = 0.0015 * HAND_SCALE

// A flat face-down card, the plane every hand in this lesson meets.
const FLAT = faceQuat(false)
const flatCard = (x, y, z) => ({ pos: [x, y, z], quat: FLAT })
// Where must the wrist sit for `pose`'s pads to rest on a card lying flat at
// (x, z) with its CENTRE at height y? x/z come from solving the middle pad onto
// the card through `surfaceContact` (already radius-aware); y comes from the
// pose's measured DROP, which is taken from its DEEPEST capsule surface rather
// than the one pad being aimed. Every hand-sized part of the answer is measured
// off the rig, so all of it tracks HAND_SCALE for free.
const padAt = (pose, quat, drop, x, y, z, lift = 0) => {
  const a = wristAnchorForContact(
    pose,
    'right',
    'middle',
    surfaceContact(flatCard(x, y, z), { finger: 'middle' }).toArray(),
    quat,
  )
  return [a[0], y + drop + lift, a[2]]
}
const PRESS_DROP = CARD_T / 2 + PRESS.drop + CONTACT_AIR
// Solved against the RAKE pose, not the bare preset: the two have different
// reaches once the fingers are splayed, and it is the pose on screen whose pad
// has to land on the card.
const pressAt = (x, y, z, lift = 0) => padAt(PRESS_POSE, PRESS_QUAT, PRESS_DROP, x, y, z, lift)
// THE PLOW HAND IS THE SAME HAND, so its thumb is tucked too. `deckApproach` is
// yawed the other way (fingertips lead inboard, −x), which parks the wrist a
// hand-length OUTBOARD of the pads it is pushing with — structural, a hand that
// pushes cards in from the edge has to have its body outside the edge. What was
// not structural is the thumb: at the preset's default opposition its tip sat
// 0.06 from the wrist, i.e. the outermost FINGERTIP in the lesson, 2.99 out
// while the cards ended at 1.30. Tucked, its tip sits 0.60 inboard of the wrist,
// alongside the fingers, and its own deepest surface is 0.18 against the
// fingers' 0.47 — so it never becomes the surface that sets the hand's height.
const PLOW_THUMB = { z: -1.4, x: 0.2 }
const plowThumbed = (name) => {
  const p = poseWithContacts(name, 'right', {})
  p.thumbOpp = { ...PLOW_THUMB }
  return p
}
const PLOW_POSE = plowThumbed('deckApproach')
// The open/rest poses are already yawed inward, so they need no quat override,
// and their exported DROP constants are this same measurement plus its air.
const openAt = (x, y, z, lift = 0) => padAt(PLOW_POSE, null, DECK_APPROACH_DROP, x, y, z, lift)
// The plow rakes too, the fingers hook and release as they corral, which is
// what stops a sweep reading as a bulldozer blade. Its hand rides that much
// higher, measured on the deepest phase of the hook rather than assumed: a
// `curlRipple` on a palm-down hand drives the pads DOWN, and `deckApproach`'s
// own drop is measured with its fingers nearly straight.
const PLOW_AMP = 0.16
const PLOW_DEEP = (() => {
  const p = plowThumbed('deckApproach')
  for (const name of FINGER_NAMES) {
    const a2 = p.fingers[name]
    p.fingers[name] = [a2[0] + PLOW_AMP, a2[1] + PLOW_AMP * 0.7, a2[2] + PLOW_AMP * 0.45]
  }
  return p
})()
const PLOW_LIFT = Math.max(
  0,
  CARD_T / 2 + rigMetrics(PLOW_DEEP).drop + CONTACT_AIR - DECK_APPROACH_DROP,
)
const PLOW_RAKE = [
  { fingers: ['index', 'middle', 'ring', 'pinky'], type: 'curlRipple', amp: PLOW_AMP, cycles: 2, phase: 0.7 },
]
// The closing hands get the same tuck. `deckRest`'s default thumb points a full
// 1.20 in −z, away from the camera and away from everything it could touch,
// which is what put pads at z −1.09 in every beat that used it: `ready`, the
// first 40% of `spread` (which eases out of it), `square` and `rest`. It is
// still braced outside the deck's long edge (pad at x 0.85 against a half-width
// of 0.32) and still 0.35 above the top card, so nothing about the contact
// changes; it just stops being a spike.
const REST_POSE = plowThumbed('deckRest')
const restAt = (x, y, z) => padAt(REST_POSE, null, DECK_REST_DROP, x, y, z)

// --- The field, which is also the budget -------------------------------------
// TWO ROWS ACROSS A WIDE FIELD, not a round heap. A uniform disc of radius 1.0 read as
// one clumped pile in the middle of the table, which is not what a wash looks like: the
// cards go out over as much felt as the arms can cover, and a dealer's spread ends up
// wide and shallow rather than circular. Splitting the deck between two z bands and
// spreading it to +-1.34 in x gives that, and it fits the frame - `washTable` allows
// 3.31 of half-width against the 2.14 this reaches once the smoosh moves cards around.
//
// The direction of the widening is set by what the CAMERA can see: after the near-side
// rework the wash had 1.42 of usable depth and was already using 1.27 of it, while
// leaving most of its width unused. So this spends width, which was free, and leaves z
// close to where it was.
//
// These numbers are declared HERE, above the hands, because they are the hands'
// budget: every pad in this lesson is placed against the field the cards occupy,
// not the other way round.
const SPREAD_X = 1.34
const ROW_Z = [-0.3, 0.2]
const ROW_HALF = 0.2
const ROW_MID = (ROW_Z[0] + ROW_Z[1]) / 2

// Each hand's circular smoosh, in WORLD coords, authored around the PALM'S
// CONTACT PATCH rather than its wrist, at this scale those are 1.83 apart, so
// orbiting the wrist over the spread swings the actual pads a card-length and a
// half off the table. The right hand's pads orbit C=(CX,CZ); the left hand is
// the engine's x-mirror, so its centre is −CX and its visual direction is
// reversed. `cyc` (+1/−1) is the authored orbit sign.
//
// THE TWO HANDS DO NOT MAKE THE SAME CIRCLE, and that is not decoration: it is
// what buys the room to keep the sweep inside the cards. Two mirror-image orbits
// reach their inner point at the SAME instant, so the collision rule had to hold
// at CX − AMP, which forced CX = AMP + lead + gap/2 and pushed the pads to
// |x| 2.53 against a card field ending at 1.33. Run the left hand HALF A CYCLE
// out of phase (`motion.phase` 0.5, with its anchor moved to the other side of
// its centre to match) and the x separation of the two pad arrays is
// 2·CX + (ampR − ampL)·cos, i.e. CONSTANT to within the amplitude difference —
// the AMP term drops out of the collision rule entirely and the amplitude is
// then free to be whatever fits the felt. It also looks like hands: one palm
// reaching in while the other reaches out, which is what a wash actually is.
const TIP_R = FINGERS.middle.rad[2] * HAND_SCALE
// Air left between the two hands at closest approach: a fingertip's diameter,
// plus the worst case of the idle overlay pulling both wrists toward each other
// at once (handMotion's IDLE_WRIST_AMP, per hand). Without that second term the
// measured closest approach comes in at 0.1536 against a designed 0.159 — small,
// but the sign is wrong.
const PALM_GAP = 2 * TIP_R + 2 * IDLE_WRIST_AMP
// The hand's own footprint, measured off the rig with the wrist at the origin,
// over every rake phase the lesson shows: the fingertip envelope RELATIVE TO THE
// MIDDLE PAD (the pad every anchor in this file is solved against), plus how far
// inboard of it the nearest capsule SURFACE reaches, which is the part that
// meets the other hand. Nothing here is typed as a world constant, so all of it
// tracks HAND_SCALE and any change to the pose family for free.
const _rj = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
const _rp = new THREE.Vector3()
const _rm = new THREE.Vector3()
function padPatch(poses) {
  const out = { x: [Infinity, -Infinity], z: [Infinity, -Infinity], surfIn: Infinity }
  for (const src of poses) {
    const p = poseWithContacts(src, 'right', { quat: PRESS_QUAT })
    p.wrist.pos.set(0, 0, 0)
    fingertipWorld(p, 'right', 'middle', _rm)
    for (const name of FINGER_NAMES) {
      fingertipWorld(p, 'right', name, _rp)
      out.x[0] = Math.min(out.x[0], _rp.x - _rm.x)
      out.x[1] = Math.max(out.x[1], _rp.x - _rm.x)
      out.z[0] = Math.min(out.z[0], _rp.z - _rm.z)
      out.z[1] = Math.max(out.z[1], _rp.z - _rm.z)
      fingerJointsWorld(p, 'right', name, _rj)
      for (let i = 0; i < 3; i++) {
        const r = FINGERS[name].rad[i] * HAND_SCALE
        for (let k = 0; k <= 4; k++) {
          _rp.copy(_rj[i]).lerp(_rj[i + 1], k / 4)
          out.surfIn = Math.min(out.surfIn, _rp.x - r - _rm.x)
        }
      }
    }
  }
  return out
}
// Every splay the lesson uses, at both ends of the rake's swing.
const RAKE_SPREADS = [0.38, 0.5, 0.62, 0.7]
const PATCH = padPatch([
  ...RAKE_SPREADS.map((s) => rakePose(RAKE_BASE, s)),
  ...RAKE_SPREADS.map((s) => rakeDeepest(RAKE_BASE, s)),
])
// How far INBOARD of its own middle pad the hand's most inboard SURFACE reaches.
// (The rule this replaces, "keep >= 0.5 between the WRISTS", was authored for a
// rig 2.4x smaller: the wrists now clear each other by a factor of eight while
// the FINGERS still crossed. Measure the fingers.)
const PAD_LEAD = -PATCH.surfIn
// The three smoosh passes, as each hand's pad-orbit radius. Alternating which
// palm works the wider arc is the asymmetry a real wash has; keeping the
// difference small keeps the collision rule cheap (it costs half the difference
// in CX, below). The `spread` step reuses pass 1 so that its final anchor is
// pass 1's start anchor and no drift creeps between the two.
const PASS_AMP = [
  { right: 0.4, left: 0.33 },
  { right: 0.33, left: 0.4 },
  { right: 0.4, left: 0.34 },
]
const AMP_SKEW = Math.max(...PASS_AMP.map((p) => Math.abs(p.right - p.left)))
const CX = PAD_LEAD + PALM_GAP / 2 + AMP_SKEW / 2 // pad-orbit centre
// The widest orbit whose OUTERMOST PAD still lands on cards. With the thumb
// tucked level with the index, `PATCH.x[1]` is 0.229, a third of a card width,
// and this comes out at 0.472 against a boldest pass of 0.40 — so the clamp does
// nothing today. It is here so that a bigger hand, a wider splay or a bolder
// pass cannot silently start raking felt: this is the one line in the file that
// makes "the pads stay on the cards" a property rather than a measurement.
const AMP_FIT = SPREAD_X - CX - PATCH.x[1]
const PASS = PASS_AMP.map((p) => ({
  right: Math.min(p.right, AMP_FIT),
  left: Math.min(p.left, AMP_FIT),
}))
// The pad-orbit centre in z, DERIVED so that the pad envelope is centred on the
// card band instead of sitting a quarter of a card in front of it. The hand's
// pad patch is 0.79 deep and none of it is behind the middle pad (the thumb pad
// is the near edge, 78mm behind the middle fingertip, which is anatomy), so the
// centre has to sit that far back for the sweep to straddle the rows.
//
// It moves the wrists AWAY from the camera, which is the safe direction: the
// value this replaces (-0.15, and 0.25 before that) was pushed forward because
// the trailing wrists were dropping off the bottom of frame behind their pads,
// and the transport panel takes the bottom 40%.
const CZ = ROW_MID - (PATCH.z[0] + PATCH.z[1]) / 2
// How high a spread card's CENTRE sits, and therefore how low the palms may ride.
// This used to be typed as 0.034, the top of the scatter's own y jitter, and that
// was wrong by 12mm in a way nothing could see until the pads came down to the
// cards: `sampleTrack`'s `clampAboveFelt` lifts a BOWED card until its ENDS rest
// on the felt, so a card bent 0.35 has its centre pushed from 0.020 to 0.046 and
// its top face to 0.047. The old 33mm of contact air swallowed that silently;
// with the air halved it showed up immediately as five verify failures, all of
// them one proximal capsule 0.002-0.004 inside one bowed card.
//
// So both halves are derived now. A card lying on felt is nearly flat — 0.35 rad
// over an 88mm card is a 34mm arch, a taco rather than a card — and at 0.14 the
// arch is 13.5mm, which is a used card and also less than the scatter's own
// jitter, so the felt clamp never lifts a card above the height the palms are
// measured against. If either number moves, this stays true or the pads sink.
const SCATTER_Y = [0.02, 0.014] // base height, height BAND (see rankHeight)
// ===========================================================================
// BEND_MAX IS ZERO, AND THIS IS THE FIX FOR CARDS CLIPPING THROUGH EACH OTHER.
//
// It was 0.14. Measured with `scripts/inspect/cardClip.mjs` (edge-vs-face, the
// only test that can see a 0.3mm plate crossed at an angle), the wash had 15333
// clipping pair-frames of 176 sampled, up to 3.9 CARD THICKNESSES deep along
// seams up to 43.7mm long, in EVERY step from `spread` to `gather-left`. That is
// the "hard straight seams across a card's face" a user reported, and no metric
// in the harness could see it.
//
// The arithmetic that says a random bend cannot survive this spread:
//
//   * A bent card's surface is a cylinder, and its ends stand
//     bowLift(b) = (1 - cos((CARD_H/2)*b))/b off its centre plane. At 0.14 that
//     is 0.0135 wu = 1.36mm = 4.5 CARD THICKNESSES.
//   * The whole scatter lives in a height band of SCATTER_Y[1] = 0.014, i.e.
//     1.4mm. So one card's ARCH is the entire vertical range the 52 cards are
//     distributed through: every overlapping pair of differently-bowed cards has
//     surfaces that must cross. The clipping was not a tuning error, it was
//     forced by these two numbers.
//   * Spreading them out instead does not work either. 52 cards is 29.1 wu2 of
//     card over a 2.68 x 0.9 field, which is 12x COVERAGE: laying them out by
//     genuine physical stacking (each card lifted clear of every card it
//     overlaps) gives a longest overlap chain of 33, so even at zero bend and a
//     one-thickness step the spread becomes 0.111 tall - a mound 2/3 of a deck
//     high, which lifts every palm with it and forfeits washRake's clearances.
//     Measured, not guessed.
//   * With FLAT cards the problem disappears completely and for free. Cards are
//     rendered as ZERO-THICKNESS planes (one shared PlaneGeometry, two-sided
//     material - CARD_T only exists in the collision maths), and two parallel
//     planes at ANY separation cannot intersect. All that is then needed is that
//     no two overlapping cards share a height, which `rankHeight` guarantees
//     inside the band that is already there. That is why the squared deck and
//     the gather HEAP have always looked clean at zero and quarter-thickness
//     spacing: they are parallel.
//     BUT NOT INTERSECTING IS NOT THE SAME AS LOOKING STACKED, and this block
//     was read for a while as though it were. Distinct heights stop cards
//     crossing; they do not stop an overlapping pair REVERSING which one is on
//     top, and on zero-thickness cards that reversal is the whole visible
//     defect. See the note above `rankHeight`.
//
// So the bend buys 1.4mm of curl on cards lying on a table - a curl a real card
// would have to be badly used to show - and it costs the single most visible
// defect in the app. It is not a knob to retune: for a bend to be safe here,
// bowLift(BEND_MAX) must stay under half the per-card height step below, which
// is 0.014/51 = 0.00027, and that caps the bend at 0.0014 - an arch of 0.014mm,
// invisible. The honest options are FLAT (this) or a genuinely wider table.
// ===========================================================================
const BEND_MAX = 0
// `FELT_Y` is the engine's felt plane (lib/constants). The other term is the
// bend shader's own end-swing: local (x, y, 0) -> (x, sin(yb)/b, (1-cos(yb))/b).
// Kept, and kept in SPREAD_TOP, because it is the expression that says WHY the
// palms may ride where they do: if a bend ever comes back here, the top the
// palms are measured against has to follow it, and it did not used to.
const bowLift = (b) => (b === 0 ? 0 : (1 - Math.cos((CARD_H / 2) * b)) / b)
const SPREAD_TOP = Math.max(SCATTER_Y[0] + SCATTER_Y[1], FELT_Y + bowLift(BEND_MAX))
// Cards SLIDE in a wash, they are never lifted, but the `spread` step gives them
// 2mm of arc so the peel off the stack does not scrape. That 2mm is above every
// resting height above, so the palms of THAT step have to be measured against it
// or they meet a card in flight: the last three verify failures of this pass were
// exactly that, one proximal capsule 0.005-0.010 into a card at 74% of `spread`.
const SPREAD_ARC = 0.02

// The squared deck the lesson opens and closes on: 52 cards, top card centre.
const DECK_TOP = (n) => 0.02 + (n - 1) * CARD_GAP
// Where the pads land on that deck's top card: out near its long edge, on each
// hand's own side, so two hands squaring it do not put their fingers in the
// same place. Card-relative, this one genuinely does not scale with the hand.
const DECK_PAD_X = CARD_W * 0.42

// The left hand's half-cycle phase offset (see the note on PASS_AMP) starts it
// on the INBOARD side of its own centre, so both hands now begin their pass at
// world angle 0 from their own centre. Its visual rotation is still reversed,
// because the engine mirrors x and not z.
const ORBIT_PHASE = { right: 0, left: 0.5 }
function orbitOf(sideX, cyc, amps) {
  return {
    cx: sideX * CX,
    cz: CZ,
    amp: sideX > 0 ? amps.right : amps.left,
    v0: 0, // hand's start angle on its circle
    dir: sideX > 0 ? cyc : -cyc, // visual rotation direction
  }
}

const TAU = Math.PI * 2
const mod = (a, m) => ((a % m) + m) % m

// When (0..1 of the step) does this hand first sweep through world angle a?
function passTime(orbit, a) {
  return mod(orbit.dir * (a - orbit.v0), TAU) / TAU
}

// ===========================================================================
// A CARD'S HEIGHT IS A FIXED RANK, DRAWN ONCE, AND IT NEVER CHANGES AGAIN.
// THIS IS THE SECOND HALF OF THE CLIPPING FIX, and the half that the first one
// needed: BEND_MAX 0 plus `restInOrder` made the CROSSING metric read a hard
// zero while the user was still, correctly, looking at cards inside each other.
//
// WHY THE HARD ZERO WAS NOT EVIDENCE. Every card in this lesson is exactly
// horizontal (`faceQuat` is a yaw about Y on a flat card, so every card normal
// is +-Y; measured, max card-plane tilt 0.000deg). Two horizontal planes at
// different heights never intersect. So the edge-versus-face test that
// `cardClip.mjs` runs cannot report anything but zero here NO MATTER WHAT THE
// HEIGHTS DO - it went vacuous the moment the cards went flat. The argument for
// BEND_MAX 0 is still right; what was wrong was reading its own metric back as
// proof that nothing was left.
//
// WHAT WAS LEFT, measured with `cardClip.mjs`'s stacking pass at 60fps: 2892
// TOP-CARD SWAPS over the lesson, 133 per second, 2110 of them over more than a
// QUARTER of a card face and a median swap covering 44% of a face. A swap is an
// overlapping pair reversing which of the two is above the other. Cards render
// as ZERO-THICKNESS planes with no edge, no side and no shadow cast onto each
// other, so occlusion is the ONLY cue that one card is on top of another - and a
// swap is that cue inverting between two presented frames. There is no
// intermediate state where a card is seen sliding over the other, because there
// is nothing to see sliding. It reads as the two cards passing THROUGH one
// another, which is exactly the complaint: "in real life there is always a card
// on top of one another and the cards do not intersect each other."
//
// WHAT CAUSED THEM. `restInOrder` re-drew all 52 heights every pass and handed
// them back out in that pass's OWN stacking order. So a pair's height order was
// re-rolled three times, and any pair whose order changed had to CROSS during
// the interpolation between the two passes - guaranteed, by the intermediate
// value theorem, not by bad luck. Two further consequences of the same choice:
//   * The heights were a uniform sample, and the minimum gap between 52 uniform
//     draws in a 0.014 band goes as band/n^2. Measured min gap between two
//     OVERLAPPING cards: 5.5e-8 wu, 0.00002 of a card thickness. 513 pair-frames
//     were closer than a thousandth of a card thickness, which is under even a
//     24-bit depth buffer's resolution at this camera (0.0008 CARD_T), so those
//     pairs z-fight per pixel on top of everything else.
//   * A card's height jumped several card thicknesses between passes while
//     nothing lifted it, which is not a thing a raked card does either.
//
// THE FIX IS TO STOP RE-ROLLING. One rank per card, assigned once, EVENLY SPACED
// across the same SCATTER_Y band, and carried unchanged through all three
// smoosh passes. Then:
//   * No pair's height order can ever change, so no pair can ever cross. Zero
//     swaps in the smooshes BY CONSTRUCTION, however far the passes drag the
//     cards in x and z - the guarantee is about the ORDER, and the order is now
//     a constant.
//   * Even spacing maximises the MINIMUM gap instead of leaving it to an order
//     statistic: every rank is 0.014/51 = 0.0915 CARD_T apart, 0.027mm. That is
//     small - it is what a 1.4mm band divided 52 ways is worth, and a genuinely
//     card-thick spread needs 33 thicknesses for this field's longest overlap
//     chain, i.e. the 0.111-tall mound already measured and rejected - but it is
//     5000x the old random minimum and 110x the depth buffer's resolution, so
//     nothing z-fights.
//   * The band, and therefore SPREAD_TOP and every hand height measured against
//     it, is untouched. The top rank lands exactly ON SPREAD_TOP, which is the
//     height `pressAt` was always solving against.
//
// THE RANK IS THE DECK ORDER, and that is the other half of it. The deal peels
// from the TOP DOWN, and `restInOrder` gave the FIRST card dealt the LOWEST
// height - i.e. it inverted the deck's own stacking order across the spread, so
// every pair in the deck had to cross on its way out. Ranking by deck index
// instead keeps the top card on top and the bottom card underneath, which is
// both what smearing a deck out actually does and one fewer forced crossing per
// pair. (`spread` and the two `gather` beats still restack genuinely - a plowed
// card does climb onto the heap - so they are not zero; see NEEDS FROM LEAD.)
//
// The random stream is untouched: every draw the old code made is still made, in
// the same order, so x, z, yaw and drag are bit-for-bit what they were and the
// mixing washRake measures cannot have moved.
// ===========================================================================
//
// WHAT THIS COSTS, since it is not free and the number should be written down.
// washRake's WHOLE-FINGER median clearance in the three smooshes goes
// 2.7/2.1/2.1mm -> 2.6/1.9/1.9mm. The cause is not the ceiling (the top rank
// sits exactly on SPREAD_TOP, which is the height `pressAt` already solves a pad
// onto, and moving it a third of a millimetre lower was tried and recovered
// nothing): it is that a card's height is no longer CORRELATED WITH ITS RAKE
// TIME. `restInOrder` sorted heights into rake order, so a palm early in a pass
// was over the low cards and only met the high ones at the end. With heights
// fixed, the palm meets a random mix throughout, so the tallest card under it is
// on average a little taller. 0.2mm of median AIR, in the direction of MORE
// contact rather than less - the min clearances are unchanged (0.9mm in
// smoosh-2, as before), penetration is still exactly 0.0000 and nothing is
// pierced. That is the right side of the trade for removing 1153 swaps.
const rankHeight = (rank, n) =>
  SCATTER_Y[0] + (n <= 1 ? SCATTER_Y[1] : (rank / (n - 1)) * SCATTER_Y[1])

function scatterLayout(deck, rng, spread = 1.0) {
  return deck.map((card, i) => {
    // Draw order is load-bearing: x, y, z, yaw, bend, exactly as before, so the
    // stream downstream is unchanged. `bend` is still DRAWN and multiplied by a
    // BEND_MAX of 0 for that reason - the draw is the contract, not the value.
    const x = (rng() * 2 - 1) * SPREAD_X * spread
    const y = SCATTER_Y[0] + rng() * SCATTER_Y[1]
    const z = ROW_Z[i % 2] + (rng() - 0.5) * 2 * ROW_HALF
    const yaw = (rng() - 0.5) * Math.PI
    const bend = (rng() - 0.5) * 2 * BEND_MAX
    return { id: card.id, pos: new THREE.Vector3(x, y, z), quat: faceQuat(false, yaw), bend, yaw }
  })
}

// One smoosh pass: every card is assigned to the nearer palm's orbit and
// rotated about THAT centre, by an angle that falls off with the card's
// distance from the hand's circular path, cards the palm actually crosses get
// dragged a long way, cards it misses barely stir. Returns the new poses PLUS
// the stagger order (cards sorted by when their hand reaches them).
// How far off the palm's own track a card can be and still be dragged. It is a
// HAND: its pad patch is 0.77 across and 0.79 deep, so a card whose centre is
// within about half that of the swept circle has had something over it. Anything
// wider than the hand would be moving cards nothing touched.
const RAKE_REACH = 0.5
// The angular drag a pad hands to a card it crosses, in radians. UNCHANGED
// across the bounding work, and that is the interesting part: shrinking the
// orbits from 0.45 to 0.33..0.40 and moving their centres in from 1.06 to 0.62
// did not cost travel, it bought some (median path 1.389 -> 1.463), because a
// centre inside the field puts every card at a radius the falloff likes instead
// of parking the dead point of each orbit right where the cards run out.
// Raising these to [1.35, 0.7] reads 1.932, and the temptation is noted and
// declined: nothing measured says a pad drags a card 2 radians rather than 1.5.
// WHY THE SMOOSH STEPS STAGGER BY `contact` AND NOT BY `card`.
// A rank-based stagger deals cards in an authored ORDER, evenly spaced across the
// step. This lesson sorted that order by `passTime(orbit, ang)` - an analytic model
// of where the palm is - and the model had drifted from the hands: measured against
// the compiled hand track, the instant a hand was closest to a card and the instant
// that card moved fastest differed by a median 0.233 of the pass (~700ms of 3s), only
// 6 of 52 cards moved within 0.05 of being touched, and touch order vs motion order
// had a mean rank displacement of 20.4 of 52 - indistinguishable from random.
// The drift's cause: `orbitOf` hardcodes `v0: 0` and a phase-independent centre,
// while `motionOffset`'s orbit starts at the anchor and circles a centre offset by
// -amp*(cos 2πφ, sin 2πφ). When this lesson gained an ANTIPHASE left hand (φ=0.5) to
// keep the two palms apart, the left hand's cards were being timed against the wrong
// circle and nothing noticed, because no metric compared the model to the hands.
// `stagger: { by: 'contact' }` samples the compiled hand track instead, so there is
// no model left to drift. Worth 26% -> 46% of card motion with a hand on it, at
// IDENTICAL mixing (path median 1.470, 0/52 barely raked) - it only re-times motion,
// it does not change where a card ends up.
//
// TWO THINGS MEASURED WHILE TUNING IT, both counter-intuitive:
//   * A LONGER span is better, not shorter. Shortening it 0.3 -> 0.1 made causality
//     WORSE (53% -> 66%), because a hand is near a given card for a WINDOW, and the
//     card's motion has to overlap that window rather than being a spike inside it.
//     0.4 is the knee; past 0.5 the tail starts adding unattended drift again.
//   * THE SPAN WAS RE-SWEPT AFTER THE CARDS WENT FLAT, and the knee moved. The
//     0.3 -> 0.1 measurement above stands, but the note that "past 0.5 the tail
//     starts adding unattended drift" does not survive re-measurement: swept at
//     spread 0.55, the INERT CONTACT figure (a moving hand on a card that does not
//     budge - `scripts/inspect/inertContact.mjs`, gated as INERT_BUDGET) falls
//     45% -> 40% -> 36% -> 30% -> 27% -> 25% across span 0.4/0.45/0.5/0.6/0.7/0.8
//     while causality holds at 49-52% the whole way. That is the trade these two
//     metrics make: a longer window lets a card keep moving once the palm has gone,
//     a shorter one leaves cards sitting still under a palm that is on them.
//     0.55 / 0.6 is where it settles - a THIRD off the inert figure, causality at
//     its best measured value (50%, budget 53%), and mixing bit-identical (path
//     median 1.470, barely-raked 0/52, per-step clearances within 0.1mm). Past 0.6
//     the gain is a point or two per step of span and causality starts climbing
//     toward its budget, which is a worse trade than it looks: it buys the inert
//     number with exactly the drift the other metric exists to find.
//     The spread came 0.7 -> 0.55 in the same sweep, for a reason with a size: a
//     palm's pad patch is 0.77 x 0.79 over a spread at 12x coverage, so about TEN
//     cards are under a hand at any instant and about ten should be in motion.
//   * IT IS WRONG FOR A DEAL. Applying it to the `spread` step - where cards leave a
//     squared stack rather than being raked where they lie - drove the pinky 0.086
//     into a card, because re-timing a card's DEPARTURE to the moment a hand arrives
//     puts the hand exactly where the card still is. `spread` therefore keeps its
//     rank stagger. Contact timing suits a RAKE (a hand crosses a card that is lying
//     there); a deal needs the card gone BEFORE the hand arrives.
const RAKE_DRAG = [1.0, 0.5]
// How much a card SKIDS under the palm instead of turning with it, in radians of
// yaw per pass. Small on purpose: the dominant term is the drag angle itself, and
// this is the difference between a card being carried and a card being glued.
const YAW_SLIP = 0.5
function smooshPass(prev, rng, cyc, amps) {
  const entries = prev.map((p) => {
    const sideX = p.pos.x >= 0 ? 1 : -1
    const orbit = orbitOf(sideX, cyc, amps)
    const dx = p.pos.x - orbit.cx
    const dz = p.pos.z - orbit.cz
    const r = Math.hypot(dx, dz)
    const ang = Math.atan2(dz, dx)
    // Falloff on distance from the palm's track (radius `orbit.amp` around the
    // centre), which is per-hand now that the two palms swirl differently.
    const reach = Math.exp(-(((r - orbit.amp) / RAKE_REACH) ** 2))
    const drag = orbit.dir * (RAKE_DRAG[0] + RAKE_DRAG[1] * rng()) * reach
    const na = ang + drag
    // Same four draws in the same order as before - drag, height, yaw, bend - so
    // every position in this pass is bit-identical to the version that measured
    // a path median of 1.470. Only what the last three are USED for changed.
    //
    // THE HEIGHT DRAW IS STILL SPENT AND ITS VALUE IS THROWN AWAY. The draw is
    // the contract (see the note above rankHeight): keeping it means yaw, bend
    // and every later pass read the same stream they always did. The card KEEPS
    // the height it came in with, which is what makes a pass unable to reverse
    // any pair's stacking order - a raked card slides, it does not change which
    // cards it is lying on.
    rng()
    const y = p.pos.y
    // THE CARD TURNS WITH THE PALM THAT CARRIES IT. This was a fresh uniform yaw
    // in +-pi/2 every pass, so a card being dragged round a circle also spun to a
    // random new angle three times, which is not a thing a raked card does. It is
    // now the yaw it already had plus the angle it was actually dragged through
    // (`drag` is a rotation about the palm's orbit centre, so a card stuck to the
    // pad turns by exactly that), plus a slip: real cards skid under a palm
    // rather than being glued to it. The draw is the same draw, spent better.
    const yaw = (p.yaw ?? 0) + drag + (rng() - 0.5) * YAW_SLIP
    const bend = (rng() - 0.5) * 2 * BEND_MAX
    return {
      t: passTime(orbit, ang),
      pose: {
        id: p.id,
        pos: new THREE.Vector3(orbit.cx + Math.cos(na) * r, y, orbit.cz + Math.sin(na) * r),
        quat: faceQuat(false, yaw),
        bend,
        yaw,
      },
    }
  })
  // Sorted by WHEN the palm reaches each card. This is the STAGGER order only
  // now - it is no longer also the stacking order, because heights no longer
  // move (see rankHeight). The sort stays exactly where it was: the returned
  // array order feeds `shuffleArray` in the gather, so reordering it would
  // change the shuffle and therefore the mixing.
  entries.sort((a, b) => a.t - b.t)
  return entries.map((e) => e.pose)
}

export const washLesson = {
  id: 'wash',
  title: 'Card Wash',
  technique: 'wash',
  randomizes: 'Very good',
  seed: 42,
  cameraPreset: 'topDown',
  summary:
    'Spread the whole deck face-down and swirl it like washing a window. Messy, but one of the most thorough ways to mix.',
  facts: [
    'Because cards move freely in two dimensions, the wash breaks up every adjacency — it is one of the strongest physical shuffles.',
    'It is hard to model mathematically, which is exactly why casinos use it before dealing.',
  ],
  build: (deck, ctx) => {
    const rng = ctx.rng

    // Spread destinations, staggered so the deck peels from the TOP DOWN, both
    // sides progressing together. (It was "nearest the centre first", which is
    // spatially pretty but leaves the full 0.21-tall stack standing under the
    // palms for the whole step, the palms then had to hover above a deck that
    // was supposedly already spread, or plough straight through it.)
    const deckIndex = new Map(deck.map((c, i) => [c.id, i]))
    const scatter = scatterLayout(deck, rng)
    const bySide = { 1: [], '-1': [] }
    for (const p of scatter) bySide[p.pos.x >= 0 ? 1 : -1].push(p)
    for (const side of [1, -1]) {
      bySide[side].sort((a, b) => deckIndex.get(b.id) - deckIndex.get(a.id))
    }
    const spread1 = []
    for (let i = 0; i < Math.max(bySide[1].length, bySide[-1].length); i++) {
      if (bySide[1][i]) spread1.push(bySide[1][i])
      if (bySide[-1][i]) spread1.push(bySide[-1][i])
    }
    // `spread1` is in DEAL order, and that is also the height order: the first
    // card put down is the bottom one and every later card lands on top of it,
    // which is what dealing a deck out does (a deal inverts the deck, it does not
    // preserve it). Ranking by DECK index instead was tried and measured worse -
    // 1377 swaps in this step against 898 - and the reason is instructive: the
    // deal is STAGGERED, so the first card dealt is already down at spread height
    // while the rest of the deck is still stacked 0.15 above it. Give that card
    // the HIGHEST spread height and every pair it belongs to has to cross twice
    // (once as it drops past the standing deck, once as the other card comes down
    // past it); give it the lowest and each pair crosses once. See NEEDS FROM
    // LEAD - the residue here is a timing property of the deal, not an ordering
    // one, and it cannot be ranked away.
    spread1.forEach((p, i) => {
      p.pos.y = rankHeight(i, spread1.length)
    })

    // THREE PASSES WITH THE HANDS LIFTING BETWEEN THEM, which is what the footage
    // shows and what casinos actually do - a wash is not one continuous swirl, it is
    // repeated bouts with the hands coming off the felt in between. Directions
    // alternate so no clump survives a single rotational direction.
    const spread2 = smooshPass(spread1, rng, 1, PASS[0])
    const spread3 = smooshPass(spread2, rng, -1, PASS[1])
    const spread4 = smooshPass(spread3, rng, 1, PASS[2])

    // Gather: right palm plows its half in first (bottom of the new stack),
    // then the left palm pushes the rest on top. Plow order: the card nearest
    // the incoming palm moves first.
    const rightHalf = spread4.filter((p) => p.pos.x >= 0)
    const leftHalf = spread4.filter((p) => p.pos.x < 0)
    const byId = new Map(deck.map((c) => [c.id, c]))
    const finalOrder = [
      ...shuffleArray(rightHalf.map((p) => byId.get(p.id)), rng),
      ...shuffleArray(leftHalf.map((p) => byId.get(p.id)), rng),
    ]
    const finalIndex = new Map(finalOrder.map((c, i) => [c.id, i]))
    const stackPose = (id) => ({
      id,
      pos: new THREE.Vector3(0, 0.02 + finalIndex.get(id) * CARD_GAP, 0),
      quat: faceQuat(false),
      bend: 0,
    })
    // A plow does not build a squared stack, it builds a HEAP. Landing the
    // gather in a loose, nearly-flat pile (top ≈ 0.07 instead of 0.22) is both
    // truer to the move and the thing that lets the plowing palms stay low:
    // a card climbing to slot 51 mid-flight used to rise straight through the
    // sweeping hand. `square` then collapses the heap into the real stack,
    // with both hands already up on the deck's edges.
    const HEAP_LIFT = CARD_GAP * 0.25
    const heapPose = (id) => {
      const i = finalIndex.get(id)
      const a = (i * 2.39996) % (Math.PI * 2) // golden-angle spiral: even, deterministic
      const r = 0.075 * Math.sqrt((i + 0.5) / finalOrder.length)
      return {
        id,
        pos: new THREE.Vector3(Math.cos(a) * r, 0.02 + i * HEAP_LIFT, Math.sin(a) * r * 0.8),
        quat: faceQuat(false, Math.sin(i * 1.7) * 0.16),
        bend: 0,
      }
    }
    const HEAP_TOP = 0.02 + (finalOrder.length - 1) * HEAP_LIFT
    const gatherRight = rightHalf
      .slice()
      .sort((a, b) => b.pos.x - a.pos.x)
      .map((p) => heapPose(p.id))
    const gatherLeft = leftHalf
      .slice()
      .sort((a, b) => a.pos.x - b.pos.x)
      .map((p) => heapPose(p.id))

    const startTop = DECK_TOP(deck.length)
    const fullTop = startTop
    // Where a pass STARTS, per hand. `motion.orbit`'s offset is zero at t=0, so
    // the anchor is the pad's position at the top of the beat, which is one
    // amplitude off the orbit centre — OUTBOARD for the right hand (phase 0) and
    // INBOARD for the left (phase 0.5). Both are authored in right-hand
    // coordinates and the compiler mirrors x, hence the single expression.
    const smAnchor = (side, amp, lift = 0, top = SPREAD_TOP) =>
      pressAt(CX + (side === 'right' ? amp : -amp), top, CZ, lift)
    // The same point OUTBOARD of the centre for whichever hand asks: authored
    // once for the right hand, so the compiler's x-mirror puts the left hand's
    // copy on the left. Used for anything that happens before a pass begins,
    // where both hands should be over their own half.
    const outAnchor = (amp, lift = 0, top = SPREAD_TOP) => pressAt(CX + amp, top, CZ, lift)
    // The plow leads with its FINGERTIPS (deckApproach is yawed inward), not
    // with the thumb, and rides at one height for the whole sweep: high enough
    // that its lowest finger surface clears the finished HEAP, low enough to
    // read as a palm on the felt. Its pads start OUTSIDE the spread and finish
    // on the heap they just built, both card-sized distances, so they say what
    // they mean at any hand scale.
    const PLOW_FROM = SPREAD_X + CARD_W / 2 // just past the spread's outer edge
    const PLOW_TO = CARD_W * 0.3 // on top of the heap
    const WALL_X = 0.075 + CARD_W // the far side of the heap, where cards stop
    const plowAt = (padX, padZ) => openAt(padX, HEAP_TOP, padZ, PLOW_LIFT)
    // ONE ORBIT, and a hand that is doing something for the length of it. The
    // orbit is a wrist overlay and has to stay on a single segment (it is only
    // zero at both ends for an integer number of cycles), so the articulation
    // rides on top of it as `fingerMotion`: a curl ripple running index→pinky,
    // which is what a raking hand does. It is authored around a slightly
    // hyperextended pose and the anchor is measured at the ripple's DEEPEST
    // phase, so every finger stays above the cards it is dragging.
    //
    // The ripple runs at a different rate and a different lag in each hand. Two
    // hands rippling in lockstep is the tell that this is one authored motion
    // played twice, and it is the same tell as two mirror-image orbits.
    const rakeRipple = (side) => {
      const cycles = side === 'right' ? 5 : 4
      const phase = side === 'right' ? 0.8 : 0.55
      return [
        { fingers: ['index', 'middle', 'ring', 'pinky'], type: 'curlRipple', amp: RAKE_AMP, cycles, phase },
        { fingers: ['thumb'], type: 'curlRipple', amp: RAKE_AMP * 0.6, cycles, phase: phase * 0.5 },
      ]
    }
    const smooshHands = (side, cyc, pass, spread) => [
      {
        at: 1,
        pose: rakePose(RAKE_BASE, spread),
        anchor: smAnchor(side, pass[side]),
        ease: 'linear',
        motion: { type: 'orbit', amp: pass[side], cycles: cyc, phase: ORBIT_PHASE[side] },
        fingerMotion: rakeRipple(side),
      },
    ]

    // THE LIFT BETWEEN PASSES, and it also carries the DESCENT for the pass that
    // follows. That is not a stylistic choice: `motion.orbit` is a wrist overlay that
    // is only zero at both ends across an integer number of cycles, so it has to own a
    // whole keyframe segment. If a smoosh beat had to descend first it would need two
    // segments and the orbit would no longer close. Ending this beat exactly on the
    // NEXT pass's start anchor keeps every smoosh a single clean segment — which is
    // why the lift takes both amplitudes.
    //
    // The two hands do not leave the felt together, and they do not go as high as
    // each other. Nothing depends on it; hands just do not do things in unison.
    const LIFT_H = { right: CARD_H * 0.42, left: CARD_H * 0.31 }
    const LIFT_AT = { right: 0.46, left: 0.58 }
    const liftHands = (side, from, to, spread) => [
      {
        at: LIFT_AT[side],
        pose: rakePose(RAKE_BASE, spread),
        anchor: smAnchor(side, from[side], LIFT_H[side]),
        ease: 'easeOutCubic',
      },
      {
        at: 1,
        pose: rakePose(RAKE_BASE, spread),
        anchor: smAnchor(side, to[side]),
        ease: 'easeInOutCubic',
      },
    ]

    const squareHands = [
      {
        at: 0.6,
        pose: REST_POSE,
        anchor: restAt(DECK_PAD_X, fullTop, 0),
        fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tighten', amp: 0.05 }],
      },
    ]
    const spreadHands = (side) => [
      // Held HIGH through the turn, the deck is still most of its 0.22 tall at
      // this point, then settling onto the flat spread.
      //
      // IT TURNS OVER ITS OWN SIDE FIRST, and that middle keyframe is not a
      // flourish. `deckRest` reaches 1.17 INBOARD of its wrist and the press pose
      // reaches 0.41 OUTBOARD of it, so anything interpolating between the two
      // swings its fingertips most of a hand-length across the table on the way.
      // With the left hand's pass now starting INBOARD of its orbit centre, that
      // swing put both ring fingertips at x ≈ 0.15 at the same instant: measured,
      // the two hands OVERLAPPED by 0.060 a fifth of the way into this step.
      // Turning outboard (`outAnchor`, both hands on their own side) and only
      // then sliding to the point the pass starts from keeps the whole step above
      // a 0.29 surface gap.
      {
        at: 0.3,
        pose: PRESS_POSE,
        anchor: outAnchor(PASS[0][side], CARD_H * 0.25, startTop),
        ease: 'easeInOutCubic',
      },
      {
        at: 0.55,
        pose: rakePose(RAKE_BASE, 0.5),
        anchor: smAnchor(side, PASS[0][side], 0, SPREAD_TOP + SPREAD_ARC),
        ease: 'easeInOutCubic',
      },
      {
        at: 1,
        pose: rakePose(RAKE_BASE, 0.5),
        anchor: smAnchor(side, PASS[0][side], 0, SPREAD_TOP + SPREAD_ARC),
        ease: 'linear',
        motion: { type: 'orbit', amp: PASS[0][side], cycles: 1, phase: ORBIT_PHASE[side] },
        fingerMotion: [rakeRipple(side)[0]],
      },
    ]
    // The opening beat: both hands come in from the sides and CLOSE onto the
    // squared deck (fingertips tangent on its top card) before anything moves.
    //
    // The `at: 0` keyframe is load-bearing. Without one the compiler builds a
    // lead-in FROM the pose carried forward, which at the first step of a
    // lesson is `relaxed` at its own default wrist, and `relaxed` parks a hand
    // at x=±0.95 with its thumb base 1.57 inboard of that, i.e. straight
    // through the squared deck. Measured: that phantom frame alone was 0.1269
    // of this lesson's penetration.
    //
    // It comes in from a CARD-LENGTH outside its own resting pad line, not from
    // 1.63 out. There is nothing on the felt but the squared deck at x=0 during
    // this beat, so a longer entrance is only a hand travelling over bare table,
    // and this one still reads as hands arriving.
    const readyHands = [
      { at: 0, pose: PLOW_POSE, anchor: openAt(DECK_PAD_X + CARD_H, startTop, 0.04, CARD_H * 0.6) },
      { at: 0.4, pose: PLOW_POSE, anchor: openAt(DECK_PAD_X, startTop, 0.04, CARD_H * 0.3) },
      // easeOutCubic, not an overshoot ease: `easeOutBackSoft` dipped the wrist
      // BELOW its target on the way in, and the pads went through the top card.
      { at: 1, pose: REST_POSE, anchor: restAt(DECK_PAD_X, startTop, 0), ease: 'easeOutCubic' },
    ]
    return [
      {
        kind: 'hold',
        id: 'ready',
        label: 'Hands in — settle onto the squared deck',
        duration: 1100,
        hands: { left: readyHands, right: readyHands },
        annotations: [
          { text: 'Both palms start ON the deck — nothing moves until a hand moves it', appearAt: 0.35 },
        ],
      },
      {
        kind: 'move',
        id: 'spread',
        label: 'Smear the deck out across the felt',
        duration: 3200,
        ease: 'easeOutCubic',
        to: () => spread1,
        stagger: { by: 'card', spread: 0.65, span: 0.35 },
        // Cards SLIDE, a wash never lifts them; 2mm is what keeps the peel off
        // the stack from scraping. The palms of this step are measured against
        // SPREAD_TOP + SPREAD_ARC because of it.
        arcLift: SPREAD_ARC,
        camera: 'topDown',
        hands: {
          // The palms are already on the stack; they turn out of the inward
          // "rest" yaw and spiral away while the stack peels down under them.
          // The first keyframe holds them HIGH through that turn, the deck is
          // still most of its 0.21 tall at that point, and only the last
          // stretch settles onto the flat spread.
          left: spreadHands('left'),
          right: spreadHands('right'),
        },
        annotations: [
          {
            text: 'The wash (or “smoosh”) is one of the strongest randomizers',
            appearAt: 0.25,
          },
        ],
      },
      {
        kind: 'move',
        id: 'smoosh-1',
        label: 'Each palm swirls its half in circles',
        duration: 3000,
        ease: 'linear',
        to: () => spread2,
        stagger: { by: 'contact', spread: 0.55, span: 0.6 },
        hands: {
          left: smooshHands('left', 1, PASS[0], 0.62),
          right: smooshHands('right', 1, PASS[0], 0.62),
        },
        annotations: [
          // WAS "a card moves only when a pad crosses it", and that was a claim the
          // animation did not honour: the causality metric in verifyTracks measured
          // it 71% false, and it is still 51% false after the contact-timed stagger
          // below. Do not put the claim back until the number is small enough to
          // earn it. What is said instead is true AND is the actual teaching point:
          // two-dimensional motion is why a wash mixes as well as it does.
          { text: 'Palms flat and low — cards slide in two dimensions, which is why a wash mixes so well', appearAt: 0.15 },
        ],
      },
      {
        kind: 'move',
        id: 'lift-1',
        label: 'Hands come off the felt',
        duration: 520,
        ease: 'easeInOutCubic',
        to: () => spread2,
        hands: {
          left: liftHands('left', PASS[0], PASS[1], 0.5),
          right: liftHands('right', PASS[0], PASS[1], 0.5),
        },
      },
      {
        kind: 'move',
        id: 'smoosh-2',
        label: 'Reverse direction — break up every clump',
        duration: 3000,
        ease: 'linear',
        to: () => spread3,
        stagger: { by: 'contact', spread: 0.55, span: 0.6 },
        hands: {
          left: smooshHands('left', -1, PASS[1], 0.38),
          right: smooshHands('right', -1, PASS[1], 0.38),
        },
        annotations: [
          { text: 'Casinos wash for a full minute — change direction often', appearAt: 0.2 },
        ],
      },
      {
        kind: 'move',
        id: 'lift-2',
        label: 'And again',
        duration: 520,
        ease: 'easeInOutCubic',
        to: () => spread3,
        hands: {
          left: liftHands('left', PASS[1], PASS[2], 0.56),
          right: liftHands('right', PASS[1], PASS[2], 0.56),
        },
      },
      {
        kind: 'move',
        id: 'smoosh-3',
        label: 'A third pass, direction reversed again',
        duration: 3000,
        ease: 'linear',
        to: () => spread4,
        stagger: { by: 'contact', spread: 0.55, span: 0.6 },
        hands: {
          left: smooshHands('left', 1, PASS[2], 0.7),
          right: smooshHands('right', 1, PASS[2], 0.7),
        },
        annotations: [
          { text: 'Lift, reset, repeat — the hands do not stay down for one long swirl', appearAt: 0.2 },
        ],
      },
      {
        kind: 'move',
        id: 'gather-right',
        label: 'Plow the right half into the middle',
        duration: 2700,
        ease: 'easeInOutCubic',
        reorder: () => finalOrder,
        to: () => gatherRight,
        stagger: { by: 'card', spread: 0.55, span: 0.45 },
        camera: 'washTable',
        hands: {
          right: [
            { at: 0.15, pose: PLOW_POSE, anchor: plowAt(PLOW_FROM, 0.2) },
            { at: 0.85, pose: PLOW_POSE, anchor: plowAt(PLOW_TO, 0.02), ease: 'easeInOutCubic', fingerMotion: PLOW_RAKE },
            { at: 1, pose: PLOW_POSE, anchor: plowAt(PLOW_TO + 0.06, 0.04) },
          ],
          // The other palm is the wall the cards stop against, parked with its
          // pads just past the heap's far long edge.
          left: [{ at: 0.3, pose: PLOW_POSE, anchor: plowAt(WALL_X, 0.06) }],
        },
        annotations: [
          { text: 'Corral the cards — one hand plows, the other is the wall', appearAt: 0.3 },
        ],
      },
      {
        kind: 'move',
        id: 'gather-left',
        label: 'Plow the rest in on top',
        duration: 2700,
        ease: 'easeInOutCubic',
        to: () => gatherLeft,
        stagger: { by: 'card', spread: 0.55, span: 0.45 },
        hands: {
          left: [
            { at: 0.12, pose: PLOW_POSE, anchor: plowAt(PLOW_FROM, 0.2) },
            { at: 0.85, pose: PLOW_POSE, anchor: plowAt(PLOW_TO, 0.02), ease: 'easeInOutCubic', fingerMotion: PLOW_RAKE },
            { at: 1, pose: PLOW_POSE, anchor: plowAt(PLOW_TO + 0.06, 0.04) },
          ],
          right: [{ at: 0.3, pose: PLOW_POSE, anchor: plowAt(WALL_X, 0.06) }],
        },
      },
      {
        kind: 'move',
        id: 'square',
        label: 'Square the washed deck',
        duration: 1200,
        ease: 'easeInOutCubic',
        to: (dk) =>
          dk.map((c) => ({ ...stackPose(c.id) })),
        hands: {
          left: squareHands,
          right: squareHands,
        },
      },
      {
        kind: 'hold',
        id: 'rest',
        label: 'Washed and squared',
        duration: 800,
        // The closing beat RESTS on the deck instead of drifting off it.
        hands: {
          left: [{ at: 1, pose: REST_POSE, anchor: restAt(DECK_PAD_X, fullTop, 0) }],
          right: [{ at: 1, pose: REST_POSE, anchor: restAt(DECK_PAD_X, fullTop, 0) }],
        },
      },
    ]
  },
}
