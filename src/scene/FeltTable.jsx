import { useMemo } from 'react'
import * as THREE from 'three'
import { COLORS } from '../lib/constants'

// A large felt surface with a runtime radial-gradient texture (matching App.css)
// plus a faint fibrous nap. Receives shadows from the cards.
function makeFeltTexture() {
  const size = 1024
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  // Radial oxblood gradient — lit pool at center fading to dark edge.
  const g = ctx.createRadialGradient(
    size / 2,
    size * 0.46,
    size * 0.05,
    size / 2,
    size * 0.5,
    size * 0.62,
  )
  g.addColorStop(0, '#9e2434')
  g.addColorStop(0.32, COLORS.feltCore)
  g.addColorStop(0.62, COLORS.feltMid)
  g.addColorStop(1, COLORS.feltEdge)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)

  // Subtle cloth nap: fine crossed strokes, very low alpha.
  ctx.globalAlpha = 0.035
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * size
    const y = Math.random() * size
    const len = 3 + Math.random() * 5
    ctx.strokeStyle = Math.random() > 0.5 ? '#ffffff' : '#000000'
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + len, y + (Math.random() - 0.5) * 2)
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export default function FeltTable() {
  const texture = useMemo(() => makeFeltTexture(), [])

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <circleGeometry args={[6.5, 96]} />
      <meshStandardMaterial
        map={texture}
        roughness={0.92}
        metalness={0}
        color="#ffffff"
      />
    </mesh>
  )
}
