# Architecture

How the engine is put together, the rules that keep it deterministic, and the
non-obvious invariants worth knowing before changing anything.

## The core rule: two kinds of state

Discrete or slow-changing state — mode, deck order, active lesson, camera preset,
playback step and speed — lives in a **zustand** store.

Per-frame state — each card's position, rotation and bend; each hand's joint
angles — is written **imperatively through refs**, via `cardRegistry` and
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
   ▼  compileLesson.js — runs ONCE
deterministic Track { cards: [segments], hands: { left: [segs], right: [segs] } }
   │
   ▼  sampleTrack.js — pure (Track, ms) → { cards: Map, hands, annotations }
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
`HAND_SCALE`, `THUMB_BASE_ROT`, `JOINT_LIMITS`). Both `handRig.js` and the
kinematics module import it, and `fkParity.test.mjs` asserts the two stay in
agreement.

`handKinematics.js` is pure forward kinematics plus analytic IK — a two-link
finger solve with 0.75 distal coupling, and a thumb solve with an opposition
search. It is headless-safe, which is what makes the verification harness
possible.

**Mirror policy:** points may be mirrored for the left hand, but orientations are
only ever composed as `wrist.quat ∘ f(angles)` — never decomposed under negative
scale, which does not round-trip.

### Contact frames — why fingers move cards

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
construction* in both scrub directions — the riffle's worst boundary jump is
0.0029, down from 0.03 before baking.

## Cards

One shared `PlaneGeometry(W, H, 1, 24)` — segmented so the bend shader has
vertices to work with. Faces are generated at runtime into canvas textures
(`textureFactory.js`); there are no card-front image assets. Bend is injected via
`onBeforeCompile` with a `uBend` uniform. Face-down is a mesh Y-rotation of π
against a two-sided material.

## Verification

`npm run verify` runs headless (no browser, no WebGL) over the compiled tracks:

- **`fkParity.test.mjs`** — forward kinematics matches the rig.
- **`verifyTracks.mjs`** — determinism, scrub reversibility, deck integrity
  (52 unique cards in, 52 out), boundary continuity, and the two contact metrics.

The contact metrics are **ratchets**, and they oppose each other:

- `CONTACT_FLOOR` — percentage of fingertips genuinely touching cards. Only goes
  **up**. A lesson measuring 0% is recorded as *broken*, not passing.
- `PENETRATION_BUDGET` — deepest finger intrusion into a card surface. Only goes
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
the hand into its new orientation first, *then* declare the grip — this is
exactly why the riffle bridge is split into a cage step and a bow step.

**Converging palms need ≥ 0.5 x-separation**, or translucent hands interpenetrate
and read as one melted shape.

**Cards released during a weave must stay low** (`arcLift ≤ 0.05`). The default
riffle values (`arcLift 0.55`, `midBend 3.1`) read as a card fountain.

**Bowed cards can rest on their end points**, which a naive felt-contact
assertion does not catch — it tests the card's origin, not its bent extent.

## Open work

**Penetration is measured per card rather than against the deck envelope.** A pad
pressed 0.02 into the top card of a 52-card stack is inside the deck's silhouette
and invisible, but the metric charges a full capsule radius (0.104 at
`HAND_SCALE` 11) the moment a pad centre enters a card's 0.006-thick slab. Real
contact necessarily grazes — flesh compresses, capsules do not.

Consequences today: three lessons carry raised penetration budgets (riffle 0.046,
faro 0.060, charlier 0.038), and overhand ships a hover (2% contact) because its
gripping version measures 0.084.

Measuring against the union envelope of the cards a hand is touching should let
all three budgets ratchet back down and unblock overhand at once. The alternative
lever is interpolating a held hand through its contact frame rather than through
raw joint angles — the residual there comes from the compiler lerping joint
angles between keyframes while the frame the packet rides is their mean, so pads
deviate mid-segment.

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
