import { useEffect, useMemo } from 'react'
import { applyHandPose, buildHandRig } from './handRig'
import { registerHand, unregisterHand } from './handRegistry'

// Translucent procedural hand — pose is written imperatively each frame.
export default function Hand({ side }) {
  const rig = useMemo(() => buildHandRig(side), [side])

  useEffect(() => {
    registerHand(side, {
      setPose(pose) {
        applyHandPose(rig, pose, side)
      },
    })
    return () => unregisterHand(side)
  }, [rig, side])

  return <primitive object={rig.root} />
}
