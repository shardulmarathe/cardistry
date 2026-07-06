import { useEffect, useMemo, useRef } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useAppStore } from '../state/useAppStore'
import { getCard, getRegistry } from '../card/cardRegistry'
import { buildVizLayout } from '../lessons/engine/layouts'

// Free-play "Visualizer": arrange the deck in a selectable layout (fan, ring,
// ribbon, spiral, grid, stack). Tap a card to flip it — the card turns over
// about its VERTICAL axis (a "side flip": the S♠ face mirrors to ♠S, as if a
// hand grabbed one edge and laid it over), NOT a hinge toward the camera. It
// lifts in a small arc so it clears its neighbours. "Flip all" runs the same
// flip as a staggered wave that follows the layout's own card order. Drag a
// card to any spot to reorder it — works in every layout. The layout itself is
// changed only from the buttons in VisualizerControls; clicking felt does
// nothing but orbit.
const FLIP_DUR = 0.5
const FLIP_LIFT = 0.4
const STAGGER = 0.012 // per-card delay in the "Flip all" wave (seconds)
const PEEL = 0.16 // cosmetic mid-flip lean so one edge appears to lift first

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

// 180° about the card's LOCAL vertical (Y) axis. Right-multiplied onto the
// face-up rest quaternion this yields the face-down "side flip" orientation:
// front normal flips, the card's top stays up, and the face mirrors L<->R.
const FLIP_Y = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)

export default function VisualizerDriver() {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)
  const deck = useAppStore((s) => s.deck)
  const setDeck = useAppStore((s) => s.setDeck)
  const vizLayout = useAppStore((s) => s.vizLayout)
  const flipAllNonce = useAppStore((s) => s.flipAllNonce)
  const reducedMotion = useAppStore((s) => s.settings.reducedMotion)

  // Face-up base layout: positions + the face-UP rest quaternion for every card,
  // independent of each card's current face. Orientation face is owned locally
  // (faceRef) so the flip animation can lead the store state.
  const base = useMemo(() => {
    const faceUpDeck = deck.map((c) => ({ ...c, isFaceUp: true }))
    const poses = buildVizLayout(vizLayout, faceUpDeck)
    const map = new Map()
    poses.forEach((p, index) => map.set(p.id, { pos: p.pos, quat: p.quat, index }))
    return map
  }, [vizLayout, deck])

  const clockRef = useRef(0)
  const flipsRef = useRef(new Map())
  const faceRef = useRef(new Map())
  // Drag-to-reorder: candidate = card under the pointer on pointerdown; dragging
  // = the card id currently being carried (also excluded from the ease loop).
  const dragRef = useRef({ candidate: null, dragging: null })
  const scratch = useRef({
    R: new THREE.Quaternion(),
    peel: new THREE.Quaternion(),
    q: new THREE.Quaternion(),
    v: new THREE.Vector3(),
    axis: new THREE.Vector3(),
    width: new THREE.Vector3(),
  }).current

  // Keep the local face map in sync with the deck (Reset, single-tap commit,
  // cascade commit). Values always match after our own commits — this only
  // matters when the deck is replaced externally (e.g. Reset -> all face-down).
  useEffect(() => {
    const next = new Map()
    for (const c of deck) next.set(c.id, c.isFaceUp)
    faceRef.current = next
  }, [deck])

  const desiredQuat = (id, out) => {
    const b = base.get(id)
    if (!b) return null
    out.copy(b.quat)
    if (!faceRef.current.get(id)) out.multiply(FLIP_Y)
    return out
  }

  // Commit the local face state back to the store once no flips remain.
  const commitFaces = () => {
    const faces = faceRef.current
    setDeck((prev) =>
      prev.map((c) => (faces.has(c.id) ? { ...c, isFaceUp: faces.get(c.id) } : c)),
    )
  }

  const enqueueFlip = (id, startAt) => {
    const h = getCard(id)
    const b = base.get(id)
    if (!h || !b) return
    // Hinge axis = the card's world-space vertical (its local Y under the
    // face-up rest quat). Rotating about it produces the side/mirror flip and
    // lands exactly on the opposite-face rest orientation.
    scratch.axis.set(0, 1, 0).applyQuaternion(b.quat).normalize()
    scratch.width.set(1, 0, 0).applyQuaternion(b.quat).normalize()
    flipsRef.current.set(id, {
      start: startAt,
      fromQuat: h.mesh.quaternion.clone(),
      axis: scratch.axis.clone(),
      width: scratch.width.clone(),
      restPos: b.pos,
      toFace: !faceRef.current.get(id),
    })
  }

  useFrame((_, delta) => {
    clockRef.current += delta
    const now = clockRef.current
    const k = 1 - Math.exp(-delta * 9)
    const flips = flipsRef.current
    let completedThisFrame = false

    for (const [id, b] of base) {
      const h = getCard(id)
      if (!h) continue
      // The dragged card is positioned directly by the pointer handler.
      if (id === dragRef.current.dragging) continue
      const flip = flips.get(id)

      if (flip && now >= flip.start) {
        const p = Math.min(1, (now - flip.start) / FLIP_DUR)
        const e = easeInOutCubic(p)
        const swell = Math.sin(p * Math.PI)
        // Turn over about the vertical axis...
        scratch.R.setFromAxisAngle(flip.axis, e * Math.PI)
        // ...with a subtle mid-flip lean about the width axis so one edge
        // visibly lifts first (returns to zero at the ends).
        scratch.peel.setFromAxisAngle(flip.width, swell * PEEL)
        scratch.q.copy(flip.fromQuat).premultiply(scratch.R).premultiply(scratch.peel)
        h.mesh.quaternion.copy(scratch.q)
        scratch.v.copy(flip.restPos)
        scratch.v.y += swell * FLIP_LIFT
        h.mesh.position.copy(scratch.v)
        if (p >= 1) {
          faceRef.current.set(id, flip.toFace)
          flips.delete(id)
          completedThisFrame = true
        }
      } else {
        // Ease toward the resting pose for this card's current face.
        const target = desiredQuat(id, scratch.q)
        h.mesh.position.lerp(b.pos, k)
        if (target) h.mesh.quaternion.slerp(target, k)
      }
    }

    // Once the last flip resolves, persist the new face-up flags in one write.
    if (completedThisFrame && flips.size === 0) commitFaces()
  })

  // "Flip all" — staggered wave in layout order (base.index is the card's
  // position in the current layout, so fan sweeps end-to-end, ring goes around,
  // spiral runs centre-out).
  const firstNonce = useRef(true)
  useEffect(() => {
    if (firstNonce.current) {
      firstNonce.current = false
      return
    }
    for (const [id, b] of base) {
      const delay = reducedMotion ? 0 : b.index * STAGGER
      enqueueFlip(id, clockRef.current + delay)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flipAllNonce])

  useEffect(() => {
    const el = gl.domElement
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    // Table plane at the deck's rest height, for projecting the drag target.
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.02)
    const hitPoint = new THREE.Vector3()
    let downX = 0
    let downY = 0
    let lastClientX = 0
    let lastClientY = 0

    const setNdc = (e) => {
      const rect = el.getBoundingClientRect()
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(ndc, camera)
    }

    // Cards are registered as their outer <group>; the pickable geometry lives
    // on two child meshes, and Group.raycast is a no-op — so we must recurse and
    // walk the hit object's parent chain back up to the registered group.
    const pickCard = () => {
      const entries = [...getRegistry().entries()]
      const hits = raycaster.intersectObjects(
        entries.map(([, h]) => h.mesh),
        true,
      )
      if (hits.length === 0) return null
      let obj = hits[0].object
      while (obj) {
        const found = entries.find(([, h]) => h.mesh === obj)
        if (found) return found[0]
        obj = obj.parent
      }
      return null
    }

    const onDown = (e) => {
      downX = e.clientX
      downY = e.clientY
      lastClientX = e.clientX
      lastClientY = e.clientY
      dragRef.current.candidate = null
      setNdc(e)
      dragRef.current.candidate = pickCard()
    }

    const onMove = (e) => {
      const drag = dragRef.current
      if (!drag.candidate && !drag.dragging) return
      lastClientX = e.clientX
      lastClientY = e.clientY
      if (Math.hypot(e.clientX - downX, e.clientY - downY) <= 6) return
      // Promote a candidate to an active drag on the first real movement.
      if (!drag.dragging) {
        drag.dragging = drag.candidate
        if (controls) controls.enabled = false
      }
      setNdc(e)
      if (raycaster.ray.intersectPlane(dragPlane, hitPoint)) {
        const h = getCard(drag.dragging)
        if (h) h.mesh.position.set(hitPoint.x, hitPoint.y + 0.35, hitPoint.z)
      }
    }

    const endDrag = () => {
      const drag = dragRef.current
      const id = drag.dragging
      drag.dragging = null
      drag.candidate = null
      if (controls) controls.enabled = true
      if (!id) return
      // Insertion index = the layout slot whose on-screen position is closest to
      // where the card was dropped. Projecting each slot to pixels makes this
      // work uniformly for every layout (fan, ring, ribbon, spiral, grid, stack)
      // — no per-layout ordering axis. The dragged card's own slot is included,
      // so dropping it back near home is a no-op.
      const rect = el.getBoundingClientRect()
      const v = new THREE.Vector3()
      let target = 0
      let bestD = Infinity
      for (const [, b] of base) {
        v.copy(b.pos).project(camera)
        const sx = ((v.x + 1) / 2) * rect.width + rect.left
        const sy = ((1 - v.y) / 2) * rect.height + rect.top
        const d = Math.hypot(lastClientX - sx, lastClientY - sy)
        if (d < bestD) {
          bestD = d
          target = b.index
        }
      }
      setDeck((prev) => {
        const card = prev.find((c) => c.id === id)
        if (!card) return prev
        const without = prev.filter((c) => c.id !== id)
        without.splice(Math.min(target, without.length), 0, card)
        return without
      })
    }

    const onUp = (e) => {
      if (dragRef.current.dragging) {
        endDrag()
        return
      }
      dragRef.current.candidate = null
      // A clean tap on a card flips it; a tap on empty felt does nothing.
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return
      setNdc(e)
      const id = pickCard()
      if (id) enqueueFlip(id, clockRef.current)
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', endDrag)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', endDrag)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, camera, controls, setDeck, base])

  return null
}
