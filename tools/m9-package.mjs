/* The pixel review of the pie / donut recipe (M9 S9.2, gate 🚦 G6; as tools/m7b-package.mjs was for M7b): every slide of
   the chart corpus (tests/corpus/charts) drawn from its display list – as the stage, the PNG export and the thumbnails
   draw it – in every design of the switch. Writes review/S9.2/index.html and review/S9.2/img/ (the pictures are not
   committed: regenerate them with this tool).

     node tools/m9-package.mjs [--decks a,b] [--designs glass,excel,clean,mckinsey,bain]
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { capture, CORPUS } from "./capture-v3.mjs";
import { slideHook } from "./dlparity.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.join(REPO, "review", "S9.2"), IMG = path.join(OUT, "img"), CHARTS = path.join(CORPUS, "charts");
const DESIGNS = arg("--designs", "glass,excel,clean,mckinsey,bain").split(","), decks = arg("--decks", null)?.split(",");
const NAMES0 = { glass: "Liquid Glass", excel: "Excel", clean: "Excel Refined", mckinsey: "Consulting Navy", bain: "Consulting Red" };
// a design with options ("mckinsey@headline=panel") is named with them
const NAMES = new Proxy({}, { get: (_t, k) => { const [d, o] = String(k).split("@"); return NAMES0[d] + (o ? " · " + o.replace(/=/g, ": ").replace(/\+/g, " · ") : ""); } });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sb-m9-"));
fs.rmSync(IMG, { recursive: true, force: true }); fs.mkdirSync(IMG, { recursive: true });
console.log(`drawing ${DESIGNS.join(", ")}…`);
const manifest = await capture(tmp, { decks, deckDir: CHARTS, designs: DESIGNS, pdf: false, allPixels: true, noGeometry: true, quiet: true,
  slideHook: (page, a) => slideHook(page, { ...a, pixels: true }) });
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
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Chart pixel review</title>
<style>
body{font:14px/1.4 Segoe UI,Arial,sans-serif;margin:0;background:#f3f4f6;color:#111}
header{position:sticky;top:0;background:#fff;border-bottom:1px solid #ddd;padding:10px 16px;z-index:1}
h1{font-size:18px;margin:0 0 6px} .f button{margin:2px;padding:3px 8px;border:1px solid #bbb;background:#fff;border-radius:4px;cursor:pointer}
.f button.on{background:#111;color:#fff} section{padding:12px 16px;border-bottom:1px solid #e3e3e3}
.row{display:grid;grid-template-columns:repeat(${DESIGNS.length},1fr);gap:10px} figure{margin:0} img{width:100%;border:1px solid #ccc;background:#fff}
figcaption{font-size:12px;color:#555} h2{font-size:14px;margin:0 0 6px}
</style></head><body>
<header><h1>M9 · Pie and donut charts – pixel review, gate G6 (${list.length} slides × ${DESIGNS.length} designs)</h1>
<div>Every slide of the chart corpus (tests/corpus/charts) drawn from its display list, as the stage, the PNG export and the thumbnails draw it. Build ${esc(manifest.git.slice(0, 7))} · ${esc(manifest.environment?.chromium || "")}.</div>
<div class="f" id="f"><button class="on" data-d="">All decks</button>${deckNames.map(d => `<button data-d="${esc(d)}">${esc(d)}</button>`).join("")}</div></header>
${list.map(r => `<section data-deck="${esc(r.deck)}"><h2>${esc(r.deck)} · ${esc(r.version)} · slide ${r.n} ${esc(r.label)}</h2><div class="row">${DESIGNS.map(d => `<figure>${r.img[d] ? `<a href="img/${r.img[d]}" target="_blank"><img loading="lazy" src="img/${r.img[d]}" alt=""></a>` : "<div>–</div>"}<figcaption>${NAMES[d]}</figcaption></figure>`).join("")}</div></section>`).join("\n")}
<script>
document.getElementById("f").onclick = e => { const b = e.target.closest("button"); if (!b) return;
  document.querySelectorAll("#f button").forEach(x => x.classList.toggle("on", x === b));
  document.querySelectorAll("section").forEach(s => s.style.display = !b.dataset.d || s.dataset.deck === b.dataset.d ? "" : "none"); };
</script></body></html>`;
fs.writeFileSync(path.join(OUT, "index.html"), html);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`m9-package: ${list.length} slide(s) → ${path.relative(process.cwd(), path.join(OUT, "index.html"))}`);
