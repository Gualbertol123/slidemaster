/* The pixel review of the series charts (M14 S14.3, gate 🚦 G9; as tools/m9-package.mjs was for the pies, G6): every
   slide of the chart corpus (tests/corpus/charts – columns and bars, series.json; lines, areas, combos, category groups,
   marks and the owner's reference chart "Loans Volume – Weekly Evolution", lines.json slide 1; scatter and waterfall
   charts, scatter-waterfall.json – S14.4) drawn from its display
   list – as the stage, the PNG export and the thumbnails draw it – in every design of the switch, with the PowerPoint
   file of each deck beside it (Export ▾ › PowerPoint: native charts, the marks as plain shapes over them) to open in
   PowerPoint. Writes review/G9/index.html, review/G9/img/ and review/G9/pptx/ (not committed: regenerate them).

     node tools/m14-package.mjs [--decks series,lines,scatter-waterfall] [--designs glass,excel,clean,mckinsey,bain] [--out DIR]

   (S14.6) --out writes the package elsewhere (default review/G9). The PowerPoint files are the page's own exports: the
   owner opens them in PowerPoint (PX-05: Edit Data; PX-06: the marks on the data – `python tools\pptxcheck.py plots`
   with the .plots.json files that `CHART_PPTX_OUT=<dir> npx vitest run tests/pptx-charts-m14.test.ts` writes in core/).
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOOKS, capture, CORPUS, deckOps, load, openBrowser, startHelper } from "./capture-v3.mjs";
import { exportOnce } from "./export-check.mjs";
import { slideHook } from "./dlparity.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg("--out", path.join(REPO, "review", "G9"))), IMG = path.join(OUT, "img"), PPTX = path.join(OUT, "pptx"), CHARTS = path.join(CORPUS, "charts");
const DESIGNS = arg("--designs", "glass,excel,clean,mckinsey,bain").split(","), decks = arg("--decks", "series,lines,scatter-waterfall").split(",");
const NAMES0 = { glass: "Liquid Glass", excel: "Excel", clean: "Excel Refined", mckinsey: "Consulting Navy", bain: "Consulting Red" };
// a design with options ("mckinsey@headline=panel") is named with them
const NAMES = new Proxy({}, { get: (_t, k) => { const [d, o] = String(k).split("@"); return NAMES0[d] + (o ? " · " + o.replace(/=/g, ": ").replace(/\+/g, " · ") : ""); } });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sb-m14-"));
for (const d of [IMG, PPTX]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); }
console.log(`drawing ${DESIGNS.join(", ")}…`);
const manifest = await capture(tmp, { decks, deckDir: CHARTS, designs: DESIGNS, pdf: false, allPixels: true, noGeometry: true, quiet: true,
  slideHook: (page, a) => slideHook(page, { ...a, pixels: true }) });
// the PowerPoint file of each deck in each design, through the page's own Export ▾ › PowerPoint (as export-check does)
const pptx = [];
{
  const h = await startHelper(), { browser, page } = await openBrowser();
  try {
    for (const id of decks) {
      const deck = JSON.parse(fs.readFileSync(path.join(CHARTS, id + ".json"), "utf8")), file = id + path.extname(deck.workbook);
      fs.copyFileSync(path.join(BOOKS, deck.workbook), path.join(h.root, file));
      await deckOps(h, file, deck.ops);
      for (const design of DESIGNS) {
        await deckOps(h, file, [{ op: "style.patch", patch: { design: design.split("@")[0] } }]);
        await load(page, h, file, "");
        const x = await exportOnce(page, h, async () => { await page.click("#exportMenuBtn"); await page.click('[data-x="pptx"]'); });
        const name = `${id}-${design.split("@")[0]}.pptx`;
        fs.copyFileSync(x.files[0], path.join(PPTX, name)); pptx.push(name);
        // (S14.6, PX-06) beside it what PowerPoint's plots must be: each series chart's frame, plot and value axes as the
        // page's own export laid them out (pptxcheck.py plots, on Windows)
        const lists = await page.evaluate(d => window.__sbTest.slideLists({ design: d, version: "", forExport: true, thumb: false, pptx: true }), design.split("@")[0]);
        const plots = lists.flatMap((l, i) => Object.values(l.sem?.items || {}).flatMap(it => it?.kind === "chart" && it.chart?.bars ? [{ slide: i + 1, frame: it.chart.box, plot: it.chart.bars.plot,
          val: { min: it.chart.bars.val.min, max: it.chart.bars.val.max }, ...(it.chart.bars.val2 ? { val2: { min: it.chart.bars.val2.min, max: it.chart.bars.val2.max } } : {}) }] : []));
        fs.writeFileSync(path.join(PPTX, name.replace(/\.pptx$/, ".plots.json")), JSON.stringify(plots, null, 1));
      }
    }
  } finally { await browser.close(); h.stop(); }
}
const rows = new Map();                                   // deck · version · slide → { design: img }
for (const deck of manifest.decks) for (const d of DESIGNS) {
  const dd = path.join(tmp, deck, d); if (!fs.existsSync(dd)) continue;
  for (const v of fs.readdirSync(dd)) for (const f of fs.readdirSync(path.join(dd, v)).filter(f => /^slide-\d+\.png$/.test(f))) {
    const n = +/\d+/.exec(f)[0], key = `${deck}\u0000${v}\u0000${n}`, name = `${deck}-${v}-${n}-${d}.png`.replace(/[^\w.@=+-]/g, "_");
    fs.copyFileSync(path.join(dd, v, f), path.join(IMG, name));
    const label = JSON.parse(fs.readFileSync(path.join(dd, v, `slide-${n}.json`), "utf8")).label || "";
    const r = rows.get(key) || { deck, version: v, n, label, img: {} }; r.img[d] = name; rows.set(key, r);
  }
}
const list = [...rows.values()].sort((a, b) => a.deck.localeCompare(b.deck) || a.version.localeCompare(b.version) || a.n - b.n);
const deckNames = [...new Set(list.map(r => r.deck))];
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Series chart review</title>
<style>
.pp a{margin-right:10px}
body{font:14px/1.4 Segoe UI,Arial,sans-serif;margin:0;background:#f3f4f6;color:#111}
header{position:sticky;top:0;background:#fff;border-bottom:1px solid #ddd;padding:10px 16px;z-index:1}
h1{font-size:18px;margin:0 0 6px} .f button{margin:2px;padding:3px 8px;border:1px solid #bbb;background:#fff;border-radius:4px;cursor:pointer}
.f button.on{background:#111;color:#fff} section{padding:12px 16px;border-bottom:1px solid #e3e3e3}
.row{display:grid;grid-template-columns:repeat(${DESIGNS.length},1fr);gap:10px} figure{margin:0} img{width:100%;border:1px solid #ccc;background:#fff}
figcaption{font-size:12px;color:#555} h2{font-size:14px;margin:0 0 6px}
</style></head><body>
<header><h1>M14 · Series charts – pixel review, gate G9 (${list.length} slides × ${DESIGNS.length} designs)</h1>
<div>Every slide of the chart corpus (tests/corpus/charts) drawn from its display list, as the stage, the PNG export and the thumbnails draw it; lines · slide 1 is the owner's reference chart (09 §3.3). Build ${esc(manifest.git.slice(0, 7))} · ${esc(manifest.environment?.chromium || "")}.</div>
<div class="pp">PowerPoint: ${pptx.map(f => `<a href="pptx/${esc(f)}">${esc(f)}</a>`).join("")}</div>
<div class="f" id="f"><button class="on" data-d="">All decks</button>${deckNames.map(d => `<button data-d="${esc(d)}">${esc(d)}</button>`).join("")}</div></header>
${list.map(r => `<section data-deck="${esc(r.deck)}"><h2>${esc(r.deck)} · ${esc(r.version)} · slide ${r.n} ${esc(r.label)}</h2><div class="row">${DESIGNS.map(d => `<figure>${r.img[d] ? `<a href="img/${r.img[d]}" target="_blank"><img loading="lazy" src="img/${r.img[d]}" alt=""></a>` : "<div>–</div>"}<figcaption>${NAMES[d]}</figcaption></figure>`).join("")}</div></section>`).join("\n")}
<script>
document.getElementById("f").onclick = e => { const b = e.target.closest("button"); if (!b) return;
  document.querySelectorAll("#f button").forEach(x => x.classList.toggle("on", x === b));
  document.querySelectorAll("section").forEach(s => s.style.display = !b.dataset.d || s.dataset.deck === b.dataset.d ? "" : "none"); };
</script></body></html>`;
fs.writeFileSync(path.join(OUT, "index.html"), html);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`m14-package: ${list.length} slide(s), ${pptx.length} PowerPoint file(s) → ${path.relative(process.cwd(), path.join(OUT, "index.html"))}`);
