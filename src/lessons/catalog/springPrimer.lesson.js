import { stackLayout, springArchLayout } from '../engine/layouts'

export const springPrimerLesson = {
  id: 'spring-primer',
  title: 'Card Spring Primer',
  technique: 'spring',
  difficulty: 'beginner',
  randomizes: 'Educational',
  seed: 1,
  cameraPreset: 'closeUp',
  summary:
    'Before any shuffle: learn how a card bends elastically under pressure, stores spring energy, and snaps back — or creases permanently if you push too far.',
  facts: [
    'Elastic bend stores energy in the card fibers — release it cleanly and the card springs back flat.',
    'Push past the yield point and the card creases permanently. That is why riffle technique matters.',
  ],
  build: () => [
    {
      kind: 'move',
      id: 'flat',
      label: 'Start with a squared deck',
      duration: 700,
      to: (dk) => stackLayout(dk),
      hands: {
        left: { from: 'relaxed', to: 'twoHandsSupport' },
        right: { from: 'relaxed', to: 'twoHandsSupport' },
      },
    },
    {
      kind: 'move',
      id: 'load',
      label: 'Bow the deck — load the spring',
      duration: 1100,
      ease: 'easeOutCubic',
      to: (dk) => springArchLayout(dk, 2.4),
      bend: 2.4,
      midBend: 0.6,
      hands: { left: { to: 'springRelease' }, right: { to: 'springRelease' } },
      annotations: [
        {
          text: 'Elastic bend stores energy — do not crease',
          at: [0, 0.75, 0.6],
          appearAt: 0.2,
        },
      ],
    },
    {
      kind: 'move',
      id: 'release',
      label: 'Release — let it snap back flat',
      duration: 900,
      ease: 'easeInOutCubic',
      to: (dk) => stackLayout(dk),
      bend: 0,
      annotations: [
        { text: 'Past the yield point, the bend becomes permanent', at: [0, 0.7, 0.55] },
      ],
    },
    {
      kind: 'hold',
      id: 'hold',
      label: 'Feel the difference between spring and crease',
      duration: 600,
    },
  ],
}
