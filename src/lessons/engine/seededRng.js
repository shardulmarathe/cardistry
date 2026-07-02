// Deterministic PRNG so lesson compilation is a pure function of (deck, seed).
// Same seed => identical Track => scrubbing to any instant reproduces exactly.
export function mulberry32(seed) {
  let a = seed >>> 0
  return function rng() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min
}
