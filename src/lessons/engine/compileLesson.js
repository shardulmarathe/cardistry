import * as THREE from 'three'
import { mulberry32 } from './seededRng'
import { stackLayout, toPoseMap } from './layouts'
import { riffleOrder } from '../../lib/shuffleMath'
import { CARD_GAP } from '../../lib/constants'
import { getHandPose } from '../../hands/handPoses'
import { buildGuideArrows, buildGuideGhosts, buildGuidePath } from '../annotations/guideUtils'

// Compile a declarative lesson into a deterministic keyframe Track.
// Steps vocabulary:
//   { kind:'move',   label, duration, ease, to, hands?, camera?, annotations? }
//   { kind:'riffle', label, duration, ease, hands?, camera?, annotations? }
//   { kind:'hold',   label, duration, hands?, camera?, annotations? }
//
// hands: { left?: { from, to }, right?: { from, to } } — named pose presets
// A pose is { id, pos:Vector3, quat:Quaternion, bend:number }.

function clonePose(p) {
  return { pos: p.pos.clone(), quat: p.quat.clone(), bend: p.bend || 0 }
}

function resolvePoseMap(to, deck) {
  const arr = typeof to === 'function' ? to(deck) : to
  return toPoseMap(arr)
}

function cloneHandPose(p) {
  return {
    wrist: { pos: p.wrist.pos.clone(), quat: p.wrist.quat.clone() },
    fingers: {
      thumb: [...p.fingers.thumb],
      index: [...p.fingers.index],
      middle: [...p.fingers.middle],
      ring: [...p.fingers.ring],
      pinky: [...p.fingers.pinky],
    },
    spread: p.spread,
  }
}

function compileHandTracks(steps, stepMeta) {
  const leftTracks = []
  const rightTracks = []
  let leftCurrent = getHandPose('relaxed', 'left')
  let rightCurrent = getHandPose('relaxed', 'right')

  for (let si = 0; si < steps.length; si++) {
    const step = steps[si]
    const { tStart, tEnd } = stepMeta[si]
    const hands = step.hands
    if (!hands) continue

    if (hands.left) {
      const to = getHandPose(hands.left.to || hands.left.from, 'left')
      const from = hands.left.from ? getHandPose(hands.left.from, 'left') : cloneHandPose(leftCurrent)
      leftTracks.push({ tStart, tEnd, from: cloneHandPose(from), to: cloneHandPose(to), ease: step.ease || 'easeInOutCubic' })
      leftCurrent = to
    }
    if (hands.right) {
      const to = getHandPose(hands.right.to || hands.right.from, 'right')
      const from = hands.right.from ? getHandPose(hands.right.from, 'right') : cloneHandPose(rightCurrent)
      rightTracks.push({ tStart, tEnd, from: cloneHandPose(from), to: cloneHandPose(to), ease: step.ease || 'easeInOutCubic' })
      rightCurrent = to
    }
  }

  return { left: leftTracks, right: rightTracks }
}

function pickGuideCards(deck, count = 6) {
  const n = deck.length
  if (n === 0) return []
  const ids = []
  const stride = Math.max(1, Math.floor(n / count))
  for (let i = 0; i < n && ids.length < count; i += stride) ids.push(deck[i].id)
  return ids
}

export function compileLesson(lessonDef, initialDeck) {
  const rng = mulberry32(lessonDef.seed ?? 1)
  const ctx = { rng }
  const steps = lessonDef.build(initialDeck, ctx)

  let currentDeck = initialDeck
  let currentPoses = toPoseMap(stackLayout(initialDeck))

  const cardTracks = new Map()
  for (const c of initialDeck) cardTracks.set(c.id, [])
  const stepMeta = []
  const annotations = []
  const cameraByStep = []
  const guides = []

  let cursor = 0

  for (let si = 0; si < steps.length; si++) {
    const step = steps[si]
    const dur = step.duration ?? 800
    const tStart = cursor
    const tEnd = cursor + dur
    const ease = step.ease || 'easeInOutCubic'
    stepMeta.push({ id: step.id, label: step.label, tStart, tEnd })
    if (step.camera) cameraByStep.push({ tStart, preset: step.camera })

    const fromPoses = currentPoses
    let endPoses = currentPoses

    if (step.kind === 'riffle') {
      const finalOrder = riffleOrder(currentDeck)
      const n = finalOrder.length
      endPoses = toPoseMap(stackLayout(finalOrder))
      finalOrder.forEach((card, k) => {
        const from = clonePose(currentPoses.get(card.id))
        const to = clonePose(endPoses.get(card.id))
        const sFrac = n <= 1 ? 0 : (k / (n - 1)) * 0.55
        const eFrac = Math.min(1, sFrac + 0.45)
        cardTracks.get(card.id).push({
          tStart: tStart + sFrac * dur,
          tEnd: tStart + eFrac * dur,
          from,
          to,
          ease,
          midBend: step.midBend ?? 3.1,
          arcLift: step.arcLift ?? 0.55,
        })
      })
      currentDeck = finalOrder
      currentPoses = endPoses
    } else if (step.kind === 'hold') {
      // no card motion; annotations only
    } else {
      if (step.reorder) currentDeck = step.reorder(currentDeck)
      endPoses = resolvePoseMap(step.to, currentDeck)
      for (const card of currentDeck) {
        const from = clonePose(currentPoses.get(card.id))
        const target = endPoses.get(card.id) || currentPoses.get(card.id)
        const to = clonePose(target)
        if (typeof step.bend === 'number') to.bend = step.bend
        cardTracks.get(card.id).push({
          tStart,
          tEnd,
          from,
          to,
          ease,
          midBend: step.midBend || 0,
        })
      }
      if (typeof step.bend === 'number') {
        for (const pose of endPoses.values()) pose.bend = step.bend
      }
      currentPoses = endPoses
    }

    // Motion-guide hints for this step.
    if (step.kind !== 'hold') {
      const cardIds = pickGuideCards(currentDeck)
      const heroId = currentDeck[Math.floor(currentDeck.length / 2)]?.id
      guides.push({
        stepIndex: si,
        tStart,
        tEnd,
        ghosts: buildGuideGhosts(endPoses, cardIds),
        arrows: buildGuideArrows(fromPoses, endPoses, cardIds),
        paths: heroId ? [buildGuidePath(fromPoses, endPoses, heroId)] : [],
      })
    } else {
      guides.push({ stepIndex: si, tStart, tEnd, ghosts: [], arrows: [], paths: [] })
    }

    if (step.annotations) {
      for (const a of step.annotations) {
        const appearAt = a.appearAt ?? 0
        const until = a.until ?? 1
        annotations.push({
          id: `${step.id}-${a.id ?? annotations.length}`,
          text: a.text,
          worldPos: a.at ?? [0, 0.6, 0.6],
          tStart: tStart + appearAt * dur,
          tEnd: tStart + until * dur,
        })
      }
    }

    cursor = tEnd
  }

  for (const segs of cardTracks.values()) segs.sort((a, b) => a.tStart - b.tStart)

  const hands = compileHandTracks(steps, stepMeta)

  return {
    duration: cursor,
    steps: stepMeta,
    cards: cardTracks,
    annotations,
    cameraByStep,
    guides,
    hands,
    finalDeck: currentDeck,
  }
}

export function stackPoseAt(index, isFaceUp, baseY = 0.02) {
  return {
    y: baseY + index * CARD_GAP,
    faceUp: isFaceUp,
  }
}

export { THREE }
