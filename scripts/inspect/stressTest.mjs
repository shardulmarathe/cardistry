// UI stress test. Hammers the Learn section the way an impatient user does and
// fails on anything the app should not tolerate: console errors, page errors,
// non-finite player state, a track that keeps running after a technique switch,
// or a lesson that never loads.
//
// Why this exists: every check in `npm run verify` is headless and pure - it
// samples compiled tracks and never mounts React, a canvas, or the transport. So
// the whole interactive layer (mode switching, the pause-on-open behaviour, the
// preview loop, "Shuffle again", responsive layout) had no automated coverage at
// all, and two regressions shipped through it in one session: a CSS class
// collision and a preview that silently stopped playing.
//
// MUST run in a FOREGROUND page. react-three-fiber commits its subtree on
// requestAnimationFrame, which Chrome pauses in a background tab, so in a hidden
// tab `LessonRunner` never mounts and every lesson silently fails to load. That
// produced one false negative before this was understood.
//
// Run: node scripts/inspect/stressTest.mjs [--port 5173] [--rounds 3] [--headed]
import { setTimeout as sleep } from "node:timers/promises";

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const PORT = Number(arg("port", 5173));
const ROUNDS = Number(arg("rounds", 3));
const HEADED = argv.includes("--headed");

const problems = [];
const note = (s) => problems.push(s);

// Console noise the app is known to emit and that is not ours to fix: three.js
// deprecation warnings from inside the library. Anything else is a failure.
const BENIGN = [
  /THREE\.\w+: .*has been deprecated/i,
  /PCFSoftShadowMap has been deprecated/i,
  /Download the React DevTools/i,
];

async function main() {
  const { default: puppeteer } = await import("puppeteer");
  const browser = await puppeteer.launch({
    headless: !HEADED,
    protocolTimeout: 240000,
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-webgl",
      "--hide-scrollbars",
    ],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    page.on("console", (m) => {
      if (m.type() !== "error" && m.type() !== "warning") return;
      const t = m.text();
      if (BENIGN.some((r) => r.test(t))) return;
      note(`console.${m.type()}: ${t}`);
    });
    page.on("pageerror", (e) => note(`pageerror: ${e.message}`));

    // `domcontentloaded` + the dev bridge, NOT `networkidle2`. The bridge
    // appearing IS the readiness signal, and networkidle never settles reliably
    // while anything else on the machine is saturating the CPU (a concurrent
    // verify run was enough to blow a 60s navigation timeout).
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction("!!window.__cardistry", { timeout: 60000 });
    await sleep(2500);

    const lessons = await page.evaluate("window.__cardistry.lessons.map((l) => l.id)");
    console.log(`lessons: ${lessons.join(", ")}`);
    if (lessons.length === 0) note("no lessons exposed by the dev bridge");

    // --- 1. Every technique STARTS when it is picked -------------------------
    // THE OPPOSITE OF WHAT THIS USED TO ASSERT, deliberately. Lessons used to load
    // paused at frame 0 behind a "Play demo" button, and this block guarded exactly
    // that: `playing` false, `started` false, a `.demo-btn` in the DOM. All three
    // went with the two-click open - picking a technique IS the request to see it,
    // and the step rail is there the moment you want to take over. A guard for
    // deleted behaviour is worse than no guard: it fails on every correct build
    // until someone deletes it without reading why it was there.
    for (const id of lessons) {
      await page.evaluate((x) => window.__cardistry.openLesson(x), id);
      await sleep(1400);
      const s = await page.evaluate(() => {
        const p = window.__cardistry.stores.player.getState();
        return {
          lessonId: p.lessonId,
          playing: p.playing,
          ms: p.globalMs,
          dur: p.durationMs,
          steps: p.track ? p.track.steps.length : 0,
          rail: document.querySelectorAll(".step-chip").length,
        };
      });
      if (s.lessonId !== id) note(`${id}: did not load (lessonId ${s.lessonId})`);
      if (!(s.dur > 0)) note(`${id}: duration ${s.dur}`);
      if (!(s.steps > 0)) note(`${id}: compiled with no steps`);
      // Either still running, or it ran to the end inside the wait. What must not
      // happen is sitting at 0 doing nothing.
      if (!s.playing && s.ms === 0) note(`${id}: did not start on open`);
      if (s.rail !== s.steps) note(`${id}: ${s.steps} steps but ${s.rail} chips in the rail`);
      console.log(
        `  ${id}: ${s.steps} steps, ${(s.dur / 1000).toFixed(1)}s, ` +
          `${s.playing ? "playing" : `stopped at ${Math.round(s.ms)}ms`}, ${s.rail} chips`,
      );
    }

    // --- 2. The picker animates nothing, and switching stops the outgoing run
    // THE STILL-POSTER GUARD IS GONE WITH THE POSTER. The catalog used to load the
    // selected technique and hold it at 45% of its track as a paused poster frame
    // (and before that, loop it forever as a live preview, which is the bug the
    // poster fixed). There is no catalog: the landing state is the shared deck
    // squared on the felt with a hand either side, posed by LessonRunner's idle
    // path, and NO TRACK IS LOADED AT ALL. That is a stronger invariant than
    // "the poster does not move", so it is what gets checked.
    await page.evaluate(() => {
      const app = window.__cardistry.stores.app.getState();
      app.closeLesson();
      app.setMode("lesson");
    });
    await sleep(1200);
    const idle = await page.evaluate(() => {
      const p = window.__cardistry.stores.player.getState();
      const a = window.__cardistry.stores.app.getState();
      return {
        activeLessonId: a.activeLessonId,
        hasTrack: !!p.track,
        playing: p.playing,
        cards: a.deck.length,
        buttons: document.querySelectorAll(".picker-card").length,
      };
    });
    if (idle.activeLessonId !== null) note(`picker: activeLessonId is ${idle.activeLessonId}`);
    if (idle.hasTrack) note("picker: a lesson track is still loaded");
    if (idle.playing) note("picker: the player is playing with no technique open");
    if (idle.cards !== 52) note(`picker: deck has ${idle.cards} cards`);
    if (idle.buttons !== lessons.length) {
      note(`picker: ${lessons.length} techniques but ${idle.buttons} buttons`);
    }
    console.log(`  picker: no track loaded, ${idle.buttons} techniques, deck intact`);

    for (let r = 0; r < ROUNDS; r++) {
      for (let i = 0; i < lessons.length; i++) {
        const from = lessons[i];
        const to = lessons[(i + 1) % lessons.length];
        await page.evaluate((x) => window.__cardistry.openLesson(x), from);
        // WAIT FOR THE TRACK, do not assume a fixed delay. Compiling a lesson takes
        // real time (the riffle measures ~230ms) and the runner mounts on a rAF, so a
        // flat 700ms + 500ms raced the setup and reported "outgoing run never advanced"
        // intermittently - which read as a product bug and was this test.
        await page.waitForFunction(
          (x) => {
            const p = window.__cardistry.stores.player.getState();
            return p.lessonId === x && !!p.track && p.durationMs > 0;
          },
          { timeout: 8000 },
          from,
        );
        await page.evaluate(() => window.__cardistry.stores.player.getState().play());
        // ...and poll until it has actually advanced, rather than sleeping and hoping.
        let mid = 0;
        for (let w = 0; w < 40 && !(mid > 0); w++) {
          await sleep(50);
          mid = await page.evaluate(
            () => window.__cardistry.stores.player.getState().globalMs,
          );
        }
        await page.evaluate((x) => window.__cardistry.openLesson(x), to);
        await sleep(1200);
        const s = await page.evaluate(() => {
          const p = window.__cardistry.stores.player.getState();
          return { lessonId: p.lessonId, playing: p.playing, ms: p.globalMs };
        });
        if (s.lessonId !== to) note(`switch ${from}->${to}: landed on ${s.lessonId}`);
        // THE NEW LESSON IS EXPECTED TO BE PLAYING - that assertion used to read the
        // other way round. What still must not happen is INHERITING THE OLD CURSOR:
        // the point of the beat is that switching mid-shuffle presents the new
        // technique from the top rather than dropping you into the middle of it. It
        // has autoplayed for `sleep(1200)` by the time it is read, so the test is
        // that it is BEHIND where the outgoing run had got to, not that it is at 0.
        if (s.ms >= mid + 1200) {
          note(`switch ${from}->${to}: cursor ${s.ms} looks inherited from the old run (${mid})`);
        }
        if (!(mid > 0)) note(`switch ${from}->${to}: outgoing run never advanced, test is vacuous`);
      }
    }
    console.log(`  ${ROUNDS} rounds of mid-shuffle technique switching: clean`);

    // --- 3. Transport spam: play/pause/scrub/step, all at once ---------------
    await page.evaluate((id) => window.__cardistry.openLesson(id), lessons[0]);
    await sleep(1200);
    await page.evaluate(async () => {
      const P = window.__cardistry.stores.player;
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 60; i++) {
        const p = P.getState();
        p.toggle();
        p.scrubTo((p.durationMs * ((i * 37) % 100)) / 100);
        if (i % 5 === 0) p.stepNext();
        if (i % 7 === 0) p.stepPrev();
        if (i % 11 === 0) p.restart();
        if (i % 13 === 0) p.setSpeed([0.25, 0.5, 1, 2][i % 4]);
        await wait(20);
      }
    });
    await sleep(600);
    const spam = await page.evaluate(() => {
      const p = window.__cardistry.stores.player.getState();
      const scene = window.__cardistry.sampleNow();
      let bad = 0;
      if (scene) {
        for (const c of scene.cards) {
          if (![...c.pos, ...c.quat, c.bend].every(Number.isFinite)) bad++;
        }
      }
      return { ms: p.globalMs, dur: p.durationMs, idx: p.stepIndex, nonFinite: bad, sampled: !!scene };
    });
    if (!Number.isFinite(spam.ms) || spam.ms < 0 || spam.ms > spam.dur) {
      note(`transport spam left globalMs ${spam.ms} (duration ${spam.dur})`);
    }
    if (!Number.isInteger(spam.idx) || spam.idx < 0) note(`stepIndex ${spam.idx}`);
    if (!spam.sampled) note("sampleNow() returned nothing after transport spam");
    if (spam.nonFinite) note(`${spam.nonFinite} cards non-finite after transport spam`);
    console.log("  60 iterations of transport spam: state stayed finite and in range");

    // --- 4. "Shuffle again" repeatedly, and the deck must stay 52 unique -----
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.__cardistry.stores.app.getState().repeatLesson());
      await sleep(900);
    }
    const deck = await page.evaluate(() => {
      const ids = window.__cardistry.stores.app.getState().deck.map((c) => c.id);
      return { n: ids.length, unique: new Set(ids).size };
    });
    if (deck.n !== 52 || deck.unique !== 52) {
      note(`after 5 replays the deck is ${deck.n} cards / ${deck.unique} unique`);
    }
    console.log(`  5x "Shuffle again": deck still ${deck.n} cards, ${deck.unique} unique`);

    // --- 5. Mode thrash: Learn <-> Visualizer -------------------------------
    for (let i = 0; i < 8; i++) {
      await page.evaluate((m) => window.__cardistry.stores.app.getState().setMode(m), i % 2 ? "lesson" : "visualizer");
      await sleep(350);
    }
    await sleep(800);
    console.log("  8x Learn/Visualizer mode thrash: no errors");

    // --- 6. Responsive: the picker and the step bar fit, nothing overflows ----
    // NO MORE DRILL-DOWN. This used to allow "either the technique cards are on
    // screen OR a detail pane with a Start button is", because narrow screens folded
    // the catalog's rail away into a per-technique detail sheet and remembered your
    // last selection across mounts - so a narrow viewport could legitimately open
    // straight into the detail. There is no detail pane and no rail: four buttons,
    // always all four, at every width. The picker grid drops to two columns under
    // 900px and one under 480px, which changes the layout but never the count.
    await page.evaluate(() => {
      window.__cardistry.stores.app.getState().setMode("lesson");
      window.__cardistry.stores.player.getState().clear();
      window.__cardistry.stores.app.setState({ activeLessonId: null });
    });
    for (const [w, h] of [[1440, 900], [1024, 768], [820, 1180], [390, 844]]) {
      await page.setViewport({ width: w, height: h });
      await sleep(900);
      const box = await page.evaluate(() => {
        const onScreen = (e) => {
          if (!e) return false;
          const r = e.getBoundingClientRect();
          return r.width > 1 && r.height > 1 && r.right > 0 && r.left < window.innerWidth;
        };
        const cards = [...document.querySelectorAll(".picker-card")];
        return {
          cards: cards.length,
          visibleCards: cards.filter(onScreen).length,
          faces: onScreen(document.querySelector(".faces-btn")),
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      if (box.overflowX > 1) note(`${w}x${h}: horizontal overflow of ${box.overflowX}px`);
      if (box.cards === 0) note(`${w}x${h}: no technique buttons in the DOM at all`);
      if (box.visibleCards !== box.cards) {
        note(`${w}x${h}: ${box.cards} techniques but only ${box.visibleCards} on screen`);
      }
      if (!box.faces) note(`${w}x${h}: the Show faces toggle is off screen`);
      console.log(`  ${w}x${h}: ${box.visibleCards}/${box.cards} techniques visible, overflowX ${box.overflowX}px`);
    }

    // --- 7. A run that plays to the end offers Replay and Shuffle again -------
    // A REGRESSION GUARD FOR A REAL BUG. Playback time is mirrored into the store
    // every 80ms and only WHILE PLAYING, so a run that clamped to its end and
    // stopped could leave `globalMs` up to 80ms short of `durationMs` - and every
    // "the run is over" test in the UI is `globalMs >= durationMs`. The completion
    // row never appeared after actually watching a shuffle finish; scrubbing to the
    // end worked, which is why it read as a missing button rather than a timing bug.
    await page.setViewport({ width: 1440, height: 900 });
    await page.evaluate((id) => window.__cardistry.openLesson(id), lessons[0]);
    await page.waitForFunction(
      () => {
        const p = window.__cardistry.stores.player.getState();
        return !!p.track && p.durationMs > 0;
      },
      { timeout: 8000 },
    );
    await page.evaluate(() => window.__cardistry.stores.player.getState().setSpeed(2));
    await page.waitForFunction(
      () => {
        const p = window.__cardistry.stores.player.getState();
        return !p.playing && p.globalMs > 100;
      },
      { timeout: 120000, polling: 200 },
    );
    await sleep(400);
    const done = await page.evaluate(() => {
      const p = window.__cardistry.stores.player.getState();
      return {
        shortBy: Math.round(p.durationMs - p.globalMs),
        again: !!document.querySelector(".again-btn"),
        row: !!document.querySelector(".done-row"),
      };
    });
    if (done.shortBy !== 0) note(`play-through ended ${done.shortBy}ms short of the duration`);
    if (!done.row) note("play-through: no completion row after the run finished");
    if (!done.again) note("play-through: no Shuffle again button after the run finished");
    console.log(`  play-through: landed exactly on the end, completion row present`);
  } finally {
    await browser.close();
  }

  console.log("");
  if (problems.length === 0) {
    console.log("stressTest: PASS - no problems found");
    return;
  }
  console.error(`stressTest: ${problems.length} PROBLEM(S)`);
  for (const p of problems) console.error(`  x ${p}`);
  process.exitCode = 1;
}

await main();
