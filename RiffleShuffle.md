# Table riffle shuffle — reference and simulation notes

How a tabled riffle should look in Cardistry, grounded in frames from
[Table Riffle Shuffle Like A Card Dealer | Tutorial](https://www.youtube.com/watch?v=1hUnss6zG-4)
(E.S. Andrews). That is the same video already listed in
`scripts/inspect/refjobs.json`.

Screenshots live in [`riffle-screenshots/`](riffle-screenshots/). They are
third-party footage: review material only, gitignored, never commit them.
Regenerate with:

```bash
# ARM64 node — x64 Node + Rosetta Chrome will hang on YouTube
~/.nvm/versions/node/v20.20.2/bin/node scripts/inspect/refFrames.mjs \
  --video 1hUnss6zG-4 --label riffle \
  --times 30,45,55,65,75,85,95,105,115,120,130,140,150,155,160,165,170,180,190,200,210 \
  --out "$TMPDIR/cardistry-riffle-ref" \
  --chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

Lesson file: `src/lessons/catalog/riffle.lesson.js`.
Existing beats: `square → cut → address → bend → weave → push → rest`.

---

## Frame catalog

Times are seconds into the video. Files are named `0XXX_0s.png`.

### 30s — start

![30s ready](riffle-screenshots/0030_0s.png)

One squared landscape deck, face down, long edges toward/away from the
dealer. Hands come in from the dealer’s near side, not from far left/right.

### 45s — cut in progress

![45s cut](riffle-screenshots/0045_0s.png)

The right half is already in a table grip; the left half is still sliding
out. Halves stay on the felt. The cut is carried, not a self-splitting deck.

### 55s — reset / talking

![55s](riffle-screenshots/0055_0s.png)

Squared deck again, hands poised at the sides. Tutorial talking-head
between demos.

### 65s — ready, hovering

![65s](riffle-screenshots/0065_0s.png)

Same starting pose: one landscape block, hands in a loose C above the
short ends.

### 75s — hands contacting the squared deck

![75s approach](riffle-screenshots/0075_0s.png)

Hands approach the squared landscape deck from the sides and just make
contact. Footage order is: hands together over one deck, *then* the halves
are apart.

### 85s — hands behind the pack

![85s](riffle-screenshots/0085_0s.png)

Loose fists behind the deck, about to reach forward for the triangle grip.

### 95s — triangle grip on one deck

![95s triangle](riffle-screenshots/0095_0s.png)

Both hands sit on one still-squared landscape pack **before** the split.
Thumbs at the near long-edge corners. Index / middle / ring curl over the
far long edge. Pinkies brace the short ends. This is the tutorial’s
“form a triangle.”

### 105s — two halves, almost touching

![105s](riffle-screenshots/0105_0s.png)

Cut complete. Two landscape halves, inner corners almost touching, slight
V. Hands hover, not yet loaded.

### 115s — address, hands open

![115s](riffle-screenshots/0115_0s.png)

Same two-half layout; hands higher and more open before they sit down.

### 120s — address (the money grip)

![120s grip](riffle-screenshots/0120_0s.png)

Two halves, landscape, shallow V. Only the inner-near corners almost
touch. Fingers lie on the **tops** of the packets. Thumbs sit at the
**inner-near corners** (the weave junction). Card backs stay readable —
each hand covers maybe a third of its half.

### 130s — load the spring

![130s bend](riffle-screenshots/0130_0s.png)

Index curls onto the **top center** of each half and presses down. Thumbs
lift the inner corners about 1–2 cm. Outer edges stay on the felt. The
table is the other jaw of the clamp.

### 140s — peak tension

![140s](riffle-screenshots/0140_0s.png)

Thumbs meet tip-to-tip at the junction. Fingers run diagonally across the
backs, toward the gap. Pinkies pin the outer corners. Packets form a wide
inverted V (~100–120° between the long edges).

### 150s — weave starts

![150s](riffle-screenshots/0150_0s.png)

Cards beginning to interlace at the inner-bottom corners. Packets still
bowed. Index still the fulcrum. Clumps of 1–3, not a perfect zipper.

### 155s — weave mid

![155s](riffle-screenshots/0155_0s.png)

Thumbs walking up the inner edges, bleeding pressure. Cards fall at the
**corners only**. Released cards snap down onto the felt; they do not
fountain.

### 160s — still flexed

![160s](riffle-screenshots/0160_0s.png)

Hold / explain pose: both halves still arched, inner corners overlapping,
just before or during release.

### 165s — flex held

![165s](riffle-screenshots/0165_0s.png)

Same loaded pose. Index down in the top center; thumbs at the inner-near
corners; outer fingers wrapping the short ends.

### 170s — flex held

![170s](riffle-screenshots/0170_0s.png)

Repeat of the tension pose while the tutorial talks through index-down /
thumbs-up.

### 180s — interlaced V, still two packets

![180s](riffle-screenshots/0180_0s.png)

After the riffle the halves lie **flat** again. Only the inner corners are
woven, about 6–12 mm. The zipper of white edges is visible. Hands have
just let go and hover over the outer ends.

This pose is missing from the current lesson — it jumps from weave into a
single squared stack.

### 190s — second-pass riffle

![190s](riffle-screenshots/0190_0s.png)

Another riffle mid-release: bowed halves, corner zipper, thumbs as the
release.

### 200s — telescope / light bridge

![200s](riffle-screenshots/0200_0s.png)

Ring and middle fingers drive the packets together along their long axes.
The weave stays a tight zipper, not a fan. A slight arch is fine; a
waterfall cascade is not this shuffle.

### 210s — final square

![210s](riffle-screenshots/0210_0s.png)

Index fingers come in last and run the edges until the pack is one
landscape block, then rest.

---

## How the simulation should play

### Geometry that has to stay true

1. **Landscape, on the felt, face down.** Long axis left–right. Camera is
   dealer POV, about 50–60° down (`cameraPreset: 'riffleTable'`).
2. **Shallow dog-leg, not two parallel slabs.** Inner-near corners meet;
   outer ends stay apart under the hands. `YAW = 0.1` in the lesson is the
   right idea.
3. **Ends touch before anyone releases.** The weave happens at a contact
   point, not across a gap.
4. **Bend is local and small.** Inner corners up ~0.5–1 in; outers glued
   to the felt. Index down + thumbs up. Do not crease. `BEND = 0.8`
   already reads; do not go back toward a fountain (`arcLift` should stay
   tiny, like `0.04`).
5. **Thumbs own the inner-near corners.** That is the release mechanism.
   The current lesson put thumbs on the **outer** ends so the hands
   wouldn’t collide. Footage does the opposite: thumbs live at the
   junction, fingers on top, table underneath. `tableTopGrip` is the
   right vocabulary; a two-jaw pinch is not.
6. **Hands approach from the dealer, on top of their own half.** Not from
   the left and right wings with fingers plastered across the faces.
7. **Cover about a third of each half.** If an x-ray shader is required
   to see the cards, the hands are too big or too centered.

### Card motion, beat by beat

**Square (~0.8s)**  
One landscape stack at table center. Hands can rest off to the dealer’s
near side or start walking in. No grip yet.

**Cut (~1.0s)**  
Hands arrive **together** over the squared deck (95s), then each carries
its half out. Soft cut is fine (24/28), but keep both packets as rigid
slabs while they travel. They land 4–6 cm apart, still landscape, still
flat.

**Address (~0.9s)**  
Halves close until inner-near corners kiss, with the shallow V. Grip
captures here:

- thumb = inner-near corner
- index = top-center fulcrum
- middle + ring = outer short end / far long edge
- pinky = outer-corner brace

Pressure is light (`SQUEEZE` around 0.12). Backs stay visible.

**Bend (~1.1s)**  
Only the **cards** bow, along the short-end axis. Packet rides a fraction
of that rise (`bendGain` 0.25 is right — the bowed packet sits on its
ends). Hands do not mime a bow in empty air. Hold the loaded pose so it
reads.

**Weave (~2.1s)**  
This is the whole trick.

- Release is a **thumb ratchet**, not a lerp from closed to open. First
  card is sticky; the last few dump. The two thumbs are not in lockstep —
  let the right half finish a little early (different `W` / `POW` per
  hand, already authored).
- Cards leave **one at a time** over the first ~55% of the beat. Each
  card’s flight is short, low, and mostly downward. `midBend` is leftover
  spring straightening (~0.35), not a mid-air arch.
- Interlace is **corner-only**. Landing pose is the 180s frame: two flat
  packets in a V, woven 6–12 mm at the inner corners. Do **not** animate
  cards into a single squared stack during this beat.
- Order is **Gilbert–Shannon–Reeds** (`gsrRiffleOrder`), not a perfect
  faro. Clumps of 2–4 from one side, then the other. That clumping *is*
  the randomization; strict L-R-L-R is a faro and looks fake.
- Unreleased cards must **thin toward the junction**. A full-size leftover
  half sitting on its original footprint is why cards currently ghost
  through each other. The hands rise only as much as the growing weave
  needs — they follow the thinning packets; they do not levitate.

**Push (~0.8s)**  
Ring + middle fingers telescope the halves inward until almost flush, not
slammed. Thumbs walk the near long edge to keep it square. This is a slide
along the card plane, `snapEase` / short settle. Optional tiny arch. No
cascade.

**Rest (~0.9s)**  
Index fingers run the short ends for the last square (210s). Hands lift
**out and up** first so they don’t sweep through the pack, then park
off-camera or at the dealer’s near edge. Camera can widen to overview.

### Timing (one shuffle, ~7.5–8s)

| Beat    | Feel                                      |
| ------- | ----------------------------------------- |
| Square  | Ease in — let the table read              |
| Cut     | Hands first, then packets                 |
| Address | Ease out — stop dead when corners touch   |
| Bend    | Ease in-out — load, don’t snap            |
| Weave   | Ease out — clicks, then a dump            |
| Push    | Fast settle                               |
| Rest    | Hands leave, deck stays                   |

A real dealer riffle is about 2 seconds of release. The lesson’s 2.1s
weave is the right length if the **cards** do the work and the hands only
ratchet.

### What “good” looks like vs “off”

**Good:** two slabs on felt → shallow V → small inner-corner bow → zipper
at the corners → flat interlaced V → telescope to square.

**Off:** in-air fountain, perfect 1-for-1 weave, wide fan, hands coming
from the wings, thumbs on the outer ends, halves jumping from “still two
packets” to “already one stack,” or a Charlier-style waterfall finish.

---

## What the current lesson already gets vs what’s still off

Already in good shape:

- Table riffle, not in-hands
- Landscape halves, `YAW` dog-leg, `tableTopGrip`
- GSR order instead of perfect faro
- Ratcheting thumbs, asymmetric drain
- Low `arcLift`, modest `BEND`
- Hands rise during the weave

Still wrong against this footage:

- Thumbs authored on the **outer** ends (footage: inner-near corners)
- Hands still tend to arrive from the sides
- Weave lands in a single `landscapeStackLayout` — missing the 180s
  interlaced-V intermediate
- Cut is ungripped (deck splits itself) because two pinches on a stacked
  deck interpenetrate; a real table riffle uses the felt as the second jaw
- No dedicated telescope: interlace then jump to squared
- Weave can still splay wider than a card-thickness corner lock
- Unreleased halves stay full-size (compiler needs a thinning packet)

The root cause recorded in `TECHNIQUE_REFERENCE.md` still holds: a tabled
riffle is not a two-jaw pinch. Fingers press the top face down, the thumb
levers the inner end up, and **the table is the opposing jaw**.

---

## Tutorial transcript (what he actually says to do)

1. Split the deck as close to 26/26 as you can (off by two or three is
   fine).
2. Form a triangle with the hands; flip the packets into a V.
3. Index fingers bend the cards a little inward (pressure down). Thumbs
   push up. That tension is the shuffle.
4. Move both thumbs upward slowly, releasing the pressure. Card tips
   interlace and weave together.
5. Square with the ring fingers (and middle) pushing the packets in, then
   the thumbs, then finally the index fingers running the edges.

Amateur in-hands waterfall riffle is explicitly the thing **not** to
simulate.

---

## Sources

- [Table Riffle Shuffle Like A Card Dealer | Tutorial](https://www.youtube.com/watch?v=1hUnss6zG-4)
- `scripts/inspect/refjobs.json` (video `1hUnss6zG-4`, official times 30 /
  55 / 75 / 95 / 120 / 150)
- `src/lessons/catalog/riffle.lesson.js`
- `TECHNIQUE_REFERENCE.md` (tabled riffle section)
- [The Riffle Shuffle — Robert J Wallace (Royal Road)](https://robertjwallace.com/royalroad/the-riffle-shuffle/)

---

## Post-implementation corrections (measured)

The "Still wrong against this footage" list above has been worked. Three of its claims
are now out of date, and two more turned out to be wrong on measurement:

- **Thumbs are now at the inner-near corners**, and that was the fix for the user's
  "the thumbs are interweaved" — they had been crossing in an X, not merely touching.
- **The 180s interlaced-V now exists** as a `telescope` beat. The lesson no longer jumps
  from weave to a squared stack.
- **`tableGrip` is NOT "the closer vocabulary"** — `tableTopGrip` was written for this and
  is what the lesson uses.
- **"The row spans the WIDTH" was wrong.** The finger row runs along the packet's
  LENGTH: measured 4–13mm from target that way against 37–44mm across the width.
- **The cut still cannot be gripped**, and the reason is not the pinch's wrap. Two hands
  cannot share one deck's centre line on this rig at all, because the thumb MCP sits a
  fixed 0.505 inboard of the palm centre (see ARCHITECTURE). So the footage's 95s
  "both hands on one squared pack" is unreachable, and no grip vocabulary fixes it.

Where it landed: contact 90% of 502, penetration 0.8 card thicknesses, pierced 0,
card-vs-card 471 pair-frames at 6.1 cards (was 12.2), hand-vs-hand +6.4mm clear (was
25mm of palm INSIDE palm), thumb tips 23mm apart which reads tip-to-tip at 7.5mm radii.

Still open, both needing engine work rather than authoring:
1. **The thinning packet.** All 471 remaining card-vs-card pair-frames are in `weave`,
   because an un-released card keeps its full footprint at its half's station while the
   woven pile grows underneath it. The interlaced-V landing halved the depth; only a
   draining half that shrinks toward the junction removes it.
2. **A contact target on a packet's outer SHORT END.** `tableTopGrip` can only aim pads
   at the top face and the near long edge, so `telescope` is driven by a thumb on the
   near edge instead of ring+middle wrapping the outer end the way 200s shows. Worth
   ~420 causality samples.
