import { useEffect, useMemo } from 'react'
import { applyHandPose, buildHandRig } from './handRig'
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

  return <primitive object={rig.root} />
}
