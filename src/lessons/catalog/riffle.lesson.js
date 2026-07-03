import { stackLayout, riffleGripLayout } from '../engine/layouts'

// Riffle shuffle + bridge — the showcase lesson (real card bending).
export const riffleLesson = {
  id: 'riffle',
  title: 'Riffle Shuffle',
  technique: 'riffle',
  difficulty: 'intermediate',
  randomizes: 'Excellent',
  seed: 7,
  cameraPreset: 'dealerPOV',
  summary:
    'The gold-standard shuffle. Split the deck, bow each half, and let the cards interlace — then bridge and cascade them square.',
  facts: [
    'About 7 riffle shuffles are enough to randomize a 52-card deck (the Bayer–Diaconis result).',
    'The bend stores elastic spring energy — release it evenly and the cards cascade; crease it and you ruin the card.',
  ],
  // The two halves sit at x = ±HALF_X; the hands anchor to the same x so each
  // hand visibly grips the half it's bowing (fingers over the outer edge, thumb
  // reaching the inner/center edge where the cards riffle off).
  // The halves stand ON EDGE (faces to the sides) at x = ±HALF_X, held and bowed
  // by the hands into a bridge. The hands grip the packets on the `arch` step so
  // the cards are carried rigidly by the wrists while the bend loads.
  build: () => {
    const HALF_X = 0.5
    const GRIP_Y = 0.5
    const grip = { gap: HALF_X, baseY: GRIP_Y }
    return [
      {
        kind: 'move',
        id: 'split',
        label: 'Split the deck and stand each half on edge',
        duration: 1300,
        ease: 'easeInOutCubic',
        to: (dk) => riffleGripLayout(dk, grip),
        stagger: { by: 'card' }, // deal cards onto the two halves one by one
        arcLift: 0.12,
        hands: {
          left: { from: 'relaxed', to: 'twoHandsSupport', anchor: [HALF_X, 0.46, 0.06] },
          right: { from: 'relaxed', to: 'twoHandsSupport', anchor: [HALF_X, 0.46, 0.06] },
        },
        annotations: [
          {
            text: 'Cut roughly in half — about 26 cards each, held face-in',
            at: [0, 0.95, 0.8],
            appearAt: 0.15,
          },
        ],
      },
      {
        kind: 'move',
        id: 'arch',
        label: 'Bow each half to load the spring',
        duration: 900,
        ease: 'easeOutCubic',
        to: (dk) => riffleGripLayout(dk, { ...grip, lean: 0.18 }),
        bend: 2.6,
        grip: { left: 'firstHalf', right: 'secondHalf' }, // hands now carry the packets
        hands: {
          left: { to: 'riffleArch', anchor: [HALF_X, 0.46, 0.02] },
          right: { to: 'riffleArch', anchor: [HALF_X, 0.46, 0.02] },
        },
        annotations: [
          {
            text: 'Bend firmly — but never crease. That stored spring drives the weave.',
            at: [0, 1.0, 0.8],
          },
        ],
      },
      {
        kind: 'riffle',
        id: 'weave',
        label: 'Release the thumbs — let the cards interlace',
        duration: 2600,
        ease: 'easeInOutCubic',
        hands: {
          left: { to: 'bridgeRelease', anchor: [HALF_X * 0.9, 0.48, 0.0] },
          right: { to: 'bridgeRelease', anchor: [HALF_X * 0.9, 0.48, 0.0] },
        },
        annotations: [
          {
            text: 'About 7 riffles fully randomize a 52-card deck',
            at: [0, 0.8, 0.8],
            appearAt: 0.25,
          },
        ],
      },
      {
        kind: 'move',
        id: 'square',
        label: 'Square the deck',
        duration: 900,
        ease: 'easeOutCubic',
        to: (dk) => stackLayout(dk),
        bend: 0,
        camera: 'overview',
        hands: {
          left: { to: 'twoHandsSupport', anchor: [0.16, 0.4, 0.06] },
          right: { to: 'twoHandsSupport', anchor: [0.16, 0.4, 0.06] },
        },
      },
    ]
  },
}
