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
      duration: 1000,
      to: (dk) => stackLayout(dk),
      hands: {
        left: [
          { at: 0.3, pose: 'relaxed' },
          { at: 1, pose: 'pinchCut', anchor: [0.08, 0.42, 0.12], ease: 'anticipate' },
        ],
        right: [
          { at: 0.3, pose: 'relaxed' },
          { at: 1, pose: 'washFlat', anchor: [0.2, 0.4, 0.0], ease: 'anticipate' },
        ],
      },
    },
    {
      kind: 'move',
      id: 'bloom',
      label: 'Sweep — the arc blooms under thumb pressure',
      duration: 2000,
      ease: 'easeOutCubic',
      to: (dk) => pressureFanLayout(dk, { progress: 1 }),
      stagger: { by: 'card', spread: 0.5, span: 0.5 },
      hands: {
        // Left hand anchors the pivot corner; the right sweeps the bloom arc,
        // fingers splaying open as it travels.
        left: [
          {
            at: 0.6,
            pose: 'pinchCut',
            anchor: [0.08, 0.42, 0.12],
            fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tighten', amp: 0.05 }],
          },
        ],
        right: [
          { at: 0.15, pose: 'washFlat', anchor: [0.35, 0.36, 0.3] },
          { at: 0.55, pose: 'fanSpread', anchor: [0.75, 0.38, 0.05], splay: { index: 0.1, pinky: -0.06 } },
          { at: 1, pose: 'fanSpread', anchor: [0.95, 0.4, -0.25], splay: { index: 0.14, pinky: -0.1 } },
        ],
      },
      annotations: [
        { text: 'Anchor one corner — let the arc bloom', at: [-1.25, 0.7, 0.2], appearAt: 0.2 },
      ],
    },
    {
      kind: 'move',
      id: 'close',
      label: 'Sweep it shut and square up',
      duration: 1400,
      ease: 'settle',
      to: (dk) => stackLayout(dk),
      stagger: { by: 'card', spread: 0.45, span: 0.55 },
      camera: 'overview',
      hands: {
        right: [
          { at: 0.6, pose: 'washFlat', anchor: [0.4, 0.36, 0.1], motion: { type: 'rock', axis: 'x', amp: 0.06, cycles: 1 } },
          { at: 1, pose: 'relaxed', ease: 'settle' },
        ],
        left: [
          { at: 0.7, pose: 'twoHandsSupport', anchor: [0.15, 0.38, 0.08] },
          { at: 1, pose: 'relaxed', ease: 'settle' },
        ],
      },
    },
  ],
}
