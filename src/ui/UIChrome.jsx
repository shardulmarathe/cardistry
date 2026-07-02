import { useAppStore } from '../state/useAppStore'
import LessonCatalog from './LessonCatalog'
import TransportBar from './TransportBar'
import VisualizerControls from './VisualizerControls'
import './chrome.css'

// DOM overlay above the Canvas. The root ignores pointer events so orbit/click
// still reach the felt; individual controls re-enable them.
export default function UIChrome() {
  const mode = useAppStore((s) => s.mode)
  const setMode = useAppStore((s) => s.setMode)
  const activeLessonId = useAppStore((s) => s.activeLessonId)

  return (
    <div className="chrome">
      <header className="chrome-top">
        <div className="brand">
          <span className="brand-suit">♠</span>
          <span className="brand-word">Cardistry</span>
        </div>
        <nav className="mode-tabs" aria-label="Mode">
          <button
            type="button"
            className={`tab${mode === 'visualizer' ? ' is-active' : ''}`}
            onClick={() => setMode('visualizer')}
          >
            Visualizer
          </button>
          <button
            type="button"
            className={`tab${mode === 'lesson' ? ' is-active' : ''}`}
            onClick={() => setMode('lesson')}
          >
            Learn
          </button>
        </nav>
        <div className="top-spacer" />
      </header>

      {mode === 'visualizer' && <VisualizerControls />}
      {mode === 'lesson' && !activeLessonId && <LessonCatalog />}
      {mode === 'lesson' && activeLessonId && <TransportBar />}
    </div>
  )
}
