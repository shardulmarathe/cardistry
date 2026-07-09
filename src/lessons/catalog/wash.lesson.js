import * as THREE from 'three'
import { faceQuat } from '../engine/layouts'
import { shuffleArray } from '../../lib/shuffleMath'
import { CARD_GAP } from '../../lib/constants'

// Card wash where the HANDS do the washing. Each palm owns one half of the
// table and circles over it; a card only moves when that palm passes over it:
// its swirl is centred on the hand's orbit, scaled by how close it sits to the
// hand's actual path, and its motion window is staggered to the moment the
// hand sweeps through its angle. The gather is two plow sweeps — each hand
// pushes its half of the spread into the middle, nearest-to-the-hand first.

// Each hand's circular smoosh, in WORLD coords. The right hand orbits
// C=(CX,CZ); the left hand is the engine's x-mirror, so its centre is -CX and
// its visual direction is reversed. `cyc` (+1/-1) is the authored orbit sign.
// The two mirrored counter-rotating circles must NOT overlap: both palms reach
// their inner point at the same instant, so touching circles = merged hands.
const AMP = 0.28
const A_X = 0.76
const A_Y = 0.18
const A_Z = 0.25
const CX = A_X - AMP // orbit centre (the motion offset is zero at t=0)
const CZ = A_Z

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

    // Spread destinations, sorted so cards under each outward-spiralling palm
    // leave first (nearest the centre first, both sides progressing together).
    const scatter = scatterLayout(deck, rng)
    const bySide = { 1: [], '-1': [] }
    for (const p of scatter) bySide[p.pos.x >= 0 ? 1 : -1].push(p)
    for (const side of [1, -1]) {
      bySide[side].sort((a, b) => a.pos.length() - b.pos.length())
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
    const gatherRight = rightHalf
      .slice()
      .sort((a, b) => b.pos.x - a.pos.x)
      .map((p) => stackPose(p.id))
    const gatherLeft = leftHalf
      .slice()
      .sort((a, b) => a.pos.x - b.pos.x)
      .map((p) => stackPose(p.id))

    const SM_ANCHOR = [A_X, A_Y, A_Z]
    return [
      {
        kind: 'move',
        id: 'spread',
        label: 'Smear the deck out across the felt',
        duration: 3200,
        ease: 'easeOutCubic',
        to: () => spread1,
        stagger: { by: 'card', spread: 0.65, span: 0.35 },
        arcLift: 0.04,
        camera: 'topDown',
        hands: {
          // Both palms press onto the stack, then spiral outward — the cards
          // scatter under them, near ones first.
          left: [
            { at: 0.22, pose: 'washPress', anchor: [0.3, 0.2, 0.06] },
            { at: 1, pose: 'washPress', anchor: SM_ANCHOR, ease: 'easeOutCubic', motion: { type: 'orbit', amp: 0.3, cycles: 1 } },
          ],
          right: [
            { at: 0.22, pose: 'washPress', anchor: [0.3, 0.2, 0.06] },
            { at: 1, pose: 'washPress', anchor: SM_ANCHOR, ease: 'easeOutCubic', motion: { type: 'orbit', amp: 0.3, cycles: 1 } },
          ],
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
          left: [{ at: 1, pose: 'washPress', anchor: SM_ANCHOR, ease: 'linear', motion: { type: 'orbit', amp: AMP, cycles: 1 } }],
          right: [{ at: 1, pose: 'washPress', anchor: SM_ANCHOR, ease: 'linear', motion: { type: 'orbit', amp: AMP, cycles: 1 } }],
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
          left: [{ at: 1, pose: 'washPress', anchor: SM_ANCHOR, ease: 'linear', motion: { type: 'orbit', amp: AMP, cycles: -1 } }],
          right: [{ at: 1, pose: 'washPress', anchor: SM_ANCHOR, ease: 'linear', motion: { type: 'orbit', amp: AMP, cycles: -1 } }],
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
          // Right palm sweeps in from beyond the spread, pushing cards ahead
          // of it; the left palm waits at the far side as a wall.
          right: [
            { at: 0.15, pose: 'washPress', anchor: [1.45, 0.18, 0.25] },
            { at: 0.85, pose: 'washPress', anchor: [0.3, 0.2, 0.06], ease: 'easeInOutCubic' },
            { at: 1, pose: 'washPress', anchor: [0.38, 0.24, 0.1] },
          ],
          left: [{ at: 0.3, pose: 'washPress', anchor: [0.52, 0.19, 0.1] }],
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
            { at: 0.12, pose: 'washPress', anchor: [1.45, 0.18, 0.25] },
            { at: 0.85, pose: 'washPress', anchor: [0.3, 0.2, 0.06], ease: 'easeInOutCubic' },
            { at: 1, pose: 'washPress', anchor: [0.38, 0.24, 0.1] },
          ],
          right: [{ at: 0.3, pose: 'washPress', anchor: [0.52, 0.19, 0.1] }],
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
          left: [
            {
              at: 0.6,
              pose: 'twoHandsSupport',
              anchor: [0.42, 0.3, 0.02],
              fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tighten', amp: 0.05 }],
            },
          ],
          right: [
            {
              at: 0.6,
              pose: 'twoHandsSupport',
              anchor: [0.42, 0.3, 0.02],
              fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tighten', amp: 0.05 }],
            },
          ],
        },
      },
      {
        kind: 'hold',
        id: 'rest',
        label: 'Washed and squared',
        duration: 800,
        hands: {
          left: [{ at: 1, pose: 'relaxed' }],
          right: [{ at: 1, pose: 'relaxed' }],
        },
      },
    ]
  },
}
