import * as THREE from 'three'
import { stackLayout, faceQuat } from '../engine/layouts'
import { edgePinchGripAuto } from '../authoring/contacts'
import { CARD_GAP } from '../../lib/constants'

// OVERHAND shuffle, re-modelled as the move real shufflers make.
//
// WHAT THIS REPLACES AND WHY. The shipping version models a top PEEL: a hand
// closes on the deck's top card and draws a packet off it. The sourced mechanics
// (TECHNIQUE_REFERENCE.md) say that is not the move - "most of the cards are
// grasped as a group from the BOTTOM of the pack between the thumb and fingers of
// the right hand and lifted clear of the small group that remains in the left",
// then "small packets are released from the right hand a packet at a time so that
// they drop on the top of the pack accumulating in the left". The bulk moves once;
// the packets fall.
//
// It also measures badly, and for a reason the in-hands riffle turned out to share:
// 8% contact with the drawing hand's wrist a full card length above where its pads
// belong. That hand grips the packet by its TOP FACE and then pulls the packet out
// from UNDER those pads, so the pads sit in the release path and the wrist has
// nowhere to be but above everything.
//
// SO BOTH HANDS HOLD THEIR PACKET BY ITS LONG EDGES here, which is the grip that
// took the riffle's release from 0.074 to 0.015 at 90% contact. Two properties
// matter and both are load-bearing:
//   * A hand gripping edges sits BESIDE its packet, not above it, so nothing has to
//     be lifted out of the way and no wrist runs away upward.
//   * The release path is DOWNWARD, and the pads are on the sides. Cards leave the
//     bottom of the bulk and fall to the pile without passing through anything.
//
// And the rule the riffle paid for twice: A GRIPPED PACKET GOES WHERE THE HAND
// GOES. Every packet position here comes from a hand anchor. The authored `to`
// layouts only have to AGREE with the hands at the instant a grip is captured.
// STATUS: WORK IN PROGRESS, deliberately NOT wired into `catalog/index.js`. The
// shipping overhand stays until this beats it outright.
//
//                      contact   median gap   worst penetration
//   shipping (peel)       8%        0.156         0.0079
//   this (re-modelled)   82%        0.019         0.0905
//
// Contact is a tenfold improvement and the median gap is eight times tighter, which
// says the hands are genuinely on the cards for the first time in this lesson. The
// penetration is NOT acceptable yet and is the whole remaining job.
//
// Four causes were found and fixed, in order of how much they cost:
//
//   1. THE MIRROR. Worth 20% -> 82% contact on its own. Anchors are authored in
//      RIGHT-hand coordinates and the engine negates x for the left hand, so a grip
//      solved beside a packet at x = -0.28 put the left hand at +0.28, on the far
//      side of the table from the cards it was holding - wrist measured at +0.16
//      with its packet at -0.28. The mirror is only free when the CARDS are mirrored
//      too, which is why it was free for the riffle (its halves are mirror images)
//      and not here. The left grip is now solved at its packet's mirror image.
//   2. EACH HAND MUST RIDE ITS PACKET'S SIZE. The pile grows 15 -> 52 cards and the
//      bulk empties, so a hand left at one anchor gets buried by the difference.
//      Worth 9% -> 20% and median 0.118 -> 0.036.
//   3. The grips are solved for the LARGEST packet each will ever hold, not an
//      average: a pinch's wrap is sized to the stack it was solved against.
//   4. Layouts anchor stacks by their BOTTOM, because that is what
//      `edgePinchGrip`'s `baseY` means and the layout has to agree with the solve.
//      Anchoring by the top was tried and rejected (0.1057 -> 0.1056): it only moved
//      the disagreement to the other end.
//
// WHAT IS LEFT: ~0.09 of penetration at every beat, now the left thumb rather than
// the middle. Both hands hold packets barely 0.4 apart in a move where they close on
// each other, so the next suspect is hand-versus-OTHER-packet rather than
// hand-versus-own, which `scripts/inspect/deepFrame.mjs` reports directly (it names
// the packet each hit belongs to). Do not wire this in until it is under ~0.01.
export const overhandNewLesson = {
  id: 'overhand',
  title: 'Overhand Shuffle',
  technique: 'overhand',
  randomizes: 'Weak',
  seed: 11,
  cameraPreset: 'inHands',
  summary:
    'The everyday shuffle: lift most of the deck away in one hand, then let small packets drop back onto the pile in the other. Easy to do — but it only moves blocks, so it barely randomizes.',
  facts: [
    'Rigorously, it can take on the order of 2,500 overhand shuffles to truly randomize 52 cards — versus about 7 riffles.',
    'The overhand only transports blocks, so cards that start together tend to stay together.',
  ],
  build: (deck) => {
    const N = deck.length
    // Both packets live in the air, the bulk above and slightly behind the pile so
    // packets fall down and forward onto it. The z offset is what keeps the two
    // hands, each sitting BESIDE its own packet, out of each other.
    const PILE = { x: -0.28, y: 0.92, z: 0.0 }
    const BULK = { x: -0.28, y: 1.34, z: 0.34 }
    const SQUEEZE = 0.3
    // Real overhand cadence: a packet every ~200ms, and packets of UNEVEN size.
    // Deliberately a fixed uneven pattern rather than equal blocks: a real shuffler
    // drops irregular clumps, and equal repeats are exactly the metronome this
    // catalog was criticised for. Summed against the bulk below, so the last packet
    // takes the remainder whatever the deck size.
    const PATTERN = [8, 6, 9, 7, 6]

    const pinchAt = (c, count) =>
      edgePinchGripAuto({
        centerX: c.x,
        centerZ: c.z,
        baseY: c.y,
        deckH: Math.max(0, (count - 1) * CARD_GAP),
        squeeze: SQUEEZE,
        cardQuat: faceQuat(false),
        axis: 'long',
      })

    // One solve per hand, at its representative height. Packets change size through
    // the shuffle, but re-solving per beat would return different curls and walk the
    // cards under the pads holding them, so both hands keep one solve throughout and
    // only their ANCHORS move - the same discipline the riffle needed.
    // SOLVE EACH GRIP FOR THE LARGEST PACKET IT WILL EVER HOLD, not an average.
    // A pinch's finger wrap is sized to the stack it was solved against, so a grip
    // solved for a 15-card pile and then asked to hold 52 has 0.111 of extra
    // thickness pressing into the proximal segments that do the wrapping: measured,
    // the left middle's proximal sat 0.1056 inside the cards, which is its own radius
    // (0.104) plus half a card - the full-radius charge that means a capsule CENTRE
    // is on a card's mid-plane. Sized for the maximum, a smaller packet is merely
    // held more loosely, which costs contact and never penetration.
    const BULK_N0 = Math.round(N * 0.72)
    const PILE_N0 = N
    const bulkGrip = pinchAt(BULK, BULK_N0)
    // THE LEFT HAND'S GRIP IS SOLVED AT THE MIRROR OF ITS PACKET'S POSITION, and
    // this is the mirror rule doing exactly what it says. Anchors are authored in
    // RIGHT-hand coordinates and the engine negates x for the left hand, so a grip
    // solved beside a packet at x = -0.28 puts the left hand at x = +0.28 - on the
    // far side of the table from the cards it is meant to be holding. Measured, the
    // wrist landed at x +0.16 with its packet at -0.28 and the middle finger's
    // proximal 0.1056 inside the OTHER packet.
    //
    // The mirror is only free when the CARDS are mirrored too (which is why it was
    // free for the riffle, whose halves are mirror images). Here the pile sits at one
    // specific world x, so the solve has to be done at its mirror image.
    const pileGrip = pinchAt({ ...PILE, x: -PILE.x }, PILE_N0)

    const at = (g, dy) => [g.anchor[0], g.anchor[1] + dy, g.anchor[2]]
    // EACH HAND RIDES ITS PACKET'S SIZE. Both packets stack upward from a fixed
    // bottom, because that is what `edgePinchGrip`'s `baseY` means and the layout has
    // to agree with the solve. But the pile GROWS (15 -> 52 cards) and the bulk
    // EMPTIES, so a hand left at one anchor ends up buried: measured, the left
    // middle's proximal capsule sat 0.105 inside the cards at every beat after the
    // lift, which is exactly the CARD_GAP the pile gains.
    //
    // Anchoring the layout by the TOP card instead was tried and did NOT fix it
    // (0.1057 -> 0.1056), because it only moved the disagreement to the other end:
    // the solve still expected its stack to start at baseY. The relationship that
    // has to be constant is hand-to-packet, so the HAND moves by the size delta -
    // which is also what a real hand does, riding up as the pile grows under it and
    // down as the bulk empties.
    const rideY = (g, count, solvedCount) => [
      g.anchor[0],
      g.anchor[1] + (count - solvedCount) * CARD_GAP,
      g.anchor[2],
    ]
    const layoutOf = (heldByBulk, heldByPile) => {
      const out = []
      heldByPile.forEach((c, i) =>
        out.push({
          id: c.id,
          pos: new THREE.Vector3(PILE.x, PILE.y + i * CARD_GAP, PILE.z),
          quat: faceQuat(false),
          bend: 0,
        }),
      )
      heldByBulk.forEach((c, i) =>
        out.push({
          id: c.id,
          pos: new THREE.Vector3(BULK.x, BULK.y + i * CARD_GAP, BULK.z),
          quat: faceQuat(false),
          bend: 0,
        }),
      )
      return out
    }

    const steps = []
    // The deck starts squared in the left hand, held by its edges.
    steps.push({
      kind: 'hold',
      id: 'square',
      label: 'The whole deck in one hand',
      duration: 460,
      hands: { left: [{ at: 1, pose: pileGrip.pose, anchor: pileGrip.anchor }] },
      annotations: [{ text: 'Held by the long edges — thumb one side, fingers the other', appearAt: 0.25 }],
    })

    // THE LIFT: the right hand takes the bulk from below and carries it clear. This
    // is the move's one big motion; everything after it is packets falling.
    let inBulk = deck.slice(N - Math.round(N * 0.72))
    let inPile = deck.slice(0, N - inBulk.length)
    steps.push({
      kind: 'move',
      id: 'lift',
      label: 'Grasp most of the deck from below and lift it clear',
      duration: 620,
      ease: 'easeInOutCubic',
      to: () => layoutOf(inBulk, inPile),
      hands: {
        left: [{ at: 1, pose: pileGrip.pose, anchor: rideY(pileGrip, inPile.length, PILE_N0) }],
        right: [
          { at: 0, pose: bulkGrip.pose, anchor: at(bulkGrip, -0.34) },
          { at: 1, pose: bulkGrip.pose, anchor: rideY(bulkGrip, inBulk.length, BULK_N0), ease: 'easeOutCubic' },
        ],
      },
      annotations: [{ text: 'The BULK moves once — after this, only packets fall', appearAt: 0.3 }],
    })

    // THE PACKETS: each beat releases one block from the bottom of the bulk; it
    // falls onto the pile. Both grips persist across every beat, so they are
    // captured once and the packets ride the hands the whole way.
    let taken = 0
    PATTERN.forEach((size, k) => {
      const falling = inBulk.slice(0, Math.min(size, Math.max(0, inBulk.length - 2)))
      const restBulk = inBulk.slice(size)
      const newPile = [...inPile, ...falling]
      steps.push({
        kind: 'move',
        id: `drop-${k}`,
        label: k === 0 ? 'Let a packet drop onto the pile' : 'And another',
        duration: 230,
        ease: 'snapEase',
        to: () => layoutOf(restBulk, newPile),
        stagger: { by: 'card', spread: 0.4, span: 0.5 },
        grip: {
          left: { cards: inPile.map((c) => c.id), frame: 'pinch', pressure: [{ at: 0, v: SQUEEZE }, { at: 1, v: SQUEEZE }] },
          right: { cards: inBulk.map((c) => c.id), frame: 'pinch', release: 'stagger', pressure: [{ at: 0, v: SQUEEZE }, { at: 1, v: SQUEEZE }] },
        },
        hands: {
          left: [{ at: 1, pose: pileGrip.pose, anchor: rideY(pileGrip, newPile.length, PILE_N0) }],
          // The bulk's hand descends as it empties, which keeps the fall short and
          // closes the two hands on each other the way they do in life.
          right: [{ at: 1, pose: bulkGrip.pose, anchor: rideY(bulkGrip, restBulk.length, BULK_N0) }],
        },
      })
      inBulk = restBulk
      inPile = newPile
      taken += size
    })

    // Whatever is left drops as the last packet, then the deck squares up.
    steps.push({
      kind: 'move',
      id: 'last',
      label: 'The last of it drops',
      duration: 280,
      ease: 'snapEase',
      to: () => layoutOf([], [...inPile, ...inBulk]),
      stagger: { by: 'card', spread: 0.4, span: 0.5 },
      reorder: () => [...inPile, ...inBulk],
      grip: {
        left: { cards: inPile.map((c) => c.id), frame: 'pinch', pressure: [{ at: 0, v: SQUEEZE }, { at: 1, v: SQUEEZE }] },
        right: { cards: inBulk.map((c) => c.id), frame: 'pinch', release: 'stagger', pressure: [{ at: 0, v: SQUEEZE }, { at: 1, v: SQUEEZE }] },
      },
      hands: {
        left: [{ at: 1, pose: pileGrip.pose, anchor: rideY(pileGrip, N, PILE_N0) }],
        right: [{ at: 1, pose: bulkGrip.pose, anchor: rideY(bulkGrip, 0, BULK_N0) }],
      },
    })

    steps.push({
      kind: 'move',
      id: 'rest',
      label: 'Squared, and barely shuffled',
      duration: 520,
      ease: 'easeInOutCubic',
      to: (dk) => stackLayout(dk, 0.02),
      camera: 'overview',
      hands: {
        left: [{ at: 1, pose: pileGrip.pose, anchor: at(pileGrip, -0.5), ease: 'easeOutCubic' }],
        right: [{ at: 1, pose: bulkGrip.pose, anchor: [bulkGrip.anchor[0] + 0.6, bulkGrip.anchor[1] - 0.2, bulkGrip.anchor[2] + 0.2], ease: 'easeOutCubic' }],
      },
      annotations: [{ text: 'Blocks moved, but cards that started together are still together', appearAt: 0.3 }],
    })

    return steps
  },
}
