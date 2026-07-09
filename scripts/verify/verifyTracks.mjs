// Headless verification of every lesson's compiled track: purity (bidirectional
// scrub safety), NaN/normalization hygiene, and motion continuity. Thresholds
// are sanity-level for the catalog at large and tightened per-flagship as the
// finger-driven system lands (see plan: the-highest-priority-for-glowing-iverson).
//
// Run: node --import ./scripts/verify/register.mjs scripts/verify/verifyTracks.mjs
import * as THREE from 'three'
import { LESSONS } from '../../src/lessons/catalog/index.js'
import { compileLesson } from '../../src/lessons/engine/compileLesson.js'
import { sampleTrack } from '../../src/lessons/engine/sampleTrack.js'
import { createDeck } from '../../src/deckModel.js'
import { FINGER_NAMES } from '../../src/hands/handRigSpec.js'
import { fingertipWorld } from '../../src/hands/handKinematics.js'
import { CARD_W, CARD_H } from '../../src/lib/constants.js'

let failures = 0
let checks = 0
const fail = (msg) => {
  failures++
  console.error(`  ✗ ${msg}`)
}
const check = (ok, msg) => {
  checks++
  if (!ok) fail(msg)
}

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Serialize a sample into plain numbers IMMEDIATELY — sampleTrack reuses
// cached output objects per card id, so holding references across samples
// silently reads the LAST sample (a prior session's harness fell for this).
function snapshot(scene) {
  const rows = []
  for (const [id, c] of scene.cards) {
    rows.push(id, c.pos.x, c.pos.y, c.pos.z, c.quat.x, c.quat.y, c.quat.z, c.quat.w, c.bend)
  }
  for (const side of ['left', 'right']) {
    const h = scene.hands[side]
    if (!h) {
      rows.push(side, null)
      continue
    }
    rows.push(side, h.wrist.pos.x, h.wrist.pos.y, h.wrist.pos.z)
    rows.push(h.wrist.quat.x, h.wrist.quat.y, h.wrist.quat.z, h.wrist.quat.w, h.spread)
    for (const f of FINGER_NAMES) rows.push(...h.fingers[f])
  }
  return rows
}

function assertFinite(scene, label) {
  for (const [id, c] of scene.cards) {
    const vals = [c.pos.x, c.pos.y, c.pos.z, c.quat.x, c.quat.y, c.quat.z, c.quat.w, c.bend]
    check(vals.every(Number.isFinite), `${label}: card ${id} non-finite`)
    const n = Math.hypot(c.quat.x, c.quat.y, c.quat.z, c.quat.w)
    check(Math.abs(n - 1) < 1e-6, `${label}: card ${id} quat |q|=${n.toFixed(8)}`)
  }
  for (const side of ['left', 'right']) {
    const h = scene.hands[side]
    if (!h) continue
    const vals = [h.wrist.pos.x, h.wrist.pos.y, h.wrist.pos.z, h.wrist.quat.x, h.wrist.quat.y, h.wrist.quat.z, h.wrist.quat.w, h.spread]
    for (const f of FINGER_NAMES) vals.push(...h.fingers[f])
    check(vals.every(Number.isFinite), `${label}: hand ${side} non-finite`)
    const n = Math.hypot(h.wrist.quat.x, h.wrist.quat.y, h.wrist.quat.z, h.wrist.quat.w)
    check(Math.abs(n - 1) < 1e-4, `${label}: hand ${side} quat |q|=${n.toFixed(8)}`)
  }
}

// The felt is the plane y=0 and no card corner may ever poke through it
// (sampleTrack's clampAboveFelt guarantees ≥0.012; assert with float slop).
const _aw = new THREE.Vector3()
const _al = new THREE.Vector3()
function assertAboveFelt(scene, label) {
  for (const [id, c] of scene.cards) {
    _aw.set(1, 0, 0).applyQuaternion(c.quat)
    _al.set(0, 1, 0).applyQuaternion(c.quat)
    const lowest = c.pos.y - (Math.abs(_aw.y) * (CARD_W / 2) + Math.abs(_al.y) * (CARD_H / 2))
    check(lowest > 0.0115, `${label}: card ${id} pokes through the felt (lowest ${lowest.toFixed(4)})`)
  }
}

// Boundary times where pops would hide: card/hand segment edges + hold edges.
function boundaryTimes(track) {
  const ts = new Set()
  for (const segs of track.cards.values()) {
    for (const s of segs) {
      ts.add(s.tStart)
      ts.add(s.tEnd)
    }
  }
  for (const side of ['left', 'right']) {
    for (const s of track.hands?.[side] ?? []) {
      ts.add(s.tStart)
      ts.add(s.tEnd)
    }
  }
  for (const h of track.holds ?? []) {
    ts.add(h.tStart)
    ts.add(h.tEnd)
  }
  return [...ts].filter((t) => t > 1 && t < track.duration - 1).sort((a, b) => a - b)
}

// Continuity thresholds. Boundary = |pos(t+0.5ms) − pos(t−0.5ms)|. The legacy
// grip-release snap measured ~0.15 before this overhaul; flagships get strict
// budgets as they are re-authored on the contact system.
const BOUNDARY_TOL = { default: 0.2, riffle: 0.2, charlier: 0.2 }

for (const lesson of LESSONS) {
  console.log(`lesson: ${lesson.id}`)
  const deck = createDeck()
  const track = compileLesson(lesson, deck)
  check(Number.isFinite(track.duration) && track.duration > 0, `${lesson.id}: bad duration`)

  const bounds = boundaryTimes(track)
  const times = [0, track.duration]
  for (let i = 0; i <= 250; i++) times.push((track.duration * i) / 250)
  for (const b of bounds) times.push(b - 0.5, b + 0.5)
  const ordered = [...new Set(times)].sort((a, b) => a - b)

  // Pass 1 (forward order): snapshots + hygiene.
  const snaps = new Map()
  for (const t of ordered) {
    const scene = sampleTrack(track, t)
    assertFinite(scene, `${lesson.id}@${t.toFixed(1)}`)
    assertAboveFelt(scene, `${lesson.id}@${t.toFixed(1)}`)
    snaps.set(t, JSON.stringify(snapshot(scene)))
  }

  // Pass 2: same times, shuffled order — byte-identical (scrub purity: no
  // hidden state, no cache mutation, direction independence).
  const shuffled = [...ordered]
  const rand = mulberry32(99)
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  let pureOk = true
  for (const t of shuffled) {
    if (JSON.stringify(snapshot(sampleTrack(track, t))) !== snaps.get(t)) {
      pureOk = false
      fail(`${lesson.id}: sample at ${t.toFixed(1)}ms differs on re-sample (impure)`)
      break
    }
  }
  check(pureOk, `${lesson.id}: purity`)

  // Pass 3: continuity across every boundary.
  const tol = BOUNDARY_TOL[lesson.id] ?? BOUNDARY_TOL.default
  let maxJump = 0
  let maxJumpAt = 0
  for (const b of bounds) {
    const before = sampleTrack(track, b - 0.5)
    const posBefore = new Map()
    for (const [id, c] of before.cards) posBefore.set(id, [c.pos.x, c.pos.y, c.pos.z])
    const after = sampleTrack(track, b + 0.5)
    for (const [id, c] of after.cards) {
      const p = posBefore.get(id)
      const d = Math.hypot(c.pos.x - p[0], c.pos.y - p[1], c.pos.z - p[2])
      if (d > maxJump) {
        maxJump = d
        maxJumpAt = b
      }
    }
  }
  check(
    maxJump < tol,
    `${lesson.id}: boundary jump ${maxJump.toFixed(4)} at ${maxJumpAt.toFixed(0)}ms (tol ${tol})`,
  )
  console.log(`  duration ${(track.duration / 1000).toFixed(1)}s, ${bounds.length} boundaries, max jump ${maxJump.toFixed(4)}`)
}

// ---------------------------------------------------------------------------
// Riffle grip fidelity: the flagship must actually LOOK finger-driven —
// fingertips near the packets they hold, and per-card releases ordered and
// close to the releasing thumb.
{
  const track = compileLesson(LESSONS.find((l) => l.id === 'riffle'), createDeck())
  const tipV = new THREE.Vector3()

  // nearest distance from a fingertip to a set of card centers
  const nearestCard = (scene, ids, tip) => {
    let best = Infinity
    for (const id of ids) {
      const c = scene.cards.get(id)
      const d = Math.hypot(c.pos.x - tip.x, c.pos.y - tip.y, c.pos.z - tip.z)
      if (d < best) best = d
    }
    return best
  }

  // 1. During every contact-frame hold, thumb + index stay near the held cards.
  for (const h of track.holds ?? []) {
    if (h.frame === 'wrist') continue
    const ids = [...h.offsets.keys()]
    for (const f of [0.15, 0.5, 0.85]) {
      const ms = h.tStart + (h.tEnd - h.tStart) * f
      const scene = sampleTrack(track, ms)
      const pose = scene.hands[h.side]
      check(!!pose, `riffle-grip: no ${h.side} hand pose during its hold @${ms.toFixed(0)}`)
      if (!pose) continue
      // only judge cards still held at this ms
      const heldNow = ids.filter((id) => ms <= (h.releases?.get(id) ?? h.tEnd))
      if (heldNow.length === 0) continue
      for (const finger of ['thumb', 'index']) {
        fingertipWorld(pose, h.side, finger, tipV)
        const d = nearestCard(scene, heldNow, tipV)
        // Distance is tip → nearest card CENTER. The deck is LANDSCAPE in the
        // bridge/cascade (cards 0.88 long, short ends toward the hands), so a
        // fingertip cupping an end face is ~0.45 from the nearest center.
        check(
          d < 0.7,
          `riffle-grip: ${h.side} ${finger} tip ${d.toFixed(3)} from its ${h.frame} packet @${ms.toFixed(0)}ms`,
        )
      }
    }
  }

  // 2. Per-card releases: strictly increasing per side, and each card releases
  //    within reach of that side's thumb.
  for (const h of track.holds ?? []) {
    if (!h.releases) continue
    const rel = [...h.releases.values()]
    const sorted = [...rel].sort((a, b) => a - b)
    check(
      rel.every((v, i) => i === 0 || v >= rel[i - 1]) || String(rel) === String(sorted),
      `riffle-release: ${h.side} release times not monotonic`,
    )
    let step = 0
    for (const [id, tRel] of h.releases) {
      if (step++ % 5 !== 0) continue // sample every 5th card
      const scene = sampleTrack(track, Math.max(h.tStart, tRel - 0.5))
      const pose = scene.hands[h.side]
      if (!pose) continue
      fingertipWorld(pose, h.side, 'thumb', tipV)
      const c = scene.cards.get(id)
      const d = Math.hypot(c.pos.x - tipV.x, c.pos.y - tipV.y, c.pos.z - tipV.z)
      check(d < 0.9, `riffle-release: card ${id} released ${d.toFixed(3)} from ${h.side} thumb @${tRel.toFixed(0)}ms`)
    }
  }
}

// ---------------------------------------------------------------------------
// Charlier fidelity: the cut must be FINGER-driven — the bottom packet rides
// the index fingertip up and over the top half while the wrist holds still.
{
  const deck = createDeck()
  const track = compileLesson(LESSONS.find((l) => l.id === 'charlier'), deck)
  const mid = Math.floor(deck.length / 2)
  const bottomIds = deck.slice(0, mid).map((c) => c.id)
  const topIds = deck.slice(mid).map((c) => c.id)
  const stepAt = (id) => track.steps.find((s) => s.id === id)
  const release = stepAt('release')
  const pivot = stepAt('pivot')
  const fall = stepAt('fall')
  check(!!release && !!pivot && !!fall, 'charlier: release/pivot/fall steps missing')

  const tipV = new THREE.Vector3()
  const centroid = (scene, ids) => {
    const c = new THREE.Vector3()
    for (const id of ids) c.add(scene.cards.get(id).pos)
    return c.multiplyScalar(1 / ids.length)
  }

  // 1. Wrist stillness: from thumb release through the pivot, the cut is in
  //    the fingers — the wrist may drift only a whisker (idle breathing).
  const base = sampleTrack(track, release.tStart).hands.right.wrist.pos.clone()
  let maxDrift = 0
  for (let f = 0; f <= 10; f++) {
    const ms = release.tStart + ((fall.tEnd - release.tStart) * f) / 10
    const w = sampleTrack(track, ms).hands.right.wrist.pos
    maxDrift = Math.max(maxDrift, w.distanceTo(base))
  }
  check(maxDrift < 0.09, `charlier: wrist drifted ${maxDrift.toFixed(3)} during the finger beats (max 0.09)`)

  // 2. The packet rides the index tip...
  let minTipDist = Infinity
  let crossed = false
  for (let f = 0.1; f <= 0.95; f += 0.05) {
    const ms = pivot.tStart + (pivot.tEnd - pivot.tStart) * f
    const scene = sampleTrack(track, ms)
    fingertipWorld(scene.hands.right, 'right', 'index', tipV)
    const bc = centroid(scene, bottomIds)
    minTipDist = Math.min(minTipDist, bc.distanceTo(tipV))
    // ...and swings ABOVE the top packet on its way over.
    let topMax = -Infinity
    for (const id of topIds) topMax = Math.max(topMax, scene.cards.get(id).pos.y)
    if (bc.y > topMax + 0.04) crossed = true
  }
  check(minTipDist < 0.45, `charlier: bottom packet never near the index tip (min ${minTipDist.toFixed(3)})`)
  check(crossed, 'charlier: bottom packet never swung above the top half')
}

// ---------------------------------------------------------------------------
// Regression: a deck left FACE-UP by the visualizer must not somersault cards
// through the felt — compileLesson normalizes faces down, so the riffle track
// must stay flat and above the table exactly like a face-down deck's.
{
  const deck = createDeck().map((c) => ({ ...c, isFaceUp: true }))
  const track = compileLesson(LESSONS.find((l) => l.id === 'riffle'), deck)
  check(track.finalDeck.every((c) => !c.isFaceUp), 'riffle-faceup: final deck not normalized face-down')
  for (let i = 0; i <= 150; i++) {
    assertAboveFelt(sampleTrack(track, (track.duration * i) / 150), `riffle-faceup@${i}`)
  }
}

if (failures > 0) {
  console.error(`\nverifyTracks: ${failures} FAILED of ${checks} checks`)
  process.exit(1)
}
console.log(`\nverifyTracks: ${checks} checks passed`)
