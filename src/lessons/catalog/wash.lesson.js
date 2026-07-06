import * as THREE from 'three'
import { stackLayout, faceQuat } from '../engine/layouts'
import { shuffleArray } from '../../lib/shuffleMath'

// Scatter every card across the felt, face-down, at random spots + angles, with
// a touch of bend so they read as loose cards rather than rigid tiles.
function scatterLayout(deck, rng, spread = 2.1) {
  return deck.map((card) => {
    const r = spread * Math.sqrt(rng())
    const a = rng() * Math.PI * 2
    return {
      id: card.id,
      pos: new THREE.Vector3(
        Math.cos(a) * r,
        0.02 + rng() * 0.014,
        Math.sin(a) * r * 0.66,
      ),
      quat: faceQuat(false, (rng() - 0.5) * Math.PI),
      bend: (rng() - 0.5) * 0.9,
    }
  })
}

// Swirl a previous scatter: rotate every card's (x,z) about the table center by
// a common-ish angle (jittered per card) so the whole spread turns the way the
// hands are circling. `radiusScale` < 1 pulls the cards gently inward. This is
// what makes the cards visibly follow the hands' circular smoosh.
function swirl(prev, rng, angle, radiusScale = 1) {
  return prev.map((p) => {
    const a = angle * (0.7 + 0.6 * rng())
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    const x = p.pos.x * radiusScale
    const z = p.pos.z * radiusScale
    return {
      id: p.id,
      pos: new THREE.Vector3(x * cos - z * sin, 0.02 + rng() * 0.014, x * sin + z * cos),
      quat: faceQuat(false, (rng() - 0.5) * Math.PI),
      bend: (rng() - 0.5) * 0.9,
    }
  })
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
  // Paced for teaching (~20s at 1×). Both palms press flat ON the cards and
  // circle — left and right counter-rotate — dragging the spread around, then
  // sweep everything back into a squared deck.
  build: (deck, ctx) => {
    const rng = ctx.rng
    const spread1 = scatterLayout(deck, rng, 2.4)
    const spread2 = swirl(spread1, rng, 1.1)
    const spread3 = swirl(spread2, rng, -1.1)
    const spread4 = swirl(spread3, rng, 0.9, 0.9)
    const finalOrder = shuffleArray(deck, rng)
    return [
      {
        kind: 'move',
        id: 'spread',
        label: 'Spread every card face-down',
        duration: 3000,
        ease: 'easeOutCubic',
        to: () => spread1,
        stagger: { by: 'card', spread: 0.5, span: 0.5 },
        arcLift: 0.15,
        camera: 'topDown',
        hands: {
          left: [{ at: 1, pose: 'washPress', anchor: [0.85, 0.2, 0.3] }],
          right: [{ at: 1, pose: 'washPress', anchor: [0.85, 0.2, 0.3] }],
        },
        annotations: [
          {
            text: 'The wash (or “smoosh”) is one of the strongest randomizers',
            at: [0, 0.9, 0],
            appearAt: 0.25,
          },
        ],
      },
      {
        kind: 'move',
        id: 'smoosh-1',
        label: 'Swirl the cards in big circles',
        duration: 4000,
        ease: 'linear',
        to: () => spread2,
        hands: {
          left: [
            { at: 0, pose: 'washPress', anchor: [0.85, 0.2, 0.3] },
            { at: 1, pose: 'washPress', anchor: [0.85, 0.2, 0.3], ease: 'linear', motion: { type: 'orbit', amp: 0.55, cycles: 2 } },
          ],
          right: [
            { at: 0, pose: 'washPress', anchor: [0.85, 0.2, 0.3] },
            { at: 1, pose: 'washPress', anchor: [0.85, 0.2, 0.3], ease: 'linear', motion: { type: 'orbit', amp: 0.55, cycles: 2 } },
          ],
        },
        annotations: [
          { text: 'Palms flat — slide the cards around, don’t lift them', at: [0, 0.9, 0], appearAt: 0.15 },
        ],
      },
      {
        kind: 'move',
        id: 'smoosh-2',
        label: 'Reverse direction — break up every clump',
        duration: 4000,
        ease: 'linear',
        to: () => spread3,
        hands: {
          left: [
            { at: 0, pose: 'washPress', anchor: [0.85, 0.2, 0.3] },
            { at: 1, pose: 'washPress', anchor: [0.85, 0.2, 0.3], ease: 'linear', motion: { type: 'orbit', amp: 0.55, cycles: -2 } },
          ],
          right: [
            { at: 0, pose: 'washPress', anchor: [0.85, 0.2, 0.3] },
            { at: 1, pose: 'washPress', anchor: [0.85, 0.2, 0.3], ease: 'linear', motion: { type: 'orbit', amp: 0.55, cycles: -2 } },
          ],
        },
        annotations: [
          { text: 'Casinos wash for a full minute — change direction often', at: [0, 0.9, 0], appearAt: 0.2 },
        ],
      },
      {
        kind: 'move',
        id: 'smoosh-3',
        label: 'Cross the hands over and keep mixing',
        duration: 3200,
        ease: 'easeInOutCubic',
        to: () => spread4,
        hands: {
          left: [
            { at: 0, pose: 'washPress', anchor: [0.85, 0.2, 0.3] },
            { at: 0.5, pose: 'washPress', anchor: [-0.35, 0.2, 0.1] },
            { at: 1, pose: 'washPress', anchor: [0.85, 0.2, 0.3], motion: { type: 'orbit', amp: 0.4, cycles: 1 } },
          ],
          right: [
            { at: 0, pose: 'washPress', anchor: [0.85, 0.2, 0.3] },
            { at: 0.5, pose: 'washPress', anchor: [-0.35, 0.2, 0.1] },
            { at: 1, pose: 'washPress', anchor: [0.85, 0.2, 0.3], motion: { type: 'orbit', amp: 0.4, cycles: 1 } },
          ],
        },
      },
      {
        kind: 'move',
        id: 'gather',
        label: 'Sweep everything back into a squared deck',
        duration: 4000,
        ease: 'easeInOutCubic',
        reorder: () => finalOrder,
        to: (dk) => stackLayout(dk),
        stagger: { by: 'card', spread: 0.6, span: 0.4 },
        arcLift: 0.1,
        camera: 'overview',
        hands: {
          left: [
            { at: 0, pose: 'washPress', anchor: [0.85, 0.2, 0.3] },
            { at: 0.55, pose: 'washPress', anchor: [0.5, 0.22, 0.15] },
            { at: 1, pose: 'twoHandsSupport', anchor: [0.18, 0.4, 0.06] },
          ],
          right: [
            { at: 0, pose: 'washPress', anchor: [0.85, 0.2, 0.3] },
            { at: 0.55, pose: 'washPress', anchor: [0.5, 0.22, 0.15] },
            { at: 1, pose: 'twoHandsSupport', anchor: [0.18, 0.4, 0.06] },
          ],
        },
        annotations: [
          { text: 'Corral the cards inward and square them up', at: [0, 0.8, 0.4], appearAt: 0.5 },
        ],
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
