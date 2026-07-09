import { washLesson } from './wash.lesson'
import { overhandLesson } from './overhand.lesson'
import { hinduLesson } from './hindu.lesson'
import { stripLesson } from './strip.lesson'
import { charlierLesson } from './charlier.lesson'
import { riffleLesson } from './riffle.lesson'
import { waterfallLesson } from './waterfall.lesson'
import { faroLesson } from './faro.lesson'

// Beginner → advanced.
export const LESSONS = [
  washLesson,
  overhandLesson,
  hinduLesson,
  stripLesson,
  charlierLesson,
  riffleLesson,
  waterfallLesson,
  faroLesson,
]

export const DIFFICULTY_ORDER = ['beginner', 'intermediate', 'advanced']
export const DIFFICULTY_LABEL = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
}

// Load-bearing randomness facts surfaced in the catalog info panel.
export const RANDOMNESS_GUIDE = [
  { technique: 'Riffle', strength: 'Excellent', detail: '~7 riffles randomize a 52-card deck (Bayer–Diaconis cutoff).' },
  { technique: 'Wash', strength: 'Very good', detail: 'Cards move freely in 2D — one of the strongest physical shuffles.' },
  { technique: 'Overhand / Hindu / Strip', strength: 'Weak', detail: 'Only transports blocks — thousands of shuffles needed to truly mix.' },
  { technique: 'Pile deal', strength: 'None', detail: 'Round-robin dealing is deterministic — it does not randomize by itself.' },
  { technique: 'Faro', strength: 'None — controlled', detail: 'Deterministic weave — 8 perfect out-faros restore the original order.' },
  { technique: 'Cuts & flourishes', strength: 'Display only', detail: 'Charlier, fans, and waterfalls rearrange or display — they do not mix.' },
]

export const GRIP_GLOSSARY = [
  { name: "Dealer's grip", detail: 'Long edges parallel to the table — the standard dealing hold.' },
  { name: "Mechanic's grip", detail: 'Similar to dealer\'s, but the index finger runs along the short edge for control.' },
  { name: 'Biddle grip', detail: 'Pinch the long edges between thumb and middle finger — common for cuts.' },
  { name: 'End grip', detail: 'Hold the short ends between thumb and fingers — used for Hindu shuffles.' },
  { name: 'Z-grip', detail: 'Thumb on one corner, fingers on the opposite — the fan and pivot grip.' },
]

export function getLessonsByDifficulty() {
  return DIFFICULTY_ORDER.map((difficulty) => ({
    difficulty,
    lessons: LESSONS.filter((l) => l.difficulty === difficulty),
  })).filter((g) => g.lessons.length > 0)
}

export function getLessonById(id) {
  return LESSONS.find((l) => l.id === id)
}
