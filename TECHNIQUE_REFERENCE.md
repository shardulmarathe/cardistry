# Technique Reference

What each technique in the catalog actually looks like in a real pair of hands, and
where the current implementation departs from it. Written because the hands read
as wrong and "it looks off" is not something you can act on — this file turns it
into per-finger claims you can author against and check.

Sources are listed at the bottom. Video frames were sampled from tutorial footage
(paused at specific timestamps) rather than described from memory.

---

## THE ROOT ERROR: face grips instead of edge grips

This is the single most important finding and it affects every lesson.

Every grip in this catalog is authored as **pads pressing on a card's broad
face**, aimed with `surfaceContact(card, { finger, face: '+y', u, v })` at the
card's top or end plane, and the hand approaching from above. Real card grips are
almost the opposite: **the hand sits behind or below the deck and clamps its
PERIMETER**, thumb on one long edge, fingers wrapped around the other, index
curled over the short end.

The reference frame that makes it unambiguous is a straddle grip held to camera:
the deck's face is *completely unobscured*, the thumb pad is on the near long
edge, the index is curled over the top short end, and the middle/ring/pinky lie
along the far long edge with only their tips cresting it. The hand is a **C-clamp
around the deck's rim**, not a paw on its face.

Three consequences follow, and they explain nearly everything the user has been
looking at:

1. **The hands hover.** A pad aimed at a broad face can only ever rest *on top*
   of the deck, so the only way to avoid burying it is air. An edge grip has the
   card between opposing fingers, so contact is enforced by the geometry rather
   than negotiated against it. This is why `CONTACT_FLOOR` has been such a fight.
2. **The hands hide the cards.** Face contact puts hand mass between the camera
   and the thing being taught, which is why `handRig.js` needs an entire x-ray
   shader to see through it. Edge grips leave the faces clear for free.
3. **The fingers splay.** With nothing to wrap, the solved poses fan out into the
   rake of near-vertical columns visible in the riffle bridge. Real gripping
   fingers are held *together* and curled; only the thumb is truly independent.

**The fix is not more tuning of the existing grips.** It is a contact vocabulary
that aims at edges, with the wrist placed behind the deck rather than above it.

### `straddleGrip` — built, and NOT yet validated (see the correction below)

`straddleGrip` in `authoring/contacts.js` is that vocabulary, plus a `straddle`
entry in `GRIP_FRAME_TYPES`. Three things came out of building it that are worth
keeping:

**Only two fingers are real fingertip contacts.** Thumb on the near long edge,
index over the far short end, and the **palm carries the bottom face**. Middle,
ring and pinky lie *along* the far long edge and touch it with their **lateral
surfaces** — their tips are past the edge and touch nothing. Aiming their tips at
that edge asks for a motion this rig does not have (the pad would have to travel
sideways while a curl sweeps in a fixed plane) and the solver says so: measured
plane errors of 0.18, 0.41 and 0.65, up to a whole card width of unreachable
demand. So the `straddle` frame scores **thumb and index only**. A metric that
demands five pads on the deck is asking for a grip no hand uses — which is part
of why `CONTACT_FLOOR` has been such a fight.

**A wrist ROLL is the degree of freedom that makes it work.** With the palm flat
under the deck, both pads reach their targets and the thumb's *proximal capsule
still sits 4.2mm inside the cards* — and `resolvePenetration` cannot fix that,
because it scales curl and a thumb base is placed by the wrist. Rolling the palm
brings the thumb around the near edge from outside, the way a real thumb clears it.

### CORRECTION: the straddle is NOT validated on real lesson geometry

Earlier numbers here claimed the straddle beat the face grip on charlier geometry
(60% -> 100% contact, 0.0000 deep). **That was measured two ways that both
flattered it**, and both are now fixed:

- **The reach gate was blind to sideways misses.** It read `solveFingerTo().error`,
  the in-plane residual, and ignored `planeError` — the component a fixed curl
  plane can never reach. A pad 0.09 to the side of its target reported a reach of
  0.0000, so every placement in the sweep looked equally reachable and the sweep
  ranked on contact alone. Both builders now gate on `hypot(error, planeError)`.
- **Depth was scored after `resolvePenetration`**, which drives depth to ~0 by
  construction. A placement that only worked because the backoff dragged a finger
  out of the deck scored identically to one that was never in it — and the
  backoff's bill is paid in pads, since it scales curl. Placements are now scored
  as-solved.

Re-measured honestly on charlier's own deck: **60% -> 50% contact, 0.0000 ->
0.1190 deep.** The straddle is currently WORSE than the face grip it was meant to
replace. It still measures 2/2 pads and 0.0000 on the synthetic probe deck, which
is precisely the point: passing one hand-picked station is not validation.

**The likely cause is known**, from the pinch work below: the straddle is
**palm-UP**, and a palm-up thumb curls toward the palm, so it can only reach
targets above its knuckle — which forces the knuckle row below the deck's top face
and makes the other fingers arrive steeply. Swept over 23,100 palm-up placements
for the pinch, the best index penetration anywhere was 0.0335, half a pad radius.
Palm-DOWN fixed the pinch outright. The straddle very likely needs the same
inversion and a re-sweep. Until then, treat the straddle as unproven.

### `edgePinchGrip` IS validated: 18/18 stations

The pinch — thumb and middle as opposing pads, index on the top face as a
stabiliser, ring and pinky free — is finished and measured across a 52-card deck,
a 20-card block and an 8-card packet, at squeezes 0 / 0.3 / 0.55, on BOTH axes:

| axis | station | reach | pads | deepest |
|---|---|---|---|---|
| long | all three | <= 0.0011 | 3/3 | 0.0000 |
| end | all three | <= 0.0013 | 3/3 | 0.0000 |

Every gap is 0.0153-0.0172, which is `CONTACT_AIR` and nothing else, so
`resolvePenetration` has nothing to do at any of the eighteen. The placement is
squeeze-independent. Four causes were fixed to get there, beyond the two scoring
bugs above:

- **Palm-DOWN, not palm-up** (the wall described above). This is also what hindu's
  holding hand actually is, and what `tableGrip` already used.
- **Pads were aimed at the deck's middle**, which drags the hand in after them and
  parks the knuckle row inside the deck footprint — the index's proximal capsule
  sat 0.09 inside the cards at every cell of the old grid. Pads are now derived
  from their own knuckles.
- **The thumb's `squeezeAir` reservation was swept for the carried `packet`
  frame**, and charged a pinch 0.057 of air at squeeze 0.3 — authoring the pad off
  the very edge it was pinching, with the anchor derived from that same target so
  no placement could recover it. A pinch needs no reservation: opposing pads are
  stopped by the cards.

The probe also now checks **which face each pad is on**, not just its distance:
`tipGap` measures the nearest card and does not care which side, which is how the
old placer scored a finger lying on the deck's *back* as a pad in contact. That
check caught two false passes.

`axis: 'end'` is what an in-hands riffle needs (each half held by its short ends),
so the riffle rebuild is unblocked on the pinch even though the straddle is not.

**But the pinch is only solved in the CANONICAL card frame, and the riffle's halves
are yawed.** Measured on a 26-card half in the air, axis `end`:

| packet orientation | reach | pads |
|---|---|---|
| canonical portrait (the validated frame) | 0.0004 | 3/3 |
| + a roll about world Z (the thumb tilt) | 0.0006 | 3/3 |
| yawed 90deg about world Y (a riffle half) | **0.3429** | 2/3 |
| yawed + rolled | **0.4359** | 2/3 |

A roll is harmless; a YAW is not. The hand placement is expressed in world axes, so
a yaw about Y decouples the hand from the card and the pads miss by a third to a
half of a card. Naively pointing the pinch at a riffle half would produce exactly
the silent failure the new reach gate exists to catch.

**The fix is a rigid transform, and it is verified:** solve in the canonical frame,
then rotate the SOLVED hand and its packet together about world Y. This is the same
trick `tableGrip`'s `tilt` uses ("TILT MOVES THE SOLVED HAND, it does not re-solve
it"). Measured at yaws of 0, 0.79, 1.35 and 1.57 rad, the pad gaps are IDENTICAL
(0.0168 / 0.0165 / 0.0165) and 3/3 throughout — a rigid transform preserves a rigid
grip exactly.

**The open question is the LEFT hand**, and the codebase already documents the trap:
`grips.js` mirrors a grip frame's POSITION but not its QUATERNION, so a rotation
applied to a left-hand grip turns the hand one way on screen and the packet it is
holding the other — tableGrip records a 2x error from precisely this, putting 0.17
of finger inside the riffle's own halves. The riffle needs both hands, so resolving
that mirror behaviour is the first task of the rebuild, not an afterthought.

### Two open measurement problems, both flagged and neither fixed

- **`PRESSURE_CURL` (0.14 rad) moves a pad ~0.05 world at full squeeze**, twice the
  0.025 band anything can call contact. On the solved pinch the squeezed pose (what
  actually renders) grazes 0.000 at squeeze 0, 0.0155 at 0.3 and 0.042 at 0.55,
  always the thumb's distal. Softening the `pinch` frame's pressure weights helps;
  a lesson wanting a hard squeeze must price the graze the way charlier's
  `THUMB_GRAZE` does.
- ~~`cardDepth` measures depth past the nearest face plane~~ **FIXED.** The rule
  was `min(-ex,-eu,-en) + r`, correct only for a centre inside the shell or outside
  across ONE axis. Outside across two — an EDGE — it billed `r - max(ex,eu)` where
  the truth is `r - hypot(ex,eu)`, so it over-charged precisely the edge contacts
  the new grip vocabulary is built on, and `resolvePenetration` acted on the same
  wrong number and backed fingers off edges harder than the geometry warranted.
  Both sites were fixed together (they must agree or the harness and the authoring
  pass disagree about what "touching" means). Effect: overhand's worst contact went
  **0.0201 -> 0.0079**, and all three raised budgets ratcheted down (overhand 0.021
  -> 0.009, charlier 0.02 -> 0.017, riffle 0.025 -> 0.021). Charlier and riffle's
  own worst contacts did not move, which is the expected signature: theirs are
  face-region contacts, outside across a single axis, where the old rule was right.

**No lesson uses it yet, and picking the first adopter took some elimination:**

- **Charlier** looked obvious (straddle is its documented grip) but one of its two
  carry stations holds the deck **on the felt** at y=0.02, and you cannot get a
  palm under that — a straddle is physically wrong there. Its cut beats already
  use a palm cradle, which is the straddle-ish part.
- **Waterfall** is the textbook straddle ("bend the deck between thumb and fingers
  into a U") and holds in the air, but it has its own `bowCage` solver working
  against **bowed** geometry, which `straddleGrip` does not model. Extending it to
  arcs is a prerequisite.
- **Strip** has the best case for it — a flat block carried in the air, the worst
  contact of any in-air hold (27%, median gap 0.082) — but it builds its poses
  through a local `layOn` face-grip helper feeding a chain of translated stations.

All three are lesson re-authors rather than swaps, which is why the work stopped
at making the vocabulary robust enough that the next one is cheap.

### `edgePinchGrip` — the OTHER edge grip, work in progress

Strip looked like the straddle's first adopter until the technique said otherwise:
a **strip/running cut holds the deck in an END GRIP**, and hindu's holding hand is
a **long-edge pinch** ("middle finger on one long edge and the thumb on the
other"), with the receiving hand taking the deck "by its sides between the top
joints of the thumb and second finger, the forefinger resting on the top". None of
those is a straddle. Forcing strip into one would have swapped a wrong grip for a
different wrong grip.

So `edgePinchGrip` holds the deck **between two opposing pads** — thumb on one
long edge, middle on the other, index laid on the top face to stop it pivoting —
with ring and pinky free, exactly as the sources say ("the third and fourth
fingers resting free"). Unlike the straddle's far long edge, opposing pads ARE
reachable: they face each other across the deck's width, so each arrives along its
own curl plane.

Measured, self-placing, per station:

| station | reach | pads | deepest | thumb / middle / index gaps |
|---|---|---|---|---|
| 52-card deck, squeeze 0.3 | 0.0000 | 2/3 | 0.0000 | 0.001 / 0.012 / 0.173 |
| 20-card block, squeeze 0.3 | 0.0000 | 1/3 | 0.0000 | 0.174 / 0.026 / 0.010 |
| 8-card packet, squeeze 0.5 | 0.0000 | 2/3 | 0.0000 | 0.175 / 0.017 / 0.007 |

**The pinch itself works on a full deck** — thumb 0.001 and middle 0.012 is a
genuine opposing pinch, which is the hard part. Two things are unfinished: the
index target on the top face competes with the pinch on a thick deck (0.173 off),
and the thumb loses its edge on thin packets, because `resolvePenetration` backs it
off after the solve rather than the placement being wrong (reach is 0.0000 in every
row). The straddle is done; this one is not. Do not adopt it in a lesson yet.

A bug worth remembering, which affected both grips: **on a long-edge (±x) face the
along-deck axis is `u`, not `v`.** `FACE_UV` maps ±x to u = the long axis and
v = the card NORMAL, so a `v` offset there moves by a fraction of a card
*thickness* — 0.003 units, i.e. nothing. Both grips were written with `v` and were
silently pinning every edge contact to the middle of the deck.

---

## Per technique

Card orientation below is stated as *portrait* (short ends toward/away from the
dealer) or *landscape* (long edges toward/away).

### Riffle (tabled) — `riffle.lesson.js`

The catalog's flagship, and the one the user singled out.

**Real mechanics.** Cut the deck into two halves and set them **landscape, inner
short ends facing each other and touching**. Each hand takes its own half:
*thumb at the inner-near corner*, on the short end nearest the other half;
*index finger curled on top* of the packet; *middle and ring along the outer
short end*, holding the packet down by the **backs of the first and second
fingers**. The thumbs bend their inner ends **up**, storing spring. Then both
thumbs *release progressively* and the corners interlace — the halves are slid
**closer together as the cards fall** so they interlock rather than land beside
each other. Finished by seizing the outer ends between thumb and index+middle and
**telescoping the halves inward** until nearly flush, then the bridge.

**What the app gets wrong.**
- ~~Halves 0.12 apart, so the interlace happened across a gap.~~ **Fixed**: `G` is
  now derived so the inner ends meet with a hair of overlap.
- Thumbs are not on the inner-near corners. The bend beat bows the halves, but no
  thumb is visibly the *cause*, which is the whole pedagogical point of the beat.
- Fingers form a splayed rake above the packets instead of the backs of the index
  and middle lying **across** them.
- No telescoping beat: the halves interlace and then jump to squared.
- The weave fans far wider than life. Real interlaced cards stay near-parallel,
  offset by about a card thickness at the corner; the app splays them into two
  arcs.

### Riffle (in the hands) — not in the catalog

Worth noting as a possible addition, because it is the version most people mean.
Held in two hands, the packets are gripped at the short ends, thumbs on the inner
top corners, and the card visibly **bends tightly around the thumb pad** as it
springs off — a local crease radius at the contact point, not the uniform arc the
`bend` shader applies across the whole card. If in-hands riffle is ever added,
the bend shader needs a localised variant.

### Faro — `faro.lesson.js`

**Real mechanics.** Halves held one per hand, **thumbs on the inner edges,
fingers on the outer edges**. The corners of the two halves are brought **into
contact first**, then *light, even thumb pressure* starts the interlace. Pressure
is applied **top and bottom** to keep the weave one-for-one; the packets are
rotated very slightly inward as they mesh. Then squared.

The captured frames show it precisely: the two thin slabs meet **corner to
corner at a shallow angle** — a dog-leg, not two parallel packets — with
**fingertip pads flat against the outer faces**, fingers held together. The weave
itself is a fine, tight zipper: cards stay nearly parallel, splaying maybe 10–15°.

**What the app gets wrong.** The halves meet parallel rather than at the shallow
angle; the weave splays much wider than 15°; contact is by splayed columns rather
than pads flat on the outer faces. Faro's measured contact (52%) is the least bad
in the catalog, so this one is mostly about the *weave geometry*, not the grip.

### Overhand — `overhand.lesson.js`

**Real mechanics.** Deck held in one hand. The other hand **grasps most of the
pack from the bottom, between thumb and fingers**, and lifts it clear of the
small group left behind. Packets are then **released from that hand a few at a
time onto the accumulating pile**. The receiving hand's **pinky and index cradle
the pile** to keep it square; the ring finger supports.

Note the direction: cards are *released downward from the lifted mass* onto the
pile, not *peeled upward off a static deck*. The app's own header comment already
concedes the thumb cannot do the peel on this rig, which is why it uses
`fingerDraw`. The research says the peel is not the move anyway — **the grasp-
and-release is** — so `fingerDraw` may be solving the wrong problem.

**What the app gets wrong.** 4% contact — it visibly hovers. The receiving hand
does not cradle with pinky and index. The stroke models a top-peel rather than a
bottom-grasp-and-release.

### Hindu — `hindu.lesson.js`

**Real mechanics.** Deck held **face down, middle finger on one long edge and
thumb on the other** — an edge grip, explicitly. The other hand takes the
**inner end of the deck by its sides, between the top joints of thumb and second
finger, forefinger resting on top**, third and fourth free. The holding hand
moves outward, **stripping cards from the top**, which then **fall into the
palm** — and the **index finger of the receiving hand is what stops them
escaping**. The fingers form a *trap*.

**What the app gets wrong.** Reads as two large hands with cards suspended
between them. No index-finger trap. The grips are face-aimed rather than the
explicit long-edge thumb/middle pinch the sources describe.

### Strip / running cuts — `strip.lesson.js`

**Real mechanics.** A strip is "quickly moving cards from the centre of the deck
to the top" — i.e. a cut. Running cuts: the deck is **held in the air**, a portion
is cut from the top and placed on the table, then further portions on top of that,
3–8 times.

**What the app gets wrong.** Mostly a framing/contact problem rather than a
mechanics one. Median gap improved to 0.082 but the count is only 27%.

### Wash — `wash.lesson.js`

**Real mechanics.** Cards spread face down **in two rows**, then slid around
**in a circular motion, periodically and randomly changing direction** —
clockwise, counter-clockwise, away, toward. Casino procedure: circles for **at
least 5 seconds**, hands lifted away, repeated **at least 3 times**.

**What the app gets wrong.** Hands enter from **left and right like wipers**;
real wash comes from the near side, palms down. The spread is a tight overlapping
blob rather than two rows over a wide area. No lift-and-repeat structure. This is
the closest lesson to correct and the cheapest to finish.

### Charlier cut — `charlier.lesson.js`

**Real mechanics.** Deck in **straddle grip** (the frame described at the top of
this file). **Thumb pressure is released** so a packet falls from the *bottom* of
the deck into the palm. The **index finger curls in and pushes that bottom packet
upward** past the thumb until its edge is higher than the main deck's. The main
deck then falls onto the lower half of the hand and the raised packet lands on
top of it. Sources differ on whether the index, middle, or ring drives the push —
which means it is genuinely a hand-size-dependent detail, not a fact to nail.

**What the app gets wrong.** Packets float in clear air above the hand rather
than sitting *in* the palm in straddle grip. Contact is the best in the catalog
(69%) but the *staging* is wrong: there is no straddle grip and no palm to fall
into.

### Waterfall / spring — `waterfall.lesson.js`, `springPrimer.lesson.js`

**Real mechanics.** **Straddle grip**, deck **bent between thumb and fingers into
a U**. Pressure is released *slowly from the fingers* so the cards cascade into
the other palm. During the cascade: **slight upward pressure from the thumb and
slight downward pressure from the curled index**. The catching hand forms a
"landing pad with a cage" — a modified dealer's grip, described as a tiger's claw.

**What the app gets wrong.** Best contact in the catalog (85%) and the arch reads
well. The catching hand is not a cage. The release is finger-driven in life; check
whether the app drives it from the thumb.

---

## Priority order

Ranked by visual payoff per unit of work:

1. **Add an edge-grip vocabulary to `contacts.js`** and re-author the straddle
   grip on top of it. It is the shared foundation for charlier, waterfall, hindu
   and the in-hands family, and it is the fix for the hover, the splay and the
   occlusion at once.
2. **Riffle: thumbs on the inner-near corners, index/middle backs across the
   packets, plus a telescoping beat.** The flagship, and the user's specific
   complaint.
3. **Tighten every weave.** Interlaced cards should stay within ~15° of parallel
   and offset by about a card thickness. Applies to riffle and faro.
4. **Wash: hands from the near side, two rows, wider spread, lift-and-repeat.**
   Cheapest correctness win in the catalog.
5. **Overhand: re-model as bottom-grasp-and-release** with a pinky/index cradle,
   rather than a top peel. Also the last remaining hover.
6. **Hindu: long-edge thumb/middle pinch and an index-finger trap.**

## Sources

- [Shuffling — Wikipedia](https://en.wikipedia.org/wiki/Shuffling)
- [Faro shuffle — Wikipedia](https://en.wikipedia.org/wiki/Faro_shuffle)
- [The Riffle Shuffle — Robert J Wallace (Royal Road)](https://robertjwallace.com/royalroad/the-riffle-shuffle/)
- [The Overhand Shuffle, II — Robert J Wallace](https://robertjwallace.com/royalroad/the-overhand-shuffle-ii/)
- [The Hindu Shuffle and Other Controls — Robert J Wallace](https://robertjwallace.com/royalroad/chapter-xv-the-hindu-shuffle-and-other-controls/)
- [How to Learn the Faro Shuffle — Ambitious With Cards](https://ambitiouswithcards.com/how-to-learn-the-faro-shuffle-step-by-step-guide/)
- [Charlier Cut — Magicpedia](https://wiki.geniimagazine.com/index.php?title=Charlier_Cut)
- [Charlier Cut (Easy One-Handed Shuffle) — How to Shuffle Cards](http://howtoshufflecards.com/2018/07/19/charlier-cut-easy-one-handed-shuffle/)
- [Master the Waterfall Card Flourish](https://victoire.online/blog/master-the-waterfall-card-flourish)
- [How to Perform the Card Spring — Joker and the Thief](https://jokerandthethief.com/blogs/learn/how-to-perform-the-card-spring)
- [Washing a deck of cards — Denexa Games](https://www.denexa.com/blog/washing-deck-cards/)
- [How to shuffle the casino way — Denexa Games](https://www.denexa.com/blog/how-to-shuffle-the-casino-way/)
- [How to Shuffle the Cards — catsatcards.com](http://catsatcards.com/Articles/HowToShuffle.htm)
- [Manual Card Shuffling Methods — Shuffle Tech](https://shuffletech.com/card-shuffling-methods-types-techniques/)
- Video: Jason Parker, *the perfect faro shuffle* (frames at 0:95, 1:58, 5:00)
- Video: Jason Parker, *Riffle Shuffle with Bridge in the hands*
