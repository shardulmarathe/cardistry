import { stackLayout, blocksRowLayout } from '../engine/layouts'
import { splitIntoRandomBlocks, shuffleArray } from '../../lib/shuffleMath'

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
    const steps = [
      {
        kind: 'move',
        id: 'ready',
        label: 'Hold the deck by its ends',
        duration: 1300,
        to: (dk) => stackLayout(dk),
        annotations: [
          {
            text: 'Hindu draws packets off the top and lets them cascade down',
            at: [0, 0.7, 0.85],
            appearAt: 0.12,
          },
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
        duration: 1500,
        ease: 'easeOutCubic',
        to: () => blocksRowLayout(blocks, { spacing: 1.05 }),
        stagger: { by: 'packet' }, // draw each packet off in turn
      })
      const newOrder = shuffleArray(blocks, rng).flat()
      steps.push({
        kind: 'move',
        id: `fall-${r}`,
        label: 'Let each packet fall onto the pile',
        duration: 1500,
        ease: 'easeInOutCubic',
        reorder: () => newOrder,
        to: (dk) => stackLayout(dk),
      })
      d = newOrder
    }
    return steps
  },
}
