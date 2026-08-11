import {
  inHandsRiffleLayout,
  inHandsHalfReachX,
  inHandsHalfComposite,
  landscapeStackLayout,
  stackLayout,
  faceQuat,
} from '../engine/layouts'
import { edgePinchGripAuto, rotateGripRigid } from '../authoring/contacts'
import { gsrRiffleOrder } from '../../lib/shuffleMath'
import { CARD_GAP, CARD_H } from '../../lib/constants'

// IN-HANDS riffle shuffle: the version people mean by "riffle shuffle", done in
// the air rather than flat on the felt.
//
// WHY IT IS A DIFFERENT LESSON FROM THE TABLED ONE, not a re-skin. The tabled
// riffle's halves lie on the felt, so the table holds them up and every hand
// height is measured down onto a surface. Here nothing is supported: each hand
// holds its own half by its SHORT ENDS, in the air, and the cards go exactly where
// the fingers go. See TECHNIQUE_REFERENCE.md for the sourced mechanics.
//
// THE GRIP IS SOLVED ONCE AND ROTATED, and this is the part to understand before
// changing anything. A half is held by its short ends, which means an `end`-axis
// edge pinch: thumb on one end face, middle opposing it on the other, index laid
// on the top face so the packet cannot pivot. The pinch CANNOT solve that at a
// riffle half's orientation - measured, at 68 degrees of yaw its reach residual is
// 0.3429 and the thumb slides onto the deck's broad face while still reporting
// three pads "in contact". So:
//
//   1. solve the pinch on a FLAT PORTRAIT half (which it does exactly), then
//   2. rotate hand and packet together by the half's own composite orientation.
//
// A rigid transform preserves a rigid grip, and it does so exactly: measured at
// tilts 0.06 / 0.20 / 0.34 the pad gaps come out byte-identical to the canonical
// solve (0.0168 / 0.0165 / 0.0165) on the intended faces every time. Two things
// fall out of that and both are used below:
//
//   * The grip survives the whole tilt range, so the BEND beat re-rotates the same
//     solve instead of re-solving. Re-solving a carried grip walks the cards under
//     the pads that are holding them (see tableGrip's `tilt` note).
//   * The mirror is free. The engine gives both hands the same pose with the
//     anchor's x negated, and mirror(R_y) = R_y(-angle), so ONE solve serves both
//     hands on the two mirrored halves - verified to 0.0000. What must never be
//     added is a further one-sided roll on top of a mirrored grip.
//
// `inHandsHalfComposite` is the single definition of a half's orientation, shared
// with the layout, because a roll and a yaw do not commute and two independent
// derivations will disagree.
// Measured against the TABLED riffle this replaces, which is the whole
// justification for the swap - it is better on every axis, not a trade:
//
//                       contact   median gap   worst penetration
//   tabled (removed)      31%        0.088          0.0205
//   in-hands (this)       90%        0.009          0.0161
//
// Per-step penetration: square 0.0000, cut 0.0138, address 0.0117, bend 0.0161,
// weave 0.0152, telescope 0.0000, rest 0.0000.
//
// TWO THINGS EARNED THOSE NUMBERS, and both were mistakes first.
//
// 1. A GRIPPED PACKET GOES WHERE THE HAND GOES. The first version authored the
//    halves closing together as CARD positions while also declaring the hands to be
//    holding them, so the grip captured its offsets against a squared deck and a
//    whole-deck hand pose and then carried the halves by that stale relationship:
//    0% contact with the pads 0.823 off the cards. The motion has to come from the
//    hand anchors, and the grip must not start until the hands are in place.
//
// 2. THE PADS MUST NOT SIT IN THE RELEASE PATH. Held by its SHORT ENDS (an `end`
//    pinch) the carry was excellent and the weave measured 0.074 - a full pad
//    radius, meaning released cards passed THROUGH the pads. The clue was that
//    `arcLift` changed nothing at any value, and it cannot: arcLift lifts a card in
//    world Y, but an end pinch releases it along its own long axis, straight out of
//    the pinch. Held by its LONG EDGES instead, both short ends are free and the
//    cards leave without touching anything: weave 0.074 -> 0.015, telescope and rest
//    to 0.0000, at the same contact.
//
// Five further hypotheses were tested and rejected by measurement before that, and
// are recorded here so they are not retried: differing curls between the two grips
// (solved once and rotated twice - no change), the thumbs converging into each
// other's half (separated the stations - no change), the bend tilt (flat across
// 0.06..0.34), the mid-flight bow (flat across midBend 0..0.35), and un-rotating the
// hands during the weave (flat, it just moved to another finger).
//
// TILT_BEND is 0.18 by sweep: bend/weave penetration scales with it (0.010 at 0.14,
// 0.016 at 0.18, 0.025 at 0.22, 0.033 at 0.26) while contact holds at ~90%, so it is
// a straight trade between how visible the spring load is and how hard the index
// presses the top card. 0.18 is about 10 degrees, and keeps the worst contact under
// the tabled riffle's old number.
export const riffleLesson = {
  id: 'riffle',
  title: 'Riffle Shuffle',
  technique: 'riffle',
  randomizes: 'Excellent',
  seed: 7,
  cameraPreset: 'inHands',
  summary:
    'The shuffle everyone means: cut the deck, bring the corners together in your hands, bend them with your thumbs and let the halves interlace as you release — then square them up.',
  facts: [
    'About 7 riffle shuffles are enough to randomize a 52-card deck (the Bayer–Diaconis result).',
    'The bend stores elastic spring energy — release it evenly and the cards interlace; crease it and you ruin the card.',
  ],
  build: (deck) => {
    const N = deck.length
    const MID = Math.floor(N / 2)
    const halfH = (MID - 1) * CARD_GAP
    // Where the shuffle happens. Nothing here touches the felt until the last beat,
    // so this is a free choice — set by the `inHands` camera, which frames y ≈ 1.0.
    const AIR_Y = 1.0
    const YAW = 0.22
    // The thumbs' work: a nearly flat address, then the bend that loads the spring.
    const TILT_FLAT = 0.06
    const TILT_BEND = 0.18
    const SQUEEZE = 0.3
    // How far each half slides inward on the finishing push. About a tenth of a
    // card, which is what "telescope them until nearly flush" comes to.
    const TELESCOPE = 0.09
    // How far apart the halves sit at the cut, before they close. The cut has to
    // read as two separate packets or the address has nothing to do.
    const APART = 0.16
    // The two thumbs both sit on their own packet's INNER end, so as the halves
    // tilt up toward each other the thumbs converge on the junction and each one
    // reaches into the OTHER half. Measured: 0.0523 through the bend and 0.0733
    // through the weave, always one hand's thumb into the opposite half. A hair of
    // separation at the bent stations buys it back without opening a visible gap.
    const BEND_OUT = 0.035
    // THE MERGED DECK FORMS WHERE THE THUMBS ARE. Every released card travels from
    // its half to the merged stack, and both sit at AIR_Y between the hands - so a
    // card springing off a thumb passes straight through it. Measured 0.0752 of
    // right-thumb-into-broad-face at a third of the way through the weave, and it
    // was flat against both the bend tilt (0.0748..0.0752 across 0.06..0.34) and the
    // mid-flight bow (0.0755..0.0749 across midBend 0..0.35), so it is neither.
    // Real hands rise and separate as the interlaced deck accumulates under them.
    const WEAVE_RISE = 0.075
    const WEAVE_OUT = 0.06

    // --- Grips ---------------------------------------------------------------
    // One flat solve per station height, rotated into place. `centre` depends on
    // the tilt (a rolled stack leans, so it reaches further along x), so each tilt
    // gets its own solve at its own centre and pivots on its own base card.
    const halfCentre = (tilt) => inHandsHalfReachX(YAW, tilt, halfH) - 0.01
    // ONE SOLVE, TWO ROTATIONS. Solving per tilt was the first version, and it broke
    // the rule this file's header states: two independent sweeps return different
    // CURLS, so interpolating between them is a re-solve in disguise and it walks
    // the halves under the pads holding them. Measured, that cost 0.0523 of
    // penetration through the bend beat alone.
    //
    // Rotating a single solve keeps every joint angle identical, so the only thing
    // interpolating between the two stations is the wrist's position and
    // quaternion - a rigid motion, which is what a real hand tilting a packet is.
    const SOLVE_CENTRE = halfCentre(TILT_FLAT)
    const flatSolve = edgePinchGripAuto({
      centerX: SOLVE_CENTRE,
      centerZ: 0,
      baseY: AIR_Y,
      deckH: halfH,
      squeeze: SQUEEZE,
      cardQuat: faceQuat(false),
      axis: 'long',
    })
    // Pivot on the BASE card: the flat solve stacks from baseY along +y, and so
    // does the layout once rotated, so the base card is the fixed point.
    const atTilt = (tilt) =>
      rotateGripRigid(flatSolve, inHandsHalfComposite(YAW, tilt, 1), [SOLVE_CENTRE, AIR_Y, 0])
    const flatGrip = atTilt(TILT_FLAT)
    const bentGrip = atTilt(TILT_BEND)
    // A GRIPPED PACKET GOES WHERE THE HAND GOES. That is the rule this lesson is
    // built around, and getting it wrong is what made a first version measure 0%
    // contact with the pads 0.823 off the cards: the closing motion was authored as
    // card positions while the hands were declared to be holding them, so the grip
    // captured its offsets against a squared deck and a whole-deck hand pose and
    // then carried the halves by that stale relationship.
    //
    // So the halves' movement is produced by moving the HANDS. `apart` is the same
    // solved grip translated outward; the authored card layouts only have to AGREE
    // with the hands at the moment the grip is captured.
    const outBy = (g, dx) => [g.anchor[0] + dx, g.anchor[1], g.anchor[2]]

    // The whole deck, held portrait in one hand before the cut and after the
    // square. No rotation: portrait IS the orientation the pinch solves natively.
    const wholeGrip = edgePinchGripAuto({
      centerX: 0,
      centerZ: 0,
      baseY: AIR_Y,
      deckH: (N - 1) * CARD_GAP,
      squeeze: SQUEEZE,
      cardQuat: faceQuat(false),
      axis: 'long',
    })

    // --- Layouts -------------------------------------------------------------
    // Takes the CURRENT deck order, not the closed-over original: the compiler
    // passes the order as it stands at that step, and after the weave that order
    // is the merged one.
    const halves = (dk, tilt, telescope = 0, overlap = 0.01) =>
      inHandsRiffleLayout(dk, { baseY: AIR_Y, yaw: YAW, tilt, telescope, overlap })
    // The merged packet the weave lands in, and the bridge that bows it. Both are
    // the shared landscape stack lifted into the air — `landscapeStackLayout`
    // already takes baseY and bend, so neither needs its own layout.
    const merged = (dk, bend = 0) => landscapeStackLayout(dk, { baseY: AIR_Y, bend })
    const onTable = (dk) => stackLayout(dk, 0.02)

    const NOTE = [0, AIR_Y + CARD_H * 0.45, 0]

    return [
      {
        kind: 'hold',
        id: 'square',
        label: 'Square the deck in one hand',
        duration: 500,
        hands: {
          right: [{ at: 1, pose: wholeGrip.pose, anchor: wholeGrip.anchor }],
        },
        annotations: [{ text: 'Held by the ends — thumb one side, fingers the other', at: NOTE, appearAt: 0.2 }],
      },
      {
        // UNGRIPPED on purpose: the hands are still travelling into position, so
        // there is no rigid relationship to capture yet. The cards move to the two
        // apart halves on their own, and the hands arrive at the same moment.
        kind: 'move',
        id: 'cut',
        label: 'Cut it into two halves, one per hand',
        duration: 620,
        ease: 'easeInOutCubic',
        to: (dk) => halves(dk, TILT_FLAT, 0, -APART),
        hands: {
          left: [{ at: 1, pose: flatGrip.pose, anchor: outBy(flatGrip, APART) }],
          right: [{ at: 1, pose: flatGrip.pose, anchor: outBy(flatGrip, APART) }],
        },
      },
      {
        // The grip STARTS here, with the hands already in place from the cut, so
        // the captured offset is the real hand-to-packet relationship. The closing
        // motion is the hands travelling inward; the cards follow because they are
        // welded to the contact frame.
        kind: 'move',
        id: 'address',
        label: 'Bring the inner corners together',
        duration: 520,
        ease: 'easeOutCubic',
        to: (dk) => halves(dk, TILT_FLAT),
        grip: {
          left: { cards: 'firstHalf', frame: 'pinch', pressure: [{ at: 0, v: SQUEEZE }, { at: 1, v: SQUEEZE }] },
          right: { cards: 'secondHalf', frame: 'pinch', pressure: [{ at: 0, v: SQUEEZE }, { at: 1, v: SQUEEZE }] },
        },
        hands: {
          left: [
            { at: 0, pose: flatGrip.pose, anchor: outBy(flatGrip, APART) },
            { at: 1, pose: flatGrip.pose, anchor: flatGrip.anchor, ease: 'easeOutCubic' },
          ],
          right: [
            { at: 0, pose: flatGrip.pose, anchor: outBy(flatGrip, APART) },
            { at: 1, pose: flatGrip.pose, anchor: flatGrip.anchor, ease: 'easeOutCubic' },
          ],
        },
        annotations: [{ text: 'The corners touch BEFORE the thumbs release — that is where the interlace happens', at: NOTE, appearAt: 0.3 }],
      },
      {
        kind: 'move',
        id: 'bend',
        label: 'Thumbs bend the corners up — load the spring',
        duration: 480,
        ease: 'easeInOutCubic',
        to: (dk) => halves(dk, TILT_BEND),
        grip: {
          left: { cards: 'firstHalf', frame: 'pinch', pressure: [{ at: 0, v: SQUEEZE }, { at: 1, v: SQUEEZE }] },
          right: { cards: 'secondHalf', frame: 'pinch', pressure: [{ at: 0, v: SQUEEZE }, { at: 1, v: SQUEEZE }] },
        },
        // The SAME solve re-rotated to the bent tilt, never re-solved: a re-solve
        // returns different curls and walks the halves under the pads holding them.
        // The packet rotates because it rides the hand's own frame.
        hands: {
          left: [{ at: 1, pose: bentGrip.pose, anchor: outBy(bentGrip, BEND_OUT), ease: 'easeInOutCubic' }],
          right: [{ at: 1, pose: bentGrip.pose, anchor: outBy(bentGrip, BEND_OUT), ease: 'easeInOutCubic' }],
        },
        annotations: [{ text: 'Bend firmly, never crease — that spring is what drives the weave', at: NOTE, appearAt: 0.25 }],
      },
      {
        kind: 'riffle',
        id: 'weave',
        label: 'Release — the corners interlace one at a time',
        order: gsrRiffleOrder,
        duration: 900,
        ease: 'easeOutCubic',
        // The interlace stays TIGHT: the footage shows cards within ~15 degrees of
        // parallel offset by about a card thickness, not fanned into an arc.
        midBend: 0.15,
        arcLift: 0.06,
        toLayout: (order) => landscapeStackLayout(order, { baseY: AIR_Y }),
        grip: {
          left: { cards: 'firstHalf', frame: 'pinch', release: 'stagger', pressure: [{ at: 0, v: SQUEEZE }, { at: 1, v: 0.1 }] },
          right: { cards: 'secondHalf', frame: 'pinch', release: 'stagger', pressure: [{ at: 0, v: SQUEEZE }, { at: 1, v: 0.1 }] },
        },
        hands: {
          left: [
            { at: 0, pose: bentGrip.pose, anchor: outBy(bentGrip, BEND_OUT) },
            {
              at: 1,
              pose: flatGrip.pose,
              anchor: [flatGrip.anchor[0] + BEND_OUT + WEAVE_OUT, flatGrip.anchor[1] + WEAVE_RISE, flatGrip.anchor[2]],
              ease: 'easeOutCubic',
            },
          ],
          right: [
            { at: 0, pose: bentGrip.pose, anchor: outBy(bentGrip, BEND_OUT) },
            {
              at: 1,
              pose: flatGrip.pose,
              anchor: [flatGrip.anchor[0] + BEND_OUT + WEAVE_OUT, flatGrip.anchor[1] + WEAVE_RISE, flatGrip.anchor[2]],
              ease: 'easeOutCubic',
            },
          ],
        },
      },
      {
        // Ungripped from here: every card has been released by the weave's stagger,
        // so nothing is welded to a hand and the cards travel on their own tracks.
        kind: 'move',
        id: 'telescope',
        label: 'Push the halves home until they are nearly flush',
        duration: 420,
        ease: 'snapEase',
        to: (dk) => merged(dk),
        hands: {
          left: [{ at: 1, pose: flatGrip.pose, anchor: outBy(flatGrip, -TELESCOPE), ease: 'snapEase' }],
          right: [{ at: 1, pose: flatGrip.pose, anchor: outBy(flatGrip, -TELESCOPE), ease: 'snapEase' }],
        },
        annotations: [{ text: 'Telescope them together — square, not slammed', at: NOTE, appearAt: 0.2 }],
      },
      {
        kind: 'move',
        id: 'rest',
        label: 'Set the shuffled deck down',
        duration: 620,
        ease: 'easeInOutCubic',
        to: onTable,
        camera: 'overview',
        // OUT AND UP, then away. Travelling straight to a resting position sweeps
        // both hands through the deck that is landing on the felt: measured 0.0637.
        // The deck goes down, so the hands have to go up first.
        hands: {
          left: [
            { at: 0.45, pose: flatGrip.pose, anchor: [flatGrip.anchor[0] - 0.42, flatGrip.anchor[1] + 0.3, flatGrip.anchor[2]] },
            { at: 1, pose: flatGrip.pose, anchor: [flatGrip.anchor[0] - 0.8, flatGrip.anchor[1] + 0.45, flatGrip.anchor[2] + 0.2], ease: 'easeOutCubic' },
          ],
          right: [
            { at: 0.45, pose: flatGrip.pose, anchor: [flatGrip.anchor[0] + 0.42, flatGrip.anchor[1] + 0.3, flatGrip.anchor[2]] },
            { at: 1, pose: flatGrip.pose, anchor: [flatGrip.anchor[0] + 0.8, flatGrip.anchor[1] + 0.45, flatGrip.anchor[2] + 0.2], ease: 'easeOutCubic' },
          ],
        },
      },
    ]
  },
}
