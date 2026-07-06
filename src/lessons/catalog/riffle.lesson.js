import { stackLayout, riffleGripLayout, springArchLayout } from '../engine/layouts'

// Riffle shuffle + bridge — the showcase lesson (real card bending).
//
// Paced for teaching: ~25s at 1× (drop to 0.25× to study a phase frame by
// frame). The hands never freeze — they reach in, carry the two halves FAR
// apart, bring them back, bow them, ratchet the thumbs open in time with the
// interlace, then cage the squared deck for the waterfall.
export const riffleLesson = {
  id: 'riffle',
  title: 'Riffle Shuffle',
  technique: 'riffle',
  difficulty: 'intermediate',
  randomizes: 'Excellent',
  seed: 7,
  cameraPreset: 'dealerPOV',
  summary:
    'The gold-standard shuffle. Split the deck, carry the halves apart, bow each one, and let the cards interlace — then bridge and cascade them square.',
  facts: [
    'About 7 riffle shuffles are enough to randomize a 52-card deck (the Bayer–Diaconis result).',
    'The bend stores elastic spring energy — release it evenly and the cards cascade; crease it and you ruin the card.',
  ],
  // SPLIT_X: how far the two halves are carried apart on the initial cut (wide,
  // so the split reads clearly). GRIP_X: where they come back to, on edge, to be
  // bowed into the bridge. The hands anchor to the same x so each grips its half.
  build: () => {
    const SPLIT_X = 1.6
    const GRIP_X = 0.55
    const GRIP_Y = 0.5
    return [
      {
        kind: 'move',
        id: 'split',
        label: 'Cut the deck and carry the halves apart',
        duration: 3500,
        ease: 'easeInOutCubic',
        to: (dk) => riffleGripLayout(dk, { gap: SPLIT_X, baseY: GRIP_Y }),
        stagger: { by: 'card' }, // deal cards onto the two halves one by one
        arcLift: 0.15,
        hands: {
          left: [
            { at: 0.15, pose: 'twoHandsSupport', anchor: [0.3, 0.48, 0.08] },
            { at: 1, pose: 'twoHandsSupport', anchor: [SPLIT_X, 0.46, 0.05] },
          ],
          right: [
            { at: 0.15, pose: 'twoHandsSupport', anchor: [0.3, 0.48, 0.08] },
            { at: 1, pose: 'twoHandsSupport', anchor: [SPLIT_X, 0.46, 0.05] },
          ],
        },
        annotations: [
          {
            text: 'Cut roughly in half — about 26 cards each, one packet per hand',
            at: [0, 0.95, 0.8],
            appearAt: 0.35,
          },
        ],
      },
      {
        kind: 'move',
        id: 'carry-in',
        label: 'Bring the two halves together, on edge',
        duration: 2500,
        ease: 'easeInOutCubic',
        to: (dk) => riffleGripLayout(dk, { gap: GRIP_X, baseY: GRIP_Y, lean: 0.1 }),
        grip: { left: 'firstHalf', right: 'secondHalf' }, // hands now carry the packets
        hands: {
          left: [{ at: 1, pose: 'riffleArch', anchor: [GRIP_X, 0.46, 0.02] }],
          right: [{ at: 1, pose: 'riffleArch', anchor: [GRIP_X, 0.46, 0.02] }],
        },
        annotations: [
          {
            text: 'Corners almost touching — angle them slightly away from you',
            at: [0, 1.0, 0.8],
            appearAt: 0.4,
          },
        ],
      },
      {
        kind: 'move',
        id: 'arch',
        label: 'Bow each half to load the spring',
        duration: 3000,
        ease: 'easeOutCubic',
        to: (dk) => riffleGripLayout(dk, { gap: GRIP_X, baseY: GRIP_Y, lean: 0.18 }),
        bend: 2.6,
        grip: { left: 'firstHalf', right: 'secondHalf' }, // keep carrying while it loads
        hands: {
          left: [
            { at: 0.5, pose: 'riffleArch', anchor: [GRIP_X, 0.46, 0.02] },
            { at: 1, fingers: { thumb: [0.55, 0.6, 0.42] }, anchor: [GRIP_X, 0.46, 0.02], motion: { type: 'jitter', amp: 0.006, cycles: 3 } },
          ],
          right: [
            { at: 0.5, pose: 'riffleArch', anchor: [GRIP_X, 0.46, 0.02] },
            { at: 1, fingers: { thumb: [0.55, 0.6, 0.42] }, anchor: [GRIP_X, 0.46, 0.02], motion: { type: 'jitter', amp: 0.006, cycles: 3 } },
          ],
        },
        annotations: [
          {
            text: 'Bend firmly — but never crease. That stored spring drives the weave.',
            at: [0, 1.05, 0.8],
            appearAt: 0.2,
          },
        ],
      },
      {
        kind: 'riffle',
        id: 'weave',
        label: 'Release the thumbs — let the cards interlace',
        duration: 7000,
        ease: 'easeInOutCubic',
        // Thumbs ratchet progressively open (curl → straight) in step with the
        // cards falling off the bottoms; the hands inch together as they empty.
        hands: {
          left: [
            { at: 0, pose: 'riffleArch', anchor: [GRIP_X, 0.46, 0.02] },
            { at: 0.25, fingers: { thumb: [0.42, 0.4, 0.3] }, anchor: [0.47, 0.46, 0.01] },
            { at: 0.5, fingers: { thumb: [0.3, 0.26, 0.18] }, anchor: [0.4, 0.47, 0] },
            { at: 0.75, fingers: { thumb: [0.2, 0.16, 0.1] }, anchor: [0.34, 0.46, 0], motion: { type: 'rock', axis: 'y', amp: 0.008, cycles: 5 } },
            { at: 1, pose: 'bridgeRelease', anchor: [0.28, 0.46, 0] },
          ],
          right: [
            { at: 0, pose: 'riffleArch', anchor: [GRIP_X, 0.46, 0.02] },
            { at: 0.25, fingers: { thumb: [0.42, 0.4, 0.3] }, anchor: [0.47, 0.46, 0.01] },
            { at: 0.5, fingers: { thumb: [0.3, 0.26, 0.18] }, anchor: [0.4, 0.47, 0] },
            { at: 0.75, fingers: { thumb: [0.2, 0.16, 0.1] }, anchor: [0.34, 0.46, 0], motion: { type: 'rock', axis: 'y', amp: 0.008, cycles: 5 } },
            { at: 1, pose: 'bridgeRelease', anchor: [0.28, 0.46, 0] },
          ],
        },
        annotations: [
          {
            text: 'Release slowly — the corners weave together one card at a time',
            at: [0, 0.85, 0.8],
            appearAt: 0.15,
          },
          {
            text: 'About 7 riffles fully randomize a 52-card deck',
            at: [0, 0.85, 0.8],
            appearAt: 0.6,
          },
        ],
      },
      {
        kind: 'move',
        id: 'square',
        label: 'Push the halves together and square up',
        duration: 1800,
        ease: 'easeOutCubic',
        to: (dk) => stackLayout(dk),
        bend: 0,
        camera: 'overview',
        hands: {
          left: [
            { at: 0, pose: 'bridgeRelease', anchor: [0.28, 0.46, 0] },
            { at: 1, pose: 'twoHandsSupport', anchor: [0.18, 0.42, 0.06] },
          ],
          right: [
            { at: 0, pose: 'bridgeRelease', anchor: [0.28, 0.46, 0] },
            { at: 1, pose: 'twoHandsSupport', anchor: [0.18, 0.42, 0.06] },
          ],
        },
      },
      {
        kind: 'move',
        id: 'bridge',
        label: 'Bow the whole deck into a bridge',
        duration: 3000,
        ease: 'easeInOutCubic',
        to: (dk) => springArchLayout(dk, 2.8),
        bend: 2.8,
        hands: {
          left: [{ at: 1, pose: 'bridgeCage', anchor: [0.26, 0.5, 0.02] }],
          right: [{ at: 1, pose: 'bridgeCage', anchor: [0.26, 0.5, 0.02] }],
        },
        annotations: [
          {
            text: 'The bridge: cage the arched deck, thumbs on top, fingers underneath',
            at: [0, 1.0, 0.8],
            appearAt: 0.3,
          },
        ],
      },
      {
        kind: 'move',
        id: 'cascade',
        label: 'Release the bridge — the cards cascade flat',
        duration: 2800,
        ease: 'easeInOutCubic',
        to: (dk) => stackLayout(dk),
        bend: 0,
        stagger: { by: 'card', spread: 0.7, span: 0.3 }, // waterfall, card by card
        midBend: 1.2,
        arcLift: 0.08,
        hands: {
          left: [
            { at: 0, pose: 'bridgeCage', anchor: [0.26, 0.5, 0.02] },
            { at: 0.5, fingers: { thumb: [0.15, 0.12, 0.08] }, anchor: [0.26, 0.49, 0.02] },
            { at: 1, pose: 'twoHandsSupport', anchor: [0.24, 0.4, 0.05] },
          ],
          right: [
            { at: 0, pose: 'bridgeCage', anchor: [0.26, 0.5, 0.02] },
            { at: 0.5, fingers: { thumb: [0.15, 0.12, 0.08] }, anchor: [0.26, 0.49, 0.02] },
            { at: 1, pose: 'twoHandsSupport', anchor: [0.24, 0.4, 0.05] },
          ],
        },
        annotations: [
          {
            text: 'That stored spring flowing out under the bridge is the satisfying part',
            at: [0, 0.9, 0.8],
            appearAt: 0.1,
          },
        ],
      },
      {
        kind: 'hold',
        id: 'rest',
        label: 'Squared and shuffled',
        duration: 1400,
        hands: {
          left: [{ at: 1, pose: 'relaxed' }],
          right: [{ at: 1, pose: 'relaxed' }],
        },
      },
    ]
  },
}
