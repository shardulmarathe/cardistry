import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useAppStore } from '../../state/useAppStore'
import { getLessonById } from '../catalog'
import { compileLesson } from './compileLesson'
import { sampleTrack, stepIndexAt } from './sampleTrack'
import { usePlayer } from './player'
import { getCard } from '../../card/cardRegistry'
import AnnotationLayer from '../annotations/AnnotationLayer'
import MotionGuideLayer from '../annotations/guides'
import { lessonTimeRef } from './lessonTime'

export default function LessonRunner() {
  const activeLessonId = useAppStore((s) => s.activeLessonId)
  const setDeck = useAppStore((s) => s.setDeck)
  const setCameraPreset = useAppStore((s) => s.setCameraPreset)

  const msRef = useRef(0)
  const mirrorAccum = useRef(0)
  const finalizedRef = useRef(false)
  const lastCameraRef = useRef(null)

  useEffect(() => {
    if (!activeLessonId) return
    const lesson = getLessonById(activeLessonId)
    if (!lesson) return
    const track = compileLesson(lesson, useAppStore.getState().deck)
    usePlayer.getState().loadTrack(activeLessonId, track)
    msRef.current = 0
    finalizedRef.current = false
    lastCameraRef.current = null
    if (lesson.cameraPreset) setCameraPreset(lesson.cameraPreset)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLessonId])

  useFrame((_, delta) => {
    const p = usePlayer.getState()
    const track = p.track
    if (!track) return

    if (p.playing) {
      msRef.current += delta * 1000 * p.speed * p.direction
      if (msRef.current >= track.duration) {
        msRef.current = track.duration
        usePlayer.setState({ playing: false })
      }
      if (msRef.current < 0) {
        msRef.current = 0
        usePlayer.setState({ playing: false })
      }
    } else {
      msRef.current = p.globalMs
    }

    const ms = msRef.current
    lessonTimeRef.current = ms
    const scene = sampleTrack(track, ms)
    for (const [id, pose] of scene.cards) {
      const handle = getCard(id)
      if (handle) handle.setTransform(pose.pos, pose.quat, pose.bend)
    }

    const activeCam = lastRelevantCamera(track, ms)
    if (activeCam && activeCam !== lastCameraRef.current) {
      lastCameraRef.current = activeCam
      setCameraPreset(activeCam)
    }

    if (ms >= track.duration && !finalizedRef.current) {
      finalizedRef.current = true
      setDeck(track.finalDeck)
    }
    if (ms < track.duration) finalizedRef.current = false

    mirrorAccum.current += delta
    if (p.playing && mirrorAccum.current >= 0.08) {
      mirrorAccum.current = 0
      usePlayer.getState()._mirror(ms, stepIndexAt(track, ms))
    }
  })

  return (
    <>
      <AnnotationLayer />
      <MotionGuideLayer />
    </>
  )
}

function lastRelevantCamera(track, ms) {
  let cam = null
  for (const c of track.cameraByStep) {
    if (ms >= c.tStart) cam = c.preset
  }
  return cam
}
