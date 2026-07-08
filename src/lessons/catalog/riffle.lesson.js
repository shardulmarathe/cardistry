import { stackLayout, tableRiffleLayout, springArchLayout } from '../engine/layouts'
import { tableGrip, cageGrip, thumbRatchetKeyframes } from '../authoring/contacts'

// Riffle shuffle — authored as the REAL table riffle: the cards never leave
// the felt. The right hand cuts the top half and sets it beside the other,
// both palms settle on top of their halves, the THUMBS bend the inner-near
// corners up to load the spring, then ratchet open card-by-card so the corners
// weave together low over the table. Square, bridge, cascade to finish.
//
// Hand-driven throughout: packets ride fingertip contact frames while carried,
// every weave card releases from the thumb at its own moment, and the grip
// poses are SOLVED at build time against the real half positions
// (poseWithContacts) so fingertips actually rest on the cards.
export const riffleLesson = {
  id: 'riffle',
  title: 'Riffle Shuffle',
  technique: 'riffle',
  difficulty: 'intermediate',
  randomizes: 'Excellent',
  seed: 7,
  cameraPreset: 'dealerPOV',
  summary:
    'The gold-standard shuffle, done flat on the table: cut, thumbs bend the corners up, and the cards interlace low as the thumbs release — then bridge and cascade square.',
  facts: [
    'About 7 riffle shuffles are enough to randomize a 52-card deck (the Bayer–Diaconis result).',
    'The bend stores elastic spring energy — release it evenly and the cards cascade; crease it and you ruin the card.',
  ],
  build: () => {
    const G = 0.5 // half-deck center x
    const YAW = 0.22 // halves angled so the inner-near corners face each other
    const TILT = 0.35 // thumbs lift the near edge this far while loading

    // Dealer table grips (solved at build time against the half geometry) and
    // the bridge cage for the finish — shared builders in authoring/contacts.
    const { pose: restGrip, anchor: REST_ANCHOR } = tableGrip({ gap: G })
    const { pose: loadGrip, anchor: LOAD_ANCHOR } = tableGrip({ gap: G, tilt: TILT })
    const { pose: cage, anchor: CAGE_ANCHOR } = cageGrip()

    const halves = (dk, opts) => tableRiffleLayout(dk, { gap: G, yaw: YAW, ...opts })
    const mid = (dk) => Math.floor(dk.length / 2)
    const rightHalf = (dk, opts) => halves(dk, opts).filter((_, i) => i >= mid(dk))
    const leftHalf = (dk, opts) => halves(dk, opts).filter((_, i) => i < mid(dk))
    const NOTE_POS = [-1.35, 0.75, 0.2] // beside the action, never covering it

    return [
      {
        kind: 'hold',
        id: 'approach',
        label: 'Reach in — fingers open, deck untouched',
        duration: 1400,
        hands: {
          right: [
            { at: 0.25, pose: 'relaxed' },
            { at: 1, pose: 'packetGrab', anchor: [0.1, 0.55, 0.0], ease: 'anticipate' },
          ],
          left: [{ at: 0.5, pose: 'twoHandsSupport', anchor: [0.5, 0.4, 0.1], ease: 'anticipate' }],
        },
        annotations: [{ text: 'Hands first, then cards — everything starts from the grip', at: NOTE_POS, appearAt: 0.35 }],
      },
      {
        kind: 'move',
        id: 'cut',
        label: 'Cut the top half and set it down beside',
        duration: 1600,
        ease: 'easeInOutCubic',
        to: (dk) => rightHalf(dk, {}),
        grip: {
          right: { cards: 'secondHalf', frame: 'packet', pressure: [{ at: 0, v: 0.35 }, { at: 1, v: 0.5 }] },
        },
        hands: {
          right: [
            { at: 0.4, pose: 'packetGrab', anchor: [0.32, 0.42, 0.02] },
            { at: 1, pose: restGrip, anchor: REST_ANCHOR, ease: 'easeOutBackSoft' },
          ],
          left: [{ at: 0.8, pose: 'packetGrab', anchor: [0.08, 0.42, 0.0] }],
        },
        annotations: [{ text: 'Cut roughly in half — the top 26 ride the right hand, flat', at: NOTE_POS, appearAt: 0.3, until: 0.95 }],
      },
      {
        kind: 'move',
        id: 'slide',
        label: 'Slide the bottom half into place',
        duration: 1200,
        ease: 'easeInOutCubic',
        to: (dk) => leftHalf(dk, {}),
        grip: {
          left: { cards: 'firstHalf', frame: 'packet', pressure: [{ at: 0, v: 0.35 }, { at: 1, v: 0.5 }] },
          right: { cards: 'secondHalf', frame: 'packet', pressure: [{ at: 0, v: 0.5 }, { at: 1, v: 0.5 }] },
        },
        hands: {
          left: [{ at: 1, pose: restGrip, anchor: REST_ANCHOR, ease: 'easeOutBackSoft' }],
        },
        annotations: [{ text: 'Inner corners angled toward each other', at: NOTE_POS, appearAt: 0.35, until: 0.95 }],
      },
      {
        kind: 'move',
        id: 'bend',
        label: 'Thumbs bend the corners up — load the spring',
        duration: 2200,
        ease: 'easeOutCubic',
        to: (dk) => halves(dk, { tilt: TILT }),
        bend: 1.6,
        grip: {
          left: { cards: 'firstHalf', frame: 'packet', bendGain: 0.5, pressure: [{ at: 0, v: 0.5 }, { at: 1, v: 1 }] },
          right: { cards: 'secondHalf', frame: 'packet', bendGain: 0.5, pressure: [{ at: 0, v: 0.5 }, { at: 1, v: 1 }] },
        },
        hands: {
          left: [
            { at: 0.4, pose: restGrip, anchor: REST_ANCHOR },
            {
              at: 1,
              pose: loadGrip,
              anchor: LOAD_ANCHOR,
              motion: { type: 'jitter', amp: 0.004, cycles: 3 },
              fingerMotion: [{ fingers: ['thumb', 'index', 'middle'], type: 'tremor', amp: 0.035, cycles: 3 }],
            },
          ],
          right: [
            { at: 0.4, pose: restGrip, anchor: REST_ANCHOR },
            {
              at: 1,
              pose: loadGrip,
              anchor: LOAD_ANCHOR,
              motion: { type: 'jitter', amp: 0.004, cycles: 3 },
              fingerMotion: [{ fingers: ['thumb', 'index', 'middle'], type: 'tremor', amp: 0.035, cycles: 3 }],
            },
          ],
        },
        annotations: [{ text: 'Bend firmly — never crease. That spring drives the weave.', at: NOTE_POS, appearAt: 0.25, until: 0.95 }],
      },
      {
        kind: 'riffle',
        id: 'weave',
        label: 'Ratchet the thumbs — the corners interlace on the felt',
        duration: 5500,
        ease: 'easeInOutCubic',
        midBend: 0.7,
        arcLift: 0.05, // the cards stay LOW — they flick down onto the table
        grip: {
          left: { cards: 'firstHalf', frame: 'thumbPeel', release: 'stagger', pressure: [{ at: 0, v: 0.7 }, { at: 1, v: 0.15 }] },
          right: { cards: 'secondHalf', frame: 'thumbPeel', release: 'stagger', pressure: [{ at: 0, v: 0.7 }, { at: 1, v: 0.15 }] },
        },
        hands: {
          left: [
            ...thumbRatchetKeyframes({
              gripPose: loadGrip,
              openThumb: [0.5, 0.1, 0.02],
              anchorFrom: LOAD_ANCHOR,
              anchorTo: [0.26, 0.34, 0.05],
              steps: 6,
              jitter: 0.03,
              fingerMotion: [{ fingers: ['thumb'], type: 'tremor', amp: 0.018, cycles: 2 }],
            }),
            { at: 1, pose: 'twoHandsSupport', anchor: [0.24, 0.3, 0.06] },
          ],
          right: [
            ...thumbRatchetKeyframes({
              gripPose: loadGrip,
              openThumb: [0.5, 0.1, 0.02],
              anchorFrom: LOAD_ANCHOR,
              anchorTo: [0.26, 0.34, 0.05],
              steps: 6,
              jitter: 0.03,
              fingerMotion: [{ fingers: ['thumb'], type: 'tremor', amp: 0.018, cycles: 2 }],
            }),
            { at: 1, pose: 'twoHandsSupport', anchor: [0.24, 0.3, 0.06] },
          ],
        },
        annotations: [
          { text: 'Release slowly — the corners weave one card at a time', at: NOTE_POS, appearAt: 0.12, until: 0.5 },
          { text: 'About 7 riffles fully randomize a 52-card deck', at: NOTE_POS, appearAt: 0.58, until: 0.97 },
        ],
      },
      {
        kind: 'move',
        id: 'square',
        label: 'Push the halves home and square up',
        duration: 1400,
        ease: 'settle',
        to: (dk) => stackLayout(dk),
        bend: 0,
        hands: {
          left: [{ at: 1, pose: 'twoHandsSupport', anchor: [0.2, 0.36, 0.05], ease: 'settle' }],
          right: [{ at: 1, pose: 'twoHandsSupport', anchor: [0.2, 0.36, 0.05], ease: 'settle' }],
        },
      },
      {
        kind: 'hold',
        id: 'cage',
        label: 'Cup the ends of the squared deck',
        duration: 1100,
        hands: {
          left: [{ at: 1, pose: cage, anchor: CAGE_ANCHOR, ease: 'easeOutBackSoft' }],
          right: [{ at: 1, pose: cage, anchor: CAGE_ANCHOR, ease: 'easeOutBackSoft' }],
        },
      },
      {
        kind: 'move',
        id: 'bridge',
        label: 'Squeeze — bow the deck between the hands',
        duration: 1700,
        ease: 'easeInOutCubic',
        to: (dk) => springArchLayout(dk, 2.4),
        bend: 2.4,
        // Hands are ALREADY caging (same orientation throughout the hold), so
        // the deck bows in place between the fingers instead of tipping over.
        grip: {
          right: { cards: 'all', frame: 'packet', bendGain: 0.4, pressure: [{ at: 0, v: 0.3 }, { at: 1, v: 0.9 }] },
        },
        hands: {
          left: [{ at: 1, pose: cage, anchor: CAGE_ANCHOR, fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tighten', amp: 0.04 }] }],
          right: [{ at: 1, pose: cage, anchor: CAGE_ANCHOR, fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tighten', amp: 0.04 }] }],
        },
        annotations: [{ text: 'The bridge: thumbs on top, fingers cupping the ends', at: NOTE_POS, appearAt: 0.3, until: 0.95 }],
      },
      {
        kind: 'move',
        id: 'cascade',
        label: 'Let the bridge pour — card by card',
        duration: 2200,
        ease: 'easeInOutCubic',
        to: (dk) => stackLayout(dk),
        bend: 0,
        stagger: { by: 'card', spread: 0.7, span: 0.3 },
        midBend: 0.9,
        arcLift: 0.05,
        grip: {
          right: { cards: 'all', frame: 'packet', release: 'stagger', pressure: [{ at: 0, v: 0.9 }, { at: 1, v: 0.1 }] },
        },
        hands: {
          left: [
            { at: 0, pose: cage, anchor: CAGE_ANCHOR },
            {
              at: 0.6,
              fingers: { thumb: [0.15, 0.12, 0.08] },
              anchor: [CAGE_ANCHOR[0] - 0.02, CAGE_ANCHOR[1] - 0.05, CAGE_ANCHOR[2]],
              fingerMotion: [{ fingers: ['index', 'middle', 'ring', 'pinky'], type: 'curlRipple', amp: 0.05, cycles: 3 }],
            },
            { at: 1, fingers: { index: [0.5, 0.4, 0.28], middle: [0.52, 0.42, 0.3] }, anchor: [0.6, 0.34, 0.0], ease: 'settle' },
          ],
          right: [
            { at: 0, pose: cage, anchor: CAGE_ANCHOR },
            {
              at: 0.6,
              fingers: { thumb: [0.15, 0.12, 0.08] },
              anchor: [CAGE_ANCHOR[0] - 0.02, CAGE_ANCHOR[1] - 0.05, CAGE_ANCHOR[2]],
              fingerMotion: [{ fingers: ['index', 'middle', 'ring', 'pinky'], type: 'curlRipple', amp: 0.05, cycles: 3 }],
            },
            { at: 1, fingers: { index: [0.5, 0.4, 0.28], middle: [0.52, 0.42, 0.3] }, anchor: [0.6, 0.34, 0.0], ease: 'settle' },
          ],
        },
        annotations: [{ text: 'The stored spring flowing out under the fingers is the payoff', at: NOTE_POS, appearAt: 0.15, until: 0.9 }],
      },
      {
        kind: 'hold',
        id: 'rest',
        label: 'Squared and shuffled',
        duration: 1300,
        hands: {
          left: [{ at: 1, pose: 'relaxed', ease: 'easeInOutCubic' }],
          right: [{ at: 1, pose: 'relaxed', ease: 'easeInOutCubic' }],
        },
      },
    ]
  },
}
