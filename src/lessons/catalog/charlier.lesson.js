import { stackLayout, charlierLayout } from '../engine/layouts'

export const charlierLesson = {
  id: 'charlier',
  title: 'Charlier Cut',
  technique: 'charlier',
  difficulty: 'beginner',
  randomizes: 'None — a cut',
  seed: 14,
  cameraPreset: 'closeUp',
  summary:
    'A one-handed cut, not a shuffle: the bottom half pivots up and over to the top. Deterministic — it only cuts, it does not mix.',
  facts: [
    'The Charlier is a flourish cut, not a randomizer — the deck ends in a known half-and-half swap.',
    'It is a gateway move in cardistry: one hand, one fluid pivot.',
  ],
  build: (deck) => {
    const mid = Math.floor(deck.length / 2)
    const cutOrder = [...deck.slice(mid), ...deck.slice(0, mid)]
    return [
      {
        kind: 'move',
        id: 'grip',
        label: 'Pinch the deck in Charlier grip',
        duration: 700,
        to: (dk) => stackLayout(dk),
        hands: {
          left: { from: 'relaxed', to: 'twoHandsSupport' },
          right: { from: 'relaxed', to: 'pinchCut' },
        },
      },
      {
        kind: 'move',
        id: 'pivot',
        label: 'Pivot the bottom half up and over',
        duration: 1400,
        ease: 'easeInOutCubic',
        to: () => charlierLayout(deck, 1),
        midBend: 1.4,
        hands: { right: { to: 'fanSpread' } },
        annotations: [
          { text: 'A cut, not a shuffle — deterministic half swap', at: [0, 0.8, 0.5], appearAt: 0.25 },
        ],
      },
      {
        kind: 'move',
        id: 'land',
        label: 'Square the cut deck',
        duration: 800,
        ease: 'easeOutCubic',
        reorder: () => cutOrder,
        to: (dk) => stackLayout(dk),
        bend: 0,
        camera: 'overview',
      },
    ]
  },
}
