import { stackLayout, springArchLayout } from '../engine/layouts'
import { cageGrip } from '../authoring/contacts'

// The bend primer, finger-driven: hands cage the deck's ends, PRESSURE is what
// bows it (grip bendGain on top of the keyframed bend), and letting go lets it
// snap back flat with a settle.
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
  build: () => {
    const { pose: cage, anchor: CAGE_ANCHOR } = cageGrip({ topY: 0.28 })
    const NOTE_POS = [-1.25, 0.7, 0.2]

    return [
      {
        kind: 'hold',
        id: 'flat',
        label: 'Cup the squared deck between both hands',
        duration: 1100,
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
        id: 'load',
        label: 'Squeeze — bow the deck, load the spring',
        duration: 1400,
        ease: 'easeOutCubic',
        to: (dk) => springArchLayout(dk, 2.4),
        bend: 2.4,
        midBend: 0.4,
        grip: {
          right: { cards: 'all', frame: 'packet', bendGain: 0.5, pressure: [{ at: 0, v: 0.25 }, { at: 1, v: 1 }] },
        },
        hands: {
          left: [
            {
              at: 1,
              pose: cage,
              anchor: CAGE_ANCHOR,
              fingerMotion: [{ fingers: ['thumb', 'index', 'middle'], type: 'tremor', amp: 0.035, cycles: 3 }],
            },
          ],
          right: [
            {
              at: 1,
              pose: cage,
              anchor: CAGE_ANCHOR,
              fingerMotion: [{ fingers: ['thumb', 'index', 'middle'], type: 'tremor', amp: 0.035, cycles: 3 }],
            },
          ],
        },
        annotations: [
          { text: 'Elastic bend stores energy — do not crease', at: NOTE_POS, appearAt: 0.25 },
        ],
      },
      {
        kind: 'move',
        id: 'release',
        label: 'Let go — it snaps back flat',
        duration: 1000,
        ease: 'settle',
        to: (dk) => stackLayout(dk),
        bend: 0,
        hands: {
          left: [{ at: 0.5, fingers: { thumb: [0.12, 0.1, 0.06], index: [0.5, 0.4, 0.28] }, anchor: [0.6, 0.38, 0.0], ease: 'settle' }],
          right: [{ at: 0.5, fingers: { thumb: [0.12, 0.1, 0.06], index: [0.5, 0.4, 0.28] }, anchor: [0.6, 0.38, 0.0], ease: 'settle' }],
        },
        annotations: [
          { text: 'Past the yield point, the bend becomes permanent', at: NOTE_POS, appearAt: 0.3 },
        ],
      },
      {
        kind: 'hold',
        id: 'hold',
        label: 'Feel the difference between spring and crease',
        duration: 800,
        hands: {
          left: [{ at: 1, pose: 'relaxed', ease: 'easeInOutCubic' }],
          right: [{ at: 1, pose: 'relaxed', ease: 'easeInOutCubic' }],
        },
      },
    ]
  },
}
