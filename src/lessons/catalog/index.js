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

// The randomness reference table and the grip glossary that used to live here
// are gone with the catalog's "Mixing & grips" sheet. Both were prose ASSERTING
// things the app can now SHOW: each technique carries its own `randomizes`
// rating (the picker's meter, the mixing dock's header) and the dock scores the
// real deck run by run, which is the same claim made checkable.

export function getLessonById(id) {
  return LESSONS.find((l) => l.id === id)
}
