import { tableRiffleLayout, landscapeStackLayout } from '../engine/layouts'
import { tableGrip, packetGrip, rigMetrics, thumbRatchetKeyframes } from '../authoring/contacts'
import { CARD_GAP, CARD_H } from '../../lib/constants'
import { DECK_REST_DROP, DECK_APPROACH_DROP } from '../../hands/handPoses'

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
  build: (deck) => {
    const G = 0.5
    // Card-derived hand heights. A `packetGrab` cage hangs its deepest finger
    // surface 0.420 below the wrist and a card is 0.006 thick, so a hand over a
    // squared stack must clear its top card by that much or whole phalanges sit
    // INSIDE the deck (the approach/cut/slide/square beats were 0.056-0.059
    // deep, every frame).
    const TABLE_TOP = 0.02 + (deck.length - 1) * CARD_GAP
    const HALF = Math.floor(deck.length / 2)
    const YAW = 0.07 // near-square landscape halves — precision, not flourish
    const TILT = 0.14 // barely any lift; a faro is a push-through, not a spring
    const BOW = 0.8 // the seat beat's bend
    // Fingertip reach of the two open presets, measured off the rig: an anchor
    // is a PAD position PLUS that reach. At HAND_SCALE 13 a `deckRest` hand
    // reaches 1.62 inward, so the old hand-picked 0.9 anchors put the whole
    // hand a card and a half inside the pile it was supposed to be resting on.
    const REST_REACH = -rigMetrics('deckRest').tip.middle.x
    const APPROACH_REACH = -rigMetrics('deckApproach').tip.middle.x
    const REST_PAD_X = 0.18 // where a resting hand's pads sit on the squared deck
    // How hard these grips are ever squeezed, so the pads can be authored that
    // far OFF their surfaces and the runtime `pressure` presses them home.
    const PRESS = 1.3
    const CARRY_SQUEEZE = 1.25

    // BOWED CARDS REST ON THEIR ENDS, NOT THEIR CENTRES. The bend shader swings
    // a card's ends toward local +Z, which on a face-down card is straight
    // DOWN, so `clampAboveFelt` lifts a bowed half until those ends touch the
    // felt — for this lesson's 0.8 bow that is ~0.08 higher than the flat
    // layout says. The halves are also WELDED to their hands from the cut
    // onward (a gripped packet rides the contact frame), but the clamp still
    // pins them, so the hands do NOT carry them up: they sink into them. LIFT
    // is that bow, added to both table anchors, which puts the pads back on
    // the cards. It is a contact correction, not clearance — without it the
    // seat/weave beats measure 0.047 deep.
    // ...which is DERIVED, not guessed: a card bent by `bend` rises
    // (1 - cos(bend*CARD_H/2))/bend at its centre. It belongs to the BOWED
    // beats only — the flat cut/slide have nothing to clamp.
    const LIFT = (1 - Math.cos((CARD_H / 2) * BOW)) / BOW
    const { pose: restGrip, anchor: REST_ANCHOR } = tableGrip({ gap: G, yaw: YAW, squeeze: PRESS })
    const { pose: seatGrip, anchor: SEAT_ANCHOR } = tableGrip({
      gap: G,
      yaw: YAW,
      tilt: TILT,
      squeeze: PRESS,
    })
    const REST_A = REST_ANCHOR
    const SEAT_A = [SEAT_ANCHOR[0], SEAT_ANCHOR[1] + LIFT, SEAT_ANCHOR[2]]
    // The carry grip: the SAME builder turned to the portrait stack the lesson
    // starts from, which is what makes the cut packet land on its own layout
    // instead of wherever the hand carried it (see contacts.js on `cardYaw`).
    const { pose: topGrip, anchor: TOP_A } = packetGrip({
      baseY: 0.02 + HALF * CARD_GAP,
      deckH: (HALF - 1) * CARD_GAP,
      // The carry beats squeeze far more gently than the bend does, so their
      // pads need less air — and the grip-fidelity check wants the thumb ON its
      // packet, not hovering a squeeze above it.
      squeeze: CARRY_SQUEEZE,
    })
    const { pose: bottomGrip, anchor: BOTTOM_A } = packetGrip({
      deckH: (HALF - 1) * CARD_GAP,
      squeeze: CARRY_SQUEEZE,
    })
    // Where the ratchet ends: out along the half and a touch down, because a
    // thumbPeel frame is three-quarters thumb and an opening thumb lifts every
    // card still riding it.
    const LAND_A = [SEAT_A[0] + CARD_H * 0.4, SEAT_A[1] - CARD_H * 0.2, SEAT_A[2]]

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
            // Pin frame 0: without it both hands lerp in from the `relaxed`
            // preset's OWN wrist position, a pre-scale number that now parks a
            // 2.83x hand on top of the deck.
            { at: 0, pose: 'deckApproach', anchor: [APPROACH_REACH + 0.9, TABLE_TOP + DECK_APPROACH_DROP + 0.5, 0.2] },
            { at: 0.3, pose: 'deckApproach', anchor: [APPROACH_REACH + 0.5, TABLE_TOP + DECK_APPROACH_DROP + 0.26, 0.0] },
            { at: 1, pose: topGrip, anchor: TOP_A, ease: 'easeOutCubic' },
          ],
          // Waiting its turn a full reach off the deck's own long edge, so the
          // other hand's carry grip has the pile to itself.
          left: [
            { at: 0, pose: 'deckApproach', anchor: [APPROACH_REACH + 0.9, TABLE_TOP + DECK_APPROACH_DROP + 0.5, 0.2] },
            { at: 0.5, pose: 'deckApproach', anchor: [APPROACH_REACH + 0.62, TABLE_TOP + DECK_APPROACH_DROP + 0.1, 0.1], ease: 'easeOutCubic' },
          ],
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
          right: { cards: 'secondHalf', frame: 'packet', pressure: [{ at: 0, v: 0.25 }, { at: 1, v: 0.3 }] },
        },
        hands: {
          right: [
            { at: 0.4, pose: topGrip, anchor: [TOP_A[0] + 0.55, TOP_A[1] + 0.24, TOP_A[2]] },
            { at: 1, pose: restGrip, anchor: REST_A, ease: 'easeOutCubic' },
          ],
          // Comes down on the bottom half only once the cut packet has cleared
          // the centre: a hand this size wraps the stack's far end, which is
          // exactly the corridor the top half sweeps through as it turns
          // landscape. Hover through the sweep, seat on the last frame.
          left: [
            { at: 0.82, pose: bottomGrip, anchor: [BOTTOM_A[0], BOTTOM_A[1] + 0.5, BOTTOM_A[2]] },
            { at: 1, pose: bottomGrip, anchor: BOTTOM_A, ease: 'easeOutCubic' },
          ],
        },
      },
      {
        kind: 'move',
        id: 'slide',
        label: 'Seat the other half against it',
        duration: 1000,
        ease: 'easeInOutCubic',
        to: (dk) => halves(dk, {}).filter((_, i) => i < mid(dk)),
        // The LEFT half is not gripped through this beat: the engine mirrors a
        // left hand's frame POSITION but keeps its quaternion unmirrored
        // (grips.js), so a left-hand grip held across the 90° turn from the
        // carry grip to the table grip rotates its packet the wrong way round
        // and lands it well off its own layout. The right hand turns its half
        // correctly; the left half follows the step's layout, and its hand —
        // anchored off that same layout — tracks it.
        grip: {
          right: { cards: 'secondHalf', frame: 'packet', pressure: [{ at: 0, v: 0.3 }, { at: 1, v: 0.3 }] },
        },
        hands: {
          // Lift OFF the stack before turning: this hand's thumb is tangent on
          // the pile's far edge, and the half now follows the layout rather
          // than the hand, so a sideways move out of that pose rakes it.
          left: [
            { at: 0.35, pose: bottomGrip, anchor: [BOTTOM_A[0], BOTTOM_A[1] + 0.42, BOTTOM_A[2]] },
            { at: 1, pose: restGrip, anchor: REST_A, ease: 'easeOutCubic' },
          ],
        },
      },
      {
        kind: 'move',
        id: 'seat',
        label: 'Square the corners — light pressure only',
        duration: 1400,
        ease: 'easeOutCubic',
        to: (dk) => halves(dk, { tilt: TILT }),
        bend: BOW,
        grip: {
          left: { cards: 'firstHalf', frame: 'packet', bendGain: 0.3, pressure: [{ at: 0, v: 0.3 }, { at: 1, v: 0.45 }] },
          right: { cards: 'secondHalf', frame: 'packet', bendGain: 0.3, pressure: [{ at: 0, v: 0.3 }, { at: 1, v: 0.45 }] },
        },
        hands: {
          left: [{ at: 1, pose: seatGrip, anchor: SEAT_A }],
          right: [{ at: 1, pose: seatGrip, anchor: SEAT_A }],
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
        toLayout: (order) => landscapeStackLayout(order),
        grip: {
          left: { cards: 'firstHalf', frame: 'thumbPeel', release: 'stagger', pressure: [{ at: 0, v: 0.35 }, { at: 1, v: 0.1 }] },
          right: { cards: 'secondHalf', frame: 'thumbPeel', release: 'stagger', pressure: [{ at: 0, v: 0.35 }, { at: 1, v: 0.1 }] },
        },
        hands: {
          left: [
            ...thumbRatchetKeyframes({
              gripPose: seatGrip,
              // "Open" is a FRACTION of the solved grip: a thumbPeel frame is
              // three-quarters thumb, so straightening it to a typed angle
              // lifts the whole still-held half into the air with it.
              openThumb: seatGrip.fingers.thumb.map((v) => v * 0.9),
              openFingers: 0.88,
              anchorFrom: SEAT_A,
              // Ride OUT and UP as the weave lands. The cards settle into
              // landscapeStackLayout (long axis on x, so the stack spans
              // x±0.44 and tops out near y=0.22) and the still-woven halves
              // are riding their bow ~0.08 higher than the flat layout, so the
              // ratchet has to climb over BOTH: at [0.62, 0.42] the index pad
              // was still 0.012 inside a half's raised inner end.
              anchorTo: LAND_A,
              steps: 7,
              jitter: 0.015, // precise — almost no ratchet noise
            }),
            { at: 0.96, pose: seatGrip, anchor: LAND_A },
            { at: 1, pose: 'deckRest', anchor: [REST_REACH + REST_PAD_X, TABLE_TOP + DECK_REST_DROP + 0.22, 0.0] },
          ],
          right: [
            ...thumbRatchetKeyframes({
              gripPose: seatGrip,
              // "Open" is a FRACTION of the solved grip: a thumbPeel frame is
              // three-quarters thumb, so straightening it to a typed angle
              // lifts the whole still-held half into the air with it.
              openThumb: seatGrip.fingers.thumb.map((v) => v * 0.9),
              openFingers: 0.88,
              anchorFrom: SEAT_A,
              // Ride OUT and UP as the weave lands. The cards settle into
              // landscapeStackLayout (long axis on x, so the stack spans
              // x±0.44 and tops out near y=0.22) and the still-woven halves
              // are riding their bow ~0.08 higher than the flat layout, so the
              // ratchet has to climb over BOTH: at [0.62, 0.42] the index pad
              // was still 0.012 inside a half's raised inner end.
              anchorTo: LAND_A,
              steps: 7,
              jitter: 0.015,
            }),
            { at: 0.96, pose: seatGrip, anchor: LAND_A },
            { at: 1, pose: 'deckRest', anchor: [REST_REACH + REST_PAD_X, TABLE_TOP + DECK_REST_DROP + 0.22, 0.0] },
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
        to: (dk) => landscapeStackLayout(dk),
        bend: 0,
        camera: 'overview',
        hands: {
          // The weave lands LANDSCAPE (x±0.44), so the rest pose comes in from
          // 0.9 out — far enough that the thumb base clears the long side.
          left: [{ at: 1, pose: 'deckRest', anchor: [REST_REACH + REST_PAD_X, TABLE_TOP + DECK_REST_DROP, 0.0], ease: 'easeOutCubic' }],
          right: [{ at: 1, pose: 'deckRest', anchor: [REST_REACH + REST_PAD_X, TABLE_TOP + DECK_REST_DROP, 0.0], ease: 'easeOutCubic' }],
        },
      },
    ]
  },
}
