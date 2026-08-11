// Single source of truth for every number that determines WHERE the hand's
// geometry sits: the rig builder (handRig.js), the pure forward-kinematics
// module (handKinematics.js), and the headless verification harness all import
// from here. Pure data, no THREE, no geometry, safe to import anywhere.
//
// Local hand frame (before the wrist quaternion):
//   +y : the direction fingers extend from their knuckles (fingers point "up").
//   +z : the PALMAR direction, the palm faces +z and fingers curl toward +z
//        (a positive joint rotation about local X sweeps the tip toward +z).
//   +x : toward the pinky (ulnar) side; the thumb sits on the -x (radial) side.
// The wrist sits at the origin, knuckles near y≈+0.05, forearm trails to -y.
// The left hand is produced by mirroring the whole rig on X (root.scale.x < 0).
//
// ---------------------------------------------------------------------------
// WHY THIS FILE IS WRITTEN IN MILLIMETRES
//
// It used to carry bare rig-unit literals, and they had drifted a long way from
// a hand. Measured against a card (the one object on screen with a known real
// size, so the only honest ruler here), the rig was: fingers 1.20-1.26x too
// LONG, 1.38-1.53x too THICK, with distal phalanges whose length/diameter ratio
// was 0.73-1.06 -- a real fingertip is 1.4-1.8, so every fingertip was a
// literal sphere. The palm slab was 1.21x too wide, the knuckle row was almost
// square (7mm of index-to-pinky obliquity against ~10mm real) and its palmar z
// values put the MIDDLE knuckle furthest forward, which domes the palm the
// WRONG WAY: a convex palm instead of a concave one.
//
// That combination is what made two translucent hands read as a cluster of
// sausages rather than hands, and it is also why they hover. The contact metric
// charges a full capsule radius the moment a pad centre enters a card's
// 0.3mm-thick slab, so a 1.4x-too-fat finger inflates every penetration reading
// by the same factor and forces grips to be authored with air under the pads.
// See ARCHITECTURE.md, "Open work".
//
// So the numbers below are ANATOMY, in millimetres, and the conversion to rig
// units is done once, here. Adult male 50th percentile: hand length (wrist
// crease to middle fingertip) 189mm, palm length (crease to middle MCP) 106mm,
// hand breadth across the MCP heads 88mm. Anything added here should be typed
// as a millimetre measurement with a source, not as a rig-unit literal that
// happened to look right in one lesson.
import { CARD_W } from '../lib/constants'

// The world's only real-size reference: a poker card is 63.5mm wide.
export const WORLD_UNIT_MM = 63.5 / CARD_W // ≈ 100.8 mm per world unit

// Whole-rig scale: the rig is authored in small units and rendered under this
// factor (root.scale), so world = rig * HAND_SCALE. Kept at 11 because a lot of
// authored lesson geometry is expressed as `something * HAND_SCALE`; the
// anatomy fix lives in the millimetre table below, not here.
export const HAND_SCALE = 11

// millimetres -> rig units (rig * HAND_SCALE * WORLD_UNIT_MM = mm)
export const mmToRig = (mm) => mm / (HAND_SCALE * WORLD_UNIT_MM)

// Anatomy, in millimetres, in the local hand frame with the origin at the palm
// CENTRE (so the wrist crease is at y ≈ -55 and the middle knuckle at y ≈ +51,
// giving the real 106mm palm).
//
//   mcp : knuckle position       [x across, y distal, z palmar]
//   seg : segment lengths        [proximal, middle, distal], joint centre to
//         joint centre, with the distal segment carrying the soft pulp out to
//         the fingertip (which is why it is longer than the distal BONE).
//   dia : segment diameters      [proximal, middle, distal], tapering to the tip
//   splay: sideways knuckle splay weight (scaled by pose.spread) -- a rig
//         authoring value, not an anatomical one, so it stays in radians.
const ANATOMY_MM = {
  // THUMB REACH IS DELIBERATELY *NOT* RE-DERIVED. Anatomically the chain should
  // model metacarpal -> proximal -> distal from the trapeziometacarpal joint,
  // which is 102mm from a base 20mm proximal of the palm centre. That was tried
  // and it broke four lessons: at 102mm the thumb overshoots every grip it was
  // authored against and drives straight through the packet (charlier's
  // penetration went 0.036 -> 0.062, the waterfall's 0.028 -> 0.092, and faro's
  // solved contact collapsed 59% -> 23%). Reach interacts with every authored
  // thumb anchor and with the IK's opposition search; thickness does not.
  //
  // So the base and the 75mm total reach are held at their tuned values and only
  // the DIAMETERS are corrected (37/32/24mm -> 24/21/15mm; the old thumb was
  // 1.53x too fat), with ~2mm of length shifted from the proximal segment into
  // the distal one so the tip is a fingertip (aspect 1.40) and not a ball
  // (aspect 0.73). Re-deriving the reach belongs with a pass that re-solves the
  // thumb anchors in the four lessons above, not with a geometry change.
  thumb: { mcp: [-50.9, -13.3, 8.9], seg: [31, 23, 21], dia: [24, 21, 15], splay: -0.35 },
  // MCP x span is 66mm joint-centre to joint-centre; with ~19mm fingers that
  // puts the hand's outer breadth at ~85mm, against 88mm real.
  //
  // y is the real oblique knuckle row, as distance from the WRIST CREASE minus
  // the 55mm from the crease to the palm centre: index 100, middle 106, ring
  // 102, pinky 95. The middle knuckle is the furthest out and the pinky's is
  // 11mm proximal of it, which is the slant you see across a closed fist. It
  // was a near-square row (7mm across all four).
  //
  // z is CONCAVE: the index and pinky borders of the palm come forward and the
  // middle sits back, which is how a palm cups. The old values had the MIDDLE
  // knuckle furthest palmar, doming the palm the wrong way (convex).
  index: { mcp: [-33, 45, 5], seg: [35, 23, 21], dia: [20, 18, 15], splay: -0.16 },
  middle: { mcp: [-11, 51, -1], seg: [38, 25, 23], dia: [21, 19, 16], splay: -0.03 },
  ring: { mcp: [11, 47, 1], seg: [36, 23, 21], dia: [20, 18, 15], splay: 0.11 },
  pinky: { mcp: [33, 40, 7], seg: [28, 18, 17.5], dia: [17, 15, 12.5], splay: 0.26 },
}

//   base : knuckle position on the palm  [x across, y up, z palmar]
//   len  : phalange lengths [proximal, middle, distal]  (middle finger longest)
//   rad  : phalange radii   [proximal, middle, distal]  (tapers to the tip)
//   splay: sideways knuckle splay weight (scaled by pose.spread)
export const FINGERS = Object.fromEntries(
  Object.entries(ANATOMY_MM).map(([name, a]) => [
    name,
    {
      base: a.mcp.map(mmToRig),
      len: a.seg.map(mmToRig),
      rad: a.dia.map((d) => mmToRig(d / 2)),
      splay: a.splay,
    },
  ]),
)

export const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky']

// Palm masses, also in millimetres. The palm slab is deliberately NARROWER than
// the hand's outer breadth (80mm against 85mm): the finger capsules themselves
// supply the outer edge, and a slab as wide as the whole hand reads as a paddle.
// It spans the wrist crease (y -55) to the knuckle row (y +51), so it is 106mm
// tall centred 2mm below the origin.
export const PALM_MM = { size: [80, 106, 27], pos: [-2, -2, 0] }
// Thenar eminence: the fleshy pad at the base of the thumb. Real one is about
// 50mm long, 36 across, 26 deep; it was authored 67mm long, which pushed a
// visible slab down the wrist.
export const THENAR_MM = { size: [36, 50, 26], pos: [-34, -22, 8], rotZ: -0.3 }
// Wrist: an ellipse in life (~60mm across, ~40 deep). A capsule can only be
// round, so take the smaller figure -- a 66mm-diameter tube (what this was)
// reads as a forearm starting at the palm.
export const WRIST_MM = { dia: 50, len: 30, pos: [0, -72, 2] }
// Forearm STUB, and the emphasis matters. Its only job is so the hand does not
// read as a severed palm; nothing in the rig, the FK or any lesson depends on its
// length. At 177mm it was most of a real forearm (~260mm), which at rig scale is
// 1.76 long by 0.71 across -- WIDER THAN A CARD (0.63) and nearly three card
// widths long. `fadeAlongViewAxis` already drops it to its floor opacity of 0.14
// at almost every camera in the catalog (measured: wash, overhand and charlier all
// pin at 0.14), so this was never an opacity problem: a pale band that big sweeps
// across the frame whatever its alpha, and it was the most intrusive thing left in
// shot after the hands themselves.
//
// 58mm, trimmed again from 95mm. Be clear about what this did and did not fix: the two
// large pale slabs that dominate the top corners of the overhand's frame are the PALMS,
// not the forearms. A palm is 80 x 106mm, so it is card-sized by construction, and at a
// camera looking slightly down on two hands whose fingers reach DOWN around their
// packets the palms are broadside and above everything else in shot. That is correct
// anatomy, not an artefact - going 95 -> 58mm was measured against a capture and barely
// changed those corners.
//
// The trim is still right on its own terms: 58mm is a wrist cuff rather than an arm, it
// still hides the wrist joint, which is the entire reason the stub exists, and it stops
// contributing screen area at cameras that see it flat-on and so never fade it.
// Diameter stays at the anatomical 72mm - the stub is short, not thin, so it still
// connects to a hand of the right size.
export const FOREARM_MM = { dia: 72, len: 58, pos: [0, -112, 4] }

// Opposable thumb: swing the metacarpal across + forward so its curl presses
// toward the fingers, a real pinch/grip rather than a spike. The rig applies
// this as a partial Euler over the build-time splay yaw, so the thumb group's
// full rotation is Euler(x, y:splay, z, 'XYZ').
export const THUMB_BASE_ROT = { z: 1.2, x: -0.55 }

// Curl limits per joint (radians about local X). Slight hyperextension is
// allowed (real fingers bend back a touch); flexion tops out below a full fist
// so IK solutions can't fold a phalange through the palm.
export const JOINT_LIMITS = { min: -0.25, max: 1.65 }

// The pivot of joint i sits at the END of the previous phalange (0 for the
// proximal joint, which pivots at the knuckle itself).
export function jointPivotY(spec, i) {
  return i === 0 ? 0 : spec.len[i - 1]
}
