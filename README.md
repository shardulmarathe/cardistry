# Cardistry

An interactive 3D card table and shuffle trainer. Spread a real 52-card deck into
six layouts, or step through guided, scrubbable 3D lessons for the classic
shuffles, riffle, overhand, hindu, faro, charlier, strip and wash.

**[Live demo →](https://cardistrycards.vercel.app)**

Built with React 19, Vite and react-three-fiber.

## What makes it interesting

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
headless harness that scores every lesson on two opposing metrics, how much of
each fingertip is genuinely in contact with the cards, and how far any finger
penetrates a card surface. Both are ratchets: contact may only go up, penetration
only down. A lesson whose hands stop touching the cards fails the check rather
than silently regressing to a hover.

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
