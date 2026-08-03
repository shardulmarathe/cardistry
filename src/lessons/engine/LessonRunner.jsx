import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useAppStore } from '../../state/useAppStore'
import { getLessonById } from '../catalog'
import { compileLesson } from './compileLesson'
import { sampleTrack, stepIndexAt } from './sampleTrack'
import { usePlayer } from './player'
import { getCard } from '../../card/cardRegistry'
import { getHand } from '../../hands/handRegistry'
import Hand from '../../hands/Hand'
import MotionGuideLayer from '../annotations/guides'
import { lessonTimeRef } from './lessonTime'
import { risingSequences, intactNeighbours } from './mixing'

export default function LessonRunner() {
  const activeLessonId = useAppStore((s) => s.activeLessonId)
  const lessonRun = useAppStore((s) => s.lessonRun)
  const setDeck = useAppStore((s) => s.setDeck)
  const setCameraPreset = useAppStore((s) => s.setCameraPreset)

  const msRef = useRef(0)
  const mirrorAccum = useRef(0)
  const finalizedRef = useRef(false)
  const lastCameraRef = useRef(null)
  const lastSeekRef = useRef(0)

  useEffect(() => {
    if (!activeLessonId) return
    const lesson = getLessonById(activeLessonId)
    if (!lesson) return
    // Compiles against the CURRENT deck, so a repeat starts from whatever the
    // previous run left behind and the shuffles compound.
    const track = compileLesson(lesson, useAppStore.getState().deck, { run: lessonRun })
    usePlayer.getState().loadTrack(activeLessonId, track)
    msRef.current = 0
    finalizedRef.current = false
    lastCameraRef.current = null
    if (lesson.cameraPreset) setCameraPreset(lesson.cameraPreset)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLessonId, lessonRun])

  useFrame((_, delta) => {
    const p = usePlayer.getState()
    const track = p.track
    if (!track) return

    // Adopt an explicit seek regardless of play state — see player.js seekNonce.
    if (p.seekNonce !== lastSeekRef.current) {
      lastSeekRef.current = p.seekNonce
      msRef.current = p.globalMs
    }

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

    // Drive the procedural hands from the sampled hand poses (null hides them
    // for lessons/sides with no authored hand).
    getHand('left')?.setPose(scene.hands.left)
    getHand('right')?.setPose(scene.hands.right)

    const activeCam = lastRelevantCamera(track, ms)
    if (activeCam && activeCam !== lastCameraRef.current) {
      lastCameraRef.current = activeCam
      setCameraPreset(activeCam)
    }

    if (ms >= track.duration && !finalizedRef.current) {
      finalizedRef.current = true
      setDeck(track.finalDeck)
      // Score this run against the deck as it was when the lesson OPENED, not
      // as this run started — that is what makes repeats add up instead of each
      // one reporting the same "one shuffle's worth" of mixing.
      const st = useAppStore.getState()
      if (st.lessonBaseline) {
        const originalIndex = new Map(st.lessonBaseline.map((id, i) => [id, i]))
        const ids = track.finalDeck.map((c) => c.id)
        st.recordRun({
          run: st.lessonRun,
          rising: risingSequences(ids, originalIndex),
          kept: intactNeighbours(ids, originalIndex),
          pairs: Math.max(1, originalIndex.size - 1),
        })
      }
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
      <Hand side="left" />
      <Hand side="right" />
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
