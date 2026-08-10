// Visual review harness: drives the LIVE app through every lesson and writes a
// PNG per sampled beat, so the hand/card interaction can actually be LOOKED at.
//
// Why puppeteer and not the browser extension: Chrome's tab capture composites a
// WebGL canvas created without `preserveDrawingBuffer` as blank, so extension
// screenshots of this app are empty. `page.screenshot()` captures the real
// composited frame (this is how scripts/capture-og.mjs works).
//
// Requires a dev server on --port (default 5173) and src/devBridge.js (dev only).
//
// Usage:
//   node scripts/inspect/captureFrames.mjs --out DIR [--lessons riffle,faro]
//                                          [--per 8] [--steps] [--port 5173]
//
//   --steps  one frame at each authored step's start + midpoint (default)
//   --per N  N evenly spaced frames per lesson instead
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const PORT = Number(arg("port", 5173));
const URL_BASE = `http://localhost:${PORT}/`;
const OUT = arg("out", "./frames");
const ONLY = arg("lessons", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const PER = Number(arg("per", 0));
const WIDTH = Number(arg("width", 1200));
const HEIGHT = Number(arg("height", 860));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait until r3f has painted at least `n` frames past now. r3f owns its own rAF
// loop, so a few rAF ticks after a seek guarantees the new cursor is on screen;
// a fixed timeout would either be slow or race.
const settle = (page, n = 4) =>
  page.evaluate(
    (count) =>
      new Promise((resolve) => {
        let left = count;
        const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );

async function main() {
  const { default: puppeteer } = await import("puppeteer");
  const browser = await puppeteer.launch({
    headless: true,
    // Software WebGL (swiftshader) renders 52 bent cards + two hands at a few
    // seconds a frame, and a long run degrades further; the default 30s
    // protocol timeout kills Page.captureScreenshot partway through the catalog.
    protocolTimeout: 240000,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--hide-scrollbars",
      "--force-color-profile=srgb",
    ],
  });
  const manifest = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    page.on("pageerror", (e) => console.warn(`  [pageerror] ${e.message}`));
    await page.goto(URL_BASE, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForFunction("!!window.__cardistry", { timeout: 30000 });
    await sleep(2500); // textures + rapier table settle

    const lessons = await page.evaluate("window.__cardistry.lessons");
    const targets = ONLY.length ? lessons.filter((l) => ONLY.includes(l.id)) : lessons;

    for (const lesson of targets) {
      console.log(`lesson: ${lesson.id}`);
      const dir = join(OUT, lesson.id);
      await mkdir(dir, { recursive: true });

      // Reload per lesson: a single long-lived software-WebGL context slows to a
      // crawl after a few dozen captures and eventually wedges the compositor.
      await page.reload({ waitUntil: "networkidle2", timeout: 60000 });
      await page.waitForFunction("!!window.__cardistry", { timeout: 30000 });
      await sleep(2000);

      await page.evaluate((id) => window.__cardistry.openLesson(id), lesson.id);
      await settle(page, 8);
      const info = await page.evaluate("window.__cardistry.trackInfo()");
      if (!info) {
        console.warn(`  no track compiled for ${lesson.id}`);
        continue;
      }

      // Sample plan: authored beats are where the interaction is legible, so
      // default to two frames per step (entry pose + mid-stroke).
      const plan = [];
      if (PER > 0) {
        for (let i = 0; i < PER; i++) {
          plan.push({ ms: (info.durationMs * i) / (PER - 1 || 1), label: `t${i}` });
        }
      } else {
        for (const s of info.steps) {
          plan.push({ ms: s.tStart + 1, label: `${s.id}-in` });
          plan.push({ ms: (s.tStart + s.tEnd) / 2, label: `${s.id}-mid` });
        }
      }

      let i = 0;
      for (const p of plan) {
        const ms = Math.min(info.durationMs, Math.max(0, p.ms));
        await page.evaluate((t) => window.__cardistry.scrubTo(t), ms);
        await settle(page, 4);
        const name = `${String(i).padStart(2, "0")}_${p.label}_${Math.round(ms)}ms.png`;
        await page.screenshot({ path: join(dir, name), type: "png" });
        manifest.push({ lesson: lesson.id, file: join(lesson.id, name), ms, label: p.label });
        i++;
      }
      console.log(`  ${plan.length} frames -> ${dir}`);
      manifest.push({ lesson: lesson.id, trackInfo: info });
    }
    await writeFile(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  } finally {
    await browser.close();
  }
}

await main();
