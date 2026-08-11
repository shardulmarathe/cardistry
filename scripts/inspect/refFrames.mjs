// Reference-frame capture: park a YouTube shuffle tutorial at chosen timestamps
// and save each frame as a PNG, so real hand mechanics can be compared side by
// side with the app's (see captureFrames.mjs --reference).
//
// !! THIRD-PARTY FOOTAGE !!
// Every file this script writes is a frame of someone else's video. It must
// NEVER be committed to this repo, added to git, bundled, or shipped - it is
// review material only. The default output directory is deliberately OUTSIDE
// the working tree ($TMPDIR/cardistry-ref-frames); if you pass --out, keep it
// outside the repo too.
//
// Hard-won facts, all measured - please do not "simplify" these away:
//
//   * The /embed/ player does NOT work from an automated browser on a fresh
//     profile: it renders "Video player configuration error - Error 153" and
//     never attaches a source (readyState 0, videoWidth 0). That failure mode
//     looks exactly like a missing codec, which is misleading. Use the
//     /watch?v= page instead: it decodes on puppeteer's bundled Chromium AND on
//     the real Chrome binary, headless or headed (measured on a 1280x720
//     viewport: duration 485.481, readyState 4, videoWidth 854).
//   * SEEKING IS THE TRAP. Setting `video.currentTime` while paused leaves
//     readyState stuck at 1 forever (YouTube's MSE code never fetches the new
//     range because its own player does not know it moved), and calling
//     `#movie_player.seekTo()` tears the player down completely - readyState 0,
//     currentTime 0, and a "Something went wrong. Refresh or try again later."
//     overlay in the screenshot. So this script never seeks. It NAVIGATES to
//     `watch?v=ID&t=<n>s` once per requested timestamp, lands a few seconds
//     early, lets the video play forward, and pauses the instant currentTime
//     reaches the target. Measured accuracy: within ~0.05s of the request.
//   * Go through about:blank between timestamps. YouTube's SPA otherwise treats
//     the next watch URL as a soft navigation and keeps the old player, which
//     ignores the new &t= and sits near 1.5s.
//   * Do NOT `await video.play()`. If the page decides it wants a user gesture
//     the promise never settles and the CDP call behind page.evaluate() hangs
//     until protocolTimeout. Always `.play().catch(() => {})`.
//   * A tab YouTube considers hidden can stall its media pipeline
//     (`document.hidden === true` -> readyState pinned at 0). The watch page
//     survived backgrounding in testing, but it costs nothing to keep the
//     target tab in front: always bringToFront(), never open a second tab.
//
// Usage:
//   node scripts/inspect/refFrames.mjs --video NdCia_d1u5c --label riffle \
//        --times 62,71.5,120.25 [--out DIR]
//
//   node scripts/inspect/refFrames.mjs --jobs jobs.json [--out DIR]
//     jobs.json: [{ "video": "NdCia_d1u5c", "label": "riffle",
//                   "times": [62, 71.5, 120.25] }]
//     (--jobs also takes inline JSON instead of a path.)
//
// Options:
//   --out DIR        output root (default $TMPDIR/cardistry-ref-frames)
//   --chrome PATH    browser binary; default is puppeteer's bundled Chromium,
//                    which decodes YouTube fine. Point it at the real Chrome
//                    ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
//                    if a particular video needs proprietary codecs.
//   --headed         visible window, for when a video refuses to decode and you
//                    need to see what the page is actually showing
//   --lead N         seconds of run-up before each target (default 3)
//   --width/--height viewport, default 1280x720
//   --keep-overlays  leave YouTube's own chrome (title, controls, ad promos,
//                    channel watermark) in the frame instead of hiding it
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const OUT = arg("out", join(tmpdir(), "cardistry-ref-frames"));
const CHROME = arg("chrome", undefined);
const HEADED = flag("headed");
const KEEP_OVERLAYS = flag("keep-overlays");
const LEAD = Number(arg("lead", 3));
const WIDTH = Number(arg("width", 1280));
const HEIGHT = Number(arg("height", 720));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// These frames are someone else's video; landing them in the working tree is how
// they end up in a commit by accident.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
function warnIfInsideRepo(dir) {
  const rel = relative(REPO_ROOT, resolve(dir));
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return;
  console.warn(`WARNING: --out is inside the repo (${rel}/). Third-party frames`);
  console.warn("         must not be committed - point --out somewhere outside.");
}

// Player furniture that would otherwise sit on top of the hands. The ad/promo
// slots matter most: YouTube's own "YouTube Premium" card covers the bottom
// third of the frame. It is injected non-deterministically (the same timestamp
// showed it on one run and not the next), so if a captured frame still has a
// promo card over the hands, just re-shoot that timestamp or nudge it by a
// second.
const HIDE_OVERLAYS = `
  .ytp-chrome-top, .ytp-chrome-bottom, .ytp-gradient-top, .ytp-gradient-bottom,
  .ytp-ce-element, .ytp-ad-overlay-container, .ytp-ad-overlay-slot,
  .ytp-ad-overlay-image, .ytp-ad-text-overlay, .ytp-ad-message-container,
  .ytp-ad-module, .video-ads, #player-ads, .ytp-cards-teaser,
  .ytp-suggested-action, .ytp-featured-product, .ytp-paid-content-overlay,
  .ytp-watermark, .ytp-cued-thumbnail-overlay, .ytp-spinner, .iv-branding,
  .iv-promo, .annotation
  { display: none !important; }`;

// A bare id, a watch URL, a youtu.be link or a /shorts/ link all reduce to the id.
function videoId(spec) {
  const m = String(spec).match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/)([\w-]{11})/);
  return m ? m[1] : String(spec).trim();
}

async function readJobs() {
  const jobsArg = arg("jobs", "");
  if (jobsArg) {
    const raw = jobsArg.trimStart().startsWith("[") ? jobsArg : await readFile(jobsArg, "utf8");
    return JSON.parse(raw).map((j) => {
      const id = videoId(j.video ?? j.id);
      return { video: id, label: j.label ?? id, times: j.times.map(Number) };
    });
  }
  const video = arg("video", "");
  const times = arg("times", "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter(Number.isFinite);
  if (!video || !times.length) return [];
  return [{ video: videoId(video), label: arg("label", videoId(video)), times }];
}

// 71.5 -> "0071_5s.png", so a file listing sorts in timeline order.
const frameName = (t) =>
  `${String(Math.floor(t)).padStart(4, "0")}_${Math.round((t % 1) * 10)}s.png`;

// Load the watch page parked `LEAD` seconds before `seconds`, play forward, and
// stop dead on the target frame. One navigation per frame - see header: seeking
// destroys the player.
async function parkAt(page, id, seconds) {
  const start = Math.max(0, Math.floor(seconds - LEAD));
  // Force a hard load; a soft SPA navigation would reuse the old player.
  await page.goto("about:blank");
  await page.goto(`https://www.youtube.com/watch?v=${id}&t=${start}s`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.bringToFront().catch(() => {});
  if (!KEEP_OVERLAYS) await page.addStyleTag({ content: HIDE_OVERLAYS }).catch(() => {});

  // Wait for the real video (not a pre-roll ad) to be decoding.
  let clean = true;
  await page
    .waitForFunction(
      () => {
        const p = document.querySelector("#movie_player");
        const v = document.querySelector("video");
        return (
          !!p && !!v && !p.classList.contains("ad-showing") && v.readyState >= 3 && v.videoWidth > 0
        );
      },
      { timeout: 45000, polling: 250 },
    )
    .catch(() => {
      clean = false;
    });

  // Roll forward to the target. Re-kicking play() inside the poll covers the
  // case where autoplay was refused; never awaited (see header).
  await page
    .waitForFunction(
      (sec) => {
        const v = document.querySelector("video");
        if (!v) return false;
        if (v.paused) v.play().catch(() => {});
        return v.currentTime >= sec;
      },
      { timeout: 60000, polling: 50 },
      seconds,
    )
    .catch(() => {
      clean = false;
    });

  await page.evaluate(() => {
    const p = document.querySelector("#movie_player");
    if (p?.pauseVideo) p.pauseVideo();
    else document.querySelector("video")?.pause();
  });
  await sleep(500); // let the paused frame be presented
  return { clean, ...(await videoState(page)) };
}

const videoState = (page) =>
  page.evaluate(() => {
    const v = document.querySelector("video");
    if (!v) return { at: null, ready: null, width: 0, height: 0 };
    return {
      at: Number(v.currentTime.toFixed(2)),
      ready: v.readyState,
      width: v.videoWidth,
      height: v.videoHeight,
    };
  });

// Screenshot just the video box, clipped to the viewport (the page around it is
// YouTube's UI, which we do not want in a comparison sheet).
async function shootVideo(page, path) {
  const clip = await page.evaluate(() => {
    const v = document.querySelector("video");
    const r = v.getBoundingClientRect();
    const x = Math.max(0, Math.round(r.x));
    const y = Math.max(0, Math.round(r.y));
    return {
      x,
      y,
      width: Math.max(1, Math.round(Math.min(r.width, window.innerWidth - x))),
      height: Math.max(1, Math.round(Math.min(r.height, window.innerHeight - y))),
    };
  });
  await page.screenshot({ path, type: "png", clip });
}

async function main() {
  const jobs = await readJobs();
  if (!jobs.length) {
    console.error("nothing to capture: pass --video ID --times a,b,c, or --jobs jobs.json");
    process.exitCode = 1;
    return;
  }

  warnIfInsideRepo(OUT);

  const { default: puppeteer } = await import("puppeteer");
  const browser = await puppeteer.launch({
    headless: !HEADED,
    executablePath: CHROME,
    // A cold player load plus a run-up is slow; the default 30s protocol
    // timeout would kill Page.captureScreenshot partway through a job list.
    protocolTimeout: 180000,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--autoplay-policy=no-user-gesture-required",
      "--mute-audio",
      "--hide-scrollbars",
      "--force-color-profile=srgb",
    ],
  });
  const frames = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });

    for (const job of jobs) {
      const dir = join(OUT, job.label);
      await mkdir(dir, { recursive: true });
      console.log(`${job.label} (${job.video}): ${job.times.length} frame(s)`);
      for (const t of job.times) {
        const state = await parkAt(page, job.video, t);
        if (!state.width) {
          console.warn(`  ${t}s: never decoded - skipping`);
          console.warn(
            "    if this repeats, retry with --headed, or --chrome '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'",
          );
          continue;
        }
        const file = frameName(t);
        await shootVideo(page, join(dir, file));
        frames.push({
          label: job.label,
          video: job.video,
          seconds: t,
          landedAt: state.at,
          file: `${job.label}/${file}`,
        });
        console.log(`  ${t}s -> ${file} (landed ${state.at}s${state.clean ? "" : ", rough"})`);
      }
    }
    // A record of what came from where; also the starting point for the pairing
    // manifest that captureFrames.mjs --reference consumes.
    await writeFile(join(OUT, "frames.json"), `${JSON.stringify(frames, null, 2)}\n`);
    console.log(`${frames.length} frame(s) -> ${OUT}`);
    console.log("third-party footage: review material only, never commit these");
  } finally {
    await browser.close();
  }
}

await main();
