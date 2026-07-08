import { stackLayout, tableRiffleLayout } from '../engine/layouts'
import { tableGrip, thumbRatchetKeyframes } from '../authoring/contacts'

// Faro shuffle — the precision cousin of the table riffle: an exact 26/26 cut,
// both halves seated flat on the felt, and a controlled one-card-at-a-time
// weave off the thumbs with barely any bow. Same finger-driven machinery as
// the riffle (contact frames, per-card releases), tuned tight and low.
export const faroLesson = {
  id: 'faro',
  title: 'Faro Shuffle',
  technique: 'faro',
  difficulty: 'advanced',
  randomizes: 'None — controlled',
  seed: 8,
  cameraPreset: 'dealerPOV',
  summary:
    'A perfect weave: split exactly in half and interlace the halves one card at a time, flat on the table. It does not randomize — it is a precise, repeatable control move.',
  facts: [
    'A perfect faro is deterministic — eight out-faros return a 52-card deck to its exact original order.',
    'Because it controls positions precisely, the faro is a tool of magicians, not a way to randomize.',
  ],
  build: () => {
    const G = 0.5
    const YAW = 0.16 // tighter angle than the riffle — precision, not flourish
    const TILT = 0.18 // barely any lift; a faro is a push-through, not a spring

    const { pose: restGrip, anchor: REST_ANCHOR } = tableGrip({ gap: G })
    const { pose: seatGrip, anchor: SEAT_ANCHOR } = tableGrip({ gap: G, tilt: TILT })

    const halves = (dk, opts) => tableRiffleLayout(dk, { gap: G, yaw: YAW, ...opts })
    const mid = (dk) => Math.floor(dk.length / 2)
    const NOTE_POS = [-1.35, 0.75, 0.2]

    return [
      {
        kind: 'hold',
        id: 'approach',
        label: 'Hands in — this cut must be exact',
        duration: 1000,
        hands: {
          right: [
            { at: 0.25, pose: 'relaxed' },
            { at: 1, pose: 'packetGrab', anchor: [0.1, 0.55, 0.0], ease: 'anticipate' },
          ],
          left: [{ at: 0.5, pose: 'twoHandsSupport', anchor: [0.5, 0.4, 0.1], ease: 'anticipate' }],
        },
        annotations: [{ text: 'A faro needs a perfect 26 / 26 cut', at: NOTE_POS, appearAt: 0.3 }],
      },
      {
        kind: 'move',
        id: 'cut',
        label: 'Cut exactly 26 — set it down flat',
        duration: 1400,
        ease: 'easeInOutCubic',
        to: (dk) => halves(dk, {}).filter((_, i) => i >= mid(dk)),
        grip: {
          right: { cards: 'secondHalf', frame: 'packet', pressure: [{ at: 0, v: 0.4 }, { at: 1, v: 0.5 }] },
        },
        hands: {
          right: [
            { at: 0.4, pose: 'packetGrab', anchor: [0.32, 0.4, 0.02] },
            { at: 1, pose: restGrip, anchor: REST_ANCHOR, ease: 'easeOutBackSoft' },
          ],
          left: [{ at: 0.8, pose: 'packetGrab', anchor: [0.08, 0.42, 0.0] }],
        },
      },
      {
        kind: 'move',
        id: 'slide',
        label: 'Seat the other half against it',
        duration: 1000,
        ease: 'easeInOutCubic',
        to: (dk) => halves(dk, {}).filter((_, i) => i < mid(dk)),
        grip: {
          left: { cards: 'firstHalf', frame: 'packet', pressure: [{ at: 0, v: 0.4 }, { at: 1, v: 0.5 }] },
          right: { cards: 'secondHalf', frame: 'packet', pressure: [{ at: 0, v: 0.5 }, { at: 1, v: 0.5 }] },
        },
        hands: {
          left: [{ at: 1, pose: restGrip, anchor: REST_ANCHOR, ease: 'easeOutBackSoft' }],
        },
      },
      {
        kind: 'move',
        id: 'seat',
        label: 'Square the corners — light pressure only',
        duration: 1400,
        ease: 'easeOutCubic',
        to: (dk) => halves(dk, { tilt: TILT }),
        bend: 0.8,
        grip: {
          left: { cards: 'firstHalf', frame: 'packet', bendGain: 0.3, pressure: [{ at: 0, v: 0.5 }, { at: 1, v: 0.8 }] },
          right: { cards: 'secondHalf', frame: 'packet', bendGain: 0.3, pressure: [{ at: 0, v: 0.5 }, { at: 1, v: 0.8 }] },
        },
        hands: {
          left: [{ at: 1, pose: seatGrip, anchor: SEAT_ANCHOR }],
          right: [{ at: 1, pose: seatGrip, anchor: SEAT_ANCHOR }],
        },
        annotations: [{ text: 'Barely any bow — a faro is a push-through, not a spring', at: NOTE_POS, appearAt: 0.3, until: 0.95 }],
      },
      {
        kind: 'riffle',
        id: 'weave',
        label: 'Interlace one card at a time',
        duration: 5200,
        ease: 'easeInOutCubic',
        midBend: 0.4,
        arcLift: 0.03, // dead low — the cards slide together on the felt
        grip: {
          left: { cards: 'firstHalf', frame: 'thumbPeel', release: 'stagger', pressure: [{ at: 0, v: 0.6 }, { at: 1, v: 0.1 }] },
          right: { cards: 'secondHalf', frame: 'thumbPeel', release: 'stagger', pressure: [{ at: 0, v: 0.6 }, { at: 1, v: 0.1 }] },
        },
        hands: {
          left: [
            ...thumbRatchetKeyframes({
              gripPose: seatGrip,
              openThumb: [0.5, 0.1, 0.02],
              anchorFrom: SEAT_ANCHOR,
              anchorTo: [0.26, 0.34, 0.05],
              steps: 7,
              jitter: 0.015, // precise — almost no ratchet noise
            }),
            { at: 1, pose: 'twoHandsSupport', anchor: [0.24, 0.3, 0.06] },
          ],
          right: [
            ...thumbRatchetKeyframes({
              gripPose: seatGrip,
              openThumb: [0.5, 0.1, 0.02],
              anchorFrom: SEAT_ANCHOR,
              anchorTo: [0.26, 0.34, 0.05],
              steps: 7,
              jitter: 0.015,
            }),
            { at: 1, pose: 'twoHandsSupport', anchor: [0.24, 0.3, 0.06] },
          ],
        },
        annotations: [
          { text: 'Eight perfect out-faros restore the deck to its original order', at: NOTE_POS, appearAt: 0.3, until: 0.9 },
        ],
      },
      {
        kind: 'move',
        id: 'square',
        label: 'Square the deck',
        duration: 1400,
        ease: 'settle',
        to: (dk) => stackLayout(dk),
        bend: 0,
        camera: 'overview',
        hands: {
          left: [{ at: 1, pose: 'twoHandsSupport', anchor: [0.2, 0.36, 0.05], ease: 'settle' }],
          right: [{ at: 1, pose: 'twoHandsSupport', anchor: [0.2, 0.36, 0.05], ease: 'settle' }],
        },
      },
    ]
  },
}
