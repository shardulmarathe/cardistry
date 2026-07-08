import { stackLayout, blocksRowLayout } from '../engine/layouts'
import { splitIntoRandomBlocks, shuffleArray } from '../../lib/shuffleMath'

// Strip shuffle, finger-driven like the hindu: the deck rides the right hand's
// pinch and each big packet leaves that grip at its own strip moment; the left
// hand catches and presses the drops home.
export const stripLesson = {
  id: 'strip',
  title: 'Strip Shuffle',
  technique: 'strip',
  difficulty: 'beginner',
  randomizes: 'Weak',
  seed: 33,
  cameraPreset: 'dealerPOV',
  summary:
    'Like the overhand, but you strip off larger packets and drop them — fewer, bigger blocks move, so mixing stays weak.',
  facts: [
    'Strip shuffles move fewer, larger packets than the overhand — same block-transport weakness.',
    'Running cuts are the same family: packets lifted off and re-stacked without true interleaving.',
  ],
  build: (deck, ctx) => {
    const rng = ctx.rng
    const NOTE_POS = [-1.3, 0.7, 0.2]
    const steps = [
      {
        kind: 'move',
        id: 'ready',
        label: 'Hold the deck — strip grip',
        duration: 1200,
        to: (dk) => stackLayout(dk),
        hands: {
          right: [
            { at: 0.3, pose: 'relaxed' },
            { at: 1, pose: 'packetGrab', anchor: [0.06, 0.52, 0.0], ease: 'anticipate' },
          ],
          left: [{ at: 0.6, pose: 'twoHandsSupport', anchor: [0.55, 0.35, 0.15], ease: 'anticipate' }],
        },
        annotations: [
          { text: 'Strips move big blocks — quick, but a weak mix', at: NOTE_POS, appearAt: 0.2 },
        ],
      },
    ]
    let d = deck
    for (let r = 0; r < 2; r++) {
      const blocks = splitIntoRandomBlocks(d, 2, rng)
      steps.push({
        kind: 'move',
        id: `strip-${r}`,
        label: 'Strip a large packet off the top',
        duration: 1600,
        ease: 'easeOutCubic',
        to: () => blocksRowLayout(blocks, { spacing: 1.1 }),
        stagger: { by: 'packet' },
        grip: {
          right: { cards: 'all', frame: 'pinch', release: 'stagger', pressure: [{ at: 0, v: 0.6 }, { at: 1, v: 0.2 }] },
        },
        hands: {
          right: [
            {
              at: 0.5,
              fingers: { thumb: [0.35, 0.3, 0.2] },
              anchor: [0.06, 0.52, 0.0],
              fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tremor', amp: 0.03, cycles: 2 }],
            },
          ],
          left: [
            { at: 0.3, pose: 'twoHandsSupport', anchor: [0.25, 0.3, 0.12] },
            { at: 1, pose: 'twoHandsSupport', anchor: [0.9, 0.28, 0.1], motion: { type: 'rock', axis: 'y', amp: 0.02, cycles: 2 } },
          ],
        },
      })
      const newOrder = shuffleArray(blocks, rng).flat()
      steps.push({
        kind: 'move',
        id: `drop-${r}`,
        label: 'Drop the packet onto the pile',
        duration: 1500,
        ease: 'snapEase',
        reorder: () => newOrder,
        to: (dk) => stackLayout(dk),
        stagger: { by: 'packet', spread: 0.5, span: 0.5 },
        hands: {
          left: [
            { at: 0.4, pose: 'washFlat', anchor: [0.28, 0.42, 0.05], motion: { type: 'rock', axis: 'y', amp: 0.025, cycles: 2 } },
            { at: 1, pose: 'twoHandsSupport', anchor: [0.3, 0.34, 0.08] },
          ],
          right: [{ at: 0.6, pose: 'packetGrab', anchor: [0.06, 0.48, 0.0] }],
        },
      })
      d = newOrder
    }
    steps.push({
      kind: 'hold',
      id: 'rest',
      label: 'Restacked — same neighbours, new order',
      duration: 900,
      hands: {
        left: [{ at: 1, pose: 'relaxed', ease: 'easeInOutCubic' }],
        right: [{ at: 1, pose: 'relaxed', ease: 'easeInOutCubic' }],
      },
    })
    return steps
  },
}
