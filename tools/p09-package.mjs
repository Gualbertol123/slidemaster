/* The Phase 0 review of docs/next/09 (charts, lines and annotations, snapping, icons, hidden rows, delete-versions, Excel
   conditional formats): the review decks of spikes/charts/decks drawn by the committed page in every design, each slide's
   display list completed with the prototypes of spikes/charts (window.P09, bundled here with esbuild) and drawn as the
   PNG export draws it (tools/dlparity.mjs's recipe). Writes review/P09/index.html, review/P09/img/ and the icon picker
   mock review/P09/picker.html (not committed: regenerate with this tool).

     python spikes/charts/make_books.py
     node tools/p09-package.mjs --tabler <folder of the @tabler/icons 3.49.0 package> [--designs …]

   Needs node_modules (Playwright, esbuild) and the workbooks of make_books.py; it copies them into tests/corpus/workbooks
   for the run and removes them afterwards. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { capture, BOOKS } from "./capture-v3.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const SPIKE = path.join(REPO, "spikes", "charts"), OUT = path.join(REPO, "review", "P09"), IMG = path.join(OUT, "img");
const TABLER = arg("--tabler", null);
if (!TABLER) { console.error("--tabler <@tabler/icons package folder> is required"); process.exit(2); }
const DESIGNS = arg("--designs", "glass,excel,clean,mckinsey,bain,mckinsey@headline=panel,bain@background=white").split(",");
const NAMES0 = { glass: "Liquid Glass", excel: "Excel", clean: "Excel Refined", mckinsey: "Consulting Navy", bain: "Consulting Red" };
const nameOf = s => { const [d, o] = s.split("@"); return NAMES0[d] + (o ? " · " + o.replace(/=/g, ": ").replace(/\+/g, " · ") : ""); };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// the prototypes, bundled for the page
const bundle = (await build({ entryPoints: [path.join(SPIKE, "scenes.ts")], bundle: true, format: "iife", globalName: "P09", write: false, target: "es2022", logLevel: "warning" })).outputFiles[0].text;
// the icons the slides use (outline and filled), from the package
const outline = JSON.parse(fs.readFileSync(path.join(TABLER, "tabler-nodes-outline.json"), "utf8"));
const filled = JSON.parse(fs.readFileSync(path.join(TABLER, "tabler-nodes-filled.json"), "utf8"));
const meta = JSON.parse(fs.readFileSync(path.join(TABLER, "icons.json"), "utf8"));
const used = new Set(fs.readFileSync(path.join(SPIKE, "scenes.ts"), "utf8").match(/"[a-z][a-z0-9-]+"/g).map(s => s.slice(1, -1)));
const pick = (src, names) => Object.fromEntries(Object.entries(src).filter(([k]) => names.has(k)).map(([k, v]) => [k, v.map(([, a]) => a.d)]));
const iconData = { outline: pick(outline, used), filled: pick(filled, used) };

const decks = fs.readdirSync(path.join(SPIKE, "decks")).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5));
const deckOps = Object.fromEntries(decks.map(d => [d, JSON.parse(fs.readFileSync(path.join(SPIKE, "decks", d + ".json"), "utf8")).ops]));
const copied = [];
for (const f of fs.readdirSync(path.join(SPIKE, "books"))) { const to = path.join(BOOKS, f); if (!fs.existsSync(to)) { fs.copyFileSync(path.join(SPIKE, "books", f), to); copied.push(to); } }

async function hook(page, { deck, dir, design, version, slide }) {
  if (!(await page.evaluate(() => !!window.P09))) await page.addScriptTag({ content: bundle });
  const spec = path.basename(path.dirname(dir)), opt = spec.split("@")[1], consult = opt ? Object.fromEntries(opt.split("+").map(kv => kv.split("="))) : null;
  const data = await page.evaluate(async ({ deck, design, version, slide, consult, ops, iconData }) => {
    const T = window.__sbTest;
    const [one] = await T.slideLists({ design, version, forExport: false, thumb: false, slides: [slide] });
    const images = one ? one.dl.images : {};
    const nodes = window.P09.render(deck, slide, design, consult, [...ops, { op: "style.patch", patch: { design } }], iconData, one ? one.dl.nodes : [], images);
    const load = src => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = src; });
    const c = document.createElement("canvas"); c.width = 1600; c.height = 900;
    const ctx = c.getContext("2d", { alpha: false }), imgs = new Map();
    for (const [id, src] of Object.entries(images)) { try { imgs.set(id, await load(src)); } catch { /* left out */ } }
    const opts = { image: id => imgs.get(id), layer: () => { const o = new OffscreenCanvas(1600, 900); const x = o.getContext("2d"); x.lineJoin = "round"; return { ctx: x, image: o }; } };
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 1600, 900);
    // Stroke.join (ADR-020's amendment) does not exist yet: the prototypes' outlines are drawn with round joins here
    ctx.lineJoin = "round";
    nodes.forEach((n, i) => {
      if (n.t === "group" && nodes[i - 1]?.t === "hit" && nodes[i - 1].id === "tw") { const o = new OffscreenCanvas(1600, 900); const x = o.getContext("2d"); x.lineJoin = "round"; T.drawDl(x, [n], opts); ctx.drawImage(o, 0, 0); }
      else T.drawDl(ctx, [n], opts);
    });
    return c.toDataURL("image/png").split(",")[1];
  }, { deck, design, version, slide, consult, ops: deckOps[deck], iconData });
  return { png: Buffer.from(data, "base64") };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sb-p09-"));
let manifest;
try {
  fs.rmSync(IMG, { recursive: true, force: true }); fs.mkdirSync(IMG, { recursive: true });
  console.log(`drawing ${decks.join(", ")} in ${DESIGNS.join(", ")}…`);
  manifest = await capture(tmp, { decks, deckDir: path.join(SPIKE, "decks"), designs: DESIGNS, pdf: false, allPixels: true, noGeometry: true, quiet: true, slideHook: hook });
} finally { for (const f of copied) fs.rmSync(f, { force: true }); }

// pictures: one row per (deck, version, slide), one column per design
const rows = new Map();
for (const deck of manifest.decks) for (const d of DESIGNS) {
  const dd = path.join(tmp, deck, d); if (!fs.existsSync(dd)) continue;
  for (const v of fs.readdirSync(dd)) for (const f of fs.readdirSync(path.join(dd, v)).filter(f => /^slide-\d+\.png$/.test(f))) {
    const n = +/\d+/.exec(f)[0], key = `${deck}\u0000${v}\u0000${n}`, name = `${deck}-${v}-${n}-${d}.png`.replace(/[^\w.@=+-]/g, "_");
    fs.copyFileSync(path.join(dd, v, f), path.join(IMG, name));
    const r = rows.get(key) || { deck, version: v, n, img: {} }; r.img[d] = name; rows.set(key, r);
  }
}
const ORDER = ["p09-charts", "p09-tables-full", "p09-tables-hidden", "p09-tables-drop", "p09-cf"];
const NOTES = {
  "p09-charts·1": "F7 · The owner's reference chart rebuilt from loans-weekly.xlsx (09 §3.3): smoothed line on the left axis, actual-inside-target columns on the right axis, a dashed divider between the two category groups, the arrow from the axis floor, target icons and values above the columns, ofTarget percentages inside. Explicit colours (dark blue / grey) kept in every design (Q3).",
  "p09-charts·2": "F7, F15 · Column, stacked, 100 % stacked, bar; legends at four positions, one entry hidden (SME). Palettes: each design's own.",
  "p09-charts·3": "F7 · Line with markers and gridlines, smoothed stacked area, scatter with point labels, waterfall (up / down / total).",
  "p09-charts·4": "F7, F15 · Combined chart: columns on the left axis, a smoothed line with diamond markers on the right axis; legend on top with Corporate hidden from it.",
  "p09-charts·5": "F9 · Lines and annotations around three callouts (real 4.5 callouts): elbow callout line with its handles (stage overlay), curved dashed arrow, range marker with limiters, curly and square brackets, divider, heads of every kind.",
  "p09-charts·6": "F8 · Snapping while dragging the right card (stage overlay, pink, never exported): top edges aligned, equal spacing guides with the gap, the slide's centre (dashed) through the icon; the dashed blue box is where the pointer is.",
  "p09-charts·7": "F10 · Tabler icons on a slide: outline in the design's ink and palette, filled ones, sizes 24–96 and strokes 1,5–2 (round joins: the Stroke.join amendment).",
  "p09-tables-full·1": "F11 / F14 reference · the full table with its automated comment (and the consulting designs' KPI line / panel). The TOTAL row is empty in every picture: the corpus file report.xlsx has no cached value for its SUM (made by openpyxl) – not part of this work.",
  "p09-tables-hidden·1": "F11 · Rows Epsilon, Zeta, Eta hidden on the slide: the table closes up, the comment and the KPI line recompute from the shown rows. (Drawn through Excel's hidden-row path, which F11 reuses: the same pixels.)",
  "p09-tables-drop·1": "F14 · A delete-version: 3 rows and the columns Since / Note deleted (closed up), 6 cells emptied in place (today's removed cells).",
  "p09-cf·1": "F17 · Excel conditional formats: data bars (Loans), 3-arrow icon set (Δ w/w), 3-colour scale (Deposits) – the value moves right of an icon in the real renderer (here the prototype draws over the cell's left padding); Excel's look in the Excel designs, the design's own colours in Liquid Glass and the consulting designs (Q15).",
};
const list = [...rows.values()].filter(r => !(r.deck === "p09-tables-drop" && r.version === "full"))
  .sort((a, b) => ORDER.indexOf(a.deck) - ORDER.indexOf(b.deck) || a.version.localeCompare(b.version) || a.n - b.n);

// the icon picker mock (09 §3.5): search "target" and the category Charts, drawn from the package's own data
const svg = (n, s = 28) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${(outline[n] || []).map(([, a]) => `<path d="${a.d}"/>`).join("")}</svg>`;
const hitsFor = q => Object.keys(meta).filter(n => n.includes(q) || (meta[n].tags || []).some(t => String(t).includes(q)));
const cats = {}; for (const n in meta) { const c = meta[n].category || "Other"; cats[c] = (cats[c] || 0) + 1; }
const found = hitsFor("target");
const picker = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Icon picker</title><style>
body{margin:0;font:13px/1.35 'Segoe UI',Arial,sans-serif;background:#eef1f6;color:#16181d}
.win{width:860px;height:560px;margin:18px auto;background:#fff;border-radius:12px;box-shadow:0 12px 40px rgba(20,30,60,.22);display:grid;grid-template-rows:auto 1fr auto;overflow:hidden}
.top{display:flex;gap:10px;align-items:center;padding:12px 14px;border-bottom:1px solid #e3e6ec}.top b{font-size:15px;margin-right:auto}
input{width:320px;padding:7px 10px 7px 32px;border:1.5px solid #2563eb;border-radius:8px;font:inherit;background:#fff url("data:image/svg+xml,${encodeURIComponent(svg("search", 16))}") 9px 50% no-repeat}
.seg button{border:1px solid #c9ced8;background:#fff;padding:5px 10px;font:inherit}.seg button.on{background:#16181d;color:#fff}.seg button:first-child{border-radius:6px 0 0 6px}.seg button:last-child{border-radius:0 6px 6px 0}
.mid{display:grid;grid-template-columns:200px 1fr;min-height:0}.cats{overflow:auto;border-right:1px solid #e3e6ec;padding:6px 0}.cats div{padding:4px 14px;display:flex;justify-content:space-between;color:#3c4253}.cats div.on{background:#e8efff;color:#1d4ed8;font-weight:600}
.cats span{color:#8a93a3}.grid{overflow:auto;padding:12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:6px;align-content:start}
.t{display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 4px;border-radius:8px;color:#16181d;text-align:center;font-size:11px;word-break:break-word}.t:hover,.t.sel{background:#eef3ff;color:#1d4ed8}
.bot{display:flex;gap:12px;align-items:center;padding:10px 14px;border-top:1px solid #e3e6ec;color:#5b6274}.sw{width:18px;height:18px;border-radius:4px;border:1px solid #c9ced8;display:inline-block;vertical-align:middle}
.bot button{margin-left:auto;background:#2563eb;color:#fff;border:0;border-radius:8px;padding:7px 16px;font:inherit;font-weight:600}
</style></head><body><div class="win"><div class="top"><b>Insert icon</b><input value="target"><span class="seg"><button class="on">Outline</button><button>Filled</button></span></div>
<div class="mid"><div class="cats"><div class="on">All results <span>${found.length}</span></div>${Object.entries(cats).sort().map(([c, n]) => `<div>${esc(c === "Brand" ? "Brands (trademarks)" : c)} <span>${n}</span></div>`).join("")}</div>
<div class="grid">${found.slice(0, 60).map((n, i) => `<div class="t${i === 0 ? " sel" : ""}">${svg(n)}<div>${esc(n)}</div></div>`).join("")}</div></div>
<div class="bot">Colour <span class="sw" style="background:#1F3864"></span> Size <b>48 px</b> Stroke <b>2</b> · ${Object.keys(meta).length.toLocaleString("en")} icons, Tabler 3.49.0 (MIT) · search: name and tags<button>Insert</button></div></div></body></html>`;
fs.writeFileSync(path.join(OUT, "picker.html"), picker);

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>09 review</title>
<style>
body{font:14px/1.45 Segoe UI,Arial,sans-serif;margin:0;background:#f3f4f6;color:#111}
header{position:sticky;top:0;background:#fff;border-bottom:1px solid #ddd;padding:10px 16px;z-index:1}
h1{font-size:18px;margin:0 0 4px} section{padding:12px 16px;border-bottom:1px solid #e3e3e3}
.row{display:grid;grid-template-columns:repeat(${Math.min(DESIGNS.length, 4)},1fr);gap:10px} figure{margin:0} img{width:100%;border:1px solid #ccc;background:#fff}
figcaption{font-size:12px;color:#555} h2{font-size:14px;margin:0 0 4px} p.n{margin:0 0 8px;color:#333;max-width:1200px}
iframe{width:900px;height:600px;border:0}
</style></head><body>
<header><h1>Slide Builder 09 · Phase 0 pictures (prototypes; nothing ships before approval)</h1>
<div>Each slide drawn by the committed 4.5 page in every design, with the 09 prototypes (spikes/charts) added to its display list and drawn as the PNG export draws it. Build ${esc(manifest.git.slice(0, 7))} · ${esc(manifest.environment?.chromium || "")} · ${new Date().toISOString().slice(0, 10)}.</div></header>
${list.map(r => `<section><h2>${esc(r.deck)} · ${esc(r.version)} · slide ${r.n}</h2><p class="n">${esc(NOTES[`${r.deck}·${r.n}`] || "")}</p><div class="row">${DESIGNS.map(d => `<figure>${r.img[d] ? `<a href="img/${r.img[d]}" target="_blank"><img loading="lazy" src="img/${r.img[d]}" alt=""></a>` : "<div>–</div>"}<figcaption>${esc(nameOf(d))}</figcaption></figure>`).join("")}</div></section>`).join("\n")}
<section><h2>F10 · The icon picker (app interface, the same in every design)</h2><p class="n">Shapes & icons… (4.12; Insert shape ▾ › More icons… in 4.8–4.11): search over names and tags (here "target": ${found.length} icons), 41 categories, outline / filled, colour, size, stroke. Drawn from the package's own data.</p><iframe src="picker.html"></iframe></section>
</body></html>`;
fs.writeFileSync(path.join(OUT, "index.html"), html);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`review/P09: ${list.length} rows × ${DESIGNS.length} designs`);
