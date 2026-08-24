import * as THREE from 'three'
import { landscapeStackLayout, stackLayout, faceQuat } from '../engine/layouts'
import { tableTopGrip, thumbRatchetKeyframes } from '../authoring/contacts'
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
//     ENDS - which is why the bend beat reads at all, and why the packet's long axis
//     has to run from the junction out to under the hand.
//  2. THE THUMB OWNS THE INNER-NEAR CORNER. That is the release mechanism, it is what
//     the footage shows (`RiffleShuffle.md`, 120s/140s: fingers on top, thumbs at the
//     weave junction, table underneath), and at 140s the two thumbs meet TIP TO TIP.
//     This file used to argue the exact opposite - "the thumb must take the OUTER end"
//     - to stop the hands colliding, and the user's first note on the result was "see
//     how the thumbs are interweaved, that is not good".
//  3. AND THE COLLISION IS REAL, BUT ITS CAUSE IS THE THUMB'S KNUCKLE, NOT ITS TARGET.
//     `FINGERS.thumb.mcp` puts the thumb MCP a FIXED 0.505 on the radial side of the
//     palm centre, so two mirrored hands whose palms are 1.05 apart have their thumb
//     BASES 0.037 apart - 20mm of overlap before either thumb has moved. Measured with
//     `scripts/inspect/handClash.mjs`, the old authoring had the two hands 25.4mm =
//     84 CARD THICKNESSES inside each other on 159 of 201 frames, and the deepest
//     capsule pair was L:thumb[prox] x R:thumb[prox]: the two thumbs crossed in an X
//     (left mid joint at x +0.065, right at -0.076) because their targets were 0.70
//     from a 0.744 thumb and the solver pinned opposition at its limit trying to
//     reach. The fix is a hand YAWED so the fingers swing at the junction while the
//     wrist trails OUTBOARD - see `tableTopGrip`'s header for the sweep. It now
//     measures 6.4mm CLEAR at every frame of every beat.
//
// The old `END_FLIP` constant is gone. It existed because an `end` PINCH resolved
// which end the thumb took from the rig, so the half's yaw was the only lever; a
// table-top hold reads the up face, the near edge and the inner end OFF the card's own
// quaternion, so the flip has nothing left to switch. Verified rather than assumed:
// with the flip removed, every number `verify`, `cardClip` and `handClash` print for
// this lesson is byte-identical.

export const riffleLesson = {
  id: 'riffle',
  title: 'Riffle Shuffle',
  technique: 'riffle',
  randomizes: 'Strong',
  seed: 7,
  cameraPreset: 'riffleTable',
  summary:
    'The shuffle everyone means: cut the deck, bend the two inner ends up with your thumbs and let them spring together so they interlace, then cup both ends, bow the pack into a bridge and let it fold down square. Done flat on the table, which is how the basic version is taught.',
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
    // Half centres. 0.52 -> 0.48, because the footage's inner-near corners ALMOST TOUCH
    // (120s) and RiffleShuffle.md lists "ends touch before anyone releases" as geometry
    // that has to stay true - the weave happens at a contact point, not across a gap.
    // A yawed landscape half reaches (CARD_H/2)*cos(YAW) = 0.438 along x, so 0.52 left
    // 16.5mm of bare felt between the two inner ends, a fifth of a card.
    //
    // It is not free, and the frontier is monotone: closing the halves closes the two
    // THUMBS with them, because each hand's wrist is derived as centerX + wristOut. Swept
    // (felt between the ends / hand-vs-hand at the address / thumb tips apart):
    //     0.52   16.5mm   +15.8mm   31mm
    //     0.48    8.4mm    +7.7mm   23mm
    //     0.46    4.4mm    +3.7mm   19mm
    //     0.44    0.4mm    -0.3mm   15mm   <- hands touching
    // 0.48 is the last value that keeps every beat clear once the bend and the release
    // have taken their own bites out of the same clearance, and 23mm between two 7.5mm
    // thumb tips is the footage's tip-to-tip at 140s.
    const GAP = 0.48
    // ...and how much further apart they sit at the cut, so the cut reads as two
    // separate packets before the address closes them.
    const APART = 0.2
    // THE BOW, AND IT IS THE DOMINANT CAUSE OF CARD-ON-CARD CLIPPING. 1.1 -> 0.8.
    //
    // The geometry: a card bowed by `b` stands its ends `(1 - cos((CARD_H/2)*b))/b`
    // off its own centre plane, and a stack spaces cards ONE card thickness apart. At
    // 1.1 that arch is 35 CARD THICKNESSES; at 0.8 it is 26. Two bowed cards a
    // thickness apart whose arches are dozens of thicknesses tall cannot avoid
    // crossing - the same geometry that made the wash clip, where one card's arch was
    // the entire height band all 52 were spread through.
    //
    // Swept with `cardClip.mjs` (defect pair-frames / worst crossing):
    //     1.1   arch 35 cards   963 pairs   19.8 cards deep    0 failures
    //     0.8   arch 26 cards   533 pairs   12.2 cards deep    0 failures
    //     0.55  arch 18 cards   329 pairs    8.9 cards deep    4 failures
    //     0.35  arch 11 cards   243 pairs    6.9 cards deep   38 failures
    // 0.8 is the last value that costs nothing. Below it the grip and the ratchet
    // start failing, because both were authored against a packet that bows this much.
    //
    // It is NOT taken to zero, and that is the difference from the wash. The user's
    // direct feedback on this lesson was that the cards must visibly BEND - it is what
    // the whole `bend` beat teaches - so this trades the arch down to where it still
    // clearly reads as a bow rather than removing it. 26 card thicknesses is 7.9mm of
    // arch on a 63mm card.
    const BEND = 0.8
    // How hard the finished pack is bowed for the bridge. Swept below; a bridge is a
    // more pronounced arch than the opening bend because it is the whole deck rather
    // than a half, and the whole point of the beat is that you can see it.
    const ARCH = 1
    // THE PACK COMES UP OFF THE FELT as it is squeezed, and this is not decoration.
    // A bend pivots about the card's CENTRE, so arching in place moves the pack's
    // ends and leaves its middle exactly where it was - and the middle is under the
    // hands. The inert-contact gate counts precisely that (a card standing still
    // under a moving hand): 238 samples in this one beat, 10% of the lesson against
    // a 4% budget. Lifting the whole pack means every card moves while a hand is on
    // it, which is also what squeezing a pack off a table does.
    const ARCH_LIFT = CARD_H * 0.09
    // HOW THE HANDS GET OUT OF THE WAY as the arch collapses, and LIFT is the one
    // that matters. The pack's ENDS are what the arch raises and what the fold
    // brings back down, and the hands are ON those ends - so a hand that only slides
    // outward is still in the path. Swept, worst finger-in-card during `fold`:
    //
    //          LIFT 0.06H   LIFT 0.16H
    //   OUT 0.02   0.0288      0.0025
    //   OUT 0.08   0.0152      0.0025
    //   OUT 0.14   0.0025      0.0025
    //   OUT 0.20   0.0025      0.0025
    //
    // Lifting clear fixes it at any outward travel, which is also what a hand
    // actually does - it comes up off the deck as the deck folds down under it. A
    // modest outward opening is kept so the pack is visibly released rather than
    // followed down.
    const BG = 0.25
    const BLIFT = 0.1
    const HOLD = 0.3
    const OUT = 0.08
    const LIFT = 0.16
    // 0.26 -> 0.12, and this is a CLIPPING fix, not a tuning preference.
    // At 0.26 the middle distal was driven 0.0142 into the deck's long-edge face -
    // and expressed against the only ruler on screen that is 4.7 CARD THICKNESSES,
    // on a 52-card deck only 0.156 tall. That is visible as a finger sunk into the
    // cards, which is exactly what it was. In world units 0.0142 reads as nothing,
    // which is why it survived a whole pass of "improving realism".
    //
    // Measured sweep (penetration / contact):
    //   0.26  0.0142 = 4.7 cards   72%
    //   0.18  0.0081 = 2.7 cards   67%
    //   0.12  0.0036 = 1.2 cards   61%
    // The pads now sit about one card proud of the surface instead of five inside it.
    //
    // NOTE WHAT THE CONTACT NUMBER WAS DOING. It fell 72% -> 61%, and that is the
    // metric working correctly against itself: `CONTACT_FLOOR` counts pads within
    // 0.025 of a card, so pressing a pad THROUGH a card scores as contact. Part of
    // that 72% was intersection, not contact. The two ratchets are in genuine
    // opposition here and only accurate PLACEMENT satisfies both; a hard squeeze
    // satisfies one by violating the other.
    const SQUEEZE = 0.12

    // --- Grips ---------------------------------------------------------------
    // One solve, mirrored. The two halves are mirror images of each other about x,
    // and the engine gives the left hand the same pose with the anchor's x negated,
    // so a single solve on the RIGHT half serves both hands. That is only free
    // because the cards are mirrored too - a deleted overhand staging paid for
    // getting this backwards.
    //
    // HISTORY, KEPT BECAUSE IT NAMES A TRAP THAT IS STILL THERE. This lesson used to
    // hold each half in an `edgePinchGrip`, and the pinch cannot solve this orientation:
    // it derives its face coordinates in WORLD axes against a portrait deck, so a half
    // yawed ~90deg decouples from its hand (reach residual 0.3094 here against 0.0004
    // unyawed). `rotateGripRigid` is the documented fix - solve flat, rotate hand and
    // cards together - and it was built, measured and rejected, because a rigidly
    // rotated pinch needs one hand to span the table's centre line and the two hands
    // then interpenetrate by 0.19 through every gripped beat. Neither branch of that
    // choice was any good, which is the signal that the vocabulary was wrong: a tabled
    // riffle is not a two-jaw pinch at all. Nothing below uses the pinch any more.
    const halfQuat = faceQuat(false, Math.PI / 2 - YAW)
    // A TABLE-TOP HOLD, NOT AN EDGE PINCH. See the `tableTop` entry in
    // handKinematics and `tableTopGrip` in authoring/contacts for the full argument;
    // the short version is that a tabled riffle has no second jaw - the fingers press
    // the top face down, the thumb sits at the near long edge, and the FELT holds the
    // packet up. Authoring it as a two-jaw pinch is what made the hands come at the
    // halves from the SIDES with their fingers flat across the card faces, and what
    // made the cut ungrippable.
    //
    // Measured on this half (26 cards), pinch -> tableTop:
    //     scored pads in band     2 of 2      ->  4 of 4
    //     penetration             1.2 cards   ->  0.0 cards
    //     carry-anchor drift      67.7mm      ->  7.9mm   (13 -> 39 cards)
    const grip = tableTopGrip({
      centerX: GAP,
      centerZ: 0,
      baseY: TABLE_Y,
      deckH: halfH,
      squeeze: SQUEEZE,
      cardQuat: halfQuat,
      // THE PLACEMENT THAT PUTS THE THUMBS AT THE JUNCTION WITHOUT MELTING THE HANDS
      // TOGETHER. Every one of these is the winner of a 155,520-cell sweep scored on
      // pads / penetration / reach / hand-vs-hand at once; the argument and the losing
      // rows are in `tableTopGrip`'s header. Do not nudge one without re-sweeping - they
      // trade against each other, and the constraint that binds is the thumb's MCP,
      // which is a fixed 0.505 inboard of the palm centre.
      along: -0.3,
      spread: 0.48,
      across: 0,
      thumbAlong: 0.95,
      yaw: -0.35,
      wristY: 0.78,
      wristBack: 0.48,
      wristOut: 0.34,
    })
    // AND A SECOND SOLVE FOR THE MERGED PACK, which the telescope and the final square
    // need and which is not a luxury: it is what makes those two beats' card motion
    // MOTIVATED. A hand solved against a 26-card half rests its pads on a top face at
    // y 0.105 and its thumb on a near edge at y 0.068; the 52-card pack it is squaring
    // is 0.153 tall, so the same pose hovers - measured, the BOTTOM cards of the pile
    // were 0.109-0.193 from the nearest pad against a 0.05 drive band, and 52 cards
    // sliding 0.36 with nothing near them is exactly what `CAUSALITY_BUDGET` is for.
    //
    // Re-solved on the taller pack the thumb rides the near long edge at the pack's MID
    // height, and a thumb capsule (radius 0.119) centred at mid-height is within the
    // drive band of every card in the pile including the bottom one - 0.022 against the
    // 0.05 band. That is also what the footage does on the square: "thumbs walk the near
    // long edge to keep it square". `wristY` rises by exactly the extra pack height, so
    // the four pads land on the new top face rather than being driven into it.
    const packH = (N - 1) * CARD_GAP
    const squareGrip = tableTopGrip({
      centerX: GAP,
      centerZ: 0,
      baseY: TABLE_Y,
      deckH: packH,
      squeeze: SQUEEZE,
      cardQuat: halfQuat,
      along: -0.3,
      spread: 0.48,
      across: 0,
      // 0.95 -> 0.85 and the wrist only 0.02 higher, both swept against ONE number:
      // how many of the 52 cards in the pack are inside the 0.05 drive band. At the
      // address placement it is 17 of 52 (the thumb rides up to y 0.16, above the pack's
      // top face, and only the top few cards have anything near them); at this one it is
      // 52 of 52, worst 0.040, with penetration still 0.0 cards and +18.9mm of
      // hand-versus-hand clearance. Raising the wrist by the pack's full extra height was
      // the obvious move and it is the WRONG one - it takes the thumb off the edge.
      thumbAlong: 0.85,
      yaw: -0.35,
      wristY: 0.8,
      wristBack: 0.48,
      wristOut: 0.34,
    })

    // A GRIPPED PACKET GOES WHERE THE HAND GOES, so every packet motion below is
    // produced by moving the HAND and the authored layouts only have to agree with
    // the hands at the instant a grip is captured.
    const outBy = (dx, dy = 0) => [grip.anchor[0] + dx, grip.anchor[1] + dy, grip.anchor[2]]
    const sqBy = (dx, dy = 0) => [squareGrip.anchor[0] + dx, squareGrip.anchor[1] + dy, squareGrip.anchor[2]]

    // NO WHOLE-DECK GRIP, deliberately. The opening beat used to put a hand on the
    // squared 52-card deck, and a full-deck pinch is at the limit of the thumb's reach
    // whichever axis it uses: measured 0.1044 on `end` and 0.0752 on `long`, the latter
    // being exactly the thumb distal's saturation ceiling of 0.0759 - a capsule centre
    // sitting on a card plane. A squared deck reads perfectly well on its own, and the
    // hands have nothing to do until there are two halves to hold, so they fly in on
    // the cut instead.
    // --- Layouts -------------------------------------------------------------
    // Written out rather than calling `tableRiffleLayout`, for one reason worth
    // stating: the mirror sign has to multiply the WHOLE yaw. Post-multiplying a flip
    // onto that layout's quaternion is also wrong twice over -
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
          quat: faceQuat(false, s * (Math.PI / 2 - YAW)),
          bend,
        }
      })
    }
    const merged = (dk, bend = 0) => landscapeStackLayout(dk, { baseY: TABLE_Y, bend })

    // THE 180s FRAME, which the lesson used to skip. After the riffle the halves lie
    // FLAT again and are woven only at the INNER CORNERS, about 6-12mm - a visible
    // zipper of white edges in a shallow V, still plainly two packets. The old lesson
    // sent the weave straight into `landscapeStackLayout`, i.e. from "two halves" to
    // "one squared deck" inside a single beat, which is the jump RiffleShuffle.md calls
    // out and also the reason the beat clipped so badly: the merged stack formed in the
    // space the un-released halves still occupied, so every card crossed the other half.
    //
    // The interlace is expressed by HEIGHT, not by position: a card's slot in the pile
    // is its index in the riffled order, and its footprint stays at its OWN half's
    // station. So the two packets keep their own x and yaw and only close far enough
    // for the ends to overlap, which is exactly what a corner-only weave is.
    //
    // A yawed half reaches (CARD_H/2)*cos(YAW) along x from its centre, so `CLOSE` is
    // derived rather than dialled: it is however far each centre must travel for the
    // two inner ends to overlap by WOVEN.
    const WOVEN = 0.1
    const REACH = (CARD_H / 2) * Math.cos(YAW)
    const CLOSE = WOVEN / 2 + GAP - REACH
    // ...and how far they close on the TELESCOPE beat: nearly flush, a residual 0.03
    // of stagger left for the final square to take out. 200s, driven by ring + middle.
    const FLUSH = GAP - 0.03
    const firstHalfIds = new Set(deck.slice(0, MID).map((c) => c.id))
    const woven = (dk, close) =>
      dk.map((card, i) => {
        const s = firstHalfIds.has(card.id) ? -1 : 1
        return {
          id: card.id,
          pos: new THREE.Vector3(s * (GAP - close), TABLE_Y + i * CARD_GAP, 0),
          quat: faceQuat(false, s * (Math.PI / 2 - YAW)),
          bend: 0,
        }
      })

    // --- WHAT IS ACTUALLY ON THE CARDS ---------------------------------------
    // The `tableTop` frame scores index, middle, ring and thumb, and on the two held
    // beats all four are genuinely there. THE RELEASE IS DIFFERENT, and the difference
    // is measured per surface rather than assumed - 41 samples per hand per beat, share
    // inside the 0.025 band and median gap:
    //
    //   surface   address        bend          weave
    //   index    100% / 0.005  100% / 0.013   73% / 0.018
    //   middle   100% / 0.003  100% / 0.003   59% / 0.012
    //   ring     100% / 0.006   54% / 0.022    0% / 0.041
    //   thumb    100% / 0.012   52% / 0.024    0% / 0.087
    //
    // So the weave scores INDEX AND MIDDLE and nothing else. The ring lifts as the hand
    // opens and the thumb walks off the inner corner it has just emptied - which is the
    // whole point of the beat, not a defect - and scoring either would report a correct
    // release as a hover. Note which two are left: the index is the fulcrum the footage
    // names at 150s ("index still the fulcrum"), and the middle is beside it. Widening
    // this set to all four was measured too: the lesson's contact goes 89% of 447 to
    // 74% of 612, i.e. straight onto the floor, because the weave alone reads 50%.
    const WEAVE_ON_CARDS = { index: true, middle: true }

    // --- The release's hand track --------------------------------------------
    // THE CLICK CADENCE. Two rhythms overlap here and only one of them is authored in
    // this file. The CARD stream is the engine's: `kind:'riffle'` gives card k of 52 a
    // travel window at k/51 * 0.55 of the beat and `release:'stagger'` peels each card
    // off as its own window opens, so the cards leave EVENLY, 52 of them across the
    // first 55% of the beat, and no lesson-level knob can bend that (see the handoff
    // note - it needs a cadence curve on `staggerWindow`).
    //
    // What this file owns is the HAND's rhythm, and that is where the ratchet reads
    // from. A real thumb is not a metronome: the first card is the hardest to let go
    // of and the last few dump in a rush, and two thumbs never drain their halves in
    // step. So the rungs `thumbRatchetKeyframes` returns are RETIMED here - the pose
    // maths (openThumb / openFingers / anchor per rung) stays in the shared helper and
    // only the schedule is authored, as t = W * u^POW with u = k/RUNGS:
    //
    //   * POW < 1 is concave, so successive rungs get CLOSER TOGETHER: the gaps run
    //     0.18 -> 0.065 of the window, a 2.8x acceleration across the release.
    //   * W is the window, and it is 0.55-0.62 rather than the helper's default
    //     0.7075 because that is when the cards are actually gone. The comment this
    //     replaces claimed the two matched; they did not - the hand went on ratcheting
    //     for a quarter of the beat after the last card had left.
    //   * The two hands get different W and POW, so the right half empties a little
    //     sooner. Real thumbs are never balanced, and one half always leads.
    //   * WOBBLE is an authored constant, not RNG. A lesson has to compile to the same
    //     track every time; the amplitude is held under half the smallest rung gap so
    //     the schedule stays monotone.
    //   * Each rung eases with `snapEase` (1-(1-t)^5), so it is a jump and a dwell -
    //     a click - rather than a glide between rungs.
    const RUNGS = 11
    const WOBBLE = [0, 0.02, -0.015, 0.02, -0.02, 0.015, -0.02, 0.01, -0.015, 0.02, -0.01, 0]
    const ratchetFor = (side) => {
      const leads = side === 'right'
      const win = leads ? 0.55 : 0.62
      const pow = leads ? 0.7 : 0.78
      const rungs = thumbRatchetKeyframes({
        gripPose: grip.pose,
        // A SUBTLE ratchet, expressed as a FRACTION of this grip's own solved curls
        // rather than an absolute open pose. Opening all the way to a fixed relaxed hand
        // was measured and it takes every pad off the cards that are still held: weave
        // contact 50% -> 0%. Releasing does mean letting go, but only of the cards that
        // have already left - a real hand stays on the ones it has not poured yet.
        openThumb: grip.pose.fingers.thumb.map((v) => v * 0.88),
        // THE FINGERS ROLL IN AS THE HALF DRAINS, which is why this is above 1 and not
        // below it. A packet welded to a pinch rides the weighted MEAN of the thumb and
        // middle pads, so a thumb ratcheting open drags the cards with it: measured, the
        // still-held cards slid 0.064 out of the middle pad across the release while the
        // thumb's own gap CLOSED by the same amount. A real hand follows the thinning
        // packet instead of letting it escape, and 8% more curl by the end of the beat is
        // what that costs. Swept 0.90 -> 1.12: the middle pad's time on the cards goes
        // 17% -> 40% at 1.08 with penetration untouched at 0.0142 and nothing pierced;
        // 1.12 pushes the weave's own penetration to 0.0178 and through the budget, so
        // this is the last safe rung, not a preference.
        openFingers: 1.08,
        // Continuous with the bend's closed-thumb pose, or the release starts with a jump.
        anchorFrom: outBy(0.02, CARD_H * 0.06),
        // RAISED 0.24 -> 0.55 OF A CARD LENGTH, and this is a CLIPPING trade, made
        // deliberately and against a metric. The rise was originally tuned against
        // FINGER penetration ("a hand must rise faster than the deck it is pouring
        // into grows"). It also decides how badly the CARDS clip, because the merged
        // stack forms in space the un-released halves still occupy: measured with
        // `cardClip.mjs`, raising it takes clipping from 3674 defect pair-frames to
        // 963 and the worst crossing from 22.7 card thicknesses to 19.8.
        //
        // What it costs, stated rather than hidden: released cards then fall further
        // with nothing on them, and their travel is horizontal-dominant rather than
        // downward-dominant, so `CAUSALITY_BUDGET.riffle` had to go 30% -> 32%. A
        // ratchet moved the wrong way to fix something a viewer can actually SEE.
        //
        // Two other directions were swept and rejected: `midBend` is irrelevant
        // (0.35 -> 0 moves the depth by 0.2 of a card), and CONVERGING the hands during
        // the weave - which is what a dealer does and what shortens the card flight -
        // takes the suite to 44-80 failures, because the closing hands press into the
        // pile they are building.
        //
        // NEITHER IS THE REAL FIX. 22.7 card thicknesses is the height of the packet
        // being crossed: one card passing clean through the other half. It happens
        // because an un-released card keeps its full footprint at its half's station
        // while the merged stack grows underneath it. The fix is the missing motion
        // primitive already named in ARCHITECTURE - a THINNING PACKET that tracks the
        // pads, so a draining half shrinks toward the junction instead of standing
        // full-size until its last card leaves. That is a compiler change, not a
        // lesson tuning, and it would remove the overlap rather than mitigate it.
        anchorTo: outBy(0.14, CARD_H * 0.16),
        // `spread`/`span` are deliberately NOT passed: they exist only to derive the
        // helper's window and every `at` it returns is overwritten below.
        steps: RUNGS,
        jitter: 0.025,
      })
      let prev = -1
      const out = rungs.map((kf, k) => {
        const u = k / RUNGS
        const w = k === 0 || k === RUNGS ? 0 : WOBBLE[(k + (leads ? 0 : 1)) % WOBBLE.length]
        const at = Math.min(1, Math.max(prev + 0.008, Math.min(win, win * (Math.pow(u, pow) + w))))
        prev = at
        return { ...kf, at, ease: 'snapEase' }
      })
      // ...and then the hand keeps relaxing after the last card has gone, instead of
      // freezing for the 40% of the beat the cards are still in flight. Also the only
      // keyframe here that RAISES the anchor further, which is safe in the one
      // direction that matters (see the rise note on the weave step).
      const tail = out[out.length - 1]
      out.push({
        at: 1,
        fingers: Object.fromEntries(
          Object.entries(tail.fingers).map(([n, a]) => [n, a.map((v) => v * (n === 'thumb' ? 0.9 : 0.97))]),
        ),
        anchor: outBy(0.16, CARD_H * 0.16),
        ease: 'easeOutCubic',
      })
      return out
    }
    const ratchet = { left: ratchetFor('left'), right: ratchetFor('right') }
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
        duration: 760,
        ease: 'easeInOutCubic',
        to: (dk) => merged(dk),
        // THE HANDS WALK IN HERE, which is both what the footage does (30s/65s: hands
        // poised at the sides of a squared deck, coming in from the dealer) and what
        // lets the CUT start with them already on the pack instead of chasing it.
        // NO HANDS ON THIS BEAT, and it was tried the other way. Walking them in onto the
        // squared deck is what the footage does (30s/65s) and it bought 86 of 104
        // causality samples, but the deck here is MID-ROTATION from portrait to landscape
        // and a hand solved against the landscape pack ends up 23 CARD THICKNESSES inside
        // it, plus the still deck under a moving hand took INERT_CONTACT from 6% to 14%.
        // A squared deck reads perfectly well on its own; the hands fly in on the cut.
        annotations: [{ text: 'Flat on the felt — this is the basic riffle', at: NOTE, appearAt: 0.2 }],
      },
      {
        // UNGRIPPED, and that is a RECORDED DEFEAT rather than a choice. The halves
        // separate along an authored path while the hands fly in to meet them, so the
        // deck cuts itself: the causality metric puts 709 of this lesson's 5092
        // moving-card samples in this one beat, the largest single block in the catalog.
        //
        // The footage says what should happen (refjobs.json, riffle 75s and 95s): the
        // dealer's hands are TOGETHER over the squared deck, then the halves are apart.
        // Two attempts to author that, both measured, both reverted:
        //
        //   1. GRIP BOTH HALVES over the squared deck, each hand carrying one out.
        //      Before the cut the halves are STACKED, not side by side, so two hands
        //      taking them occupy the same x at different heights - and two solved
        //      pinches at one station interpenetrate. Both middles 0.080 into the top
        //      card at t=0; 449 failures.
        //   2. ONE HAND takes the TOP half (26 cards up) and carries it out, the other
        //      flies in as before. Right middle distal 0.0212 into the deck at t=0;
        //      73 failures. The cause is geometric and is the same one that defeated
        //      a deleted overhand staging: an edge pinch WRAPS its packet, so its fingers need the
        //      space below the packet's bottom face - and over a squared deck the
        //      BOTTOM HALF is in exactly that space.
        //
        //   3. THE TABLE-TOP HOLD DOES NOT RESCUE IT EITHER, and this is the new result.
        //      Moving to `tableTopGrip` removed the wrap - nothing needs the space under
        //      the packet any more - so the obvious next step was two hands on the squared
        //      deck as at 95s. It is blocked by a DIFFERENT constraint, and the constraint
        //      is the same thumb MCP as fact (3) in this file's header: the thumb's knuckle
        //      is a fixed 0.505 inboard of the palm centre, so two hands whose THUMBS both
        //      want the middle of ONE deck have their thumb bases 0.03-0.30 apart against
        //      0.238 of capsule. Two hands cannot share a deck's centre line on this rig,
        //      whatever grip they wear.
        //
        // So this beat stays ungripped, and what was actually fixed is its CAUSALITY -
        // the hands are on their halves for far more of it (see the fly-in note below),
        // 626 of 1144 unmotivated samples down to 786 of 1144 at GAP 0.48... i.e. still
        // the lesson's worst step and still the honest place to look next. The fix that
        // would work is not a grip: it is the same THINNING PACKET primitive the weave
        // needs, plus a cut that carries the top half OFF to one side the way a dealer
        // actually does it, instead of splitting one deck symmetrically about its centre.
        kind: 'move',
        id: 'cut',
        label: 'Cut it into two halves, side by side',
        duration: 1040,
        ease: 'easeInOutCubic',
        to: (dk) => halves(dk, { apart: APART }),
        // THE FLY-IN IS CLOSER AND LOWER THAN IT WAS (0.55 out and CARD_H*0.42 up ->
        // 0.30 and 0.30), which is worth 340 causality samples. What motivates an
        // ungripped card is a hand ON it, and on this grip that job belongs to the THUMB:
        // its pad rides the near long edge at the packet's MID height, and a thumb capsule
        // there is inside the 0.05 drive band of every card in the stack, top to bottom.
        // So the sooner the hand is over its half, the more of this beat is motivated -
        // measured at GAP 0.52 the beat's unmotivated share went 626 of 1144 to 286.
        //
        // IT MUST NOT START ANY CLOSER THAN THIS, and that is measured too. Starting where
        // the thumbs are already on the still-SQUARED deck takes the beat to 149 of 1144,
        // and it also puts a hand solved against a 26-card half over a 52-card deck: the
        // index distal goes 0.046 = 15 CARD THICKNESSES into the top card. Re-solving the
        // pose on the pack (`squareGrip`) fixes the height and not the timing - the deck
        // is SHRINKING under the hand through this beat, so no single solve fits it.
        hands: {
          left: [
            { at: 0, pose: grip.pose, anchor: outBy(APART + 0.3, CARD_H * 0.3) },
            { at: 1, pose: grip.pose, anchor: outBy(APART), ease: 'easeInOutCubic' },
          ],
          right: [
            { at: 0, pose: grip.pose, anchor: outBy(APART + 0.3, CARD_H * 0.3) },
            { at: 1, pose: grip.pose, anchor: outBy(APART), ease: 'easeInOutCubic' },
          ],
        },
      },
      {
        // The grip starts here, hands already in place, so the captured offset is
        // the real hand-to-packet relationship.
        kind: 'move',
        id: 'address',
        label: 'Bring the inner ends together',
        duration: 900,
        ease: 'easeOutCubic',
        to: (dk) => halves(dk),
        grip: {
          left: { cards: 'firstHalf', frame: 'tableTop', pressure: [{ at: 0, v: SQUEEZE }, { at: 1, v: SQUEEZE }] },
          right: { cards: 'secondHalf', frame: 'tableTop', pressure: [{ at: 0, v: SQUEEZE }, { at: 1, v: SQUEEZE }] },
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
        duration: 1150,
        ease: 'easeInOutCubic',
        // THE BEND IS THE CARDS, not the hands. `bend` bows each half along its own
        // long axis, which runs from the fingers at the inner end to the thumb at the
        // outer one, and `bendGain` lets the gripped packet ride half of the rise a
        // bowed card gets - a bowed card rests on its ENDS, not its centre. Swept 0.25 /
        // 0.5 / 0.8 / 1.0: 0.25 measured best (address 61% against 56-59%), so the packet
        // rides only a quarter of the bow's rise.
        to: (dk) => halves(dk, { bend: BEND }),
        grip: {
          left: { cards: 'firstHalf', frame: 'tableTop', bendGain: 0.25, pressure: [{ at: 0, v: SQUEEZE }, { at: 1, v: SQUEEZE }] },
          right: { cards: 'secondHalf', frame: 'tableTop', bendGain: 0.25, pressure: [{ at: 0, v: SQUEEZE }, { at: 1, v: SQUEEZE }] },
        },
        // THE HANDS EASE OUTWARD BY 0.02 HERE, and the sign is the opposite of the
        // obvious one. The instinct is to close the thumbs on this beat, because 140s is
        // where they meet tip to tip - but the tip-to-tip already comes from the HALVES
        // being 0.48 apart rather than 0.52 (see GAP), and this beat is where the packet
        // bows and the ratchet's thumb starts to STRAIGHTEN, which extends the tip inward
        // on its own. Measured across the whole track: closing 0.03 here left the early
        // weave with +0.3mm of hand-versus-hand clearance; easing out 0.02 leaves +6.4mm
        // and the thumbs still read as meeting, because the packets brought them together.
        hands: {
          left: [{ at: 1, pose: grip.pose, anchor: outBy(0.02, CARD_H * 0.06), ease: 'easeInOutCubic' }],
          right: [{ at: 1, pose: grip.pose, anchor: outBy(0.02, CARD_H * 0.06), ease: 'easeInOutCubic' }],
        },
        annotations: [{ text: 'Bend firmly, never crease — that spring drives the whole shuffle', at: NOTE, appearAt: 0.25 }],
      },
      {
        kind: 'riffle',
        id: 'weave',
        label: 'Let them go — the ends interlace one at a time',
        order: gsrRiffleOrder,
        duration: 2100,
        ease: 'easeOutCubic',
        // The interlace stays TIGHT and LOW: on a table the cards fall onto the felt
        // rather than arcing through the air, so the lift is small and the mid-flight
        // bow is what is left of the spring straightening out.
        midBend: 0.35,
        arcLift: 0.04,
        // THE INTERLACED V, not a squared stack. See `woven` above.
        toLayout: (order) => woven(order, CLOSE),
        grip: {
          left: { cards: 'firstHalf', frame: 'tableTop', release: 'stagger', bendGain: 0.25, contacts: WEAVE_ON_CARDS, pressure: [{ at: 0, v: SQUEEZE }, { at: 1, v: 0.08 }] },
          right: { cards: 'secondHalf', frame: 'tableTop', release: 'stagger', bendGain: 0.25, contacts: WEAVE_ON_CARDS, pressure: [{ at: 0, v: SQUEEZE }, { at: 1, v: 0.08 }] },
        },
        // THE HANDS MUST RISE FASTER THAN THE DECK GROWS. The merged stack builds to
        // 52 * CARD_GAP = 0.156 in the middle of the weave, exactly where the fingers
        // are - they sit at the inner end because the thumb took the outer one. Rising
        // only CARD_H*0.1 (0.088) let the growing deck come up INTO them: penetration
        // climbed steadily across the beat, 0.0172 at the start to 0.0441 by the end,
        // and it was the right middle's distal every time. Rising CARD_H*0.24 and
        // easing further out takes the same beat to 0.0020.
        // A RATCHETING RELEASE, not two keyframes with an ease between them. The whole
        // point of this beat is that the cards leave ONE AT A TIME, so the hand has to
        // open progressively in step with them rather than gliding from closed to open:
        // `thumbRatchetKeyframes` walks the thumb and the four fingers out across the
        // release window in `steps` increments, with a little jitter so it reads as a
        // spring letting go rather than a linear interpolation.
        //
        // Its `openFingers` is not decoration. A ratcheting digit on a still-held packet
        // drags that packet across pads that are standing still and ends up inside the
        // cards it is pouring; letting the whole hand open as its half empties is both
        // the fix and what a real release looks like.
        //
        // The two sides get DIFFERENT arrays, not the same one twice: the rungs are
        // retimed per hand so the right half drains a little ahead of the left. See
        // `ratchetFor`.
        hands: {
          left: ratchet.left,
          right: ratchet.right,
        },
      },
      {
        // THE TELESCOPE, and it is its own beat now. 200s: ring and middle fingers drive
        // the two woven packets together along their LONG AXES until they are nearly
        // flush. This is a slide in the card plane, not a lift and a drop, and it is what
        // the lesson was missing between "interlaced" and "squared" - the old `push`
        // did both jobs in one snap.
        //
        // Ungripped: the weave's stagger has released every card, so nothing is welded
        // to a hand any more. The hands therefore have to stay ON the pack to motivate
        // it, which is also what the footage shows - the fingers are the reason it moves.
        // They sit at the OUTER ENDS of the merging pack rather than following the
        // packets all the way in: a fully merged deck is only CARD_H long, so a hand that
        // tracked its own half's centre would end up at the other hand's.
        kind: 'move',
        id: 'telescope',
        label: 'Telescope the two halves together',
        duration: 760,
        ease: 'easeOutCubic',
        to: (dk) => woven(dk, FLUSH),
        hands: {
          left: [{ at: 1, pose: squareGrip.pose, anchor: sqBy(0), ease: 'easeOutCubic' }],
          right: [{ at: 1, pose: squareGrip.pose, anchor: sqBy(0), ease: 'easeOutCubic' }],
        },
        annotations: [{ text: 'Ring and middle push them together — a zipper, not a fan', at: NOTE, appearAt: 0.2 }],
      },
      {
        // 210s: the index fingers come in last and run the short ends until the pack is
        // one landscape block. All that is left to take out is the residual 0.03 of
        // stagger and the dog-leg.
        kind: 'move',
        id: 'push',
        label: 'Run the edges square',
        duration: 700,
        ease: 'snapEase',
        to: (dk) => merged(dk),
        hands: {
          left: [{ at: 1, pose: squareGrip.pose, anchor: sqBy(0.03), ease: 'snapEase' }],
          right: [{ at: 1, pose: squareGrip.pose, anchor: sqBy(0.03), ease: 'snapEase' }],
        },
        annotations: [{ text: 'Square them up — telescoped together, not slammed', at: NOTE, appearAt: 0.2 }],
      },
      {
        // ---- THE BRIDGE, which is the other half of a riffle ------------------
        // A tabled riffle does not end when the cards interlace. The dealer cups the
        // woven pack at both short ENDS, squeezes it up into an arch, and lets it go:
        // the cards spring back down and FOLD together, riffling into a squared deck.
        // That release is the sound a riffle makes, and the lesson was stopping one
        // beat before it - it wove the halves, telescoped them, and squared them by
        // pushing, which is the tidy version of the move rather than the move.
        //
        // IT IS THE SAME PHYSICS AS THE OPENING BEND, and it is authored the same
        // way: `bend` bows every card along its own long axis (see fact 1 in the
        // header), and the pack's long axis runs end to end once it is merged, so one
        // bend arches the whole deck. The hands ride a quarter of the rise
        // (`bendGain: 0.25`, swept for the opening bend and reused here for the same
        // reason - a bowed card rests on its ENDS, so a hand welded to the full rise
        // ends up floating above the middle).
        kind: 'move',
        id: 'bridge',
        label: 'Cup both ends and bow it into a bridge',
        duration: 900,
        ease: 'easeOutCubic',
        to: (dk) => landscapeStackLayout(dk, { baseY: TABLE_Y + ARCH_LIFT, bend: ARCH }),
        // NO GRIP, and that is deliberate rather than lazy. `telescope` and `push`
        // before it declare none either: the fingers press the pack and the pack's
        // own layout says where it goes, which is the honest description of pushing
        // something that is lying on a table. A weld here is actively wrong - a
        // `tableTop` hold is solved against a FLAT pack, and welding it to a BOWED
        // one leaves every scored pad off the curved surface it is supposed to be on
        // (measured 12% in contact at a median gap of 0.059, which dragged the whole
        // lesson from 90% to 69% and did not respond to `bendGain` or to hand height,
        // because the gap is the curve, not the placement). The arch is the cards -
        // fact 1 in the header - so the cards are what describes it.
        // THE HANDS DO NOT CLOSE IN. The instinct is to squeeze them together - that
        // is what a real hand does - but on this rig the arch is made by the CARDS
        // (fact 1 in the header: `bend` bows each card along its own long axis), and
        // the inward axis is the one the riffle's entire thumb-clearance budget lives
        // on. Measured, closing 0.05 drove the two thumb tips 0.7 card thicknesses
        // INTO each other, against this lesson's hard-won 6.4mm clear. So the hands
        // only rise with the arch they are holding.
        hands: {
          left: [{ at: 1, pose: squareGrip.pose, anchor: sqBy(0, CARD_H * BLIFT), ease: 'easeOutCubic' }],
          right: [{ at: 1, pose: squareGrip.pose, anchor: sqBy(0, CARD_H * BLIFT), ease: 'easeOutCubic' }],
        },
        annotations: [{ text: 'Fingers under the ends, thumbs on top — squeeze it into an arch', at: NOTE, appearAt: 0.25 }],
      },
      {
        // …and let it go: the bend runs out to zero, which is the spring spending
        // itself, and the arch drops into a squared pack.
        //
        // NO `stagger`, AND THAT WAS A REAL ATTEMPT. Releasing the cards one after
        // another is what a bridge does, and it is the obvious way to make this read
        // as a riffling fold rather than a plank landing. It cannot be done by
        // staggering a stack: 52 cards 0.003 apart, each travelling a different
        // distance at a different time, pass through each other wholesale - measured
        // 1766 clipping pair-frames against a 480 budget, up to 8.9 card
        // thicknesses, plus 164 top-card swaps and a tripled inert-contact figure.
        // Same conclusion the overhand reached about dropped packets: a stack that
        // moves together is a stack that does not clip. The fold reads from the ARCH
        // FLATTENING - the ends coming down - not from card-by-card timing.
        kind: 'move',
        id: 'fold',
        label: 'Let it go — the cards fold down square',
        duration: 850,
        // Gravity accelerates, so the fall does too - and it keeps the cards high
        // while the hands are still opening out of the way.
        ease: 'easeInCubic',
        to: (dk) => merged(dk, 0),
        hands: {
          left: [
            { at: HOLD, pose: squareGrip.pose, anchor: sqBy(0, CARD_H * BLIFT) },
            { at: 1, pose: squareGrip.pose, anchor: sqBy(OUT, CARD_H * LIFT), ease: 'easeOutCubic' },
          ],
          right: [
            { at: HOLD, pose: squareGrip.pose, anchor: sqBy(0, CARD_H * BLIFT) },
            { at: 1, pose: squareGrip.pose, anchor: sqBy(OUT, CARD_H * LIFT), ease: 'easeOutCubic' },
          ],
        },
        annotations: [{ text: 'That fold is the riffle you can hear', at: NOTE, appearAt: 0.3 }],
      },
      {
        kind: 'move',
        id: 'rest',
        label: 'Shuffled, and squared on the felt',
        duration: 900,
        ease: 'easeInOutCubic',
        to: (dk) => stackLayout(dk, TABLE_Y),
        camera: 'overview',
        // OUT AND UP FIRST. Travelling straight to a resting position sweeps both
        // hands through the deck squaring up under them - the same crossing the
        // overhand's `rest` beat pays for.
        //
        // AND BOTH SIDES GET THE SAME SIGN, which they did not. Anchors here are in
        // RIGHT-hand coordinates and the engine negates x for the left, so the old
        // `left: outBy(-0.3)` / `right: outBy(+0.3)` pair did not mirror - it walked the
        // left hand 0.3 INWARD, straight over the deck it was supposed to be leaving,
        // while the right went out. `handClash` put this beat's worst pair here.
        hands: {
          left: [
            { at: 0.4, pose: grip.pose, anchor: outBy(0.3, CARD_H * 0.34), ease: 'easeOutCubic' },
            { at: 1, pose: grip.pose, anchor: outBy(0.7, CARD_H * 0.46), ease: 'easeInOutCubic' },
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
