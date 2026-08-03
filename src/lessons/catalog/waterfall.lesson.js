import * as THREE from 'three'
import { landscapeStackLayout, cascadeLayout, faceQuat } from '../engine/layouts'
import {
  poseWithContacts,
  resolvePenetration,
  rigMetrics,
  wristAnchorForContact,
} from '../authoring/contacts'
import { CARD_GAP, CARD_W, CARD_H, CARD_T } from '../../lib/constants'
import { getHandPose, DECK_REST_DROP, DECK_APPROACH_DROP } from '../../hands/handPoses'
import { FINGERS, FINGER_NAMES, HAND_SCALE } from '../../hands/handRigSpec'

// Spring / waterfall: ONE hand cages the deck's end and bows it into an arch,
// and the cards pour off the free end into the other hand waiting below.
//
// ============================================================================
// THE CAGE IS SOLVED AGAINST THE BOWED DECK, NOT THE FLAT ONE
// ============================================================================
// This lesson used to solve its grip on the flat stack and then bend the cards
// to `ARCH_BEND 3.0`, which curls them out from under the fingers faster than
// any anchor fudge can follow. Measured on that build: 0% of gripping
// fingertips within a card-thickness of the cards they held, median gap 0.398
// against a card 0.63 wide — the worst in the catalog, and visible in a
// screenshot as hands hanging in mid-air around a deck they never touch.
//
// Three separate things were wrong, and all three are geometry, not tuning.
//
// 1. THE OLD ARCH WAS NOT AN ARCH. A card under `bend` b is mapped onto a
//    circular arc of radius R = 1/b spanning |θ| ≤ (CARD_H/2)·b. At b = 3.0
//    plus the grip's own `bendGain` that is ±88° of a circle 0.29 across —
//    smaller than a palm. The deck was not bowed, it was ROLLED, into a tube
//    whose ends point straight down and whose projected length is 0.57 instead
//    of 0.88. Nothing with fingers can cage that; the render showed a scroll
//    floating between two hands. `ARCH_BEND` is now 2.4 — 60° of bow, a crest
//    0.21 above the ends, the deck still reading as a deck. That is a stronger
//    arch than a real spring gets and it is one a hand can actually hold.
//
// 2. THE HAND WAS TURNED THE WRONG WAY. `cageGrip`'s four knuckles spread 0.74
//    along the deck's LONG axis, which is 0.88 flat and 0.72 bowed — so three
//    of every four pads sat off the end of the cards, riding an imaginary
//    extension of their plane. This cage is yawed 90°: the knuckles cross the
//    deck's WIDTH (0.63, and the bend does not touch it, because the shader
//    bends only the long axis), so all four pads land on real card at the same
//    point along the arc, thumb up on the arch.
//
// 3. THE CARDS ROSE OUT OF THE GRIP. `clampAboveFelt` lifts a bowed card until
//    its curled-down ends reach the felt, and the bow (0.21) is bigger than the
//    whole deck is thick (0.20) — so all 52 cards collapsed onto ONE plane and
//    the cage was left holding the height the flat deck used to be. The arch is
//    lifted clear of the felt before it is bowed, so the clamp never binds.
//
// Everything below follows from those three: `bowedContact` is the inverse of
// the bend shader, `bowCage` solves every pad onto it, and the beat that bows
// the cards no longer WELDS them to a hand — it lets them bow in place inside a
// hand that is already where the bowed deck will be.
//
// ============================================================================
// WHY THERE IS ONLY ONE CAGE NOW, AND WHY IT IS UP IN THE AIR
// ============================================================================
// The version that fixed all of the above satisfied its contact metric and was
// still unwatchable. Measured at the squeeze beat: both wrists at y 0.97, only
// 0.44 apart, twenty translucent finger capsules stacked over a deck whose
// crest sat at 0.48. Two hands' worth of overlapping alpha reads as ONE OPAQUE
// BLOB and the deck was inside it — a screenshot of "Squeeze — bow the deck
// into a spring arch" contained no visible deck at all. That pass had already
// named the cause correctly: at HAND_SCALE 11 a cage that genuinely wraps this
// arch is bigger than the arch from every angle. Two of them is twice that, and
// no amount of sliding one cage sideways fixes a problem whose size is the sum
// of both.
//
// So the SECOND cage is gone. One hand cages the deck's +x end; the crest and
// the whole free half stand in clear air; and the left hand goes where it
// belongs in a real spring — underneath, catching. Three things fall out of
// that and all three are the point:
//
//   * THE DECK IS VISIBLE. The only geometry over it is four fingertips at one
//     end instead of two palms meeting over the middle.
//   * THE POUR IS UNOBSTRUCTED. Cards leave the FREE end travelling down and
//     left, away from the hand. The two-handed version fired every card
//     straight at the opposite cage and needed a 0.85 forward `lean` to bend
//     their paths around it.
//   * IT READS AS A TECHNIQUE rather than a symmetry: the cards visibly travel
//     FROM one hand TO the other, which is also what a one-handed spring is.
//
// A palm-UNDER hold (fingers hooked over the far end, arch standing above the
// hand) was built and measured before this one and is worse, for a reason worth
// writing down: it puts the holding fingers directly in the exit corridor. The
// pads sit on the top card and the proximal phalanges rise past the deck's end,
// so every released card — which starts BELOW the top of the stack and has to
// travel down and out — passes straight through them. Measured 0.159 of middle
// phalange inside a spilling card, five times the budget, with no placement of
// the landing sheet that fixed it. A hand ABOVE the cards is the only
// arrangement where the cards can fall away from the hand that let them go.
//
// The arch is also carried IN THE AIR (`ARCH_BASE`) rather than a bow-height
// off the felt. A waterfall needs somewhere to fall; on the table the cards had
// 0.25 of drop and the payoff beat was a shuffle sideways.

const FELT_Y = 0.012 // the plane sampleTrack clamps every card above
const PALM_DOWN = Math.PI / 2
// The exact quaternion `landscapeStackLayout` gives every card, so the cage is
// solved against literally the cards it will hold. Card local x = width →
// world −z; local y = long axis → world +x; local z = face normal → world −y,
// so the '-z' face is the up-facing OUTSIDE of the arch.
const LANDSCAPE = faceQuat(false, Math.PI / 2)

const chainLen = (n) => (FINGERS[n].len[0] + FINGERS[n].len[1] + FINGERS[n].len[2]) * HAND_SCALE
const clampAbs = (v, m) => Math.max(-m, Math.min(m, v))
// How far a bowed card's crest stands above its own ends.
const bowOf = (bend) => (1 - Math.cos((CARD_H / 2) * bend)) / bend

// --- The inverse of the bend shader ------------------------------------------
// cardMaterial.js maps a card-local vertex (x, y, z) to
//
//     (x,  r·sin(y·b),  R − r·cos(y·b))      R = 1/b,  r = R − z
//
// which is a cylindrical shell of radius |R| about an axis parallel to local x
// (`cardSurfaceExtents` is the same fact, read as a distance). So a fingertip
// resting TANGENT on the '-z' face — the outside of the arch — has its CENTER
// at radius R + CARD_T/2 + its own radius, at the arc angle of whatever (u, v)
// patch it is touching. `surfaceContact` is the b → 0 limit of this, which is
// exactly why it put every pad in the wrong place here.
const _bc = new THREE.Vector3()
const _bo = new THREE.Vector3()
function bowedContact(card, { finger, u, v, bend, clearance = 0 }) {
  const off = FINGERS[finger].rad[2] * HAND_SCALE + CARD_T / 2 + clearance
  const hx = u * (CARD_W / 2)
  if (Math.abs(bend) < 1e-4) {
    _bc.set(hx, v * (CARD_H / 2), -off)
  } else {
    const R = 1 / bend
    const th = v * (CARD_H / 2) * bend
    const r = R + off
    _bc.set(hx, r * Math.sin(th), R - r * Math.cos(th))
  }
  return _bc
    .applyQuaternion(card.quat)
    .add(_bo.set(card.pos[0], card.pos[1], card.pos[2]))
    .clone()
}

// Seed curls for the cage. ANGLES are the one hand quantity that does not move
// with HAND_SCALE, so a grip's SHAPE is safe to write down while its POSITION
// never is; the contact IK re-solves these onto the real card surfaces and the
// seed only has to put each finger in the right basin.
const CAGE_SEED = {
  thumb: [0.9, 0.7, 0.5],
  index: [1.35, 1.1, 0.8],
  middle: [1.4, 1.15, 0.85],
  ring: [1.35, 1.1, 0.8],
  pinky: [1.25, 1.0, 0.75],
}
// Card-relative shape of the hold (fractions of a card, NOT hand-sized — a
// bridge is held at the same place on the deck whatever size the hand is):
const PAD_V = 0.85 // the four pads press this far out along the arch...
const THUMB_V = 0.45 // ...and the thumb caps it half way to the crest.
const PAD_U_MAX = 0.95 // pads stay ON the card across its width, never past it
// A pad cannot be pressed by a finger stretched straight, and the wrist has to
// be high enough that the palm is not in the cards. Lower it only until the
// SHORTEST chain that has to reach can reach — the same rule tableGrip applies
// to its thumb. (Minimising the worst reach instead drags the wrist down and
// the pads under the felt; anchoring purely off the middle finger, the long
// chain, leaves the pinky's target 0.75 from a 0.72 pinky and the solver
// answers with a straight finger pointing 0.28 past the deck.)
const REACH_MAX = 0.92
// Breathing room a SOLVED contact still needs, because two things move a pad
// after the solve and neither is in the pose this file writes: the idle overlay
// (IDLE_CURL_AMP 0.021 rad over a half-chain, ~0.017 of pad travel) and the
// grip's own `pressure` curl. Hand-sized, so it follows the rig — this is the
// same quantity contacts.js calls CONTACT_AIR, and the same bargain: the price
// of the rest is a graze rather than a hover. Contact grazes; that is what
// contact is.
const CAGE_AIR = 0.0015 * HAND_SCALE

// Solve a five-point cage on ONE END of a landscape deck bowed to `bend`.
// Returns the right-hand pose and its wrist anchor.
//
// The cage takes the +x end with its fingers pointing +x, which leaves the
// FOREARM trailing back over the arch on the −x side. That is deliberate and
// it is the cheaper of the two evils: handRig fades a broadside forearm to 0.14
// opacity, so it reads as a faint stub high above the cards, whereas yawing the
// hand the other way puts a solid palm and four knuckles in the pour's path.
function bowCage({ bend, baseY, deckH, clearance = 0 }) {
  const quat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(PALM_DOWN, Math.PI / 2, 0, 'YXZ'),
  )
  const seed = getHandPose('bridgeCage', 'right')
  // ONE COLD SEED FOR EVERY CAGE IN THE SEQUENCE, never the previous solve's
  // pose. Chaining looks like the obvious way to keep neighbouring bends on one
  // continuous IK branch, and it is a trap: `resolvePenetration` has already
  // scaled the previous answer's curls toward straight, so re-seeding from it
  // starts each solve further out than the last and the sequence walks away
  // from the deck — measured, chaining took this cage from 71% of fingertips in
  // contact to 0% and put the palm 0.16 inside the cards. A fixed seed makes
  // every key a solve of the same problem shape, which is also what keeps the
  // compiled track a pure function of this file.
  for (const n of FINGER_NAMES) seed.fingers[n] = [...CAGE_SEED[n]]
  seed.spread = 0.25
  // Every hand-sized offset below comes from HERE, under this cage's OWN
  // orientation — the same hand reaches a completely different way once it is
  // yawed 90°, which is precisely the mistake this rewrite is undoing.
  const M = rigMetrics(seed, quat)
  const top = { pos: [0, baseY + deckH, 0], quat: LANDSCAPE }
  // Centre the four knuckles on the deck's width (card local x → world −z), so
  // the array of pads straddles the end instead of hanging off one edge.
  // Sliding the array back so the near third of the bow shows was tried and
  // rejected: 0.18 of a card's width of bias cost 5 points of contact
  // (65% → 60%) and the render was no more readable, because at HAND_SCALE 11
  // the four knuckles span 0.74 against a 0.63-wide deck. What made the arch
  // visible in the end was deleting the SECOND cage, not moving this one.
  const az = -(M.knuckle.index.z + M.knuckle.pinky.z) / 2
  const uOf = (n) => clampAbs(-(az + M.knuckle[n].z) / (CARD_W / 2), PAD_U_MAX)
  const targetOf = (n) =>
    bowedContact(top, { finger: n, u: uOf(n), v: n === 'thumb' ? THUMB_V : PAD_V, bend, clearance })
  const targets = {}
  for (const n of FINGER_NAMES) targets[n] = targetOf(n)
  // Put the middle pad on its target, then drop the wrist until every finger's
  // target is inside its own chain. Fixed ladder, no randomness — the compiled
  // track stays a pure function of this file.
  const t0 = targets.middle
  const a0 = wristAnchorForContact(seed, 'right', 'middle', [t0.x, t0.y, t0.z], quat)
  const _kn = new THREE.Vector3()
  const worstReach = (dy) => {
    let w = 0
    for (const n of FINGER_NAMES) {
      _kn.set(a0[0], a0[1] + dy, az).add(M.knuckle[n])
      w = Math.max(w, _kn.distanceTo(targets[n]) / chainLen(n))
    }
    return w
  }
  let drop = 0
  for (let i = 0; i <= 60; i++) {
    drop = -chainLen('pinky') * (i / 60)
    if (worstReach(drop) <= REACH_MAX) break
  }
  const anchor = [a0[0], a0[1] + drop, az]
  const pose = poseWithContacts(seed, 'right', { anchor, quat, splay: true }, targets)
  // Tips alone are not enough — a PIP can still sit inside the stack. Back every
  // finger off the WHOLE deck, card by card, each carrying the SAME bend so
  // `cardDepth` measures against the shell the cards really are. Card by card
  // and not a handful of representatives: a card is only CARD_T thick, so five
  // samples across a 0.20 stack leave 0.045 gaps a fingertip drops straight
  // through — measured, that let the flat cage sit 0.065 inside the deck it had
  // just been solved tangent on.
  const rows = Math.max(2, Math.round(deckH / CARD_GAP) + 1)
  const column = Array.from({ length: rows }, (_, i) => ({
    pos: [0, baseY + (deckH * i) / (rows - 1), 0],
    quat: LANDSCAPE,
    bend,
  }))
  resolvePenetration(pose, 'right', column)
  return { pose, anchor }
}

export const waterfallLesson = {
  id: 'waterfall',
  title: 'Spring / Waterfall',
  technique: 'waterfall',
  difficulty: 'intermediate',
  randomizes: 'Display only',
  seed: 77,
  cameraPreset: 'springProfile',
  summary:
    'Cage one end of the deck and bow it into an arch, then let the cards spring off the free end one at a time into the hand waiting below.',
  facts: [
    'The spring stores elastic energy in the bowed cards — the waterfall is that energy releasing card by card.',
    'This is display, not mixing — but it teaches the same bend physics as the riffle bridge.',
  ],
  build: (deck) => {
    const DECK_H = (deck.length - 1) * CARD_GAP
    // The squared table deck's TOP card — every hand height over it is derived
    // from this, never guessed.
    const TOP = 0.02 + DECK_H

    // 60° of bow. See the header: the old 3.0 (plus a `bendGain` on top) rolled
    // the deck into an 88° tube 0.29 across, which is smaller than the palm
    // that was supposed to be caging it.
    const ARCH_BEND = 2.4
    const ARCH_BOW = bowOf(ARCH_BEND)
    // LIFT THE ARCH, and lift it FAR. Two reasons, one old and one new.
    //   Old: a bowed card's ends swing DOWN (the shader's `1 − cos` never
    //   changes sign and a face-down card's local +Z is world −Y), so
    //   `clampAboveFelt` pushes every bowed card up until its ends touch the
    //   table. With the deck flat on the felt that clamp is binding for ALL 52
    //   cards at once — they collapse onto a single plane one bow high and the
    //   "deck" the cage is holding stops existing. Anything past
    //   FELT_Y + ARCH_BOW clears it.
    //   New: the waterfall has to FALL. The old value was exactly that minimum
    //   (0.268), which left the cards a quarter-unit off the felt and made the
    //   payoff beat a shuffle sideways. This is a spring held at working
    //   height, and the cascade now has half a card-length of air to pour
    //   through before anything lands.
    const ARCH_BASE = 0.66
    // (The old reason still binds underneath the new one: ARCH_BASE must stay
    // above FELT_Y + ARCH_BOW = 0.218, or the clamp flattens the stack again.)
    // The two cages: one on the squared deck as it sits on the table, one on
    // the arch. Same builder, same contact parameters — only the bend and the
    // height differ, which is the whole point.
    const flatCage = bowCage({ bend: 0, baseY: 0.02, deckH: DECK_H, clearance: CAGE_AIR })
    // …and one at every state IN BETWEEN. Two poses that are each tangent on
    // their own geometry say nothing about the pose half way between them:
    // linear interpolation of wrist and curls against a deck that is
    // simultaneously rising and rolling put the ring finger 0.070 inside the
    // cards mid-squeeze. Re-solve along the way. The `at` of each key is a TIME,
    // and the deck's own progress at that time is the step's ease of it, so each
    // cage is solved on exactly the deck that will be there; the keys then
    // interpolate LINEARLY between those solved states (over a quarter of a beat
    // easeOutCubic is near enough to a straight line that the residual is under
    // a card's thickness).
    // Keys are spaced by the DECK's progress, not by clock time — easeOutCubic
    // spends half the squeeze in its first fifth, so evenly-timed keys leave
    // the steepest part of the move unsolved (measured: 0.078 of ring finger
    // inside the deck in the first 150ms). `at` is therefore the inverse ease
    // of an evenly-spaced progress.
    const ARCH_AT = (p) => 1 - Math.cbrt(1 - p) // exact inverse of easeOutCubic
    const ARCH_KEYS = [0, 0.05, 0.1, 0.16, 0.24, 0.34, 0.46, 0.6, 0.75, 0.9, 1].map((p) => {
      const at = ARCH_AT(p)
      if (p === 0) return { at, ...flatCage }
      const cage = bowCage({
        bend: ARCH_BEND * p,
        baseY: 0.02 + (ARCH_BASE - 0.02) * p,
        deckH: DECK_H,
        // TRANSIT KEYS RIDE A HAIR OFF THE CARDS. Even solved at the right
        // bend, two neighbouring keys are separate IK answers, and the state
        // half way between two answers is on neither arch — measured, 0.063 of
        // ring finger inside the deck between the p=0.30 and p=0.45 keys.
        // Seeding one solve from the last is the obvious cure and is worse (see
        // bowCage). Give the middle of the squeeze a shield instead, faded to
        // zero at both ENDS, which are the states that have to be genuinely on
        // the cards: the beat that has no grip is also the beat whose contact
        // nobody measures, and a transient 0.04 of air mid-squeeze is invisible
        // next to a finger through a card.
        clearance: CAGE_AIR + CARD_W * 0.075 * Math.sin(Math.PI * Math.sqrt(p)),
      })
      return { at, ...cage }
    })
    // The cascade holds the LAST of those keys — not a separately-solved copy.
    // A second cold solve of "the same" cage lands on a different branch, and a
    // grip captured on one pose while the beat before it ended on another is a
    // pop at the step boundary and a weld to a hand that is not there.
    const archCage = ARCH_KEYS[ARCH_KEYS.length - 1]
    const archHand = () =>
      ARCH_KEYS.map((k, i) => ({
        at: k.at,
        pose: k.pose,
        anchor: k.anchor,
        ease: 'linear',
        ...(i === ARCH_KEYS.length - 1
          ? { fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tighten', amp: 0.012 }] }
          : {}),
      }))

    // Fingertip reach of the two open presets, measured off the rig: an anchor
    // is a PAD position PLUS that reach, not a number near the deck.
    const REST_REACH = -rigMetrics('deckRest').tip.middle.x
    const APPROACH_REACH = -rigMetrics('deckApproach').tip.middle.x
    const REST_PAD_X = 0.18
    // The caption lives on the RIGHT, over the caging hand. The left half of
    // the frame IS the waterfall now, and a caption there covers the one thing
    // each step is about.
    const NOTE_POS = [1.2, 1.46, 0.15]
    // Where the caging hand waits before touching the deck: fingers pointing at
    // it, one measured drop above its top card, and far enough out that the 90°
    // wrist turn into the cage happens in clear air.
    const APPROACH = [APPROACH_REACH + 0.62, TOP + DECK_APPROACH_DROP + 0.3, 0.06]
    // The catching hand, in RIGHT-hand coordinates (the compiler negates x for
    // the left hand — poses are authored right-handed and the rig mirrors them;
    // never write a mirrored quaternion).
    //
    // Both numbers are set by ONE part of the rig: `palmCradle`'s thumb is
    // nearly straight, which stands its tip 1.16 out from the wrist and makes
    // its proximal capsule (0.187 across, the fattest thing on the hand) the
    // widest obstacle in the scene.
    //   x: far enough out that the tip stays clear of x −0.45 — the arch's own
    //      end — or the deck rises straight onto it as it bows (measured 0.103
    //      of thumb inside the arch mid-squeeze from 0.17 less than this).
    //   y: low enough that the sheet it receives, whose bowed cards hang their
    //      ends to y≈0.38, passes over it rather than through it.
    const CATCH_WAIT = [1.8, 0.42, 0.24]
    const CATCH = [1.8, 0.07, 0.2]
    // Mid-cascade the cage OPENS: out and up, never in and down. The cards
    // still in the grip ride the hand, so a hand that sinks drags its own
    // pinky through the deck's end face.
    const OPENING = [
      archCage.anchor[0] + CARD_W * 0.35,
      archCage.anchor[1] + CARD_W * 0.3,
      archCage.anchor[2],
    ]
    const OPEN = [
      archCage.anchor[0] + CARD_W * 1.1,
      archCage.anchor[1] + CARD_W * 0.85,
      archCage.anchor[2],
    ]
    // Relaxing a SOLVED grip: the cage's curls come out of the IK, so a
    // hand-typed "open" value does not open a finger — it UNFURLS it, throwing
    // the tip up and levitating whatever is still held. Scale the solved angles
    // instead, so "open" is always a fraction of THIS grip.
    const relax = (finger, k) => archCage.pose.fingers[finger].map((v) => v * k)

    // Where the spill LANDS. `cascadeLayout`'s raw sheet is centred on the
    // table; the pour now runs from one hand to the other, so it is narrowed
    // and slid LEFT to finish under the catching hand. It stays a SHEET and not
    // a pile because the cards have to arrive one at a time and be SEEN
    // arriving — that is the payoff of the lesson.
    //
    // The two-handed version needed `lean` 0.85 (the further out a card lands,
    // the further FORWARD it flies) purely to bow every card's path around the
    // opposite cage, which threw the whole pour at the camera. With that cage
    // gone the corridor is empty, so the lean is back to what it should be:
    // just enough depth that the ribbon curves toward the viewer instead of
    // stacking edge-on into one sliver.
    const SPILL = { spread: 0.42, cx: -1.3, dy: 0.22, dz: 0.24, lean: 0.42 }
    const spill = (dk) =>
      cascadeLayout(dk, SPILL.spread).map((c) => {
        const across = c.pos.x
        c.pos.x += SPILL.cx
        c.pos.y += SPILL.dy
        c.pos.z += SPILL.dz + Math.abs(across) * SPILL.lean
        return c
      })

    return [
      {
        // Turn the deck LANDSCAPE as the hand arrives. `bowCage` cups a deck's
        // end across its WIDTH, and for a landscape stack that width runs along
        // world z with the ends at x = ±CARD_H/2 — exactly where its targets
        // are authored. (Leaving the deck portrait closes the same fingers on
        // empty air outside a long edge.)
        kind: 'move',
        id: 'approach',
        label: 'Turn the deck and cage one end',
        duration: 1200,
        ease: 'easeInOutCubic',
        to: (dk) => landscapeStackLayout(dk),
        hands: {
          // THE LEFT HAND LEAVES. It has no job until there is something to
          // catch, and everything it used to do near the deck it did on top of
          // the hand that was working — which is the entire reason this lesson
          // was unreadable. It rolls palm-up on the way out so the catch is
          // already open when the first card arrives.
          left: [
            { at: 0, pose: 'deckApproach', anchor: [APPROACH[0] + 0.3, APPROACH[1] + 0.2, 0.2] },
            { at: 0.4, pose: 'deckApproach', anchor: [1.38, 1.02, 0.34] },
            { at: 1, pose: 'palmCradle', anchor: CATCH_WAIT, ease: 'easeOutCubic' },
          ],
          // Pin frame 0 (otherwise the hand lerps in from the `relaxed`
          // preset's own pre-scale wrist position, on top of the deck), then
          // come DOWN onto the cage rather than across the pile: the 90° wrist
          // turn into the cage happens out at APPROACH, and the last leg is a
          // vertical descent in the solved pose, where the pads are already
          // tangent on the top card.
          right: [
            { at: 0, pose: 'deckApproach', anchor: [APPROACH[0] + 0.3, APPROACH[1] + 0.2, 0.2] },
            { at: 0.35, pose: 'deckApproach', anchor: APPROACH },
            {
              at: 0.72,
              pose: flatCage.pose,
              anchor: [flatCage.anchor[0], flatCage.anchor[1] + CARD_W * 0.55, flatCage.anchor[2]],
            },
            { at: 1, pose: flatCage.pose, anchor: flatCage.anchor, ease: 'easeOutCubic' },
          ],
        },
      },
      {
        // NO GRIP ON THIS BEAT, deliberately. A grip WELDS the cards to a
        // fingertip frame, and the whole content of this beat is the cards
        // MOVING RELATIVE TO the fingers — bowing and lifting inside a hand
        // that squeezes them. Welding them made that impossible to author: a
        // pad tangent on the arch is a tenth of a card INSIDE the flat deck at
        // the same patch, so a hand that ends up right on the arch has to start
        // buried, and no anchor can fix a relationship the weld holds constant.
        // Let the layout carry the cards (it is the same geometry `bowCage`
        // solved against) and let the hand close on where they arrive.
        kind: 'move',
        id: 'arch',
        label: 'Squeeze — bow the deck into a spring arch',
        duration: 1500,
        ease: 'easeOutCubic',
        to: (dk) => landscapeStackLayout(dk, { baseY: ARCH_BASE, bend: ARCH_BEND }),
        bend: ARCH_BEND,
        // Push IN for the squeeze. This beat's whole subject is one arch and
        // the hand bowing it — about a hand's width of scene — and the wide
        // preset the pour needs renders it as a thumbnail in the corner.
        camera: 'springArch',
        hands: {
          // The catch is IN PLACE by 45% of the squeeze, not at the end of it:
          // the arch rises 0.64 during this beat and anything still crossing
          // x −0.45 gets swept by it (measured 0.10 of thumb inside the deck
          // with this key at `at: 1`).
          left: [{ at: 0.45, pose: 'palmCradle', anchor: CATCH, ease: 'easeInOutCubic' }],
          right: archHand(),
        },
        annotations: [
          { text: 'Load the spring — same physics as the riffle bridge', at: NOTE_POS, appearAt: 0.25 },
        ],
      },
      {
        // The grip starts HERE, and it captures a hand that is already on the
        // arch: at this instant every pad is within 0.02 of the bowed surface
        // it is holding, so the weld is a real hold rather than a hover frozen
        // in place.
        kind: 'move',
        id: 'cascade',
        label: 'Release — cards waterfall into the other hand',
        duration: 2600,
        ease: 'easeInOutCubic',
        to: (dk) => spill(dk),
        // …and back out for the pour, which is 2.5 wide from the cage to the
        // catch and does not fit the squeeze's frame.
        camera: 'springProfile',
        // Was 1.6, which on top of the arch drove held cards past bend 4 — back
        // into the tube this rewrite is getting rid of, and straight out from
        // under the pads. The spill's own per-card bend still supplies the
        // cascade's curl.
        midBend: 0.6,
        stagger: { by: 'card', spread: 0.65, span: 0.35 },
        grip: {
          // PRESSURE IS NEARLY FLAT NOW, and that is a contact fix rather than
          // a stylistic one. The packet frame is 0.5·thumb + 0.25·index +
          // 0.25·middle, so every unit of pressure curls those three and swings
          // the welded deck about a pivot the other pads sit half a deck away
          // from. Measured on this cage, the old 0.35 → 0.1 ramp cost 30 points
          // of fingertip contact by itself (index 27% in contact with the ramp,
          // 87% without). Hold the pressure; don't ramp it.
          right: { cards: 'all', frame: 'packet', release: 'stagger', pressure: [{ at: 0, v: 0.12 }, { at: 1, v: 0.1 }] },
        },
        hands: {
          left: [
            { at: 0, pose: 'palmCradle', anchor: CATCH },
            // The catch closes a little as it fills, and never rises into the
            // sheet it is receiving.
            { at: 1, pose: 'palmCradle', anchor: [CATCH[0] - 0.06, CATCH[1] - 0.02, CATCH[2]] },
          ],
          right: [
            { at: 0, pose: archCage.pose, anchor: archCage.anchor },
            // Hold the cage still while the first third of the deck leaves.
            // The pads are ON the cards here and the cards are welded to them;
            // starting the wrist moving at t=0 spends that contact on nothing.
            { at: 0.3, pose: archCage.pose, anchor: archCage.anchor },
            {
              at: 0.66,
              fingers: { thumb: relax('thumb', 0.75) },
              anchor: OPENING,
              fingerMotion: [{ fingers: ['index', 'middle', 'ring', 'pinky'], type: 'curlRipple', amp: 0.05, cycles: 3 }],
            },
            { at: 1, fingers: { thumb: relax('thumb', 0.3), index: relax('index', 0.45) }, anchor: OPEN },
          ],
        },
        annotations: [
          { text: 'Card by card off the fingertips — that is the waterfall', at: NOTE_POS, appearAt: 0.2, until: 0.9 },
        ],
      },
      {
        kind: 'move',
        id: 'gather',
        label: 'Catch and square the deck',
        duration: 1200,
        ease: 'settle',
        to: (dk) => landscapeStackLayout(dk),
        bend: 0,
        camera: 'overview',
        hands: {
          // Card-derived: the gathered stack's top card is at TOP, and a
          // `deckRest` wrist must sit DECK_REST_DROP above it for the pads to
          // land ON that card. Settle from ABOVE: the hands come back from the
          // open cage and the catch, and a straight line to the rest anchor
          // crosses the pile they are gathering.
          left: [
            // Back the catch OUT before the pile it is holding lifts off it:
            // the gather flies every card from the catch to the table centre,
            // straight over this hand's own thumb.
            { at: 0.1, pose: 'palmCradle', anchor: [CATCH[0] + 0.58, CATCH[1] - 0.01, CATCH[2] + 0.18] },
            { at: 0.55, pose: 'deckRest', anchor: [REST_REACH + REST_PAD_X, TOP + DECK_REST_DROP + 0.3, 0.0] },
            { at: 1, pose: 'deckRest', anchor: [REST_REACH + REST_PAD_X, TOP + DECK_REST_DROP, 0.0], ease: 'easeOutCubic' },
          ],
          right: [
            { at: 0.55, pose: 'deckRest', anchor: [REST_REACH + REST_PAD_X, TOP + DECK_REST_DROP + 0.3, 0.0] },
            { at: 1, pose: 'deckRest', anchor: [REST_REACH + REST_PAD_X, TOP + DECK_REST_DROP, 0.0], ease: 'easeOutCubic' },
          ],
        },
      },
    ]
  },
}
