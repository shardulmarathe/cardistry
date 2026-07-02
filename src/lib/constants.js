// Shared world constants + design tokens for the 3D rebuild.
// World units are arbitrary "table units"; a card is ~63x88mm scaled up.

export const CARD_W = 0.63
export const CARD_H = 0.88
export const CARD_T = 0.006 // visual thickness reference
export const CARD_GAP = 0.004 // vertical spacing between stacked cards
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
export const CAMERA_PRESETS = {
  overview: { position: [0, 4.3, 4.9], target: [0, 0.15, 0], fov: 35 },
  dealerPOV: { position: [0, 3.4, 5.4], target: [0, 0.35, -0.2], fov: 38 },
  closeUp: { position: [0, 2.5, 3.6], target: [0, 0.3, 0], fov: 34 },
  topDown: { position: [0, 6.2, 0.4], target: [0, 0, 0], fov: 40 },
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
