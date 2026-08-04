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
        duration: 2400,
        ease: 'easeOutCubic',
        to: (dk) => pilesLayout(dk, pileCount),
        stagger: { by: 'card', spread: 0.7, span: 0.25 },
        camera: 'topDown',
        hands: {
          // The dealing hand cycles over the four piles in time with the deal;
          // the other hand steadies the dwindling stack.
          right: [
            { at: 0.15, pose: 'pinchCut', anchor: [0.15, 0.45, 0.1], ease: 'anticipate' },
            {
              at: 0.9,
              pose: 'pinchCut',
              anchor: [0.2, 0.42, 0.05],
              motion: { type: 'orbit', amp: 0.42, cycles: 4 },
              fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tremor', amp: 0.04, cycles: 8 }],
            },
            { at: 1, pose: 'overhandPull', anchor: [0.3, 0.42, 0.1] },
          ],
          left: [{ at: 0.4, pose: 'twoHandsSupport', anchor: [0.1, 0.36, 0.2] }],
        },
        annotations: [
          {
            text: 'Dealing into piles does not randomize — the pattern is predictable',
            at: [-1.3, 0.7, 0.2],
            appearAt: 0.15,
          },
        ],
      },
      {
        kind: 'move',
        id: 'restack',
        label: 'Gather piles back into one stack',
        duration: 1600,
        ease: 'settle',
        reorder: () => restackOrder,
        to: (dk) => stackLayout(dk),
        stagger: { by: 'packet', spread: 0.55, span: 0.45 },
        camera: 'overview',
        hands: {
          right: [
            { at: 0.7, pose: 'packetGrab', anchor: [0.3, 0.42, 0.05], motion: { type: 'rock', axis: 'x', amp: 0.18, cycles: 2 } },
            { at: 1, pose: 'relaxed', ease: 'settle' },
          ],
          left: [
            { at: 0.7, pose: 'twoHandsSupport', anchor: [0.2, 0.36, 0.1] },
            { at: 1, pose: 'relaxed', ease: 'settle' },
          ],
        },
      },
    ]
  },
}
