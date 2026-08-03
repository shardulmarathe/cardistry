import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { applyHandPose, buildHandRig, updateDeckFocus } from './handRig'
import { registerHand, unregisterHand } from './handRegistry'

// Translucent procedural hand — pose is written imperatively each frame.
export default function Hand({ side }) {
  const rig = useMemo(() => buildHandRig(side), [side])

  useEffect(() => {
    registerHand(side, {
      setPose(pose) {
        // A null pose means this lesson has no hand for this side — hide it
        // rather than leaving a big hand parked at the origin.
        if (!pose) {
          rig.root.visible = false
          return
        }
        rig.root.visible = true
        applyHandPose(rig, pose)
      },
    })
    return () => unregisterHand(side)
  }, [rig, side])

  // The x-ray fade in handRig needs to know where the deck is THIS frame, in
  // view space. That is one sweep of the card registry, shared by both hands
  // (the frame guard inside makes the second call free) and by every material —
  // it cannot live in onBeforeRender because a frustum-culled palm would then
  // leave the rest of the hand reading a stale deck. Default priority, so this
  // stays inside R3F's own render loop.
  useFrame(({ camera, gl }) => {
    updateDeckFocus(camera, gl.info.render.frame)
  })

  return <primitive object={rig.root} />
}
