// Visual review harness: drives the LIVE app through every lesson and writes a
// PNG per sampled beat, so the hand/card interaction can actually be LOOKED at.
//
// Why puppeteer and not the browser extension: extension screenshots of this app
// come back BLANK, and `preserveDrawingBuffer` does NOT fix it. That was assumed
// to be the cause and tried: with `gl={{ preserveDrawingBuffer: true }}` confirmed
// live on the real context (`getContextAttributes()` reports it true), the
// extension screenshot is still empty, and reading the default framebuffer back
// with `gl.readPixels` in-page returns all zeros at every sample while
// `isContextLost()` is false and `getError()` is 0. So the buffer copy bought
// nothing and was reverted rather than shipped as a permanent per-frame cost.
// `page.screenshot()` captures the real composited frame (this is how
// scripts/capture-og.mjs works) and is the only path that works.
//
// It is SLOW here and that is expected, not a fault: an x64 node install on Apple
// Silicon runs puppeteer's bundled Chrome under Rosetta with swiftshader software
// WebGL, so budget minutes per lesson and use --lessons to keep runs small.
//
// Requires a dev server on --port (default 5173) and src/devBridge.js (dev only).
//
// Usage:
//   node scripts/inspect/captureFrames.mjs --out DIR [--lessons riffle,wash]
//                                          [--per 8] [--steps] [--port 5173]
//                                          [--reference DIR [--manifest PATH]]
//
//   --steps  one frame at each authored step's start + midpoint (default)
//   --per N  N evenly spaced frames per lesson instead
//
//   --reference DIR  a directory of real-footage frames (produced by
//                    refFrames.mjs) plus a pairing manifest. Emits ONE
//                    contact sheet per technique, <lesson>-compare.png: app
//                    frame left, matched reference frame right, labels under
//                    each, one row per beat. Reference frames are third-party
//                    footage - keep that directory OUTSIDE the repo and never
//                    commit it or anything derived from it, sheets included.
//   --manifest PATH  the pairing manifest; defaults to pairs.json then
//                    manifest.json inside --reference. Accepted shapes:
//                      { "riffle": { "square-in": "riffle/0062_0s.png" } }
//                      { "riffle/square-in": "riffle/0062_0s.png" }
//                      [ { "lesson": "riffle", "label": "square-in",
//                          "ref": "riffle/0062_0s.png" } ]
//                    Paths are relative to --reference (absolute also works).
//                    A beat with no entry still gets a row, marked
//                    "no reference".
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

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
const REF_DIR = arg("reference", "");
const REF_MANIFEST = arg("manifest", "");

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

// ---------------------------------------------------------------------------
// Reference pairing + contact sheets
//
// The sheet is composed as an HTML page and screenshotted with puppeteer, which
// is already a devDependency. Deliberately no image library (sharp/canvas/jimp):
// a browser is right here, it already does layout, scaling and text.
// ---------------------------------------------------------------------------

const SHEET_COL = 560; // px per column
const SHEET_GAP = 18;
const SHEET_MAX_H = 15800; // Chrome will not capture past ~16384px tall

// Fold the accepted manifest shapes into lesson -> label -> absolute file path.
function normalizePairs(raw, refDir) {
  const out = new Map();
  const put = (lesson, label, file) => {
    if (!lesson || !label || typeof file !== "string") return;
    if (!out.has(lesson)) out.set(lesson, new Map());
    out.get(lesson).set(label, isAbsolute(file) ? file : join(refDir, file));
  };
  const list = Array.isArray(raw) ? raw : Array.isArray(raw.pairs) ? raw.pairs : null;
  if (list) {
    for (const e of list) put(e.lesson, e.label ?? e.beat, e.ref ?? e.reference ?? e.file);
    return out;
  }
  for (const [key, value] of Object.entries(raw)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [label, file] of Object.entries(value)) put(key, label, file);
    } else {
      const cut = key.indexOf("/"); // flat "lesson/label" keys
      if (cut > 0) put(key.slice(0, cut), key.slice(cut + 1), value);
    }
  }
  return out;
}

// A sheet embeds the reference footage, so it inherits its do-not-commit status.
function warnIfSheetsInsideRepo() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const rel = relative(root, resolve(OUT));
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return;
  console.warn(`WARNING: --out is inside the repo (${rel}/) and the sheets embed`);
  console.warn("         third-party footage - do not commit them.");
}

async function loadReference() {
  if (!REF_DIR) return null;
  const dir = resolve(REF_DIR);
  warnIfSheetsInsideRepo();
  const candidates = REF_MANIFEST
    ? [resolve(REF_MANIFEST)]
    : [join(dir, "pairs.json"), join(dir, "manifest.json")];
  for (const path of candidates) {
    let raw;
    try {
      raw = await readFile(path, "utf8");
    } catch (e) {
      if (e.code === "ENOENT") continue;
      throw e;
    }
    const pairs = normalizePairs(JSON.parse(raw), dir);
    console.log(`reference: ${dir} (manifest ${basename(path)}, ${pairs.size} lesson(s))`);
    return { dir, pairs };
  }
  throw new Error(`no pairing manifest under ${dir} (looked for ${candidates.join(", ")})`);
}

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

const cell = (file, caption, kind, boxH) => `
      <figure class="cell ${kind}">
        ${
          file
            ? `<div class="shot" style="height:${boxH}px"><img src="${esc(pathToFileURL(file).href)}" alt=""></div>`
            : `<div class="shot empty" style="height:${boxH}px">no reference</div>`
        }
        <figcaption>${esc(caption)}</figcaption>
      </figure>`;

function sheetHtml(lesson, rows, boxH) {
  const width = SHEET_COL * 2 + SHEET_GAP * 3;
  return `<!doctype html>
<meta charset="utf-8">
<style>
  :root { color-scheme: dark }
  * { box-sizing: border-box }
  body { margin:0; width:${width}px; background:#12141a; color:#e8e6e1;
         font:13px/1.4 ui-sans-serif, system-ui, -apple-system, sans-serif }
  header { padding:${SHEET_GAP}px ${SHEET_GAP}px 0; display:flex; align-items:baseline; gap:10px }
  h1 { margin:0; font-size:17px; letter-spacing:.02em }
  .meta { color:#8d94a3; font-size:12px }
  .row { display:grid; grid-template-columns:1fr 1fr; gap:${SHEET_GAP}px;
         padding:${SHEET_GAP}px; align-items:start }
  .row + .row { border-top:1px solid #232733 }
  figure { margin:0 }
  .shot { background:#0a0b0f; border:1px solid #262b38; border-radius:6px; overflow:hidden;
          display:flex; align-items:center; justify-content:center }
  .shot img { width:100%; height:100%; object-fit:contain; display:block }
  .empty { color:#5d6373; font-style:italic }
  figcaption { padding-top:6px; color:#b9bfcc; font-variant-numeric:tabular-nums }
  .ref figcaption { color:#9aa2b1 }
</style>
<header><h1>${esc(lesson)}</h1><span class="meta">app vs reference &middot; ${rows.length} beat(s)</span></header>
${rows
  .map(
    (r) => `<section class="row">
${cell(r.appFile, `app - ${r.label} - ${Math.round(r.ms)}ms`, "app", boxH)}
${cell(r.refFile, r.refFile ? `ref - ${basename(r.refFile)}` : `ref - ${r.label}`, "ref", boxH)}
    </section>`,
  )
  .join("\n")}
`;
}

// One sheet per technique: app left, reference right, one row per beat.
async function writeSheet(browser, lesson, rows) {
  const perRow = Math.floor(SHEET_MAX_H / rows.length) - 40; // caption + padding
  const boxH = Math.max(140, Math.min(Math.round((SHEET_COL * HEIGHT) / WIDTH), perRow));
  const htmlPath = join(OUT, `${lesson}-compare.html`);
  const pngPath = join(OUT, `${lesson}-compare.png`);
  await writeFile(htmlPath, sheetHtml(lesson, rows, boxH));
  const page = await browser.newPage();
  try {
    await page.setViewport({
      width: SHEET_COL * 2 + SHEET_GAP * 3,
      height: 900,
      deviceScaleFactor: 1,
    });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load", timeout: 60000 });
    // `load` can fire before decode on a long page; wait for every <img>.
    await page.evaluate(() =>
      Promise.all(
        [...document.images].map((img) =>
          img.complete ? null : new Promise((r) => ((img.onload = r), (img.onerror = r))),
        ),
      ),
    );
    await page.screenshot({ path: pngPath, type: "png", fullPage: true });
  } finally {
    await page.close();
    await unlink(htmlPath).catch(() => {});
  }
  return pngPath;
}

async function main() {
  const reference = await loadReference();
  const { default: puppeteer } = await import("puppeteer");
  const browser = await puppeteer.launch({
    headless: true,
    // Software WebGL (swiftshader) renders 52 bent cards + two hands at a few
    // seconds a frame, and a long run degrades further; the default 30s
    // protocol timeout kills Page.captureScreenshot partway through the catalog.
    // 240s was enough until the hands began CASTING shadows and the cards
    // RECEIVING them. Under swiftshader a shadow pass over 30 capsule casters and
    // 104 receiving card meshes pushed a single `Runtime.callFunctionOn` past that
    // ceiling and the run died mid-lesson with a ProtocolError rather than a useful
    // message. The scene is not broken when this happens - it is software WebGL
    // rendering a shadowed scene at minutes per frame - so the ceiling is what has
    // to move.
    protocolTimeout: 900000,
    // LAUNCH timeout, which is a different clock from `protocolTimeout` above and
    // defaults to 30s. On an Apple Silicon machine with an x64 node install,
    // puppeteer's bundled Chrome is x86_64 and macOS runs it under Rosetta, so it
    // takes well over 30s just to print its WS endpoint and the launch fails with
    // "Timed out waiting for the WS endpoint URL to appear in stdout" before a
    // single frame is captured. Raising this is the whole fix; an arm64 node would
    // make it unnecessary.
    timeout: 180000,
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
    // `domcontentloaded` + the dev bridge, NOT `networkidle2`. This file's own header
    // has said so since it was written, and line 288 below was still using it: with
    // the Vercel Analytics beacon and vite's HMR socket both open, "no more than two
    // connections for 500ms" never arrives and this throws
    // `TimeoutError: Navigation timeout of 60000 ms exceeded` after a full minute -
    // silently blocking the one tool whose entire job is looking at the app. The
    // bridge appearing is the real readiness signal and it lands in seconds.
    await page.goto(URL_BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => !!window.__cardistry, { timeout: 60000 });
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
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForFunction(() => !!window.__cardistry, { timeout: 60000 });
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

      // Reference frames for this lesson, keyed by the same beat labels the plan
      // uses. Missing lesson or missing beat both just mean "no reference".
      const refs = reference?.pairs.get(lesson.id) ?? new Map();
      if (reference && !refs.size) console.warn(`  no reference entries for ${lesson.id}`);
      const rows = [];

      let i = 0;
      for (const p of plan) {
        const ms = Math.min(info.durationMs, Math.max(0, p.ms));
        await page.evaluate((t) => window.__cardistry.scrubTo(t), ms);
        await settle(page, 4);
        const name = `${String(i).padStart(2, "0")}_${p.label}_${Math.round(ms)}ms.png`;
        await page.screenshot({ path: join(dir, name), type: "png" });
        const refFile = refs.get(p.label) ?? null;
        manifest.push({
          lesson: lesson.id,
          file: join(lesson.id, name),
          ms,
          label: p.label,
          ...(reference ? { ref: refFile } : {}),
        });
        rows.push({ appFile: resolve(dir, name), refFile, label: p.label, ms });
        i++;
      }
      console.log(`  ${plan.length} frames -> ${dir}`);
      manifest.push({ lesson: lesson.id, trackInfo: info });

      if (reference && rows.length) {
        const matched = rows.filter((r) => r.refFile).length;
        const sheet = await writeSheet(browser, lesson.id, rows);
        console.log(`  sheet -> ${sheet} (${matched}/${rows.length} beats paired)`);
      }
    }
    await writeFile(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  } finally {
    await browser.close();
  }
}

await main();
