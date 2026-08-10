import * as THREE from 'three'
import { faceQuat } from '../engine/layouts'
import { shuffleArray } from '../../lib/shuffleMath'
import { CARD_GAP, CARD_H, CARD_T, CARD_W } from '../../lib/constants'
import { DECK_REST_DROP, DECK_APPROACH_DROP } from '../../hands/handPoses'
import { FINGERS, FINGER_NAMES, HAND_SCALE } from '../../hands/handRigSpec'
import { poseWithContacts, rigMetrics, surfaceContact, wristAnchorForContact } from '../authoring/contacts'
import { fingerJointsWorld, fingertipWorld } from '../../hands/handKinematics'

// Card wash where the HANDS do the washing. Each palm owns one half of the
// table and circles over it; a card only moves when that palm passes over it:
// its swirl is centred on the hand's orbit, scaled by how close it sits to the
// hand's actual path, and its motion window is staggered to the moment the
// hand sweeps through its angle. The gather is two plow sweeps, each hand
// pushes its half of the spread into the middle, nearest-to-the-hand first.

// --- The smoosh hand ---------------------------------------------------------
// `washPress` is authored palm-down with the fingers pointing at the CAMERA and
// the thumb abducted straight out to −x. That thumb is a whole hand long: at the
// old rig scale it stuck out 0.55 and the two mirrored palms merely brushed; at
// HAND_SCALE 13 it reaches 1.56, so both thumbs would sweep clean through each
// other across the middle of the table. Yaw the press INWARD instead, the same
// REACH_IN turn deckRest and the plow already use, and each hand reaches in
// from its own side with fingertips leading and the thumb trailing safely to
// −z. Authored ONCE, for the right hand: the engine's x-mirror gives the left
// hand the correct opposite yaw (never mirror a quaternion by hand).
const PALM_DOWN = Math.PI / 2
const REACH_IN = -Math.PI / 2
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
const RAKE_BASE = -0.09
const RAKE_AMP = 0.17
const rakeCurl = (c) => [c, c * 0.8, c * 0.55]
function rakePose(c, spread) {
  const p = poseWithContacts('washPress', 'right', { quat: PRESS_QUAT })
  for (const name of FINGER_NAMES) {
    p.fingers[name] = rakeCurl(name === 'thumb' ? c * 0.7 : c)
  }
  p.spread = spread
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
// a bigger hand breathes bigger (handPoses.js carries the same constant).
const CONTACT_AIR = 0.003 * HAND_SCALE

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
// The open/rest poses are already yawed inward, so they need no quat override,
// and their exported DROP constants are this same measurement plus its air.
const openAt = (x, y, z, lift = 0) => padAt('deckApproach', null, DECK_APPROACH_DROP, x, y, z, lift)
// The plow rakes too, the fingers hook and release as they corral, which is
// what stops a sweep reading as a bulldozer blade. Its hand rides that much
// higher, measured on the deepest phase of the hook rather than assumed: a
// `curlRipple` on a palm-down hand drives the pads DOWN, and `deckApproach`'s
// own drop is measured with its fingers nearly straight.
const PLOW_AMP = 0.16
const PLOW_DEEP = (() => {
  const p = poseWithContacts('deckApproach', 'right', {})
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
const restAt = (x, y, z) => padAt('deckRest', null, DECK_REST_DROP, x, y, z)

// Each hand's circular smoosh, in WORLD coords, authored around the PALM'S
// CONTACT PATCH rather than its wrist, at this scale those are 1.83 apart, so
// orbiting the wrist over the spread swings the actual pads a card-length and a
// half off the table. The right hand's pads orbit C=(CX,CZ); the left hand is
// the engine's x-mirror, so its centre is −CX and its visual direction is
// reversed. `cyc` (+1/−1) is the authored orbit sign.
const AMP = 0.28
// Both palms reach their inner point at the SAME instant, so the only thing
// keeping them from merging into one translucent mass is how close the
// inboard-most part of one hand gets to the centre line. Under the inward yaw
// that part is the middle fingertip, one tip-radius past the pad, a HAND-sized
// distance, so it is measured, not typed. (The rule this replaces, "keep ≥0.5
// between the wrists", was authored for a hand 2.83× smaller and is now met by
// a factor of eight while the fingers still crossed.)
const TIP_R = FINGERS.middle.rad[2] * HAND_SCALE
const PALM_GAP = 2 * TIP_R // air left between the two hands at closest approach
// How far INBOARD of its own middle pad the hand's most inboard SURFACE reaches
//, measured over every capsule of every finger, at the widest splay and the
// deepest rake the lesson uses, because that is the part that meets the other
// hand. The rule this replaces ("keep >= 0.5 between the wrists", session 5) is
// hand-sized and was authored for a rig 2.4x smaller: the wrists now clear each
// other by a factor of eight while the FINGERS still crossed, which is the
// documented "palms brush at closest approach" nit. Measure the fingers.
const _rj = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
const _rp = new THREE.Vector3()
function inboardOf(pose) {
  const p = poseWithContacts(pose, 'right', { quat: PRESS_QUAT })
  p.wrist.pos.set(0, 0, 0)
  let lo = Infinity
  for (const name of FINGER_NAMES) {
    fingerJointsWorld(p, 'right', name, _rj)
    for (let i = 0; i < 3; i++) {
      const r = FINGERS[name].rad[i] * HAND_SCALE
      for (let k = 0; k <= 4; k++) {
        _rp.copy(_rj[i]).lerp(_rj[i + 1], k / 4)
        lo = Math.min(lo, _rp.x - r)
      }
    }
  }
  fingertipWorld(p, 'right', 'middle', _rp)
  return _rp.x - lo // how far past the middle pad the hand still reaches
}
const PAD_LEAD = Math.max(
  inboardOf(rakePose(RAKE_BASE, 0.5)),
  inboardOf(rakeDeepest(RAKE_BASE, 0.5)),
  inboardOf(rakePose(RAKE_BASE + RAKE_AMP, 0.62)),
)
const CX = AMP + PAD_LEAD + PALM_GAP / 2 // pad-orbit centre
const CZ = 0.25
// The spread's cards scatter to y = 0.02..0.034 (card centres); the palms have
// to clear the highest of them for the whole sweep.
const SPREAD_TOP = 0.034

// The squared deck the lesson opens and closes on: 52 cards, top card centre.
const DECK_TOP = (n) => 0.02 + (n - 1) * CARD_GAP
// Where the pads land on that deck's top card: out near its long edge, on each
// hand's own side, so two hands squaring it do not put their fingers in the
// same place. Card-relative, this one genuinely does not scale with the hand.
const DECK_PAD_X = CARD_W * 0.42

function orbitOf(sideX, cyc) {
  return {
    cx: sideX * CX,
    cz: CZ,
    v0: sideX > 0 ? 0 : Math.PI, // hand's start angle on its circle
    dir: sideX > 0 ? cyc : -cyc, // visual rotation direction
  }
}

const TAU = Math.PI * 2
const mod = (a, m) => ((a % m) + m) % m

// When (0..1 of the step) does this hand first sweep through world angle a?
function passTime(orbit, a) {
  return mod(orbit.dir * (a - orbit.v0), TAU) / TAU
}

// Scatter every card across the felt, face-down, at random spots + angles.
function scatterLayout(deck, rng, spread = 1.0) {
  return deck.map((card) => {
    const r = spread * Math.sqrt(rng())
    const a = rng() * Math.PI * 2
    return {
      id: card.id,
      pos: new THREE.Vector3(
        Math.cos(a) * r,
        0.02 + rng() * 0.014,
        Math.sin(a) * r * 0.7,
      ),
      quat: faceQuat(false, (rng() - 0.5) * Math.PI),
      bend: (rng() - 0.5) * 0.7,
    }
  })
}

// One smoosh pass: every card is assigned to the nearer palm's orbit and
// rotated about THAT centre, by an angle that falls off with the card's
// distance from the hand's circular path, cards the palm actually crosses get
// dragged a long way, cards it misses barely stir. Returns the new poses PLUS
// the stagger order (cards sorted by when their hand reaches them).
function smooshPass(prev, rng, cyc) {
  const entries = prev.map((p) => {
    const sideX = p.pos.x >= 0 ? 1 : -1
    const orbit = orbitOf(sideX, cyc)
    const dx = p.pos.x - orbit.cx
    const dz = p.pos.z - orbit.cz
    const r = Math.hypot(dx, dz)
    const ang = Math.atan2(dz, dx)
    // Falloff on distance from the palm's track (radius AMP around the centre).
    const reach = Math.exp(-(((r - AMP) / 0.5) ** 2))
    const drag = orbit.dir * (1.0 + 0.5 * rng()) * reach
    const na = ang + drag
    return {
      t: passTime(orbit, ang),
      pose: {
        id: p.id,
        pos: new THREE.Vector3(
          orbit.cx + Math.cos(na) * r,
          0.02 + rng() * 0.014,
          orbit.cz + Math.sin(na) * r,
        ),
        quat: faceQuat(false, (rng() - 0.5) * Math.PI),
        bend: (rng() - 0.5) * 0.7,
      },
    }
  })
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

    const spread2 = smooshPass(spread1, rng, 1)
    const spread3 = smooshPass(spread2, rng, -1)

    // Gather: right palm plows its half in first (bottom of the new stack),
    // then the left palm pushes the rest on top. Plow order: the card nearest
    // the incoming palm moves first.
    const rightHalf = spread3.filter((p) => p.pos.x >= 0)
    const leftHalf = spread3.filter((p) => p.pos.x < 0)
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
    // The smoosh anchor: the pads sit at the orbit centre PLUS one amplitude,
    // because `motion.orbit` is zero at t=0 and sweeps −2·amp in x from there.
    const SM_ANCHOR = pressAt(CX + AMP, SPREAD_TOP, CZ)
    // The plow leads with its FINGERTIPS (deckApproach is yawed inward), not
    // with the thumb, and rides at one height for the whole sweep: high enough
    // that its lowest finger surface clears the finished HEAP, low enough to
    // read as a palm on the felt. Its pads start OUTSIDE the spread and finish
    // on the heap they just built, both card-sized distances, so they say what
    // they mean at any hand scale.
    const PLOW_FROM = 1.0 + CARD_W / 2 // just past the spread's outer edge
    const PLOW_TO = CARD_W * 0.3 // on top of the heap
    const WALL_X = 0.075 + CARD_W // the far side of the heap, where cards stop
    const plowAt = (padX, padZ) => openAt(padX, HEAP_TOP, padZ, PLOW_LIFT)
    // ONE ORBIT, and a hand that is doing something for the length of it. The
    // orbit is a wrist overlay and has to stay on a single segment (it is only
    // zero at both ends for an integer number of cycles), so the articulation
    // rides on top of it as `fingerMotion`: a curl ripple running index→pinky,
    // four passes per circle, which is what a raking hand does. It is authored
    // around a slightly hyperextended pose and the anchor is measured at the
    // ripple's DEEPEST phase, so every finger stays above the cards it is
    // dragging. `splay` differs per pass, the fingers spread wide going one way
    // and gather coming back.
    const smooshHands = (cyc, spread) => [
      {
        at: 1,
        pose: rakePose(RAKE_BASE, spread),
        anchor: SM_ANCHOR,
        ease: 'linear',
        motion: { type: 'orbit', amp: AMP, cycles: cyc },
        fingerMotion: [
          { fingers: ['index', 'middle', 'ring', 'pinky'], type: 'curlRipple', amp: RAKE_AMP, cycles: 4, phase: 0.8 },
          { fingers: ['thumb'], type: 'curlRipple', amp: RAKE_AMP * 0.6, cycles: 4, phase: 0.4 },
        ],
      },
    ]

    const squareHands = [
      {
        at: 0.6,
        pose: 'deckRest',
        anchor: restAt(DECK_PAD_X, fullTop, 0),
        fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tighten', amp: 0.05 }],
      },
    ]
    const spreadHands = [
      // Held HIGH through the turn, the deck is still most of its 0.22 tall at
      // this point, then settling onto the flat spread.
      { at: 0.4, pose: PRESS_POSE, anchor: pressAt(CX + AMP, startTop, CZ, CARD_H * 0.25), ease: 'easeInOutCubic' },
      {
        at: 1,
        pose: rakePose(RAKE_BASE, 0.5),
        anchor: SM_ANCHOR,
        ease: 'linear',
        motion: { type: 'orbit', amp: AMP, cycles: 1 },
        fingerMotion: [
          { fingers: ['index', 'middle', 'ring', 'pinky'], type: 'curlRipple', amp: RAKE_AMP, cycles: 3, phase: 0.8 },
        ],
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
    const readyHands = [
      { at: 0, pose: 'deckApproach', anchor: openAt(1.0 + CARD_W, startTop, 0.04, CARD_H * 0.6) },
      { at: 0.4, pose: 'deckApproach', anchor: openAt(DECK_PAD_X, startTop, 0.04, CARD_H * 0.3) },
      // easeOutCubic, not an overshoot ease: `easeOutBackSoft` dipped the wrist
      // BELOW its target on the way in, and the pads went through the top card.
      { at: 1, pose: 'deckRest', anchor: restAt(DECK_PAD_X, startTop, 0), ease: 'easeOutCubic' },
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
        // Cards SLIDE, a wash never lifts them. (It also keeps every card's
        // top face under the palms' contact height for the whole step.)
        arcLift: 0.02,
        camera: 'topDown',
        hands: {
          // The palms are already on the stack; they turn out of the inward
          // "rest" yaw and spiral away while the stack peels down under them.
          // The first keyframe holds them HIGH through that turn, the deck is
          // still most of its 0.21 tall at that point, and only the last
          // stretch settles onto the flat spread.
          left: spreadHands,
          right: spreadHands,
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
        duration: 4500,
        ease: 'linear',
        to: () => spread2,
        stagger: { by: 'card', spread: 0.7, span: 0.3 },
        hands: {
          left: smooshHands(1, 0.62),
          right: smooshHands(1, 0.62),
        },
        annotations: [
          { text: 'Palms flat, fingers raking — a card moves only when a pad crosses it', appearAt: 0.15 },
        ],
      },
      {
        kind: 'move',
        id: 'smoosh-2',
        label: 'Reverse direction — break up every clump',
        duration: 4500,
        ease: 'linear',
        to: () => spread3,
        stagger: { by: 'card', spread: 0.7, span: 0.3 },
        hands: {
          left: smooshHands(-1, 0.38),
          right: smooshHands(-1, 0.38),
        },
        annotations: [
          { text: 'Casinos wash for a full minute — change direction often', appearAt: 0.2 },
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
        camera: 'overview',
        hands: {
          right: [
            { at: 0.15, pose: 'deckApproach', anchor: plowAt(PLOW_FROM, 0.2) },
            { at: 0.85, pose: 'deckApproach', anchor: plowAt(PLOW_TO, 0.02), ease: 'easeInOutCubic', fingerMotion: PLOW_RAKE },
            { at: 1, pose: 'deckApproach', anchor: plowAt(PLOW_TO + 0.06, 0.04) },
          ],
          // The other palm is the wall the cards stop against, parked with its
          // pads just past the heap's far long edge.
          left: [{ at: 0.3, pose: 'deckApproach', anchor: plowAt(WALL_X, 0.06) }],
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
            { at: 0.12, pose: 'deckApproach', anchor: plowAt(PLOW_FROM, 0.2) },
            { at: 0.85, pose: 'deckApproach', anchor: plowAt(PLOW_TO, 0.02), ease: 'easeInOutCubic', fingerMotion: PLOW_RAKE },
            { at: 1, pose: 'deckApproach', anchor: plowAt(PLOW_TO + 0.06, 0.04) },
          ],
          right: [{ at: 0.3, pose: 'deckApproach', anchor: plowAt(WALL_X, 0.06) }],
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
          left: [{ at: 1, pose: 'deckRest', anchor: restAt(DECK_PAD_X, fullTop, 0) }],
          right: [{ at: 1, pose: 'deckRest', anchor: restAt(DECK_PAD_X, fullTop, 0) }],
        },
      },
    ]
  },
}
