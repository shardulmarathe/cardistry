import { create } from 'zustand'

// ---------------------------------------------------------------------------
// Mixing analysis: turn a compiled lesson track into "what order is the deck in
// right now", plus the two numbers that make the catalog's randomness claims
// checkable instead of asserted.
//
// The deck order is NOT re-simulated here. It is READ back out of the compiled
// track: a squared stack is literally sorted by height, so taking every card's
// landing pose at a step boundary and sorting by y recovers the physical
// stacking order. That is the source of truth rather than track.finalDeck because
// finalDeck only tracks lessons that declare `reorder`, the overhand lesson
// moves real packets between piles without one, so its finalDeck says "untouched"
// while its cards say otherwise. Poses never lie.
// ---------------------------------------------------------------------------

// A stack counts as "squared" (order well defined) when every card shares one
// footprint and the heights form an unbroken ladder. Anything else, two halves
// mid-cut, a wash smeared over the felt, a packet in flight, has no meaningful
// linear order, so we hold the last squared reading instead of inventing one.
// Every layout that squares a deck (stackLayout, landscapeStackLayout, the
// pile builders) puts all 52 cards on EXACTLY one (x,z), so the tolerance can be
// tight, and it has to be: in the hindu carry the packet in the hand hovers
// 0.015 above the pile it is about to join, close enough that a loose tolerance
// merges two distinct stacks and reads out a deck order that never existed.
const SQUARE_SPREAD = 0.012 // world units of allowed x/z jitter
const SQUARE_Y_GAP = 0.05 // world units; CARD_GAP is 0.004

// Where a card has SETTLED at `ms`: the landing pose of the last segment that
// has finished. Deliberately not an interpolated sample, landing poses are the
// exact layout coordinates the lesson authored, so a stack reads out with zero
// float noise, and a card still in a hand at the boundary can't contribute the
// grip-baked pose that a sampler would return.
function settledPose(segs, ms) {
  let best = null
  for (const s of segs) {
    if (s.tEnd <= ms + 0.5 && (!best || s.tEnd >= best.tEnd)) best = s
  }
  return best ? best.to : (segs[0]?.from ?? null)
}

export function settledOrderAt(track, ms) {
  const rows = []
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const [id, segs] of track.cards) {
    const p = settledPose(segs, ms)
    if (!p) return null
    if (p.pos.x < minX) minX = p.pos.x
    if (p.pos.x > maxX) maxX = p.pos.x
    if (p.pos.z < minZ) minZ = p.pos.z
    if (p.pos.z > maxZ) maxZ = p.pos.z
    rows.push({ id, y: p.pos.y })
  }
  if (rows.length === 0) return null
  if (maxX - minX > SQUARE_SPREAD || maxZ - minZ > SQUARE_SPREAD) return null
  rows.sort((a, b) => a.y - b.y)
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].y - rows[i - 1].y > SQUARE_Y_GAP) return null
  }
  return rows.map((r) => r.id)
}

// --- the numbers -----------------------------------------------------------

// Bayer–Diaconis rising sequences. With pos[v] = where the card that started at
// original position v sits now, a new rising sequence begins wherever pos drops.
// Sorted deck = 1. One perfect riffle = exactly 2. k riffles <= 2^k. A uniformly
// random 52-card deck averages (n+1)/2 = 26.5.
export function risingSequences(currentIds, originalIndex) {
  const n = originalIndex.size
  if (n === 0) return 0
  const pos = new Array(n).fill(-1)
  for (let i = 0; i < currentIds.length; i++) {
    const v = originalIndex.get(currentIds[i])
    if (v !== undefined) pos[v] = i
  }
  let runs = 1
  for (let v = 1; v < n; v++) if (pos[v] < pos[v - 1]) runs++
  return runs
}

// How many originally-adjacent pairs are still adjacent, in order. This is the
// "only transports blocks" claim made countable: an overhand keeps almost every
// neighbour, a riffle breaks almost all of them.
export function intactNeighbours(currentIds, originalIndex) {
  let kept = 0
  for (let i = 0; i + 1 < currentIds.length; i++) {
    const a = originalIndex.get(currentIds[i])
    const b = originalIndex.get(currentIds[i + 1])
    if (a !== undefined && b !== undefined && b === a + 1) kept++
  }
  return kept
}

export const RANDOM_RISING = (n) => (n + 1) / 2

// --- colour ramp -----------------------------------------------------------

// Viridis: perceptually uniform, monotone in lightness, and readable under all
// common colour-vision deficiencies, a rainbow would fail both tests and fight
// the oxblood chrome. The domain is lifted off 0 so the darkest cells stay
// distinct from the dark red panel behind them.
const STOPS = [
  [68, 1, 84],
  [72, 40, 120],
  [62, 74, 137],
  [49, 104, 142],
  [38, 130, 142],
  [31, 158, 137],
  [53, 183, 121],
  [109, 205, 89],
  [180, 222, 44],
  [223, 227, 24],
  [253, 231, 37],
]
const RAMP_FLOOR = 0.12

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t)
const hex2 = (v) => Math.round(v).toString(16).padStart(2, '0')

export function rampHex(t) {
  const x = (RAMP_FLOOR + (1 - RAMP_FLOOR) * clamp01(t)) * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(x))
  const f = x - i
  const a = STOPS[i]
  const b = STOPS[i + 1]
  return `#${hex2(a[0] + (b[0] - a[0]) * f)}${hex2(a[1] + (b[1] - a[1]) * f)}${hex2(a[2] + (b[2] - a[2]) * f)}`
}

// The pristine deck as one CSS gradient, the "this is where you started" rule.
export const RAMP_GRADIENT = `linear-gradient(90deg, ${Array.from(
  { length: 11 },
  (_, i) => `${rampHex(i / 10)} ${i * 10}%`,
).join(', ')})`

// --- timeline --------------------------------------------------------------

function frameOf(order, originalIndex, squared, label) {
  const n = originalIndex.size
  return {
    order,
    squared,
    label,
    rising: risingSequences(order, originalIndex),
    kept: intactNeighbours(order, originalIndex),
    pairs: Math.max(1, n - 1),
  }
}

// One pass per lesson: the deck order after every step, with its statistics.
// ~52 pose samples per step, done once at mount, never per frame.
// `baselineIds` is the deck order to measure AGAINST. With "Shuffle again" the
// track starts from the previous run's output, so scoring against the track's
// own first order would reset the numbers every repeat, one riffle from any
// order is always ~2 rising sequences. Passing the order from when the lesson
// was OPENED makes repeats accumulate, which is the whole "seven shuffles"
// demonstration. Omit it and it behaves exactly as before.
export function buildMixingTimeline(track, baselineIds = null) {
  // cardTracks is seeded in initialDeck order, so the key order IS the deck the
  // lesson started from. No compiler change needed to recover it.
  const trackIds = [...track.cards.keys()]
  const originalIds =
    baselineIds && baselineIds.length === trackIds.length ? baselineIds : trackIds
  const originalIndex = new Map(originalIds.map((id, i) => [id, i]))
  const n = originalIds.length
  const colorById = new Map(
    originalIds.map((id, i) => [id, rampHex(n <= 1 ? 0 : i / (n - 1))]),
  )

  // The strip's t=0 state is where THIS run starts, scored against the baseline.
  const start = frameOf(trackIds, originalIndex, true, null)
  const frames = []
  let current = trackIds
  for (const step of track.steps) {
    const derived = settledOrderAt(track, step.tEnd)
    if (derived) current = derived
    frames.push(frameOf(current, originalIndex, Boolean(derived), step.label))
  }
  return { originalIds, originalIndex, colorById, start, frames }
}

// Index of the last step that has fully finished at `ms` (-1 = none yet). The
// order only ever changes on a completed step, which is also why the strip can
// live inside a 12Hz subscription without re-rendering 52 cells per frame.
export function completedStepAt(track, ms) {
  if (!track) return -1
  let last = -1
  for (let i = 0; i < track.steps.length; i++) {
    if (ms >= track.steps[i].tEnd - 1) last = i
  }
  return last
}

export function frameAt(timeline, stepIndex) {
  if (!timeline) return null
  if (stepIndex < 0) return timeline.start
  return timeline.frames[Math.min(stepIndex, timeline.frames.length - 1)] ?? timeline.start
}

// --- view state ------------------------------------------------------------

// Opt-in analysis overlay. Default OFF: the felt and the card backs are the
// point of the scene, and a permanently false-coloured deck would bury them.
// Closing the panel also drops the 3D tint so the table can never be left
// rainbow-coloured behind a hidden control.
export const useMixingView = create((set) => ({
  enabled: false,
  tint: false,
  colors: null, // Map<cardId, hex>, the card's ORIGINAL position, published by OrderStrip
  toggle: () => set((s) => ({ enabled: !s.enabled, tint: s.enabled ? false : s.tint })),
  toggleTint: () => set((s) => ({ tint: !s.tint })),
  setColors: (colors) => set({ colors }),
}))
