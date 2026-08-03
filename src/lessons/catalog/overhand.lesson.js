import * as THREE from 'three'
import { faceQuat } from '../engine/layouts'
import { CARD_GAP, CARD_H } from '../../lib/constants'
import { splitIntoRandomBlocks } from '../../lib/shuffleMath'
import { DECK_REST_DROP, DECK_APPROACH_DROP, PACKET_GRAB_DROP } from '../../hands/handPoses'
import { surfaceContact, wristAnchorForContact } from '../authoring/contacts'

// Overhand shuffle, shown as what it really is: a hand repeatedly peeling the
// top packet off one pile and dropping it onto a second pile, until the whole
// deck has crossed over — then doing it a second time. ONE hand does the work
// (the other is hidden to keep it readable): it reaches to the source pile,
// GRIPS the top packet so the cards ride rigidly in the hand, arcs them through
// the air, and sets them down on the growing pile.
//
// The wrist keeps ONE orientation (packetGrab) across each carry, so the gripped
// packet translates cleanly and lands flat with no snap (offset math in
// grips.js). Pile x-positions swap each round so the deck ping-pongs.
const SRC_X = 0.95
const PLACE_Z = 0.14
const PACKETS = 3
// Top card height of a pile holding `n` cards (matches pileEntry's stacking).
const pileTop = (n) => 0.02 + Math.max(0, n - 1) * CARD_GAP

// A representative top card of a pile at `x`. Every card in a pile shares one
// footprint and differs only in height, so the top one stands in for the whole
// stack whenever a hand has to meet it from above.
const topCardAt = (x, top) => ({ pos: [x, top, PLACE_Z], quat: faceQuat(false) })

// --- Every wrist offset below is DERIVED off the rig, never typed ------------
// A wrist-to-pad offset is a distance across the HAND, so it scales linearly
// with HAND_SCALE. Both offsets this lesson needs used to be world constants
// authored against a rig 2.83x smaller, and when the rig grew they went stale
// in opposite directions:
//   * REST_AT's `x + 0.55` put the rest pads a full card-width PAST the pile
//     (the pose reaches 1.62 inward now, not 0.52) — a hand resting on felt;
//   * the cage was anchored with its wrist directly over the pile, but
//     `packetGrab`'s fingers reach ~0.8 in +z, so the pads closed 0.37 BEYOND
//     the packet's far edge — the hand gripped air.
// `wristAnchorForContact` asks the rig the only honest version of the question:
// where must the wrist sit for THIS pose's pad to land on THAT point? The pad
// target itself comes from `surfaceContact`, which already stands the finger
// off the card by its own (now much larger) radius.
// (…as an ARRAY: surfaceContact returns a Vector3, wristAnchorForContact reads
// its target by index, and a Vector3 indexed by [0] is silently `undefined`.)
const padOn = (finger, card, u = 0, v = 0) => surfaceContact(card, { finger, u, v }).toArray()
// Heights stay on the exported DECK_*/PACKET_GRAB_DROP measurements: those are
// taken from the pose's DEEPEST capsule surface (not just the pad that is being
// aimed) and carry the air the idle overlay and grip pressure need, so they are
// the safer source for y. x and z come from the pad solve.
const anchorFor = (poseName, dropConst, x, top, { u = 0, v = 0, lift = 0 } = {}) => {
  const a = wristAnchorForContact(poseName, 'right', 'middle', padOn('middle', topCardAt(x, top), u, v))
  return [a[0], top + dropConst + lift, a[2]]
}
// The cage closing on the top packet of a pile whose top card is at `top`.
const GRAB_AT = (x, top) => anchorFor('packetGrab', PACKET_GRAB_DROP, x, top)
// The open hand hovering over that pile, `lift` of extra air above contact.
const APPROACH_AT = (x, top, lift = 0) => anchorFor('deckApproach', DECK_APPROACH_DROP, x, top, { lift })
// The closing rest, pads a third of a card in from the pile's near long edge.
const REST_AT = (x, n) => anchorFor('deckRest', DECK_REST_DROP, x, pileTop(n), { u: 0.34 })

function pileEntry(card, x, i) {
  return {
    id: card.id,
    pos: new THREE.Vector3(x, 0.02 + i * CARD_GAP, PLACE_Z),
    quat: faceQuat(card.isFaceUp),
    bend: 0,
  }
}

// Full 52-card layout with the deck split across two piles (each bottom-to-top).
// Called EAGERLY at build time with snapshots — never as a lazy closure over the
// mutating src/dst loop vars.
function twoPiles(srcCards, dstCards, xSrc, xDst) {
  const poses = []
  srcCards.forEach((c, i) => poses.push(pileEntry(c, xSrc, i)))
  dstCards.forEach((c, i) => poses.push(pileEntry(c, xDst, i)))
  return poses
}

export const overhandLesson = {
  id: 'overhand',
  title: 'Overhand Shuffle',
  technique: 'overhand',
  difficulty: 'beginner',
  randomizes: 'Weak',
  seed: 21,
  cameraPreset: 'overview',
  summary:
    'The everyday shuffle: peel small packets off the top of the deck and drop them onto a new pile, one after another. Easy — but it only moves blocks, so it barely randomizes.',
  facts: [
    'The overhand only transports blocks of cards, so cards that start together tend to stay together.',
    'Rigorously, it can take on the order of 2,500 overhand shuffles to truly randomize 52 cards — versus about 7 riffles.',
  ],
  build: (deck, ctx) => {
    const rng = ctx.rng
    const steps = []
    let d = deck.slice() // bottom-to-top; the top of the deck is the END

    steps.push({
      kind: 'move',
      id: 'ready',
      label: 'Start with the squared deck',
      duration: 1200,
      ease: 'easeInOutCubic',
      camera: 'overview',
      to: twoPiles(d.slice(), [], -SRC_X, SRC_X),
      // The opening beat CLOSES onto the deck: the hand arrives from its own
      // side, settles its pads on the top card, then takes the cage grip.
      //
      // The `at: 0` keyframe is load-bearing, not decoration. With no keyframe
      // at 0 the compiler manufactures a lead-in FROM the carried-forward pose,
      // which at the first step of a lesson is `relaxed` at its own default
      // wrist — and `relaxed` parks a (now 2.83x larger) hand at x=0.95 with
      // its thumb base 1.57 inboard of that, i.e. straight through the deck.
      // Measured: this single missing keyframe was the whole of this lesson's
      // 0.1202 max finger-in-card. Pinning frame 0 to a real anchor removes the
      // phantom pose entirely.
      hands: {
        right: [
          { at: 0, pose: 'deckApproach', anchor: APPROACH_AT(SRC_X, pileTop(0), CARD_H) },
          { at: 0.45, pose: 'deckApproach', anchor: APPROACH_AT(-SRC_X, pileTop(d.length), CARD_H * 0.4) },
          { at: 1, pose: 'packetGrab', anchor: GRAB_AT(-SRC_X, pileTop(d.length)), ease: 'easeOutCubic' },
        ],
      },
      annotations: [
        {
          text: 'Overhand is gentle but weak — it just shuffles blocks of cards around',
          at: [0, 0.75, 0.9],
          appearAt: 0.15,
        },
      ],
    })

    for (let r = 0; r < 2; r++) {
      const SRC = r % 2 === 0 ? -SRC_X : SRC_X
      const DST = -SRC
      const blocks = splitIntoRandomBlocks(d, PACKETS, rng) // contiguous, bottom-to-top
      let src = d.slice() // remaining on the source pile
      let dst = [] // built up on the destination pile

      // Peel from the TOP of the source: iterate blocks from the top down.
      for (let bi = blocks.length - 1; bi >= 0; bi--) {
        const packet = blocks[bi]
        const size = packet.length
        const srcBase = src.length - size // pile index of the packet's bottom card
        const dstBase = dst.length // where it will land on the destination pile
        const ids = packet.map((c) => c.id)

        // Anchors are solved against the packet's TOP card at each end — that
        // is the surface the fingers actually land on.
        const startAnchor = GRAB_AT(SRC, pileTop(src.length))
        const endAnchor = GRAB_AT(DST, pileTop(dstBase + size))
        // The arc's height is CARD-sized, not hand-sized: it exists so the
        // carried packet visibly clears the felt, and the packet is a card.
        const peakAnchor = [
          (startAnchor[0] + endAnchor[0]) / 2,
          Math.max(startAnchor[1], endAnchor[1]) + CARD_H / 2,
          (startAnchor[2] + endAnchor[2]) / 2,
        ]
        const firstOfRound = bi === blocks.length - 1

        // Reach over and settle the hand onto the top packet (no grip yet).
        steps.push({
          kind: 'move',
          id: `reach-${r}-${bi}`,
          label: 'Grip the top packet',
          duration: 650,
          ease: 'easeInOutCubic',
          to: twoPiles(src.slice(), dst.slice(), SRC, DST),
          hands: {
            right: [{ at: 1, pose: 'packetGrab', anchor: startAnchor }],
          },
          annotations: firstOfRound
            ? [{ text: r === 0 ? 'Peel a packet off the top…' : 'Now do it all again', at: [SRC, 0.7, 0.9], appearAt: 0.2 }]
            : undefined,
        })

        const newSrc = src.slice(0, srcBase)
        const newDst = dst.concat(packet)

        // Carry the gripped packet along an arc and set it on the far pile. The
        // wrist orientation is held constant so the packet stays flat and lands
        // exactly on top of the growing pile.
        steps.push({
          kind: 'move',
          id: `place-${r}-${bi}`,
          label: 'Carry it over and drop it on the new pile',
          duration: 1150,
          ease: 'easeInOutCubic',
          // The packet rides the fingertip contact frame with a visible
          // squeeze at pickup that relaxes into the drop.
          grip: { right: { cards: ids, frame: 'packet', pressure: [{ at: 0, v: 0.3 }, { at: 1, v: 0.18 }] } },
          // BOOKKEEPING: the lesson moves real packets with explicit `to`
          // arrays and never declared a `reorder`, so `track.finalDeck` came
          // back as the UNTOUCHED deck — watching the lesson left the app's
          // logical deck unshuffled while the animation plainly shuffled it.
          // On the last packet of a round the destination pile IS the whole
          // deck, bottom-to-top, so that is exactly the new order.
          reorder: bi === 0 ? () => newDst.slice() : undefined,
          to: twoPiles(newSrc.slice(), newDst.slice(), SRC, DST),
          hands: {
            right: [
              { at: 0, pose: 'packetGrab', anchor: startAnchor },
              { at: 0.5, pose: 'packetGrab', anchor: peakAnchor },
              { at: 1, pose: 'packetGrab', anchor: endAnchor },
            ],
          },
        })

        src = newSrc
        dst = newDst
      }
      d = dst // the rebuilt pile becomes the deck for the next round
    }

    // Settle: the hand RESTS on the finished pile (deck ends on the left)
    // instead of drifting off to hover a card-width away from everything.
    steps.push({
      kind: 'hold',
      id: 'done',
      label: 'Shuffled — twice through',
      duration: 1200,
      hands: {
        right: [
          // Open the cage HIGH before turning into the rest pose: lerping a
          // fist straight into a flat hand swings the pads down through the
          // pile even though both endpoints clear it.
          { at: 0.4, pose: 'deckApproach', anchor: APPROACH_AT(-SRC_X, pileTop(d.length), CARD_H * 0.5) },
          {
            at: 1,
            pose: 'deckRest',
            anchor: REST_AT(-SRC_X, d.length),
            ease: 'easeOutCubic',
            fingerMotion: [{ fingers: ['index', 'middle', 'ring'], type: 'tighten', amp: 0.04 }],
          },
        ],
      },
      annotations: [
        { text: 'Blocks moved, but neighbours stayed together — that’s why it mixes weakly', at: [-SRC_X, 0.7, 0.9], appearAt: 0.1 },
      ],
    })

    return steps
  },
}
