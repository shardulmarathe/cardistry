import { stackLayout, faceQuat } from '../engine/layouts'
import { poseWithContacts, eulerQuat } from '../authoring/contacts'
import { CARD_GAP } from '../../lib/constants'
import * as THREE from 'three'

// Charlier cut — the one-handed flourish, authored as pure FINGER mechanics:
// the deck rides a thumb+index pinch frame into a palm-up grip, the thumb
// visibly releases the bottom half into the palm, the INDEX FINGER extends and
// the packet swings up-and-over riding the index fingertip's frame
// (indexPivot), the thumb catches it, and the hand lowers the cut deck home.
// The wrist barely moves through release/pivot/catch — the fingers do the cut.
export const charlierLesson = {
  id: 'charlier',
  title: 'Charlier Cut',
  technique: 'charlier',
  difficulty: 'beginner',
  randomizes: 'None — a cut',
  seed: 14,
  cameraPreset: 'closeUp',
  summary:
    'A one-handed cut, not a shuffle: the thumb drops the bottom half into the palm, the index finger pivots it up and over the top. Deterministic — it only cuts.',
  facts: [
    'The Charlier is a flourish cut, not a randomizer — the deck ends in a known half-and-half swap.',
    'It is a gateway move in cardistry: one hand, one fluid pivot, all in the fingers.',
  ],
  build: (deck) => {
    const mid = Math.floor(deck.length / 2)
    const cutOrder = [...deck.slice(mid), ...deck.slice(0, mid)]

    // Deck-in-hand position (palm-up grip height) and the palm shelf below it.
    const DX = 0.05
    const DY = 0.8
    const DZ = 0.15
    const PALM_Y = DY - 0.13

    // Palm-up pinch: fingers reach across to the deck's far (+x) long edge,
    // thumb owns the near edge — solved so the tips land ON the edges.
    const PINCH_ANCHOR = [DX - 0.33, DY - 0.12, DZ]
    const PINCH_QUAT = eulerQuat(-Math.PI / 2, 0, -Math.PI / 2)
    const pinch = poseWithContacts(
      'relaxed',
      'right',
      { anchor: PINCH_ANCHOR, quat: PINCH_QUAT },
      {
        thumb: [DX - 0.32, DY + 0.02, DZ + 0.03],
        index: [DX + 0.32, DY + 0.03, DZ + 0.14],
        middle: [DX + 0.33, DY + 0.03, DZ + 0.02],
        ring: [DX + 0.32, DY + 0.03, DZ - 0.1],
        pinky: [DX + 0.3, DY + 0.02, DZ - 0.2],
      },
    )

    const raised = (dk) =>
      dk.map((c, i) => ({
        id: c.id,
        pos: new THREE.Vector3(DX, DY + i * CARD_GAP, DZ),
        quat: faceQuat(c.isFaceUp),
        bend: 0,
      }))
    // Bottom half dropped onto the palm shelf; top half stays pinched (partial array).
    const dropBottom = (dk) =>
      dk.slice(0, mid).map((c, i) => ({
        id: c.id,
        pos: new THREE.Vector3(DX, PALM_Y + i * CARD_GAP, DZ),
        quat: faceQuat(c.isFaceUp),
        bend: 0,
      }))
    // End of the pivot: top half sits on the palm, original bottom half above it.
    const palmStack = (dk) =>
      dk.map((c, i) => ({
        id: c.id,
        pos: new THREE.Vector3(DX, PALM_Y + (i < mid ? mid + i : i - mid) * CARD_GAP, DZ),
        quat: faceQuat(c.isFaceUp),
        bend: 0,
      }))

    return [
      {
        kind: 'hold',
        id: 'approach',
        label: 'Reach in over the deck',
        duration: 1100,
        hands: {
          right: [
            { at: 0.2, pose: 'relaxed' },
            { at: 1, pose: 'packetGrab', anchor: [0.06, 0.52, 0.0], ease: 'anticipate' },
          ],
        },
      },
      {
        kind: 'move',
        id: 'lift',
        label: 'Take the deck up into a palm-up pinch',
        duration: 1600,
        ease: 'easeInOutCubic',
        to: (dk) => raised(dk),
        // The whole deck rides the thumb+index pinch as the wrist turns over.
        grip: { right: { cards: 'all', frame: 'pinch', pressure: [{ at: 0, v: 0.3 }, { at: 1, v: 0.6 }] } },
        hands: {
          right: [{ at: 1, pose: pinch, anchor: PINCH_ANCHOR, ease: 'easeOutBackSoft' }],
        },
        annotations: [{ text: 'Thumb on one long edge, fingertips on the other', at: [0, 1.2, 0.6], appearAt: 0.5 }],
      },
      {
        kind: 'move',
        id: 'release',
        label: 'Thumb relaxes — the bottom half drops into the palm',
        duration: 900,
        ease: 'snapEase',
        to: (dk) => dropBottom(dk),
        // Only the TOP half stays pinched; the wrist does not move — this beat
        // belongs entirely to the thumb.
        grip: { right: { cards: 'secondHalf', frame: 'pinch', pressure: [{ at: 0, v: 0.6 }, { at: 1, v: 0.6 }] } },
        hands: {
          right: [
            {
              at: 0.45,
              fingers: { thumb: [0.12, 0.1, 0.06], index: [1.35, 1.05, 0.8] },
              thumbOpp: { z: 0.25 },
            },
          ],
        },
        annotations: [{ text: 'Let gravity do it — the thumb just lets go', at: [0, 1.2, 0.6], appearAt: 0.3 }],
      },
      {
        kind: 'move',
        id: 'pivot',
        label: 'Index finger flicks the packet up and over',
        duration: 1000,
        ease: 'snapEase',
        // Bottom packet rides the INDEX FINGERTIP (indexPivot frame): as the
        // finger extends, the frame swings it up over the top half — which
        // drops onto the palm (snapEase) to make room. The packet's own `to`
        // here is only a nominal apex; while held it goes where the finger goes.
        to: (dk) =>
          palmStack(dk).map((e, i) => (i < mid ? { ...e, pos: e.pos.clone().setY(e.pos.y + 0.35).setX(e.pos.x + 0.3) } : e)),
        grip: { right: { cards: 'firstHalf', frame: 'indexPivot' } },
        hands: {
          right: [
            { at: 0.25, fingers: { index: [1.1, 0.85, 0.65] } },
            { at: 0.6, fingers: { index: [0.55, 0.4, 0.3] } },
            {
              at: 0.9,
              fingers: { index: [0.12, 0.1, 0.08] },
              fingerMotion: [{ fingers: ['index'], type: 'tremor', amp: 0.02, cycles: 2 }],
            },
          ],
        },
        annotations: [
          { text: 'One finger does the cut — the packet pivots on the index tip', at: [0, 1.25, 0.6], appearAt: 0.35 },
        ],
      },
      {
        kind: 'move',
        id: 'fall',
        label: 'Let it fall square onto the top half',
        duration: 900,
        ease: 'snapEase',
        to: (dk) => palmStack(dk),
        // No grip: the index has let go at the apex (the release position is
        // baked from the fingertip frame, so the handoff is seamless) and
        // gravity lands the packet on the pile in the palm.
        hands: {
          right: [{ at: 0.7, fingers: { index: [0.5, 0.38, 0.28] } }],
        },
      },
      {
        kind: 'hold',
        id: 'catch',
        label: 'Thumb catches — squeeze the halves square',
        duration: 900,
        grip: { right: { cards: 'all', frame: 'pinch', pressure: [{ at: 0, v: 0.15 }, { at: 1, v: 0.6 }] } },
        hands: {
          right: [
            {
              at: 0.6,
              pose: pinch,
              anchor: PINCH_ANCHOR,
              ease: 'settle',
              fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tighten', amp: 0.05 }],
            },
          ],
        },
      },
      {
        kind: 'move',
        id: 'lower',
        label: 'Lower the cut deck toward the table',
        duration: 1400,
        ease: 'easeInOutCubic',
        reorder: () => cutOrder,
        to: (dk) => stackLayout(dk, 0.28),
        camera: 'overview',
        grip: { right: { cards: 'all', frame: 'pinch', pressure: [{ at: 0, v: 0.6 }, { at: 1, v: 0.6 }] } },
        hands: {
          // Same pinch pose, translated by exactly the deck's travel — the
          // grip frame lands the cards on the hover stack with zero handoff
          // error when the hold releases into the set-down.
          right: [{ at: 1, pose: pinch, anchor: [PINCH_ANCHOR[0] - DX, PINCH_ANCHOR[1] - (DY - 0.13) + 0.28, 0.0] }],
        },
      },
      {
        kind: 'move',
        id: 'set-down',
        label: 'Set it down and let go',
        duration: 900,
        ease: 'snapEase',
        to: (dk) => stackLayout(dk),
        hands: {
          right: [
            {
              at: 0.5,
              fingers: { thumb: [0.1, 0.08, 0.05], index: [0.3, 0.22, 0.15] },
              anchor: [PINCH_ANCHOR[0] - DX, 0.34, 0.0],
            },
            { at: 1, pose: 'relaxed', ease: 'settle' },
          ],
        },
      },
      {
        kind: 'hold',
        id: 'rest',
        label: 'Cut complete — bottom half is now on top',
        duration: 800,
        hands: {
          right: [{ at: 1, pose: 'relaxed', ease: 'easeInOutCubic' }],
        },
      },
    ]
  },
}
