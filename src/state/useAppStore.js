import { create } from 'zustand'
import { createDeck } from '../deckModel'

// Discrete / logical / slow-changing app state. Per-frame card + hand transforms
// live in imperative refs (cardRegistry) and the player store. NOT here.
export const useAppStore = create((set) => ({
  // 'visualizer' | 'lesson' | 'playground'
  mode: 'visualizer',
  // logical source of truth for card order + isFaceUp. Changes rarely.
  deck: createDeck(),
  // which lesson is open in lesson mode
  activeLessonId: null,
  // --- repeat ("Shuffle again") ---------------------------------------------
  // A repeat re-runs the SAME technique on the deck the last run left behind,
  // so shuffles compound the way they do at a real table. `lessonRun` bumps the
  // compile seed (a different interleave each time) and forces a recompile.
  // `lessonBaseline` is the card order when the lesson was OPENED and is held
  // across repeats: mixing has to be measured against the pristine deck or
  // every repeat would read "2 rising sequences" again and the whole point -
  // watching a riffle climb toward randomness over ~7 runs, would be lost.
  lessonRun: 0,
  lessonBaseline: null,
  lessonHistory: [], // [{ run, rising, kept, pairs }] appended as each run ends
  // Selected visualizer arrangement (see VISUALIZER_LAYOUTS).
  vizLayout: 'fan',
  // Bumped by the "Flip all" button; VisualizerDriver watches this and runs a
  // staggered flip wave (it owns the animation, so we don't toggle isFaceUp here).
  flipAllNonce: 0,
  camera: { mode: 'orbit', preset: 'overview' },
  // Pixels of viewport the docked UI covers along the bottom. The scene's
  // optical centre is the viewport centre, so a tall transport panel pushes the
  // action behind it. ResponsiveCamera offsets the projection by this much to
  // recentre on the visible strip above the panel.
  uiInset: 0,
  settings: { showHands: false, quality: 'high', reducedMotion: false },

  setMode: (mode) => set({ mode }),
  setDeck: (deck) =>
    set((s) => ({ deck: typeof deck === 'function' ? deck(s.deck) : deck })),
  setVizLayout: (vizLayout) => set({ vizLayout }),
  setUiInset: (uiInset) =>
    set((s) => (Math.abs(s.uiInset - uiInset) < 2 ? s : { uiInset })),
  flipAll: () => set((s) => ({ flipAllNonce: s.flipAllNonce + 1 })),
  openLesson: (activeLessonId) =>
    set((s) => ({
      mode: 'lesson',
      activeLessonId,
      lessonRun: 0,
      lessonBaseline: s.deck.map((c) => c.id),
      lessonHistory: [],
    })),
  // Run the same technique again on whatever the last run left behind.
  repeatLesson: () => set((s) => ({ lessonRun: s.lessonRun + 1 })),
  recordRun: (entry) =>
    set((s) =>
      s.lessonHistory.some((h) => h.run === entry.run)
        ? s
        : { lessonHistory: [...s.lessonHistory, entry] },
    ),
  closeLesson: () =>
    set({ mode: 'visualizer', activeLessonId: null, lessonRun: 0, lessonBaseline: null, lessonHistory: [] }),
  setCameraPreset: (preset) =>
    set((s) => ({ camera: { ...s.camera, preset } })),
  setCameraMode: (mode) =>
    set((s) => ({ camera: { ...s.camera, mode } })),
  toggleHands: () =>
    set((s) => ({ settings: { ...s.settings, showHands: !s.settings.showHands } })),
  setQuality: (quality) =>
    set((s) => ({ settings: { ...s.settings, quality } })),
}))
