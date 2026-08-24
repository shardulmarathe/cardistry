import { create } from 'zustand'
import { createDeck } from '../deckModel'

// Discrete / logical / slow-changing app state. Per-frame card + hand transforms
// live in imperative refs (cardRegistry) and the player store. NOT here.
export const useAppStore = create((set) => ({
  // 'visualizer' | 'lesson'
  mode: 'visualizer',
  // ONE deck, shared by both tabs. Card ORDER and each card's isFaceUp are the
  // only things that cross the tab boundary: reorder or flip cards in the
  // visualizer and Learn shuffles that deck; finish a shuffle in Learn and the
  // visualizer lays out the shuffled order. The visualizer's ARRANGEMENT
  // (fan/ring/grid) deliberately does not follow - Learn always squares the deck
  // in the middle of the table, which is where every technique starts from.
  deck: createDeck(),
  // which technique is running in Learn (null = the four-way picker)
  activeLessonId: null,
  // --- a Learn run ----------------------------------------------------------
  // `lessonRun` bumps on "Shuffle again": the same technique runs again on the
  // deck the last run left behind (a different interleave each time), so
  // shuffles compound the way they do at a real table.
  // TWO REFERENCE ORDERS, because the dock answers two different questions.
  // `lessonBaseline` is "what did THIS run do": re-snapped on every "Shuffle
  // again" to the deck that run starts from, so the dock's start/now strip and
  // its two numbers always compare before and after of the shuffle you just
  // watched. A Replay does NOT re-snap it - replaying the same track cannot
  // change what that track did.
  // `lessonOrigin` is "how far have we come": the order when the technique was
  // picked, held across repeats, so the run-by-run pips show shuffles COMPOUND
  // toward randomness (the ~7-riffle result) instead of reporting the same
  // one-shuffle figure every time.
  lessonRun: 0,
  lessonBaseline: null,
  lessonOrigin: null,
  lessonHistory: [], // [{ run, rising, kept, pairs }] appended as each run ends
  // Selected visualizer arrangement (see VISUALIZER_LAYOUTS).
  vizLayout: 'fan',
  // Bumped by the "Flip all" button; VisualizerDriver watches this and runs a
  // staggered flip wave (it owns the animation, so we don't toggle isFaceUp here).
  flipAllNonce: 0,
  camera: { mode: 'orbit', preset: 'overview' },
  // Pixels of viewport the docked UI covers along the bottom / the right. The
  // scene's optical centre is the viewport centre, so a tall step bar pushes the
  // action behind it and the mixing dock pushes it sideways. ResponsiveCamera
  // offsets the projection by both so the shuffle stays framed in what's left.
  uiInset: 0,
  uiInsetRight: 0,
  settings: { showHands: false, quality: 'high', reducedMotion: false },

  setMode: (mode) => set({ mode }),
  setDeck: (deck) =>
    set((s) => ({ deck: typeof deck === 'function' ? deck(s.deck) : deck })),
  setVizLayout: (vizLayout) => set({ vizLayout }),
  setUiInset: (uiInset) =>
    set((s) => (Math.abs(s.uiInset - uiInset) < 2 ? s : { uiInset })),
  setUiInsetRight: (uiInsetRight) =>
    set((s) => (Math.abs(s.uiInsetRight - uiInsetRight) < 2 ? s : { uiInsetRight })),
  flipAll: () => set((s) => ({ flipAllNonce: s.flipAllNonce + 1 })),

  // Turn the whole deck over. Used by Learn's "Show faces" toggle, which exists
  // so you can watch WHICH cards interleave instead of 52 identical backs. It
  // writes the real per-card flag rather than a render-time override, so the
  // faces you chose are still there when you switch to the visualizer.
  setAllFaces: (isFaceUp) =>
    set((s) => ({
      deck: s.deck.every((c) => c.isFaceUp === isFaceUp)
        ? s.deck
        : s.deck.map((c) => (c.isFaceUp === isFaceUp ? c : { ...c, isFaceUp })),
    })),

  openLesson: (activeLessonId) =>
    set((s) => ({
      mode: 'lesson',
      activeLessonId,
      lessonRun: 0,
      lessonBaseline: s.deck.map((c) => c.id),
      lessonOrigin: s.deck.map((c) => c.id),
      lessonHistory: [],
    })),
  // Run the same technique again on whatever the last run left behind, and
  // re-snap the baseline to that order: the deck as it is NOW becomes the new
  // "started" row, so the next reading measures the next shuffle.
  repeatLesson: () =>
    set((s) => ({
      lessonRun: s.lessonRun + 1,
      lessonBaseline: s.deck.map((c) => c.id),
    })),
  recordRun: (entry) =>
    set((s) =>
      s.lessonHistory.some((h) => h.run === entry.run)
        ? s
        : { lessonHistory: [...s.lessonHistory, entry] },
    ),
  // Back to the four-way picker. The deck is LEFT AS SHUFFLED - whatever the
  // technique did to it stands, exactly as it would at a table, and the next
  // technique (or the visualizer) picks it up from there.
  closeLesson: () =>
    set({
      activeLessonId: null,
      lessonRun: 0,
      lessonBaseline: null,
      lessonOrigin: null,
      lessonHistory: [],
    }),
  setCameraPreset: (preset) =>
    set((s) => ({ camera: { ...s.camera, preset } })),
  setCameraMode: (mode) =>
    set((s) => ({ camera: { ...s.camera, mode } })),
  toggleHands: () =>
    set((s) => ({ settings: { ...s.settings, showHands: !s.settings.showHands } })),
  setQuality: (quality) =>
    set((s) => ({ settings: { ...s.settings, quality } })),
}))
