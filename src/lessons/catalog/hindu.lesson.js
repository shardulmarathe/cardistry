import { stackLayout, blocksRowLayout } from '../engine/layouts'
import { splitIntoRandomBlocks, shuffleArray } from '../../lib/shuffleMath'

// Hindu shuffle, finger-driven: the RIGHT hand holds the whole deck in a pinch
// and each packet leaves that grip at its own moment (release:'stagger') as the
// left hand sweeps beneath to draw it away; then everything falls packet by
// packet back onto the pile. The right hand never freezes — the deck visibly
// empties out of it.
export const hinduLesson = {
  id: 'hindu',
  title: 'Hindu Shuffle',
  technique: 'hindu',
  difficulty: 'beginner',
  randomizes: 'Weak',
  seed: 99,
  cameraPreset: 'dealerPOV',
  summary:
    'Hold the deck by its ends and draw packets off the top, letting them fall into your other hand. Elegant — but, like the overhand, it only moves blocks.',
  facts: [
    'The Hindu shuffle strips packets off the top and lets them cascade — the same block-transport family as the overhand, so it mixes weakly.',
    'Magicians exploit that weakness to keep a stack of cards intact while appearing to shuffle.',
  ],
  build: (deck, ctx) => {
    const rng = ctx.rng
    const NOTE_POS = [-1.3, 0.7, 0.2]
    const steps = [
      {
        kind: 'move',
        id: 'ready',
        label: 'Hold the deck by its ends',
        duration: 1300,
        to: (dk) => stackLayout(dk),
        hands: {
          right: [
            { at: 0.3, pose: 'relaxed' },
            { at: 1, pose: 'packetGrab', anchor: [0.06, 0.52, 0.0], ease: 'anticipate' },
          ],
          left: [{ at: 0.6, pose: 'twoHandsSupport', anchor: [0.55, 0.35, 0.15], ease: 'anticipate' }],
        },
        annotations: [
          { text: 'Hindu draws packets off the top and lets them cascade down', at: NOTE_POS, appearAt: 0.15 },
        ],
      },
    ]
    let d = deck
    for (let r = 0; r < 2; r++) {
      const blocks = splitIntoRandomBlocks(d, 3, rng)
      steps.push({
        kind: 'move',
        id: `draw-${r}`,
        label: 'Draw packets off the top',
        duration: 1700,
        ease: 'easeOutCubic',
        to: () => blocksRowLayout(blocks, { spacing: 1.05 }),
        stagger: { by: 'packet' },
        // The whole deck sits in the right hand's pinch; each packet LEAVES
        // that grip exactly when its draw begins.
        grip: {
          right: { cards: 'all', frame: 'pinch', release: 'stagger', pressure: [{ at: 0, v: 0.6 }, { at: 1, v: 0.2 }] },
        },
        hands: {
          right: [
            {
              at: 0.5,
              fingers: { thumb: [0.35, 0.3, 0.2] },
              anchor: [0.06, 0.52, 0.0],
              fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tremor', amp: 0.03, cycles: 3 }],
            },
          ],
          // The left hand sweeps under the released packets, ferrying them out.
          left: [
            { at: 0.25, pose: 'twoHandsSupport', anchor: [0.2, 0.3, 0.12] },
            { at: 0.65, pose: 'twoHandsSupport', anchor: [0.75, 0.28, 0.12], motion: { type: 'rock', axis: 'y', amp: 0.02, cycles: 2 } },
            { at: 1, pose: 'twoHandsSupport', anchor: [1.05, 0.28, 0.1] },
          ],
        },
      })
      const newOrder = shuffleArray(blocks, rng).flat()
      steps.push({
        kind: 'move',
        id: `fall-${r}`,
        label: 'Let each packet fall onto the pile',
        duration: 1600,
        ease: 'snapEase',
        reorder: () => newOrder,
        to: (dk) => stackLayout(dk),
        stagger: { by: 'packet', spread: 0.5, span: 0.5 },
        hands: {
          // Left palm guides the falling packets home; right steadies above.
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
      label: 'Blocks moved — barely mixed',
      duration: 900,
      hands: {
        left: [{ at: 1, pose: 'relaxed', ease: 'easeInOutCubic' }],
        right: [{ at: 1, pose: 'relaxed', ease: 'easeInOutCubic' }],
      },
    })
    return steps
  },
}
