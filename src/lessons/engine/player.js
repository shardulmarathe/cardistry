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
  // Has the viewer started this run yet? A lesson used to autoplay the moment
  // it compiled, which meant opening a technique threw you into the middle of a
  // 20-second shuffle with no way to watch it from the top. Now a freshly loaded
  // track sits parked at 0 and the panel offers one primary action; `started`
  // flips on the first play and stays true for the rest of the run, so the
  // transport reverts to its normal controls instead of re-arming at every
  // pause.
  started: false,
  // Bumped by every SEEK. LessonRunner integrates time in its own ref while
  // playing and only reads globalMs when paused, so a seek that also leaves the
  // player playing (restart) was silently ignored, the ▶ button at the end of
  // a lesson re-clamped to the end and did nothing. The runner watches this
  // counter and adopts globalMs whenever it changes, in either play state.
  seekNonce: 0,

  // Loads PAUSED at frame 0, on purpose. `seekNonce` is bumped so the runner
  // adopts ms 0 immediately: switching technique mid-shuffle must stop the old
  // one and present the new one from the top, not inherit its cursor.
  loadTrack: (lessonId, track) =>
    set((s) => ({
      lessonId,
      track,
      durationMs: track.duration,
      globalMs: 0,
      stepIndex: 0,
      playing: false,
      started: false,
      direction: 1,
      speed: 1,
      seekNonce: s.seekNonce + 1,
    })),

  clear: () =>
    set((s) => ({
      lessonId: null,
      track: null,
      playing: false,
      started: false,
      globalMs: 0,
      stepIndex: 0,
      seekNonce: s.seekNonce + 1,
    })),

  play: () => set({ playing: true, started: true, direction: 1 }),
  pause: () => set({ playing: false }),
  toggle: () => set((s) => ({ playing: !s.playing, started: true })),
  restart: () =>
    set((s) => ({
      globalMs: 0,
      playing: true,
      started: true,
      direction: 1,
      seekNonce: s.seekNonce + 1,
    })),
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
