/* The G1 review package (PLAN S3.6): every corpus slide in every design, as the screen shows it today (the HTML
   path, which is v3 – `npm run parity` holds it to the goldens) next to the same slide drawn from its display list
   (what export and, from M4, the screen will draw), with the heat map of their difference; filters by design, deck
   and result; the accepted differences (tests/parity/accepted.json) and the Liquid Glass summary per look.
   Writes review/G1/index.html and review/G1/img/ (the pictures are not committed: regenerate them with this tool).

     node tools/g1-package.mjs [--decks a,b] [--designs glass,excel,clean]   (npm run g1)
     node tools/g1-package.mjs --index        the page again from review/G1/slides.json (no capture)
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { capture } from "./capture-v3.mjs";
import { comparePixels, decodePng, encodePng, PIXEL_FRACTION } from "./parity.mjs";
import { slideHook } from "./dlparity.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.join(REPO, "review", "G1"), IMG = path.join(OUT, "img");
const DESIGNS = arg("--designs", "glass,excel,clean").split(","), decks = arg("--decks", null)?.split(",");
const NAMES = { glass: "Liquid Glass", excel: "Excel", clean: "Excel Refined" };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** the theme × glass level × contrast of a corpus deck (its style ops over the defaults) */
function lookOf(deck) {
  const d = JSON.parse(fs.readFileSync(path.join(REPO, "tests", "corpus", "decks", deck + ".json"), "utf8")), st = {};
  for (const o of d.ops) if (o.op === "style.patch") Object.assign(st, o.patch);
  return `${st.theme?.id || "aurora"} × ${st.glass || "subtle"} × contrast ${st.contrast ?? 50}`;
}

async function captureRows() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sb-g1-"));
  fs.rmSync(IMG, { recursive: true, force: true }); fs.mkdirSync(IMG, { recursive: true });
  // each slide: the page's own picture (HTML), then the display list's (the hook writes it as the slide's png)
  const hook = async (page, a) => {
    const b = await page.locator("#stage .slide").first().boundingBox();
    const shot = await page.screenshot({ clip: { x: Math.round(b.x), y: Math.round(b.y), width: 1600, height: 900 }, animations: "disabled", caret: "hide" });
    fs.mkdirSync(a.dir, { recursive: true });
    fs.writeFileSync(path.join(a.dir, `html-${a.slide + 1}.png`), shot);
    return slideHook(page, { ...a, pixels: true });
  };
  console.log(`G1 package: ${DESIGNS.join(", ")}, every slide and version…`);
  try {
    await capture(tmp, { decks: decks || undefined, designs: DESIGNS, pdf: false, quiet: true, allPixels: true, slideHook: hook });
    return compareRows(tmp);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

function compareRows(tmp) {
  const accepted = JSON.parse(fs.readFileSync(path.join(REPO, "tests", "parity", "accepted.json"), "utf8"));
  const rows = [];
  for (const deck of fs.readdirSync(tmp).filter(d => fs.statSync(path.join(tmp, d)).isDirectory()).sort())
    for (const design of DESIGNS) {
      const dd = path.join(tmp, deck, design); if (!fs.existsSync(dd)) continue;
      for (const version of fs.readdirSync(dd).sort()) for (const f of fs.readdirSync(path.join(dd, version)).filter(f => /^slide-\d+\.png$/.test(f)).sort((a, b) => parseInt(a.slice(6)) - parseInt(b.slice(6)))) {
        const n = parseInt(f.slice(6)), html = path.join(dd, version, `html-${n}.png`), dl = path.join(dd, version, f);
        if (!fs.existsSync(html)) continue;
        const r = comparePixels(decodePng(fs.readFileSync(html)), decodePng(fs.readFileSync(dl)), { range: true });
        const base = `${deck}-${design}-${version}-${n}`.replace(/[^\w.-]+/g, "_");
        fs.copyFileSync(html, path.join(IMG, base + "-v3.png")); fs.copyFileSync(dl, path.join(IMG, base + "-dl.png"));
        if (r.heat) fs.writeFileSync(path.join(IMG, base + "-heat.png"), encodePng(r.w, r.h, r.heat));
        const acc = accepted.find(a => a.tool === "dlparity" && a.kind === "pixels" && ["deck", "design", "version", "file"].every(k => a[k] === undefined || a[k] === { deck, design, version, file: f }[k]));
        rows.push({ deck, design, version, n, base, pct: +(r.fraction * 100).toFixed(2), maxDE: r.maxDE, within: r.fraction <= PIXEL_FRACTION, accepted: acc?.reason || null });
      }
    }
  fs.writeFileSync(path.join(OUT, "slides.json"), JSON.stringify(rows, null, 1));
  return rows;
}

function writeIndex(rows) {
  const accepted = JSON.parse(fs.readFileSync(path.join(REPO, "tests", "parity", "accepted.json"), "utf8"));
  // Liquid Glass beyond the limit: the glass recipe (README point 1) – named, not accepted, until G1 decides
  for (const r of rows) r.state = r.within ? "within" : r.accepted ? "accepted" : r.design === "glass" ? "glass" : "over";
  const by = d => rows.filter(r => r.design === d);
  const summary = DESIGNS.map(d => `<tr><td>${NAMES[d]}</td><td>${by(d).length}</td><td>${by(d).filter(r => r.within).length}</td><td>${by(d).filter(r => !r.within).length}</td><td>${Math.max(0, ...by(d).map(r => r.pct))} %</td></tr>`).join("");
  const label = { within: "", accepted: " – accepted, pending G1", glass: " – Liquid Glass, not in accepted.json (no golden screenshot)", over: " – not accepted" };
  const cards = rows.map(r => `<section class="slide" data-design="${r.design}" data-deck="${esc(r.deck)}" data-state="${r.state}">
<h3>${esc(r.deck)} · ${NAMES[r.design]} · ${esc(r.version)} · slide ${r.n} <span class="badge ${r.state === "within" ? "ok" : r.state === "over" ? "bad" : "acc"}">${r.pct} % of the pixels differ${label[r.state]}</span></h3>
<div class="row"><figure><a href="img/${r.base}-v3.png"><img loading="lazy" src="img/${r.base}-v3.png" alt=""></a><figcaption>today (HTML)</figcaption></figure><figure><a href="img/${r.base}-dl.png"><img loading="lazy" src="img/${r.base}-dl.png" alt=""></a><figcaption>display list (export, M4 screen)</figcaption></figure>${r.pct ? `<figure><a href="img/${r.base}-heat.png"><img loading="lazy" src="img/${r.base}-heat.png" alt=""></a><figcaption>difference (heat map)</figcaption></figure>` : ""}</div></section>`).join("\n");
  const accRows = accepted.map(a => `<tr><td>${esc(a.tool || "parity")}</td><td>${esc([a.deck, a.design, a.version, a.file].filter(Boolean).join(" · "))}</td><td>${esc(a.kind)}</td><td>${esc(a.reason)}</td><td>${esc(a.signedOff)}</td></tr>`).join("");
  const looks = {};
  for (const r of rows.filter(r => r.design === "glass")) (looks[lookOf(r.deck)] ||= []).push(r);
  const gpRows = Object.entries(looks).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${[...new Set(v.map(x => x.deck))].join(", ")}</td><td>${v.length}</td><td>${v.filter(x => x.within).length}</td><td>${Math.max(0, ...v.map(x => x.pct))} %</td></tr>`).join("");
  const decksList = [...new Set(rows.map(r => r.deck))];
  fs.writeFileSync(path.join(OUT, "index.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>G1 pixel review</title>
<style>
:root{--bg:#fff;--ink:#1d1d1f;--muted:#6b7280;--line:#e5e7eb;--ok:#15803d;--acc:#b45309;--bad:#b91c1c}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#111318;--ink:#e5e7eb;--muted:#9ca3af;--line:#2a2f3a}}
body{background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,"Segoe UI",Arial,sans-serif;margin:0 auto;max-width:1600px;padding:16px;overflow-wrap:anywhere}
table{display:block;overflow-x:auto;max-width:100%}
table{border-collapse:collapse;margin:8px 0 20px}td,th{border:1px solid var(--line);padding:4px 8px;text-align:left;vertical-align:top}
.filters{position:sticky;top:0;background:var(--bg);padding:8px 0;border-bottom:1px solid var(--line);display:flex;flex-wrap:wrap;gap:12px;z-index:2}
.row{display:flex;gap:8px;flex-wrap:wrap}figure{margin:0;flex:1 1 300px;min-width:0}img{width:100%;height:auto;border:1px solid var(--line)}
figcaption{color:var(--muted);font-size:12px}.badge{font-size:12px;font-weight:600;padding:2px 6px;border-radius:4px;margin-left:6px}
.ok{color:var(--ok)}.acc{color:var(--acc)}.bad{color:var(--bad)}h3{font-size:15px;margin:22px 0 6px}.slide.hide{display:none}
</style></head><body>
<h1>G1 · pixel review of the display list</h1>
<p id="noimg" hidden><b>The pictures are not here:</b> they are made by <code>npm run g1</code> and sent with this page (review/G1 as a zip). </p>
<p>Each slide of the corpus in each design: <b>today</b> (the HTML the app shows, which <code>npm run parity</code> holds to v3) and the <b>display list</b> (what export and, from M4, the screen draw), with a heat map where they differ (CIEDE2000 over 2, tools/parity.mjs). See README.md for what to look at and how to answer.</p>
<table><tr><th>Design</th><th>Slides</th><th>Within 1 %</th><th>Beyond</th><th>Most</th></tr>${summary}</table>
${gpRows ? `<h2>Liquid Glass per look</h2><table><tr><th>Theme × glass level × contrast</th><th>Decks</th><th>Slides</th><th>Within 1 %</th><th>Most</th></tr>${gpRows}</table>` : ""}
<h2>Accepted differences</h2><table><tr><th>Tool</th><th>Where</th><th>Kind</th><th>Reason</th><th>Signed off</th></tr>${accRows}</table>
<div class="filters"><label>Design <select id="fd"><option value="">all</option>${DESIGNS.map(d => `<option value="${d}">${NAMES[d]}</option>`).join("")}</select></label>
<label>Deck <select id="fk"><option value="">all</option>${decksList.map(d => `<option>${esc(d)}</option>`).join("")}</select></label>
<label>Result <select id="fs"><option value="">all</option><option value="over">beyond 1 %, not accepted</option><option value="glass">beyond 1 %, Liquid Glass without a golden screenshot</option><option value="accepted">accepted, pending G1</option><option value="within">within 1 %</option></select></label>
<span id="count"></span></div>
${cards}
<script>
const f=()=>{const d=fd.value,k=fk.value,s=fs.value;let n=0;document.querySelectorAll(".slide").forEach(e=>{const show=(!d||e.dataset.design===d)&&(!k||e.dataset.deck===k)&&(!s||e.dataset.state===s);e.classList.toggle("hide",!show);n+=show});count.textContent=n+" slide(s)";};
[fd,fk,fs].forEach(e=>e.addEventListener("change",f));f();
const first=document.querySelector(".slide img");if(first){const t=new Image();t.onerror=()=>{noimg.hidden=false};t.src=first.getAttribute("src");}
</script></body></html>
`);
  console.log(`review/G1: ${rows.length} slide(s); ${DESIGNS.map(d => `${NAMES[d]} ${by(d).filter(r => r.within).length}/${by(d).length} within 1 %`).join(" · ")}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = process.argv.includes("--index") ? JSON.parse(fs.readFileSync(path.join(OUT, "slides.json"), "utf8")) : await captureRows();
  writeIndex(rows);
}
