# Architecture

How the engine is put together, the rules that keep it deterministic, and the
non-obvious invariants worth knowing before changing anything.

## The core rule: two kinds of state

Discrete or slow-changing state, mode, deck order, active lesson, camera preset,
playback step and speed, lives in a **zustand** store.

Per-frame state, each card's position, rotation and bend; each hand's joint
angles, is written **imperatively through refs**, via `cardRegistry` and
`handRegistry`.

`setState` is never called inside `useFrame`. The player mirrors its time cursor
back into the store at roughly 12 Hz, and that is the only bridge between the two
worlds. Breaking this rule reintroduces a React render per frame and the frame
budget disappears.

Drivers (`VisualizerDriver`, `LessonRunner`) each own exactly one `useFrame`, and
`SceneController` picks the active driver from `store.mode`.

## Lessons are pure functions of time

```
lesson definition (src/lessons/catalog/*.lesson.js)
   │
   ▼  compileLesson.js, runs ONCE
deterministic Track { cards: [segments], hands: { left: [segs], right: [segs] } }
   │
   ▼  sampleTrack.js, pure (Track, ms) → { cards: Map, hands, annotations }
   │
   ▼  LessonRunner useFrame
cardRegistry / handRegistry handles → mesh transforms + rig joint angles
```

Because sampling is pure and the track is immutable, scrubbing backward and
forward reaches identical frames. Nothing is simulated incrementally, so there is
no drift and no need to replay from zero.

Randomness is seeded (`seededRng.js`, mulberry32) so a given lesson compiles to
the same track every time.

## Hands

A **pose** is `{ wrist: { pos, quat }, fingers: { thumb…pinky: [prox, mid, dist] }, spread }`,
with optional `splay` (per finger) and `thumbOpp` (animatable opposition). Finger
angles are local X-rotations per joint; each joint pivots at its own phalange's
base, not at the knuckle.

`handRigSpec.js` is the single source of truth for rig numbers (`FINGERS`,
`HAND_SCALE`, `THUMB_BASE_ROT`, `JOINT_LIMITS`, and the palm/thenar/wrist/forearm
masses). Both `handRig.js` and the kinematics module import it, and
`fkParity.test.mjs` asserts the two stay in agreement.

**It is written in millimetres.** A card is the only object on screen with a
known real size, so it is the ruler: `CARD_W` 0.63 world units is a 63.5mm card,
hence 1 wu ≈ 100.8mm. Anything added there should be a millimetre measurement
with a source, not a rig-unit literal that looked right in one lesson — that is
how the rig drifted to fingers 1.4x too thick with spherical fingertips on a palm
domed the wrong way (convex), which is what made two translucent hands read as a
cluster of sausages. Correcting it also halved measured penetration across the
flagships, because the contact metric charges a whole capsule radius (below).

One deliberate exception, documented at the call site: the **thumb's 75mm reach**
is held at its tuned value rather than its anatomical 102mm. Reach is coupled to
every authored thumb anchor and to the IK's opposition search — at 102mm the
thumb overshoots every grip it was authored against — whereas thickness is not.

`handKinematics.js` is pure forward kinematics plus analytic IK, a two-link
finger solve with 0.75 distal coupling, and a thumb solve with an opposition
search. It is headless-safe, which is what makes the verification harness
possible.

**Mirror policy:** points may be mirrored for the left hand, but orientations are
only ever composed as `wrist.quat ∘ f(angles)`, never decomposed under negative
scale, which does not round-trip.

### Contact frames: why fingers move cards

Held cards ride a **contact frame** derived from live fingertip positions rather
than being welded to the wrist:

| Frame | Anchor |
|---|---|
| `pinch` | thumb + index midpoint |
| `packet` | thumb / index / middle centroid |
| `thumbPeel` | thumb-dominant |
| `indexPivot` | index tip (`pitchGain −2.2`) |

A grip is declared as
`grip: { side: { cards, frame, pressure: [{at, v}], bendGain, release } }`.
`pressure` tightens the gripping fingers and, scaled by `bendGain`, bows the held
packet. `release: 'stagger'` makes each card leave the hand exactly when its own
travel segment begins.

`bakeHoldReleases` projects every held card through `frame(t_release) ∘ offset`
and overwrites the next segment's `from`. Handoffs are therefore seamless *by
construction* in both scrub directions, the riffle's worst boundary jump is
0.0029, down from 0.03 before baking.

## Cards

One shared `PlaneGeometry(W, H, 1, 24)`, segmented so the bend shader has
vertices to work with. Faces are generated at runtime into canvas textures
(`textureFactory.js`); there are no card-front image assets. Bend is injected via
`onBeforeCompile` with a `uBend` uniform. Face-down is a mesh Y-rotation of π
against a two-sided material.

## Verification

`npm run verify` runs headless (no browser, no WebGL) over the compiled tracks:

- **`fkParity.test.mjs`**, forward kinematics matches the rig.
- **`verifyTracks.mjs`**, determinism, scrub reversibility, deck integrity
  (52 unique cards in, 52 out), boundary continuity, and the two contact metrics.

Both tables were **re-baselined once**, when the rig geometry was corrected: they
had been calibrated against fingers 1.4x too thick, which inflated every
penetration reading and left a margin that silently absorbed the idle overlay.
The "only ever down" rule holds from that new baseline. See the header comment in
`verifyTracks.mjs` for the before/after of every entry.

The contact metrics are **ratchets**, and they oppose each other:

- `CONTACT_FLOOR`, percentage of fingertips genuinely touching cards. Only goes
  **up**. A lesson measuring 0% is recorded as *broken*, not passing.
- `PENETRATION_BUDGET`, deepest finger intrusion into a card surface. Only goes
  **down**.

Having both means a lesson cannot satisfy the penetration check by simply
hovering above the deck, which is the failure mode the floor exists to catch.

## Invariants and traps

These each cost real debugging time. They are easy to reintroduce.

**Card materials need a unique `customProgramCacheKey`** (`card-bend-${key}`). A
shared or constant key makes three.js compile the bend shader once and reuse it,
so only one card gets its `uBend` uniform wired and every other card stays flat.

**`splitIntoRandomBlocks`: the last block must consume all remaining cards**
(`remainingBlocks === 1 ⇒ blockSize = remainingCards`), or cards are silently
dropped from the deck.

**`sampleTrack` reuses cached `Vector3`s per card id.** Any check comparing two
samples must `.pos.clone()` the first, or it reads zero. A no-snap assertion
passed trivially for a while because of this.

**Never hold a grip across a large hand-orientation change.** The packet rides
the frame's quaternion, so a 90° wrist turn tips the deck over mid-carry. Move
the hand into its new orientation first, *then* declare the grip, this is
exactly why the riffle bridge is split into a cage step and a bow step.

**Converging palms need ≥ 0.5 x-separation**, or translucent hands interpenetrate
and read as one melted shape.

**Cards released during a weave must stay low** (`arcLift ≤ 0.05`). The default
riffle values (`arcLift 0.55`, `midBend 3.1`) read as a card fountain.

**Bowed cards can rest on their end points**, which a naive felt-contact
assertion does not catch, it tests the card's origin, not its bent extent.

## Open work

**Penetration is measured per card rather than against the deck envelope.** A pad
pressed 0.02 into the top card of a 52-card stack is inside the deck's silhouette
and invisible, but the metric charges a full capsule radius the moment a pad
centre enters a card's slab. Real contact necessarily grazes; flesh compresses,
capsules do not.

Correcting the rig to anatomy took most of the sting out of this — the radius it
charges fell ~30%, and with it every raised budget (riffle 0.046 → 0.025, faro
0.060 → 0.030, charlier 0.038 → 0.020). What is left is the residual grazing that
now shows up in `hindu` (0.008) and `strip` (0.006): with pads seated genuinely
tangent instead of standing off an over-fat capsule, the idle overlay walks them
a few tenths of a millimetre into the cards. Measuring against the union envelope
of the cards a hand is touching is still the right fix and would let those two
ratchet down too.

**The two contact metrics can disagree, and the median is the honest one.**
`CONTACT_FLOOR` is a threshold count against a hard 0.025 band, so a bimodal gap
distribution can shift *toward* the cards while the count falls. That is exactly
what `strip` did on the corrected rig: median gap 0.125 → 0.082, count 36% → 27%.
Always read the printed median beside the percentage.

**Overhand still ships a hover** (4% contact, median gap 0.241). Its diagnosis is
unchanged and recorded in full in `verifyTracks.mjs`.

**Interpolating a held hand through its contact frame is done** (see below), and
it did *not* move the penetration numbers — the deviation it removes is real and
large, but it was never what the ratchets were measuring.

### Task-space interpolation of held fingers

A grip's keyframes are solved, so at every rung a gripping pad sits on the cards.
Between rungs the compiler lerps **joint angles**, so each pad swings along an arc
while the contact frame the packet rides is a weighted **mean** of those pads — and
a mean of arcs is not the arc of the mean. Measured, that pad slide reached
**30mm, half a card width** (riffle and faro thumbs), which is the "fingers
skating around on the cards" look.

`reseatGrippingTips` (handKinematics) fixes it by interpolating the fingertips in
wrist-local **task space** and re-solving each finger's curl onto the lerped
point. `sampleTrack` and the compiler's `holdFrameAt` both pass the grip's frame
type so capture and render use one path. Residual after: 0mm on four lessons,
7–9mm on the riffle/faro thumbs (out-of-plane, which curls cannot reach).

The reachability guard is load-bearing, not defensive: where a chord target is
outside a finger's reach, `solveFingerTo` pins its joints and the tip lands
nowhere near it — unguarded, this made the overhand's pinky deviation *five times
worse* (17mm → 83mm). Below `RESEAT_TOL` the reseat is accepted, above it the
joint lerp stands.

## Module map

```
src/
  deckModel.js               createDeck() → 52 { id, suit, rank, isFaceUp }
  lib/
    constants.js             CARD_W/H/T, COLORS, CAMERA_PRESETS, ORBIT
    ease.js                  named easings; easeOutBackSoft, anticipate, settle, snapEase
    shuffleMath.js           pure: alternateMerge, riffleOrder, splitIntoRandomBlocks
  state/useAppStore.js       zustand: mode, deck, activeLessonId, camera, settings
  scene/                     CanvasRoot, Stage, FeltTable, LightingRig,
                             CameraController, SceneController
  card/
    cardGeometry.js          shared segmented plane
    textureFactory.js        buildFaceTextures(cards) → Map<id, CanvasTexture>
    cardMaterial.js          createCardMaterial + setMaterialBend
    Card.jsx / CardField.jsx / cardRegistry.js
  hands/
    handRigSpec.js           rig source of truth
    handRig.js               palm + 5 fingers × 3 capsule joints; applyHandPose
    handKinematics.js        pure FK, finger/thumb IK, contact frames, grip pressure
    handPoses.js             named presets; getHandPose(name, side); lerpHandPose
    handMotion.js            idle breathing + per-keyframe finger motion
    Hand.jsx / handRegistry.js
  lessons/
    engine/                  seededRng, layouts, compileLesson, sampleTrack,
                             player, LessonRunner
    authoring/contacts.js    poseWithContacts, tableGrip, cageGrip,
                             thumbRatchetKeyframes
    catalog/*.lesson.js      per-lesson definitions + index
    annotations/             drei <Html> callouts
  visualizer/                free-play fan / flip / layout driver
  ui/                        UIChrome, VisualizerControls, LessonCatalog,
                             TransportBar, chrome.css
scripts/
  capture-og.mjs             OpenGraph card capture
  verify/                    fkParity.test.mjs, verifyTracks.mjs, loader, register
```

## Tuning

| What | Where |
|---|---|
| Table/cage grip geometry | `tableGrip` / `cageGrip` targets in `authoring/contacts.js` |
| Riffle pacing and gaps | `G` / `YAW` / `TILT` in `riffle.lesson.js` |
| Charlier deck height, pinch | `DX/DY/DZ`, `PINCH_ANCHOR` in `charlier.lesson.js` |
| Charlier swing size | `indexPivot.pitchGain` in `handKinematics.js` |
| Idle motion amount | `IDLE_*` in `handMotion.js` |
| Pressure curl depth | `PRESSURE_CURL` in `handKinematics.js` |
| Straddle/edge grip placement | sweep it with `scripts/inspect/gripProbe.mjs`, never by hand |

## Edge grips vs face grips

Every grip built before `straddleGrip` presses pads onto a card's broad **face**.
Real card grips clamp the deck's **perimeter** with the hand behind it. That one
difference is the root cause of the hover, the finger splay and the occlusion the
x-ray shader exists to work around — see `TECHNIQUE_REFERENCE.md`, which carries
the measurements, the reference footage and the per-lesson diff.

Two things there are load-bearing for anyone touching this:

- **A straddle has only two fingertip contacts** (thumb on a long edge, index over
  the short end); the palm carries the bottom and the other three fingers touch
  *laterally*. The `straddle` frame therefore scores two pads, not five. Aiming
  the other three tips at the edge is unreachable on this rig by 0.18–0.65.
- **Grip placement is squeeze-dependent.** The anchor is derived from the thumb
  target and `squeezeAir` moves that target, so a placement swept at one squeeze
  can bury the thumb at another (measured: 0.0000 → 0.1206). Sweep per station.
