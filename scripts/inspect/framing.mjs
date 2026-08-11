// Where is each lesson's action, actually? A camera preset aimed at the felt
// (y ~ 0.3) frames a move that happens in the air (y ~ 1.0) against the top of
// the frame with a third of the shot empty table. This measures the real
// bounding box of every card and wrist over a whole track, so camera targets can
// be derived from the move instead of guessed.
//
// Run: node --import ./scripts/verify/register.mjs scripts/inspect/framing.mjs
import { LESSONS } from '../../src/lessons/catalog/index.js'
import { compileLesson } from '../../src/lessons/engine/compileLesson.js'
import { sampleTrack } from '../../src/lessons/engine/sampleTrack.js'
import { createDeck } from '../../src/deckModel.js'
import { CAMERA_PRESETS } from '../../src/lib/constants.js'
import { CARD_H } from '../../src/lib/constants.js'
import * as THREE from 'three'

const pad = (s, n) => String(s).padEnd(n)
const N = 120

console.log(
  pad('lesson', 10),
  pad('cards y', 16),
  pad('cards x', 16),
  pad('wrists y', 16),
  pad('busiest y', 10),
  'presets used -> their targets',
)
for (const l of LESSONS) {
  const track = compileLesson(l, createDeck())
  let cy = [Infinity, -Infinity]
  let cx = [Infinity, -Infinity]
  let cz = [Infinity, -Infinity]
  let wy = [Infinity, -Infinity]
  // Weight by how much card mass sits at each height: the "busiest" band is what
  // the camera should actually aim at, not the midpoint of the extremes.
  const bins = new Map()
  const wsamp = []
  for (let i = 0; i <= N; i++) {
    const scene = sampleTrack(track, (track.duration * i) / N)
    for (const [, c] of scene.cards) {
      cy = [Math.min(cy[0], c.pos.y), Math.max(cy[1], c.pos.y)]
      cx = [Math.min(cx[0], c.pos.x), Math.max(cx[1], c.pos.x)]
      cz = [Math.min(cz[0], c.pos.z), Math.max(cz[1], c.pos.z)]
      const b = Math.round(c.pos.y * 10) / 10
      bins.set(b, (bins.get(b) ?? 0) + 1)
    }
    for (const side of ['left', 'right']) {
      const h = scene.hands[side]
      if (h) {
        wy = [Math.min(wy[0], h.wrist.pos.y), Math.max(wy[1], h.wrist.pos.y)]
        wsamp.push(h.wrist.pos.y)
      }
    }
  }
  const busiest = [...bins.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const presets = new Set([l.cameraPreset, ...track.cameraByStep.map((c) => c.preset)])
  const shown = [...presets]
    .filter(Boolean)
    .map((p) => `${p}(y${CAMERA_PRESETS[p] ? CAMERA_PRESETS[p].target[1] : '?'})`)
    .join(' ')
  // KNOWN FALSE POSITIVE: the verdict takes the WORST aim across every preset a
  // lesson uses, so a lesson that legitimately changes shot gets flagged. Charlier
  // reports "off by 0.72" because it ends on `overview` (y 0.15) as the deck is set
  // down on the table, which is the correct shot for that beat. Judging per-preset
  // against only the steps that use it would fix this; until then, read the flag as
  // "look at this lesson", not "this lesson is wrong".
  //
  // Judge on ROBUST CENTRES, not extremes. A whole-track min/max sweeps in every
  // transient - a hand lifting away at the end of the overhand touches y 1.90 - so
  // an extremes-based verdict flags every lesson and means nothing. The busiest
  // card band and the MEDIAN wrist height are what the shot has to hold.
  wsamp.sort((a, b) => a - b)
  const wMed = wsamp.length ? wsamp[wsamp.length >> 1] : null
  const centre = wMed === null ? busiest : (busiest + wMed) / 2
  const aims = [...presets].filter(Boolean).map((p) => CAMERA_PRESETS[p]?.target[1]).filter((v) => v !== undefined)
  const worstAim = aims.length ? Math.max(...aims.map((a) => Math.abs(centre - a))) : 0
  console.log(
    pad(l.id, 10),
    pad(`${cy[0].toFixed(2)} .. ${cy[1].toFixed(2)}`, 16),
    pad(`${cx[0].toFixed(2)} .. ${cx[1].toFixed(2)}`, 16),
    pad(wy[0] === Infinity ? 'none' : `${wy[0].toFixed(2)} .. ${wy[1].toFixed(2)}`, 16),
    pad(busiest.toFixed(1), 10),
    shown,
    `| z ${cz[0].toFixed(2)}..${cz[1].toFixed(2)}` +
      ` | wrist med ${wMed === null ? ' - ' : wMed.toFixed(2)} want ~${centre.toFixed(2)}` +
      (worstAim > 0.35 ? ` AIM OFF ${worstAim.toFixed(2)}` : ' aim ok') +
      // DOES THE SUBJECT FIT? Aim is only half of framing. An earlier version of
      // this tool checked the aim alone and passed the wash, whose spread overflows
      // the frame on three sides. Compare the subject's half-extents against what
      // each preset can see at the subject's own distance.
      (() => {
        const spanX = Math.max(Math.abs(cx[0]), Math.abs(cx[1])) + CARD_H / 2
        const spanZ = Math.max(Math.abs(cz[0]), Math.abs(cz[1])) + CARD_H / 2
        const bad = []
        for (const p of presets) {
          const P = CAMERA_PRESETS[p]
          if (!P) continue
          const eye = new THREE.Vector3(...P.position)
          const tgt = new THREE.Vector3(...P.target)
          const d = eye.distanceTo(tgt)
          const halfH = d * Math.tan((P.fov * Math.PI) / 360)
          const halfW = halfH * (1200 / 860)
          // The transport panel covers roughly the bottom 40%, so only ~60% of the
          // frame height is usable for the subject.
          if (spanX > halfW || spanZ > halfH * 0.6) bad.push(p)
        }
        return bad.length ? `  <-- OVERFLOWS ${bad.join(',')}` : ''
      })(),
  )
}
