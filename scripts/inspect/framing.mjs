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
  let wy = [Infinity, -Infinity]
  // Weight by how much card mass sits at each height: the "busiest" band is what
  // the camera should actually aim at, not the midpoint of the extremes.
  const bins = new Map()
  for (let i = 0; i <= N; i++) {
    const scene = sampleTrack(track, (track.duration * i) / N)
    for (const [, c] of scene.cards) {
      cy = [Math.min(cy[0], c.pos.y), Math.max(cy[1], c.pos.y)]
      cx = [Math.min(cx[0], c.pos.x), Math.max(cx[1], c.pos.x)]
      const b = Math.round(c.pos.y * 10) / 10
      bins.set(b, (bins.get(b) ?? 0) + 1)
    }
    for (const side of ['left', 'right']) {
      const h = scene.hands[side]
      if (h) wy = [Math.min(wy[0], h.wrist.pos.y), Math.max(wy[1], h.wrist.pos.y)]
    }
  }
  const busiest = [...bins.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const presets = new Set([l.cameraPreset, ...track.cameraByStep.map((c) => c.preset)])
  const shown = [...presets]
    .filter(Boolean)
    .map((p) => `${p}(y${CAMERA_PRESETS[p] ? CAMERA_PRESETS[p].target[1] : '?'})`)
    .join(' ')
  console.log(
    pad(l.id, 10),
    pad(`${cy[0].toFixed(2)} .. ${cy[1].toFixed(2)}`, 16),
    pad(`${cx[0].toFixed(2)} .. ${cx[1].toFixed(2)}`, 16),
    pad(wy[0] === Infinity ? 'none' : `${wy[0].toFixed(2)} .. ${wy[1].toFixed(2)}`, 16),
    pad(busiest.toFixed(1), 10),
    shown,
  )
}
