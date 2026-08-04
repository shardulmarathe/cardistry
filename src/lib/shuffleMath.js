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

// A PERFECT weave, this is the faro, not the riffle. Kept under this name
// because `kind:'riffle'` steps default to it, but a real riffle never
// alternates strictly: see gsrRiffleOrder below.
export function riffleOrder(deck) {
  const mid = Math.floor(deck.length / 2)
  return alternateMerge(deck.slice(0, mid), deck.slice(mid))
}

// Gilbert–Shannon–Reeds: the standard probabilistic model of a REAL riffle,
// and the one the Bayer–Diaconis "seven shuffles" result is proved about.
// Cards drop from whichever packet still holds more, in proportion to what
// each has left, so the result falls in irregular clumps rather than strict
// alternation. That clumping IS the randomization; a strictly alternating
// weave is a faro, which is deterministic and restores the deck after eight.
//
// The cut stays at exactly mid so the two authored packets on the table match
// the order (a binomial cut would desync the choreography from the result).
export function gsrRiffleOrder(deck, rng) {
  const mid = Math.floor(deck.length / 2)
  const L = deck.slice(0, mid)
  const R = deck.slice(mid)
  const out = []
  let i = 0
  let j = 0
  while (i < L.length || j < R.length) {
    if (i >= L.length) {
      out.push(R[j++])
    } else if (j >= R.length) {
      out.push(L[i++])
    } else if (rng() < (L.length - i) / (L.length - i + (R.length - j))) {
      out.push(L[i++])
    } else {
      out.push(R[j++])
    }
  }
  return out
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
