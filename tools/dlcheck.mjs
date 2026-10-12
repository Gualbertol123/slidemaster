/* SP for the display list (docs/next/05 §3.4, PLAN S3.1): every per-node fixture (core/tests/dl-fixtures.ts) is
   written as a PDF by core/src/pdf, checked (tools/pdfcheck.py check: qpdf --check, no Type 3, no variable font),
   rendered by PDFium (pypdfium2) and compared with the same display list drawn by core/src/dl/canvas.ts on a
   Chromium canvas. A pixel passes when its colour is within ΔE 2 (CIE76) of the other image's, or within the
   range of the other image's 3 × 3 neighbourhood both ways (1 px dilation: anti-aliasing and sub-pixel glyph
   placement differ between PDFium and Skia); a fixture passes when 99.5 % of its pixels do.

     node tools/dlcheck.mjs [--out DIR] [--only rect,text]     (npm run sp)

   Writes DIR (default tests/parity/report/dl/): <node>.pdf, pdfium/<node>-1.png, canvas-<node>.png, diff-<node>.png
   (failing pixels red), report.json. Needs Playwright's Chromium (or CHROME), Python with pypdf + pypdfium2, qpdf. */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg("--out", path.join(ROOT, "tests/parity/report/dl")));
const ONLY = arg("--only", "")?.split(",").filter(Boolean);
const PY = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
const DE = 2, PASS = .995;

const { build } = require(require.resolve("esbuild", { paths: [path.join(ROOT, "app")] }));
const { chromium } = require("playwright");

fs.mkdirSync(OUT, { recursive: true });
for (const e of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, e), { recursive: true, force: true });     // (the folder itself may be open)
fs.mkdirSync(path.join(OUT, "pdfium"), { recursive: true });

// ---- the core, bundled for Node (the PDF) and for the page (the canvas)
const bundle = async (contents, platform, format) => (await build({
  stdin: { contents, resolveDir: ROOT, loader: "ts" }, bundle: true, write: false, platform, format, target: "es2022", logLevel: "error",
})).outputFiles[0].text;
const nodeJs = path.join(OUT, "core.mjs");
fs.writeFileSync(nodeJs, await bundle(`export { nodeFixtures, encodePng } from "./core/tests/dl-fixtures"; export { writePdf } from "./core/src/pdf/writer"; export { decodePng } from "./core/src/pdf/png"; export { validate } from "./core/src/dl/types";`, "node", "esm"));
const pageJs = await bundle(`import { drawDl } from "./core/src/dl/canvas"; globalThis.drawDl = drawDl;`, "browser", "iife");
const core = await import(pathToFileURL(nodeJs).href);

const read = p => new Uint8Array(fs.readFileSync(path.join(ROOT, "core/tests/fixtures", p)));
const fx = core.nodeFixtures({ carlito: read("fonts/Carlito-Regular.ttf"), carlitoBold: read("fonts/Carlito-Bold.ttf"), jpeg: read("images/wall-blur.jpg") });
const names = Object.keys(fx.lists).filter(k => !ONLY?.length || ONLY.includes(k));

// ---- PDFs, their checks, PDFium. The negative control "control-rect" is the rect slide with one rectangle moved by
// 3 px and one colour changed by ΔE ≈ 4 in the PDF only: the comparison must fail it, or the tolerance is too loose.
const writeFixturePdf = (k, list) => {
  const errs = core.validate(list);
  if (errs.length) throw new Error(`${k}: ${errs.join("; ")}`);
  const bytes = core.writePdf({ pages: [list], image: id => fx.images.get(id), font: n => { const key = `${n.font}|${n.b ? "b" : ""}`, d = fx.fonts.get(key); return d && { key, data: d }; }, title: `display list: ${k}` });
  const f = path.join(OUT, `${k}.pdf`); fs.writeFileSync(f, bytes); return f;
};
const pdfs = names.map(k => writeFixturePdf(k, fx.lists[k]));
const control = structuredClone(fx.lists.rect);
control[1].x += 3; control[5].fill.solid = [24, 36, 58];
const controlPdf = writeFixturePdf("control-rect", control);
const py = (...a) => { const r = spawnSync(PY, [path.join(ROOT, "tools/pdfcheck.py"), ...a], { encoding: "utf8" }); return r; };
const chk = py("check", ...pdfs);
process.stdout.write(chk.stdout); process.stderr.write(chk.stderr);
const rend = py("render", ...pdfs, controlPdf, "--out", path.join(OUT, "pdfium"), "--scale", String(4 / 3));
if (rend.status !== 0) { console.error(rend.stderr); process.exit(2); }

// ---- the canvas in Chromium
const browser = await chromium.launch({ executablePath: process.env.CHROME || chromium.executablePath() });
const page = await browser.newPage();
await page.setContent(`<canvas id="c" width="1600" height="900"></canvas>`);
await page.addScriptTag({ content: pageJs });
const b64 = u => Buffer.from(u).toString("base64");
const canvases = await page.evaluate(async ({ lists, images, fonts }) => {
  const bytes = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  for (const [key, data] of fonts) {
    const [family, b] = key.split("|");
    const face = new FontFace(family, bytes(data), { weight: b ? "700" : "400" });
    await face.load(); document.fonts.add(face);
  }
  const decoded = new Map();
  for (const [id, data] of images) decoded.set(id, await createImageBitmap(new Blob([bytes(data)])));
  const out = {};
  const c = document.getElementById("c"), ctx = c.getContext("2d");
  for (const [k, list] of Object.entries(lists)) {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 1600, 900);
    globalThis.drawDl(ctx, list, { image: id => decoded.get(id), layer: () => { const l = new OffscreenCanvas(1600, 900); return { ctx: l.getContext("2d"), image: l }; } });
    out[k] = c.toDataURL("image/png").split(",")[1];
  }
  return out;
}, { lists: Object.fromEntries(names.map(k => [k, fx.lists[k]])), images: [...fx.images].map(([k, v]) => [k, b64(v)]), fonts: [...fx.fonts].map(([k, v]) => [k, b64(v)]) });
await browser.close();

// ---- compare
const lin = new Float64Array(256).map((_, i) => { const c = i / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
const lab = (r, g, b) => {
  const R = lin[r], G = lin[g], B = lin[b];
  const f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  const x = f((.4124 * R + .3576 * G + .1805 * B) / .95047), y = f(.2126 * R + .7152 * G + .0722 * B), z = f((.0193 * R + .1192 * G + .9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};
const toLab = (img) => {
  const n = img.w * img.h, L = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    let r = img.rgb[3 * i], g = img.rgb[3 * i + 1], b = img.rgb[3 * i + 2];
    if (img.alpha) { const a = img.alpha[i] / 255; r = Math.round(r * a + 255 * (1 - a)); g = Math.round(g * a + 255 * (1 - a)); b = Math.round(b * a + 255 * (1 - a)); }
    const v = lab(r, g, b); L[3 * i] = v[0]; L[3 * i + 1] = v[1]; L[3 * i + 2] = v[2];
  }
  return L;
};
/** compare PDFium's page with the canvas: the share of passing pixels, and the failing pixels as a mask */
function compare(a, b) {
  if (a.w !== b.w || a.h !== b.h) throw new Error(`PDFium ${a.w}×${a.h}, canvas ${b.w}×${b.h}`);
  const A = toLab(a), B = toLab(b), w = a.w, h = a.h;
  const d = (P, i, Q, j) => Math.hypot(P[3 * i] - Q[3 * j], P[3 * i + 1] - Q[3 * j + 1], P[3 * i + 2] - Q[3 * j + 2]);
  /** the 1 px dilation: P's colour at (x, y) lies within the range of Q's 3 × 3 neighbourhood (per L, a, b, ± ΔE),
      so an edge that the two rasterisers anti-alias or place a fraction of a pixel apart passes, a wrong colour or a
      missing shape does not */
  const near = (P, Q, x, y) => {
    const i = y * w + x;
    if (d(P, i, Q, i) < DE) return true;
    for (let c = 0; c < 3; c++) {
      let lo = Infinity, hi = -Infinity;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
        const v = Q[3 * (yy * w + xx) + c]; if (v < lo) lo = v; if (v > hi) hi = v;
      }
      const v = P[3 * i + c];
      if (v < lo - DE || v > hi + DE) return false;
    }
    return true;
  };
  let bad = 0, worst = 0;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, e = d(A, i, B, i);
    if (e > worst) worst = e;
    if (e >= DE && !(near(A, B, x, y) && near(B, A, x, y))) { bad++; mask[i] = 1; }
  }
  return { ok: 1 - bad / (w * h), bad, worst, mask };
}
const pdfium = k => core.decodePng(new Uint8Array(fs.readFileSync(path.join(OUT, "pdfium", `${k}-1.png`))));
const report = { tolerance: { deltaE: DE, pass: PASS, dilation: 1 }, nodes: {} };
let failed = !!chk.status;
for (const k of names) {
  const cpng = Buffer.from(canvases[k], "base64"); fs.writeFileSync(path.join(OUT, `canvas-${k}.png`), cpng);
  const b = core.decodePng(new Uint8Array(cpng));
  const { ok, bad, worst, mask } = compare(pdfium(k), b);
  report.nodes[k] = { pass: ok >= PASS, okPixels: +(ok * 100).toFixed(3), failing: bad, maxDeltaE: +worst.toFixed(1) };
  if (ok < PASS) failed = true;
  fs.writeFileSync(path.join(OUT, `diff-${k}.png`), core.encodePng(b.w, b.h, (x, y) => {
    const i = y * b.w + x; if (mask[i]) return [255, 0, 0, 255];
    const g = Math.round(255 - (255 - b.rgb[3 * i + 1]) * .25); return [g, g, g, 255];
  }));
  console.log(`${ok >= PASS ? "PASS" : "FAIL"} ${k.padEnd(7)} ${(ok * 100).toFixed(3)} % of pixels within ΔE ${DE} (${bad} failing, max ΔE ${worst.toFixed(1)})`);
}
if (names.includes("rect")) {
  const c = compare(pdfium("control-rect"), core.decodePng(new Uint8Array(Buffer.from(canvases.rect, "base64"))));
  report.negativeControl = { detected: c.ok < PASS, okPixels: +(c.ok * 100).toFixed(3), failing: c.bad };
  console.log(`${c.ok < PASS ? "PASS" : "FAIL"} negative control (a rect moved 3 px, a colour ΔE ≈ 4): ${(c.ok * 100).toFixed(3)} % within tolerance, ${c.ok < PASS ? "detected" : "NOT detected: the tolerance is too loose"}`);
  if (c.ok >= PASS) failed = true;
}
report.qpdfAndFonts = chk.stdout.trim().split(/\r?\n/);
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1));
fs.rmSync(nodeJs);
console.log(failed ? `dlcheck: FAILED (report in ${path.relative(ROOT, OUT)})` : `dlcheck: all ${names.length} node types pass (report in ${path.relative(ROOT, OUT)})`);
process.exit(failed ? 1 : 0);
