import { useMemo, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import Card from './Card'
import { createCardFaceMaterial } from './cardMaterial'
import { buildFaceTextures } from './textureFactory'
import { getCard } from './cardRegistry'
import { createDeck } from '../deckModel'
import { CARD_GAP } from '../lib/constants'

const CANONICAL = createDeck()

export default function CardField() {
  const gl = useThree((s) => s.gl)
  const backMap = useTexture('/assets/card-back-real.png')

  const { frontMaterials, backMaterials, faceTextures } = useMemo(() => {
    const back = backMap.clone()
    back.colorSpace = THREE.SRGBColorSpace
    const maxAniso = gl.capabilities.getMaxAnisotropy()
    const faceTextures = buildFaceTextures(CANONICAL, maxAniso)
    const frontMaterials = new Map()
    const backMaterials = new Map()
    for (const card of CANONICAL) {
      frontMaterials.set(
        card.id,
        createCardFaceMaterial(faceTextures.get(card.id), `${card.id}-front`),
      )
      backMaterials.set(
        card.id,
        createCardFaceMaterial(back, `${card.id}-back`),
      )
    }
    return { frontMaterials, backMaterials, faceTextures }
  }, [gl, backMap])

  useEffect(() => {
    CANONICAL.forEach((card, i) => {
      const handle = getCard(card.id)
      if (handle) {
        handle.setPosition(0, 0.02 + i * CARD_GAP, 0)
        handle.mesh.quaternion.set(0, 1, 0, 0)
      }
    })
  }, [])

  useEffect(() => {
    return () => {
      frontMaterials.forEach((m) => m.dispose())
      backMaterials.forEach((m) => m.dispose())
      faceTextures.forEach((t) => t.dispose())
    }
  }, [frontMaterials, backMaterials, faceTextures])

  return (
    <group>
      {CANONICAL.map((card, i) => (
        <Card
          key={card.id}
          id={card.id}
          frontMaterial={frontMaterials.get(card.id)}
          backMaterial={backMaterials.get(card.id)}
          stackIndex={i}
        />
      ))}
    </group>
  )
}
