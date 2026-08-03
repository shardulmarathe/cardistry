import * as THREE from 'three'
import { faceQuat } from '../engine/layouts'
import { shuffleArray } from '../../lib/shuffleMath'
import { CARD_GAP, CARD_H, CARD_T, CARD_W } from '../../lib/constants'
import { DECK_REST_DROP, DECK_APPROACH_DROP } from '../../hands/handPoses'
import { FINGERS, HAND_SCALE } from '../../hands/handRigSpec'
import { poseWithContacts, rigMetrics, surfaceContact, wristAnchorForContact } from '../authoring/contacts'

// Card wash where the HANDS do the washing. Each palm owns one half of the
// table and circles over it; a card only moves when that palm passes over it:
// its swirl is centred on the hand's orbit, scaled by how close it sits to the
// hand's actual path, and its motion window is staggered to the moment the
// hand sweeps through its angle. The gather is two plow sweeps — each hand
// pushes its half of the spread into the middle, nearest-to-the-hand first.

// --- The smoosh hand ---------------------------------------------------------
// `washPress` is authored palm-down with the fingers pointing at the CAMERA and
// the thumb abducted straight out to −x. That thumb is a whole hand long: at the
// old rig scale it stuck out 0.55 and the two mirrored palms merely brushed; at
// HAND_SCALE 13 it reaches 1.56, so both thumbs would sweep clean through each
// other across the middle of the table. Yaw the press INWARD instead — the same
// REACH_IN turn deckRest and the plow already use — and each hand reaches in
// from its own side with fingertips leading and the thumb trailing safely to
// −z. Authored ONCE, for the right hand: the engine's x-mirror gives the left
// hand the correct opposite yaw (never mirror a quaternion by hand).
const PALM_DOWN = Math.PI / 2
const REACH_IN = -Math.PI / 2
const PRESS_QUAT = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(PALM_DOWN + 0.06, REACH_IN, 0, 'YXZ'),
)
const PRESS_POSE = poseWithContacts('washPress', 'right', { quat: PRESS_QUAT })
// Measured under that yaw — the press pose's own DECK_REST_DROP. Its deepest
// finger surface IS the middle pad, so a pad solved tangent on a card is the
// whole hand solved tangent on it.
const PRESS = rigMetrics('washPress', PRESS_QUAT)
// Breathing room the idle overlay and the ease into a pose need. Hand-sized:
// a bigger hand breathes bigger (handPoses.js carries the same constant).
const CONTACT_AIR = 0.003 * HAND_SCALE

// A flat face-down card — the plane every hand in this lesson meets.
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
const pressAt = (x, y, z, lift = 0) => padAt('washPress', PRESS_QUAT, PRESS_DROP, x, y, z, lift)
// The open/rest poses are already yawed inward, so they need no quat override,
// and their exported DROP constants are this same measurement plus its air.
const openAt = (x, y, z, lift = 0) => padAt('deckApproach', null, DECK_APPROACH_DROP, x, y, z, lift)
const restAt = (x, y, z) => padAt('deckRest', null, DECK_REST_DROP, x, y, z)

// Each hand's circular smoosh, in WORLD coords, authored around the PALM'S
// CONTACT PATCH rather than its wrist — at this scale those are 1.83 apart, so
// orbiting the wrist over the spread swings the actual pads a card-length and a
// half off the table. The right hand's pads orbit C=(CX,CZ); the left hand is
// the engine's x-mirror, so its centre is −CX and its visual direction is
// reversed. `cyc` (+1/−1) is the authored orbit sign.
const AMP = 0.28
// Both palms reach their inner point at the SAME instant, so the only thing
// keeping them from merging into one translucent mass is how close the
// inboard-most part of one hand gets to the centre line. Under the inward yaw
// that part is the middle fingertip, one tip-radius past the pad — a HAND-sized
// distance, so it is measured, not typed. (The rule this replaces, "keep ≥0.5
// between the wrists", was authored for a hand 2.83× smaller and is now met by
// a factor of eight while the fingers still crossed.)
const TIP_R = FINGERS.middle.rad[2] * HAND_SCALE
const PALM_GAP = 2 * TIP_R // air left between the two hands at closest approach
const CX = AMP + TIP_R + PALM_GAP / 2 // pad-orbit centre
const CZ = 0.25
// The spread's cards scatter to y = 0.02..0.034 (card centres); the palms have
// to clear the highest of them for the whole sweep.
const SPREAD_TOP = 0.034

// The squared deck the lesson opens and closes on: 52 cards, top card centre.
const DECK_TOP = (n) => 0.02 + (n - 1) * CARD_GAP
// Where the pads land on that deck's top card: out near its long edge, on each
// hand's own side, so two hands squaring it do not put their fingers in the
// same place. Card-relative — this one genuinely does not scale with the hand.
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
// distance from the hand's circular path — cards the palm actually crosses get
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
  difficulty: 'beginner',
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
    // palms for the whole step — the palms then had to hover above a deck that
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
    // A plow does not build a squared stack — it builds a HEAP. Landing the
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
    // on the heap they just built — both card-sized distances, so they say what
    // they mean at any hand scale.
    const PLOW_FROM = 1.0 + CARD_W / 2 // just past the spread's outer edge
    const PLOW_TO = CARD_W * 0.3 // on top of the heap
    const WALL_X = 0.075 + CARD_W // the far side of the heap, where cards stop
    const plowAt = (padX, padZ) => openAt(padX, HEAP_TOP, padZ)
    const squareHands = [
      {
        at: 0.6,
        pose: 'deckRest',
        anchor: restAt(DECK_PAD_X, fullTop, 0),
        fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tighten', amp: 0.05 }],
      },
    ]
    const spreadHands = [
      // Held HIGH through the turn — the deck is still most of its 0.22 tall at
      // this point — then settling onto the flat spread.
      { at: 0.4, pose: PRESS_POSE, anchor: pressAt(CX + AMP, startTop, CZ, CARD_H * 0.25), ease: 'easeInOutCubic' },
      { at: 1, pose: PRESS_POSE, anchor: SM_ANCHOR, ease: 'linear', motion: { type: 'orbit', amp: AMP, cycles: 1 } },
    ]
    // The opening beat: both hands come in from the sides and CLOSE onto the
    // squared deck (fingertips tangent on its top card) before anything moves.
    //
    // The `at: 0` keyframe is load-bearing. Without one the compiler builds a
    // lead-in FROM the pose carried forward, which at the first step of a
    // lesson is `relaxed` at its own default wrist — and `relaxed` parks a hand
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
        // Cards SLIDE — a wash never lifts them. (It also keeps every card's
        // top face under the palms' contact height for the whole step.)
        arcLift: 0.02,
        camera: 'topDown',
        hands: {
          // The palms are already on the stack; they turn out of the inward
          // "rest" yaw and spiral away while the stack peels down under them.
          // The first keyframe holds them HIGH through that turn — the deck is
          // still most of its 0.21 tall at that point — and only the last
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
          left: [{ at: 1, pose: PRESS_POSE, anchor: SM_ANCHOR, ease: 'linear', motion: { type: 'orbit', amp: AMP, cycles: 1 } }],
          right: [{ at: 1, pose: PRESS_POSE, anchor: SM_ANCHOR, ease: 'linear', motion: { type: 'orbit', amp: AMP, cycles: 1 } }],
        },
        annotations: [
          { text: 'Palms flat — a card moves only when a palm drags it', appearAt: 0.15 },
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
          left: [{ at: 1, pose: PRESS_POSE, anchor: SM_ANCHOR, ease: 'linear', motion: { type: 'orbit', amp: AMP, cycles: -1 } }],
          right: [{ at: 1, pose: PRESS_POSE, anchor: SM_ANCHOR, ease: 'linear', motion: { type: 'orbit', amp: AMP, cycles: -1 } }],
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
            { at: 0.85, pose: 'deckApproach', anchor: plowAt(PLOW_TO, 0.02), ease: 'easeInOutCubic' },
            { at: 1, pose: 'deckApproach', anchor: plowAt(PLOW_TO + 0.06, 0.04) },
          ],
          // The other palm is the wall the cards stop against — parked with its
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
            { at: 0.85, pose: 'deckApproach', anchor: plowAt(PLOW_TO, 0.02), ease: 'easeInOutCubic' },
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
