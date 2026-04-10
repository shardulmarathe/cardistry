import { forwardRef } from 'react'
import PlayingCard from './PlayingCard'

/** Matches Deck fan-off stack layout — keep in sync with fan stack branch. */
export function getDeckStackTransform(i) {
  return `translateY(${i * -3}px) translateX(${i * 1.2}px)`
}

/**
 * Single stacked deck presentation (same card size, stacking, CSS as Deck tab stack mode).
 */
const DeckStack = forwardRef(function DeckStack(
  {
    cards,
    className = '',
    omitCardId,
    onStackClick,
    bulkFlipActive = false,
    flipStaggerMsStep = 7,
    isDragging = false,
    onCardMouseDown,
    onCardKeyDown,
    getLayerStyle,
  },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`deck-stack${className ? ` ${className}` : ''}`}
      onClick={onStackClick}
      role="presentation"
    >
      {cards.map((card, i) => {
        if (omitCardId && card.id === omitCardId) {
          return null
        }

        const positionTransform = getDeckStackTransform(i)
        const layerStyle = getLayerStyle
          ? getLayerStyle(i, card, positionTransform)
          : { transform: positionTransform }
        const staggerMs =
          bulkFlipActive && !isDragging ? i * flipStaggerMsStep : 0

        return (
          <div
            key={card.id}
            className="deck-card-layer"
            style={{ zIndex: i }}
            data-deck-index={i}
          >
            <div
              className="card-position"
              style={layerStyle}
            >
              <PlayingCard
                card={card}
                isFloating={false}
                flipStaggerMs={staggerMs}
                onMouseDown={onCardMouseDown}
                onKeyDown={onCardKeyDown}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
})

export default DeckStack
