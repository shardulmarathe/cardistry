import { stackLayout, springArchLayout, cascadeLayout } from '../engine/layouts'
import { cageGrip } from '../authoring/contacts'

// Spring / waterfall, finger-driven: the hands cage the deck's ends FIRST
// (same orientation held throughout, so the deck bows in place between the
// fingers), pressure loads the spring, and every card leaves the cage at its
// own moment into the waterfall.
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
  build: () => {
    const { pose: cage, anchor: CAGE_ANCHOR } = cageGrip({ topY: 0.32 })
    const NOTE_POS = [-1.3, 0.75, 0.2]

    return [
      {
        kind: 'hold',
        id: 'approach',
        label: 'Cup the ends of the deck',
        duration: 1200,
        hands: {
          left: [
            { at: 0.25, pose: 'relaxed' },
            { at: 1, pose: cage, anchor: CAGE_ANCHOR, ease: 'anticipate' },
          ],
          right: [
            { at: 0.25, pose: 'relaxed' },
            { at: 1, pose: cage, anchor: CAGE_ANCHOR, ease: 'anticipate' },
          ],
        },
      },
      {
        kind: 'move',
        id: 'arch',
        label: 'Squeeze — bow the deck into a spring arch',
        duration: 1500,
        ease: 'easeOutCubic',
        to: (dk) => springArchLayout(dk, 3.0),
        bend: 3.0,
        grip: {
          right: { cards: 'all', frame: 'packet', bendGain: 0.5, pressure: [{ at: 0, v: 0.3 }, { at: 1, v: 1 }] },
        },
        hands: {
          left: [{ at: 1, pose: cage, anchor: CAGE_ANCHOR, fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tighten', amp: 0.05 }] }],
          right: [{ at: 1, pose: cage, anchor: CAGE_ANCHOR, fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tighten', amp: 0.05 }] }],
        },
        annotations: [
          { text: 'Load the spring — same physics as the riffle bridge', at: NOTE_POS, appearAt: 0.25 },
        ],
      },
      {
        kind: 'move',
        id: 'cascade',
        label: 'Release — cards waterfall out of the cage',
        duration: 2600,
        ease: 'easeInOutCubic',
        to: (dk) => cascadeLayout(dk, 1),
        midBend: 1.6,
        stagger: { by: 'card', spread: 0.65, span: 0.35 },
        grip: {
          right: { cards: 'all', frame: 'packet', release: 'stagger', pressure: [{ at: 0, v: 1 }, { at: 1, v: 0.15 }] },
        },
        hands: {
          left: [
            { at: 0, pose: cage, anchor: CAGE_ANCHOR },
            {
              at: 0.6,
              fingers: { thumb: [0.15, 0.12, 0.08] },
              anchor: [CAGE_ANCHOR[0] - 0.02, CAGE_ANCHOR[1] - 0.05, CAGE_ANCHOR[2]],
              fingerMotion: [{ fingers: ['index', 'middle', 'ring', 'pinky'], type: 'curlRipple', amp: 0.05, cycles: 3 }],
            },
            { at: 1, fingers: { index: [0.5, 0.4, 0.28] }, anchor: [0.62, 0.36, 0.0] },
          ],
          right: [
            { at: 0, pose: cage, anchor: CAGE_ANCHOR },
            {
              at: 0.6,
              fingers: { thumb: [0.15, 0.12, 0.08] },
              anchor: [CAGE_ANCHOR[0] - 0.02, CAGE_ANCHOR[1] - 0.05, CAGE_ANCHOR[2]],
              fingerMotion: [{ fingers: ['index', 'middle', 'ring', 'pinky'], type: 'curlRipple', amp: 0.05, cycles: 3 }],
            },
            { at: 1, fingers: { index: [0.5, 0.4, 0.28] }, anchor: [0.62, 0.36, 0.0] },
          ],
        },
        annotations: [
          { text: 'Card by card off the fingertips — that is the waterfall', at: NOTE_POS, appearAt: 0.2, until: 0.9 },
        ],
      },
      {
        kind: 'move',
        id: 'gather',
        label: 'Catch and square the deck',
        duration: 1200,
        ease: 'settle',
        to: (dk) => stackLayout(dk),
        bend: 0,
        camera: 'overview',
        hands: {
          left: [{ at: 1, pose: 'twoHandsSupport', anchor: [0.25, 0.36, 0.06], ease: 'settle' }],
          right: [{ at: 1, pose: 'twoHandsSupport', anchor: [0.25, 0.36, 0.06], ease: 'settle' }],
        },
      },
    ]
  },
}
