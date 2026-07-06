import * as THREE from 'three'
import { mulberry32 } from './seededRng'
import { stackLayout, toPoseMap } from './layouts'
import { riffleOrder } from '../../lib/shuffleMath'
import { CARD_GAP } from '../../lib/constants'
import { getHandPose } from '../../hands/handPoses'
import { resolveGripCards, frameOf, captureGripOffset } from './grips'
import { sampleHandSegments, sampleCardSegments } from './sampleTrack'
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

// Resolve a step's `to` (array or deck→array fn) to the ordered pose array —
// order preserved (the toPoseMap Map form loses it, which staggering needs).
function resolvePoseArray(to, deck) {
  return typeof to === 'function' ? to(deck) : to
}

// The per-item timing window used to cascade motion: item k of `count` starts
// at k/(count-1)*spread through the step and animates over `span` of it. This
// is the "one by one" stagger the riffle kind pioneered, now shared.
function staggerWindow(k, count, spread = 0.55, span = 0.45) {
  const sFrac = count <= 1 ? 0 : (k / (count - 1)) * spread
  return { sFrac, eFrac: Math.min(1, sFrac + span) }
}

// Group a destination pose array into packets by their (x,z) column, in
// first-appearance order — lets a split stagger deal packet-by-packet without
// the lesson enumerating card ids. Returns k(entry) and the packet count.
function packetIndexer(arr) {
  const index = new Map()
  const keyOf = (e) => `${Math.round(e.pos.x * 100)}|${Math.round(e.pos.z * 100)}`
  for (const e of arr) {
    const key = keyOf(e)
    if (!index.has(key)) index.set(key, index.size)
  }
  return { count: index.size, kOf: (e) => index.get(keyOf(e)) }
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

// A step's hands.<side> is either the legacy single-move shape
//   { from?, to, anchor?, motion? }
// or an ARRAY of keyframes, each { at:0..1, pose?, anchor?, fingers?, ease?, motion? }.
// Both compile to the same per-side list of segments so a hand can travel
// through several poses (and pick up procedural motion) within one step while
// still being a pure function of time. Legacy → a 2-keyframe array at {0,1}.
function normalizeHandKeyframes(spec) {
  if (Array.isArray(spec)) {
    return spec.slice().sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
  }
  // Legacy: FROM keeps its own default position (no anchor); TO gets the anchor.
  return [
    { at: 0, pose: spec.from ?? null },
    { at: 1, pose: spec.to ?? spec.from ?? null, anchor: spec.anchor, motion: spec.motion },
  ]
}

// Resolve one keyframe to a full hand pose. A named `pose` is looked up (and
// re-anchored); with no pose we clone the hand's current pose (optionally moved
// to a new anchor) so a keyframe can just nudge the wrist or override fingers.
// Partial `fingers` overrides are merged on top — the thumb-ratchet primitive.
function resolveKeyframePose(kf, side, current) {
  let base
  if (kf.pose) {
    base = getHandPose(kf.pose, side, kf.anchor)
  } else {
    base = cloneHandPose(current)
    if (kf.anchor) {
      base.wrist.pos.set(kf.anchor[0], kf.anchor[1], kf.anchor[2])
      if (side === 'left') base.wrist.pos.x *= -1
    }
  }
  if (kf.fingers) {
    for (const name of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
      if (kf.fingers[name]) base.fingers[name] = [...kf.fingers[name]]
    }
  }
  return base
}

// Bake the left/right mirror into a positional motion overlay: the x component
// is negated for the left hand so one authored orbit circles symmetrically.
// Only wrist POSITION is affected — never the quat or curls (mirror invariant).
function mirrorMotion(motion, side) {
  if (!motion) return undefined
  return { ...motion, sx: side === 'left' ? -1 : 1 }
}

function compileSideTrack(step, side, tStart, dur, current) {
  const kfs = normalizeHandKeyframes(step.hands[side])
  const defaultEase = step.ease || 'easeInOutCubic'
  // Resolve each keyframe sequentially so "clone current" keyframes chain off
  // the previous keyframe's resolved pose.
  const resolved = []
  let prev = current
  for (const kf of kfs) {
    const p = resolveKeyframePose(kf, side, prev)
    resolved.push(p)
    prev = p
  }

  const segs = []
  if (kfs.length === 1) {
    // A lone keyframe = travel from the carried-forward pose over the whole step.
    segs.push({
      tStart,
      tEnd: tStart + dur,
      from: cloneHandPose(current),
      to: cloneHandPose(resolved[0]),
      ease: kfs[0].ease || defaultEase,
      motion: mirrorMotion(kfs[0].motion, side),
    })
  } else {
    // Travel in from the carried-forward pose if the first keyframe starts late.
    if ((kfs[0].at ?? 0) > 0) {
      segs.push({
        tStart,
        tEnd: tStart + (kfs[0].at ?? 0) * dur,
        from: cloneHandPose(current),
        to: cloneHandPose(resolved[0]),
        ease: defaultEase,
      })
    }
    for (let i = 0; i < kfs.length - 1; i++) {
      segs.push({
        tStart: tStart + (kfs[i].at ?? 0) * dur,
        tEnd: tStart + (kfs[i + 1].at ?? 1) * dur,
        from: cloneHandPose(resolved[i]),
        to: cloneHandPose(resolved[i + 1]),
        ease: kfs[i + 1].ease || defaultEase,
        motion: mirrorMotion(kfs[i + 1].motion, side),
      })
    }
  }
  return { segs, last: resolved[resolved.length - 1] }
}

function compileHandTracks(steps, stepMeta) {
  const leftTracks = []
  const rightTracks = []
  let leftCurrent = getHandPose('relaxed', 'left')
  let rightCurrent = getHandPose('relaxed', 'right')

  for (let si = 0; si < steps.length; si++) {
    const step = steps[si]
    const { tStart, tEnd } = stepMeta[si]
    const dur = tEnd - tStart
    const hands = step.hands
    if (!hands) continue

    if (hands.left) {
      const { segs, last } = compileSideTrack(step, 'left', tStart, dur, leftCurrent)
      leftTracks.push(...segs)
      leftCurrent = last
    }
    if (hands.right) {
      const { segs, last } = compileSideTrack(step, 'right', tStart, dur, rightCurrent)
      rightTracks.push(...segs)
      rightCurrent = last
    }
  }

  return { left: leftTracks, right: rightTracks }
}

// Turn per-step grip declarations into compiled holds. Time-adjacent decls with
// the same side + card set are coalesced so a carried packet captures its wrist
// offset once (at grip start) and never re-captures / jitters mid-carry.
function buildHolds(decls, hands, cardTracks) {
  const byKey = new Map()
  for (const d of decls) {
    const key = `${d.side}|${[...d.cardIds].sort().join(',')}`
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(d)
  }

  const merged = []
  for (const list of byKey.values()) {
    list.sort((a, b) => a.tStart - b.tStart)
    let cur = null
    for (const d of list) {
      if (cur && d.tStart <= cur.tEnd + 1) {
        cur.tEnd = Math.max(cur.tEnd, d.tEnd)
      } else {
        cur = { side: d.side, cardIds: d.cardIds, tStart: d.tStart, tEnd: d.tEnd }
        merged.push(cur)
      }
    }
  }

  const holds = []
  for (const m of merged) {
    const frame = frameOf(sampleHandSegments(hands[m.side] ?? [], m.tStart))
    const offsets = new Map()
    for (const id of m.cardIds) {
      const cp = sampleCardSegments(cardTracks.get(id) ?? [], m.tStart)
      offsets.set(id, frame && cp ? captureGripOffset(frame, cp) : null)
    }
    if ([...offsets.values()].some(Boolean)) {
      holds.push({ side: m.side, tStart: m.tStart, tEnd: m.tEnd, offsets })
    }
  }
  return holds
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
  const gripDecls = []

  let cursor = 0

  for (let si = 0; si < steps.length; si++) {
    const step = steps[si]
    const dur = step.duration ?? 800
    const tStart = cursor
    const tEnd = cursor + dur
    const ease = step.ease || 'easeInOutCubic'
    stepMeta.push({ id: step.id, label: step.label, tStart, tEnd })
    if (step.camera) cameraByStep.push({ tStart, preset: step.camera })

    // Grip declarations resolve against the deck order BEFORE this step's
    // reorder, so 'firstHalf'/'secondHalf' name the packet currently in hand.
    if (step.grip) {
      for (const side of ['left', 'right']) {
        if (!step.grip[side]) continue
        gripDecls.push({ side, cardIds: resolveGripCards(step.grip[side], currentDeck), tStart, tEnd })
      }
    }

    const fromPoses = currentPoses
    let endPoses = currentPoses

    if (step.kind === 'riffle') {
      const finalOrder = riffleOrder(currentDeck)
      const n = finalOrder.length
      endPoses = toPoseMap(stackLayout(finalOrder))
      finalOrder.forEach((card, k) => {
        const from = clonePose(currentPoses.get(card.id))
        const to = clonePose(endPoses.get(card.id))
        const { sFrac, eFrac } = staggerWindow(k, n)
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
      const arr = resolvePoseArray(step.to, currentDeck)
      endPoses = toPoseMap(arr)

      if (step.stagger) {
        // Deal cards to their targets one by one (or packet by packet) instead
        // of moving the whole deck together.
        const { by = 'card', spread, span } = step.stagger
        let count
        let kOf
        if (by === 'packet') {
          const pk = packetIndexer(arr)
          count = pk.count
          kOf = pk.kOf
        } else {
          const order = new Map(arr.map((e, i) => [e.id, i]))
          count = arr.length
          kOf = (e) => order.get(e.id)
        }
        const seen = new Set()
        for (const e of arr) {
          seen.add(e.id)
          const to = clonePose(e)
          if (typeof step.bend === 'number') to.bend = step.bend
          const { sFrac, eFrac } = staggerWindow(kOf(e), count, spread, span)
          cardTracks.get(e.id).push({
            tStart: tStart + sFrac * dur,
            tEnd: tStart + eFrac * dur,
            from: clonePose(currentPoses.get(e.id)),
            to,
            ease,
            midBend: step.midBend || 0,
            arcLift: step.arcLift || 0,
          })
        }
        // Anything not in the destination array holds its pose for the step.
        for (const card of currentDeck) {
          if (seen.has(card.id)) continue
          const hold = clonePose(currentPoses.get(card.id))
          cardTracks.get(card.id).push({ tStart, tEnd, from: hold, to: clonePose(hold), ease, midBend: 0 })
        }
      } else {
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
            arcLift: step.arcLift || 0,
          })
        }
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
  const holds = buildHolds(gripDecls, hands, cardTracks)

  return {
    duration: cursor,
    steps: stepMeta,
    cards: cardTracks,
    annotations,
    cameraByStep,
    guides,
    hands,
    holds,
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
