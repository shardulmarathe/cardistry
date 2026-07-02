import { create } from 'zustand'
import { createDeck } from '../deckModel'

// Discrete / logical / slow-changing app state. Per-frame card + hand transforms
// live in imperative refs (cardRegistry) and the player store — NOT here.
export const useAppStore = create((set) => ({
  // 'visualizer' | 'lesson' | 'playground'
  mode: 'visualizer',
  // logical source of truth for card order + isFaceUp. Changes rarely.
  deck: createDeck(),
  // which lesson is open in lesson mode
  activeLessonId: null,
  // Selected visualizer arrangement (see VISUALIZER_LAYOUTS).
  vizLayout: 'fan',
  camera: { mode: 'orbit', preset: 'overview' },
  settings: { showHands: false, quality: 'high', reducedMotion: false },

  setMode: (mode) => set({ mode }),
  setDeck: (deck) =>
    set((s) => ({ deck: typeof deck === 'function' ? deck(s.deck) : deck })),
  setVizLayout: (vizLayout) => set({ vizLayout }),
  flipAll: () =>
    set((s) => ({ deck: s.deck.map((c) => ({ ...c, isFaceUp: !c.isFaceUp })) })),
  openLesson: (activeLessonId) =>
    set({ mode: 'lesson', activeLessonId }),
  closeLesson: () => set({ mode: 'visualizer', activeLessonId: null }),
  setCameraPreset: (preset) =>
    set((s) => ({ camera: { ...s.camera, preset } })),
  setCameraMode: (mode) =>
    set((s) => ({ camera: { ...s.camera, mode } })),
  toggleHands: () =>
    set((s) => ({ settings: { ...s.settings, showHands: !s.settings.showHands } })),
  setQuality: (quality) =>
    set((s) => ({ settings: { ...s.settings, quality } })),
}))
