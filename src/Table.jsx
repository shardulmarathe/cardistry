import Deck from './Deck'
import './Table.css'

export default function Table() {
  return (
    <div className="table-container">
      <div className="casino-background" aria-hidden />
      <div className="overlay-gradient" aria-hidden />
      <div className="table-surface" aria-hidden />
      <Deck />
    </div>
  )
}
