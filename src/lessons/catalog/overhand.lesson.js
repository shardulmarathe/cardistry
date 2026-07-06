import * as THREE from 'three'
import { faceQuat } from '../engine/layouts'
import { CARD_GAP } from '../../lib/constants'
import { splitIntoRandomBlocks } from '../../lib/shuffleMath'

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
const CLEAR = 0.34 // wrist height above a pile's base while gripping
const PLACE_Z = 0.14
const PACKETS = 3

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
      hands: {
        right: [{ at: 1, pose: 'packetGrab', anchor: [-SRC_X, CLEAR + d.length * CARD_GAP + 0.05, PLACE_Z] }],
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

        const wristStartY = CLEAR + srcBase * CARD_GAP
        const wristEndY = CLEAR + dstBase * CARD_GAP
        const peakY = Math.max(wristStartY, wristEndY) + 0.38
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
            right: [{ at: 1, pose: 'packetGrab', anchor: [SRC, wristStartY, PLACE_Z] }],
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
          grip: { right: ids },
          to: twoPiles(newSrc.slice(), newDst.slice(), SRC, DST),
          hands: {
            right: [
              { at: 0, pose: 'packetGrab', anchor: [SRC, wristStartY, PLACE_Z] },
              { at: 0.5, pose: 'packetGrab', anchor: [(SRC + DST) / 2, peakY, PLACE_Z] },
              { at: 1, pose: 'packetGrab', anchor: [DST, wristEndY, PLACE_Z] },
            ],
          },
        })

        src = newSrc
        dst = newDst
      }
      d = dst // the rebuilt pile becomes the deck for the next round
    }

    // Settle: lift the hand away from the finished pile (deck ends on the left).
    steps.push({
      kind: 'hold',
      id: 'done',
      label: 'Shuffled — twice through',
      duration: 1200,
      hands: {
        right: [{ at: 1, pose: 'relaxed' }],
      },
      annotations: [
        { text: 'Blocks moved, but neighbours stayed together — that’s why it mixes weakly', at: [-SRC_X, 0.7, 0.9], appearAt: 0.1 },
      ],
    })

    return steps
  },
}
