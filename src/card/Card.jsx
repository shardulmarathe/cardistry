import { useEffect, useRef } from 'react'
import { registerCard, unregisterCard } from './cardRegistry'
import { setMaterialBend } from './cardMaterial'
import { getCardGeometry } from './cardGeometry'

// Two single-sided faces in a group — same idea as the original .card-front /
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
    }
    registerCard(id, handle)
    return () => unregisterCard(id)
  }, [id, frontMaterial, backMaterial, stackIndex])

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
