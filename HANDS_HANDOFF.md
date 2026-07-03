# 3D Hands for Shuffle Techniques — Handoff

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
