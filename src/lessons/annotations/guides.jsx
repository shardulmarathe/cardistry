import { useRef, useMemo } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { getCardGeometry } from '../../card/cardGeometry'
import { lessonTimeRef } from '../engine/lessonTime'
import { usePlayer } from '../engine/player'
import { sampleTrack } from '../engine/sampleTrack'

const ghostMat = new THREE.MeshStandardMaterial({
  color: 0xd8a24a,
  transparent: true,
  opacity: 0.18,
  depthWrite: false,
  roughness: 0.6,
  metalness: 0,
  side: THREE.DoubleSide,
})

const arrowMat = new THREE.MeshStandardMaterial({
  color: 0xf0c67a,
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
  emissive: 0xd8a24a,
  emissiveIntensity: 0.35,
})

const lineMat = new THREE.LineBasicMaterial({
  color: 0xd8a24a,
  transparent: true,
  opacity: 0.35,
  depthWrite: false,
})

// Motion guides: ghost cards, arrows and path traces. Hand placement is now
// shown by the real procedural finger rig (see LessonRunner), not palm ovals.
export default function MotionGuideLayer() {
  const track = usePlayer((s) => s.track)
  const groupRef = useRef()
  const ghostsRef = useRef([])
  const arrowsRef = useRef([])
  const linesRef = useRef([])

  const cardGeo = useMemo(() => getCardGeometry(), [])

  useFrame(() => {
    const t = usePlayer.getState().track
    if (!t || !groupRef.current) return
    const ms = lessonTimeRef.current
    const scene = sampleTrack(t, ms)
    const stepIdx = scene.stepIndex
    const guide = t.guides?.[stepIdx]
    const fade = guide ? guideFade(t, ms, stepIdx) : 0

    if (!guide) {
      hideAll(ghostsRef.current, arrowsRef.current, linesRef.current)
    } else {
      guide.ghosts.forEach((g, i) => {
        let mesh = ghostsRef.current[i]
        if (!mesh) {
          mesh = new THREE.Mesh(cardGeo, ghostMat.clone())
          groupRef.current.add(mesh)
          ghostsRef.current[i] = mesh
        }
        mesh.visible = true
        mesh.position.copy(g.pos)
        mesh.quaternion.copy(g.quat)
        mesh.material.opacity = 0.18 * fade
        mesh.scale.setScalar(1.02)
      })
      for (let i = guide.ghosts.length; i < ghostsRef.current.length; i++) {
        if (ghostsRef.current[i]) ghostsRef.current[i].visible = false
      }

      guide.arrows.forEach((a, i) => {
        let arrow = arrowsRef.current[i]
        if (!arrow) {
          arrow = buildArrowMesh()
          groupRef.current.add(arrow)
          arrowsRef.current[i] = arrow
        }
        placeArrow(arrow, a.from, a.to, fade)
      })
      for (let i = guide.arrows.length; i < arrowsRef.current.length; i++) {
        if (arrowsRef.current[i]) arrowsRef.current[i].visible = false
      }

      guide.paths.forEach((path, i) => {
        let line = linesRef.current[i]
        if (!line) {
          const geo = new THREE.BufferGeometry()
          line = new THREE.Line(geo, lineMat.clone())
          groupRef.current.add(line)
          linesRef.current[i] = line
        }
        const pts = path.map((p) => [p.x, p.y + 0.01, p.z]).flat()
        line.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
        line.geometry.attributes.position.needsUpdate = true
        line.visible = true
        line.material.opacity = 0.35 * fade
      })
      for (let i = guide.paths.length; i < linesRef.current.length; i++) {
        if (linesRef.current[i]) linesRef.current[i].visible = false
      }
    }
  })

  if (!track) return null
  return <group ref={groupRef} />
}

function guideFade(track, ms, stepIdx) {
  const step = track.steps[stepIdx]
  if (!step) return 0
  const span = Math.max(1, step.tEnd - step.tStart)
  const local = (ms - step.tStart) / span
  const inFade = Math.min(1, local * 4)
  const outFade = Math.min(1, (1 - local) * 4)
  return Math.min(inFade, outFade, 1)
}

function hideAll(ghosts, arrows, lines) {
  ghosts.forEach((m) => { if (m) m.visible = false })
  arrows.forEach((m) => { if (m) m.visible = false })
  lines.forEach((m) => { if (m) m.visible = false })
}

function buildArrowMesh() {
  const group = new THREE.Group()
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 6), arrowMat.clone())
  shaft.name = 'shaft'
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.06, 8), arrowMat.clone())
  head.name = 'head'
  group.add(shaft)
  group.add(head)
  return group
}

function placeArrow(group, from, to, fade) {
  group.visible = true
  const dir = new THREE.Vector3().subVectors(to, from)
  const len = dir.length()
  if (len < 0.02) {
    group.visible = false
    return
  }
  dir.normalize()
  const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5)
  group.position.copy(mid)
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
  const shaft = group.getObjectByName('shaft')
  const head = group.getObjectByName('head')
  shaft.scale.y = len * 0.7
  head.position.y = len * 0.35
  shaft.material.opacity = 0.55 * fade
  head.material.opacity = 0.55 * fade
}
