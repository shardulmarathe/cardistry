import { stackLayout, pilesLayout } from '../engine/layouts'

export const pileShuffleLesson = {
  id: 'pile-shuffle',
  title: 'Pile Shuffle',
  technique: 'pile',
  difficulty: 'beginner',
  randomizes: 'None by itself',
  seed: 88,
  cameraPreset: 'topDown',
  summary:
    'Deal the deck round-robin into piles, then restack. Looks thorough — but dealing into piles alone does NOT randomize.',
  facts: [
    'Pile shuffling deals cards into stacks round-robin — the order is deterministic, not random.',
    'Casinos combine pile dealing with other shuffles; the piles alone preserve structure.',
  ],
  build: (deck) => {
    const pileCount = 4
    const piles = Array.from({ length: pileCount }, () => [])
    deck.forEach((card, i) => piles[i % pileCount].push(card))
    const restackOrder = piles.flat()
    return [
      {
        kind: 'move',
        id: 'deal',
        label: 'Deal round-robin into four piles',
        duration: 1800,
        ease: 'easeOutCubic',
        to: (dk) => pilesLayout(dk, pileCount),
        camera: 'topDown',
        hands: {
          left: { from: 'relaxed', to: 'twoHandsSupport' },
          right: { from: 'relaxed', to: 'overhandPull' },
        },
        annotations: [
          {
            text: 'Dealing into piles does not randomize — the pattern is predictable',
            at: [0, 0.9, 0],
            appearAt: 0.15,
          },
        ],
      },
      {
        kind: 'move',
        id: 'restack',
        label: 'Gather piles back into one stack',
        duration: 1400,
        ease: 'easeInOutCubic',
        reorder: () => restackOrder,
        to: (dk) => stackLayout(dk),
        camera: 'overview',
      },
    ]
  },
}
