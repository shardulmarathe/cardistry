export function createDeck() {
  const suits = ['hearts', 'diamonds', 'clubs', 'spades']
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

  const deck = []

  suits.forEach((suit) => {
    ranks.forEach((rank) => {
      deck.push({
        id: `${rank}-${suit}`,
        suit,
        rank,
        isFaceUp: false,
      })
    })
  })

  return deck
}
