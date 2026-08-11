// DEV-ONLY inspection bridge. Imported dynamically from main.jsx behind
// `import.meta.env.DEV`, so it is never in a production bundle.
//
// Why it exists: the extension/DevTools cannot screenshot a WebGL canvas whose
// context is created without `preserveDrawingBuffer`, and driving the transport
// by clicking a slider is neither deterministic nor frame-accurate. Automated
// visual review (scripts/inspect/captureFrames.mjs) needs to (a) open a lesson
// by id, (b) park the player at an exact millisecond, (c) know when a frame for
// that millisecond has actually been painted, and (d) read the same numbers the
// headless harness reads, from the live scene.
import { useAppStore } from './state/useAppStore'
import { usePlayer } from './lessons/engine/player'
import { LESSONS, getLessonById } from './lessons/catalog'
import { compileLesson } from './lessons/engine/compileLesson'
import { sampleTrack } from './lessons/engine/sampleTrack'

// Bumped by CanvasRoot's render loop so a capture can await a PAINTED frame
// rather than guessing with a timeout.
export const frameCounter = { n: 0 }

window.__cardistry = {
  stores: { app: useAppStore, player: usePlayer },
  lessons: LESSONS.map((l) => ({ id: l.id, title: l.title })),
  getLessonById,
  compileLesson,
  sampleTrack,
  frameCounter,

  openLesson(id) {
    useAppStore.getState().openLesson(id)
  },
  setCameraPreset(preset) {
    useAppStore.getState().setCameraPreset(preset)
  },
  // Park the player. Returns the track duration so the driver can plan times.
  scrubTo(ms) {
    usePlayer.getState().scrubTo(ms)
    return usePlayer.getState().durationMs
  },
  trackInfo() {
    const { track, durationMs } = usePlayer.getState()
    if (!track) return null
    return {
      durationMs,
      steps: track.steps.map((s) => ({ id: s.id, tStart: s.tStart, tEnd: s.tEnd, label: s.label })),
      holds: (track.holds ?? []).map((h) => ({
        side: h.side,
        frame: h.frame,
        tStart: h.tStart,
        tEnd: h.tEnd,
        cards: h.offsets.size,
      })),
    }
  },
  // Live pose readout at the current cursor, for numeric spot-checks that the
  // headless harness cannot make (it has no renderer, so no camera framing).
  sampleNow() {
    const { track, globalMs } = usePlayer.getState()
    if (!track) return null
    const scene = sampleTrack(track, globalMs)
    const hand = (side) => {
      const h = scene.hands[side]
      if (!h) return null
      return {
        wrist: { pos: h.wrist.pos.toArray(), quat: h.wrist.quat.toArray() },
        fingers: h.fingers,
        spread: h.spread,
      }
    }
    return {
      ms: globalMs,
      left: hand('left'),
      right: hand('right'),
      cards: [...scene.cards].map(([id, c]) => ({
        id,
        pos: c.pos.toArray(),
        quat: c.quat.toArray(),
        bend: c.bend,
      })),
    }
  },
}
