/* The native export checked on the corpus (PLAN S3.7, PROMPTS Prompt 5 protocol 3): every deck in every design
   opened in the app, exported with the Export button (the export workers, saved by the helper). Each PDF is then checked:
   * qpdf --check, no Type 3, no variable fonts (tools/pdfcheck.py check);
   * its selectable text against the goldens (GT, decision 2026-10-12, 5): every golden text of each slide on its
     page, nothing else, the page count = the slide count (since 4.3, B19: a raw Excel slide with the user's text boxes,
     comments or notes section equals Excel Refined's golden text – both draw the same tables and objects – and is
     listed as such; since B48, Excel and Excel Refined follow the Intesa Sanpaolo template: a slide whose text equals
     the golden's with the template's bullets and contents marks as squares, and with the page number the template has
     on by default, is listed as "GT B48", ispGoldenTexts);
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
   back (Windows with PowerPoint; --no-ppt or elsewhere: 1–2 only); (5) real objects (S14.P, AUDIT-2 VER-3): each slide
   holds as many real tables and native charts (python-pptx) as the core's own export draws (tools/real-objects.mjs),
   and where PowerPoint is present it must open the file and see the same tables and charts – gated, not counted; its texts against the goldens (GT, as the PDF's: every
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
import { pageChartKinds, withChartKinds } from "./real-charts.mjs";   // M14 (S14.6): each chart's native kinds, pptxcheck (5)
import { goldenItems, goldenTexts, matchTexts, ownPdfText, squash } from "./export-dl.mjs";
import { speedFactor } from "./calibrate.mjs";
import { pageRealObjects } from "./real-objects.mjs";

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
/** B48's expected text difference (the Intesa Sanpaolo template in Excel and Excel Refined, product owner 2026-10-21;
    B48 review, 8) – the only one, scoped to these two designs: their goldens' texts as the template draws them. A text
    box's paragraph starting "- " / "• " / "◦ " (not a minus before a figure: core render/slide-dl.ts ISP_BULLET) shows its
    bullet as a square, not as text – unless its box is right-aligned or centred, where it stays text (so each text box
    is taken in whichever form the page has); the contents rows' numbers ("01", class ix-n) are squares and each row
    reads page then entry (ix-p before ix-t); a title or subtitle the template's larger type (26 / 16 pt × 4/3) cuts
    with an ellipsis is taken as cut (its beginning and "…"; owner's question in the B48 report). The page number, on by
    default in these two designs since B48 (core model/style.ts, owner-approved; the goldens predate it): `pageNo`, the
    label the core itself draws on that slide (pageNumbersOf), is one more text of the slide – exactly that label, and
    only where the core draws one. Every other text difference still fails. A slide that matches only so is
    listed ("GT B48") */
const ISP_BULLET = /^([ \t]+)?(- (?!\s*[\d.,€$£%])|• |◦ )/;
export function ispGoldenTexts(deck, design, version, n, pageText = null, pageNo = null) {
  if (design !== "excel" && design !== "clean") return null;
  const items = goldenItems(deck, design, version, n);
  if (!items) return null;
  const page = pageText === null ? null : squash(pageText), out = [];
  for (const i of items) {
    if (/^ix-n\b/.test(i.cls)) continue;
    if (/^ix-p\b/.test(i.cls)) {
      // the page before its row's entry (and the entry's subtitle)
      let k = out.length; while (k > 0 && /^ix-s\b/.test(out[k - 1].cls)) k--;
      if (k > 0 && /^ix-t\b/.test(out[k - 1].cls)) k--;
      out.splice(k, 0, i); continue;
    }
    if (/^tnote\b/.test(i.cls)) {
      const drawn = i.text.split("\n").map(l => l.replace(ISP_BULLET, "")).join("\n");
      out.push({ ...i, text: page !== null && !page.includes(squash(drawn)) && page.includes(squash(i.text)) ? i.text : drawn });
      continue;
    }
    if (/^(title|subtitle)\b/.test(i.cls) && page !== null && !page.includes(squash(i.text))) {
      const t = squash(i.text);
      let k = t.length - 1; while (k >= 8 && !page.includes(t.slice(0, k) + "...")) k--;
      if (k >= 8) { out.push({ ...i, text: t.slice(0, k) + "..." }); continue; }
    }
    out.push(i);
  }
  return [...out.map(i => i.text), ...(pageNo ? [pageNo] : [])];
}
/** each slide's page number as the core draws it, in the export's order (null where it has none): the label of its
    "pageno" hit (not the footer's). Self-contained: its source is what the page runs (pagePageNumbers) */
export function pageNumbersOf(lists) {
  const find = ns => { for (const x of ns || []) { if (x && x.t === "hit" && /\bpageno\b/.test(x.id) && !/\bfooter\b/.test(x.id)) return x.label || null; if (x && x.t === "group") { const r = find(x.children); if (r) return r; } } return null; };
  return lists.map(l => find(l.dl.nodes));
}
/** the script page.evaluate runs in the page (after load): the current deck's page numbers in `design` (the export's lists) */
export const pagePageNumbers = design => `(async () => (${pageNumbersOf})(await window.__sbTest.slideLists(${JSON.stringify({ design, version: "", forExport: true, thumb: false })})))()`;
/** the B48 forms a slide's text may take in Excel and Excel Refined: the template's bullets and contents marks, without
    and – where the core draws one (B48: on by default) – with the slide's page number */
const ispForms = (deck, design, n, pageText, pageNo) => [null, ...(pageNo ? [pageNo] : [])].map(pn => ispGoldenTexts(deck, design, "full", n, pageText, pn)).filter(Boolean);
/** the chart corpus (M9): decks with charts and callouts, PowerPoint pass only (they have no v3 goldens) */
const CHART_DECKS = path.join(REPO, "tests", "corpus", "charts");
/** each chart of a deck as pptxcheck compares it: its slide (1-based), the sheet and range of its values. Read from the
    deck's preset.set and item.patch ops: slide n is the preset's n-th slide, so a deck with hidden slides or slides
    added by slide.add would number them wrongly – the chart corpus has neither (the real-objects counts of (5) come from
    the core and have no such limit) */
/** what pptxcheck --sources checks of a deck's charts: an old chart's values range; a series chart's (4.7, S14.3 review 4)
    each shown series of one range on one of the deck workbook's sheets, at its category group's first category
    (`start`: the groups before it, in their order, by their ranges' cells) and by its own name when it has one */
export function chartSources(deck) {
  const preset = deck.ops.find(o => o.op === "preset.set")?.preset || {}, tables = new Map((preset.tables || []).map(t => [t.id, t.sheet]));
  const out = [], sheetOf = r => r.table ? tables.get(r.table) : r.sheet;
  const add = (slide, it) => {
    if (it.values?.range) out.push({ slide, sheet: sheetOf(it.values), range: it.values.range });
    if (!it.sers || typeof it.sers !== "object") return;
    // (a scatter chart reads no category groups: its points stand on its x axis – S14.4)
    const groups = Object.entries(it.type === "scatter" ? {} : it.groups || {}).filter(([, g]) => g && typeof g === "object").sort(([a, p], [b, q]) => (+p.n || 0) - (+q.n || 0) || (a < b ? -1 : a > b ? 1 : 0));
    // (a group's start: the categories of the groups before it – an inline list's length here; a range's cells counted
    // by pptxcheck, which skips hidden rows and columns as the chart does: `before` – S14.3 re-check)
    const startOf = gid => {
      let at = 0; const before = [];
      for (const [id, g] of groups) {
        if (id === gid) break;
        if (Array.isArray(g.cats)) at += g.cats.length;
        else if (g.cats?.range && sheetOf(g.cats)) before.push({ sheet: sheetOf(g.cats), range: g.cats.range });
      }
      return { start: at, ...(before.length ? { before } : {}) };
    };
    // (the series in their order – n, then id; a waterfall draws, and so caches, its first one only: S14.4 review 5)
    let list = Object.entries(it.sers).filter(([, s]) => s && typeof s === "object" && !s.hide && Array.isArray(s.vals))
      .sort(([a, p], [b, q]) => (Number.isFinite(+p.n) ? +p.n : 0) - (Number.isFinite(+q.n) ? +q.n : 0) || (a < b ? -1 : a > b ? 1 : 0)).map(([, s]) => s);
    if (it.type === "waterfall") list = list.slice(0, 1);
    for (const s of list) {
      if (s.vals.length !== 1) continue;
      const r = s.vals[0], sheet = r && sheetOf(r);
      if (!sheet || !r.range || sheet.startsWith("[")) continue;          // (a linked workbook's: not the deck's book)
      // (a scatter series' x values, against its c:xVal cache – S14.4; its y values only where an x cell has a number: a
      // point without its x is cached in neither – `mask`, S14.4 review 5)
      const x = it.type === "scatter" && Array.isArray(s.xs) && s.xs.length === 1 ? s.xs[0] : null, xs = x && sheetOf(x);
      out.push({ slide, sheet, range: r.range, ...(groups.length ? startOf(groups.some(([id]) => id === s.group) ? s.group : groups[0][0]) : { start: 0 }), ...(typeof s.name === "string" ? { name: s.name } : {}),
        ...(xs && x.range && !xs.startsWith("[") ? { mask: { sheet: xs, range: x.range } } : {}) });
      if (xs && x.range && !xs.startsWith("[")) out.push({ slide, sheet: xs, range: x.range, start: 0, axis: "x", ...(typeof s.name === "string" ? { name: s.name } : {}) });
    }
  };
  (preset.slides || []).forEach((s, i) => { for (const it of Object.values(s.items || {})) if (it?.kind === "chart") add(i + 1, it); });
  for (const o of deck.ops) if (o.op === "item.patch" && o.patch?.kind === "chart") add((preset.slides || []).findIndex(s => s.id === o.slide) + 1, o.patch);
  return out;
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
        // B48: the page number the core draws on each slide (Excel and Excel Refined: on by default), for ispGoldenTexts
        const pageNos = design === "excel" || design === "clean" ? await page.evaluate(pagePageNumbers(design)) : [];
        if (PPTX) {
          // the real tables and native charts each slide of the file must hold: as many as the core's own PowerPoint
          // export draws (tools/real-objects.mjs: a missing sheet's table, hidden slides, slide.add / table.add all
          // counted as the export counts them)
          const real = await page.evaluate(pageRealObjects(design));
          const x = await exportOnce(page, h, async () => { await page.click("#exportMenuBtn"); await page.click('[data-x="pptx"]'); });
          if (x.files.length !== 1) throw new Error(`${id} · ${design}: ${x.files.length} PowerPoint files`);
          const f = path.join(OUT, `${id}-${design}.pptx`); fs.copyFileSync(x.files[0], f);
          pptx.push({ deck: id, design, slides, file: f, name: path.basename(x.files[0]), ms: Math.round(x.ms), bytes: fs.statSync(f).size, toast: x.toast,
            workbook: path.join(BOOKS, deck.workbook), charts: chartSources(deck), real: withChartKinds(real, await page.evaluate(pageChartKinds(design))), pageNos });
          console.log(`${id} · ${design}: PowerPoint ${(fs.statSync(f).size / 1024).toFixed(1)} KB, ${Math.round(x.ms)} ms`);
        }
        if (chartsOnly) continue;
        const r = { deck: id, design, slides, pageNos };
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
      // B48: the template's bullets and contents marks (ispGoldenTexts) – raw Excel also as Excel Refined's (B19)
      for (const d of r.design === "excel" ? ["excel", "clean"] : r.design === "clean" ? ["clean"] : []) for (const w of ispForms(r.deck, d, p + 1, pageText, r.pageNos[p])) {
        const m3 = matchTexts(pageText, w);
        if (!m3.missing.length && !m3.extra) { (r.b48 ||= []).push(p + 1); return; }
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
  const b48 = results.filter(r => r.b48).map(r => `${r.deck} · ${r.design} slide ${r.b48.join(", ")}`);
  if (b48.length) console.log(`GT B48: equal to the golden text as the Intesa Sanpaolo template draws it (bullets and contents marks as squares, the page number on by default): ${b48.join("; ")}`);
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
        // B48 (ispGoldenTexts): the template's bullets are the paragraphs' own, its contents marks shapes – not text
        for (const d of p.design === "excel" ? ["excel", "clean"] : p.design === "clean" ? ["clean"] : []) for (const w of ispForms(p.deck, d, i + 1, s.texts.join("\n"), p.pageNos[i])) {
          const m3 = gt(w);
          if (!m3.missing.length && !m3.extra) { (p.b48 ||= []).push(i + 1); return; }
        }
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
    const pb48 = pptx.filter(p => p.b48).map(p => `${p.deck} · ${p.design} slide ${p.b48.join(", ")}`);
    if (pb48.length) console.log(`PPTX GT B48: equal to the golden text as the Intesa Sanpaolo template draws it (its bullets, contents marks and page number): ${pb48.join("; ")}`);
    const d20 = pptx.filter(p => p.deck === "deck20").map(p => `${p.design} ${(p.bytes / 1024).toFixed(0)} KB / ${p.ms} ms`).join(", ");
    const absent = pptx.some(p => p.ppt === "absent" || p.ppt === "skipped");
    console.log(`${pptx.length} PowerPoint files: checked ${pptx.filter(p => p.check === "ok").length} ok (${pptx.filter(p => p.powerpoint).length} opened in PowerPoint${absent ? "; PowerPoint not here: structure, python-pptx's real tables and charts only – the open / HasTable / HasChart gate runs on a PC with PowerPoint" : ", every one gated"}) · GT ${pptx.filter(p => p.gt === "equal").length} equal · size ${pptx.filter(p => p.sizeOk).length} within budget${d20 ? ` · deck20: ${d20}` : ""}`);
  }
  process.exitCode = ok ? 0 : 1;
}
