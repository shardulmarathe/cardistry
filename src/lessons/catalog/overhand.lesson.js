import { stackLayout, blocksRowLayout } from '../engine/layouts'
import { splitIntoRandomBlocks, shuffleArray } from '../../lib/shuffleMath'

export const overhandLesson = {
  id: 'overhand',
  title: 'Overhand Shuffle',
  technique: 'overhand',
  difficulty: 'beginner',
  randomizes: 'Weak',
  seed: 21,
  cameraPreset: 'dealerPOV',
  summary:
    'The everyday shuffle: peel small packets off the top and stack them back. Easy — but it only moves blocks, so it barely randomizes.',
  facts: [
    'The overhand only transports blocks of cards, so cards that start together tend to stay together.',
    'Rigorously, it can take on the order of 2,500 overhand shuffles to truly randomize 52 cards — versus about 7 riffles.',
  ],
  build: (deck, ctx) => {
    const rng = ctx.rng
    const steps = [
      {
        kind: 'move',
        id: 'ready',
        label: 'Hold the deck in overhand grip',
        duration: 800,
        to: (dk) => stackLayout(dk),
        hands: {
          left: { from: 'relaxed', to: 'twoHandsSupport' },
          right: { from: 'relaxed', to: 'overhandPull' },
        },
        annotations: [
          {
            text: 'Overhand is gentle but weak — it can take thousands of shuffles to truly randomize',
            at: [0, 0.7, 0.85],
            appearAt: 0.1,
          },
        ],
      },
    ]
    let d = deck
    for (let r = 0; r < 3; r++) {
      const blocks = splitIntoRandomBlocks(d, 4, rng)
      steps.push({
        kind: 'move',
        id: `break-${r}`,
        label: 'Peel small packets off the top',
        duration: 850,
        ease: 'easeOutCubic',
        to: () => blocksRowLayout(blocks),
        hands: {
          left: { to: 'twoHandsSupport' },
          right: { to: 'pinchCut' }, // thumb + fingers pinch to peel a packet
        },
      })
      const newOrder = shuffleArray(blocks, rng).flat()
      steps.push({
        kind: 'move',
        id: `collect-${r}`,
        label: 'Drop each packet onto the pile',
        duration: 850,
        ease: 'easeInOutCubic',
        reorder: () => newOrder,
        to: (dk) => stackLayout(dk),
        hands: {
          left: { to: 'twoHandsSupport' },
          right: { to: 'overhandPull' }, // release the packet back onto the pile
        },
      })
      d = newOrder
    }
    return steps
  },
}
