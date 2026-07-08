// Named easing functions referenced by lesson steps.
export const EASES = {
  linear: (t) => t,
  easeInOutCubic: (t) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInCubic: (t) => t * t * t,
  easeOutBack: (t) => {
    const c1 = 1.70158
    const c3 = c1 + 1
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
  },
  // Gentler overshoot (~4%) — fingers closing onto a grip, packets squaring.
  easeOutBackSoft: (t) => {
    const c1 = 0.9
    const c3 = c1 + 1
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
  },
  // Dips ~4% below the start before committing — the wind-up before a reach.
  anticipate: (t) => {
    const c1 = 1.70158
    const c3 = c1 + 1
    return c3 * t * t * t - c1 * t * t
  },
  // Damped-spring settle: fast rise, overshoot, ring down. The (1-t) factor
  // pins the endpoint at exactly 1 so segment boundaries stay pop-free.
  settle: (t) => 1 - Math.exp(-7 * t) * Math.cos(3 * Math.PI * t) * (1 - t),
  // Fast commit then a long soft landing — a packet dropped onto a pile.
  snapEase: (t) => 1 - Math.pow(1 - t, 5),
}

export function getEase(name) {
  return EASES[name] || EASES.easeInOutCubic
}

export function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x
}
