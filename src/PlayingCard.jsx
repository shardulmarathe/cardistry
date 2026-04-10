import { memo } from 'react'

const RED = new Set(['hearts', 'diamonds'])

const SUIT_SYMBOL = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
}

const PlayingCard = memo(function PlayingCard({
  card,
  isFloating,
  mouse = { x: 0, y: 0 },
  onMouseDown,
  onKeyDown,
  flipStaggerMs = 0,
}) {
  const frontUrl = `/assets/card-fronts/${card.id}.png`
  const flipped = !card.isFaceUp

  const innerStyle = {
    transitionDelay:
      flipStaggerMs > 0 ? `${flipStaggerMs}ms` : '0ms',
  }

  const inner = (
    <div className="card-inner" style={innerStyle}>
      <div className="card-front">
        <div className={`card-front-fallback ${RED.has(card.suit) ? 'red' : 'black'}`}>
          <span className="card-front-corner tl">
            {card.rank}
            <span className="card-suit">{SUIT_SYMBOL[card.suit]}</span>
          </span>
          <span className="card-front-center">{SUIT_SYMBOL[card.suit]}</span>
          <span className="card-front-corner br">
            {card.rank}
            <span className="card-suit">{SUIT_SYMBOL[card.suit]}</span>
          </span>
        </div>
        <img
          src={frontUrl}
          alt=""
          className="card-front-photo"
          loading="lazy"
          decoding="async"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
        />
      </div>
      <div className="card-back" aria-hidden />
    </div>
  )

  if (isFloating) {
    return (
      <div
        className={`card floating${flipped ? ' flipped' : ''}`}
        style={{
          '--float-x': `${mouse.x}px`,
          '--float-y': `${mouse.y - 100}px`,
        }}
      >
        {inner}
      </div>
    )
  }

  return (
    <div
      className={`card${flipped ? ' flipped' : ''}`}
      aria-label={`Flip or drag ${card.id}`}
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
      role="button"
      tabIndex={0}
    >
      {inner}
    </div>
  )
})

export default PlayingCard
