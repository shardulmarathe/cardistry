import * as THREE from 'three'
import {
  HAND_SCALE,
  FINGERS,
  FINGER_NAMES,
  THUMB_BASE_ROT,
  JOINT_LIMITS,
  PALM_MM,
  THENAR_MM,
  mmToRig,
} from './handRigSpec'

// Pure forward kinematics for the procedural hand, where every knuckle and
// fingertip is in WORLD space, as a pure function of (pose, side). Mirrors the
// exact scene-graph chain built in handRig.js:
//
//   world = T(wrist.pos) · S(±HAND_SCALE) · R(wrist.quat)
//           · T(finger.base) · R_euler(fingerX, splayY, fingerZ, 'XYZ')
//           · [ R_x(a0) · T(0,len0,0) · R_x(a1) · T(0,len1,0) · R_x(a2) ] · p
//
// Runs headless (THREE math classes only) so the compile step and the verify
// harness can reason about contact without a renderer. fkParity.test.mjs
// asserts this module and the real rig agree to <1e-6, keep them in lockstep.
//
// MIRROR POLICY (the load-bearing rule): the left hand is the right rig under
// root.scale.x<0, so left WORLD POINTS are the exact X-mirror of right's and
// are safe to compute (negate x after rotate+scale). But a mirrored basis is
// left-handed, never build an orientation by decomposing mirrored axes into a
// quaternion. Any orientation derived here is composed as
// wrist.quat ∘ f(joint angles) only (angles are never mirrored; the rig's
// negative scale does all the mirroring).

const _eul = new THREE.Euler()
const _rx = new THREE.Quaternion()
const _seg = new THREE.Vector3()
const _xAxis = new THREE.Vector3(1, 0, 0)

// Effective knuckle rotation for a finger under a pose (v2-ready: optional
// pose.splay per-finger additive yaw, pose.thumbOpp additive opposition).
function knuckleEuler(name, pose, out) {
  const spec = FINGERS[name]
  const extraSplay = pose.splay?.[name] ?? 0
  if (name === 'thumb') {
    const opp = pose.thumbOpp
    out.set(
      THUMB_BASE_ROT.x + (opp?.x ?? 0),
      spec.splay + extraSplay,
      THUMB_BASE_ROT.z + (opp?.z ?? 0),
      'XYZ',
    )
  } else {
    out.set(0, spec.splay * pose.spread + extraSplay, 0, 'XYZ')
  }
  return out
}

// Joint positions of one finger in WRIST-LOCAL space (unscaled, unmirrored):
// out[0]=knuckle, out[1]=PIP, out[2]=DIP, out[3]=tip. `outQuat`, if given,
// receives the distal phalange's orientation in the same frame.
export function fingerJointsLocal(pose, name, out, outQuat = null) {
  const spec = FINGERS[name]
  const angles = pose.fingers[name]
  const q = (outQuat ?? _tmpQuat).setFromEuler(knuckleEuler(name, pose, _eul))
  out[0].set(spec.base[0], spec.base[1], spec.base[2])
  let prev = out[0]
  for (let i = 0; i < 3; i++) {
    q.multiply(_rx.setFromAxisAngle(_xAxis, angles[i]))
    out[i + 1].copy(_seg.set(0, spec.len[i], 0).applyQuaternion(q)).add(prev)
    prev = out[i + 1]
  }
  return out
}
const _tmpQuat = new THREE.Quaternion()

// Map a wrist-local point to WORLD space for a side: rotate by the wrist quat,
// scale, mirror x for the left hand, translate. (Scale is OUTSIDE the wrist
// rotation in the rig: root carries position+scale, the wrist group the quat.)
export function wristLocalToWorld(pose, side, p, out) {
  out.copy(p).applyQuaternion(pose.wrist.quat).multiplyScalar(HAND_SCALE)
  if (side === 'left') out.x = -out.x
  return out.add(pose.wrist.pos)
}

// World-space joint positions for one finger: [knuckle, PIP, DIP, tip].
export function fingerJointsWorld(pose, side, name, out) {
  fingerJointsLocal(pose, name, out)
  for (let i = 0; i < 4; i++) wristLocalToWorld(pose, side, out[i], out[i])
  return out
}

const _joints = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]

// World-space fingertip position for one finger.
export function fingertipWorld(pose, side, name, out) {
  fingerJointsLocal(pose, name, _joints)
  return wristLocalToWorld(pose, side, _joints[3], out.copy(_joints[3]))
}

// Convenience for harness/authoring code (allocates, not for the hot path).
export function allFingertipsWorld(pose, side) {
  const tips = {}
  for (const name of FINGER_NAMES) {
    tips[name] = fingertipWorld(pose, side, name, new THREE.Vector3())
  }
  return tips
}

// Mean curl of a finger set (0=straight, ~1.65=full fist per joint), used to
// pitch contact frames as the grip tightens/opens.
export function meanCurl(pose, names) {
  let sum = 0
  let n = 0
  for (const name of names) {
    const a = pose.fingers[name]
    sum += (a[0] + a[1] + a[2]) / 3
    n++
  }
  return n ? sum / n : 0
}

// ---------------------------------------------------------------------------
// Contact frames: where a GRIPPED packet rides. Instead of welding cards to
// the wrist, a hold can pick a frame derived from live hand surfaces (pads,
// the palm, a phalange crest) - then a thumb ratchet or a finger curl visibly
// moves the held cards. The orientation is composed as
// wrist.quat ∘ R_x(pitch(curl)), never decomposed
// from (possibly mirrored) tip positions, so it obeys the mirror policy and
// pitches the packet as the grip curls open/closed.
//
// ---------------------------------------------------------------------------
// THREE ROLES, ONE TABLE, AND THEY ARE NOT THE SAME SET OF FINGERS. An entry
// below answers three separate questions, and for most of this file's life it
// answered all three with `pressure`, which is what made a palm cradle, a
// crest-riding pivot and a phase-scored release inexpressible at once:
//
//   1. `tips` / `anchor`  WHERE THE CARDS RIDE. A weighted mean of surface
//      points, read by `contactFrame`. `tips` is the fingertip shorthand
//      ({finger: weight}); `anchor` is the general list, one weighted
//      descriptor per surface, so a frame can ride the PALM or a phalange
//      CREST instead of a pad. Both are summed, so a frame can mix them.
//   2. `pressure`  WHAT VISIBLY SQUEEZES, and by how much. Read only by
//      `applyGripPressure`, which adds PRESSURE_CURL x weight of curl per
//      joint. This is a LOOK, not a claim about contact: a cradle's fingers
//      close around a pile they are not holding by their tips.
//   3. `contacts`  WHAT IS ACTUALLY ON THE CARDS. The set the contact metric
//      SCORES (verifyTracks' CONTACT_FLOOR, tryLesson, gripProbe) and the set
//      `reseatGrippingTips` keeps on the cards between solved rungs. Each
//      entry is a surface DESCRIPTOR, so it can name a fingertip, a palm point
//      or a crest -- see contactSurfaceWorld.
//
// `contacts` is OPTIONAL and defaults to `Object.keys(pressure)` read as
// fingertips, which is exactly what all three roles used to mean. Every frame
// that does not declare it therefore behaves as it always did, down to the
// order the fingers are visited in; read it through `gripContacts`, never off
// the spec, or the default is lost.
//
// The rule for splitting them, learned the expensive way from `indexPivot`
// (whose middle finger sat 0.88-0.94 from the packet while being scored as a
// holder on every frame of the beat): `contacts` is the HONEST set. A surface
// goes in it only if a solve puts it on the cards. `pressure` may list more
// fingers than `contacts`, and a cradle's does; it must never list fewer than
// it means to move.

// Where a cradled pile SITS ON THE PALM, as fractions of the palm slab's own
// half-extents (see palmPointLocal). It is here rather than in the grip builder
// because both ends need it and they must agree: `cradleGrip` places the wrist
// so that THIS point lands on the pile's bottom face, and the `cradle` frame
// scores THIS point against the cards. A grip that moves its seat must move the
// frame's with it or the metric measures a point that is not under the pile.
//
// SWEPT, not chosen. 35 seats x 4 pile sizes x the whole placement grid, scored
// on the WORSE of a 15-card and a 52-card pile (`cradleGripAuto`), gated on
// nothing pierced, nothing skin-deep, every claimed pad reached, and every pad on
// an EDGE face. The winner and its neighbours:
//
//   seatU  seatV   worst reach   worst gap   deepest   pierced
//    0.6   -0.1       0.0014      0.0165     0.0000       0     <- this
//    0.6    0.1       0.0014      0.0165     0.0000       0
//    0.6   -0.3       0.0048      0.0165     0.0000       0
//    0.4   -0.1       0.0319      0.0165     0.0000       0
//   -0.4    0.1       0.0066      0.0165     0.0569       0
//
// u +0.6 is 24mm ULNAR of the palm centre, and that is the load-bearing half of
// the answer: every seat on the THUMB side measures 0.046-0.057 deep however the
// hand is shaped, because the thumb's own metacarpal capsule sits 0.064 below the
// palm plane with a 0.119 radius, so it stands 0.055 PROUD of the surface the
// pile is resting on. A pile seated over it is impaled by the base of the thumb.
// Real hands cradle a deck on the ulnar side of the palm with the thumb crotch
// beside it rather than under it, and this is why.
export const CRADLE_SEAT = { region: 'palm', u: 0.6, v: -0.1 }

// WHERE A PACKET CARRIED BY A CURLED INDEX ACTUALLY RESTS. Shared with
// charlier.lesson.js for the same reason CRADLE_SEAT is shared with cradleGrip:
// the lesson places the packet tangent to THIS point and the frame carries it
// from THIS point, and if the two ever disagree the metric measures a surface
// that is not under the cards. See the crest convention note below, and
// `PIVOT_SEAT` in the lesson for the clearance it is paired with.
//
// SWEPT, not chosen: every (joint, along, facing) against every pitch gain,
// scored on the CLEARANCE the packet must pay -- the largest amount by which any
// index capsule surface stands proud of this point, along the PACKET'S OWN
// normal, at any curl the cut visits. That quantity is the whole story here,
// because a welded packet's distance to its anchor never changes, so it is at
// once the depth the finger would reach into the cards and the gap the contact
// metric reports. Measured over the charlier's sweep (curl 1.55 -> 1.15):
//
//   joint  along  facing   clearance needed   note
//     1     1.00    -1          0.0039        <- this
//     1     0.75    -1          0.0205
//     2     0.00    -1          0.0304
//     2     0.25    -1          0.0621
//     2     0.50    +1          0.0938        the pad side, at any gain
//
// FACING IS -1, THE DORSAL (nail) SIDE, and that is the one result here that
// contradicts what the convention note below might suggest. It reconciles
// "crest" with "highest point" for a palm-up cradle -- but this cradle's index
// is curled ~89 degrees per joint, i.e. folded back PAST vertical, so its palmar
// side faces back down and what a packet lying on the folded finger touches is
// the dorsal surface of the middle phalange. The palmar-side descriptors are the
// worst in the table (0.09+, and 0.09 is the pinned ceiling for an index middle
// capsule, so the true depth there is unbounded): they put the packet at TIP
// height, which is precisely the impalement `SEAT` was invented to avoid.
//
// `along: 1` is the DIP joint centre, the outermost point of the folded finger:
// at the deepest curl the whole finger stands only 0.0034 proud of it. Values
// past 1 measure better still (1.45 needs 0.0065 at the shallow curl too) and
// are rejected on principle: a point past the end of its own bone is not on the
// skin, and `contactSurfaceRadius` returns 0 for a crest precisely because a
// crest IS on the skin. A contact metric scoring a point in the air is the
// failure this file's radius note warns about.
export const INDEX_PIVOT_CREST = {
  kind: 'crest',
  finger: 'index',
  joint: 1,
  along: 1,
  facing: -1,
}

export const GRIP_FRAME_TYPES = {
  // PINCH: the deck is clamped between two OPPOSING pads. Those pads are the
  // THUMB and the MIDDLE (see edgePinchGrip in authoring/contacts.js and
  // TECHNIQUE_REFERENCE.md); the index only lies on the top face to stop the
  // packet pivoting. This used to weight `tips` {thumb, index}, so a carried
  // packet rode the wrong pair of fingers entirely, and `pressure` curled the
  // stabiliser hard (index 0.9) while barely closing the clamp (middle 0.35).
  //
  // Pressure is also deliberately gentler than the other frames. PRESSURE_CURL
  // moves a pad ~0.05 world at full squeeze, twice the 0.025 band anything can
  // call contact, and on a pinch there is no slack to absorb it: opposing pads
  // are already stopped by the cards. Measured on the solved pinch, the squeezed
  // pose grazes 0.000 at squeeze 0, 0.0155 at 0.3 and 0.042 at 0.55 (always the
  // thumb's distal), so a lesson wanting a hard pinch squeeze must expect a
  // graze and price it, the way charlier's THUMB_GRAZE does.
  pinch: {
    tips: { thumb: 0.45, middle: 0.45, index: 0.1 },
    pitchFrom: ['thumb', 'middle'],
    pitchGain: 0.3,
    pressure: { thumb: 0.6, middle: 0.6, index: 0.15 },
  },
  packet: {
    tips: { thumb: 0.5, index: 0.25, middle: 0.25 },
    pitchFrom: ['index', 'middle'],
    pitchGain: 0.3,
    pressure: { thumb: 1, index: 0.8, middle: 0.8, ring: 0.5, pinky: 0.3 },
  },
  thumbPeel: {
    tips: { thumb: 0.75, index: 0.125, middle: 0.125 },
    pitchFrom: ['thumb'],
    pitchGain: 0.35,
    pressure: { thumb: 1, index: 0.3, middle: 0.3 },
  },
  // Hand-over-deck DRAW (overhand peel): the four fingers pull a packet off the
  // top of a deck the other hand holds. Every other frame here is >=50% thumb,
  // and on this rig a thumb cannot travel with the fingers across a deck gripped
  // from above, its whole chain is ~0.75 against a reach of ~1.0+. A
  // thumb-weighted frame therefore LAGS the pads and pitches about a pivot the
  // packet hangs 0.83 from, sweeping the drawn block through the middle finger
  // ~0.135 deep no matter how the pads are placed. Three separate authoring
  // passes hit that wall and each worked around it by holding the hand off the
  // cards, i.e. the hover was the price of the thumb.
  //
  // So: no thumb, and almost no pitch. A drawn packet should follow the pads,
  // not swing about them.
  fingerDraw: {
    tips: { index: 0.34, middle: 0.34, ring: 0.32 },
    pitchFrom: ['index', 'middle'],
    pitchGain: 0.08,
    pressure: { index: 1, middle: 1, ring: 0.8, pinky: 0.5, thumb: 0.2 },
  },
  // STRADDLE (edge grip): the deck is clamped between the thumb on one long
  // edge, the index over the far short end, and the PALM under the bottom face.
  // See straddleGrip in authoring/contacts.js and TECHNIQUE_REFERENCE.md.
  //
  // `tips` and `pressure` deliberately list only the fingers that are really on
  // the cards. Middle, ring and pinky lie ALONG the far long edge and touch it
  // with their lateral surfaces, not their pads, so scoring their fingertips
  // (which every other frame here does) would demand a grip no hand uses and
  // report a correct straddle as a hover. Middle carries a token pressure weight
  // because it does tighten visibly; it just isn't a fingertip contact.
  straddle: {
    tips: { thumb: 0.45, index: 0.55 },
    pitchFrom: ['index'],
    pitchGain: 0.25,
    pressure: { thumb: 1, index: 0.85 },
  },
  // TABLE-TOP HOLD: the hand lies on a packet's TOP FACE and the FELT takes the
  // reaction. There is no opposing jaw at all, which is the whole point.
  //
  // This exists because a tabled riffle is not a pinch, and authoring it as one cost
  // three separate realism defects (see the note at the riffle's `cut`): a pinch needs
  // two opposing faces, so its hand comes at the packet from the SIDE, its fingers lie
  // flat ACROSS the card faces, and its fingers WRAP - needing the space under the
  // packet, which on a squared deck is occupied by the other half. Real footage shows
  // none of that: the fingers press the top face down, the thumb sits at the near edge,
  // and the table holds everything up.
  //
  // Measured against the `end` pinch it replaces, on the riffle's own 26-card half:
  //     pinch      median pad gap 1.8mm, penetration 1.2 CARD THICKNESSES, [index middle] scored
  //     tableTop   thumb 2.2  index 1.2  middle 0.3  ring 1.3  pinky 4.7mm, penetration 0.0
  // Zero penetration is structural rather than tuned: nothing wraps and nothing opposes,
  // so no pad is ever driven into a card by the grip closing.
  //
  // `contacts` omits the PINKY deliberately. It measures 4.7mm off - outside the 0.025
  // band - because the four fingertips have to span the card's WIDTH (63mm) against a
  // 66mm knuckle row, and the pinky is the shortest finger. Scoring it would report a
  // correct hold as a hover, which is the mistake `indexPivot` and the riffle's own
  // thumb both made before.
  tableTop: {
    tips: { index: 0.3, middle: 0.4, ring: 0.3 },
    pitchFrom: ['index', 'middle', 'ring'],
    // Almost none. The packet is lying on a table; it does not swing about the pads.
    pitchGain: 0.05,
    contacts: { index: true, middle: true, ring: true, thumb: true },
    // DELIBERATELY FEEBLE, and this is the number that made the whole grip work.
    // Pressure exists to make fingers visibly tighten on a packet they are CLAMPING.
    // A table-top hold clamps nothing - the felt does the work - so the same weights
    // that suit a pinch here just drive the pads down through the top card. Measured
    // on the riffle, scaling this map: x1.0 fails the suite outright (index distal 2.2
    // card thicknesses through the face), x0.4 gives 1.0 cards, x0.2 gives 0.8, and
    // the contact percentage is FLAT at 79% across all of them. So the squeeze was
    // buying nothing and costing depth.
    pressure: { index: 0.1, middle: 0.1, ring: 0.1, pinky: 0.06, thumb: 0.08 },
  },
  // Charlier pivot: the packet rides the INDEX's CREST, and extending the
  // finger swings it, the high pitch gain converts the index's curl change
  // into the packet's up-and-over rotation (one-handed cuts).
  indexPivot: {
    tips: {},
    anchor: [{ ...INDEX_PIVOT_CREST, w: 1 }],
    // The anchor and the SCORED point are the same point, deliberately. The
    // packet is welded to the anchor, so its distance to the anchor is constant
    // for the whole ride -- which makes the metric's gap here exactly the
    // clearance the charlier's build pays above this point, and nothing else.
    // Score a different surface and that identity is lost.
    contacts: { index: INDEX_PIVOT_CREST },
    pitchFrom: ['index'],
    // POSITIVE, AND THE SIGN IS DERIVED RATHER THAN FITTED. It was -2.2, chosen
    // "empirically against the up-and-over trajectory check", and that was the
    // wrong model: with a negative gain the packet COUNTER-ROTATES against the
    // finger it is resting on, so a point on the finger sweeps up through it,
    // which is why the beat had to buy 0.218 of clearance and then rode 0.142 of
    // it as visible air.
    //
    // A packet resting on a phalange stays TANGENT to it, so its roll must equal
    // that phalange's own rotation. The middle phalange's frame turns by
    // (a0 + a1); the charlier drives all three joints from one scalar in the
    // rig's proportion (1, 0.85, 0.6), so a0 + a1 = 1.85c while
    // meanCurl = 0.81667c, and tangency is
    //     pitchGain = 1.85 / 0.81667 = 2.2653.
    // Independently, sweeping every crest descriptor x gain against the real
    // welded transform picked +2.2 as the minimum-clearance answer, needing
    // 0.0039 where the whole negative half of the range needs 0.09+. Two routes,
    // one number.
    //
    // The consequence on screen is the charlier's actual shape: with the packet
    // tangent to the finger and its centre on the PALM side of the crest, the
    // roll lifts its palm-side edge and the index's crest stays low - the packet
    // pivots about the finger and goes up and over, instead of the finger
    // levering it from underneath and then growing through it.
    //
    // It is also the whole swing size (ARCHITECTURE's tuning table): the beat's
    // lift is the anchor's own rise plus lever x sin(roll).
    pitchGain: 2.265,
    // THE MIDDLE FINGER DOES NOT HOLD THE PIVOTING PACKET. It used to be listed here
    // at 0.4, and measured through the charlier's pivot its fingertip sits 0.88-0.94
    // from the packet the whole way - at x 0.75 while those cards are at x -0.15,
    // because it is cradling the OTHER half. In a real charlier the index carries the
    // bottom packet up and over on its own while the middle, ring and pinky support the
    // half left in the palm.
    //
    // Listing it cost more than tidiness. `pressure` is the honest set of holders for
    // BOTH the contact metric here and `verifyTracks`, so a finger a world unit away was
    // being scored as a gripper on every frame of the beat - which is what pinned the
    // pivot's median gap near 0.5 and held it at 0% contact even with the index
    // correctly seated. The pivot declares no pressure keyframes, so `applyGripPressure`
    // was a no-op for it either way and no pose changes here.
    pressure: { index: 1 },
  },
  // CRADLE: an OPEN PALM-UP CUP, and the first frame here that is not
  // fingertip-weighted. The pile rests on the PALM PLANE; the thumb comes up
  // over the near long edge and the index over the far short END; the other
  // three lie along the far long edge with their lateral surfaces. NOTHING
  // crosses the TOP FACE, because that face is where packets land -- the
  // single geometric fact that a `long` edge pinch cannot satisfy (its index
  // lies on the top face as a stabiliser, and the overhand's departing bulk
  // rises straight through it; nine escape routes were measured on a deleted
  // overhand staging and none of them was the timing).
  //
  // THE CARRY ANCHOR IS THE PALM, and that is the whole point rather than a
  // detail. A cradled pile GROWS -- the overhand's goes 15 -> 52 cards -- and
  // it grows UPWARD from a bottom card that does not move. A fingertip anchor
  // is pinned at one height, so it drifts through the pile as cards land on
  // it; the palm seat is pinned to the pile's BOTTOM, which is the end
  // `baseY` and every layout in the catalog already anchor by. The cup opens
  // upward and the pile fills it.
  //
  // PITCH IS ZERO, deliberately. Every other frame rolls the packet with
  // meanCurl so a tightening grip visibly moves the cards. A cradle's fingers
  // close AROUND the pile without carrying it, so pitching on their curl
  // would tip a pile that is resting on a flat palm -- the cards would rock
  // as the hand breathed.
  //
  // `pressure` lists all five (the cup visibly closes) while `contacts` lists
  // TWO: the palm and the thumb. That divergence is the reason the `contacts`
  // field exists -- under the old rule the metric would have demanded five pads
  // on a pile whose middle, ring and pinky touch it laterally or not at all, and
  // `reseatGrippingTips` would have chased three unreachable chords.
  //
  // Two and not four, because `contacts` is a PROMISE and only these two can be
  // kept at every pile size. `cradleGrip` also seats the index and middle on the
  // far long edge where they reach, but whether they reach depends on the pile's
  // depth, and a finger that is scored where it cannot reach is exactly the
  // hover the floor exists to catch (measured: at 52 cards a requested index
  // could not make the far edge and settled on the pile's TOP face while still
  // reporting a 0.0165 gap). A lesson that wants those pads scored should pass a
  // per-hold override to `gripContacts` rather than widen this promise. Two
  // scored contacts is also what `straddle` settled on, for the same reason.
  cradle: {
    tips: {},
    anchor: [{ kind: 'palm', ...CRADLE_SEAT, w: 1 }],
    pitchGain: 0,
    pressure: { thumb: 0.5, index: 0.45, middle: 0.45, ring: 0.4, pinky: 0.35 },
    contacts: {
      palm: { kind: 'palm', ...CRADLE_SEAT },
      thumb: { kind: 'tip', finger: 'thumb' },
    },
  },
}

// ---------------------------------------------------------------------------
// NON-FINGERTIP CONTACT SURFACES
//
// A fingertip is one point on a hand, and until now it was the only one this
// module could name. Two others carry cards in real grips and neither is
// expressible as a weighted pad:
//
//   `palm`   a point on the palm's (or thenar's) PALMAR SURFACE, plus a palm
//            NORMAL. A cradled pile rests on this plane and no fingertip owns
//            it.
//   `crest`  a point on a named phalange's outermost surface along the curl,
//            which is what a packet riding a curled finger actually touches.
//            The charlier's `indexPivot` used to weld its packet a SEAT
//            clearance above the index TIP, and had to: a fixed material point
//            at the END of the chain does not track the finger's own outermost
//            surface, whose distance to the tip collapsed 0.216 -> 0.074 across
//            that cut's sweep, so the packet paid the deepest curl's clearance
//            and rode 0.142 of it (14mm of visible air) at the apex. Anchored on
//            INDEX_PIVOT_CREST instead the clearance is 0.0039 and the beat
//            measures 100% contact where it measured 0%.
//
// Geometry comes from handRigSpec (PALM_MM / THENAR_MM / FINGERS[].rad), so
// these follow the millimetre anatomy and HAND_SCALE like everything else.

const PALM_REGIONS = { palm: PALM_MM, thenar: THENAR_MM }

const _palmZ = new THREE.Vector3(0, 0, 1)

// A point on the PALMAR SURFACE of the palm slab (or the thenar eminence), in
// WRIST-LOCAL rig units.
//
//   region  'palm' (default) | 'thenar'
//   u, v    -1..1 across / along that slab, as fractions of its own
//           half-extents, 0,0 = its centre. u runs toward the PINKY (+x), v
//           toward the FINGERS (+y), matching the hand frame in handRigSpec.
//   lift    extra standoff off the surface, IN MILLIMETRES -- the one quantity
//           here that is not a fraction, and it is in mm because everything it
//           is added to is (the slab is 27mm deep). Convert once, here.
//
// The thenar carries a rotZ in the spec, so its offset is rotated before its
// centre is added, exactly as the rig builder does it (position then rotation).
export function palmPointLocal({ region = 'palm', u = 0, v = 0, lift = 0 } = {}, out) {
  const slab = PALM_REGIONS[region] ?? PALM_MM
  out.set((u * slab.size[0]) / 2, (v * slab.size[1]) / 2, slab.size[2] / 2 + lift)
  if (slab.rotZ) out.applyAxisAngle(_palmZ, slab.rotZ)
  return out.set(
    mmToRig(out.x + slab.pos[0]),
    mmToRig(out.y + slab.pos[1]),
    mmToRig(out.z + slab.pos[2]),
  )
}

// The same point in WORLD space.
export function palmPointWorld(pose, side, opts, out) {
  return wristLocalToWorld(pose, side, palmPointLocal(opts, out), out)
}


// ---------------------------------------------------------------------------
// THE CREST DIRECTION CONVENTION, and why it is NOT "the highest point".
//
// A crest is the outermost point of a phalange's SURFACE along the curl: the
// part of the finger a packet resting on it actually touches, as opposed to the
// tip, which is only where the chain ENDS. "Highest point" is the obvious
// definition and it is the wrong one, twice over:
//
//   * it is a WORLD-Y notion, and `contactFrame` runs PER FRAME on a hand that
//     turns over. The highest surface point of a finger is on the pad for a
//     palm-up cradle and on the nail for a palm-down pinch, so the definition
//     silently changes which side of the bone it means as the wrist rotates,
//     and a carried packet would cross through the finger mid-beat.
//   * it is an ARGMAX over a continuum, so it is only piecewise smooth: the
//     winning point hops from one phalange to the next as the curl passes the
//     angle where they trade places. A jump in a carry anchor is a card
//     snapping, which is the one failure mode this must not have.
//
// So a crest is FRAME-LOCAL and AUTHORED, never searched. Pick the phalange
// (`joint` 0 proximal / 1 middle / 2 distal), how far along it (`along`, 0 at
// its own joint centre, 1 at the next), and which SIDE of the bone (`facing`
// +1 palmar, the pad side that fingers curl toward; -1 dorsal, the nail side).
// The point is that phalange's axis point pushed out by its own radius along
// its own local +-z, i.e. a constant vector rotated by the product of the
// knuckle Euler and the curls up to that joint. That is continuous and
// differentiable in every joint angle, and it cannot flip sign because no sign
// is ever tested.
//
// This RECONCILES the phrase rather than contradicting it: under a palm-up
// cradle with an OPEN hand, local +z is world up, so `facing: +1` returns
// exactly the highest point in the one case where "highest" is well defined.
//
// "OPEN" IS DOING WORK IN THAT SENTENCE, and it is the trap. `facing` is a side
// of the BONE, and a bone turns over as it curls: past about a right angle per
// joint the phalange has folded back beyond vertical and its palmar side faces
// back DOWN. The charlier's index curls to 1.55 rad (89 degrees) at the joint it
// carries on, so the packet lying on that folded finger rests on the DORSAL
// side, and `INDEX_PIVOT_CREST` is `facing: -1` on a palm-up hand. Measured, the
// palmar-side descriptors are the worst in the whole sweep there (they sit at
// TIP height, 0.09+ of clearance) - so "palm-up means facing +1" is a rule of
// thumb about the WRIST, and the curl can invert it. Sweep, do not assume.
const _crestQ = new THREE.Quaternion()
const _crestOff = new THREE.Vector3()

export function crestPointLocal(pose, name, { joint = 2, along = 0.5, facing = 1 } = {}, out) {
  const spec = FINGERS[name]
  const angles = pose.fingers[name]
  const q = _crestQ.setFromEuler(knuckleEuler(name, pose, _eul))
  out.set(spec.base[0], spec.base[1], spec.base[2])
  for (let i = 0; i <= joint; i++) {
    q.multiply(_rx.setFromAxisAngle(_xAxis, angles[i]))
    if (i === joint) break
    out.add(_crestOff.set(0, spec.len[i], 0).applyQuaternion(q))
  }
  // Along the bone, then out to the skin: +y is the phalange's own axis and +z
  // its palmar side, in the frame the curls just built.
  return out.add(
    _crestOff.set(0, spec.len[joint] * along, facing * spec.rad[joint]).applyQuaternion(q),
  )
}

export function crestPointWorld(pose, side, name, opts, out) {
  return wristLocalToWorld(pose, side, crestPointLocal(pose, name, opts, out), out)
}

// ---------------------------------------------------------------------------
// One resolver for every kind of contact surface. A descriptor is
//   { kind: 'tip',   finger }                          a fingertip (the default)
//   { kind: 'palm',  region?, u?, v?, lift? }          palmPointLocal
//   { kind: 'crest', finger, joint?, along?, facing? } crestPointLocal
// plus an optional `w` weight when it is used as a carry anchor.
export function contactSurfaceWorld(pose, side, desc, out) {
  if (desc.kind === 'palm') return palmPointWorld(pose, side, desc, out)
  if (desc.kind === 'crest') return crestPointWorld(pose, side, desc.finger, desc, out)
  return fingertipWorld(pose, side, desc.finger, out)
}

// HOW FAR THE RETURNED POINT IS FROM THE FLESH, which is what a contact metric
// has to subtract before it can call anything touching. A fingertip point is a
// JOINT CENTRE, so it owes a whole distal radius (this is the
// `FINGERS[name].rad[2] * HAND_SCALE` every metric in the harness open-codes
// today). A palm or crest point is already ON the surface, so it owes nothing.
// Getting this wrong is the `padGap`/`cardDepth` confusion again: a metric that
// charges a radius for a point already on the skin reports a grip that is
// touching as a whole radius clear of the cards.
export function contactSurfaceRadius(desc) {
  if (desc.kind === 'palm' || desc.kind === 'crest') return 0
  return FINGERS[desc.finger].rad[2] * HAND_SCALE
}

// Normalise a `contacts` (or legacy `pressure`) map into descriptors keyed by
// surface id. A number or `true` means "that finger's tip", which is what the
// legacy set meant, so the default below is exactly today's behaviour.
function normaliseContacts(map) {
  const out = {}
  for (const key in map) {
    const v = map[key]
    if (!v || typeof v !== 'object') {
      out[key] = { kind: 'tip', finger: key }
      continue
    }
    const kind = v.kind ?? 'tip'
    // A tip descriptor may leave `finger` implicit in its key (`{ thumb: {} }`);
    // a palm or crest one names its own, and `palm` names none.
    out[key] = { ...v, kind, finger: v.finger ?? (kind === 'tip' ? key : undefined) }
  }
  return out
}

// The surfaces a grip frame claims are ON the cards: the set the contact metric
// scores and `reseatGrippingTips` keeps seated. Defaults to the pressure set
// read as fingertips, so a frame that has not been split behaves as before.
// `override` (a per-hold map in the same shape) is for a lesson that needs a
// PHASE-DEPENDENT set -- the riffle's weave scores 0-7% because a releasing pad
// is by definition off the cards, and the honest fix is for that beat to name
// different surfaces, not for the floor to be relaxed a third time.
const _contactsCache = new Map()
export function gripContacts(frameType, override = null) {
  if (override) return normaliseContacts(override)
  if (_contactsCache.has(frameType)) return _contactsCache.get(frameType)
  const spec = GRIP_FRAME_TYPES[frameType]
  const out = spec ? normaliseContacts(spec.contacts ?? spec.pressure) : null
  _contactsCache.set(frameType, out)
  return out
}

const _tipAcc = new THREE.Vector3()
const _tipOne = new THREE.Vector3()
const _pitchQ = new THREE.Quaternion()

// Compute the contact frame for a pose. type 'wrist' (or unknown) falls back
// to the legacy wrist frame. Writes into out {pos, quat} and returns it.
export function contactFrame(pose, side, type, out) {
  const spec = GRIP_FRAME_TYPES[type]
  if (!spec) {
    out.pos.copy(pose.wrist.pos)
    out.quat.copy(pose.wrist.quat)
    return out
  }
  _tipAcc.set(0, 0, 0)
  for (const name in spec.tips) {
    fingertipWorld(pose, side, name, _tipOne)
    _tipAcc.addScaledVector(_tipOne, spec.tips[name])
  }
  // Non-fingertip anchors (palm, crest), summed into the same weighted mean so
  // a frame can mix them with pads. Absent on every fingertip-weighted frame,
  // so those are byte-identical to before.
  if (spec.anchor) {
    for (const a of spec.anchor) {
      contactSurfaceWorld(pose, side, a, _tipOne)
      _tipAcc.addScaledVector(_tipOne, a.w ?? 1)
    }
  }
  out.pos.copy(_tipAcc)
  // A frame with no `pitchFrom` (a palm cradle) does not pitch at all. The
  // multiply by an identity quaternion is exact, so declaring pitchGain and
  // pitchFrom still gives the same numbers as before to the last bit.
  const pitch = spec.pitchFrom ? spec.pitchGain * meanCurl(pose, spec.pitchFrom) : 0
  out.quat.copy(pose.wrist.quat).multiply(_pitchQ.setFromAxisAngle(_xAxis, pitch))
  // OPT-IN: pass an `out` that already carries a `normal` Vector3 to get the
  // palm normal with the frame. Nothing allocates for callers that do not.
  return out
}

// Visibly tighten a grip: pressure p (0..1) adds curl to the frame type's
// gripping fingers. Mutates the (already-cloned, sampled) pose. Applied by BOTH
// the runtime sampler and compile-time grip capture, in the same order, so
// captured offsets always match what renders.
const PRESSURE_CURL = 0.14
const PRESSURE_JOINT_WEIGHTS = [1, 0.7, 0.45]
export function applyGripPressure(pose, type, p) {
  const spec = GRIP_FRAME_TYPES[type]
  if (!spec || !p) return pose
  for (const name in spec.pressure) {
    const angles = pose.fingers[name]
    const d = PRESSURE_CURL * p * spec.pressure[name]
    for (let j = 0; j < 3; j++) angles[j] += d * PRESSURE_JOINT_WEIGHTS[j]
  }
  return pose
}

// ---------------------------------------------------------------------------
// Analytic fingertip IK (compile-time authoring. NOT run per frame).
//
// Curls are pure local-X rotations, so a finger's chain lives in the plane
// x=0 of its post-splay knuckle frame: a rotation by cumulative angle t sends
// a phalange (0,L,0) to (0, L·cos t, L·sin t). With the human-like coupling
// a2 = DIST_COUPLING·a1 the tip is a closed-form function of (a0, a1):
//   tip(a0,a1) = Σ Lᵢ·(cos tᵢ, sin tᵢ),  t₀=a0, t₁=a0+a1, t₂=a0+(1+r)·a1
// solved with a fixed-iteration damped Gauss–Newton (deterministic, pure).
// The knuckle-frame X component of the target is unreachable by curls (splay
// is fixed by the pose) and is reported back as `planeError`.

export const DIST_COUPLING = 0.75

// How far a knuckle may ABDUCT off its pose splay to bring a target into reach.
// Real fingers spread maybe 20°; past that the hand reads as a splayed claw and
// the four fingers start crossing each other.
export const SPLAY_LIMIT = 0.35

const _inv = new THREE.Quaternion()
const _kq = new THREE.Quaternion()
const _t = new THREE.Vector3()
const _pre = new THREE.Vector3()

// Map a WORLD point into a finger's knuckle-local frame for a pose/side.
// A world DIRECTION in the knuckle frame. Same rotations as `worldToKnuckle` and
// none of its translations, because a direction has no origin - and no 1/HAND_SCALE
// either, since scaling a direction only changes its length. The left-hand mirror is
// still a component negation: that is the documented policy (POINTS may be mirrored;
// orientations are only ever composed, never decomposed under negative scale), and
// negating x of a direction is the same reflection, not a decomposition.
export function worldDirToKnuckle(pose, side, name, dir, out) {
  out.copy(dir)
  if (side === 'left') out.x = -out.x
  out.applyQuaternion(_inv.copy(pose.wrist.quat).invert())
  _kq.setFromEuler(knuckleEuler(name, pose, _eul))
  out.applyQuaternion(_inv.copy(_kq).invert())
  return out.normalize()
}

export function worldToKnuckle(pose, side, name, world, out) {
  const spec = FINGERS[name]
  out.copy(world).sub(pose.wrist.pos)
  if (side === 'left') out.x = -out.x
  out.multiplyScalar(1 / HAND_SCALE)
  out.applyQuaternion(_inv.copy(pose.wrist.quat).invert())
  out.sub(_t.set(spec.base[0], spec.base[1], spec.base[2]))
  _kq.setFromEuler(knuckleEuler(name, pose, _eul))
  return out.applyQuaternion(_inv.copy(_kq).invert())
}

const clampJoint = (a) => Math.min(JOINT_LIMITS.max, Math.max(JOINT_LIMITS.min, a))

// A world point in a finger's PRE-SPLAY knuckle frame: everything
// worldToKnuckle does except the final knuckle rotation.
function worldToPreSplay(pose, side, name, world, out) {
  const spec = FINGERS[name]
  out.copy(world).sub(pose.wrist.pos)
  if (side === 'left') out.x = -out.x
  out.multiplyScalar(1 / HAND_SCALE)
  out.applyQuaternion(_inv.copy(pose.wrist.quat).invert())
  return out.sub(_t.set(spec.base[0], spec.base[1], spec.base[2]))
}

// --- Splay solve -------------------------------------------------------------
// Curls are pure local-X rotations, so a finger's reachable set is the PLANE
// x = 0 of its post-splay knuckle frame, the `planeError` solveFingerTo
// reports is the part of a target that no amount of curling can ever reach.
// Splay is the missing degree of freedom, and for a non-thumb finger the
// knuckle rotation is a single yaw about local Y (knuckleEuler), so the exact
// yaw that swings a target INTO that plane is a closed form, not a search:
//
//   the post-splay x of a target t (in the pre-splay knuckle frame) is
//       x_local = t.x·cos S − t.z·sin S
//   which is zero at  S = atan2(t.x, t.z).
//
// Writing that back as pose.splay[name] (an ADDITIVE yaw over the preset's own
// spec.splay·spread, the units knuckleEuler and applyHandPose both already
// read) makes the target reachable and keeps FK, the rig and this solver in
// agreement. Clamped to SPLAY_LIMIT: an anatomically silly yaw is worse than a
// small residual.
//
// The thumb is deliberately excluded. Its knuckle rotation is a full XYZ Euler
// (THUMB_BASE_ROT + opposition), so its yaw is not the last rotation in the
// chain and this closed form does not apply; `solveThumbTo` already searches
// the opposition that swings ITS plane onto the target.
export function solveSplayFor(pose, side, name, targetWorld) {
  if (name === 'thumb') return 0
  const spec = FINGERS[name]
  worldToPreSplay(pose, side, name, targetWorld, _pre)
  const want = Math.atan2(_pre.x, _pre.z)
  const base = spec.splay * pose.spread
  let extra = want - base
  // Wrap into (-PI, PI] before clamping so a target BEHIND the knuckle (z < 0,
  // where atan2 flips sign) doesn't ask for a 300° yaw.
  extra = Math.atan2(Math.sin(extra), Math.cos(extra))
  return Math.min(SPLAY_LIMIT, Math.max(-SPLAY_LIMIT, extra))
}

// Solve joint angles [a0,a1,a2] so `name`'s tip lands on targetWorld (as close
// as curls allow). Returns { angles, splay, error, planeError }. Pure +
// deterministic: a closed-form splay (see solveSplayFor) that brings the target
// into the finger's curl plane, then fixed 24 Gauss–Newton iterations from the
// pose's current curl inside it.
//
// `splay` is OPT-IN and defaults OFF. It is an ADDITIVE knuckle yaw, and a
// caller that asks for it must write the returned value into pose.splay[name]
// for FK to reproduce the solve, poseWithContacts does, under its own `splay`
// option. Off by default because it MOVES EVERY EXISTING SOLVE: a lesson that
// iterated a wrist height against the old curl-only solver (overhand's
// `recvWristFor` is the live example) re-converges somewhere else, and its
// mid-stroke interpolated poses are not re-resolved. Turn it on per grip, and
// re-measure that grip's penetration when you do.
// TANGENCY: solve so the DISTAL PHALANGE lies flat in a surface, not just so the
// fingertip lands on it.
//
// Why this has to exist. `surfaceContact` places a fingertip's CENTRE one radius
// clear of a card face, which makes the TIP tangent - and constrains nothing about
// the angle of the distal phalange behind it. A steeply curled finger therefore
// touches correctly at the pad and dips the rest of that distal capsule THROUGH the
// card. Measured on a prototype top-face grip for the table riffle: pads landing at
// 0mm with the ring's DISTAL 5.4 card thicknesses inside the deck. `resolvePenetration`
// cannot fix it, because lifting the hand breaks the other contacts. It is very likely
// why grips in this codebase have to be swept rather than authored.
//
// Why it needs a third DOF. The curl solve has two (a0, a1) and pins the distal by
// `DIST_COUPLING` (a2 = 0.75*a1), so hitting a 2D tip target uses up all the freedom
// there is. Position AND distal orientation is three constraints, so a2 must come off
// its coupling. That is a deliberate exception and it is also the more anatomical
// answer for this case: a fingertip resting FLAT on a surface has its distal angle set
// BY the surface, which is exactly what the coupling is preventing here.
//
// It is exactly determined and closed-form, not iterated: fixing the distal's angle T
// makes the L2 segment a known vector, so subtracting it turns the problem into the
// classic analytic two-link reach for (L0, L1). No Gauss-Newton, no local minima.
//
// WHAT IT ACTUALLY CONSTRAINS IS THE WRIST, and that is the useful finding. Tangency is
// not a property a finger can supply on its own from wherever the hand happens to be:
// measured on a table-riffle top-face contact, with the wrist at y 0.61 the distal
// would have to hyperextend about 2.6 rad to lie flat, which is far past JOINT_LIMITS,
// so this returns nothing and the caller falls back to the curl solve. Raise the same
// wrist to y 0.80 - above the cards, reaching DOWN at a shallower angle - and it solves
// to 0.00mm at every z tried. So a grip that wants tangent pads has to place its wrist
// for it; `wristAnchorForContact` places a wrist from a pad POSITION and knows nothing
// about this, which is why the first top-face prototype could not find a clean pose.
// It fails closed, never silently: `tangent: true` on the result says it was honoured.
const _tanN = new THREE.Vector3()
const _tanK = new THREE.Vector3()

// Solve [a0,a1,a2] for a tip at (ty,tz) in the knuckle plane with the distal held at
// cumulative angle T. Returns null when the two-link reach cannot make it.
function solveWithDistalAngle(L0, L1, L2, ty, tz, T) {
  const py = ty - L2 * Math.cos(T)
  const pz = tz - L2 * Math.sin(T)
  const d = Math.hypot(py, pz)
  // Outside the annulus the two links can reach, tangency is not available at all.
  if (d > L0 + L1 || d < Math.abs(L0 - L1)) return null
  let c1 = (d * d - L0 * L0 - L1 * L1) / (2 * L0 * L1)
  c1 = c1 > 1 ? 1 : c1 < -1 ? -1 : c1
  const a1 = Math.acos(c1) // positive branch: fingers curl toward +z
  const a0 = Math.atan2(pz, py) - Math.atan2(L1 * Math.sin(a1), L0 + L1 * Math.cos(a1))
  const a2 = T - (a0 + a1)
  return [a0, a1, a2]
}

export function solveFingerTo(pose, side, name, targetWorld, { splay = false, tangentTo = null } = {}) {
  const spec = FINGERS[name]
  const [L0, L1, L2] = spec.len
  let solvedSplay = pose.splay?.[name] ?? 0
  if (splay && name !== 'thumb') {
    solvedSplay = solveSplayFor(pose, side, name, targetWorld)
    // Solve the curl inside the plane this yaw actually produces.
    pose = { ...pose, splay: { ...(pose.splay ?? {}), [name]: solvedSplay } }
  }
  const v = worldToKnuckle(pose, side, name, targetWorld, new THREE.Vector3())
  const ty = v.y
  const tz = v.z
  const r = DIST_COUPLING

  // TANGENT SOLVE, opt-in. `tangentTo` is the surface NORMAL in world space; the
  // distal is asked to lie perpendicular to it, i.e. flat in the surface.
  if (tangentTo && name !== 'thumb') {
    // The normal in the knuckle frame. Only its (y,z) part matters: the curl plane
    // is that plane, and the x component is what `planeError` already reports.
    _tanN.copy(tangentTo)
    worldDirToKnuckle(pose, side, name, _tanN, _tanK)
    // Two in-plane directions are perpendicular to the normal; take whichever points
    // more nearly along the target, so the finger reaches FORWARD onto the surface
    // rather than folding back off it.
    const cand = [Math.atan2(-_tanK.y, _tanK.z), Math.atan2(_tanK.y, -_tanK.z)]
    const aim = Math.atan2(tz, ty)
    const T = Math.abs(Math.atan2(Math.sin(cand[0] - aim), Math.cos(cand[0] - aim)))
      <= Math.abs(Math.atan2(Math.sin(cand[1] - aim), Math.cos(cand[1] - aim)))
      ? cand[0]
      : cand[1]
    const sol = solveWithDistalAngle(L0, L1, L2, ty, tz, T)
    if (sol) {
      const a = [clampJoint(sol[0]), clampJoint(sol[1]), clampJoint(sol[2])]
      // Only accept it if clamping did not silently change the answer - a clamped
      // joint means the tangent pose is outside the hand's range, and a pinned joint
      // lands the tip nowhere near the target (the guard `reseatGrippingTips` learned
      // the hard way, where an unguarded pin made a deviation five times worse).
      const clamped = a.some((x, i) => Math.abs(x - sol[i]) > 1e-9)
      if (!clamped) {
        const t0 = a[0]
        const t1 = a[0] + a[1]
        const t2 = a[0] + a[1] + a[2]
        const y = L0 * Math.cos(t0) + L1 * Math.cos(t1) + L2 * Math.cos(t2)
        const z = L0 * Math.sin(t0) + L1 * Math.sin(t1) + L2 * Math.sin(t2)
        return {
          angles: a,
          splay: solvedSplay,
          error: Math.hypot(ty - y, tz - z) * HAND_SCALE,
          planeError: Math.abs(v.x) * HAND_SCALE,
          tangent: true,
        }
      }
    }
    // Fall through to the curl solve. Tangency is a request, not a guarantee.
  }

  let a0 = pose.fingers[name][0]
  let a1 = pose.fingers[name][1]
  const tip = (p0, p1) => {
    const t0 = p0
    const t1 = p0 + p1
    const t2 = p0 + (1 + r) * p1
    return [
      L0 * Math.cos(t0) + L1 * Math.cos(t1) + L2 * Math.cos(t2),
      L0 * Math.sin(t0) + L1 * Math.sin(t1) + L2 * Math.sin(t2),
    ]
  }
  for (let it = 0; it < 24; it++) {
    const [y, z] = tip(a0, a1)
    const ey = ty - y
    const ez = tz - z
    // Jacobian of (y,z) wrt (a0,a1), closed form.
    const t0 = a0
    const t1 = a0 + a1
    const t2 = a0 + (1 + r) * a1
    const dy0 = -L0 * Math.sin(t0) - L1 * Math.sin(t1) - L2 * Math.sin(t2)
    const dz0 = L0 * Math.cos(t0) + L1 * Math.cos(t1) + L2 * Math.cos(t2)
    const dy1 = -L1 * Math.sin(t1) - (1 + r) * L2 * Math.sin(t2)
    const dz1 = L1 * Math.cos(t1) + (1 + r) * L2 * Math.cos(t2)
    const det = dy0 * dz1 - dy1 * dz0
    if (Math.abs(det) < 1e-9) break
    // Damped Newton step (0.8 keeps it stable near the straight-arm singularity).
    a0 = clampJoint(a0 + (0.8 * (ey * dz1 - ez * dy1)) / det)
    a1 = clampJoint(a1 + (0.8 * (ez * dy0 - ey * dz0)) / det)
  }
  const [y, z] = tip(a0, a1)
  const angles = [a0, a1, r * a1]
  return {
    angles,
    splay: solvedSplay,
    error: Math.hypot(ty - y, tz - z) * HAND_SCALE,
    planeError: Math.abs(v.x) * HAND_SCALE,
  }
}

// ---------------------------------------------------------------------------
// TASK-SPACE INTERPOLATION FOR A HELD HAND
//
// The problem this solves (ARCHITECTURE.md, "Open work"): a grip's keyframes are
// SOLVED, so at every authored rung each gripping pad sits exactly on the cards.
// Between rungs the compiler lerps JOINT ANGLES, so each pad swings along a
// circular arc while the contact frame the packet rides is a weighted MEAN of
// those pads. A mean of arcs is not the arc of the mean: the pads bow away from
// the packet mid-segment, and because the contact metric charges a whole capsule
// radius for a pad centre inside a card, a fraction of a millimetre of bow reads
// as deep penetration. Every rung measuring 0.000 while the segment between them
// does not is the signature. Densifying the rungs does not fix it (measured
// 0.084 at 8 rungs, 0.076 at 14, WORSE at 24 and 40 as per-rung solve noise
// outgrows the sag) because it is not a sampling error.
//
// The fix is to interpolate the pads in TASK SPACE. Take each gripping
// fingertip's position in WRIST-LOCAL space at both rungs, lerp those POINTS,
// and re-solve the finger's curl onto the lerped point. Every pad then travels a
// straight line in the wrist frame, and since the contact frame is a linear
// combination of pads, so does the frame -- which makes (pad - frame) linear too.
// It equals "pad on the cards" at both ends, so it stays close to it throughout,
// instead of bowing.
//
// Wrist-local, not world, on purpose: the wrist's own translation and rotation
// still interpolate exactly as before (position lerp, quaternion slerp), so this
// changes only the finger curl WITHIN the hand and cannot disturb a carry.
// Mirror policy is respected: only POINTS cross the left-hand mirror, and the
// solve happens in the finger's own knuckle frame.
const _tipsFrom = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
const _tipsTo = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
const _tipLerp = new THREE.Vector3()
const _tipWorld = new THREE.Vector3()

// Re-solve `out`'s gripping fingers so their tips sit on the straight line
// between their `from` and `to` tips at blend `e`. `out` must already be the
// joint-lerped pose of the same two rungs (its wrist is what the tips are
// measured against). Mutates and returns `out`. Pure and deterministic, so
// scrub purity and boundary continuity are preserved: at e=0 and e=1 the solve
// target IS the rung's own tip, so the reseat is a no-op at every boundary.
// A reseat is only accepted when the solve actually REACHES the chord. This
// guard is load-bearing, not defensive: where a lerped chord target is outside a
// finger's reach, solveFingerTo pins its joints against JOINT_LIMITS and the tip
// lands nowhere near the target -- measured on the overhand's right pinky, whose
// pad targets sit a card-width past the deck's near edge, an unguarded reseat
// made the deviation it was meant to remove FIVE TIMES WORSE (17mm -> 83mm).
// Falling back to the joint lerp there is never worse than today's behaviour.
//
// The threshold is on `error`, the in-plane reach residual, and deliberately NOT
// on `planeError`, the component no amount of curling can reach (splay is fixed
// by the pose). A thumb whose chord sits off its opposition plane still lands
// far closer to the chord than its arc did -- the riffle's thumb goes 30mm ->
// 7mm of residual plane error -- so rejecting on planeError would throw away the
// biggest win in the catalog.
// IT INTERPOLATES TIPS EVEN FOR A NON-TIP CONTACT, and that is a known,
// measured limitation rather than an oversight. `grippingFingers` reads the
// `contacts` set, so a crest-riding frame lands here with its finger named, but
// `solveFingerTo` can only aim a TIP: the chord straightened is the tip's, not
// the crest's. It is sound for a crest contact because a crest is a rigid
// function of the same joint angles, so it follows whatever the tips do
// smoothly. Measured on the charlier's pivot (one finger, one solve per rung):
// the beat holds 100% contact at a median gap of 0.001 against the 0.0031 the
// weld alone would give, and the residual costs 0.0021 of penetration - the
// reseat pulls the curl a whisker off the pure `idx(c)` family the lesson
// authors. Aiming a crest would need a second Jacobian; it is not worth one for
// 2mm on one beat, and this note is here so the next frame that carries cards on
// a crest with SEVERAL fingers knows to re-measure before trusting it.
const RESEAT_TOL = 0.02 // world units, ~2mm: three card thicknesses

export function reseatGrippingTips(out, from, to, side, e, fingerNames) {
  for (const name of fingerNames) {
    if (!out.fingers[name]) continue
    fingerJointsLocal(from, name, _tipsFrom)
    fingerJointsLocal(to, name, _tipsTo)
    _tipLerp.lerpVectors(_tipsFrom[3], _tipsTo[3], e)
    wristLocalToWorld(out, side, _tipLerp, _tipWorld)
    const s = solveFingerTo(out, side, name, _tipWorld)
    if (s.error <= RESEAT_TOL) out.fingers[name] = s.angles
  }
  return out
}

// The fingers a grip frame actually claims to be holding with -- the same set
// the contact metric scores, so this is the set worth keeping on the cards.
// Read off `contacts` (which defaults to the pressure set, so every existing
// frame returns the identical array in the identical order), and deduped
// because two surfaces can name one finger: a crest-riding pivot has its index
// listed once, not twice, and a cradle's palm names no finger at all. Returns
// null only when NO surface in the set names a finger.
//
// A `cradle` does NOT reach that path, and an earlier comment here wrongly said it
// did. Its scored set is the palm AND THE THUMB, so this returns ['thumb'] and
// `sampleTrack` reseats that thumb. That is correct rather than merely harmless:
// the thumb is a genuine scored contact on a cradle, and reseating is what keeps it
// on the cards -- measured 100% in band at a median gap of 0.0140 across every
// gripped beat of the shipping overhand.
export function grippingFingers(frameType) {
  const cs = gripContacts(frameType)
  if (!cs) return null
  const out = []
  for (const key in cs) {
    const f = cs[key].finger
    if (f && !out.includes(f)) out.push(f)
  }
  return out.length ? out : null
}

// Thumb IK: the thumb's curl plane is set by its opposition (thumbOpp swings
// the whole metacarpal), so a planar solve alone can't reach an off-plane
// target. Grid-search thumbOpp.z (± about the rig's base opposition), planar-
// solve inside each candidate plane, keep the best total error. Returns
// { angles, thumbOpp, error }, write both into the pose.
export function solveThumbTo(pose, side, targetWorld, { oppRange = 0.9, steps = 25 } = {}) {
  let best = null
  const probe = { ...pose, thumbOpp: { x: pose.thumbOpp?.x ?? 0, z: 0 } }
  for (let i = 0; i < steps; i++) {
    const oppZ = -oppRange + (2 * oppRange * i) / (steps - 1)
    probe.thumbOpp = { x: pose.thumbOpp?.x ?? 0, z: oppZ }
    const s = solveFingerTo(probe, side, 'thumb', targetWorld)
    const total = Math.hypot(s.error, s.planeError)
    if (!best || total < best.total) {
      best = { angles: s.angles, thumbOpp: { ...probe.thumbOpp }, error: s.error, planeError: s.planeError, total }
    }
  }
  return best
}
