// Shared world constants + design tokens for the 3D rebuild.
// World units are arbitrary "table units"; a card is ~63x88mm scaled up.

// A poker card is 63.5 x 88.9 x 0.30 mm, and CARD_W is what fixes this world's
// scale: 0.63 wu = 63.5mm, so 1 wu = 100.8mm. Every other dimension here is that
// same conversion, not a look-right number.
export const CARD_W = 0.63
export const CARD_H = 0.88
// 0.30mm. Was 0.006 (0.60mm), i.e. twice a real card, which read as a chunky
// slab at close range and doubled what the penetration metric charges for a pad
// entering a card's slab.
export const CARD_T = 0.003
// Stack pitch. Was 0.004, which piled 52 cards to 20.8mm against a real deck's
// 15.6mm -- a third too tall, so every bow, weave and squared deck was reading
// as a fatter object than a deck of cards is. 0.003 puts 52 cards at 15.3mm.
export const CARD_GAP = 0.003
export const CARD_ASPECT = CARD_H / CARD_W

// --- Palette: casino oxblood felt under a warm gold spotlight ---
export const COLORS = {
  feltCore: '#7c1122', // lit center of the felt
  feltMid: '#5a0d18',
  feltEdge: '#26050a', // dark vignette edge
  ink: '#180d10', // near-black warm
  bone: '#f7f1e6', // card ivory / primary light text
  gold: '#d8a24a', // single accent — spotlight gold
  goldBright: '#f0c67a',
  red: '#c8102e', // suit red on card faces
  black: '#141414', // suit black on card faces
}

// Camera presets: { position:[x,y,z], target:[x,y,z], fov }
// A gentle-orbit "dealer's seat" is the default reading angle.
//
// PRUNED with the catalog. This carried eleven presets, seven of which existed
// for lessons that no longer do (springProfile/springArch for the waterfall's
// squeeze, handsCradle/handsHigh for hindu and strip, handCut for the charlier's
// old staging, weave for the tabled riffle's interlace, overShoulder for nothing
// still shipping). Each came with a paragraph of reasoning about framing a beat
// that has been deleted, which is worse than no comment at all. Add a preset back
// when a beat needs it, with the measurement that justifies it.
export const CAMERA_PRESETS = {
  overview: { position: [0, 4.3, 4.9], target: [0, 0.15, 0], fov: 35 },
  dealerPOV: { position: [0, 3.4, 5.4], target: [0, 0.35, -0.2], fov: 38 },
  closeUp: { position: [0, 2.5, 3.6], target: [0, 0.3, 0], fov: 34 },
  // Straight down on the felt, and now used ONLY by the wash - the one technique
  // whose subject is a wide 2D spread rather than a deck. Pulled back from 6.2 to
  // 8.2: at 6.2 the spread (x -1.13..0.97, z -0.59..0.66, so 1.57 x 1.10 of
  // half-extent once a card's own size is counted) overflowed the frame on three
  // sides once the transport panel had taken the bottom of it. Geometry alone said
  // it fitted, which is why this was found by looking rather than by arithmetic.
  topDown: { position: [0, 8.2, 0.4], target: [0, 0, 0], fov: 40 },
  // IN-HANDS work, which is a different shot from anything on the felt. Measured
  // on the in-hands riffle (scripts/inspect/framing.mjs): its cards span y
  // 0.02..1.21 with the busiest band at 1.0, and its WRISTS sit at a median of 1.62
  // because a palm-down pinch holds the packet from ABOVE. So the subject is tall
  // and high, and the first version of this preset - aimed at 1.0 from 4.2 out -
  // cropped both hands off the top and left a third of the shot as empty felt.
  //
  // Aimed between the cards and the wrists, and pulled back far enough that the
  // whole subject fits in the strip ABOVE the transport panel (which covers roughly
  // the bottom 40%, so the framed height has to be about 1.7x the subject).
  inHands: { position: [0, 2.2, 5.2], target: [0, 1.28, 0], fov: 34 },
  // A ONE-HANDED CUT HAPPENS IN THE AIR. Measured on the charlier's compiled
  // track (scripts/inspect/framing.mjs): its cards span y 0.02..1.11 and the
  // BUSIEST band - where most card mass actually sits - is y 0.9. Every table
  // preset aims at y 0.15..0.35, so running the cut on one pushed it against the
  // top of the frame with a third of the shot empty felt below.
  //
  // Off-centre to the LEFT because the cutting hand is on the right: from
  // straight on you look down the deck's own axis and the swing flattens out.
  // Stays ABOVE the cut - dropping under it frames the deck's unlit underside,
  // which renders near-black beneath the overhead key.
  handCut: { position: [-1.35, 3.15, 4.5], target: [0.02, 0.86, 0.1], fov: 34 },
  // The overhand DRAW: a deck held in the air on one side and a pile growing on
  // the felt beside it, so the subject is both tall and OFF CENTRE. Measured: cards
  // y 0.02..0.93 with x 0.00..0.81 (entirely one side of the table), wrist median
  // 0.88, wanted aim ~0.49 - against `topDown`'s 0 and `overview`'s 0.15. Aimed at
  // the middle of the two and offset in x so the pile is not stranded at the frame
  // edge with empty felt opposite it.
  overhandDraw: { position: [0.42, 2.7, 4.9], target: [0.42, 0.5, 0], fov: 34 },
  // The overhand as two packets held IN THE AIR, one above the other. This subject is
  // DEEP rather than wide, and that is what no existing preset frames. Measured on the
  // rebuilt track: cards span z -0.44..0.62 (both packets lie flat, so each contributes
  // its full 0.88 of card height in z) against x -0.32..0.00. `framing.mjs` reserves
  // the bottom 40% of the frame for the transport panel, so `inHands` offers only 0.97
  // of usable depth against a 1.06 subject - it was the one lesson in the catalog the
  // tool flagged as OVERFLOWS - while leaving 2.25 of width completely unused.
  //
  // So this pulls back and widens rather than re-aiming: at d 5.67 and fov 36 the
  // usable half-height is 1.11, which clears 1.06. Aimed at y 0.96, the aim the tool
  // wants for a subject whose cards sit at 0.02..1.00 with a wrist median of 1.32.
  overhandBulk: { position: [0, 2.7, 5.4], target: [0, 0.96, 0], fov: 36 },
  // A NEAR-SIDE WASH IS DEEPER THAN A TABLE PRESET CAN SEE. Once the hands come in
  // from the near side rather than sweeping in from left and right, they push cards
  // along z as well as x: measured, the spread runs z -0.83..0.59, a span of 1.27
  // against the 1.21 of depth `overview` leaves once the transport panel takes the
  // bottom 40% of the frame. That is not a tuning error in the wash - a wash spreads
  // cards in two dimensions, which is the entire reason it randomises so well, so the
  // subject is genuinely as deep as it is wide.
  //
  // Pulled back and widened to suit: d 6.88 and fov 38 give a usable half-height of
  // 1.42. Aimed at y 0.1, just above the felt, because the cards never leave it.
  washTable: { position: [0, 4.6, 5.2], target: [0, 0.1, 0], fov: 38 },
  // The TABLE riffle. Everything happens on the felt, so this aims low - but not
  // straight down: the whole point of the move is that the cards BEND, and a bow is
  // only visible from a shallow angle. So this sits lower and closer than `overview`
  // (which looks down from 4.3) to catch the arch in silhouette, and wide enough for
  // two halves side by side with a hand outboard of each.
  // Measured, not eyeballed: the subject is two landscape halves at x +-0.52 (so
  // +-0.96 of cards) with a hand outboard of each, and the hands stand ~1.0 tall. At
  // d 3.75 and fov 36 the usable half-height was only 0.73 once the transport panel
  // takes the bottom 40%, and both hands were cropped at the top of frame. d 6.28 and
  // fov 34 give 1.15 of usable height and 2.68 of half-width.
  //
  // It stays LOW rather than looking down like `overview`: the whole point of this
  // move is that the cards visibly BEND, and a bow only reads in silhouette from a
  // shallow angle.
  riffleTable: { position: [0, 2.6, 5.8], target: [0, 0.2, 0], fov: 34 },
}

// OrbitControls constraints so users never go under the table or behind the cards.
export const ORBIT = {
  minPolarAngle: Math.PI * 0.12,
  maxPolarAngle: Math.PI * 0.47,
  minDistance: 3,
  maxDistance: 9,
  dampingFactor: 0.08,
}

export const SUIT_SYMBOL = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
}

export const RED_SUITS = new Set(['hearts', 'diamonds'])
