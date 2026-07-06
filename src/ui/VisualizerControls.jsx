import { useAppStore } from '../state/useAppStore'
import { createDeck } from '../deckModel'
import { VISUALIZER_LAYOUTS } from '../lessons/engine/layouts'

export default function VisualizerControls() {
  const setDeck = useAppStore((s) => s.setDeck)
  const flipAll = useAppStore((s) => s.flipAll)
  const vizLayout = useAppStore((s) => s.vizLayout)
  const setVizLayout = useAppStore((s) => s.setVizLayout)

  return (
    <div className="viz-controls">
      <div className="viz-layouts" role="group" aria-label="Layout">
        {VISUALIZER_LAYOUTS.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`viz-layout-btn${vizLayout === l.id ? ' is-active' : ''}`}
            onClick={() => setVizLayout(l.id)}
          >
            {l.label}
          </button>
        ))}
      </div>

      <div className="viz-actions">
        <p className="viz-hint">
          <span className="k">Tap a card</span> to flip
          <span className="dot">·</span>
          <span className="k">Drag a card</span> to reorder
          <span className="dot">·</span>
          <span className="k">Drag felt</span> to orbit
        </p>
        <div className="viz-buttons">
          <button type="button" className="ghost-btn" onClick={flipAll}>
            Flip all
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => setDeck(createDeck())}
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  )
}
