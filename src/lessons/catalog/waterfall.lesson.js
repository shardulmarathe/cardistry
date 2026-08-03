import { landscapeStackLayout, cascadeLayout } from '../engine/layouts'
import { cageGrip, rigMetrics, resolvePenetration } from '../authoring/contacts'
import { CARD_GAP, CARD_H } from '../../lib/constants'
import { DECK_REST_DROP, DECK_APPROACH_DROP } from '../../hands/handPoses'

// Spring / waterfall, finger-driven: the hands cage the deck's ends FIRST
// (same orientation held throughout, so the deck bows in place between the
// fingers), pressure loads the spring, and every card leaves the cage at its
// own moment into the waterfall.
//
// GEOMETRY NOTE. Every hand height here is derived from the cards it is over,
// never guessed: `TOP` is the squared deck's top card, and the two open poses
// anchor at `TOP + DECK_*_DROP` (the measured wrist→lowest-finger-surface drop
// for those presets). The old hand-picked heights put whole phalanges inside
// the pile — the closing `gather` hands sat at y 0.36 with their thumbs
// sweeping the stack's own footprint, 0.070 deep every frame.
export const waterfallLesson = {
  id: 'waterfall',
  title: 'Spring / Waterfall',
  technique: 'waterfall',
  difficulty: 'intermediate',
  randomizes: 'Display only',
  seed: 77,
  cameraPreset: 'dealerPOV',
  summary:
    'Bend the deck into an arch between your hands, then release cards one at a time in a cascading waterfall. A bend-shader showcase.',
  facts: [
    'The spring stores elastic energy in the bowed cards — the waterfall is that energy releasing card by card.',
    'This is display, not mixing — but it teaches the same bend physics as the riffle bridge.',
  ],
  build: (deck) => {
    // The squared deck's TOP card. The arch only BENDS the cards; it never
    // moves them, so this height holds through the whole spring beat.
    const TOP = 0.02 + (deck.length - 1) * CARD_GAP
    // Cage the REAL top card, not a guessed 0.32: the old value floated the
    // thumb ~0.10 above the deck it was supposed to be pressing (fingertip gap
    // 0.425 → 0.341) and bought nothing, because the fingers cup the deck's
    // END face, which is the same plane at any topY.
    // Pads authored OFF their surfaces by the arch's own squeeze: `pressure`
    // adds curl AFTER the contact solve, and that arc is hand-sized, so it grew
    // 2.83x with the rig (measured: a tangent pad 0.056 inside at pressure
    // 0.42). This is the `clearance` the old SHIELD note was reaching for.
    const PRESS = 1.4
    const { pose: cage, anchor: CAGE_ANCHOR0 } = cageGrip({ topY: TOP, squeeze: PRESS })
    // Fingertip reach of the two open presets, measured off the rig: an anchor
    // is a PAD position PLUS that reach (1.62 for `deckRest` at HAND_SCALE 13),
    // not a number near the deck.
    const REST_REACH = -rigMetrics('deckRest').tip.middle.x
    const APPROACH_REACH = -rigMetrics('deckApproach').tip.middle.x
    const REST_PAD_X = 0.18
    // BOWED CARDS REST ON THEIR ENDS, NOT THEIR CENTRES. The bend shader swings
    // a card's ends toward local +Z, which on a face-down card is straight
    // DOWN, so `clampAboveFelt` lifts every bowed card until its ends touch the
    // felt. At this lesson's 3.0 arch that is ARCH_BOW = 0.25, more than the
    // whole deck is thick, so the stack collapses onto ONE plane that high: the
    // cards the cage is squeezing are nowhere near where the flat layout puts
    // them. Solve the cage against BOTH shapes and lift its anchor part-way
    // onto the bowed plate.
    const ARCH_BEND = 3.0
    const ARCH_BOW = (1 - Math.cos((CARD_H / 2) * ARCH_BEND)) / ARCH_BEND
    const CAGE_LIFT = 0.5
    const CAGE_ANCHOR = [CAGE_ANCHOR0[0], CAGE_ANCHOR0[1] + ARCH_BOW * CAGE_LIFT, CAGE_ANCHOR0[2]]
    // `pressure` adds up to 0.14 of extra curl to the gripping fingers at
    // RUNTIME, and the idle overlay adds a little more, so a grip solved
    // exactly tangent is already inside the cards by the first frame. Back the
    // cage off the deck it cups until it clears a SHIELDED copy of the stack —
    // the real cards plus one representative card floated SHIELD past the end
    // face and one SHIELD above the top — which leaves exactly that much air
    // for the squeeze. (`clearance` would be the obvious knob and is the WRONG
    // one: it is a TOLERANCE, so a non-zero value buys penetration instead of
    // margin. Always 0.)
    const SHIELD = 0.03
    const stack = landscapeStackLayout(deck)
    const shifted = (dx, dy) =>
      stack.map((c) => ({ pos: [c.pos.x + dx, c.pos.y + dy, c.pos.z], quat: c.quat }))
    const bowedPlate = stack.map((c) => ({ pos: [c.pos.x, 0.012 + ARCH_BOW, c.pos.z], quat: c.quat }))
    resolvePenetration(
      cage,
      'right',
      [...stack, ...shifted(SHIELD, 0), ...shifted(0, SHIELD), ...bowedPlate.slice(0, 1)],
      { clearance: 0 },
    )
    const NOTE_POS = [-1.3, 0.75, 0.2]
    // Where the hands wait before/after touching the deck: fingers pointing at
    // it, one measured drop above its top card. `+0.16` on the approach keeps
    // the arriving hand clear of the cage's own swing.
    const APPROACH = [APPROACH_REACH + 0.62, TOP + DECK_APPROACH_DROP + 0.3, 0.06]
    // Where the hands finish the spring: OUT and UP, the way a real waterfall
    // ends — the cage opens and the hands ride away from the falling ribbon.
    // `cascadeLayout` drops a diagonal sheet whose high end tops out near
    // y=0.35 and which spans x±1.33 with the cards' own footprint, so the old
    // "close in to 0.62, drop to 0.36" finish drove both hands straight down
    // through it (ring proximal 0.064 deep).
    const OPEN = [REST_REACH + REST_PAD_X + 0.2, TOP + DECK_REST_DROP + 0.12, 0.02]
    // Mid-cascade the cage OPENS: out and up, never in and down. The cards
    // still in the grip ride the hands, so a hand that sinks 0.05 (what this
    // beat used to do) drags its own pinky through the deck's end face.
    const OPENING = [CAGE_ANCHOR[0] + 0.06, CAGE_ANCHOR[1] + 0.05, CAGE_ANCHOR[2]]
    // Relaxing a SOLVED grip: the cage's curls come out of the IK, so a
    // hand-typed "open" value (the old thumb [0.15, 0.12, 0.08]) does not open
    // the thumb — it UNFURLS it, throwing the tip 0.3 UP. The deck rides the
    // thumb/index/middle packet frame, so that levitated the whole still-held
    // remainder 0.13 into the other hand's knuckles. Scale the solved angles
    // instead, so "open" is always a fraction of THIS grip.
    const relax = (finger, k) => cage.fingers[finger].map((v) => v * k)
    // Where the spill LANDS. `cascadeLayout`'s raw sheet spreads along ±x at
    // deck height — straight through both cages — so the cards parked inside
    // the fingers that were supposed to be pouring them. Widen it and push it
    // forward and down so it falls OUT of the cage's mouth instead.
    const SPILL = { spread: 1.25, dz: 0.35, dy: -0.2 }
    const spill = (dk) =>
      cascadeLayout(dk, SPILL.spread).map((c) => {
        c.pos.y += SPILL.dy
        c.pos.z += SPILL.dz
        return c
      })

    return [
      {
        // Turn the deck LANDSCAPE as the hands arrive. This is the fix for the
        // grip that never touched: `cageGrip` cups a deck's SHORT END faces,
        // which for a landscape stack are the planes at x = ±CARD_H/2 = ±0.44
        // — exactly where its finger targets are authored. The lesson used to
        // leave the deck portrait, so those same fingers closed on empty air
        // 0.13 outside a long edge (and the ring pad ended up centred ON that
        // edge, 0.040 inside it, the moment any pressure curled it).
        kind: 'move',
        id: 'approach',
        label: 'Turn the deck and cup its ends',
        duration: 1200,
        ease: 'easeInOutCubic',
        to: (dk) => landscapeStackLayout(dk),
        hands: {
          // Pin frame 0 (otherwise both hands lerp in from the `relaxed`
          // preset's own pre-scale wrist position, on top of the deck), then
          // come in OVER the pile: a straight line from a reach away to the
          // cage's own anchor drags four pads across the top card.
          left: [
            { at: 0, pose: 'deckApproach', anchor: [APPROACH[0] + 0.3, APPROACH[1] + 0.2, 0.2] },
            { at: 0.3, pose: 'deckApproach', anchor: APPROACH },
            { at: 0.7, pose: cage, anchor: [CAGE_ANCHOR[0] + 0.3, CAGE_ANCHOR[1] + 0.34, CAGE_ANCHOR[2]] },
            { at: 1, pose: cage, anchor: CAGE_ANCHOR, ease: 'easeOutCubic' },
          ],
          right: [
            { at: 0, pose: 'deckApproach', anchor: [APPROACH[0] + 0.3, APPROACH[1] + 0.2, 0.2] },
            { at: 0.3, pose: 'deckApproach', anchor: APPROACH },
            { at: 0.7, pose: cage, anchor: [CAGE_ANCHOR[0] + 0.3, CAGE_ANCHOR[1] + 0.34, CAGE_ANCHOR[2]] },
            { at: 1, pose: cage, anchor: CAGE_ANCHOR, ease: 'easeOutCubic' },
          ],
        },
      },
      {
        kind: 'move',
        id: 'arch',
        label: 'Squeeze — bow the deck into a spring arch',
        duration: 1500,
        ease: 'easeOutCubic',
        to: (dk) => landscapeStackLayout(dk, { bend: ARCH_BEND }),
        bend: ARCH_BEND,
        grip: {
          right: { cards: 'all', frame: 'packet', bendGain: 0.5, pressure: [{ at: 0, v: 0.3 }, { at: 1, v: 1 }] },
        },
        hands: {
          left: [{ at: 1, pose: cage, anchor: CAGE_ANCHOR, fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tighten', amp: 0.05 }] }],
          right: [{ at: 1, pose: cage, anchor: CAGE_ANCHOR, fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tighten', amp: 0.05 }] }],
        },
        annotations: [
          { text: 'Load the spring — same physics as the riffle bridge', at: NOTE_POS, appearAt: 0.25 },
        ],
      },
      {
        kind: 'move',
        id: 'cascade',
        label: 'Release — cards waterfall out of the cage',
        duration: 2600,
        ease: 'easeInOutCubic',
        to: (dk) => spill(dk),
        midBend: 1.6,
        stagger: { by: 'card', spread: 0.65, span: 0.35 },
        grip: {
          right: { cards: 'all', frame: 'packet', release: 'stagger', pressure: [{ at: 0, v: 1 }, { at: 1, v: 0.15 }] },
        },
        hands: {
          left: [
            { at: 0, pose: cage, anchor: CAGE_ANCHOR },
            {
              at: 0.6,
              fingers: { thumb: relax('thumb', 0.75) },
              anchor: OPENING,
              fingerMotion: [{ fingers: ['index', 'middle', 'ring', 'pinky'], type: 'curlRipple', amp: 0.05, cycles: 3 }],
            },
            { at: 1, fingers: { thumb: relax('thumb', 0.3), index: relax('index', 0.45) }, anchor: OPEN },
          ],
          right: [
            { at: 0, pose: cage, anchor: CAGE_ANCHOR },
            {
              at: 0.6,
              fingers: { thumb: relax('thumb', 0.75) },
              anchor: OPENING,
              fingerMotion: [{ fingers: ['index', 'middle', 'ring', 'pinky'], type: 'curlRipple', amp: 0.05, cycles: 3 }],
            },
            { at: 1, fingers: { thumb: relax('thumb', 0.3), index: relax('index', 0.45) }, anchor: OPEN },
          ],
        },
        annotations: [
          { text: 'Card by card off the fingertips — that is the waterfall', at: NOTE_POS, appearAt: 0.2, until: 0.9 },
        ],
      },
      {
        kind: 'move',
        id: 'gather',
        label: 'Catch and square the deck',
        duration: 1200,
        ease: 'settle',
        to: (dk) => landscapeStackLayout(dk),
        bend: 0,
        camera: 'overview',
        hands: {
          // Card-derived: the gathered stack's top card is at TOP, and a
          // `deckRest` wrist must sit DECK_REST_DROP above it for the pads to
          // land ON that card. `easeOutCubic`, not `settle` — settle overshoots
          // the target by ~4% and drives the pads straight through the pile.
          // Settle from ABOVE: the hands come back from the open cage, and a
          // straight line to the rest anchor crosses the pile they are
          // gathering.
          left: [
            { at: 0.55, pose: 'deckRest', anchor: [REST_REACH + REST_PAD_X, TOP + DECK_REST_DROP + 0.3, 0.0] },
            { at: 1, pose: 'deckRest', anchor: [REST_REACH + REST_PAD_X, TOP + DECK_REST_DROP, 0.0], ease: 'easeOutCubic' },
          ],
          right: [
            { at: 0.55, pose: 'deckRest', anchor: [REST_REACH + REST_PAD_X, TOP + DECK_REST_DROP + 0.3, 0.0] },
            { at: 1, pose: 'deckRest', anchor: [REST_REACH + REST_PAD_X, TOP + DECK_REST_DROP, 0.0], ease: 'easeOutCubic' },
          ],
        },
      },
    ]
  },
}
