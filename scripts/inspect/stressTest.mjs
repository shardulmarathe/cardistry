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

    // --- 1. Every technique opens PAUSED at 0, with the demo CTA present -----
    for (const id of lessons) {
      await page.evaluate((x) => window.__cardistry.openLesson(x), id);
      await sleep(1400);
      const s = await page.evaluate(() => {
        const p = window.__cardistry.stores.player.getState();
        return {
          lessonId: p.lessonId,
          playing: p.playing,
          started: p.started,
          ms: p.globalMs,
          dur: p.durationMs,
          cta: !!document.querySelector(".demo-btn"),
          steps: p.track ? p.track.steps.length : 0,
        };
      });
      if (s.lessonId !== id) note(`${id}: did not load (lessonId ${s.lessonId})`);
      if (s.playing) note(`${id}: autoplayed on open`);
      if (s.started) note(`${id}: reported started before any play`);
      if (s.ms !== 0) note(`${id}: opened at ms ${s.ms}, expected 0`);
      if (!s.cta) note(`${id}: no .demo-btn CTA before first play`);
      if (!(s.dur > 0)) note(`${id}: duration ${s.dur}`);
      console.log(`  ${id}: ${s.steps} steps, ${(s.dur / 1000).toFixed(1)}s, paused at 0, CTA present`);
    }

    // --- 2. Switching technique mid-shuffle stops the outgoing run -----------
    for (let r = 0; r < ROUNDS; r++) {
      for (let i = 0; i < lessons.length; i++) {
        const from = lessons[i];
        const to = lessons[(i + 1) % lessons.length];
        await page.evaluate((x) => window.__cardistry.openLesson(x), from);
        await sleep(700);
        await page.evaluate(() => window.__cardistry.stores.player.getState().play());
        await sleep(500);
        const mid = await page.evaluate(
          () => window.__cardistry.stores.player.getState().globalMs,
        );
        await page.evaluate((x) => window.__cardistry.openLesson(x), to);
        await sleep(1200);
        const s = await page.evaluate(() => {
          const p = window.__cardistry.stores.player.getState();
          return { lessonId: p.lessonId, playing: p.playing, ms: p.globalMs };
        });
        if (s.lessonId !== to) note(`switch ${from}->${to}: landed on ${s.lessonId}`);
        if (s.playing) note(`switch ${from}->${to}: new lesson is playing (should be paused)`);
        if (s.ms !== 0) note(`switch ${from}->${to}: inherited cursor ${s.ms} from the old run`);
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

    // --- 6. Responsive: the catalog folds, nothing overflows -----------------
    await page.evaluate(() => {
      window.__cardistry.stores.app.getState().setMode("lesson");
      window.__cardistry.stores.player.getState().clear();
      window.__cardistry.stores.app.setState({ activeLessonId: null });
    });
    for (const [w, h] of [[1440, 900], [1024, 768], [820, 1180], [390, 844]]) {
      await page.setViewport({ width: w, height: h });
      await sleep(900);
      // ASSERT "SOMETHING ACTIONABLE IS ON SCREEN", not "the card list is on
      // screen". Narrow screens deliberately DRILL DOWN: tapping a technique
      // swaps the card rail for that technique's detail pane, and the catalog
      // also remembers your last selection across mounts, so a narrow viewport
      // can legitimately open straight into the detail with the rail folded
      // away. An earlier version of this check asserted the cards were visible
      // and reported that intended fold as four broken cards.
      const box = await page.evaluate(() => {
        const onScreen = (e) => {
          if (!e) return false;
          const r = e.getBoundingClientRect();
          return r.width > 1 && r.height > 1 && r.right > 0 && r.left < window.innerWidth;
        };
        const cards = [...document.querySelectorAll(".lesson-card")];
        return {
          cards: cards.length,
          visibleCards: cards.filter(onScreen).length,
          detail: onScreen(document.querySelector(".detail-card")),
          startBtn: onScreen(document.querySelector(".start-btn")),
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      const actionable = box.visibleCards > 0 || (box.detail && box.startBtn);
      if (box.overflowX > 1) note(`${w}x${h}: horizontal overflow of ${box.overflowX}px`);
      if (box.cards === 0) note(`${w}x${h}: no lesson cards in the DOM at all`);
      if (!actionable) {
        note(`${w}x${h}: nothing actionable on screen (0 visible cards, and no usable detail pane)`);
      }
      const view = box.visibleCards > 0 ? `${box.visibleCards} cards visible` : "detail pane (drilled in)";
      console.log(`  ${w}x${h}: ${view}, overflowX ${box.overflowX}px`);
    }
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
