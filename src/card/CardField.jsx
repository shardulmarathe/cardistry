import { useMemo, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import Card from './Card'
import { createCardFaceMaterial } from './cardMaterial'
import { buildFaceTextures, buildBackTexture } from './textureFactory'
import { getCard } from './cardRegistry'
import { createDeck } from '../deckModel'
import { CARD_GAP } from '../lib/constants'

const CANONICAL = createDeck()

export default function CardField() {
  const gl = useThree((s) => s.gl)

  const { frontMaterials, backMaterials, faceTextures, backTexture } = useMemo(() => {
    const maxAniso = gl.capabilities.getMaxAnisotropy()
    const back = buildBackTexture(maxAniso)
    const faceTextures = buildFaceTextures(CANONICAL, maxAniso)
    const frontMaterials = new Map()
    const backMaterials = new Map()
    for (const card of CANONICAL) {
      frontMaterials.set(
        card.id,
        createCardFaceMaterial(faceTextures.get(card.id), `${card.id}-front`),
      )
      // All backs share the one procedural texture.
      backMaterials.set(
        card.id,
        createCardFaceMaterial(back, `${card.id}-back`),
      )
    }
    return { frontMaterials, backMaterials, faceTextures, backTexture: back }
  }, [gl])

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
      backTexture.dispose()
    }
  }, [frontMaterials, backMaterials, faceTextures, backTexture])

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
