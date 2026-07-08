# 3D Hands for Shuffle Techniques — Handoff

## ⏩ Session 5 — FINGER-DRIVEN overhaul: contact frames, per-card releases, table riffle, whole-catalog pass

**Committed + pushed: `50f66bb` on master** (27 files, +2440/−550). Plan: `~/.claude/plans/the-highest-priority-for-glowing-iverson.md`. Priority shifted per user: cards must visibly be MOVED BY the fingers (wrist only repositions), and cards stay FLAT/low on the felt — real casino mechanics, not on-edge flourishes.

**Verified two ways:** (1) checked-in headless harness — `npm run verify` (`scripts/verify/`): fkParity 3340 checks (pure FK ↔ real rig < 1e-6, IK round-trips, mirror invariant) + verifyTracks ~520k checks (scrub purity forward/reverse/shuffled, NaN/quat hygiene, boundary continuity on every segment/hold/release edge, riffle grip-fidelity, charlier wrist-stillness + up-and-over crossing). (2) **Visually via puppeteer screenshots** — the repo's puppeteer devDependency drives the dev server headless (driver pattern: goto localhost:5173 → click "Learn" tab + lesson button by text → set `.scrub input[type=range]` via the native value setter + `input` event → screenshot). This caught real bugs the numbers couldn't (see watch-outs). Consider `/run-skill-generator` to capture the driver as a project skill. Lint + build clean.

### Architecture added (all deterministic — the track stays a pure function of ms)

1. **`src/hands/handRigSpec.js`** — single source of truth for rig numbers (FINGERS table, HAND_SCALE, THUMB_BASE_ROT, JOINT_LIMITS). `handRig.js` and the FK module both import it.
2. **🐛 Joint-pivot fix** (`handRig.js` buildFinger): joints previously ALL pivoted at the knuckle (fingers fanned, never curled). Now each joint pivots at its phalange's base. Changed every pose's silhouette (tips moved up to 0.36 world units on grippy poses).
3. **`src/hands/handKinematics.js`** — pure FK (fingertip/joint world positions from a pose; headless-safe; mirror policy: points may mirror, orientations only ever composed `wrist.quat ∘ f(angles)`, never decomposed under negative scale); analytic 2-link finger IK (`solveFingerTo`, distal coupling 0.75) + thumb IK with opposition search (`solveThumbTo`); **contact frames** `GRIP_FRAME_TYPES`: `pinch` (thumb+index mid), `packet` (thumb/index/middle centroid), `thumbPeel` (thumb-dominant), `indexPivot` (index tip, pitchGain −2.2, sign chosen empirically — charlier swing); `applyGripPressure` (pressure visibly tightens the gripping fingers). `fkParity.test.mjs` guards FK ↔ rig forever.
4. **Pose schema v2** (back-compat, absent fields = zeros): optional `splay:{perFinger}` + `thumbOpp:{x,z}` (animatable opposition); keyframes may carry partial `splay`/`thumbOpp` overrides and **pose OBJECTS** (not just preset names).
5. **Grip spec v2** (`compileLesson.js`): `grip:{side:{cards, frame, pressure:[{at,v}], bendGain, release}}`. Legacy string form still = rigid wrist weld. `frame` puts held cards on a fingertip contact frame → **finger curls move the cards**. `pressure` tightens the hand AND (scaled by `bendGain`) bows the held packet. `release:'stagger'` = each card/packet leaves the hand exactly when its own staggered travel segment begins.
6. **Snap-killer release baking** (`bakeHoldReleases`): every hold projects each card through `frame(t_release)∘offset` and overwrites the card's next segment `from` → handoffs are seamless BY CONSTRUCTION, both scrub directions (riffle max boundary jump 0.0029 vs 0.03 before). Hold captures CHAIN through prior holds (`renderedCardPose`) so grips hand packets to each other (bend → weave; bridge → cascade). Compiler fix: partial `to` arrays now carry unlisted cards' poses forward (enables block cuts off a stack).
7. **Micro-animation** (`src/hands/handMotion.js`): global idle breathing — pure fn of ABSOLUTE ms, per-finger phases, side-decorrelated, applied inside `handFromSegments` so runtime AND grip capture share one code path (welds stay exact); hands never freeze in any lesson. Per-keyframe `fingerMotion:[{fingers, type:'tremor'|'curlRipple'|'tighten', amp, cycles}]` (sin²(πt) envelope → boundary-safe with any phase). New eases: `easeOutBackSoft`, `anticipate`, `settle` (damped overshoot, exact endpoints), `snapEase` (`src/lib/ease.js`).
8. **Compile-time contact authoring** (`src/lessons/authoring/contacts.js`): `poseWithContacts` (IK fingertips onto card targets inside `build()` — no blind angle guessing), `wristAnchorForContact`, `thumbRatchetKeyframes` (thumb opens across exactly the stagger release window, alternating micro-jitter), `eulerQuat`, and **shared solved grips**: `tableGrip({gap, tilt})` — palm flat over a half, fingertips ON the cards, thumb owning the inner-near corner (validated <0.05 err); `cageGrip({topY})` — cups the center deck's short end, thumb on top.
9. **`tableRiffleLayout`** (`layouts.js`): two face-down halves FLAT on the felt, side by side, inner corners angled (`yaw`); `tilt` lifts each half's near edge as the thumbs load it (position compensates so the far edge stays down).

### All 11 lessons re-authored / upgraded

- **Riffle** (~19.6s, the flagship — real TABLE riffle, screenshots confirmed the dealer read): reach in (hands first, cards untouched) → right hand cuts the top half and sets it down flat beside (packet rides the fingertip frame — all motion hand-caused) → left slides its half in → thumbs tilt+bend the inner-near corners (`pressure`→1 + `bendGain`, tremor) → thumb-ratchet weave: both halves pinched in `thumbPeel` frames, **each card leaves at its own release moment from wherever the thumb holds it**, flicking down LOW (`midBend 0.7, arcLift 0.05`) → settle-eased square → **cage-then-bow bridge** (hands take the cage position FIRST, then grip+pressure bows the deck in place) → per-card cascade out of the cage with `curlRipple` → rest.
- **Charlier** (~9.5s, one hand): palm-up pinch pickup (solved contacts); thumb visibly releases the bottom half into the palm (harness asserts wrist drift <0.09 through the finger beats — the cut is all fingers); **index extends and the packet swings up-and-over riding the index fingertip's frame** (`indexPivot`), released mid-air at the apex (baked handoff), gravity lands it; thumb catch (`tighten`); hover + set-down recovery (final carry keyframe = pinch pose translated by exactly the deck's travel → zero handoff error; the harness caught a 0.38 snap in the naive version).
- **Faro**: precision variant of the table system — tighter yaw 0.16, tilt 0.18, `midBend 0.4/arcLift 0.03`, ratchet jitter 0.015, 7-step ratchet.
- **Hindu / Strip**: the whole deck rides the right hand's `pinch`; `release:'stagger'` peels each packet out of the grip at its own draw moment; left hand sweeps beneath / presses the drops home (`snapEase` + packet stagger).
- **Overhand**: packet carries upgraded to `frame:'packet'` + pressure (squeeze at pickup, relax into the drop).
- **Waterfall / Spring-primer**: cage-first, pressure bows the deck (`bendGain`), waterfall = per-card `release:'stagger'` out of the cage with `curlRipple`; spring-back uses `settle`.
- **Pile / Pressure-fan**: light pass (no grips): dealing hand orbits the piles in rhythm with the card stagger + pinch tremor; fan = anchored pivot pinch + sweeping `fanSpread` with `splay` overrides.
- **Wash**: kept (already had orbit choreography); gains idle breathing like everything else.
- **Annotations** in all reworked lessons moved beside the action (`[-1.35, 0.75, 0.2]`-style) so they never cover the cards.

### Watch-outs (screenshot-caught — respect these when authoring)

- **Never hold a grip across a large hand-orientation change**: the packet rides the frame's quat, so a 90° wrist turn tips the whole deck over mid-carry. Move the hand into its new orientation FIRST, then declare the grip (the riffle bridge's cage→bow split exists exactly for this).
- **Converging palms need ≥0.5 x-separation** or they interpenetrate into a blob (translucent hands make it look like one melted hand).
- Cards released during a weave must stay LOW (`arcLift ≤ 0.05`) — the riffle-kind defaults (`arcLift 0.55/midBend 3.1`) read as a card fountain.

### Tuning knobs

Table grip geometry → `tableGrip`/`cageGrip` targets in `src/lessons/authoring/contacts.js` (shared by riffle/faro/waterfall/spring). Riffle pacing/gaps → `G`/`YAW`/`TILT` in `riffle.lesson.js`. Charlier deck height/pinch → `DX/DY/DZ`, `PINCH_ANCHOR` + contact targets in `charlier.lesson.js`; swing size/direction → `indexPivot.pitchGain` (`handKinematics.js`). Idle amount → `IDLE_*` consts in `handMotion.js`. Pressure curl depth → `PRESSURE_CURL` (`handKinematics.js`). Frame pitch coupling → `pitchGain` per `GRIP_FRAME_TYPES` entry.

### Deferred (explicit)

Fingertip contact-dent shader (`uContact[4]` uniforms + `X_SEGS` 6→16 in `cardGeometry.js` — pressure-bend + tighten carries the read at current camera distances); square-step cards still keyframed (hands nudge alongside); paused scrubbing doesn't update the "Step x/y" label in the transport (pre-existing UI nit); a skinned-GLB hand swap stays possible later (the FK/pose interface is rig-agnostic).

---

## ⏩ Session 4 update — reorder-in-any-layout, slow hand-driven shuffles

Plan: `~/.claude/plans/mellow-wandering-beacon.md`. Lint + build clean; a headless engine harness (`scratchpad/verifyHands.mjs`, run with `node --loader scratchpad/extLoader.mjs …`) passes 70/70 (determinism, scrub-reversibility, motion-zero-at-boundaries, far split, grip carry, circling hands). **Still needs the user's eyes** for pose/anchor/camera polish — all hand geometry is authored blind.

**1. Visualizer: drag-to-reorder now works in EVERY layout; clicking felt no longer switches layouts.**
- Root cause of the two reported bugs was ONE bug: `pickCard` raycast the registered card **groups** with `recursive=false`, and `Group.raycast` is a no-op — so taps never hit a card and always fell through to the "empty felt → cycle layout" branch. Fixed: `intersectObjects(meshes, true)` + walk `hit.object.parent` back to the registered group (`VisualizerDriver.jsx`).
- Removed the felt-tap layout-cycling entirely (layouts change only via the buttons). Tap-a-card-to-flip stays.
- Drag is no longer gated to fan/stack. Insertion index is now **nearest layout slot in screen space** (project each slot's base pos to pixels, pick closest to the drop point) — uniform for fan/ring/ribbon/spiral/grid/stack, and it fixes the old stack drag (the horizontal drag-plane made the stack's y-key constant → always index 0).
- Hint text in `VisualizerControls.jsx` made unconditional.

**2. Lessons are ~4× slower and the hands MOVE continuously.** Two engine additions (backward compatible — legacy `{from,to,anchor}` still compiles):
- **Multi-keyframe hand tracks.** `step.hands.<side>` may now be an ARRAY of keyframes `{ at:0..1, pose?, anchor?, fingers?, ease?, motion? }`. `compileHandTracks` (`compileLesson.js`) normalizes both shapes, resolves each keyframe (a named pose, or clone-current + partial `fingers` override — the thumb-ratchet primitive), and emits one segment per keyframe pair (+ a travel segment if the first `at>0`). Poses chain: each side carries its last pose to the next step.
- **Procedural motion overlays.** A keyframe/segment may carry `motion:{ type:'orbit'|'rock'|'jitter', amp, cycles, axis?, phase? }` — a wrist-**position** overlay evaluated in `sampleTrack.js` (`motionOffset`) as a pure function of the un-eased local t. **Every shape uses integer `cycles` so the offset is exactly 0 at t=0/t=1** → segment boundaries, step jumps, and reverse scrub stay pop-free. The left/right mirror is baked at compile as `motion.sx` (x negated for left) — **only wrist position, never quats/curls** (mirror invariant preserved). Negative `cycles` = reversed orbit.
- **Riffle re-choreographed** (`riffle.lesson.js`, ~25s, 8 steps): split carries the halves FAR apart (`riffleGripLayout gap:1.6`), carry-in (grips), arch (bend + thumb-press + jitter), 7s weave with the thumbs **ratcheting open** in sync with the interlace while the hands inch together, square, then a real **bridge → cascade waterfall** (`springArchLayout` + new `bridgeCage` pose).
- **Wash re-choreographed** (`wash.lesson.js`, ~19s): wider scatter, new `swirl()` layout rotates the spread the way the hands circle, both palms in new `washPress` pose doing counter-rotating `orbit` motion (fwd, reversed, cross-body), then a sweep-in gather. **All step-boundary anchors aligned to one center so the wrist path is continuous.**
- **New poses** `bridgeCage` + `washPress` in `handPoses.js`.
- **Transport** `SPEEDS = [0.25, 0.5, 1, 2]` (`TransportBar.jsx`) — 0.25× for frame-by-frame study.
- **Other split lessons** (faro/overhand/hindu/strip) got wider split gaps + ~1.6–2× durations only (no hand choreography yet — reuse the keyframe/motion surface to add it).

**Overhand rebuilt into a real pick-up-and-place (after user feedback).** The first slow pass still looked wrong — the hands sat in the center swapping poses while the packets slid on their own. Root causes found + fixed (`overhand.lesson.js`):
- **Stale-closure bug (the big one):** step `to:` was authored as `() => twoPiles(src, dst, …)` — lazy closures over the MUTATING `src`/`dst` loop vars. The engine resolves `to` *after* `build()` returns, so every step saw the final mutated state; each grip captured its packet at the wrong place and welded it to the wrist at a ~1.8-unit offset (packet flew off to the side). Fix: **compute layout arrays eagerly at push-time with `.slice()` snapshots** (`to: twoPiles(src.slice(), dst.slice(), …)`), never a thunk over loop vars. General lesson: only use `to: (dk)=>…` as a PURE fn of the passed deck; never close over mutable outer state.
- **Left-hand mirror:** a left "holder" anchored near the source landed at the *opposite* pile (rig negates left wrist x). Fix: **drop the second hand entirely** — omit all `left` declarations so `leftTracks` is empty and the left hand stays hidden (`setPose(null)`). One hand now does the whole shuffle, which is also clearer.
- New `packetGrab` pose (palm-down, fingers curled to cage a packet from above). Each carry holds ONE wrist orientation so the gripped packet translates cleanly and lands flat with no snap. Choreography: deck as a pile on one side → hand reaches, grips the top packet (`grip:{right:ids}`), arcs it up/over, sets it on the growing far pile → repeat per packet → whole thing twice (piles swap sides each round). ~13s, 14 steps.
- Verified headlessly (`scratchpad/verifyHands.mjs`, 79/79): gripped packet rides IN the hand (gap 0.3–0.7, drift <0.05 through each carry), no snap at release (<0.15), ends as one squared pile. **Harness gotcha:** `sampleTrack` reuses cached Vector3s per card id, so any check comparing two samples must `.pos.clone()` the first — else it silently reads 0 (a broken no-snap check passed trivially until fixed).

**Not yet done:** apply the SAME pick-up-and-place grip-carry to hindu + strip (identical static-hands problem); hand choreography for faro/charlier/pile/pressureFan/spring/waterfall; fingertip contact dents.

---

## ⏩ Session 3 update — hands grip & carry, on-edge riffle, one-by-one splits, viz drag

Four features (plan: `~/.claude/plans/merry-bubbling-cookie.md`). Lint + build clean; a headless esbuild harness (`scratchpad/verifyPart3.mjs`) passes 12/12 assertions. Still needs the user's eyes for pose/camera polish.

1. **Cards are now truly gripped & carried by the hands.** New pure module `src/lessons/engine/grips.js` (`resolveGripCards`, `frameOf`, `captureGripOffset`, `applyGripFrame`). A lesson step declares `grip: { left:'firstHalf', right:'secondHalf' }` (selectors: `firstHalf`/`secondHalf`/`all`/id-array/`(deck)=>ids`, split at `mid=floor(n/2)`). `compileLesson` snapshots grip decls (pre-reorder), coalesces time-adjacent same-side/same-set ones, and captures each card's **offset relative to the hand's wrist frame at grip-start** → `track.holds`. `sampleTrack` now samples **hands first**, then for held cards overrides pos/quat with `wristFrame(t) ∘ offset` (bend still from the card's own track). Fully deterministic/scrubbable. **Invariant: the grip frame is side-agnostic — never mirror the quat or negate the offset for the left hand** (verified: offset is constant in the wrist frame across the carry).
2. **On-edge bowed riffle (bend faces the sides).** `layouts.js` gained `ON_EDGE` (±90° about world Y) + `riffleGripLayout(deck,{gap,baseY,lean})`: the two halves stand on edge with **faces pointing world ±X toward each hand**, so the existing long-axis bend bows them into a bridge whose arch profile faces the dealer camera. Riffle lesson reworked: `split` deals cards onto the edges one-by-one, `arch` grips the packets (hands carry them) while `bend:2.6` loads, `weave` (kind:'riffle') interlaces to flat, `square` finishes.
3. **Splits deal one-by-one.** Generalized the riffle-kind per-card stagger into `staggerWindow()` + a `stagger:{ by:'card'|'packet', spread?, span? }` option on `move` steps (packet grouping infers columns from the destination layout). Wired into riffle/faro (`by:'card'`) and strip/hindu/overhand block steps (`by:'packet'`). `arcLift` now also passes through non-staggered moves.
4. **Visualizer drag-to-reorder** (`VisualizerDriver.jsx`): in Fan/Stack, grab a card → `controls.enabled=false` → follow the cursor on a table plane → on drop, insertion index = count of cards sorting before the drop along the layout axis → `setDeck` reorder. Dragged card excluded from the ease loop. Fan also widened (`spread`/`radius`/lift bumped). Hint text updated in `VisualizerControls.jsx`.

**Tuning knobs for the visual pass:** riffle grip geometry → `riffleGripLayout` args + `GRIP_Y`/anchors in `riffle.lesson.js` (`lean` tilts the two halves into a tighter tent); stagger feel → `spread`/`span`; drag lift/threshold → `VisualizerDriver`. Camera may need a `dealerPOV` tweak to frame the standing bridge.

**Not yet done:** full grip/carry choreography for faro/hindu/strip/overhand (they have one-by-one splits but hands don't yet carry the packets — reuse the `grip:` surface); fingertip *contact* dent (still deferred).

---


## ⏩ Session 2 update (2026-07-03) — realistic rig + hands-grip-the-deck

Big pass on realism + coupling the hands to the bend. **All changes verified headlessly** (lint + build clean; a Node/esbuild harness sampled the whole riffle timeline — cards bend 2.6→4.9, hands land exactly on the ±0.5 halves, thumbs press the deck's inner-top edge, fingers wrap down around it, NaN-clean). Still needs the user's eyes for final pose polish.

**What changed**
1. **Rig rebuilt anatomically** (`handRig.js`). Coherent local frame documented in-file: +y = finger extension, +z = palmar (fingers curl toward +z), +x = pinky side. Fingers are tapered 3-capsule chains with Φ-based phalange ratios (≈1 : 0.62 : 0.38, middle longest), an arched knuckle line, a **thenar pad**, an **opposable thumb** (metacarpal swung across the palm), and a **wrist + forearm stub** so it's not a floating palm. One shared translucent gold-fresnel material.
2. **Mirroring bug fixed.** The old rig double-mirrored: `root.scale.x < 0` (left) already reverses a curl about local X, but the code *also* negated curls and mirrored the wrist quaternion — so the left hand curled the wrong way. Now: **left uses the SAME wrist quaternion and SAME finger angles as right; only wrist X position is negated** (`getHandPose`). `mirrorPose` deleted; the `side` arg to `applyHandPose` removed. (Verified: left tips are the exact X-mirror of right.)
3. **Poses re-authored for a palm-down table grip** (`handPoses.js`). Base orientation `PALM_DOWN = rotX(π/2)`: palm faces down, fingers drape down, thumb sweeps to the deck center. Chosen over the alternatives because it's the only one that keeps **both thumbs meeting at the center** (the riffle's release edge) while fingers drape onto the deck.
4. **Hands now align with the deck (the old #1 gap).** Added an **`anchor: [x,y,z]`** field to a step's `hands.<side>` entry — it re-places the wrist for the pose the hand moves *to* (the *from* pose keeps its own position so the hand travels in). `x` is given in right-hand coords; the left hand negates it automatically. Riffle halves tightened to `x = ±0.5` and both hands anchored there; overhand hands anchored near center.

**Tuning knobs (edit these, re-run `npm run dev`, scrub Learn → Riffle):**
- Hand *placement* per phase → the `anchor:` arrays in `src/lessons/catalog/riffle.lesson.js` (and `overhand.lesson.js`). This is the first thing to nudge.
- Grip *shape* (curl/spread) per phase → the `f(...)` finger angles + `spread` in the named poses in `src/hands/handPoses.js`.
- Wrist *tilt* → the `euler(PALM_DOWN ± …, yaw, roll)` on each pose.
- Overall hand *size* → `HAND_SCALE` in `handRig.js` (currently 4.6). Proportions → the `FINGERS` table there.
- Deck *bow* amount → `bend:` on the arch step and `midBend`/`arcLift` on the riffle step.
- **Known aesthetic choice to check:** forearms trail toward **−z** (off the deck's far end). If that reads as "reaching from the far side," the fix is documented in `scratchpad/verifyOrient.mjs` — but flipping it (rotY 180) swings the thumbs outward, so it's a trade-off.

**Not yet done (highest-impact next step):** true fingertip *contact* deformation — pass thumb/finger world positions as card-shader uniforms and add a gaussian dent on top of the arc bend (research rec). Would make fingers literally press dips into the cards. Deferred because it's unverifiable without a browser here.

The verification harnesses live in this session's scratchpad (`verifyHands.mjs`, `verifyOrient.mjs`, `verifyLesson.mjs`) — re-bundle with esbuild to re-run.

---

> ⚠️ **Everything below is the ORIGINAL session-1 handoff plus per-session logs, kept as history.** Much of it is superseded — in particular: the joint-pivot behavior was a bug (fixed in session 5), there IS now fingertip FK/IK + a contact system (`handKinematics.js`), grips are no longer wrist-only, all 11 techniques have hand choreography, and the harness is checked in (`npm run verify`). Read the session-5 section at the top for current architecture; the old "Known gaps" list no longer applies.

Context for the next session. This documents the **intent, current state, architecture, known gaps, and next steps** for the procedural 3D hands shown in the Learn (lesson) mode. Nothing here concerns the Visualizer flip or card art except where it overlaps.

> ⚠️ This environment has **no browser automation** — the 3D can't be visually verified here. Everything below about how the hands *look* is authored blind and needs the user's eyes (`npm run dev`, open **Learn → Riffle / Overhand**, play/scrub). Get screenshots before investing in fine pose tuning.

---

## Goal / design intent

Interactive shuffle teacher: for each technique, **two translucent stylized hands whose fingers genuinely curl and grip the deck**, keyed to each phase of the shuffle, so the learner sees *what the hands actually do*. Locked aesthetic decisions:

- **Translucent** gold-fresnel-rim hands (NOT opaque realistic skin).
- Fingers must **bend / wrap / grip** believably — this is the whole point ("really show the effect").
- Choreography is **per-technique, per-phase**, scrubbable both directions.

Scope for the first pass was **riffle + overhand only**; the other ~9 techniques reuse the rig later (Phase B).

---

## What is DONE (as of commit `9890a2a`)

1. **The rig is finally mounted and driven.** Previously `Hand.jsx` / `handRig.js` / `handRegistry.js` were **dead code — never rendered**. Lessons only showed two translucent spheres (palm ovals) from `guides.jsx`.
   - `LessonRunner.jsx` now renders `<Hand side="left" />` + `<Hand side="right" />` and, each frame, pushes the sampled hand poses to the rig: `getHand(side)?.setPose(scene.hands[side])`.
   - `setPose(null)` **hides** the hand (lessons/sides without authored hands don't leave a blob at the origin). Rig also starts `visible = false`.
   - The old palm-oval hints in `guides.jsx` (`updatePalm`, `palmMat`, `palmGeo`) were removed. Ghost cards / arrows / path traces stay.

2. **Rig upgraded for size + a thumb.** `handRig.js`:
   - `HAND_SCALE = 4.6` — the base rig was doll-sized (palm 0.11 vs a 0.63-wide card); now scaled to cradle a card. Left hand mirrors via negative `root.scale.x`.
   - Opacity bumped to `0.52` for visibility.
   - **Opposable thumb**: `THUMB_BASE_ROT = { z: 1.05, x: 0.35 }` tilts the thumb base across the palm so its curl presses toward the deck edge.

3. **Choreography exists for 2 lessons.**
   - `riffle.lesson.js` — already had per-step `hands` (split-grip → arch → bridge-release → square).
   - `overhand.lesson.js` — added hands to the peel/drop loop (`pinchCut` to peel, `overhandPull` to release).

---

## Architecture / data flow (read this before touching anything)

```
lesson.js  step.hands: { left:{from?,to}, right:{from?,to} }   // named pose presets
   │
   ▼
compileLesson.js → compileHandTracks()   // builds per-side interpolated pose tracks
   │                                     // (from/to resolved via getHandPose)
   ▼
player track.hands = { left:[segs], right:[segs] }
   │
   ▼  (each frame, LessonRunner useFrame)
sampleTrack.js → handFromSegments() → lerpHandPose()   // pose at current ms
   │
   ▼
getHand(side).setPose(pose)   // Hand.jsx handle
   │
   ▼
applyHandPose(rig, pose, side)   // handRig.js: writes wrist transform + per-finger joint angles
```

**Key point:** the compile/sample engine is generic and already supports scrubbing both directions. Improving the hands is almost entirely a matter of **better pose data + better rig geometry**, not engine changes.

### Files
| File | Role |
|---|---|
| `src/hands/handRig.js` | Builds the rig (palm + 5 fingers × 3 capsule joints), `applyHandPose`. **Rig geometry/scale/thumb live here.** |
| `src/hands/handPoses.js` | Named pose presets (`relaxed`, `twoHandsSupport`, `pinchCut`, `riffleArch`, `bridgeRelease`, `overhandPull`, `washFlat`, `fanSpread`, `springRelease`). `getHandPose(name, side)` applies `sideOffset` (±0.66) + mirrors for left. `lerpHandPose`. **Poses live here.** |
| `src/hands/Hand.jsx` | R3F component; registers `setPose` handle (null ⇒ hide). |
| `src/hands/handRegistry.js` | `registerHand`/`getHand` by side. |
| `src/lessons/engine/compileLesson.js` | `compileHandTracks` — turns `step.hands` into pose tracks. |
| `src/lessons/engine/sampleTrack.js` | `handFromSegments` — samples pose at `ms`. |
| `src/lessons/engine/LessonRunner.jsx` | Mounts + drives the hands. |
| `src/lessons/catalog/*.lesson.js` | Per-lesson `step.hands` declarations. |

A **pose** = `{ wrist: { pos: Vector3, quat: Quaternion }, fingers: { thumb/index/middle/ring/pinky: [prox, mid, dist] }, spread }`. Finger angles are local X-rotations (radians) per joint; `spread` scales knuckle splay.

---

## Known gaps / gotchas (the real TODO list)

1. **Placement is authored blind and is almost certainly off.** Wrist positions, curl amounts, and spreads have never been seen rendered. **First job: get user screenshots of riffle + overhand mid-shuffle and tune.**

2. **Hands don't align with the deck geometry.** Biggest concrete issue: in the riffle, the two half-decks sit at **x = ±1.0** (`twoHalvesLayout(dk, 1.0)`), but hand poses only offset **±0.66** (`getHandPose` `sideOffset`). So the hands don't sit at the halves they're supposedly holding. Options: parameterize wrist X per lesson/step, add riffle-specific poses, or make `sideOffset` context-aware.

3. **No contact / IK.** Poses are static presets; fingertips don't track actual card/packet positions. For a convincing grip you likely want the thumb + fingertips to be **placed relative to the live deck/packet transforms** (e.g., thumb at the near edge of each half during the riffle release, fingers under the packet during an overhand pull). The card positions are available (layouts / `cardRegistry`), so a pose could be computed from them rather than hard-coded.

4. **Wrist orientation assumes "hover above, point down."** `WRIST_DOWN` (−90° about X) points fingers downward; poses were built for hands floating above the deck. Cradling a deck **from the sides** (thumbs on top, fingers underneath) may need different wrist quaternions.

5. **Thumb opposability is approximate.** It's a base rotation (`THUMB_BASE_ROT`) plus the shared per-joint X-curl. A dedicated thumb curl axis / an extra joint would read better.

6. **Riffle release isn't synced to individual card interlace.** The `kind:'riffle'` step staggers card release over time (see `compileLesson.js` riffle branch), but the hands just ease to `bridgeRelease`. Ideally the thumbs "peel" in time with the cards leaving each half.

7. **Only 2 of 11 techniques have hands.** No hand data yet for: **hindu, faro, charlier, strip, wash, pile, pressureFan, spring, waterfall**. They currently render with hands hidden. Phase B = author `step.hands` for these (and add poses as needed: e.g., hindu top-grip + pull, faro two-hand square-and-weave, charlier one-handed cut, spring bow-and-release).

8. **`settings.showHands` is unused for lessons.** Hands are always shown in lesson mode right now. If a toggle is wanted, wire `useAppStore.settings.showHands` into the `<Hand>` mount / `setPose` path.

9. **Card-back orientation note (not hands, but adjacent):** face-down cards use `base·FLIP_Y` in the Visualizer but `RX_DOWN` (via `faceQuat`) in lessons, so the deco card back can appear 180°-rotated inside a lesson (invisible on the near-symmetric "S"/pattern). If it ever matters, add a per-mode back-texture compensation.

---

## Suggested next steps (in order)

1. Run `npm run dev`, open **Learn → Riffle Shuffle**, scrub through all 4 steps. Screenshot each phase. Do the same for **Overhand**. Share with the user.
2. Fix **scale + gross placement** first (hands the right size, roughly where hands go), then the **split-half alignment** (#2).
3. Tune **per-phase finger curls** so the grip/peel/release reads (edit poses in `handPoses.js`; add riffle/overhand-specific poses rather than overloading the generic ones).
4. If static poses still look "floaty," prototype **card-relative fingertip placement** (#3) for the riffle release — highest-impact "wow".
5. Only then extend to the other 9 techniques (Phase B).

## Verify
- `npm run lint` + `npm run build` must stay clean.
- Visual check is the user's — there is no headless 3D render here.

Related planning docs: `~/.claude/plans/swift-puzzling-map.md` (the 3-phase plan this work came from) and the `cardistry-3d-rebuild` memory.
