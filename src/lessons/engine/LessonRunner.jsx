import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useAppStore } from '../../state/useAppStore'
import { getLessonById } from '../catalog'
import { compileLesson } from './compileLesson'
import { sampleTrack, stepIndexAt } from './sampleTrack'
import { stackLayout } from './layouts'
import { getHandPose, DECK_REACH, DECK_REST_DROP } from '../../hands/handPoses'
import { CARD_W } from '../../lib/constants'
import { usePlayer } from './player'
import { getCard } from '../../card/cardRegistry'
import { getHand } from '../../hands/handRegistry'
import Hand from '../../hands/Hand'
import MotionGuideLayer from '../annotations/guides'
import { lessonTimeRef } from './lessonTime'
import { risingSequences, intactNeighbours } from './mixing'

// 180° about the card's LOCAL vertical axis - the same turn-over the visualizer
// uses. Every lesson is COMPILED FACE-DOWN (compileLesson normalizes the deck,
// otherwise each face-down target became a 180° flip and cards somersaulted
// through the felt mid-weave), so "Show faces" cannot be authored into the
// track. Post-multiplying this onto a sampled quaternion turns a card over in
// place instead: same footprint, same stacking order, same bend axis (the bend
// runs along local Y, which this rotation preserves) - just the printed face up.
// That's what makes it safe to hit mid-shuffle.
const FLIP_Y = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)

// A HALF-TURN ABOUT THE CARD'S OWN NORMAL, applied to every card Learn renders, so
// that a face-down card here sits the same way up as one in the visualizer.
//
// THE TWO TABS DISAGREE, and both are defensible. The visualizer composes its
// face-down orientation as `faceQuat(true)` turned about the card's LONG axis,
// because that is its flip animation - one edge lifts and the card lays over. Every
// lesson layout uses `faceQuat(false)` directly. Measured, those differ by exactly
// 180 degrees about the card's normal: an in-plane half-turn. Same footprint, same
// face showing, artwork upside down - which is why the back read wrong in Learn and
// right in the visualizer, twice reported.
//
// WHY THIS IS THE FIX RATHER THAN THE ART. The alternative was to make the back
// design 180-degree symmetric so the difference cannot show. That is real work on
// the drawing (a typeset "S" is not symmetric however it looks) and it buys nothing
// except immunity to a disagreement that should not exist. `faceQuat` itself cannot
// change: every grip in the catalog is swept against its axis mapping, so an extra
// half-turn there would move which world side every '+x' contact lands on.
//
// AND IT IS FREE. A half-turn about the normal maps a RECTANGLE onto itself, so the
// card occupies the identical volume - and it maps a BOWED card onto itself too,
// because the bend shader displaces by (1 - cos(y*b))/b along the normal, which is
// even in y. So no hand-versus-card, card-versus-card or mixing measurement changes,
// and none of them is computed here anyway: `verify` scores the COMPILED TRACK, and
// this is the renderer.
const SPIN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI)

// Idle ease rate (per second, exponential). Entering Learn from a fan or a
// spiral has to LAND the deck in the middle rather than teleport it - and the
// compiler assumes its first frame is a squared stack, so this ease is also what
// makes starting a technique seamless instead of a snap.
const IDLE_EASE = 7

// Wrist placement for the resting hands, DERIVED so it cannot go stale if the
// hand or the card is ever rescaled. `deckRest` reaches DECK_REACH (~0.57)
// inboard of its wrist, so its own authored stance of 0.78 lands both sets of
// fingertips at x ±0.21 - inside the deck's own footprint and INSIDE EACH OTHER;
// the first attempt drew two hands with their fingers interlaced over the deck.
// Parking the tips a finger's width outside the deck's long edge instead puts a
// hand BESIDE the deck, which is what the resting table is meant to show.
const IDLE_TIP_CLEAR = 0.14
const IDLE_HAND_X = DECK_REACH + CARD_W / 2 + IDLE_TIP_CLEAR
const IDLE_HAND_Z = 0.02
// The pads rest on the FELT beside the deck (a card at y=0), not on the stack.
const IDLE_HAND_Y = DECK_REST_DROP
// `deckRest`'s default thumb opposition throws the thumb ~1.2 in −z, which reads
// as a spike standing off the back of the hand. Tucked alongside the fingers -
// the same override wash.lesson applies to this preset, for the same reason.
const IDLE_THUMB = { z: -1.4, x: 0.2 }

function idleHand(side) {
  const p = getHandPose('deckRest', side, [IDLE_HAND_X, IDLE_HAND_Y, IDLE_HAND_Z])
  p.thumbOpp = { ...IDLE_THUMB }
  return p
}

export default function LessonRunner() {
  const activeLessonId = useAppStore((s) => s.activeLessonId)
  const lessonRun = useAppStore((s) => s.lessonRun)
  const deck = useAppStore((s) => s.deck)
  const setDeck = useAppStore((s) => s.setDeck)
  const setCameraPreset = useAppStore((s) => s.setCameraPreset)

  const msRef = useRef(0)
  const mirrorAccum = useRef(0)
  const finalizedRef = useRef(false)
  const lastCameraRef = useRef(null)
  const lastSeekRef = useRef(0)
  const scratchQuat = useRef(new THREE.Quaternion()).current

  // The authored quaternion is always FACE-DOWN (compileLesson normalizes, and the
  // idle stack is built face-down below), so turning a card over is a half-turn
  // about its long axis and matching the visualizer is a half-turn about its normal.
  // Both post-multiply, and the order matters only in that FLIP_Y comes first:
  // authored * FLIP_Y * SPIN is a half-turn about the SHORT axis, which is exactly
  // the visualizer's face-up pose.
  const renderQuat = (authored, faceUp, out) => {
    out.copy(authored)
    if (faceUp) out.multiply(FLIP_Y)
    return out.multiply(SPIN)
  }

  // Which cards are showing their face. Read every frame by the flip override,
  // so it's a ref rather than a selector.
  const faceUpRef = useRef(new Set())
  useEffect(() => {
    const next = new Set()
    for (const c of deck) if (c.isFaceUp) next.add(c.id)
    faceUpRef.current = next
  }, [deck])

  // THE RESTING TABLE: deck squared in the middle, a hand either side of it.
  // This is what Learn shows before you pick anything, and it is built from the
  // shared deck, so a reorder or a flip made in the visualizer is already on the
  // table when you arrive.
  //
  // `deckRest`, not `relaxed`. Its own header calls `relaxed` out as the thing it
  // replaced - "two mannequin hands floating beside a deck they never touch" -
  // and, being un-yawed, it points the fingers AT THE CAMERA, so the idle table
  // came up as two splayed slabs filling the frame. `deckRest` is yawed inward
  // (fingers along the table, toward the deck) and carries a measured drop, so
  // it settles the pads on the table rather than floating them: a deck with a
  // hand either side of it, which is what the resting table has to look like.
  const idle = useMemo(
    () =>
      activeLessonId
        ? null
        : {
            // FACE-DOWN, always, and the faces come back through `renderQuat` -
            // the same path a lesson takes. Built from `deck` honouring isFaceUp it
            // would need its own orientation convention, and one of the two would
            // drift.
            poses: stackLayout(deck.map((c) => (c.isFaceUp ? { ...c, isFaceUp: false } : c))),
            left: idleHand('left'),
            right: idleHand('right'),
          },
    [activeLessonId, deck],
  )

  useEffect(() => {
    if (!activeLessonId) return
    const lesson = getLessonById(activeLessonId)
    if (!lesson) return
    // STOP THE OUTGOING RUN FIRST. Compiling a lesson takes real time (the whole
    // track is solved up front), and until loadTrack lands the runner keeps
    // sampling the PREVIOUS track and integrating time into it, so switching
    // technique mid-shuffle briefly kept playing the old one.
    usePlayer.getState().pause()
    // Compiles against the CURRENT deck, so a repeat starts from whatever the
    // previous run left behind and the shuffles compound.
    const track = compileLesson(lesson, useAppStore.getState().deck, { run: lessonRun })
    usePlayer.getState().loadTrack(activeLessonId, track)
    // Picking a technique IS the request to see it. loadTrack parks at frame 0
    // on purpose (so a seek can't inherit the old cursor); starting playback
    // here is what turns "click a shuffle" into "the shuffle runs", with the
    // step bar available the moment you want to take over.
    usePlayer.getState().play()
    msRef.current = 0
    finalizedRef.current = false
    lastCameraRef.current = null
    if (lesson.cameraPreset) setCameraPreset(lesson.cameraPreset)
    // Leaving the lesson (or swapping to another) must not leave a playing
    // player behind for the next mount to inherit.
    return () => usePlayer.getState().pause()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLessonId, lessonRun])

  // Back to the picker: drop the track so the idle table owns the cards again,
  // and put the camera back where the resting deck is framed.
  useEffect(() => {
    if (activeLessonId) return
    usePlayer.getState().clear()
    setCameraPreset('overview')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLessonId])

  useFrame((_, delta) => {
    if (idle) {
      const k = 1 - Math.exp(-IDLE_EASE * delta)
      const faceUpIdle = faceUpRef.current
      for (const pose of idle.poses) {
        const handle = getCard(pose.id)
        if (!handle) continue
        const g = handle.mesh
        g.position.lerp(pose.pos, k)
        g.quaternion.slerp(renderQuat(pose.quat, faceUpIdle.has(pose.id), scratchQuat), k)
        handle.setTransform(null, null, 0)
      }
      getHand('left')?.setPose(idle.left)
      getHand('right')?.setPose(idle.right)
      return
    }

    const p = usePlayer.getState()
    const track = p.track
    if (!track) return

    // Adopt an explicit seek regardless of play state, see player.js seekNonce.
    if (p.seekNonce !== lastSeekRef.current) {
      lastSeekRef.current = p.seekNonce
      msRef.current = p.globalMs
    }

    if (p.playing) {
      msRef.current += delta * 1000 * p.speed * p.direction
      // LANDING EXACTLY ON THE END IS LOAD-BEARING, not tidiness. Playback time is
      // mirrored into the store every 80ms and ONLY while playing, so a run that
      // clamps here and stops leaves `globalMs` up to 80ms short of `durationMs` -
      // and every "the run is over" test in the UI is `globalMs >= durationMs`. The
      // effect was that watching a shuffle play to the end never offered Replay or
      // "Shuffle again"; scrubbing to the end did, which is why it looked like the
      // button had been removed rather than like a timing bug. Mirror the exact end
      // as we stop.
      if (msRef.current >= track.duration) {
        msRef.current = track.duration
        usePlayer.setState({ playing: false })
        usePlayer.getState()._mirror(track.duration, stepIndexAt(track, track.duration))
      }
      if (msRef.current < 0) {
        msRef.current = 0
        usePlayer.setState({ playing: false })
        usePlayer.getState()._mirror(0, 0)
      }
    } else {
      msRef.current = p.globalMs
    }

    const ms = msRef.current
    lessonTimeRef.current = ms
    const scene = sampleTrack(track, ms)
    const faceUp = faceUpRef.current
    for (const [id, pose] of scene.cards) {
      const handle = getCard(id)
      if (!handle) continue
      handle.setTransform(pose.pos, renderQuat(pose.quat, faceUp.has(id), scratchQuat), pose.bend)
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
      // WHAT THE VIEWER ACTUALLY SAW, which is the compiled face XOR the viewer's
      // own flip - not just the viewer's flip.
      //
      // The compiler squares every deck face-down to solve a track, so `c.isFaceUp`
      // used to be false for every card and "what was on screen" was exactly the
      // Show-faces state. That stopped being true the moment a lesson turned the
      // deck over on purpose: the charlier's `flip` beat sets the compiled face to
      // UP, and recording the viewer's flag alone would hand the visualizer a
      // face-down deck while the table plainly showed faces. The render applies
      // FLIP_Y iff the viewer flipped that card, so the face on screen is the
      // compiled face turned over that many times - one XOR.
      setDeck(
        track.finalDeck.map((c) => {
          const shown = c.isFaceUp !== faceUp.has(c.id)
          return c.isFaceUp === shown ? c : { ...c, isFaceUp: shown }
        }),
      )
      // The run-by-run pips are scored against `lessonOrigin` - the deck as it
      // was when the technique was PICKED - not against this run's own starting
      // order. That is what makes repeats ADD UP (2 -> 4 -> 8 rising sequences)
      // instead of each one reporting the same one-shuffle figure. The dock's
      // start/now strip uses the other reference, `lessonBaseline`.
      const st = useAppStore.getState()
      if (st.lessonOrigin) {
        const originalIndex = new Map(st.lessonOrigin.map((id, i) => [id, i]))
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
