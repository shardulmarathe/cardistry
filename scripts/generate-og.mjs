// Build-time OpenGraph card generator for Cardistry (a Vite SPA with no server
// runtime). Renders a coded, branded card — NOT a screenshot — to public/og.png
// so the link preview never falls out of sync and never needs a manual swap.
//
// Runs before `vite build` (see package.json). Uses satori (HTML/CSS → SVG) +
// resvg (SVG → PNG), the same engine behind next/og.
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "public", "og.png");

const TITLE = "Cardistry";
const TAGLINE = "3D Card Table & Shuffle Trainer";
const SUB = "Spread a deck and learn to shuffle — riffle, overhand, wash — step by step.";
const DOMAIN = "cardistry.vercel.app";

// Fetch a Google font as ttf (satori can't read woff2). No browser UA → Google
// serves truetype.
async function loadFont(family, weight, text) {
  const url = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${weight}&text=${encodeURIComponent(text)}`;
  const css = await (await fetch(url)).text();
  const src = css.match(/src:\s*url\(([^)]+)\)\s*format\('(?:opentype|truetype)'\)/);
  if (!src) throw new Error(`Could not resolve ttf for ${family}`);
  const buf = await (await fetch(src[1])).arrayBuffer();
  return Buffer.from(buf);
}

// Tiny hyperscript so we can build the tree without JSX in a plain .mjs file.
const el = (type, style, children) => ({ type, props: { style, ...(children != null ? { children } : {}) } });

const [fraunces, inter, interBold] = await Promise.all([
  loadFont("Fraunces", 600, TITLE),
  loadFont("Inter", 500, TAGLINE + SUB + DOMAIN),
  loadFont("Inter", 600, "SHUFFLE TRAINER"),
]);

// A single playing card as pure CSS (satori has no suit-glyph font), with a
// pip drawn as a small diamond/circle so the motif renders reliably.
const card = (rotate, translateX, pip) =>
  el(
    "div",
    {
      position: "absolute",
      display: "flex",
      width: 92,
      height: 128,
      borderRadius: 12,
      background: "#f5efe2",
      border: "2px solid rgba(0,0,0,0.18)",
      boxShadow: "0 12px 30px rgba(0,0,0,0.45)",
      transform: `translateX(${translateX}px) rotate(${rotate}deg)`,
      padding: 12,
    },
    el("div", {
      width: 26,
      height: 26,
      background: pip,
      transform: "rotate(45deg)",
      display: "flex",
      borderRadius: 4,
    })
  );

// A fanned stack of three cards used as the wordmark accent.
const cardFan = () =>
  el(
    "div",
    { position: "relative", display: "flex", width: 210, height: 150, alignItems: "center" },
    [
      card(-16, 6, "#1f1a17"),
      card(0, 58, "#e5564e"),
      card(16, 110, "#1f1a17"),
    ]
  );

const tree = el(
  "div",
  {
    height: "100%",
    width: "100%",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    padding: "76px 84px",
    background:
      "radial-gradient(900px 520px at 20% 0%, rgba(255,255,255,0.10), transparent 60%), linear-gradient(150deg, #0f4632 0%, #0a3325 55%, #06231a 100%)",
    position: "relative",
  },
  [
    // felt vignette edge
    el("div", {
      position: "absolute",
      inset: 0,
      display: "flex",
      boxShadow: "inset 0 0 180px rgba(0,0,0,0.55)",
    }),
    // eyebrow row
    el("div", { display: "flex", alignItems: "center", gap: 16 }, [
      el("div", { width: 40, height: 2, background: "#e7c877", display: "flex" }),
      el(
        "div",
        { fontFamily: "InterBold", fontSize: 22, letterSpacing: 7, color: "#e7c877", display: "flex" },
        "SHUFFLE TRAINER"
      ),
    ]),
    // title + suits + tagline
    el("div", { display: "flex", flexDirection: "column", gap: 22 }, [
      el("div", { display: "flex", alignItems: "flex-end", gap: 28 }, [
        el(
          "div",
          { fontFamily: "Fraunces", fontSize: 132, lineHeight: 0.9, color: "#f3ecdd", letterSpacing: -1, display: "flex" },
          TITLE
        ),
        el("div", { display: "flex", paddingBottom: 22 }, cardFan()),
      ]),
      el(
        "div",
        { fontFamily: "Inter", fontSize: 40, color: "#e7c877", display: "flex" },
        TAGLINE
      ),
    ]),
    // footer
    el(
      "div",
      {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderTop: "1px solid rgba(231,200,119,0.25)",
        paddingTop: 24,
      },
      [
        el(
          "div",
          { fontFamily: "Inter", fontSize: 27, color: "#cbdac9", maxWidth: 760, display: "flex" },
          SUB
        ),
        el("div", { fontFamily: "Inter", fontSize: 24, color: "#9fc0ac", display: "flex" }, DOMAIN),
      ]
    ),
  ]
);

const svg = await satori(tree, {
  width: 1200,
  height: 630,
  fonts: [
    { name: "Fraunces", data: fraunces, weight: 600, style: "normal" },
    { name: "Inter", data: inter, weight: 500, style: "normal" },
    { name: "InterBold", data: interBold, weight: 600, style: "normal" },
  ],
});

const png = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, png);
console.log(`✓ Generated ${OUT} (${(png.length / 1024).toFixed(0)} KB)`);
