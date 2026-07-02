import { stackLayout, twoHalvesLayout } from '../engine/layouts'

export const faroLesson = {
  id: 'faro',
  title: 'Faro Shuffle',
  technique: 'faro',
  difficulty: 'advanced',
  randomizes: 'None — controlled',
  seed: 8,
  cameraPreset: 'dealerPOV',
  summary:
    'A perfect weave: split exactly in half and interlace the halves one card at a time. It does not randomize at all — it is a precise, repeatable control move.',
  facts: [
    'A perfect faro is deterministic — eight out-faros return a 52-card deck to its exact original order.',
    'Because it controls positions precisely, the faro is a tool of magicians, not a way to randomize.',
  ],
  build: () => [
    {
      kind: 'move',
      id: 'split',
      label: 'Cut exactly 26 and 26',
      duration: 1200,
      ease: 'easeInOutCubic',
      to: (dk) => twoHalvesLayout(dk, 0.9),
      annotations: [
        { text: 'A faro needs a perfect 26 / 26 cut', at: [0, 0.7, 0.8], appearAt: 0.2 },
      ],
    },
    {
      kind: 'riffle',
      id: 'weave',
      label: 'Interlace one card at a time',
      duration: 2600,
      ease: 'easeInOutCubic',
      midBend: 0.9, // tight, precise weave — barely any bow
      arcLift: 0.14,
      annotations: [
        {
          text: 'Eight perfect out-faros restore the deck to its original order',
          at: [0, 0.8, 0.8],
          appearAt: 0.3,
        },
      ],
    },
    {
      kind: 'move',
      id: 'square',
      label: 'Square the deck',
      duration: 800,
      ease: 'easeOutCubic',
      to: (dk) => stackLayout(dk),
      bend: 0,
      camera: 'overview',
    },
  ],
}
