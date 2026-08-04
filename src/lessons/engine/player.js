import { create } from 'zustand'

// Playback scalars only. The heavy per-frame work (sampling + writing meshes)
// happens in LessonRunner's useFrame reading getState(); this store re-renders
// only the transport UI, and only on discrete changes.
export const usePlayer = create((set, get) => ({
  lessonId: null,
  track: null,
  durationMs: 0,
  globalMs: 0,
  stepIndex: 0,
  playing: false,
  speed: 1,
  direction: 1,
  // Bumped by every SEEK. LessonRunner integrates time in its own ref while
  // playing and only reads globalMs when paused, so a seek that also leaves the
  // player playing (restart) was silently ignored, the ▶ button at the end of
  // a lesson re-clamped to the end and did nothing. The runner watches this
  // counter and adopts globalMs whenever it changes, in either play state.
  seekNonce: 0,

  loadTrack: (lessonId, track) =>
    set({
      lessonId,
      track,
      durationMs: track.duration,
      globalMs: 0,
      stepIndex: 0,
      playing: true,
      direction: 1,
      speed: 1,
    }),

  clear: () => set({ lessonId: null, track: null, playing: false, globalMs: 0 }),

  play: () => set({ playing: true, direction: 1 }),
  pause: () => set({ playing: false }),
  toggle: () => set((s) => ({ playing: !s.playing })),
  restart: () =>
    set((s) => ({ globalMs: 0, playing: true, direction: 1, seekNonce: s.seekNonce + 1 })),
  setSpeed: (speed) => set({ speed }),

  // Called by the transport slider, pauses and snaps to an absolute time.
  scrubTo: (ms) => {
    const { durationMs, track } = get()
    const globalMs = Math.max(0, Math.min(durationMs, ms))
    let stepIndex = 0
    if (track) {
      for (let i = track.steps.length - 1; i >= 0; i--) {
        if (globalMs >= track.steps[i].tStart) {
          stepIndex = i
          break
        }
      }
    }
    set((s) => ({ globalMs, stepIndex, playing: false, seekNonce: s.seekNonce + 1 }))
  },

  jumpToStep: (i) => {
    const { track } = get()
    if (!track || !track.steps[i]) return
    set((s) => ({ globalMs: track.steps[i].tStart, stepIndex: i, playing: false, seekNonce: s.seekNonce + 1 }))
  },
  stepNext: () => {
    const { track, stepIndex } = get()
    if (!track) return
    const i = Math.min(track.steps.length - 1, stepIndex + 1)
    set((s) => ({ globalMs: track.steps[i].tStart, stepIndex: i, playing: false, seekNonce: s.seekNonce + 1 }))
  },
  stepPrev: () => {
    const { track, stepIndex } = get()
    if (!track) return
    const i = Math.max(0, stepIndex - 1)
    set((s) => ({ globalMs: track.steps[i].tStart, stepIndex: i, playing: false, seekNonce: s.seekNonce + 1 }))
  },

  // Written by the runner (~12Hz during playback) to keep the scrubber live.
  _mirror: (globalMs, stepIndex) => set({ globalMs, stepIndex }),
}))
