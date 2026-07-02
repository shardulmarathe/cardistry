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
    const spread1 = scatterLayout(deck, rng)
    const spread2 = scatterLayout(deck, rng)
    const spread3 = scatterLayout(deck, rng)
    const finalOrder = shuffleArray(deck, rng)
    return [
      {
        kind: 'move',
        id: 'spread',
        label: 'Spread every card face-down',
        duration: 1300,
        ease: 'easeOutCubic',
        to: () => spread1,
        camera: 'topDown',
        hands: {
          left: { from: 'relaxed', to: 'washFlat' },
          right: { from: 'relaxed', to: 'washFlat' },
        },
        annotations: [
          {
            text: 'The wash (or “smoosh”) is one of the strongest randomizers',
            at: [0, 0.9, 0],
            appearAt: 0.2,
          },
        ],
      },
      {
        kind: 'move',
        id: 'smoosh-1',
        label: 'Swirl the cards in big circles',
        duration: 1100,
        ease: 'easeInOutCubic',
        to: () => spread2,
        hands: { left: { to: 'washFlat' }, right: { to: 'washFlat' } },
        annotations: [
          { text: 'Casinos wash for 6–10 seconds before dealing', at: [0, 0.9, 0] },
        ],
      },
      {
        kind: 'move',
        id: 'smoosh-2',
        label: 'Keep smooshing — break up every clump',
        duration: 1000,
        ease: 'easeInOutCubic',
        to: () => spread3,
      },
      {
        kind: 'move',
        id: 'gather',
        label: 'Gather into a squared deck',
        duration: 1500,
        ease: 'easeInOutCubic',
        reorder: () => finalOrder,
        to: (dk) => stackLayout(dk),
        camera: 'overview',
      },
    ]
  },
}
