import * as THREE from 'three'
import { landscapeStackLayout, stackLayout, faceQuat } from '../engine/layouts'
import { edgePinchGripAuto } from '../authoring/contacts'
import { gsrRiffleOrder } from '../../lib/shuffleMath'
import { CARD_GAP, CARD_H } from '../../lib/constants'

// TABLE riffle shuffle: two halves flat on the felt, thumbs bending the inner ends
// up and letting the cards spring together. This is the basic riffle - the one
// people learn first and the one dealers use - and it replaced an IN-HANDS version
// on direct user feedback: the cards need to visibly BEND, the shuffle belongs on
// the table rather than in mid-air, and the in-hands version's two hands overlapped
// each other in the middle of the frame, which reads as nonsense.
//
// THREE GEOMETRIC FACTS DECIDE THE WHOLE DESIGN, and each was measured rather than
// assumed. Read these before changing anything here.
//
//  1. THE BEND SHADER ONLY BOWS A CARD ALONG ITS OWN LONG AXIS. It maps local
//     (x,y,0) -> (x, sin(yb)/b, (1-cos(yb))/b): x is untouched and the displacement
//     is a function of local Y, so the cylinder axis is local X and the curvature
//     runs along local Y. A card can therefore only arch between its two SHORT
//     ENDS. That single fact forces everything else: the thumb and the fingers have
//     to be AT those two ends, or the bow runs across the line between them and the
//     hand appears to hold a card by its spine while the ends curl away.
//  2. SO THE GRIP IS `axis: 'end'`, not 'long'. `PINCH_FACES.long` puts the thumb
//     and middle on the two LONG edges, which is the axis the rest of the catalog
//     uses and the one validated 18/18 - but it is the wrong axis for a bend, for
//     the reason above.
//  3. AN `end` PINCH PUTS THE WRIST ON THE THUMB'S SIDE, because the thumb knuckle
//     sits 0.64 behind the four fingers under this grip's quaternion and the fingers
//     are the ones with reach (see PINCH_FACES). If the thumb takes the INNER end,
//     both wrists converge on the middle of the table and the hands overlap - the
//     exact defect being fixed. So the thumb must take the OUTER end.
//
// (3) is not a free choice: the pinch resolves which end the thumb takes from the
// rig, so the lever is the HALF's yaw. A face-down card yawed by a further PI is
// visually identical - a rectangle's 180-degree rotation is itself - but it swaps
// which world end is which, and therefore which end the thumb claims. `END_FLIP`
// below is that switch, and it is set by measurement, not taste.
const END_FLIP = Math.PI

export const riffleLesson = {
  id: 'riffle',
  title: 'Riffle Shuffle',
  technique: 'riffle',
  randomizes: 'Strong',
  seed: 7,
  cameraPreset: 'riffleTable',
  summary:
    'The shuffle everyone means: cut the deck, bend the two inner ends up with your thumbs, and let the cards spring back together so they interlace. Done flat on the table, which is how the basic version is taught.',
  facts: [
    'About 7 riffle shuffles are enough to randomize a 52-card deck (the Bayer–Diaconis result).',
    'The bend stores elastic spring energy — release it evenly and the cards interlace; crease it and you ruin the card.',
  ],
  build: (deck) => {
    const N = deck.length
    const MID = Math.floor(N / 2)
    const halfH = (MID - 1) * CARD_GAP

    // ON THE FELT. `tableRiffleLayout`'s own default baseY, so the halves sit on the
    // table the way every other tabled layout in the catalog does and
    // `clampAboveFelt` has something to clamp against.
    const TABLE_Y = 0.03
    // The dog-leg. Reference footage shows the two halves meeting at a shallow V
    // rather than dead in line, which is what lets the inner ends interlace while
    // the outer ends stay apart under the hands.
    const YAW = 0.1
    // Half centres. A landscape half is CARD_H long, so its inner end sits at
    // GAP - CARD_H/2: at 0.52 that is 0.08 of clear felt between the two ends,
    // which reads as two packets about to merge rather than one broken stack.
    const GAP = 0.52
    // ...and how much further apart they sit at the cut, so the cut reads as two
    // separate packets before the address closes them.
    const APART = 0.2
    // The bend. 1.1 is the value the previous tabled version arrived at and it is
    // kept: a bow you can clearly see without the card looking creased.
    const BEND = 1.1
    const SQUEEZE = 0.26

    // --- Grips ---------------------------------------------------------------
    // One solve, mirrored. The two halves are mirror images of each other about x,
    // and the engine gives the left hand the same pose with the anchor's x negated,
    // so a single solve on the RIGHT half serves both hands. That is only free
    // because the cards are mirrored too - the overhand pays for getting this
    // backwards, see overhandNew.lesson.js.
    const halfQuat = faceQuat(false, Math.PI / 2 - YAW + END_FLIP)
    const grip = edgePinchGripAuto({
      centerX: GAP,
      centerZ: 0,
      baseY: TABLE_Y,
      deckH: halfH,
      squeeze: SQUEEZE,
      cardQuat: halfQuat,
      axis: 'end',
    })
    // A GRIPPED PACKET GOES WHERE THE HAND GOES, so every packet motion below is
    // produced by moving the HAND and the authored layouts only have to agree with
    // the hands at the instant a grip is captured.
    const outBy = (dx, dy = 0) => [grip.anchor[0] + dx, grip.anchor[1] + dy, grip.anchor[2]]

    // NO WHOLE-DECK GRIP, deliberately. The opening beat used to put a hand on the
    // squared 52-card deck, and a full-deck pinch is at the limit of the thumb's reach
    // whichever axis it uses: measured 0.1044 on `end` and 0.0752 on `long`, the latter
    // being exactly the thumb distal's saturation ceiling of 0.0759 - a capsule centre
    // sitting on a card plane. A squared deck reads perfectly well on its own, and the
    // hands have nothing to do until there are two halves to hold, so they fly in on
    // the cut instead.
    // --- Layouts -------------------------------------------------------------
    // Written out rather than calling `tableRiffleLayout`, for one reason worth
    // stating: the mirror sign has to multiply the WHOLE yaw including END_FLIP. Post
    // -multiplying a flip onto that layout's quaternion is also wrong twice over -
    // `faceQuat` is not a pure yaw (it composes the face-down rotation), so
    // multiplying two of them double-applies it, and `faceQuat` PREmultiplies its yaw
    // so a post-multiply is not even the same rotation. Measured, that scrambled the
    // orientation badly enough to drive a hand through 26 cards.
    const halves = (dk, { apart = 0, bend = 0 } = {}) => {
      const mid = Math.floor(dk.length / 2)
      return dk.map((card, i) => {
        const inLeft = i < mid
        const local = inLeft ? i : i - mid
        const s = inLeft ? -1 : 1
        return {
          id: card.id,
          pos: new THREE.Vector3(s * (GAP + apart), TABLE_Y + local * CARD_GAP, 0),
          quat: faceQuat(false, s * (Math.PI / 2 - YAW + END_FLIP)),
          bend,
        }
      })
    }
    const merged = (dk, bend = 0) => landscapeStackLayout(dk, { baseY: TABLE_Y, bend })
    const NOTE = [0, CARD_H * 0.5, 0.55]

    return [
      {
        // A `move` and not a `hold`, with an explicit `to`. A hold leaves the deck in
        // whatever layout it arrived in - a PORTRAIT stack at 0.02 - while `wholeGrip`
        // is solved against the LANDSCAPE footprint the weave lands in, and that
        // disagreement measured 0.0703 of hand inside the deck it was supposedly
        // holding. Squaring into the landscape stack makes the two agree.
        kind: 'move',
        id: 'square',
        label: 'A squared deck on the table',
        duration: 420,
        ease: 'easeInOutCubic',
        to: (dk) => merged(dk),
        annotations: [{ text: 'Flat on the felt — this is the basic riffle', at: NOTE, appearAt: 0.2 }],
      },
      {
        // UNGRIPPED: the hands are still travelling to their halves, so there is no
        // rigid relationship to capture yet.
        kind: 'move',
        id: 'cut',
        label: 'Cut it into two halves, side by side',
        duration: 560,
        ease: 'easeInOutCubic',
        to: (dk) => halves(dk, { apart: APART }),
        // The hands FLY IN from outboard and above, arriving as the two halves settle.
        // Starting them on the deck's centre and travelling outward swept a thumb
        // 0.0907 through the cards moving the other way underneath.
        hands: {
          left: [
            { at: 0, pose: grip.pose, anchor: outBy(APART + 0.55, CARD_H * 0.42) },
            { at: 1, pose: grip.pose, anchor: outBy(APART), ease: 'easeOutCubic' },
          ],
          right: [
            { at: 0, pose: grip.pose, anchor: outBy(APART + 0.55, CARD_H * 0.42) },
            { at: 1, pose: grip.pose, anchor: outBy(APART), ease: 'easeOutCubic' },
          ],
        },
      },
      {
        // The grip starts here, hands already in place, so the captured offset is
        // the real hand-to-packet relationship.
        kind: 'move',
        id: 'address',
        label: 'Bring the inner ends together',
        duration: 460,
        ease: 'easeOutCubic',
        to: (dk) => halves(dk),
        grip: {
          left: { cards: 'firstHalf', frame: 'pinch', pressure: [{ at: 0, v: SQUEEZE }, { at: 1, v: SQUEEZE }] },
          right: { cards: 'secondHalf', frame: 'pinch', pressure: [{ at: 0, v: SQUEEZE }, { at: 1, v: SQUEEZE }] },
        },
        hands: {
          left: [
            { at: 0, pose: grip.pose, anchor: outBy(APART) },
            { at: 1, pose: grip.pose, anchor: grip.anchor, ease: 'easeOutCubic' },
          ],
          right: [
            { at: 0, pose: grip.pose, anchor: outBy(APART) },
            { at: 1, pose: grip.pose, anchor: grip.anchor, ease: 'easeOutCubic' },
          ],
        },
        annotations: [{ text: 'The ends meet BEFORE the release — that is where they interlace', at: NOTE, appearAt: 0.3 }],
      },
      {
        kind: 'move',
        id: 'bend',
        label: 'Bend the inner ends up — load the spring',
        duration: 520,
        ease: 'easeInOutCubic',
        // THE BEND IS THE CARDS, not the hands. `bend` bows each half along its own
        // long axis, which runs from the fingers at the inner end to the thumb at the
        // outer one, and `bendGain` lets the gripped packet ride half of the rise a
        // bowed card gets - a bowed card rests on its ENDS, not its centre. Swept 0.25 /
        // 0.5 / 0.8 / 1.0: 0.25 measured best (address 61% against 56-59%), so the packet
        // rides only a quarter of the bow's rise.
        to: (dk) => halves(dk, { bend: BEND }),
        grip: {
          left: { cards: 'firstHalf', frame: 'pinch', bendGain: 0.25, pressure: [{ at: 0, v: SQUEEZE }, { at: 1, v: SQUEEZE }] },
          right: { cards: 'secondHalf', frame: 'pinch', bendGain: 0.25, pressure: [{ at: 0, v: SQUEEZE }, { at: 1, v: SQUEEZE }] },
        },
        hands: {
          left: [{ at: 1, pose: grip.pose, anchor: outBy(0, CARD_H * 0.06), ease: 'easeInOutCubic' }],
          right: [{ at: 1, pose: grip.pose, anchor: outBy(0, CARD_H * 0.06), ease: 'easeInOutCubic' }],
        },
        annotations: [{ text: 'Bend firmly, never crease — that spring drives the whole shuffle', at: NOTE, appearAt: 0.25 }],
      },
      {
        kind: 'riffle',
        id: 'weave',
        label: 'Let them go — the ends interlace one at a time',
        order: gsrRiffleOrder,
        duration: 820,
        ease: 'easeOutCubic',
        // The interlace stays TIGHT and LOW: on a table the cards fall onto the felt
        // rather than arcing through the air, so the lift is small and the mid-flight
        // bow is what is left of the spring straightening out.
        midBend: 0.35,
        arcLift: 0.04,
        toLayout: (order) => landscapeStackLayout(order, { baseY: TABLE_Y }),
        grip: {
          left: { cards: 'firstHalf', frame: 'pinch', release: 'stagger', bendGain: 0.25, pressure: [{ at: 0, v: SQUEEZE }, { at: 1, v: 0.08 }] },
          right: { cards: 'secondHalf', frame: 'pinch', release: 'stagger', bendGain: 0.25, pressure: [{ at: 0, v: SQUEEZE }, { at: 1, v: 0.08 }] },
        },
        // THE HANDS MUST RISE FASTER THAN THE DECK GROWS. The merged stack builds to
        // 52 * CARD_GAP = 0.156 in the middle of the weave, exactly where the fingers
        // are - they sit at the inner end because the thumb took the outer one. Rising
        // only CARD_H*0.1 (0.088) let the growing deck come up INTO them: penetration
        // climbed steadily across the beat, 0.0172 at the start to 0.0441 by the end,
        // and it was the right middle's distal every time. Rising CARD_H*0.24 and
        // easing further out takes the same beat to 0.0020.
        hands: {
          left: [
            { at: 0, pose: grip.pose, anchor: outBy(0, CARD_H * 0.06) },
            { at: 1, pose: grip.pose, anchor: outBy(0.14, CARD_H * 0.24), ease: 'easeOutCubic' },
          ],
          right: [
            { at: 0, pose: grip.pose, anchor: outBy(0, CARD_H * 0.06) },
            { at: 1, pose: grip.pose, anchor: outBy(0.14, CARD_H * 0.24), ease: 'easeOutCubic' },
          ],
        },
      },
      {
        // Ungripped: the weave's stagger has released every card, so nothing is
        // welded to a hand any more.
        kind: 'move',
        id: 'push',
        label: 'Push the halves square',
        duration: 400,
        ease: 'snapEase',
        to: (dk) => merged(dk),
        hands: {
          left: [{ at: 1, pose: grip.pose, anchor: outBy(-0.06, CARD_H * 0.1), ease: 'snapEase' }],
          right: [{ at: 1, pose: grip.pose, anchor: outBy(-0.06, CARD_H * 0.1), ease: 'snapEase' }],
        },
        annotations: [{ text: 'Square them up — telescoped together, not slammed', at: NOTE, appearAt: 0.2 }],
      },
      {
        kind: 'move',
        id: 'rest',
        label: 'Shuffled, and squared on the felt',
        duration: 560,
        ease: 'easeInOutCubic',
        to: (dk) => stackLayout(dk, TABLE_Y),
        camera: 'overview',
        // OUT AND UP FIRST. Travelling straight to a resting position sweeps both
        // hands through the deck squaring up under them - the same crossing the
        // overhand's `rest` beat pays for.
        hands: {
          left: [
            { at: 0.4, pose: grip.pose, anchor: outBy(-0.3, CARD_H * 0.34), ease: 'easeOutCubic' },
            { at: 1, pose: grip.pose, anchor: outBy(-0.7, CARD_H * 0.46), ease: 'easeInOutCubic' },
          ],
          right: [
            { at: 0.4, pose: grip.pose, anchor: outBy(0.3, CARD_H * 0.34), ease: 'easeOutCubic' },
            { at: 1, pose: grip.pose, anchor: outBy(0.7, CARD_H * 0.46), ease: 'easeInOutCubic' },
          ],
        },
      },
    ]
  },
}
