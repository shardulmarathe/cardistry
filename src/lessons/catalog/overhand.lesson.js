import * as THREE from 'three'
import { faceQuat } from '../engine/layouts'
import { packetGrip } from '../authoring/contacts'
import { CARD_GAP, CARD_W } from '../../lib/constants'

// OVERHAND SHUFFLE - packets stripped off the top of the deck and stacked to the
// side, ONE HAND DOING THE WORK, everything on the felt.
//
// WHAT THIS REPLACED, AND WHY, because two earlier stagings are recorded here and
// neither should be reintroduced by accident.
//
//  1. A TOP PEEL. A hand closed on the deck's top card and dragged a packet off
//     it. It measured 8% fingertip contact with a median gap of 0.156 - a quarter
//     of a card width of AIR under the fingers that were supposedly moving the
//     cards - with the drawing hand entirely out of frame and the peeled packet
//     floating unsupported. It is still the thing to point at when someone says
//     "the fingers moving the top of the deck look weird": they looked weird
//     because they were not touching anything.
//
//  2. LIFT-THE-BULK-AND-DROP. The right hand took the whole pack into the air by
//     its long edges and let packets fall from its top onto a pile cradled in the
//     left. That fixed the contact problem outright (8% -> 100%) and it is the
//     staging the sourced mechanics describe. What it is NOT is what a viewer
//     reads as "taking cards off the deck": the deck leaves the table whole in the
//     first two seconds and everything after that happens in mid-air, so the move
//     the lesson is named for is never actually seen against a deck.
//
// THIS VERSION IS THE MOTION AS DESCRIBED: the deck stays squared on the felt, the
// right hand comes down on it, takes a packet off the TOP, carries it clear and
// stacks it on a pile beside it, and goes back for the next one. That reads at a
// glance, it is what the hand is doing, and it keeps every card on the table where
// the shot can hold both stations at once.
//
// ---------------------------------------------------------------------------
// THE GRIP IS A FACE GRIP FROM ABOVE (`packetGrip`), AND THAT IS FORCED.
//
// The obvious choice was the lift-and-drop staging's edge pinch - thumb on one long
// edge, middle wrapped onto the other - which measured 100% contact there and does
// again here (median 0.013-0.017, in band at every carry). It cannot be used, for a
// reason that is structural rather than tunable: AN EDGE GRIP ON A SUB-STACK REACHES
// INTO THE STACK UNDERNEATH IT. A packet lying on the deck shares its footprint
// exactly, so the edge plane the wrapping finger has to curl around at the packet's
// height is the same edge plane the rest of the deck occupies below it. Measured on
// the compiled track: `right middle[1]` 0.0957 into a card the hand does not claim
// to hold, one card pierced, and it did not move when the un-aimed fingers were
// straightened all the way to zero (swept 0.6 / 0.45 / 0.3 / 0.2 / 0.1 / 0 - the
// intrusion is identical at every one, because it is the AIMED middle's own middle
// capsule). That is the same class of failure as the top peel: a hand whose fingers
// are inside the cards it is not holding.
//
// `packetGrip` (a `tableGrip` on a squared portrait stack) presses its four pads
// onto the packet's TOP FACE and takes the FAR LONG EDGE with the thumb, so nothing
// ever needs to pass below the packet's base - and its builder already solves the
// exact case this lesson is made of. From its own source: "a pile whose `baseY` is
// off the table is standing on ANOTHER pile", so it runs `resolvePenetration`
// against a solid column from the felt all the way up, not just against the block
// it is holding. The grip that looks like reaching down and taking cards off the
// top of a deck is also the only one here that can.
//
// SOLVED PER PACKET, not once. The thumb takes the far edge half way up the block
// and the column below it differs every time (the deck thins as the pile grows), so
// a single solve translated in y would be a solve against a column that is no
// longer there. Four to six `tableGrip` solves is single-digit milliseconds; the
// thing that is expensive in this file's history is `cradleGripAuto`'s 108-cell
// sweep, not a grip builder.
//
// ---------------------------------------------------------------------------
// THE THREE THINGS THIS STAGING HAS TO GET RIGHT, and how each is handled.
//
// A. THE HAND MUST NOT DESCEND THROUGH THE PILE IT IS STACKING ONTO. The pinch
//    wraps the packet's far long edge, so the wrapped fingers hang below the
//    packet's base - and at the destination whatever is below the packet's base is
//    the pile. So THE PACKET IS NEVER PLACED, IT IS RELEASED: the carry ends with
//    the packet hovering `HOVER` above the pile's top card, the hand lets go there,
//    and the packet drops the last sliver on its own while the hand goes back for
//    the next one. A released card that is moving downward reads as `gravity` to
//    the causality gate, so this is motivated motion rather than a card sliding
//    itself, and it is what a hand actually does.
//
// B. THE TWO STATIONS MUST BE DISJOINT IN ONE AXIS. A packet in transit must not
//    pass through the block it just left. Two axis-aligned rectangles are disjoint
//    only if they are separated on ONE axis, and for a portrait deck that is
//    CARD_W (0.63) in x or CARD_H (0.88) in z. x is the cheap one here (the carry
//    is a sideways move and the camera is wider than it is deep), so the stations
//    are a full card width plus clearance apart in x and share z.
//
// C. NOTHING MOVES WITHOUT A HAND ON IT. The source station is the CENTRE, where
//    the engine already seeds a squared deck, and it is there for the causality
//    gate rather than for the composition: the first draft opened by sliding the
//    whole deck sideways to a station of its own, and 676 samples of that one beat
//    came back UNMOTIVATED - 52 cards travelling across the felt with both hands
//    clear of them, which is the "cards sliding themselves" failure the gate exists
//    to catch (50% of the lesson's moving samples, budget 8%). A packet released
//    above the pile falls, which reads as `gravity`; everything else in the lesson
//    is either gripped or standing still.
//
// D. THE SHUFFLE MUST END AS ONE SQUARED STACK ON THE FELT. `mixing.js` recovers
//    the deck order by sorting a squared stack by height and REFUSES to read a
//    spread one (SQUARE_SPREAD is 0.012), so a lesson that ends with cards at two
//    stations reports "deck is spread" and the mixing dock shows the order from
//    before the shuffle. So the last beat is the hand SLIDING the finished pile
//    back to the middle - gripped, because of (C), and true to the move: squaring
//    up and pulling the deck back is how a pass ends.
//
// E. A BLOCK FALLS AS A BLOCK. The drops were authored with `stagger: {by:'card'}`
//    at first, which staggers each card of a packet in time - and a packet's cards
//    share one footprint, so staggering them makes them cross each other's planes
//    on the way down. Cards are zero-thickness planes that cast no shadow on each
//    other, so occlusion is the ONLY cue that one is above another, and inverting
//    it for a frame is visually indistinguishable from two cards passing through
//    each other. Measured: 270 top-card swaps at 29.7/s with the worst covering 55%
//    of a card face, against a 230 budget. A released packet is a rigid block and
//    falls as one.
//
// ---------------------------------------------------------------------------
// MEASURED, against the staging it replaces (both on run 0, `npm run verify`):
//
//                          lift-and-drop      this
//   contact                100% of 562        100% of 300  (median 0.014 both)
//   finger-in-card         0.0034 (1.1 cards) 0.0001 (0.0 cards)
//   cards pierced          0                  0
//   card-vs-card clip      0.0000, 0 pairs    0.0000, 0 pairs
//   top-card swaps         221 = 17.5/s       0
//   inert contact          18%                17%
//   unmotivated motion     5%                 1%
//   duration               12.6s              8.6s
//
// EVERY REPEAT SEED IS CHECKED, not just the one the harness compiles. Packet sizes
// are drawn from the RNG, so "Shuffle again" produces a different set of blocks each
// time and `verify` only ever sees run 0 - which would leave the geometry of every
// other run unverified. Swept runs 0-7: worst finger-in-card 0.0000 and 0 cards
// pierced at every one, contact 100% throughout, 11 steps except run 2 which draws
// five packets instead of four. The grip is solved per packet at that packet's own
// thickness, which is why the size can vary at all.
export const overhandLesson = {
  id: 'overhand',
  title: 'Overhand Shuffle',
  technique: 'overhand',
  randomizes: 'Weak',
  seed: 11,
  // ONE SHOT FOR THE WHOLE LESSON, which is new: the lift-and-drop staging had to
  // pan from `dealerPOV` up to `overhandBulk` because its subject left the table.
  // Everything here happens between y 0.02 and the carry arc, so one table preset
  // holds it - and a lesson whose camera never moves is a lesson where the only
  // thing moving is the hand.
  cameraPreset: 'dealerPOV',
  summary:
    'The everyday shuffle: take a packet off the top of the deck, drop it on a pile to the side, and repeat until the deck is gone. Easy to do — but it only moves blocks, so it barely randomizes.',
  facts: [
    'Rigorously, it can take on the order of 2,500 overhand shuffles to truly randomize 52 cards — versus about 7 riffles.',
    'The overhand only transports blocks, so cards that start together tend to stay together.',
  ],
  build: (deck, ctx) => {
    const rng = ctx?.rng ?? Math.random

    // ---- STATIONS -----------------------------------------------------------
    const TABLE_Y = 0.02
    const CQ = faceQuat(false) // portrait, face down - see the header
    // The deck stays where the engine seeds it; the pile goes to the side, a full
    // card width plus clearance away in x, sharing z. See (B) and (C).
    const SRC = { x: 0, z: 0 }
    const DST = { x: CARD_W + 0.22, z: 0 }
    // Height the packet's BASE travels at between the stations. It has to clear the
    // taller of the two stacks (52 cards is 0.153) by more than a card's own size so
    // the crossing never reads as a graze; 0.46 also keeps the whole subject inside
    // `dealerPOV`, which aims at y 0.35.
    const CARRY_Y = 0.46
    // Release height above the pile's top card. See (A): the hand lets go here
    // rather than descending, because it would otherwise have to bring its own
    // fingers down alongside the pile it is stacking onto.
    const HOVER = 0.085
    // SWEPT, not chosen. `squeezeAir` moves every contact target off its surface as
    // the squeeze rises, and the wrist anchor is DERIVED from the thumb target, so
    // the whole placement shifts with it - the thumb's gap here is almost entirely
    // squeeze air. Measured on the compiled track, per-finger:
    //
    //   squeeze  thumb          index   middle  ring    pinky      worst pen
    //     0.30   0%  (0.071)    100%    100%    100%    0% (.117)  0.0003
    //     0.22   0%  (0.062)    100%    100%    100%    0% (.118)  0.0000
    //     0.14   0%  (0.033)    100%    100%    100%    0% (.119)  0.0000
    //     0.10   ~0% (0.030)    100%    100%    100%    0% (.119)  0.0000   <- this
    //     0.08   37% (0.027)    100%    100%    100%    0% (.119)  0.0000
    //     0.02   68% (0.021)    100%    100%    100%    0% (.120)  0.0000
    //
    // 0.10 is the largest squeeze that still leaves the thumb visually ON the edge
    // (0.030 is 3mm at this scale) while the three scored pads sit at a median of
    // 0.011-0.014 in a 0.025 band. Going lower buys the thumb a contact percentage
    // and costs the grip its visible close - and `pressure` is what makes a hand
    // look like it is holding something, which is the whole reason to carry any.
    const SQ_FACE = 0.1

    // ---- PACKETS AND THE ORDER ---------------------------------------------
    // A RANDOM 6-20 CARDS PER PACKET, drawn from the lesson's own seeded RNG so
    // every "Shuffle again" strips the deck differently (the compiler offsets the
    // seed by the repeat index) while a single run stays reproducible for the verify
    // harness. Fixed sizes were the previous version's choice and two reviewers
    // called five equal packets a metronome; a range this wide gives 3-6 packets of
    // visibly different thickness.
    const MIN_PACKET = 6
    const MAX_PACKET = 20
    // WHATEVER IS LEFT JOINS THE LAST PACKET, which is the deck-integrity rule
    // `splitIntoRandomBlocks` records: anything else silently drops cards, and the
    // harness asserts 52 unique in and 52 out. Folding the remainder into the packet
    // before it (rather than letting it become a runt) also means no packet is ever
    // thinner than MIN_PACKET, which is the range the grip is solved across.
    const sizes = []
    let left = deck.length
    while (left > 0) {
      const want = MIN_PACKET + Math.floor(rng() * (MAX_PACKET - MIN_PACKET + 1))
      const take = Math.min(want, left)
      if (left - take < MIN_PACKET) {
        sizes.push(left)
        left = 0
      } else {
        sizes.push(take)
        left -= take
      }
    }

    // PACKETS COME OFF THE TOP AND GO ON TOP, and this is the one thing that decides
    // whether the lesson's own claim is true. An overhand REVERSES the order of its
    // blocks, and that requires source-top -> destination-top. Sliding each packet
    // UNDER the pile instead would append every block in its original order and
    // collapse the whole shuffle to a single CUT however many packets moved.
    // `mixing.js` reads the deck order back out of the card POSES, so the staging IS
    // the claim - there is no way to author a reversal the geometry does not perform.
    const packets = []
    let remaining = deck.slice()
    for (const s of sizes) {
      packets.push(remaining.slice(remaining.length - s))
      remaining = remaining.slice(0, remaining.length - s)
    }
    const finalOrder = packets.flat()

    // ---- GRIPS --------------------------------------------------------------
    // One solve per gripped block, at that block's own base height and thickness.
    // See the header for why this is a face grip and why it is not solved once.
    const gripFor = (count, baseY, centerX = SRC.x, centerZ = SRC.z) =>
      packetGrip({
        centerX,
        centerZ,
        baseY,
        deckH: (count - 1) * CARD_GAP,
        squeeze: SQ_FACE,
      })
    // Anchors are TRANSLATED, never re-solved, within one block's handling: the pose
    // is translation invariant in x and z, and the only y move it makes is upward,
    // away from every card it was resolved against.
    const moved = (a, dx, dy, dz) => [a[0] + dx, a[1] + dy, a[2] + dz]
    // THE APPROACH IS OVER THE BLOCK, NEVER THROUGH IT. A straight slide in crosses
    // the block's own footprint at the block's own height; the hand arrives HIGH and
    // descends only once it is above where it is going. The descent is also kept
    // LATE in each beat, because a hand hovering over motionless cards is what the
    // inert-contact gate counts (`take-2` alone contributed 101 samples of it).
    const OVER = 0.34
    const overOf = (a) => [a[0], a[1] + OVER, a[2]]

    // The whole deck, and the whole finished pile, each need a grip: one to be over
    // at the start, one to slide the pile home at the end.
    const openGrip = gripFor(deck.length, TABLE_Y)
    const pileGrip = gripFor(deck.length, TABLE_Y, DST.x, DST.z)
    const restKey = (at, anchor, extra) => ({ at, pose: openGrip.pose, anchor, ...extra })
    // Where the hand waits before the first take and retires to at the end: out to
    // its own side, up, and toward the camera, so the opening and closing frames are
    // a deck on the felt rather than a hand parked on it.
    const WAIT = moved(openGrip.anchor, -0.34, 0.4, 0.44)

    // ---- LAYOUTS ------------------------------------------------------------
    // Stacks are anchored by their BOTTOM card, which is what every grip builder's
    // `baseY` means and what the layouts in this catalog already do.
    const slot = (x, y, z) => ({ pos: new THREE.Vector3(x, y, z), quat: CQ, bend: 0 })
    const blockAt = (cards, x, baseY, z) =>
      cards.map((c, i) => ({ id: c.id, ...slot(x, baseY + i * CARD_GAP, z) }))

    const steps = []
    let onPile = 0 // cards already stacked at the destination
    let inDeck = deck.length // cards still at the source
    let pending = null // the packet released last beat, still falling

    packets.forEach((packet, k) => {
      const packetBase = TABLE_Y + (inDeck - packet.length) * CARD_GAP
      const grip = gripFor(packet.length, packetBase)
      const key = (at, anchor, extra) => ({ at, pose: grip.pose, anchor, ...extra })
      const takeAnchor = grip.anchor
      const restBase = TABLE_Y + onPile * CARD_GAP
      const hoverBase = restBase + HOVER
      // The same hand at the destination, by pure translation.
      const dstAnchor = (base) =>
        moved(grip.anchor, DST.x - SRC.x, base - packetBase, DST.z - SRC.z)
      const drop = pending

      steps.push({
        // The FIRST take moves no cards at all - the hand simply comes down on a
        // deck that is already where it belongs - so it is a `hold`. Every later
        // take carries the previous packet's drop, which makes it a `move`.
        kind: drop ? 'move' : 'hold',
        id: `take-${k}`,
        label: k === 0 ? 'Take a packet off the top' : 'Back for another packet',
        duration: k === 0 ? 700 : 560,
        // The falling packet accelerates while the hand travels evenly, so the fall
        // gets its own curve. Same rule as everywhere else in this catalog: when two
        // things have to pass each other, separate their motions in time.
        ease: 'easeInOutCubic',
        yEase: 'easeInCubic',
        // Only the released packet moves, and it moves as ONE BLOCK - see (E).
        // Everything else holds its pose, so a partial `to` is the honest statement
        // of what this beat does.
        ...(drop ? { to: () => blockAt(drop.cards, DST.x, drop.baseY, DST.z) } : {}),
        hands: {
          right:
            k === 0
              ? [
                  restKey(0, WAIT),
                  key(0.62, overOf(takeAnchor), { ease: 'easeInOutCubic' }),
                  key(1, takeAnchor, { ease: 'easeOutCubic' }),
                ]
              : [
                  // Leaves the pile UPWARD before it travels, so the empty hand does
                  // not sweep sideways through the packet it has just let go of.
                  key(0, dstAnchor(drop.releaseBase)),
                  key(0.26, overOf(dstAnchor(drop.releaseBase)), { ease: 'easeOutCubic' }),
                  key(0.78, overOf(takeAnchor), { ease: 'easeInOutCubic' }),
                  key(1, takeAnchor, { ease: 'easeOutCubic' }),
                ],
        },
        ...(k === 0
          ? {
              annotations: [
                {
                  text: 'Four fingers on the top face, thumb at the edge — the top few cards only',
                  appearAt: 0.6,
                },
              ],
            }
          : {}),
      })

      // The carry. The packet rides the hand rigidly, so the hand's arc IS the
      // packet's path, and the layout below only has to agree with where the hand
      // finishes - which it does exactly, both being translations of one solve.
      steps.push({
        kind: 'move',
        id: `carry-${k}`,
        label: k === packets.length - 1 ? 'The last packet goes over' : 'Carry it to the side',
        duration: 880,
        ease: 'easeInOutCubic',
        to: () => blockAt(packet, DST.x, hoverBase, DST.z),
        grip: {
          right: {
            cards: packet.map((c) => c.id),
            frame: 'packet',
            // THREE SCORED SURFACES OF FIVE, and both omissions are measured rather
            // than convenient. `verify` prints the scored set precisely so that
            // narrowing it cannot be done quietly:
            //
            //   index / middle / ring  100% in contact, median 0.013-0.014  <- scored
            //   thumb                  0.030 off the far long edge          <- not
            //   pinky                  0.119 off, trailing past the block    <- not
            //
            // The THUMB's gap is structural, not a tuning miss. `tableGrip` aims it
            // at the far long edge half way up the block and hangs its distal
            // capsule below that pad - and on a SUB-STACK, below the block's base is
            // the rest of the deck, so `resolvePenetration` backs the thumb out
            // until that capsule is clear of a solid column (the builder's own
            // comment says exactly this). A thumb that touched here would be a thumb
            // inside cards it is not holding, which is the failure this rebuild
            // exists to remove.
            // The PINKY is the case `tableGrip` documents: "a pad the pile has run
            // out under still rides the card's PLANE", so the outer fingers trail
            // off the end instead of stabbing at the felt.
            // Scoring either would be the `indexPivot` mistake recorded in
            // ARCHITECTURE.md - a fingertip 0.9 from its packet counted as a gripper
            // on every frame.
            contacts: { index: {}, middle: {}, ring: {} },
            // Closes to carry and eases off as the hand lets go.
            pressure: [
              { at: 0, v: SQ_FACE },
              { at: 0.82, v: SQ_FACE },
              { at: 1, v: SQ_FACE * 0.45 },
            ],
          },
        },
        hands: {
          right: [
            key(0, takeAnchor),
            key(0.34, moved(takeAnchor, 0, CARRY_Y - packetBase, 0), { ease: 'easeOutCubic' }),
            key(0.7, moved(dstAnchor(hoverBase), 0, CARRY_Y - hoverBase, 0), {
              ease: 'easeInOutCubic',
            }),
            key(1, dstAnchor(hoverBase), { ease: 'easeInOutCubic' }),
          ],
        },
        ...(k === 0
          ? {
              annotations: [
                {
                  text: 'Each packet lands on TOP of the last — which is why the blocks come out reversed',
                  appearAt: 0.5,
                },
              ],
            }
          : {}),
      })

      inDeck -= packet.length
      onPile += packet.length
      pending = {
        cards: packet,
        baseY: restBase,
        releaseBase: hoverBase,
        anchor: dstAnchor(hoverBase),
        pose: grip.pose,
      }
    })

    // The last packet settles while the hand comes down onto the finished pile. Two
    // things at once, and they do not fight: the packet falls under gravity from
    // HOVER, and the hand's own descent is staged after it (see the keys).
    steps.push({
      kind: 'move',
      id: 'gather',
      label: 'Square the pile up',
      duration: 760,
      ease: 'easeInOutCubic',
      yEase: 'easeInCubic',
      to: () => blockAt(pending.cards, DST.x, pending.baseY, DST.z),
      reorder: () => finalOrder,
      hands: {
        right: [
          { at: 0, pose: pending.pose, anchor: pending.anchor },
          {
            at: 0.4,
            pose: pending.pose,
            anchor: overOf(pending.anchor),
            ease: 'easeOutCubic',
          },
          {
            at: 1,
            pose: pileGrip.pose,
            anchor: pileGrip.anchor,
            ease: 'easeInOutCubic',
          },
        ],
      },
    })

    // Home. See (D): the pile has to finish as one squared stack, and see (C): it
    // cannot walk there by itself.
    steps.push({
      kind: 'move',
      id: 'home',
      label: 'Bring it back to the middle',
      duration: 820,
      ease: 'easeInOutCubic',
      to: () => blockAt(finalOrder, SRC.x, TABLE_Y, SRC.z),
      grip: {
        right: {
          cards: finalOrder.map((c) => c.id),
          frame: 'packet',
          contacts: { index: {}, middle: {}, ring: {} },
          pressure: [
            { at: 0, v: SQ_FACE },
            { at: 0.85, v: SQ_FACE },
            { at: 1, v: SQ_FACE * 0.4 },
          ],
        },
      },
      hands: {
        right: [
          { at: 0, pose: pileGrip.pose, anchor: pileGrip.anchor },
          {
            at: 1,
            pose: pileGrip.pose,
            anchor: moved(pileGrip.anchor, SRC.x - DST.x, 0, SRC.z - DST.z),
            ease: 'easeInOutCubic',
          },
        ],
      },
    })

    steps.push({
      kind: 'hold',
      id: 'rest',
      label: 'Shuffled — one pass through',
      duration: 1100,
      hands: {
        right: [
          {
            at: 0,
            pose: pileGrip.pose,
            anchor: moved(pileGrip.anchor, SRC.x - DST.x, 0, SRC.z - DST.z),
          },
          {
            at: 0.45,
            pose: pileGrip.pose,
            anchor: overOf(moved(pileGrip.anchor, SRC.x - DST.x, 0, SRC.z - DST.z)),
            ease: 'easeOutCubic',
          },
          restKey(1, WAIT, { ease: 'easeInOutCubic' }),
        ],
      },
      annotations: [
        {
          text: 'Blocks moved as blocks — the cards that started together are still together',
          appearAt: 0.3,
        },
      ],
    })

    return steps
  },
}
