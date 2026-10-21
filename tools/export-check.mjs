/* The native export checked on the corpus (PLAN S3.7, PROMPTS Prompt 5 protocol 3): every deck in every design
   opened in the app, exported with the Export button (the export workers, saved by the helper). Each PDF is then checked:
   * qpdf --check, no Type 3, no variable fonts (tools/pdfcheck.py check);
   * its selectable text against the goldens (GT, decision 2026-10-12, 5): every golden text of each slide on its
     page, nothing else, the page count = the slide count (since 4.3, B19: a raw Excel slide with the user's text boxes,
     comments or notes section equals Excel Refined's golden text – both draw the same tables and objects – and is
     listed as such);
   * GF budgets (PLAN Part F): Excel designs < 40 KB per slide, Liquid Glass < 80 KB per slide + 190 KB per document,
     Consulting Navy / Red (M7b, 08 §4.3) < 40 KB per slide + 150 KB per document – gated on deck20 (the 20-slide
     reference, as the bench); for decks of 1–3 slides the fonts and the wallpaper, a cost per document, can exceed it:
     reported, not gated (PROGRESS, Waiting for);
   * the time from the click to the saved file (the page's own clock), ⏱ deck20: Liquid Glass < 2 s, Excel < 1 s,
     Consulting Navy / Red < 1.5 s – scaled
     by this machine's speed as `npm run bench` scales its limits (tools/calibrate.mjs, at most 2×).

   With --pictures, each deck is also exported "as pictures" (B9: 2× PNG pages): size and time are recorded.

   PowerPoint (4.5, B21; docs/next/07 §4.3, 05 PX-01…PX-04): every deck × design – and the chart corpus
   (tests/corpus/charts) – is also exported with Export ▾ › PowerPoint · all slides. Each .pptx is then checked by
   tools/pptxcheck.py: (1) structure, (2) content, (3) opened in PowerPoint without a repair, its slide count and texts read
   back (Windows with PowerPoint; --no-ppt or elsewhere: 1–2 only); (5) real objects (S14.P, AUDIT-2 VER-3): every content
   slide with tables holds a real table and every chart a native chart (python-pptx), and where PowerPoint is present it
   must open the file and see the same tables and charts – gated, not counted; its texts against the goldens (GT, as the PDF's: every
   golden text in the slide's text boxes, tables and chart titles, nothing else; the consulting designs against the same
   run's PDF text, which their own goldens check); its charts' cached values against the workbook's cells (openpyxl);
   ⏱ deck20: Liquid Glass < 3 s, the other designs < 1.5 s (scaled as above); size: Liquid Glass < 120 KB per slide +
   400 KB, the others < 15 KB per slide (300 KB for 20). --no-pptx skips this pass.

     node tools/export-check.mjs [--decks a,b] [--designs glass,excel,clean,mckinsey,bain] [--pictures] [--no-pptx] [--no-ppt] [--out <dir>] [--json <file>]
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BOOKS, DECKS, deckList, deckOps, load, openBrowser, startHelper } from "./capture-v3.mjs";
import { goldenTexts, matchTexts, ownPdfText, squash } from "./export-dl.mjs";
import { speedFactor } from "./calibrate.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PY = process.platform === "win32" ? "python" : "python3";
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const BUDGET = {
  /** bytes per slide (+ per document), PLAN Part F */
  size: { excel: [40 * 1024, 0], clean: [40 * 1024, 0], glass: [80 * 1024, 190 * 1024],
    // the consulting designs (M7b, 08 §4.3): as Excel per slide + their fonts once (Georgia Bold, Arial Regular / Bold subsets)
    mckinsey: [40 * 1024, 150 * 1024], bain: [40 * 1024, 150 * 1024] },
  /** ms from the click to the file for 20 slides, PLAN Part F */
  time: { excel: 1000, clean: 1000, glass: 2000, mckinsey: 1500, bain: 1500 },
  /** the PowerPoint file (07 §4.4, 07 §6.4): bytes per slide (+ per document) and ms for 20 slides */
  pptx: { size: { excel: [15 * 1024, 0], clean: [15 * 1024, 0], glass: [120 * 1024, 400 * 1024], mckinsey: [15 * 1024, 0], bain: [15 * 1024, 0] },
    time: { excel: 1500, clean: 1500, glass: 3000, mckinsey: 1500, bain: 1500 } },
};
/** the chart corpus (M9): decks with charts and callouts, PowerPoint pass only (they have no v3 goldens) */
const CHART_DECKS = path.join(REPO, "tests", "corpus", "charts");
/** each chart of a deck as pptxcheck compares it: its slide (1-based), the sheet and range of its values */
function chartSources(deck) {
  const preset = deck.ops.find(o => o.op === "preset.set")?.preset || {}, tables = new Map((preset.tables || []).map(t => [t.id, t.sheet]));
  const out = [];
  (preset.slides || []).forEach((s, i) => { for (const it of Object.values(s.items || {})) if (it?.kind === "chart" && it.values?.range) out.push({ slide: i + 1, sheet: it.values.table ? tables.get(it.values.table) : it.values.sheet, range: it.values.range }); });
  for (const o of deck.ops) if (o.op === "item.patch" && o.patch?.kind === "chart" && o.patch.values?.range) {
    const i = (preset.slides || []).findIndex(s => s.id === o.slide);
    out.push({ slide: i + 1, sheet: o.patch.values.table ? tables.get(o.patch.values.table) : o.patch.values.sheet, range: o.patch.values.range });
  }
  return out;
}
/** what each slide must hold as real objects (S14.P gate; AUDIT-2 VER-3, PX-02 / PX-03, 09 §7.2): a content slide that
    lists tables at least one real table (a:tbl, python-pptx has_table), and a native chart per chart of the slide – never
    a picture of either. pptxcheck (5) gates it, and where PowerPoint is present also that PowerPoint sees the same */
export function realObjects(deck) {
  const preset = deck.ops.find(o => o.op === "preset.set")?.preset || {}, charts = chartSources(deck);
  return (preset.slides || []).map((s, i) => ({ slide: i + 1, tables: s.type === "content" && (s.tables || []).length ? 1 : 0, charts: charts.filter(c => c.slide === i + 1).length }))
    .filter(e => e.tables || e.charts);
}

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
  return { files: files.map(f => path.join(dir, f)), ms, toast };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const OUT = path.resolve(arg("--out", fs.mkdtempSync(path.join(os.tmpdir(), "sb-export-check-"))));
  const DESIGNS = arg("--designs", "glass,excel,clean,mckinsey,bain").split(",");
  const decks = deckList(arg("--decks", null)?.split(",") || null);
  const PICTURES = process.argv.includes("--pictures"), PPTX = !process.argv.includes("--no-pptx");
  const chartDecks = PPTX && !arg("--decks", null) ? fs.readdirSync(CHART_DECKS).filter(f => f.endsWith(".json")).map(f => "charts/" + f.replace(/\.json$/, "")) : [];
  const pptx = [];
  fs.mkdirSync(OUT, { recursive: true });
  const h = await startHelper(), results = [];
  let browser = null;
  try {
    const b = await openBrowser(), page = b.page;
    browser = b.browser;
    for (const id0 of [...decks, ...chartDecks]) {
      const chartsOnly = id0.startsWith("charts/"), id = chartsOnly ? id0.slice(7) : id0;
      const deck = JSON.parse(fs.readFileSync(chartsOnly ? path.join(CHART_DECKS, id + ".json") : path.join(DECKS, id + ".json"), "utf8"));
      const file = id + path.extname(deck.workbook);
      fs.copyFileSync(path.join(BOOKS, deck.workbook), path.join(h.root, file));
      await deckOps(h, file, deck.ops);
      for (const design of DESIGNS) {
        await deckOps(h, file, [{ op: "style.patch", patch: { design } }]);
        const slides = await load(page, h, file, "");
        if (PPTX) {
          const x = await exportOnce(page, h, async () => { await page.click("#exportMenuBtn"); await page.click('[data-x="pptx"]'); });
          if (x.files.length !== 1) throw new Error(`${id} · ${design}: ${x.files.length} PowerPoint files`);
          const f = path.join(OUT, `${id}-${design}.pptx`); fs.copyFileSync(x.files[0], f);
          pptx.push({ deck: id, design, slides, file: f, name: path.basename(x.files[0]), ms: Math.round(x.ms), bytes: fs.statSync(f).size, toast: x.toast,
            workbook: path.join(BOOKS, deck.workbook), charts: chartSources(deck), real: realObjects(deck) });
          console.log(`${id} · ${design}: PowerPoint ${(fs.statSync(f).size / 1024).toFixed(1)} KB, ${Math.round(x.ms)} ms`);
        }
        if (chartsOnly) continue;
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
  const files = results.map(r => r.file);
  let checked = "";
  try { checked = execFileSync(PY, [path.join(REPO, "tools", "pdfcheck.py"), "check", ...results.map(r => r.file)], { encoding: "utf8", env }); }
  catch (e) { checked = String(e.stdout || ""); ok = false; }
  process.stdout.write(checked);
  const info = JSON.parse(execFileSync(PY, [path.join(REPO, "tools", "pdfcheck.py"), "info", ...files], { encoding: "utf8", env, maxBuffer: 256 << 20 }));
  const byFile = new Map(files.map((f, k) => [f, info[k]]));
  for (const r of results) {
    const d = byFile.get(r.file), bad = [];
    if (d.text.length !== r.slides) bad.push(`${d.text.length} page(s) for ${r.slides} slide(s)`);
    // the consulting designs (M7b): their own golden PDF's text is the reference (heads in capitals, cells quoted)
    const own = ownPdfText(r.deck, r.design, "full");
    d.text.forEach((pageText, p) => {
      if (own) { if (own[p] !== undefined && squash(pageText) !== own[p]) bad.push(`slide ${p + 1}: the text differs from the golden PDF's`); return; }
      const want = goldenTexts(r.deck, r.design, "full", p + 1);
      if (!want) return;
      const { missing, extra } = matchTexts(pageText, want);
      if (!missing.length && !extra) return;
      // B19 (4.3, signed off 2026-10-18): raw Excel draws the user's text boxes, comments and notes section, as Excel
      // Refined always has – a slide that has them reads as Excel Refined's golden (the same tables, the same objects)
      if (r.design === "excel") {
        const refined = goldenTexts(r.deck, "clean", "full", p + 1), m2 = refined && matchTexts(pageText, refined);
        if (m2 && !m2.missing.length && !m2.extra) { (r.b19 ||= []).push(p + 1); return; }
      }
      bad.push(`slide ${p + 1}: ${missing.length ? `missing ${JSON.stringify(missing.slice(0, 3))}` : ""}${extra ? ` not in the goldens: ${JSON.stringify(extra.slice(0, 60))}` : ""}`);
    });
    r.gt = bad.length ? bad : "equal";
    const [per, once] = BUDGET.size[r.design], limit = per * r.slides + once;
    r.sizeOk = r.bytes <= limit; r.limit = limit;
    r.fonts = d.fonts; r.images = d.images;
    const tag = `${r.deck} · ${r.design}`;
    if (bad.length) { ok = false; console.log(`GT FAIL ${tag}: ${bad.slice(0, 4).join("; ")}`); }
    if (!r.sizeOk && r.deck === "deck20") { ok = false; console.log(`SIZE FAIL ${tag}: ${r.bytes} bytes > ${limit}`); }
    else if (!r.sizeOk) console.log(`size ${tag}: ${r.bytes} bytes > ${limit} (${r.slides} slide(s): reported, not gated)`);
    const tlim = Math.round(BUDGET.time[r.design] * speed.factor);
    if (r.deck === "deck20" && r.ms > tlim * 1.1) { ok = false; console.log(`TIME FAIL ${tag}: ${r.ms} ms > ${tlim} ms + 10 %`); }
  }
  const summary = results.map(r => ({ ...r, file: path.basename(r.file) }));
  fs.writeFileSync(path.join(OUT, "export-check.json"), JSON.stringify(summary, null, 1));
  if (arg("--json", null)) fs.writeFileSync(arg("--json"), JSON.stringify(summary, null, 1));
  console.log(`calibration ${speed.ms.toFixed(1)} ms: time limits × ${speed.factor.toFixed(2)}`);
  const b19 = results.filter(r => r.b19).map(r => `${r.deck} slide ${r.b19.join(", ")}`);
  if (b19.length) console.log(`GT B19: raw Excel equal to Excel Refined's golden text (the user's objects drawn): ${b19.join("; ")}`);
  console.log(`${results.length} PDFs: GT ${results.filter(r => r.gt === "equal").length} equal · size ${results.filter(r => r.sizeOk).length} within budget · ${OUT}`);

  // PowerPoint (B21): pptxcheck 1–3, GT, the charts' values, budgets
  if (pptx.length) {
    const rep = path.join(OUT, "pptxcheck.json"), sources = path.join(OUT, "chart-sources.json"), expect = path.join(OUT, "real-objects.json");
    fs.writeFileSync(sources, JSON.stringify(Object.fromEntries(pptx.filter(p => p.charts.length).map(p => [p.file, { workbook: p.workbook, charts: p.charts }]))));
    fs.writeFileSync(expect, JSON.stringify(Object.fromEntries(pptx.map(p => [p.file, p.real]))));
    let out = "";
    try { out = execFileSync(PY, [path.join(REPO, "tools", "pptxcheck.py"), "check", ...pptx.map(p => p.file), "--json", rep, "--sources", sources, "--expect", expect, ...(process.argv.includes("--no-ppt") ? ["--no-ppt"] : [])], { encoding: "utf8", env, maxBuffer: 256 << 20, timeout: 3_600_000 }); }
    catch (e) { out = String(e.stdout || ""); ok = false; }
    process.stdout.write(out);
    const reports = new Map(JSON.parse(fs.readFileSync(rep, "utf8")).map(r => [path.resolve(r.file), r]));
    const pdfOf = new Map(results.map(r => [`${r.deck}|${r.design}`, byFile.get(r.file)]));
    for (const p of pptx) {
      const R = reports.get(path.resolve(p.file)), bad = [];
      if (!R) { ok = false; console.log(`PPTX FAIL ${p.deck} · ${p.design}: not checked`); continue; }
      if (R.slides !== p.slides) bad.push(`${R.slides} slide(s) for ${p.slides}`);
      (R.content?.slides || []).forEach((s, i) => {
        // the golden texts that are one element of the file (a cell, a text box) are taken first, each once; the others
        // – a golden text the file splits or joins otherwise – are looked for in the rest (one text per element, a
        // separator no golden text holds between them)
        const gt = want => {
          const pool = s.texts.map(squash), rest = [];
          for (const t of want) { const k = pool.indexOf(squash(t)); if (k >= 0) pool[k] = null; else rest.push(t); }
          const m = matchTexts(s.texts.filter((_, k) => pool[k] !== null).join("\u0002"), rest);
          return { missing: m.missing, extra: m.extra.replace(/\u0002/g, "") };
        };
        const own = ownPdfText(p.deck, p.design, "full"), pdf = pdfOf.get(`${p.deck}|${p.design}`);
        // the consulting designs: the PowerPoint file's texts are the same run's PDF text (which their goldens check)
        if (own) { if (pdf?.text[i] !== undefined) { const m = matchTexts(pdf.text[i], s.texts); if (m.missing.length || m.extra) bad.push(`slide ${i + 1}: ${m.missing.length ? `not in the PDF ${JSON.stringify(m.missing.slice(0, 3))}` : ""}${m.extra ? ` the PDF has more: ${JSON.stringify(m.extra.slice(0, 60))}` : ""}`); } return; }
        const want = goldenTexts(p.deck, p.design, "full", i + 1);
        if (!want) return;
        const m = gt(want);
        if (!m.missing.length && !m.extra) return;
        if (p.design === "excel") { const refined = goldenTexts(p.deck, "clean", "full", i + 1), m2 = refined && gt(refined); if (m2 && !m2.missing.length && !m2.extra) return; }
        bad.push(`slide ${i + 1}: ${m.missing.length ? `missing ${JSON.stringify(m.missing.slice(0, 3))}` : ""}${m.extra ? ` not in the goldens: ${JSON.stringify(m.extra.slice(0, 60))}` : ""}`);
      });
      p.gt = bad.length ? bad : "equal"; p.check = R.ok ? "ok" : R.problems;
      const [per, once] = BUDGET.pptx.size[p.design], limit = per * p.slides + once, tlim = Math.round(BUDGET.pptx.time[p.design] * speed.factor);
      p.sizeOk = p.bytes <= limit; p.limit = limit; p.tables = (R.content?.slides || []).reduce((s, x) => s + x.tables, 0); p.chartsFound = (R.content?.slides || []).reduce((s, x) => s + x.charts.length, 0);
      p.pictures = (R.content?.slides || []).reduce((s, x) => s + x.pictures, 0); p.media = R.media; p.powerpoint = !!R.powerpoint; p.ppt = R.ppt;
      // the gate (S14.P; VER-3): where PowerPoint is present it must have opened the file and seen its real tables and
      // charts (pptxcheck (3), (5)); a report without the answer is a failure, not a count
      if ((R.ppt === "opened" && !R.powerpoint) || R.ppt === "failed") { ok = false; console.log(`PPTX POWERPOINT FAIL ${p.deck} · ${p.design}: ${R.ppt === "failed" ? "PowerPoint did not open it" : "no answer"}`); }
      const tag = `${p.deck} · ${p.design}`;
      if (bad.length) { ok = false; console.log(`PPTX GT FAIL ${tag}: ${bad.slice(0, 4).join("; ")}`); }
      if (!R.ok) { ok = false; console.log(`PPTX CHECK FAIL ${tag}: ${R.problems.slice(0, 4).join("; ")}`); }
      if (p.deck === "deck20" && !p.sizeOk) { ok = false; console.log(`PPTX SIZE FAIL ${tag}: ${p.bytes} bytes > ${limit}`); }
      if (p.deck === "deck20" && p.ms > tlim * 1.1) { ok = false; console.log(`PPTX TIME FAIL ${tag}: ${p.ms} ms > ${tlim} ms + 10 %`); }
    }
    fs.writeFileSync(path.join(OUT, "export-check-pptx.json"), JSON.stringify(pptx.map(p => ({ ...p, file: path.basename(p.file) })), null, 1));
    const d20 = pptx.filter(p => p.deck === "deck20").map(p => `${p.design} ${(p.bytes / 1024).toFixed(0)} KB / ${p.ms} ms`).join(", ");
    const absent = pptx.some(p => p.ppt === "absent" || p.ppt === "skipped");
    console.log(`${pptx.length} PowerPoint files: checked ${pptx.filter(p => p.check === "ok").length} ok (${pptx.filter(p => p.powerpoint).length} opened in PowerPoint${absent ? "; PowerPoint not here: structure, python-pptx's real tables and charts only – the open / HasTable / HasChart gate runs on a PC with PowerPoint" : ", every one gated"}) · GT ${pptx.filter(p => p.gt === "equal").length} equal · size ${pptx.filter(p => p.sizeOk).length} within budget${d20 ? ` · deck20: ${d20}` : ""}`);
  }
  process.exitCode = ok ? 0 : 1;
}
