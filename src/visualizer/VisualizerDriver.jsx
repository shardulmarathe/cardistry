import { useEffect, useMemo, useRef } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useAppStore } from '../state/useAppStore'
import { getCard, getRegistry } from '../card/cardRegistry'
import { buildVizLayout, toPoseMap, VISUALIZER_LAYOUTS } from '../lessons/engine/layouts'

// Free-play "Visualizer": arrange the deck in a selectable layout (fan, ring,
// ribbon, spiral, grid, stack). Tap a card to flip it — the card lifts in an arc
// so it clears the pile instead of flipping through its neighbours. Click empty
// felt to cycle layouts. Cards ease toward target poses every frame.
const FLIP_DUR = 0.55
const FLIP_LIFT = 0.42

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export default function VisualizerDriver() {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const deck = useAppStore((s) => s.deck)
  const setDeck = useAppStore((s) => s.setDeck)
  const vizLayout = useAppStore((s) => s.vizLayout)
  const setVizLayout = useAppStore((s) => s.setVizLayout)

  const targets = useMemo(
    () => toPoseMap(buildVizLayout(vizLayout, deck)),
    [vizLayout, deck],
  )

  const clockRef = useRef(0)
  const flipsRef = useRef(new Map())
  const tmp = useRef(new THREE.Vector3()).current

  useFrame((_, delta) => {
    clockRef.current += delta
    const now = clockRef.current
    const k = 1 - Math.exp(-delta * 9)
    for (const [id, pose] of targets) {
      const h = getCard(id)
      if (!h) continue
      const flip = flipsRef.current.get(id)
      if (flip) {
        const p = Math.min(1, (now - flip.start) / FLIP_DUR)
        const e = easeInOutCubic(p)
        tmp.copy(pose.pos)
        tmp.y += Math.sin(p * Math.PI) * FLIP_LIFT
        h.mesh.position.copy(tmp)
        h.mesh.quaternion.copy(flip.from).slerp(pose.quat, e)
        if (p >= 1) flipsRef.current.delete(id)
      } else {
        h.mesh.position.lerp(pose.pos, k)
        h.mesh.quaternion.slerp(pose.quat, k)
      }
    }
  })

  useEffect(() => {
    const el = gl.domElement
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let downX = 0
    let downY = 0

    const onDown = (e) => {
      downX = e.clientX
      downY = e.clientY
    }
    const onUp = (e) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return

      const rect = el.getBoundingClientRect()
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(ndc, camera)

      const entries = [...getRegistry().entries()]
      const hits = raycaster.intersectObjects(
        entries.map(([, h]) => h.mesh),
        false,
      )
      if (hits.length > 0) {
        const id = entries.find(([, h]) => h.mesh === hits[0].object)?.[0]
        if (id) {
          const h = getCard(id)
          flipsRef.current.set(id, {
            start: clockRef.current,
            from: h.mesh.quaternion.clone(),
          })
          setDeck((prev) =>
            prev.map((c) => (c.id === id ? { ...c, isFaceUp: !c.isFaceUp } : c)),
          )
        }
      } else {
        const order = VISUALIZER_LAYOUTS.map((l) => l.id)
        const i = order.indexOf(useAppStore.getState().vizLayout)
        setVizLayout(order[(i + 1) % order.length])
      }
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
    }
  }, [gl, camera, setDeck, setVizLayout])

  return null
}
