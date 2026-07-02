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
  restart: () => set({ globalMs: 0, playing: true, direction: 1 }),
  setSpeed: (speed) => set({ speed }),

  // Called by the transport slider — pauses and snaps to an absolute time.
  scrubTo: (ms) => {
    const { durationMs } = get()
    set({ globalMs: Math.max(0, Math.min(durationMs, ms)), playing: false })
  },

  jumpToStep: (i) => {
    const { track } = get()
    if (!track || !track.steps[i]) return
    set({ globalMs: track.steps[i].tStart, stepIndex: i, playing: false })
  },
  stepNext: () => {
    const { track, stepIndex } = get()
    if (!track) return
    const i = Math.min(track.steps.length - 1, stepIndex + 1)
    set({ globalMs: track.steps[i].tStart, stepIndex: i, playing: false })
  },
  stepPrev: () => {
    const { track, stepIndex } = get()
    if (!track) return
    const i = Math.max(0, stepIndex - 1)
    set({ globalMs: track.steps[i].tStart, stepIndex: i, playing: false })
  },

  // Written by the runner (~12Hz during playback) to keep the scrubber live.
  _mirror: (globalMs, stepIndex) => set({ globalMs, stepIndex }),
}))
