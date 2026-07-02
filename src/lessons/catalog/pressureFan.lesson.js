import { stackLayout, pressureFanLayout } from '../engine/layouts'

export const pressureFanLesson = {
  id: 'pressure-fan',
  title: 'Pressure Fan',
  technique: 'fan',
  difficulty: 'intermediate',
  randomizes: 'Display only',
  seed: 55,
  cameraPreset: 'overview',
  summary:
    'A display flourish: pressure-spread the deck from a pivot corner into a blooming circular fan. Beautiful — but it does not shuffle.',
  facts: [
    'The pressure fan is a display flourish — cards spread under thumb pressure, not interleaved.',
    'Master the pivot corner: one edge stays anchored while the arc blooms outward.',
  ],
  build: () => [
    {
      kind: 'move',
      id: 'grip',
      label: 'Pinch the deck at the pivot corner',
      duration: 700,
      to: (dk) => stackLayout(dk),
      hands: {
        left: { from: 'relaxed', to: 'twoHandsSupport' },
        right: { from: 'relaxed', to: 'pinchCut' },
      },
    },
    {
      kind: 'move',
      id: 'bloom',
      label: 'Spread pressure outward — bloom the fan',
      duration: 1600,
      ease: 'easeOutCubic',
      to: (dk) => pressureFanLayout(dk, { progress: 1 }),
      hands: { right: { to: 'fanSpread' } },
      annotations: [
        { text: 'Anchor one corner — let the arc bloom', at: [0.5, 0.7, 0.3], appearAt: 0.2 },
      ],
    },
    {
      kind: 'move',
      id: 'close',
      label: 'Close the fan back into a stack',
      duration: 1200,
      ease: 'easeInOutCubic',
      to: (dk) => stackLayout(dk),
      camera: 'overview',
    },
  ],
}
