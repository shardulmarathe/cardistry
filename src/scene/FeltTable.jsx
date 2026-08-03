import { useMemo, useRef, useEffect } from 'react'
import * as THREE from 'three'
import { COLORS } from '../lib/constants'

// The felt renders on its own layer so the ContactShadows depth pass in Stage
// can skip it — see the long note there. The main camera opts back in.
export const FELT_LAYER = 1

// A large felt surface with a runtime radial-gradient texture (matching App.css)
// plus a faint fibrous nap. Receives shadows from the cards.
function makeFeltTexture() {
  const size = 1024
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  // Radial oxblood gradient — lit pool at center fading to dark edge.
  //
  // The UVs of the circleGeometry below span its 13-unit bounding box, so
  // texture radius r maps to 13*r world units. The old outer stop of 0.62 put
  // the dark end of the gradient ~8 units out — well outside the ~±3.3 units
  // the overview camera can see — so the vignette never reached the screen and
  // the table read as one flat sheet of bright crimson. 0.40 lands the falloff
  // inside the frame, which is what makes the spotlight pool read as a pool.
  const g = ctx.createRadialGradient(
    size / 2,
    size * 0.47,
    size * 0.02,
    size / 2,
    size * 0.5,
    size * 0.4,
  )
  g.addColorStop(0, '#93202f')
  g.addColorStop(0.17, COLORS.feltCore)
  g.addColorStop(0.42, COLORS.feltMid)
  g.addColorStop(0.72, '#1b0409')
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
  const meshRef = useRef()

  useEffect(() => {
    meshRef.current.layers.set(FELT_LAYER)
  }, [])

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
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
