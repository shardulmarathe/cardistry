# Architecture

How the engine is put together, the rules that keep it deterministic, and the
non-obvious invariants worth knowing before changing anything.

## What Learn currently is

**Four techniques, chosen to be severely different from one another** so that
effort goes into making each convincing rather than into variations nobody can
tell apart: `wash`, `overhand`, `charlier`, `riffle`. Difficulty tiers are gone.
Four earlier lessons (`hindu`, `strip`, `waterfall`, `faro`) were deleted outright,
along with `pileShuffle`, `pressureFan` and `springPrimer`; anything in this file
or in comments that still names them is stale and should be removed on sight.

**Nothing plays without a click.** Opening a technique loads its track PAUSED at
frame 0 behind a "Play demo" button, and the catalog shows a STILL POSTER FRAME
(`scrubTo` to 45% of the track, paused) rather than a looping preview. Both are
load-bearing UX decisions, and both have regression guards in
`scripts/inspect/stressTest.mjs` — a catalog that animates while you browse is the
specific bug those guards exist to catch. The poster is taken at 45% and not 0
because every lesson starts on the same squared deck, so at frame 0 all four
posters are identical.

Where each lesson stands, from `npm run verify`:

| Lesson | Duration | Contact | Median gap | Worst penetration |
|---|---|---|---|---|
| `wash` | 21.7s | n/a — nothing is gripped | — | 0.0000 |
| `overhand` | 16.5s | 8% — still a hover, see below | 0.156 | 0.0079 |
| `charlier` | 10.9s | 74% | 0.013 | 0.0162 |
| `riffle` | 7.7s | 37% — a release cannot score, see below | 0.044 | 0.0142 |

The riffle is a TABLE riffle: two halves flat on the felt, thumbs bending the
inner ends up, cards ratcheting free one at a time. It replaced an in-hands
version that measured better (90% contact) but looked wrong — mid-air, no visible
bend, and the two hands overlapping in the middle of frame. Measured better is not
the same as correct.

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
| `indexPivot` | index tip (`pitchGain −2.2`), and the index ALONE |

`indexPivot` used to list `middle: 0.4` among its holders. Measured through the
charlier's pivot, that fingertip sits 0.88–0.94 from the packet the whole way —
it is cradling the *other* half — and since `pressure` is the honest set of holders
for both contact metrics, a finger a world unit away was scored as a gripper on
every frame of the beat.

A grip is declared as
`grip: { side: { cards, frame, pressure: [{at, v}], bendGain, release } }`.
`pressure` tightens the gripping fingers and, scaled by `bendGain`, bows the held
packet. `release: 'stagger'` makes each card leave the hand exactly when its own
travel segment begins.

`bakeHoldReleases` projects every held card through `frame(t_release) ∘ offset`
and overwrites the next segment's `from`. Handoffs are therefore seamless *by
construction* in both scrub directions; the riffle's worst boundary jump is 0.0061
across 117 boundaries.

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

### The metrics, and where each one lies to you

Three numbers are printed per lesson. None of them is trustworthy alone, and each
has a documented blind spot that cost real debugging time.

- **`PENETRATION_BUDGET`** — deepest finger intrusion. Only ratchets **down**.
- **`CONTACT_FLOOR`** — percentage of gripping fingertips within 0.025 of a card.
  Ratchets **up**, except where noted below. A lesson measuring 0% is recorded as
  *broken*, not passing.
- **The median gap**, printed beside the percentage. Read it. `CONTACT_FLOOR` is a
  threshold count, so a bimodal gap distribution can shift *toward* the cards while
  the count falls.

Having both ratchets means a lesson cannot satisfy the penetration check by
hovering above the deck, which is the failure mode the floor exists to catch — the
shipping overhand is exactly that shape: a clean 0.0079 bought with 8% contact and
its pads a full card-length off the cards.

**`cardDepth` SATURATES, and this is the most expensive thing in this file.** It
returns a true *overlap* depth, so once a capsule centre reaches a card its reading
pins at `radius + CARD_T/2` and stays there however much deeper into the STACK the
capsule goes. The ceilings:

| Capsule | Pinned reading |
|---|---|
| index / ring proximal | 0.1007 |
| thumb middle, middle proximal | 0.1057 |
| index / ring middle | 0.0908 |
| any distal | 0.0759 |

Six consecutive fixes to the overhand rebuild each reported ~0.10 and the number
never moved, which read as "nothing I change matters". It was a pinned gauge. If you
see one of those values and it will not budge, stop tuning and use **cards pierced**
(`scripts/inspect/tryLesson.mjs`) — the count of cards containing a capsule centre,
which is monotone and unbounded. Every shipping lesson pierces 0.

**Two grips cannot be scored by fingertip contact at all**, and both are correct
poses rather than broken ones:

- A **welded packet on a moving finger** (`indexPivot`, the charlier's pivot). `SEAT`
  is deliberately measured at the deepest curl the cut uses, because the packet is
  welded at one height for the whole ride and must fit the worst curl or the finger
  grows into it mid-sweep. So it rides ~0.142 clear of the whole finger by design and
  that beat scores 0%, tip or whole-finger.
- A **hand that is releasing** (the riffle's weave). A pad is ~0.074 across and the
  band is 0.025, so opening a digit by even 12% of its solved curl puts it outside.
  Measured three ways, the weave scores 0–7% while the beats either side hold at
  56% and 52%.

`CONTACT_FLOOR` for the riffle has therefore been relaxed twice — 0.87 → 0.50 → 0.30
— and that is recorded rather than blessed. The floor now understates two of four
lessons, which means it is drifting toward not being a useful alarm. The honest fixes
are to exclude release windows from the floor, and to score the nearest point on the
whole finger for frames whose cards ride a curled phalange rather than a pad;
`tryLesson` already reports whole-finger contact alongside the fingertip number so
the two can be compared before changing what the ratchets mean.

**The wash cannot be judged by these metrics at all.** Nothing in it is gripped, so
it reports "0% of 0" and a penetration of 0.0000 whether the hands are raking the
cards or waving beside them — it passed vacuously for a long time. Use
`scripts/inspect/washRake.mjs`, which measures pad reach against card spread and each
card's PATH LENGTH over the smoosh window.

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
the hand into its new orientation first, *then* declare the grip. The charlier
still relies on this: its grip starts only AFTER the palm-up wrist turn.

**Converging palms need ≥ 0.5 x-separation**, or translucent hands interpenetrate
and read as one melted shape.

**Cards released during a weave must stay low** (`arcLift ≤ 0.05`). The engine's
default riffle values (`arcLift 0.55`, `midBend 3.1`) read as a card fountain; the
table riffle uses `arcLift 0.04` with `midBend 0.35`, the latter being what is left
of the spring straightening out.

**A hand must rise faster than the deck it is pouring into grows.** The merged
stack builds to 52·`CARD_GAP` = 0.156 exactly where the pouring fingers are. Rising
only 0.088 let it come up INTO them: penetration climbed steadily across the beat,
0.0172 to 0.0441, the same capsule every time.

**A bend is only expressible along a card's own long axis.** The shader maps local
`(x,y,0) → (x, sin(yb)/b, (1−cos(yb))/b)`, so `x` is untouched and the cylinder axis
is local X — a card can only arch between its two SHORT ENDS. That one fact decides
a whole lesson: it is why the table riffle grips `axis: 'end'` rather than the
`long` axis everything else uses.

**`framing.mjs`'s "AIM OFF" line is usually a false alarm.** It scores every preset a
lesson uses against one whole-lesson "want", and most lessons finish on `overview`
aiming at the felt (y 0.15) while their action happens much higher. The number you
get is just `want − 0.15`. `OVERFLOWS` is the line that matters, and it is real: it
compares the subject's extent against what each preset can see at the subject's own
distance, reserving the bottom 40% of frame for the transport panel.

**`sampleTrack` hands back REUSED card objects.** Keeping a reference to a previous
sample gives you the current pose, so any probe comparing two instants must snapshot
plain numbers. This has now produced false readings twice — including one that
reported all 52 wash cards frozen at exactly 0.000, which looked like a dead lesson
and was a dead probe.

**Bowed cards can rest on their end points**, which a naive felt-contact
assertion does not catch, it tests the card's origin, not its bent extent.

## Open work

Ordered by how much evidence is behind them, not by how easy they are.

**A palm-up CRADLE grip does not exist, and the overhand needs it.**
`overhandNew.lesson.js` is a re-model of the move real shufflers make — bulk lifted
from below, packets dropped onto a pile — and it measures 81% contact against the
shipping version's 8%. It is deliberately **unwired**, because it pierces 1 card.
Nine escape routes were measured and every one is recorded in that file's header;
the load-bearing one is that with the receiving hand's fingers COMPLETELY straight
the pierce is unchanged, which proves it is the wrist's placement and not any curl.
An edge pinch WRAPS the pile, so its fingers occupy the space a packet must pass
through to reach it. The plan's own wording was always "a pile the receiving hand
CRADLES"; the rebuild reached for a pinch because the pinch was the vocabulary that
existed. Every `GRIP_FRAME_TYPES` entry is fingertip-weighted, so a cradle needs a
palm-referenced frame — a new *kind* of entry, plus a builder.

**A three-face grip: thumb on one END plus both LONG edges.** Requested directly, as
"the thumb peels up and the fingers grab the deck from the front and back". It is not
expressible: a pinch is thumb opposing fingers on two faces. Measuring also found a
hard limit — an `end` pinch spans only 0.76 between thumb and middle pads while a
landscape half is `CARD_H` = 0.88 long, so it cannot reach both ends. That same limit
is why the riffle has no whole-deck grip. It would fix the thumb-peel and the
charlier's crest problem at once.

**`indexPivot` should ride the finger's CREST, not its tip.** That would keep the
charlier's packet in contact through the whole sweep and need no `SEAT` clearance at
all — which is also the 14mm of visible air that makes the packet look detached. The
open question is the direction convention: "crest" means "highest point" only for a
palm-up cradle, and `contactFrame` runs per frame.

**Penetration is measured per card rather than against the deck envelope.** A pad
pressed 0.02 into the top card of a 52-card stack is inside the deck's silhouette and
invisible, but the metric charges a full capsule radius the moment a pad centre enters
a card's slab. Real contact necessarily grazes; flesh compresses, capsules do not.
Correcting the rig to anatomy took most of the sting out (the radius it charges fell
~30%), but measuring against the union envelope of the cards a hand is touching is
still the right fix.

**The wash's two smoosh passes largely cancel.** `smoosh-2` counter-rotates
`smoosh-1`, so cards orbit out and come back; net travel across the pair is under 0.05
by design. Randomisation comes from the initial scatter and the gather rather than the
swirls. Not a defect, but worth knowing before "improving" the mixing.

**Overhand still ships a hover** (8% contact, median gap 0.156), and it is the worst
thing in the app to look at: at the peel beat the drawing hand is cropped out of frame
and the peeled cards float unsupported. Its replacement is the first item above.

### Task-space interpolation of held fingers

A grip's keyframes are solved, so at every rung a gripping pad sits on the cards.
Between rungs the compiler lerps **joint angles**, so each pad swings along an arc
while the contact frame the packet rides is a weighted **mean** of those pads — and
a mean of arcs is not the arc of the mean. Measured, that pad slide reached
**30mm, half a card width** (measured on the riffle's thumbs, and on `faro`'s before
that lesson was deleted), which is the "fingers skating around on the cards" look.

`reseatGrippingTips` (handKinematics) fixes it by interpolating the fingertips in
wrist-local **task space** and re-solving each finger's curl onto the lerped
point. `sampleTrack` and the compiler's `holdFrameAt` both pass the grip's frame
type so capture and render use one path. Residual after: 0mm on most lessons, 7–9mm on
riffle thumbs (out-of-plane, which curls cannot reach).

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
    authoring/contacts.js    poseWithContacts, resolvePenetration,
                             wristAnchorForContact, rigMetrics;
                             grips: tableGrip, packetGrip, cageGrip, straddleGrip,
                             edgePinchGrip(+Auto), rotateGripRigid;
                             thumbRatchetKeyframes (staged release)
    catalog/*.lesson.js      per-lesson definitions + index
    annotations/             drei <Html> callouts
  visualizer/                free-play fan / flip / layout driver
  ui/                        UIChrome, VisualizerControls, LessonCatalog,
                             TransportBar, chrome.css
  devBridge.js               window.__cardistry for headless drivers (dev only)
scripts/
  capture-og.mjs             OpenGraph card capture
  verify/                    fkParity.test.mjs, verifyTracks.mjs, loader, register
  inspect/                   headless diagnostics, none of them shipped:
    tryLesson.mjs              per-beat penetration, CARDS PIERCED, per-beat contact
                               (fingertip AND whole-finger), median gaps
    deepFrame.mjs              every capsule of every finger at one timestamp, and
                               which card it is in — this is what names a cause
    framing.mjs                does each lesson fit its camera? flags OVERFLOWS
    captureFrames.mjs          per-beat PNGs through a real browser
    stressTest.mjs             the interactive layer: paused-on-open, the still
                               catalog poster, mid-shuffle switching, transport
                               spam, deck integrity, responsive down to 390px
    washRake.mjs               the wash only: pad reach vs spread, per-card path
    gripProbe.mjs              sweep a grip's placement; never place one by hand
    mirrorCheck.mjs            left/right parity
    refFrames.mjs              reference footage frames (scratchpad only, never
                               committed — sidesteps licensing entirely)
```

`scripts/inspect/*` needs a dev server on :5173 for anything that drives a browser
(`captureFrames`, `stressTest`, `framing`). The rest are pure and headless.

## Tuning

| What | Where |
|---|---|
| Edge-grip geometry | `edgePinchGrip` in `authoring/contacts.js`; its `yaw` sets the wrist's approach azimuth |
| Riffle staging | `GAP` / `YAW` / `BEND` / `END_FLIP` in `riffle.lesson.js` |
| Riffle release feel | the `thumbRatchetKeyframes` call in `riffle.lesson.js` (`steps`, `jitter`, `openFingers`) |
| Wash spread and rake | `SPREAD_X` / `ROW_Z` / `AMP` in `wash.lesson.js` — `PLOW_FROM` derives from `SPREAD_X` and must keep doing so, or the gather ploughs through the spread |
| Charlier swing size | `indexPivot.pitchGain` in `handKinematics.js` |
| Idle motion amount | `IDLE_*` in `handMotion.js` |
| Pressure curl depth | `PRESSURE_CURL` in `handKinematics.js` — moves a pad ~0.05 at full squeeze, twice the 0.025 contact band |
| Camera framing | `CAMERA_PRESETS` in `lib/constants.js`; check with `scripts/inspect/framing.mjs`, which reserves the bottom 40% of frame for the transport panel |
| Any grip placement | sweep it with `scripts/inspect/gripProbe.mjs`, never by hand |

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
