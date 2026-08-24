import { useAppStore } from '../state/useAppStore'

// SHOW FACES. Every technique is authored on a face-down deck, which is correct
// (that is how you shuffle) but it means 52 identical backs go into the weave and
// 52 identical backs come out - you cannot see WHICH cards moved. Turning the
// deck over is the difference between watching an animation and reading a
// shuffle. It writes the real per-card flag, so the choice survives into the
// visualizer, and it can be hit at any time, mid-interlace included.
export default function FacesToggle({ className = '' }) {
  const deck = useAppStore((s) => s.deck)
  const setAllFaces = useAppStore((s) => s.setAllFaces)
  // "Mostly face-up" rather than "all", so a deck with a few cards flipped in
  // the visualizer still has one sensible next state.
  const facesUp = deck.filter((c) => c.isFaceUp).length * 2 > deck.length

  return (
    <button
      type="button"
      className={`faces-btn${facesUp ? ' is-on' : ''} ${className}`.trim()}
      aria-pressed={facesUp}
      title="Turn the deck over so you can see which cards are being shuffled"
      onClick={() => setAllFaces(!facesUp)}
    >
      <span className="faces-glyph" aria-hidden="true">
        {facesUp ? '🂡' : '🂠'}
      </span>
      {facesUp ? 'Hide faces' : 'Show faces'}
    </button>
  )
}
