/* The S4.4 review package (B2, B7): every Liquid Glass slide of the corpus as the stage drew it before S4.4 (text
   measured by the page, "Segoe UI Variable") and after (text measured from the font files, static Segoe UI), with the
   heat map of their difference and the parity differences of that slide (tests/parity/accepted.json "B7 measured" /
   "B2"). The Excel designs need no package: their layouts are identical (parity: no geometry difference).
   Writes review/S4.4/index.html, review/S4.4/differences.json and review/S4.4/img/ (the pictures are not committed:
   regenerate them with this tool).

     node tools/s44-package.mjs --before <backend folder of the build before S4.4> --diffs <parity --diffs file>
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.join(REPO, "review", "S4.4"), IMG = path.join(OUT, "img");
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/* one build's glass slides: run as a child with --backend (capture-v3 reads it from the command line) */
if (process.argv.includes("--capture")) {
  const { capture } = await import("./capture-v3.mjs");
  const out = path.resolve(arg("--out"));
  await capture(out, { designs: ["glass"], pdf: false, quiet: true, noGeometry: true, slideHook: async (page, a) => {
    await page.waitForFunction(() => window.__sbTest.stageIdle(), null, { timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    const b = await page.locator("#stage .slide").first().boundingBox();
    fs.mkdirSync(a.dir, { recursive: true });
    fs.writeFileSync(path.join(a.dir, `stage-${a.slide + 1}.png`), await page.screenshot({ clip: { x: Math.round(b.x), y: Math.round(b.y), width: 1600, height: 900 }, animations: "disabled", caret: "hide" }));
  } });
  process.exit(0);
}

const before = arg("--before", null), diffsFile = arg("--diffs", null);
if (!before || !diffsFile) { console.error("usage: node tools/s44-package.mjs --before <backend dir> --diffs <file>"); process.exit(2); }
const { comparePixels, decodePng, encodePng } = await import("./parity.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sb-s44-"));
const run = (backend, out) => { const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--capture", "--out", out, ...(backend ? ["--backend", backend] : [])], { stdio: "inherit" }); if (r.status) throw new Error("capture failed: " + out); };
console.log("capturing the build before S4.4..."); run(path.resolve(before), path.join(tmp, "before"));
console.log("capturing this build..."); run(null, path.join(tmp, "after"));
fs.rmSync(IMG, { recursive: true, force: true }); fs.mkdirSync(IMG, { recursive: true });
const diffs = JSON.parse(fs.readFileSync(diffsFile, "utf8")).filter(d => d.design === "glass" && d.kind !== "sp");
const rows = [];
const dirs = d => fs.existsSync(d) ? fs.readdirSync(d).filter(f => fs.statSync(path.join(d, f)).isDirectory()) : [];
for (const deck of dirs(path.join(tmp, "after"))) for (const version of dirs(path.join(tmp, "after", deck, "glass"))) {
  const A = path.join(tmp, "after", deck, "glass", version), B = path.join(tmp, "before", deck, "glass", version);
  for (const f of fs.readdirSync(A).filter(f => /^stage-\d+\.png$/.test(f)).sort((a, b) => a.localeCompare(b, "en", { numeric: true }))) {
    const n = +/\d+/.exec(f)[0], name = `${deck}-${version}-${n}`;
    if (!fs.existsSync(path.join(B, f))) continue;
    const a = fs.readFileSync(A + "/" + f), b = fs.readFileSync(B + "/" + f), r = comparePixels(decodePng(b), decodePng(a), { range: true });
    fs.writeFileSync(path.join(IMG, name + "-before.png"), b); fs.writeFileSync(path.join(IMG, name + "-after.png"), a);
    if (r.heat) fs.writeFileSync(path.join(IMG, name + "-heat.png"), encodePng(r.w, r.h, r.heat));
    const mine = diffs.filter(d => d.deck === deck && d.version === version && (d.file === `slide-${n}.json` || d.file === `slide-${n}.png` || d.file === "pdf.json"));
    rows.push({ deck, version, slide: n, name, fraction: r.fraction, heat: !!r.heat, diffs: mine.map(d => ({ kind: d.kind, file: d.file, detail: d.detail })) });
  }
}
fs.writeFileSync(path.join(OUT, "differences.json"), JSON.stringify(rows, null, 1));
const kinds = k => rows.reduce((s, r) => s + r.diffs.filter(d => d.kind === k || (k === "font" && d.kind === "style" && /: font /.test(d.detail))).length, 0);
fs.writeFileSync(path.join(OUT, "index.html"), `<!doctype html><meta charset="utf-8"><title>S4.4 review: measured text</title>
<style>body{font:14px/1.45 "Segoe UI",Arial,sans-serif;margin:24px;color:#16181d}h1{font-size:22px}table{border-collapse:collapse}td{vertical-align:top;padding:6px;border-top:1px solid #ddd}
img{width:520px;display:block;border:1px solid #ccc}.d{font:12px Consolas,monospace;max-height:220px;overflow:auto;white-space:pre-wrap;width:520px}</style>
<h1>S4.4 · Liquid Glass with text measured from the font files (B2, B7)</h1>
<p>Each row: the slide <b>before</b> S4.4 (left), <b>after</b> (middle), and where their pixels differ (right), then the parity differences of the slide (the goldens are v3's).
${rows.length} Liquid Glass slides; ${kinds("geometry")} element positions or sizes, ${kinds("font")} font lists (B2), ${kinds("pixels")} screenshots, ${kinds("pdf-text")} PDF line breaks differ from v3.
Excel and Excel Refined: no difference (their fonts measure the same in the browser and from the files).</p>
<p>What changed: <b>B2</b> – Liquid Glass text is static Segoe UI on screen, as the PDF already was (as Chromium matches a Windows font, the nearest static face: weight 470 draws as Segoe UI Regular, 500–640 – text, values, labels – as Semibold, 650–740 – bold cells, headings, sections, emphasis – as Bold; the variable font drew each weight exactly. The PDF now takes the same faces – 3.7's took the CSS rule's, e.g. Black for headings).
<b>B7</b> – the glass columns are as wide as their text measured in that font (v3 estimated 0.56 em a character, so most tables were wider than their text needed): tables are 1.5–15 % narrower (median 4.4 %), centred, and the text boxes beside them follow; text boxes are fitted on their own layout.</p>
<table>${rows.map(r => `<tr><td><b>${esc(r.deck)} · ${esc(r.version)} · slide ${r.slide}</b><br>${(r.fraction * 100).toFixed(1)} % of the pixels differ<br><img src="img/${r.name}-before.png" loading="lazy"></td>
<td><br><br><img src="img/${r.name}-after.png" loading="lazy"></td><td><br><br>${r.heat ? `<img src="img/${r.name}-heat.png" loading="lazy">` : ""}</td></tr>
<tr><td colspan="3"><div class="d">${r.diffs.length ? esc(r.diffs.map(d => `${d.kind}: ${d.detail}`).join("\n")) : "no difference from v3"}</div></td></tr>`).join("")}</table>`);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`review/S4.4: ${rows.length} slides`);
