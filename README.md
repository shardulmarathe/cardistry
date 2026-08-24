# Cardistry

An interactive 3D card table and shuffle trainer. Spread a real 52-card deck into
six layouts, or watch scrubbable 3D lessons for four shuffles chosen to be as
different from one another as possible: the table riffle, the overhand, the
charlier cut and the card wash. Both tabs hold the SAME deck — reorder or flip
cards in the visualizer and Learn shuffles that deck; finish a shuffle and the
visualizer lays out the result.

**[Live demo →](https://cardistrycards.vercel.app)**

Built with React 19, Vite and react-three-fiber.

## What makes it interesting

**It shows you how well each shuffle actually mixes.** The deck's order is read
back out of the compiled track — a squared stack is sorted by height — and scored
two ways: rising sequences (1 is untouched, ~26 is random for 52 cards) and how
many originally-adjacent pairs are still adjacent. So the claims are checkable
rather than asserted: one wash reads 24 of 26 with 6% of neighbours kept, one
overhand reads 4 with 94% kept, and a charlier cut reads 2 with 98% — which is
what a cut is. Repeat a technique and the tally accumulates, which is the
~7-riffles result as something you watch happen.

**Every lesson is a pure function of time.** A lesson definition compiles once
into a deterministic keyframe track, which is then sampled by a pure
`(track, ms) → poses` function. Scrubbing backward and forward lands on
identical frames, so the timeline can be dragged in either direction without
drift or re-simulation.

**The hands are finger-driven, not arm-driven.** Cards are moved by fingertip
contact frames rather than being parented to a wrist that waves over the table.
Each held packet rides a solved grip, with per-card release timing, so a riffle
actually looks like fingers bridging and releasing a cascade.

**Card faces are generated at runtime.** All 52 faces are drawn to canvas
textures on load; there are no image assets for card fronts. Bending is a
vertex-shader effect (`onBeforeCompile`, `uBend`) over one shared segmented
geometry.

**Contact and penetration are measured, not eyeballed.** `npm run verify` runs a
headless harness (~336k assertions, no browser and no WebGL) that scores every
lesson on opposing metrics: how much of each gripping surface is genuinely in
contact with the cards, and how far any finger penetrates a card surface. Having
both means a lesson cannot pass the penetration check by simply hovering above the
deck. Penetration only ratchets down; the contact floor only ratchets up, and any
change to either is argued at the entry.

**Cards pierced** is a hard gate at zero, and it exists because the penetration
number saturates: once a capsule centre reaches a card, the depth reading pins and
stops responding to anything you change. It is the only one of the three that is
monotone and unbounded, and it has already caught a change that every other metric
scored as an improvement.

Read the contact percentage next to the `scored on [...]` list printed beside it.
A grip declares which surfaces are actually on the cards, so the percentage can be
raised either by putting a hand where it belongs or by scoring fewer surfaces — and
only the first is worth having. See `ARCHITECTURE.md` before trusting any of these
numbers.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run verify   # determinism, FK parity, contact + penetration budgets
npm run lint
npm run build
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the data-flow rules, the module map,
and the non-obvious invariants worth knowing before changing the engine.

## Stack

React 19 · Vite · three.js · @react-three/fiber · @react-three/drei ·
@react-three/rapier · zustand · framer-motion

Deployed on Vercel.
