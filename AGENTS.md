# cardistry

An interactive 3D card table and shuffle trainer. Spread a real 52-card deck into six layouts, or
scrub through 3D lessons for four deliberately dissimilar shuffles (table riffle, overhand, …).

## Verify
```bash
npm run lint       # eslint .
npm run verify     # the real gate — see below
npm run build      # vite build
```
`npm run verify` is **not** vitest. It is a bespoke harness:
`node --import ./scripts/verify/register.mjs scripts/verify/fkParity.test.mjs && … verifyTracks.mjs`.
Run it through `npm run verify`; invoking vitest here does nothing.
**There is no typecheck script** (the source is `.jsx`/`.js`, not TypeScript).

## Layout
- `src/card/`, `src/hands/`, `src/lessons/` — deck model, hand rig, lesson tracks.
- `scripts/verify/` — the parity harness. Treat it as the spec, not as tests.
- `src/devBridge.js` — dev-only surface. Don't wire product behaviour through it.

## Invariants
- **`fkParity` must hold: the pure FK module (`handKinematics.js`) must agree with the real
  scene-graph rig (`handRig.js`) to `<1e-6`, for every preset and a sweep of randomized poses, on
  both hands.** This is the guard that makes blind authoring safe — if it passes, compile-time
  contact math is talking about the same fingertips the user sees. If it fails, the fix is in the
  code, never in the tolerance.
- Two representations of the hand exist on purpose. Don't collapse them into one; the whole point
  is that they are derived independently and checked against each other.

## Gotchas
- `verifyTracks.mjs` runs only after `fkParity` passes (`&&`), so a parity failure silently means
  the track checks never ran at all. Read the whole output.

<!-- Owner: me. Reviewed 2026-09-14. `npm run verify` and `npm run lint` were run: both rc=0. -->
