// Mixing strength as a real signal: four pips + the technique's authored word.
// Shared by the picker (choose between four techniques) and the mixing dock
// (what this technique claims, next to what it actually did).

// `randomizes` is authored prose. Ranked 0..4 so the two readings sit on one
// scale. ('Strong' used to fall through to zero here, which drew the riffle -
// the strongest shuffle in the app - with an empty meter.)
function mixLevel(strength = '') {
  const k = strength.toLowerCase()
  if (k.startsWith('excellent') || k.startsWith('strong')) return 4
  if (k.startsWith('very good')) return 3
  if (k.startsWith('good') || k.startsWith('moderate')) return 2
  if (k.startsWith('weak')) return 1
  return 0
}

export default function MixMeter({ strength, className = '' }) {
  const level = mixLevel(strength)
  return (
    <span className={`mix mix-l${level} ${className}`.trim()}>
      <span className="mix-pips" aria-hidden="true">
        <i className={level > 0 ? 'on' : ''} />
        <i className={level > 1 ? 'on' : ''} />
        <i className={level > 2 ? 'on' : ''} />
        <i className={level > 3 ? 'on' : ''} />
      </span>
      <span className="mix-value">{strength}</span>
    </span>
  )
}
