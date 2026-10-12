/* The native export checked on the corpus (PLAN S3.7, PROMPTS Prompt 5 protocol 3): every deck in every design
   opened in the app, exported with the Export button (the export workers, saved by the helper) and, with --old,
   with the menu's "old engine" item too. Each native PDF is then checked:
   * qpdf --check, no Type 3, no variable fonts (tools/pdfcheck.py check);
   * its selectable text against the goldens (GT, decision 2026-10-12, 5): every golden text of each slide on its
     page, nothing else, the page count = the slide count;
   * old vs new: the page count, and each page's text (whitespace ignored) – a difference is reported for the review;
   * GF budgets (PLAN Part F): Excel designs < 40 KB per slide, Liquid Glass < 80 KB per slide + 190 KB per document –
     gated on deck20 (the 20-slide reference, as the bench); for decks of 1–3 slides the fonts and the wallpaper, a cost per
     document, can exceed it: reported, not gated (PROGRESS, Waiting for);
   * the time from the click to the saved file (the page's own clock), ⏱ deck20: Liquid Glass < 2 s, Excel < 1 s – scaled
     by this machine's speed as `npm run bench` scales its limits (tools/calibrate.mjs, at most 2×).

   With --pictures, each deck is also exported "as pictures" (B9: 2× PNG pages): size and time are recorded.

     node tools/export-check.mjs [--decks a,b] [--designs glass,excel,clean] [--old] [--pictures] [--out <dir>] [--json <file>]
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BOOKS, DECKS, deckList, load, openBrowser, startHelper, wbPath } from "./capture-v3.mjs";
import { goldenTexts, matchTexts } from "./export-dl.mjs";
import { speedFactor } from "./calibrate.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PY = process.platform === "win32" ? "python" : "python3";
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const BUDGET = {
  /** bytes per slide (+ per document), PLAN Part F */
  size: { excel: [40 * 1024, 0], clean: [40 * 1024, 0], glass: [80 * 1024, 190 * 1024] },
  /** ms from the click to the file for 20 slides, PLAN Part F */
  time: { excel: 1000, clean: 1000, glass: 2000 },
};
const squash = s => s.normalize("NFKC").replace(/\s+/g, "");

/** clicks an export and waits for its toast; returns the files it saved (the names the page was given back) and the
    page's click-to-file time */
export async function exportOnce(page, h, click) {
  const dir = path.join(h.root, "export");
  const seen = await page.evaluate(() => { window.__sbTest.lastExport.files = []; return window.__sbTest.toastNow()?.id || 0; });
  await click();
  const handle = await page.waitForFunction(seen => { const T = window.__sbTest, t = T.toastNow(); return !T.exporting() && t && t.id > seen && /Saved|failed|copied|Downloaded/.test(t.html) ? t.html : false; }, seen, { timeout: 180_000 });
  const toast = String(await handle.jsonValue()).replace(/<[^>]+>/g, "");
  if (/failed/.test(toast)) throw new Error("export failed: " + toast);
  const { files, ms } = await page.evaluate(() => ({ files: [...window.__sbTest.lastExport.files], ms: window.__sbTest.lastExport.ms }));
  // the old engine's toast names its file (it does not set lastExport)
  const named = files.length ? files : [...toast.matchAll(/Saved (.+?) in the export folder/g)].flatMap(m => m[1].split(", "));
  return { files: named.map(f => path.join(dir, f)), ms, toast };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const OUT = path.resolve(arg("--out", fs.mkdtempSync(path.join(os.tmpdir(), "sb-export-check-"))));
  const DESIGNS = arg("--designs", "glass,excel,clean").split(",");
  const decks = deckList(arg("--decks", null)?.split(",") || null);
  const OLD = process.argv.includes("--old"), PICTURES = process.argv.includes("--pictures");
  fs.mkdirSync(OUT, { recursive: true });
  const h = await startHelper(), results = [];
  let browser = null;
  try {
    const b = await openBrowser(), page = b.page;
    browser = b.browser;
    for (const id of decks) {
      const deck = JSON.parse(fs.readFileSync(path.join(DECKS, id + ".json"), "utf8"));
      const file = id + path.extname(deck.workbook);
      fs.copyFileSync(path.join(BOOKS, deck.workbook), path.join(h.root, file));
      await h.api(wbPath(file) + "/ops", "POST", { ops: deck.ops, client: "golden" });
      for (const design of DESIGNS) {
        await h.api(wbPath(file) + "/ops", "POST", { ops: [{ op: "style.patch", patch: { design } }], client: "golden" });
        const slides = await load(page, h, file, "");
        const r = { deck: id, design, slides };
        const n = await exportOnce(page, h, () => page.click("#exportBtn"));
        if (n.files.length !== 1) throw new Error(`${id} · ${design}: ${n.files.length} files`);
        r.file = path.join(OUT, `${id}-${design}.pdf`); fs.copyFileSync(n.files[0], r.file);
        r.name = path.basename(n.files[0]); r.ms = Math.round(n.ms); r.bytes = fs.statSync(r.file).size; r.toast = n.toast;
        if (PICTURES) {
          const p = await exportOnce(page, h, async () => { await page.click("#exportMenuBtn"); await page.click('[data-x="pdf-exact"]'); });
          r.pictures = { bytes: fs.statSync(p.files[0]).size, ms: Math.round(p.ms) };
          await exportOnce(page, h, async () => { await page.click("#exportMenuBtn"); await page.click('[data-x="pdf-vector"]'); });
          // the remembered mode is saved 400 ms later: the next load() must not write "pictures" back
          for (let i = 0; i < 100 && ((await h.api("/api/me")).prefs || {}).pdfMode !== "vector"; i++) await sleep(100);
        }
        if (OLD) {
          await page.locator("#srv").filter({ hasText: /Export: / }).waitFor({ timeout: 180_000 });
          const o = await exportOnce(page, h, async () => { await page.click("#exportMenuBtn"); await page.click('[data-x="pdf-old"]'); });
          r.old = path.join(OUT, `${id}-${design}-old.pdf`); fs.copyFileSync(o.files[0], r.old); r.oldName = path.basename(o.files[0]);
        }
        results.push(r);
        console.log(`${id} · ${design}: ${slides} slide(s), ${(r.bytes / 1024).toFixed(1)} KB, ${r.ms} ms${r.pictures ? ` · as pictures ${(r.pictures.bytes / 1048576).toFixed(1)} MB, ${r.pictures.ms} ms` : ""}${/default font/.test(r.toast) ? " – " + r.toast.split("·").pop().trim() : ""}`);
      }
    }
  } catch (e) {
    console.error("helper's last output:\n" + h.log().slice(-4000));
    throw e;
  } finally { await browser?.close(); h.stop(); }

  // the checks
  let ok = true;
  const env = { ...process.env, PYTHONIOENCODING: "utf-8" }, speed = speedFactor();
  const files = results.flatMap(r => [r.file, ...(r.old ? [r.old] : [])]);
  let checked = "";
  try { checked = execFileSync(PY, [path.join(REPO, "tools", "pdfcheck.py"), "check", ...results.map(r => r.file)], { encoding: "utf8", env }); }
  catch (e) { checked = String(e.stdout || ""); ok = false; }
  process.stdout.write(checked);
  const info = JSON.parse(execFileSync(PY, [path.join(REPO, "tools", "pdfcheck.py"), "info", ...files], { encoding: "utf8", env, maxBuffer: 256 << 20 }));
  const byFile = new Map(files.map((f, k) => [f, info[k]]));
  for (const r of results) {
    const d = byFile.get(r.file), bad = [];
    if (d.text.length !== r.slides) bad.push(`${d.text.length} page(s) for ${r.slides} slide(s)`);
    d.text.forEach((pageText, p) => {
      const want = goldenTexts(r.deck, r.design, "full", p + 1);
      if (!want) return;
      const { missing, extra } = matchTexts(pageText, want);
      if (missing.length || extra) bad.push(`slide ${p + 1}: ${missing.length ? `missing ${JSON.stringify(missing.slice(0, 3))}` : ""}${extra ? ` not in the goldens: ${JSON.stringify(extra.slice(0, 60))}` : ""}`);
    });
    r.gt = bad.length ? bad : "equal";
    const [per, once] = BUDGET.size[r.design], limit = per * r.slides + once;
    r.sizeOk = r.bytes <= limit; r.limit = limit;
    r.fonts = d.fonts; r.images = d.images;
    if (r.old) {
      const o = byFile.get(r.old), diffs = [];
      if (o.text.length !== d.text.length) diffs.push(`${o.text.length} pages (old) vs ${d.text.length}`);
      // a page whose text differs is told apart: the old one holds the new one's characters and more (v3 repeated runs
      // or letters), the other way round, or both differ
      const count = s => { const m = new Map(); for (const c of squash(s)) m.set(c, (m.get(c) || 0) + 1); return m; };
      const within = (a, b) => [...a].every(([c, n]) => (b.get(c) || 0) >= n);
      d.text.forEach((t, p) => {
        const nw = squash(t), od = squash(o.text[p] || "");
        if (nw === od) return;
        const a = count(t), b = count(o.text[p] || ""), k = [...nw].findIndex((c, i) => c !== [...od][i]);
        diffs.push(`page ${p + 1}: ${within(a, b) ? "old has more" : within(b, a) ? "new has more" : "both differ"} (${nw.length} vs ${od.length} chars; from ${JSON.stringify(nw.slice(Math.max(0, k), k + 30))} vs ${JSON.stringify(od.slice(Math.max(0, k), k + 30))})`);
      });
      r.oldVsNew = diffs.length ? diffs : "equal";
    }
    const tag = `${r.deck} · ${r.design}`;
    if (bad.length) { ok = false; console.log(`GT FAIL ${tag}: ${bad.slice(0, 4).join("; ")}`); }
    if (!r.sizeOk && r.deck === "deck20") { ok = false; console.log(`SIZE FAIL ${tag}: ${r.bytes} bytes > ${limit}`); }
    else if (!r.sizeOk) console.log(`size ${tag}: ${r.bytes} bytes > ${limit} (${r.slides} slide(s): reported, not gated)`);
    const tlim = Math.round(BUDGET.time[r.design] * speed.factor);
    if (r.deck === "deck20" && r.ms > tlim * 1.1) { ok = false; console.log(`TIME FAIL ${tag}: ${r.ms} ms > ${tlim} ms + 10 %`); }
    if (r.old && r.oldVsNew !== "equal") console.log(`old vs new ${tag}: ${r.oldVsNew.length} page(s) differ – ${r.oldVsNew.slice(0, 2).join("; ")}`);
  }
  const summary = results.map(r => ({ ...r, file: path.basename(r.file), old: r.old && path.basename(r.old) }));
  fs.writeFileSync(path.join(OUT, "export-check.json"), JSON.stringify(summary, null, 1));
  if (arg("--json", null)) fs.writeFileSync(arg("--json"), JSON.stringify(summary, null, 1));
  console.log(`calibration ${speed.ms.toFixed(1)} ms: time limits × ${speed.factor.toFixed(2)}`);
  console.log(`${results.length} PDFs: GT ${results.filter(r => r.gt === "equal").length} equal · size ${results.filter(r => r.sizeOk).length} within budget${OLD ? ` · old = new text ${results.filter(r => r.oldVsNew === "equal").length}` : ""} · ${OUT}`);
  process.exitCode = ok ? 0 : 1;
}
