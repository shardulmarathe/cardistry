import { stackLayout, springArchLayout, cascadeLayout } from '../engine/layouts'

export const waterfallLesson = {
  id: 'waterfall',
  title: 'Spring / Waterfall',
  technique: 'waterfall',
  difficulty: 'intermediate',
  randomizes: 'Display only',
  seed: 77,
  cameraPreset: 'dealerPOV',
  summary:
    'Bend the deck into an arch between your hands, then release cards one at a time in a cascading waterfall. A bend-shader showcase.',
  facts: [
    'The spring stores elastic energy in the bowed cards — the waterfall is that energy releasing card by card.',
    'This is display, not mixing — but it teaches the same bend physics as the riffle bridge.',
  ],
  build: () => [
    {
      kind: 'move',
      id: 'grip',
      label: 'Hold the deck between both hands',
      duration: 700,
      to: (dk) => stackLayout(dk),
      hands: {
        left: { from: 'relaxed', to: 'twoHandsSupport' },
        right: { from: 'relaxed', to: 'twoHandsSupport' },
      },
    },
    {
      kind: 'move',
      id: 'arch',
      label: 'Bow the deck into a spring arch',
      duration: 1100,
      ease: 'easeOutCubic',
      to: (dk) => springArchLayout(dk, 3.0),
      bend: 3.0,
      hands: { left: { to: 'springRelease' }, right: { to: 'springRelease' } },
      annotations: [
        { text: 'Load the spring — same physics as the riffle bridge', at: [0, 0.8, 0.6] },
      ],
    },
    {
      kind: 'move',
      id: 'cascade',
      label: 'Release — cards waterfall downward',
      duration: 2200,
      ease: 'easeInOutCubic',
      to: (dk) => cascadeLayout(dk, 1),
      midBend: 2.2,
      hands: { left: { to: 'springRelease' }, right: { to: 'bridgeRelease' } },
    },
    {
      kind: 'move',
      id: 'gather',
      label: 'Catch and square the deck',
      duration: 1000,
      ease: 'easeOutCubic',
      to: (dk) => stackLayout(dk),
      bend: 0,
      camera: 'overview',
    },
  ],
}
