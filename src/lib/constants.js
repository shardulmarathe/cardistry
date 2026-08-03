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
  // Low and tight on the table center — for the beat where cards interlace
  // (riffle weave, faro interlace). Sits just inside ORBIT.minDistance.
  weave: { position: [0, 1.9, 2.5], target: [0, 0.25, 0], fov: 32 },
  // Off-axis three-quarter view: gives a one-handed cut (charlier) depth that
  // the head-on presets flatten, and breaks the symmetry of a long lesson.
  overShoulder: { position: [1.7, 2.6, 3.4], target: [0.1, 0.3, 0], fov: 34 },
  // A one-handed cut happens IN THE AIR, not on the felt: charlier's packets
  // sit at y≈0.85 while every other preset aims at y≈0.3, which pushed the cut
  // into the top of the frame with half the shot empty table. Aims at the cut
  // itself, from slightly left so the hand reads beside the deck rather than
  // behind it. Stays ABOVE the cut: dropping the camera under it frames the
  // deck's unlit underside, which renders near-black under the overhead key.
  handCut: { position: [-1.1, 2.75, 3.0], target: [0.02, 0.78, 0.1], fov: 32 },
  // Two-handed work held IN THE AIR (hindu, strip). At HAND_SCALE 13 a palm-up
  // cradle cannot bring a pile below about wrist + one cup depth, so the action
  // genuinely lives near y≈1 — `dealerPOV` aims at 0.35 and leaves it riding
  // the top of the frame over empty felt.
  handsHigh: { position: [0, 3.1, 3.6], target: [0, 0.95, 0.1], fov: 35 },
  // Same subject as handsHigh but pulled back far enough to keep BOTH hands in
  // frame. A cradle that genuinely carries its pile cannot hold it below y≈1.13
  // at HAND_SCALE 11, and hands are now large — handsHigh (4.1 out) frames the
  // cards but crops the hands off the sides, while overview clips the deck
  // against the header. 6.4 out, aimed at the cradle.
  handsCradle: { position: [0, 4.8, 6.4], target: [0, 1.05, 0.05], fov: 38 },
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
