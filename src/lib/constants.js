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
  topDown: { position: [0, 6.2, 0.4], target: [0, 0, 0], fov: 40 },
  // IN-HANDS work, which is a different shot from anything on the felt: the
  // packets live at y ~ 1.0 and span roughly x +/-0.5, so a table preset aimed at
  // y ~ 0.3 puts the whole move in the top of the frame over empty felt. Aimed at
  // the packets, and only mildly above them - the interleave is a side-on event,
  // and looking down at it flattens the two halves into one line.
  inHands: { position: [0, 1.9, 4.2], target: [0, 1.0, 0], fov: 34 },
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
