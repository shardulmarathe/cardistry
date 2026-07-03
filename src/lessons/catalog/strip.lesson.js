import { stackLayout, blocksRowLayout } from '../engine/layouts'
import { splitIntoRandomBlocks, shuffleArray } from '../../lib/shuffleMath'

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
    const steps = [
      {
        kind: 'move',
        id: 'ready',
        label: 'Hold the deck — strip grip',
        duration: 700,
        to: (dk) => stackLayout(dk),
        hands: {
          left: { from: 'relaxed', to: 'twoHandsSupport' },
          right: { from: 'relaxed', to: 'overhandPull' },
        },
      },
    ]
    let d = deck
    for (let r = 0; r < 2; r++) {
      const blocks = splitIntoRandomBlocks(d, 2, rng)
      steps.push({
        kind: 'move',
        id: `strip-${r}`,
        label: 'Strip a large packet off the top',
        duration: 900,
        ease: 'easeOutCubic',
        to: () => blocksRowLayout(blocks, { spacing: 0.9 }),
        stagger: { by: 'packet' }, // strip each packet off in turn
        hands: { right: { to: 'overhandPull' } },
      })
      const newOrder = shuffleArray(blocks, rng).flat()
      steps.push({
        kind: 'move',
        id: `drop-${r}`,
        label: 'Drop the packet onto the pile',
        duration: 850,
        ease: 'easeInOutCubic',
        reorder: () => newOrder,
        to: (dk) => stackLayout(dk),
      })
      d = newOrder
    }
    return steps
  },
}
