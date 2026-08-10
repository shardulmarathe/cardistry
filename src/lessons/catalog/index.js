import { washLesson } from './wash.lesson'
import { overhandLesson } from './overhand.lesson'
import { charlierLesson } from './charlier.lesson'
import { riffleLesson } from './riffle.lesson'

// FOUR TECHNIQUES, CHOSEN TO LOOK SEVERELY DIFFERENT FROM EACH OTHER.
//
// This was eight across three difficulty tiers, and most of them taught the same
// thing twice. Hindu, strip and overhand are all "transport a block"; faro and the
// tabled riffle are both "interlace two halves". A viewer cannot tell those apart,
// so the effort spent on the variants bought nothing while none of the four moves
// that DO look distinct looked convincing.
//
// What is left is one instance of each genuinely distinct motion:
//   wash      cards slid flat across the felt in two dimensions
//   overhand  packets stripped off a pack and dropped into the other hand
//   charlier  a one-handed cut, entirely in the fingers
//   riffle    two halves interlaced and bridged, in the hands
//
// Difficulty tiers are gone too. With four techniques the grouping was more
// chrome than signal, and it encouraged the "beginner" ones to be treated as
// throwaways.
export const LESSONS = [washLesson, overhandLesson, charlierLesson, riffleLesson]

// Load-bearing randomness facts surfaced in the catalog info panel.
export const RANDOMNESS_GUIDE = [
  { technique: 'Riffle', strength: 'Excellent', detail: '~7 riffles randomize a 52-card deck (Bayer–Diaconis cutoff).' },
  { technique: 'Wash', strength: 'Very good', detail: 'Cards move freely in 2D — one of the strongest physical shuffles.' },
  { technique: 'Overhand', strength: 'Weak', detail: 'Only transports blocks — thousands of shuffles needed to truly mix.' },
  { technique: 'Charlier cut', strength: 'Display only', detail: 'A cut moves a block to the other end; it does not mix at all.' },
]

// Only the grips the app actually implements. This list used to name five,
// including three the engine has no vocabulary for, which made the glossary a
// description of a different program.
export const GRIP_GLOSSARY = [
  { name: "Dealer's grip", detail: 'Long edges parallel to the table — the standard dealing hold.' },
  { name: 'Straddle grip', detail: 'Deck in the palm, thumb on one long edge and the fingers wrapped round the other — the one-handed cut and spring hold.' },
  { name: 'End grip', detail: 'Hold the short ends between thumb and fingers — how a packet is carried clear of the deck.' },
]

export function getLessonById(id) {
  return LESSONS.find((l) => l.id === id)
}
