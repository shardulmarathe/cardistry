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

**Two states, and nothing else.** The landing state is the shared deck squared in
the middle of the felt with a hand either side of it, and four buttons. Picking a
technique starts it. The running state is the steps as a clickable scroll rail
along the bottom, a scrubber, and the mixing readout docked right.

This replaced a two-column catalog with a technique rail, a detail pane, a
"Mixing & grips" reference sheet, a debounced poster-frame compile per hover and a
"Start lesson" button behind all of it — four things to read and three clicks
before a card moved. `ui/LessonCatalog.jsx`, `ui/TransportBar.jsx`,
`ui/OrderStrip.jsx`, `ui/LessonInstructions.jsx` and `ui/orderStrip.css` are gone;
`RANDOMNESS_GUIDE` and `GRIP_GLOSSARY` went with the sheet. Anything that still
names them, or a "Play demo" button, or a catalog poster frame, is stale.

**One deck across both tabs.** Card order and each card's `isFaceUp` are the only
things that cross the tab boundary; the visualizer's ARRANGEMENT deliberately does
not follow, because Learn always squares the deck in the middle, which is where
every technique starts. "Show faces" writes the real per-card flag rather than a
render-time override, so the choice survives the tab switch, and `LessonRunner`
turns a card over at render time by post-multiplying a half-turn about its own long
axis — every lesson is COMPILED FACE-DOWN, so the flip cannot be authored into a
track.

**A face-down card has two legal orientations and they differ by a half-turn.**
The visualizer composes its face-down pose as `faceQuat(true)` turned about the
card's long axis (so its flip animation reads as laying a card over); every lesson
layout uses `faceQuat(false)` directly. Those differ by exactly 180° about the
card's normal, so the BACK TEXTURE HAS TO BE 180°-SYMMETRIC or the same deck reads
differently in the two tabs — which it did, because the monogram's gradient ran
light-top to dark-bottom. See the note over `drawBack` in `card/textureFactory.js`.

Where each lesson stands, from `npm run verify`:

| Lesson | Duration | Contact | Median gap | Worst penetration | Pierced |
|---|---|---|---|---|---|
| `wash` | 21.7s | n/a — nothing is gripped | — | 0.0000 | 0 |
| `overhand` | 8.6s | 100% of 300 | 0.014 | 0.0001 | 0 |
| `charlier` | 12.6s | 81% of 371 | 0.012 | 0.0037 | 0 |
| `riffle` | 10.1s | 90% of 418 | 0.008 | 0.0025 | 0 |

Read that table beside the `scored on [...]` list `verify` prints for each lesson.
Two of these lessons legitimately changed WHICH surfaces they score, and the
percentage alone cannot tell a real gain from a narrowed set — see `CONTACT_FLOOR`
in `verifyTracks.mjs`, where the evidence for each is recorded.

Where these came from, since three of the four were rebuilt:

- **`overhand` is a strip to the side.** The right hand takes a random 6–20 card
  packet off the top of the deck and stacks it on a pile beside it, all on the
  felt. Two earlier stagings are recorded in the file and neither should come back:
  a top PEEL (8% contact, a quarter of a card width of air under the fingers
  supposedly moving the cards) and a lift-the-bulk-and-drop (100% contact, but the
  deck left the table whole in the first two seconds and the move it is named for
  was never seen against a deck). Top-card swaps 221 → 0, penetration 0.0034 →
  0.0001, unmotivated motion 5% → 1%, 12.6s → 8.6s. AN EDGE PINCH CANNOT GRIP A
  SUB-STACK — the wrapping finger enters the deck underneath, 0.0957 deep, and
  straightening the un-aimed fingers to zero does not move it — so it uses a face
  grip, whose builder already resolves against a solid column for this exact case.

- **`charlier` is one-handed.** The hand picks the deck up, TURNS IT OVER, cuts it,
  and rolls it back face-down. That is not a flourish: lifting a deck off felt is
  only possible from above and cutting it is only possible from below, and the
  pickup grip and the cutting cradle are exactly 180° apart about world z — so the
  flip IS the transition. The second hand that used to hold the top half is gone
  because that half now travels on its own beat, sliding down carriers that are
  already extended under it; done during the pivot instead, the sweep and the
  slide met (0.0522 of ring finger through a card). Card-vs-card clipping 0.0304 →
  0, inert contact 19% → 8%, unmotivated 16% → 10%.

- **`riffle` has its second half.** After the weave the pack is cupped at both
  ends, bowed into a bridge and released to fold down square. The hands do NOT
  squeeze inward (the arch is the CARDS, and inward is the axis this lesson's
  thumb-clearance budget lives on — closing 0.05 drove the thumb tips 0.7 card
  thicknesses into each other), the fold is NOT staggered (52 cards 0.003 apart
  travelling different distances pass through each other wholesale: 1766 clipping
  pair-frames), and the bridge declares NO grip (a `tableTop` hold is solved
  against a flat pack; welded to a bowed one every scored pad leaves the surface).
  Inert contact 3% → 1%, unmotivated 33% → 30%.

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
`grip: { side: { cards, frame, pressure: [{at, v}], bendGain, release, contacts } }`.

**`GRIP_FRAME_TYPES` used to conflate three different things in one `pressure` map,
and separating them is what unblocked three lessons at once.** `pressure` was the
visible squeeze AND (via `grippingFingers`) the set `reseatGrippingTips` interpolates
AND (in `verifyTracks.measureContact`) the set the contact metric scores. So a grip
could not say "these fingers tighten but are not the things touching the cards", and a
palm-up cradle — whose cards rest on the PALM with no fingertip owning them — was
inexpressible. The three roles are now:

| Role | Field | Means |
|---|---|---|
| carry anchor | `tips` / `anchor` | where the cards ride |
| visible squeeze | `pressure` | which fingers tighten, and how hard |
| scored + reseated | `contacts` | what is actually ON the cards |

Always read the last one through **`gripContacts(frameType, override?)`**, never off the
spec — absent, it defaults to `Object.keys(pressure)` read as fingertips, so every
pre-existing frame scores exactly as it did. `contacts` may also be overridden PER BEAT
from the grip declaration (threaded `step.grip[side].contacts` → `gripDecl` → `hold`),
which is how a release window names the surfaces still on the cards instead of the
floor being cut a third time. Distinct overrides are part of the hold-coalescing key,
so a release beat is never merged into the whole carry.

**Anchors are no longer only fingertips.** `contactFrame` sums `tips` plus an optional
`anchor` list of surface descriptors:
- `{ kind: 'palm', region?: 'palm'|'thenar', u?, v?, lift? }` — a point on the palmar
  SURFACE. Independent of every joint angle, so it is the most continuous anchor
  available: measured 0.0mm of drift across a 15→52-card interpolation, where an edge
  pinch drifts 67.7mm.
- `{ kind: 'crest', finger, joint?, along?, facing?: ±1 }` — a point on a phalange's
  outer surface. `facing:+1` is the pad side, `−1` the nail side.

**The crest convention is AUTHORED and frame-local, deliberately not "the highest
point".** That phrase is a world-Y notion on a hand that turns over, and it is an argmax
over a continuum, so the winning point HOPS between phalanges mid-curl — and a jump in a
carry anchor is a card snapping. Under a palm-up cradle local +z *is* world up, so
`facing:+1` returns the highest point in the one case where the phrase is well defined.

**`contactSurfaceRadius` is the trap here.** A tip descriptor's point is a joint CENTRE
and owes its own distal radius; a `palm` or `crest` point is already ON the skin and owes
nothing. Charging a radius for a palm point reports a grip that is touching as a whole
radius clear.
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
- **`CARDS PIERCED`** — the number of cards whose shell contains a capsule sample
  point. A **HARD GATE at 0**, and the only one of these that is monotone and
  unbounded. It exists because the depth reading above SATURATES (see below), so a
  gauge pinned at ~0.10 cannot tell "grazed one card" from "knuckle through twenty".
  It is ADDITIVE, not a replacement: a capsule can overlap nearly a full radius with
  its axis still outside every card, so depth stays the primary graze cap and pierce
  catches what depth cannot see.
- **`CAUSALITY_BUDGET`** — the fraction of card MOTION that nothing causes. Ratchets
  **down**. This is the one metric that asks the question the app is actually about,
  and it is the newest: every other number here asks "is a hand near a card", while
  this asks, for each card that MOVED, whether there was anything to move it. A lesson
  can score 100% fingertip contact and still be a gesture performed beside a shuffle
  that happens by itself — contact is measured over the cards a grip DECLARES, this is
  measured over every card that actually moved. Three legitimate movers: the card is
  GRIPPED (it rides a contact frame), a HAND SURFACE is on it (any phalange, palm or
  thenar, within 5mm of the card's surface), or GRAVITY (downward-dominant motion).
  A fourth exists in the world and not in this engine — card-on-card contact — and is
  deliberately NOT exempted, because exempting it would exempt exactly the authored
  motion the metric exists to find.
- **`CONTACT_FLOOR`** — percentage of gripping contacts within 0.025 of a card.
  Ratchets **up**, except where noted below. A lesson measuring 0% is recorded as
  *broken*, not passing.
- **The median gap**, printed beside the percentage. Read it. `CONTACT_FLOOR` is a
  threshold count, so a bimodal gap distribution can shift *toward* the cards while
  the count falls.

Having both ratchets means a lesson cannot satisfy the penetration check by
hovering above the deck, which is the failure mode the floor exists to catch — the
overhand USED to be exactly that shape: a clean 0.0079 bought with 8% contact and
its pads a full card-length off the cards. It has since been rebuilt and now
measures 100% at 0.0034, so the example is historical — but the failure mode is
not, and it is why the floor exists.

**CARDS ARE ZERO-THICKNESS PLANES IN THE RENDERER.** `CARD_T` (0.003 = 0.30mm) exists
only in the collision maths; the mesh is a `PlaneGeometry` with no thickness at all. This
is the most load-bearing fact about card-on-card clipping, because it means **two parallel
cards at distinct heights cannot intersect, at any separation.** Every clipping fix in the
app rests on it.

**CARD-ON-CARD CLIPPING is gated (`CLIP_BUDGET`), and the geometry that causes it is one
rule.** A card bowed by `b` stands its ends `(1 − cos((CARD_H/2)·b))/b` off its own centre
plane, while a stack spaces cards ONE card thickness apart. So any bow larger than the
spacing makes crossings unavoidable between overlapping cards at different bends —
regardless of position, angle or tuning. Measured:

| | arch, in card thicknesses | outcome |
|---|---|---|
| wash `BEND_MAX` 0.14 | 4.5, inside a 1.4mm height band holding all 52 cards | 15,333 clipping pair-frames |
| riffle `BEND` 1.1 | 35 | 963 pair-frames, 19.8 cards deep |
| riffle `BEND` 0.8 | 26 | 533 pair-frames, 12.2 cards deep |

The wash is fixed OUTRIGHT and stays at a hard zero: its cards are flat (`BEND_MAX` → 0)
and `restInOrder` hands each layout's height draws back out in STACKING ORDER, so no two
overlapping cards share a height. Same distribution, same band, strictly ordered — and
because the planes are then parallel and distinct, it cannot creep back by fractions. It
can only return if someone reintroduces a bend or a tilt, and then it returns loudly.
The riffle can NOT take that fix: its bow is the thing the lesson teaches and the user
asked for explicitly, so its arch is traded down instead of removed.

**"Just stack the cards physically" does not work for the wash, and this was measured
rather than assumed:** 52 cards is 29.1 wu² over a 2.68 × 0.9 field, or 12× coverage, and
honest layering gives a longest overlap chain of 33 — a 0.111-tall mound even at zero
bend, which lifts every palm with it and forfeits the pad clearances entirely.

**Measure card-vs-card with EDGE-versus-FACE, never point-in-volume.** A 3×3 grid of
points per card reported the whole catalog clipping-free at 0.2mm when the true worst was
68mm: a card is 63.5 × 88.9mm and 0.30mm thick, so grid points 31mm apart pass cleanly
between the plates of an X crossing, and refining the grid does not help because the
target set is measure-zero. Also do NOT filter by a minimum crossing angle, however
reasonable it sounds — the worst crossing angle in the wash is 6°, and a 4° gate discards
98% of the real defect. Shallow crossings are exactly what produce a long visible seam.

**INERT CONTACT is gated too** (`INERT_BUDGET`), the reciprocal of `CAUSALITY_BUDGET`:
a MOVING hand is on a card and the card does not move. A lesson can satisfy causality
completely and still show a palm sweeping through a static spread, which is what a user
reported seeing while every metric was green.

**`captureFrames.mjs` must not wait on `networkidle2`.** With the analytics beacon and
vite's HMR socket both open, "no more than two connections for 500ms" never arrives, and
the one tool whose entire job is looking at the app dies after a full minute with a
navigation timeout. The dev bridge appearing is the readiness signal; it lands in seconds.

**A metric that measures hands can be fooled by a hand-shaped NaN.** The causality
metric's first version passed palm points to `wristLocalToWorld` as plain arrays; that
function does `out.copy(p)`, which reads `.x/.y/.z`, so every palm sample was NaN. And
because `NaN > band` is false, the search loop broke on the first NaN and skipped
whichever hand was checked second. It reported the overhand — the one lesson built
around a palm cradle — as 18% unmotivated when the true figure is 6%. If a hand-contact
number looks worse than the frames do, check that the palm is actually being measured.

**Contact-timed stagger, and where it is wrong.** `stagger: { by: 'contact' }` deals
each card at the instant a hand actually reaches it, sampled off the COMPILED hand
track, instead of at its rank in an authored order. It exists because a rank stagger
silently decouples from the hands: the wash ordered its cards with an analytic model of
the palm's sweep, that model ignored the orbit's `phase`, and when the lesson gained an
antiphase left hand half its cards were timed against the wrong circle. Measured, the
instant a hand was nearest a card and the instant that card moved fastest differed by a
median 0.233 of the pass and their orderings were indistinguishable from random. Because
it only re-TIMES motion, it changed mixing not at all (path median 1.470, 0/52 barely
raked) while taking hand-on-card from 26% to 46%.
It is NOT a general replacement for rank staggering. Applied to a DEAL rather than a
rake — cards leaving a squared stack — it drove a pinky 0.086 into a card, because
re-timing a card's departure to the moment a hand arrives puts the hand where the card
still is. A rake wants contact timing; a deal needs the card gone before the hand
arrives. Note also that it required compiling hand tracks BEFORE card tracks, which is
why `compileLesson` now lays out step timings in a cheap pre-pass.

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

**Only ONE of the two wash metrics is vacuous, and this file used to claim both were.**
`CONTACT_FLOOR` genuinely is: nothing in the wash is gripped, so it reports "0% of 0"
whether the hands are raking the cards or waving beside them.
`PENETRATION_BUDGET` is NOT. `verifyTracks` scores EVERY finger of the wash against
EVERY card regardless of grips, so the 0.0000 was never vacuous — it was the pads
genuinely hovering. Proven: halving the lesson's `CONTACT_AIR` to bring the pads down
onto the cards produced **184 failures at 0.0260** immediately. The old wording is the
sentence that would let the next author bury a palm in the deck and believe the metric
had cleared it. Use `scripts/inspect/washRake.mjs` alongside, which measures pad reach
against card spread, each card's PATH LENGTH over the smoosh window, and — added
because neither of those can see a HOVER — the per-step PAD-TO-CARD CLEARANCE.

That third number exists because reach and path length were both satisfied by a lesson
whose palms never touched anything: the pads swept the right area and the cards moved,
so both readings looked healthy while a single authored constant (`CONTACT_AIR`) was
being quoted as though it were a measurement. It prints BOTH definitions for the same
reason `tryLesson` does — a flat raking hand touches with the pads of its MIDDLE
phalanges as much as with its tips, so a tip-only reading overstates the air about
fourfold. Current state, in millimetres:

| step | tip-only min/med | whole-finger min/med |
|---|---|---|
| `smoosh-1` | 2.8 / 9.3 | 1.7 / 2.6 |
| `smoosh-2` | 1.4 / 7.4 | 0.3 / 1.7 |
| `smoosh-3` | 1.5 / 7.7 | 0.5 / 1.5 |
| `lift-1` / `lift-2` | 10.1 / 23.8–26.3 | 3.0 / 15.2–18.3 |

So the three raking passes genuinely graze (whole-finger medians 1.5–2.6mm) while the
lifts correctly leave the cards. A review of this lesson reported "typically 15–26mm of
air" through the smooshes; that does not reproduce under either definition, which is
precisely why both are now printed rather than argued about.

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

**"Converging palms need ≥ 0.5 x-separation" IS NOT SUFFICIENT, and the riffle is the
counter-example.** The rule was written when the hands were 55% translucent; with opaque
hands the real constraint is on the THUMB BASES, not the palms. `FINGERS.thumb.mcp` puts
the thumb knuckle a FIXED 0.505 inboard of the palm centre, so two palms 1.047 apart —
comfortably satisfying the old rule — leave the thumb bases only **0.037 apart against
0.238 of capsule**. The riffle's thumbs were not merely touching, they crossed in an X:
the left thumb's mid-joint measured at x **+0.065** and the right at **−0.076**, i.e. each
had swung across the table's centre line. That is 84 CARD THICKNESSES (25mm) of palm
inside palm, on 159 of 201 frames, and no metric in this repo could see it until
`handClash.mjs` existed.

The honest constraint for any two-handed grip whose thumbs work near a shared centre
line is **thumb-base separation ≥ 0.238**, i.e. palms ≥ ~1.25 apart at zero hand yaw —
or the hands yawed so the tips converge while the bases diverge, which is what the
rebuilt riffle does (yaw −0.35 with the wrist outboard).

A second consequence, and it closes off a whole class of attempted fixes: **two hands
cannot share one deck's centre line on this rig under ANY grip.** That is why the
reference footage's "both hands on one squared pack" (95s) is unreachable, why the riffle's
cut cannot be gripped, and why the overhand's `overhandNew` could not take a packet off a
squared deck. It is a DIFFERENT blocker from the edge pinch's wrap, and it is not
solvable by choosing another grip vocabulary.

**A thumb target must be inside the thumb's reach, or the solver makes it worse.** The
riffle's old thumb target sat 0.70 from a thumb with 0.744 of reach, so `solveThumbTo`
pinned opposition at its limit and swung the whole metacarpal across the centre line
rather than failing visibly. Same failure mode as the reachability guard in
`reseatGrippingTips`: a pinned joint does not land near its target, it lands somewhere
arbitrary.

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

**`framing.mjs` now also prints `CROPPED`, and that line is about HANDS.** It used to
report only wrist JOINT positions, which is why it called the overhand "aim ok" while
that lesson's drawing hand was entirely out of shot with two fingertips against the top
edge. It now builds the true world extent of everything that renders — every finger
joint and tip inflated by its own phalange radius, plus the palm/thenar boxes as
rotated corners and the wrist/forearm capsules as sphere centres — and projects it
through the ACTIVE preset. It was written to catch the overhand's `peel-*` beats,
which it reported at 27–39% in shot; that staging has since been deleted. Current
counts: overhand 1, riffle 5, charlier 9, wash 15.

**It now models the app's REAL projection, and it did not used to.** It built
`new PerspectiveCamera(preset.fov, w/h, …)` and both arguments are wrong at runtime:
`ResponsiveCamera` OVERWRITES every preset's `fov` with `fovForAspect(canvasAspect)`
(≈37.45° at 1200×860, so the declared 34–38 are dead except as the Canvas seed), and
`setViewOffset` re-assigns `aspect = w/(h+inset)` = 1.132, not `w/h` = 1.395. The tool
therefore believed the frame was 11–18% wider than it is, which made every horizontal
`CROPPED` figure optimistic — in the one tool whose whole job is honesty about what
leaves frame. Correcting it moved the overhand from 0 cropped beats to 1 and the wash
from 5 to 15. If you change `ResponsiveCamera`, change this too.
Two filters keep it honest rather than noisy: an arm stub leaving frame is what real
footage looks like and is only reported, and a hand more than a card-length from any
card is "parked", not yet in the shot.

**Two frame models are printed per line, and the difference is real.**
`ResponsiveCamera` calls `setViewOffset(w, h + inset, 0, inset, w, h)`. three applies
`fov` to the FULL virtual height and carves the sub-window from its TOP, so the app
also discards the top `inset/(h+inset)` of the fov frame — the usable band is
symmetric, `±(1 − 2·PANEL_FRAC)`, not a bottom reserve. `TRANSPORT_RESERVE` (0.40)
stays the documented gate because every preset's comment quotes half-heights derived
from it; `PANEL_FRAC` (0.19) is the measured app geometry. A camera pass must use the
symmetric band.

**There is NO anisotropic-aspect bug, however convincing the argument sounds.** It was
claimed and written down as fact this session: r3f sets `camera.aspect = w/h` while the
view offset leaves the horizontal extent at `aspect·(h+inset)`, so the image "should"
be stretched ~1.23× vertically. It is not, because `PerspectiveCamera.setViewOffset`
reassigns `this.aspect = fullWidth / fullHeight` as its FIRST statement, and
`ResponsiveCamera` passes `fullHeight = height + inset` — so the aspect is already
`w/(h+inset)` before the projection is built and whatever r3f set is overwritten.
Verified numerically: a 1×1 world square facing the camera renders 336.2px × 336.2px,
ratio 1.0000, with and without the "fix". Do not change the aspect.

**`pose.spread` and `pose.splay` cannot abduct a straight finger, and this looks like
a bug in a lesson when it is a rig limitation.** Both are a knuckle yaw in the **Y**
slot, i.e. a rotation about the finger's OWN axis, so they rotate the plane a finger
curls in and leave a fully extended finger exactly where it was — every fingertip of the
wash's flat rake pose is identical at spread 0.5 and at 0.7. Real abduction is a rotation
about the palm normal (local Z). Until that exists, "the fingers splay" is not
expressible for a flat hand, and per-finger asymmetry has to come from curl phase lag
instead.

**The wash's pads overshoot the near edge of the card band by 0.23, and the obvious fix
is the wrong one.** An elliptical orbit (`ampZ` on `motionOffset`) was added and then
removed: a hand's pad patch is 0.783 deep in z (the thumb pad sits ~78mm behind the
middle fingertip — anatomy, not a pose) and the card band is only 0.9 deep, so keeping
the pad envelope inside the band allows `ampZ <= 0.0585` against an x amplitude of 0.40.
That is a 7:1 ellipse — a one-dimensional sweep — and "cards move freely in TWO
dimensions" is the wash's whole teaching point. The real fix is a DEEPER card spread
(widen `ROW_Z`/`ROW_HALF`, then re-check `framing.mjs`), which is open work.

**`sampleTrack` hands back REUSED card objects.** Keeping a reference to a previous
sample gives you the current pose, so any probe comparing two instants must snapshot
plain numbers. This has now produced false readings twice — including one that
reported all 52 wash cards frozen at exactly 0.000, which looked like a dead lesson
and was a dead probe.

**Bowed cards can rest on their end points**, which a naive felt-contact
assertion does not catch, it tests the card's origin, not its bent extent.

## Open work

Ordered by how much evidence is behind them, not by how easy they are.

**RESOLVED — the palm-up CRADLE grip exists and the overhand ships on it.**
`GRIP_FRAME_TYPES` was entirely fingertip-weighted, so a pile resting on a PALM had
no surface that could name where it sat. Three things fixed that: the `contacts`
split above, a `palm` anchor kind in `contactFrame`, and `cradleGrip`/`cradleGripAuto`
beside `edgePinchGrip`. The property that made it worth the work is that **a cradle's
carry anchor does not drift with pile size** — measured 0.0mm across a 15→52-card
interpolation, against 67.7mm for an edge pinch — which is why the rebuilt overhand
solves each hand ONCE (compile 1820ms → 83ms) instead of re-solving per beat.
Two limits are known and accepted rather than fixed: the cradle's four fingers cup the
pile 0.16–0.34 clear without touching it (the far long edge is inside their minimum
curl radius, and a pad cannot travel sideways), and every seat on the THUMB side reads
0.046–0.057 deep however the hand is shaped, because the thumb's metacarpal capsule
stands 0.055 proud of the palm plane — so the swept seat is 24mm ulnar, which is where
real hands cradle a deck.

**RESOLVED — `indexPivot` rides the finger's CREST.** The charlier's pivot beat scored
0% at a median gap of 0.142 (14mm of visible air under the packet, the worst-looking
thing in that lesson) because the frame rode the index TIP and `SEAT` had to clear the
deepest curl the cut uses. It now rides the dorsal crest of the index's middle
phalange and that beat measures **100% at a median gap of 0.001**.
The direction convention was the open question, and the answer is that it is AUTHORED
and frame-local — `{kind:'crest', finger, joint, along, facing:±1}` — not "the highest
point". That phrase was rejected for two measured reasons: it is a world-Y notion on a
hand that turns over, and it is an argmax over a continuum, so the winning point HOPS
between phalanges mid-curl — and a jump in a carry anchor is a card snapping. Under a
palm-up cradle local +z *is* world up, so `facing:+1` returns the highest point in the
one case where the phrase is well defined.

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

**RESOLVED — the table riffle no longer uses a pinch.** It was authored as an edge
PINCH, a two-jaw clamp, and a tabled riffle is not one: in the footage the fingers press
the packet's TOP FACE down, the thumb sits at the near long edge, and **the felt is the
opposing jaw.** That single substitution was the root of three separate defects (hands
approaching from the sides; fingers flat across the card faces; a cut that could not be
gripped), and none of them was visible to any metric — every number on the lesson was
green. It was found by comparing frames against real footage.

The replacement is `tableTop` in `handKinematics.js` plus `tableTopGrip` in
`authoring/contacts.js`. Measured, pinch → tableTop on the same lesson:

| | pinch | tableTop |
|---|---|---|
| contact | 61% of 275 | **78% of 491** |
| scored set | `[index middle]` | **`[index middle ring thumb]`** |
| penetration | 1.2 cards | **0.8 cards** |
| median gap | 0.018 | **0.013** |
| max boundary jump | 0.0061 | **0.0030** |
| carry-anchor drift | 67.7mm (15→52 cards) | **7.9mm** (13→39) |

Note the direction of the set change: it WIDENED. The pinch had to stop scoring its
thumb because a pinch cannot solve a ~90°-yawed landscape half (residual 0.3094 against
0.0004 unyawed), so that thumb sat 0.104–0.131 clear of the cards on every frame. Under
a table-top hold it is genuinely on them. More surfaces scored AND a higher percentage
is the opposite of the narrowing pattern `CONTACT_FLOOR` warns about.

**Two numbers decide a table-top hold, and neither is obvious.**
- **The wrist must be HIGH.** At wrist y 0.61 the fingers come down steeply and a
  steeply-curled finger dips its distal phalange through the card BEHIND the pad —
  measured 5.4 card thicknesses with every pad reading 0mm. At y 0.70 they reach down
  shallowly instead and penetration is 0.0. The tangency solve (below) proves the same
  thing from the other side.
- **PRESSURE MUST BE FEEBLE.** Pressure exists to tighten fingers on a packet they are
  CLAMPING; this hold clamps nothing. At pinch-like weights the suite fails outright
  (index distal 2.2 cards through the face) while the contact percentage is FLAT at ~79%
  across every weight swept — the squeeze was buying nothing and costing depth.

**A tangency solve now exists** (`solveFingerTo`'s `tangentTo`, opt-in). `surfaceContact`
constrains a fingertip's POSITION and nothing constrains the distal phalange's ANGLE, so
a curled finger can touch correctly at the pad and dip the rest of its distal through the
card. The curl solve has two DOF and pins the distal by `DIST_COUPLING`, so position AND
orientation needs a third: fixing the distal angle makes the L2 segment a known vector,
and subtracting it turns the problem into the classic analytic two-link reach. What it
really constrains is the WRIST — below about y 0.8 the distal would have to hyperextend
~2.6 rad, so it fails closed and the caller falls back to the curl solve.

Still open on this lesson: the CUT is ungripped (the largest single block of unmotivated
motion in the catalog). Now that the grip no longer wraps, a hand CAN take the top half
off a squared deck without its fingers needing the space underneath — so the two attempts
recorded at that beat are worth retrying against `tableTopGrip`.

In the reference (`scripts/inspect/refjobs.json`, riffle at 75s and 95s) the dealer's
fingers press the deck's TOP FACE down and the thumb levers the inner end up: **the table
is the opposing jaw.** The lesson borrows `edgePinchGrip`, a two-jaw clamp, and three
separate defects all follow from that one substitution:

- **The hands approach from the SIDES**, not from the dealer's near side. `yaw` is the
  parameter for exactly this and cannot be used: the pinch already fails to solve a
  ~90°-yawed landscape half (reach residual 0.3094 against 0.0004 unyawed), and adding
  yaw takes the suite from 0 to 178+ failures.
- **The fingers lie flat ACROSS the card faces**, covering most of both halves, where in
  the footage a hand covers about a third and the backs stay readable. This is also why
  `XRAY_OVER` had to be so high — the fade was compensating for a hand that should not
  have been over the cards at all.
- **The cut cannot be gripped**, so the deck separates itself: 709 of that lesson's 5092
  moving-card samples, the largest single block of unmotivated motion in the catalog.
  Two authored attempts are recorded in the lesson at that beat; both fail for the same
  geometric reason that defeated `overhandNew` — a pinch WRAPS its packet, so its fingers
  need the space below the packet's bottom face, and over a squared deck the other half
  is in exactly that space.

`tableGrip` in `authoring/contacts.js` is the closer vocabulary — palm down, turned to lie
along the pile, with a `yaw` that already defaults to 0.12 — and it is currently unused.
Re-authoring the riffle onto a top-face grip is the one change that would fix all three.

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

**RESOLVED — the overhand no longer hovers.** It shipped 8% contact at a median gap of
0.156 with its drawing hand cropped out of frame and the peeled cards floating
unsupported. Rebuilt on the cradle above, it measures **100% of 562 at a median gap of
0.014, penetration 0.0034, 0 pierced**, in 12.6s. It has ONE cropped beat, `rest`,
where the withdrawing hand passes 0.07 off the left edge at 98% in shot — a hand
leaving frame as the lesson ends, which is what should happen.
Five things in it were decided by measurement and each is recorded at its call site:
the pile must be LANDSCAPE (a portrait cradle hovers 0.47); packets must leave the TOP
of the block or the whole shuffle degenerates to a single cut (`mixing.js` reads the
order out of the poses, so the staging IS the claim — the permutation is a genuine
six-block reversal); the two packets must be 0.88 apart in X, because separating them
in z puts the bulk inside the cradle's own fingers; the pinch's pads must sit LOW on
the block, since a rigidly-held block cannot re-centre under its pads; and the
un-aimed index had to be STRAIGHTENED rather than tucked, because it otherwise hangs
0.164 below the packet, in the fall corridor.

**What the overhand does NOT do: it never puts the deck back on the felt.** It ends
squared in the receiving hand, and that is a geometric consequence rather than an
oversight. A cradle's lowest capsule sits 0.25 below the palm seat, so carrying the
pile down to felt height buries the hand 0.23 under the table; lifting the hand out
from under the pile drives the palm into it (measured 0.1157, 2 cards pierced); and
sliding out sideways needs half a card of travel. The honest route is for the empty
drawing hand to take the finished pile by its edges and set it down — 2–3 more beats
and a new grip, which would put the lesson near 15s.

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
    annotations/             guides.jsx  ghost cards / arrows / path traces
                             (the teaching TEXT is not here: each beat's label is
                             a chip in the step rail, because in-scene 3D callouts
                             covered the cards and a docked banner duplicated the
                             rail. AnnotationLayer.jsx held an old <Html> version,
                             was never imported, and is deleted.)
  visualizer/                free-play fan / flip / layout driver
  ui/                        UIChrome, VisualizerControls, chrome.css;
                             Learn is LessonPicker (four buttons) + LessonStrip
                             (steps + scrubber) + MixDock (the mixing readout,
                             mixDock.css) + FacesToggle + MixMeter
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
    stressTest.mjs             the interactive layer: mid-shuffle switching,
                               transport spam, deck integrity, responsive down to
                               390px. Its paused-on-open and still-poster guards
                               are GONE with the behaviour they guarded - picking
                               a technique now starts it, and there is no catalog
                               preview to hold still
    washRake.mjs               the wash only: pad reach vs spread, per-card path
                               length, and per-step pad-to-card clearance (tip AND
                               whole-finger, because tip-only overstates a flat rake ~4x)
    gripProbe.mjs              sweep a grip's placement; never place one by hand
    cardClip.mjs               card-vs-card: how deep one card passes through
                               another, and TOP-CARD SWAPS - overlapping pairs
                               trading which is on top, which is the only depth
                               cue two coplanar cards have. Exported into
                               verifyTracks, so it is a gate, not just a tool
    handClash.mjs              hand-vs-hand: the closest capsule pair per beat
    inertContact.mjs           cards standing still under a moving hand
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
