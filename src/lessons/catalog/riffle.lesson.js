import { stackLayout, twoHalvesLayout } from '../engine/layouts'

// Riffle shuffle + bridge — the showcase lesson (real card bending).
export const riffleLesson = {
  id: 'riffle',
  title: 'Riffle Shuffle',
  technique: 'riffle',
  difficulty: 'intermediate',
  randomizes: 'Excellent',
  seed: 7,
  cameraPreset: 'dealerPOV',
  summary:
    'The gold-standard shuffle. Split the deck, bow each half, and let the cards interlace — then bridge and cascade them square.',
  facts: [
    'About 7 riffle shuffles are enough to randomize a 52-card deck (the Bayer–Diaconis result).',
    'The bend stores elastic spring energy — release it evenly and the cards cascade; crease it and you ruin the card.',
  ],
  build: () => [
    {
      kind: 'move',
      id: 'split',
      label: 'Split the deck into two halves',
      duration: 1300,
      ease: 'easeInOutCubic',
      to: (dk) => twoHalvesLayout(dk, 1.0),
      hands: {
        left: { from: 'relaxed', to: 'twoHandsSupport' },
        right: { from: 'relaxed', to: 'pinchCut' },
      },
      annotations: [
        {
          text: 'Cut roughly in half — about 26 cards each',
          at: [0, 0.7, 0.8],
          appearAt: 0.15,
        },
      ],
    },
    {
      kind: 'move',
      id: 'arch',
      label: 'Bow each half to load the spring',
      duration: 900,
      ease: 'easeOutCubic',
      to: (dk) => twoHalvesLayout(dk, 0.95),
      bend: 2.6,
      hands: {
        left: { to: 'riffleArch' },
        right: { to: 'riffleArch' },
      },
      annotations: [
        {
          text: 'Bend firmly — but never crease. That stored spring drives the weave.',
          at: [0, 0.85, 0.8],
        },
      ],
    },
    {
      kind: 'riffle',
      id: 'weave',
      label: 'Release the thumbs — let the cards interlace',
      duration: 2600,
      ease: 'easeInOutCubic',
      hands: {
        left: { to: 'bridgeRelease' },
        right: { to: 'bridgeRelease' },
      },
      annotations: [
        {
          text: 'About 7 riffles fully randomize a 52-card deck',
          at: [0, 0.8, 0.8],
          appearAt: 0.25,
        },
      ],
    },
    {
      kind: 'move',
      id: 'square',
      label: 'Square the deck',
      duration: 900,
      ease: 'easeOutCubic',
      to: (dk) => stackLayout(dk),
      bend: 0,
      camera: 'overview',
    },
  ],
}
