import { useLayoutEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { useAppStore } from '../state/useAppStore'

// A perspective camera's `fov` is the *vertical* field of view, so on a narrow
// portrait viewport the horizontal field collapses and the wide card table gets
// cropped at the sides. This keeps the horizontal field of view roughly constant
// as the viewport narrows (widening the vertical fov instead), so the table stays
// framed on phones. Landscape / desktop (aspect >= REF_ASPECT) is left untouched.
const BASE_FOV = 35 // vertical fov tuned for the desktop framing
const REF_ASPECT = 1.5 // at/above this, keep the original framing
const MAX_FOV = 78 // cap so very tall/narrow screens don't go full fisheye

const toRad = (deg) => (deg * Math.PI) / 180
const toDeg = (rad) => (rad * 180) / Math.PI

function fovForAspect(aspect) {
  if (!Number.isFinite(aspect) || aspect >= REF_ASPECT) return BASE_FOV
  const hFov = 2 * Math.atan(Math.tan(toRad(BASE_FOV) / 2) * REF_ASPECT)
  return Math.min(MAX_FOV, toDeg(2 * Math.atan(Math.tan(hFov / 2) / aspect)))
}

function applyFov(camera, fov) {
  camera.fov = fov
  camera.updateProjectionMatrix()
}

export default function ResponsiveCamera() {
  const camera = useThree((s) => s.camera)
  const width = useThree((s) => s.size.width)
  const height = useThree((s) => s.size.height)
  const uiInset = useAppStore((s) => s.uiInset)

  useLayoutEffect(() => {
    if (!camera.isPerspectiveCamera || height === 0) return
    applyFov(camera, fovForAspect(width / height))
    // Recentre on the strip of viewport the docked UI leaves visible. Rendering
    // the window (0, inset)-(w, inset+h) out of a virtual frame `inset` taller
    // puts the scene's centre at (h - inset)/2 — the middle of what you can
    // actually see — instead of behind the transport panel.
    const inset = Math.max(0, Math.min(uiInset, height * 0.6))
    if (inset > 1) camera.setViewOffset(width, height + inset, 0, inset, width, height)
    else camera.clearViewOffset()
    camera.updateProjectionMatrix()
  }, [camera, width, height, uiInset])

  return null
}
