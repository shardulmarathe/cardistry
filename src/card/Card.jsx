import { useEffect, useRef } from 'react'
import { Color } from 'three'
import { registerCard, unregisterCard } from './cardRegistry'
import { setMaterialBend, setMaterialTint } from './cardMaterial'
import { getCardGeometry } from './cardGeometry'
import { useMixingView } from '../lessons/engine/mixing'

// Scratch colour for tint writes, setMaterialTint copies out of it immediately.
const _tint = new Color()

// `hex` from the mixing ramp, or null to restore the printed card.
function paintTint(front, back, hex) {
  const color = hex ? _tint.set(hex) : null
  setMaterialTint(front, color)
  setMaterialTint(back, color)
}

// Two single-sided faces in a group, same idea as the original .card-front /
// .card-back DOM layers with backface-visibility:hidden and border-radius clip.
export default function Card({ id, frontMaterial, backMaterial, stackIndex = 0 }) {
  const groupRef = useRef()
  const geometry = getCardGeometry()

  useEffect(() => {
    const group = groupRef.current
    group.renderOrder = stackIndex
    const handle = {
      mesh: group,
      setTransform(pos, quat, bend = 0) {
        if (pos) group.position.copy(pos)
        if (quat) group.quaternion.copy(quat)
        setMaterialBend(frontMaterial, bend)
        setMaterialBend(backMaterial, bend)
      },
      setPosition(x, y, z) {
        group.position.set(x, y, z)
      },
      setTint(hex) {
        paintTint(frontMaterial, backMaterial, hex)
      },
    }
    registerCard(id, handle)
    return () => unregisterCard(id)
  }, [id, frontMaterial, backMaterial, stackIndex])

  // The mixing overlay is opt-in and changes only when a lesson step lands, so
  // it drives the materials through a store SUBSCRIPTION rather than React
  // state, 52 cards recolour without a single component re-render.
  useEffect(() => {
    const apply = (s) => {
      paintTint(frontMaterial, backMaterial, s.tint && s.colors ? s.colors.get(id) : null)
    }
    apply(useMixingView.getState())
    return useMixingView.subscribe(apply)
  }, [id, frontMaterial, backMaterial])

  return (
    <group ref={groupRef}>
      <mesh
        geometry={geometry}
        material={frontMaterial}
        castShadow={false}
        receiveShadow={false}
      />
      <mesh
        geometry={geometry}
        material={backMaterial}
        rotation={[0, Math.PI, 0]}
        castShadow={false}
        receiveShadow={false}
      />
    </group>
  )
}
