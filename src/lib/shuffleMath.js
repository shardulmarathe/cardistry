import { randInt } from '../lessons/engine/seededRng'

// Pure shuffle choreography ported from the old ShuffleView. These compute the
// resulting card ORDER; the timeline engine turns that order into keyframes.
// RNG is injected so results are deterministic per lesson seed.

// Strict alternating interleave of two halves (the riffle result).
export function alternateMerge(left, right) {
  const L = [...left]
  const R = [...right]
  const out = []
  while (L.length || R.length) {
    if (L.length) out.push(L.shift())
    if (R.length) out.push(R.shift())
  }
  return out
}

export function riffleOrder(deck) {
  const mid = Math.floor(deck.length / 2)
  return alternateMerge(deck.slice(0, mid), deck.slice(mid))
}

// Split into N contiguous random-sized blocks (overhand rounds).
export function splitIntoRandomBlocks(cards, requestedBlocks, rng) {
  const blocks = []
  let cursor = 0
  let remainingCards = cards.length
  let remainingBlocks = requestedBlocks
  while (remainingBlocks > 0) {
    const maxSize = remainingCards - (remainingBlocks - 1)
    // The final block must consume every remaining card, or cards get dropped.
    const blockSize = remainingBlocks === 1 ? remainingCards : randInt(rng, 1, maxSize)
    blocks.push(cards.slice(cursor, cursor + blockSize))
    cursor += blockSize
    remainingCards -= blockSize
    remainingBlocks -= 1
  }
  return blocks
}

// Fisher–Yates with injected RNG.
export function shuffleArray(items, rng) {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rng, 0, i)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// Integrity guard: same multiset of card ids.
export function hasSameCardSet(baseDeck, candidateDeck) {
  if (baseDeck.length !== candidateDeck.length) return false
  const baseIds = new Set(baseDeck.map((c) => c.id))
  return candidateDeck.every((c) => baseIds.has(c.id))
}
