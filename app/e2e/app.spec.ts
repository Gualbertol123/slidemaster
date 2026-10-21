/* End-to-end: the built app (helper/slide_builder.html) served by two real helpers that share one
   folder – user "anna" on :8951 and user "bob" on :8952. Run: npm run build && npm run test:e2e */
import { test, expect, type Locator, type Page, type Route } from "@playwright/test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pdfPageTexts } from "./pdftext";
import { fold, type DeckRecord } from "../../core/src/model/fold";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const ANNA = "http://127.0.0.1:8951/", BOB = "http://127.0.0.1:8952/";
const root = () => process.env.SB_E2E_ROOT!, data = () => process.env.SB_E2E_DATA!;
/** a workbook's deck on the share (storage v4, docs/next/04 §2): data/v4/decks/<name>-<hash>/ */
const deckDir = (name: string) => { const d = path.join(data(), "v4", "decks"); const f = fs.readdirSync(d).find(n => n.startsWith(name + "-") && /-[0-9a-f]{10}$/.test(n)); return f ? path.join(d, f) : null; };
/** the complete records of a journal from byte `from` (<len>:<crc32>:<json>\n; a frame being written is not one yet) */
function frames(buf: Buffer, from: number): DeckRecord[] {
  const out: DeckRecord[] = [];
  for (let p = from; ;) {
    const m = /^(\d+):([0-9a-f]{8}):/.exec(buf.subarray(p, p + 21).toString("latin1"));
    if (!m) return out;
    const start = p + m[0].length, end = start + +m[1];
    if (buf.length < end + 1 || buf[end] !== 10) return out;
    out.push(JSON.parse(buf.subarray(start, end).toString("utf8"))); p = end + 1;
  }
}
/** what everybody reads of a workbook's deck: its snapshot and the records past the frontier, folded as the core does */
function deckDoc(name: string) {
  const d = deckDir(name)!;
  const snap = JSON.parse(fs.readFileSync(path.join(d, "snapshot.json"), "utf8"));
  let names: string[] = []; try { names = fs.readdirSync(path.join(d, "j")); } catch { /* no journal yet */ }
  const recs = names.flatMap(n => frames(fs.readFileSync(path.join(d, "j", n)), snap.frontier[n.replace(/\.log$/, "")] || 0));
  return fold(snap, recs).doc as any;           // (the tests read it as freely as the JSON file before)
}
const doc = () => deckDoc("report.xlsx");
/** wait until a deck is folded to the end – every journal's length is the snapshot's frontier for it – and its files
    rest: the compaction a page runs once records are COMPACT_MARGIN_MS (30 s) old would otherwise land inside a test
    that compares the deck's files (the first one after the format-5 raise, which folds nothing, has a lot to fold) */
async function settledDeck(name: string, timeout = 80_000) {
  const d = deckDir(name)!;
  const folded = () => {
    const snap = JSON.parse(fs.readFileSync(path.join(d, "snapshot.json"), "utf8"));
    let names: string[] = []; try { names = fs.readdirSync(path.join(d, "j")); } catch { /* no journal */ }
    return names.every(n => fs.statSync(path.join(d, "j", n)).size === (snap.frontier?.[n.replace(/\.log$/, "")] || 0));
  };
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await new Promise(r => setTimeout(r, 500)))
    if (folded()) { await new Promise(r => setTimeout(r, 1500)); if (folded()) return; }
  throw new Error("deck " + name + " was not folded to the end within " + timeout + " ms");
}
const errors: string[] = [];
/* browser messages the fixtures cause on purpose; any other console error or warning fails E15:
   the decks' default logo "logo.png" is not in the test folder (the app shows "Logo not found"), the helper
   has no favicon, the uploaded test fonts are name-table stubs (sfnt() below) that Chrome cannot decode, and the font
   picker's first preview (B46) fails with the helper's 502: the e2e helpers run with SLIDEBUILDER_NO_NET=1
   (playwright.config.ts), so they never reach Google. Chrome logs any 5xx answer to a fetch itself (the page only
   console.info's it and then asks no more), so it is matched exactly: status text, path and query */
const EXPECTED = [/^console\.error: Failed to load resource: .* 404 .* @ \/assets\/logo\.png[?:]/, /^console\.error: Failed to load resource: .* 404 .* @ \/favicon\.ico:/,
  /^console\.warning: Failed to decode downloaded font: http:\/\/127\.0\.0\.1:\d+\/fonts\/CorpSans-/,
  /^console\.error: Failed to load resource: the server responded with a status of 502 \(Bad Gateway\) @ \/api\/fonts\/google\/preview\?family=[^:@ ]+:\d+$/];
/** Chrome's font sanitiser names no file: its warning is expected only next to a stub font's decode warning */
const unexpected = (list: string[]) => {
  const stubs = list.filter(e => EXPECTED[2].test(e)).length;
  let ots = 0;
  return list.filter(e => !EXPECTED.some(x => x.test(e)) && !(/^console\.warning: OTS parsing error: /.test(e) && ++ots <= stubs));
};

/* what the page asked the helpers and what came back - printed when a test fails, so a failure on CI
   shows where a save stopped (request never sent, refused, unanswered, or written to another file) */
let trail: string[] = [];
const at = () => "+" + (Date.now() - started) + "ms";       // since the test started
let started = 0;
test.beforeEach(() => { trail = []; started = Date.now(); });
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  let state = "";
  try { state = await page.locator("#sbSave").innerText({ timeout: 1000 }); } catch { state = "(no status bar)"; }
  let files: string[] = [];
  try { files = fs.readdirSync(path.join(data(), "v4", "decks")); } catch { /* none yet */ }
  console.log(["--- trail of " + info.title + " (last 150 events)", ...trail.slice(-150), "save status: " + state, "decks: " + files.join(", ")].join("\n"));
});
/** an element's box once it is laid out: right after a save the slide is drawn again, and an element being replaced
    has no box for a moment */
async function boxOf(l: Locator) {
  let b: Awaited<ReturnType<Locator["boundingBox"]>> = null;
  await expect.poll(async () => (b = await l.boundingBox()) !== null, { timeout: 5_000 }).toBe(true);
  return b!;
}
async function openApp(page: Page, url: string) {
  page.on("pageerror", e => errors.push(e.message));
  // E15: console errors and warnings fail the run too (React reports misuse there)
  page.on("console", m => { if (m.type() === "error" || m.type() === "warning") errors.push("console." + m.type() + ": " + m.text() + " @ " + (m.location().url || "").replace(url, "/") + ":" + m.location().lineNumber); });
  page.on("pageerror", e => trail.push(at() + " pageerror " + e.message));
  page.on("console", m => { if (m.type() === "error" || m.type() === "warning") trail.push(at() + " console." + m.type() + " " + m.text()); });
  // every helper request with its start, answer and duration (presence and file checks run every few seconds)
  const ids = new Map<object, number>(); let n = 0;
  const short = (u: string) => u.replace(url, "/").replace(/[?&]t=[^&]*/, "");
  page.on("request", r => { if (!r.url().startsWith(url)) return; ids.set(r, ++n); trail.push(at() + " #" + n + " -> " + r.method() + " " + short(r.url()) + (r.method() === "POST" ? " " + (r.postData() || "").slice(0, 200) : "")); });
  page.on("requestfinished", async r => { if (!ids.has(r)) return; const res = await r.response().catch(() => null); trail.push(at() + " #" + ids.get(r) + " <- " + (res ? res.status() : "?") + " in " + Math.round(r.timing().responseEnd) + " ms"); });
  page.on("requestfailed", r => { if (ids.has(r)) trail.push(at() + " #" + ids.get(r) + " xx " + (r.failure()?.errorText || "")); });
  await page.goto(url);
  await page.locator("#openBtn").waitFor();                                       // the page has rendered…
  await expect(page.locator("#srv")).toHaveCount(0);                              // …and the helper answered (S4.5: no engine pill)
  // start-up reopens the user's last workbook: a workbook opened before that finished was replaced by it (as in
  // open.spec) – wait until it is open
  let last: string | null = null;
  try { last = JSON.parse(fs.readFileSync(path.join(data(), "users", (url === ANNA ? "anna" : "bob") + ".json"), "utf8")).lastFile || null; } catch { /* first start */ }
  if (last) await expect(page.locator("#fileName")).toHaveText(new RegExp("^" + last.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " · \\d+ slides?"), { timeout: 30_000 });
}
/** a workbook with one part changed (a cell, a sheet's name: as if saved again in Excel) */
function xlsxEdit(buf: Buffer, part: string, f: (xml: string) => string): Buffer {
  const z = unzipSync(new Uint8Array(buf)); z[part] = strToU8(f(strFromU8(z[part])));
  return Buffer.from(zipSync(z));
}
async function openWorkbook(page: Page, name: string) {
  await page.click("#openBtn");
  await page.click(`[data-f="${name}"]`);
}
/** "Continue" in the saved-deck question, then wait until that open has finished: start-up may already show the same
    workbook, and an edit made while the second open runs is cleared when it ends (the selection, for one) */
async function continueOpen(page: Page, name: string) {
  await page.click('[data-a="continue"]');
  await expect(page.locator("#fileName")).toHaveText(new RegExp("^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " · \\d+ slides?"), { timeout: 30_000 });
}
async function selectCell(page: Page, text: string) {
  await page.locator("#stage .slide .t", { hasText: new RegExp("^" + text + "$") }).first().waitFor();
  const box = (await page.locator("#stage .slide .t", { hasText: new RegExp("^" + text + "$") }).first().boundingBox())!;
  await page.mouse.click(box.x + 8, box.y + box.height / 2);
}
/** runs an export (a click) and returns the files it saved: the names the helper gave back (a toast still showing from
    the last export is not taken for this one). An export that saves nothing and says so (a warning toast: "Saved 0
    PDFs · ⚠ 5 failed: …") fails at once with that message, not after the poll's minute */
async function exported(page: Page, click: () => Promise<unknown>): Promise<string[]> {
  const before = await page.evaluate(() => { const t = (window as any).__sbTest; t.lastExport.files = []; return t.toastNow()?.id ?? 0; });
  await click();
  let files: string[] = [], warning = "";
  await expect.poll(async () => {
    ({ files, warning } = await page.evaluate((id) => { const t = (window as any).__sbTest, m = t.toastNow();
      return { files: [...t.lastExport.files] as string[], warning: m && m.id > id && m.err && !t.exporting() ? String(m.html) : "" }; }, before));
    return files.length > 0 || !!warning;
  }, { timeout: 60_000 }).toBe(true);
  expect(files, "the export saved nothing: " + warning.replace(/<[^>]*>/g, "")).not.toHaveLength(0);
  await expect(page.locator("#exportBtn")).toHaveText("Export PDF");
  return files;
}
const fromMenu = (page: Page, x: string) => exported(page, async () => { await page.click("#exportMenuBtn"); await page.click(`[data-x="${x}"]`); });
/** a PowerPoint file's slides (B21) and the texts of each slide (text boxes and table cells, in the order written) */
const pptxSlides = (b: Buffer) => (strFromU8(unzipSync(new Uint8Array(b))["ppt/presentation.xml"]).match(/<p:sldId /g) || []).length;
const pptxTexts = (b: Buffer) => { const z = unzipSync(new Uint8Array(b)); return Object.keys(z).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort().map(n => [...strFromU8(z[n]).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1]).join(" ")); };
/** a user's preferences are saved 400 ms after a change; a test whose successor relies on "re-opens the last
    workbook" waits for them ("✓ Saved" shows at once since B6, so it no longer gives them time) */
const lastFileSaved = (user: string, name: string) => expect.poll(() => {
  try { return JSON.parse(fs.readFileSync(path.join(data(), "users", user + ".json"), "utf8")).lastFile; } catch { return null; }
}, { timeout: 10_000 }).toBe(name);
/** expect.poll on what the helpers wrote: a read that throws (the document is not written yet, or the field is
    not there yet) counts as "not yet" and is retried - expect.poll fails at once when its callback throws */
const pollFile = <T>(read: () => T, opts?: { timeout?: number }) =>
  expect.poll(() => { try { return read(); } catch (e) { return "not saved yet: " + (e as Error).message; } }, opts);
const saved = (page: Page) => expect(page.locator("#sbSave")).toHaveText("✓ Saved", { timeout: 10_000 });
/** the next tail answer that brings this page a colleague's record (a change has arrived; its own records come back
    too), then a short moment for the worker to fold it and the page to redraw: a test waits for the change itself */
const nextChange = (page: Page) => {
  const me = page.url().startsWith(ANNA) ? "anna" : "bob";
  return page.waitForResponse(async r => {
    if (!/\/api\/decks\/[^/]+\/tail\?since=/.test(r.url()) || r.status() !== 200) return false;
    const t = await r.json().catch(() => null) as { journals?: Record<string, { records: { by?: string }[] }> } | null;
    return Object.values(t?.journals || {}).some(j => j.records.some(x => x.by && x.by !== me));
  }, { timeout: 15_000 }).then(() => page.waitForTimeout(500));
};

test.describe.serial("two people, one shared folder", () => {
  test("anna creates the deck with the wizard", async ({ page }) => {
    await openApp(page, ANNA);
    await openWorkbook(page, "report.xlsx");
    await expect(page.locator(".wiz")).toBeVisible();
    await page.click('[data-a="next"]');                         // sheets → tables
    await expect(page.locator(".wtab")).toHaveCount(3);
    await page.click('[data-a="next"]');                         // tables → slides
    await page.check("#cvOn");                                   // add a cover…
    await page.fill("#cvTitle", "IBD Weekly");
    await page.check("#ixOn");                                   // …and an index
    await page.click('[data-a="finish"]');
    await expect(page.locator(".thumb")).toHaveCount(4);
    await saved(page);
    const d = doc();
    expect(d.preset.slides.map((s: { type: string }) => s.type)).toEqual(["cover", "index", "content", "content"]);
    expect(d.preset.slides[0].title).toBe("IBD Weekly");
    expect(d.updatedBy).toBe("anna");
    await lastFileSaved("anna", "report.xlsx");                 // the next tests re-open it
  });

  test("thumbnails are pictures with their tags; an edit draws its own slide again, no other", async ({ page }) => {
    await openApp(page, ANNA);                                     // re-opens report.xlsx (last file)
    await expect(page.locator(".thumb")).toHaveCount(4);
    await expect(page.locator(".thumb .frame canvas")).toHaveCount(4, { timeout: 15_000 });
    await expect(page.locator(".thumb .tag")).toHaveText(["cover", "index"]);
    const w = await page.locator('.thumb[data-i="2"] .frame canvas').evaluate(c => (c as HTMLCanvasElement).width);
    expect(w).toBe(Math.round(222 * await page.evaluate(() => devicePixelRatio)));
    const drawn = () => page.evaluate(() => (window as unknown as { __sbTest: { thumbStats(): { drawn: number } } }).__sbTest.thumbStats().drawn);
    await page.locator('.thumb[data-i="2"]').click();
    await page.waitForTimeout(1500);
    const before = await drawn();
    await selectCell(page, "Alpha"); await page.keyboard.type("Alfa"); await page.keyboard.press("Enter");
    await expect.poll(drawn, { timeout: 10_000 }).toBe(before + 1);
    await page.waitForTimeout(1500);
    expect(await drawn()).toBe(before + 1);                        // the index lists titles only: its picture stays
    await page.keyboard.press("Control+z"); await saved(page);
    await expect.poll(drawn, { timeout: 10_000 }).toBe(before + 2);
  });

  test("edits by anna and bob on the same workbook are merged, and each sees the other", async ({ browser }) => {
    const a = await browser.newPage(), b = await browser.newPage();
    await openApp(a, ANNA); await openApp(b, BOB);
    // anna re-opens automatically (last file); bob opens it and continues with the preset
    await expect(a.locator(".thumb")).toHaveCount(4);
    await openWorkbook(b, "report.xlsx");
    await b.click('[data-a="continue"]');
    await expect(b.locator(".thumb")).toHaveCount(4);
    await a.locator('.thumb[data-i="2"]').click(); await b.locator('.thumb[data-i="2"]').click();
    // presence
    await expect(a.locator("#presence")).toContainText("bob", { timeout: 15_000 });
    await expect(b.locator("#presence")).toContainText("anna", { timeout: 15_000 });

    // at the same time: anna renames a bank, bob makes another cell bold
    await selectCell(a, "Alpha"); await a.keyboard.type("Alfa"); await a.keyboard.press("Enter");
    await selectCell(b, "Gamma"); await b.keyboard.press("Control+b");
    await saved(a); await saved(b);
    const d = doc();
    expect(d.edits.SLIDE_1.C6).toEqual({ orig: "Alpha", text: "Alfa" });
    expect(d.edits.SLIDE_1.C8).toEqual({ b: true });
    // each sees the other's change after the next poll (≤ 3 s)
    await expect(b.locator("#stage .slide .t", { hasText: /^Alfa$/ })).toHaveCount(1, { timeout: 10_000 });
    await expect(b.locator("#sbRemote")).toContainText("anna");
    await expect(a.locator("#sbRemote")).toContainText("bob", { timeout: 10_000 });     // bob's bold has reached anna
    await selectCell(a, "Gamma");
    await expect(a.locator("#boldBtn")).toHaveClass(/on/);

    // anna undoes HER rename: bob's bold stays
    await a.keyboard.press("Escape");
    await a.keyboard.press("Control+z");
    await saved(a);
    const d2 = doc();
    expect(d2.edits.SLIDE_1.C6).toBeUndefined();
    expect(d2.edits.SLIDE_1.C8).toEqual({ b: true });

    // deck style is shared: bob switches the design, anna follows
    await b.click('[data-design="excel"]');
    await saved(b);
    await expect(a.locator("#stage .slide.excel")).toHaveCount(1, { timeout: 10_000 });
    await b.click('[data-design="glass"]'); await saved(b);
    await a.close(); await b.close();
  });

  test("export writes a PDF into the shared export folder", async ({ page }) => {
    await openApp(page, ANNA);
    await expect(page.locator(".thumb")).toHaveCount(4);
    // the native export (S3.7): the page writes the PDF
    expect(await exported(page, () => page.click("#exportBtn"))).toEqual(["report - slides.pdf"]);
    await expect(page.locator("#toast")).toContainText("report - slides.pdf");
    const read = (f: string) => fs.readFileSync(path.join(root(), "export", f));
    const pdf = read("report - slides.pdf"), src = pdf.toString("latin1");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect((src.match(/\/Type\s*\/Page\b/g) || []).length).toBe(4);
    expect(src).toContain("/Font");                                                    // real text, not pictures of slides
    expect(src).toContain("/ToUnicode");                                               // selectable, searchable
    expect(src).not.toMatch(/\/Subtype\s*\/Type3/);                                    // GF: no glyph-by-glyph fonts
    // one page per slide, exactly the slide's shape: no white strips from rounding or scaling
    const boxes = [...src.matchAll(/\/MediaBox\s*\[([\d. ]+)\]/g)].map(m => m[1].trim().split(/\s+/).map(Number));
    expect(boxes).toHaveLength(4);
    for (const [x0, y0, x1, y1] of boxes) expect((x1 - x0) / (y1 - y0)).toBeCloseTo(16 / 9, 4);
    expect(pdf.length).toBeLessThan(4 * 80 * 1024 + 190 * 1024);                      // GF: Liquid Glass < 80 KB per slide + 190 KB
    const text = pdfPageTexts(pdf);
    expect(text).toHaveLength(4);
    expect(text[0]).toContain("IBD Weekly");                                           // the cover the wizard made
    expect(text.join(" ")).toContain("Alpha 1.234.568");                               // a table row, in order
    // EX-15: an edit typed just before the export is in it (the export flushes pending edits first)
    await page.locator('.thumb[data-i="2"]').click();
    await selectCell(page, "Gamma"); await page.keyboard.type("Gammax"); await page.keyboard.press("Enter");
    expect(await exported(page, () => page.click("#exportBtn"))).toEqual(["report - slides.pdf"]);
    expect(pdfPageTexts(read("report - slides.pdf")).join(" ")).toContain("Gammax");
    await page.keyboard.press("Control+z"); await saved(page);
    await expect(page.locator("#stage .slide .t", { hasText: /^Gamma$/ }).first()).toBeVisible();
    // as pictures (B9): one 2× PNG page per slide (3200 × 1800), "(images)" in the name, no fonts
    expect(await fromMenu(page, "pdf-exact")).toEqual(["report - slides (images).pdf"]);
    const pics = read("report - slides (images).pdf").toString("latin1");
    expect((pics.match(/\/Type\s*\/Page\b/g) || []).length).toBe(4);
    expect((pics.match(/\/Width 3200\/Height 1800/g) || []).length).toBe(4);
    expect(pics).not.toContain("/Font");
    // the mode is remembered: the Export button now makes pictures too; text & tables switches back
    expect(await exported(page, () => page.click("#exportBtn"))).toEqual(["report - slides (images).pdf"]);
    expect(await fromMenu(page, "pdf-vector")).toEqual(["report - slides.pdf"]);
    await expect.poll(() => { try { return JSON.parse(fs.readFileSync(path.join(data(), "users", "anna.json"), "utf8")).pdfMode; } catch { return null; } }).toBe("vector");
    // the current slide only: one page, named after the slide
    await page.locator(".thumb").nth(2).click();
    const [one] = await fromMenu(page, "pdf-current");
    expect(one).toMatch(/^report - .+\.pdf$/);
    expect(one).not.toBe("report - slides.pdf");
    expect((read(one).toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length).toBe(1);
    // the old engine is gone (S4.5): the menu has no item for it, and the helper no longer renders slides
    await page.click("#exportMenuBtn");
    await expect(page.locator('[data-x="pdf-vector"]')).toBeVisible();
    await expect(page.locator('[data-x="pdf-old"]')).toHaveCount(0);
    await page.click("#exportMenuBtn");
    const token = await page.locator('meta[name="sb-token"]').getAttribute("content");
    expect((await page.request.post(ANNA + "api/export", { data: {}, headers: { "X-SB-Token": token! }, failOnStatusCode: false })).status()).toBe(404);
  });

  test("PNG of the current slide and of every slide; the current slide copied to the clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ANNA.replace(/\/$/, "") });
    await openApp(page, ANNA);
    await expect(page.locator(".thumb")).toHaveCount(4);
    const size = (b: Buffer) => [b.readUInt32BE(16), b.readUInt32BE(20)];                // the PNG's IHDR
    await page.locator(".thumb").nth(1).click();
    const [cur, ...more] = await fromMenu(page, "png-current");
    expect(more).toEqual([]);
    expect(cur).toMatch(/^report - .+\.png$/);
    const png = fs.readFileSync(path.join(root(), "export", cur));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(size(png)).toEqual([4800, 2700]);                                           // as before: 3× the slide
    const all = await fromMenu(page, "png-all");
    expect(all).toHaveLength(4);
    expect(all).toContain(cur);
    for (const f of all) expect(size(fs.readFileSync(path.join(root(), "export", f)))).toEqual([4800, 2700]);
    // copy: a PNG of the current slide on the clipboard, nothing in the export folder
    const before = fs.readdirSync(path.join(root(), "export")).length;
    await page.click("#exportMenuBtn"); await page.click('[data-x="copy"]');
    await expect(page.locator("#toast")).toContainText("copied", { timeout: 60_000 });
    const clip = await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read();
      const blob = await item.getType("image/png"), bmp = await createImageBitmap(blob);
      return { types: item.types, w: bmp.width, h: bmp.height };
    });
    expect(clip).toEqual({ types: ["image/png"], w: 4800, h: 2700 });
    expect(fs.readdirSync(path.join(root(), "export")).length).toBe(before);

    // the pilot's "Report a problem with this export" (S3.8): the form and the last export as one JSON file in export/feedback
    await page.click("#exportMenuBtn"); await page.click('[data-x="report"]');
    await expect(page.locator("#fbWhich")).toHaveValue("png");                           // the last export was the copied slide
    await page.selectOption("#fbWhat", "P3");
    await page.fill("#fbSlide", "2");
    await page.fill("#fbText", "the last row's border is missing");
    await page.press("#fbText", "Enter");                                                 // a new line, not "save"
    await page.locator("#fbText").pressSequentially("in Acrobat");
    await expect(page.locator(".modal .dlg")).toBeVisible();
    await page.click('[data-a="save"]');
    await expect(page.locator("#toast")).toContainText("Report saved as export\\feedback\\");
    const fb = fs.readdirSync(path.join(root(), "export", "feedback"));
    expect(fb).toHaveLength(1);
    expect(fb[0]).toMatch(/^\d{8}-\d{6}-.+\.json$/);
    const rep = JSON.parse(fs.readFileSync(path.join(root(), "export", "feedback", fb[0]), "utf8"));
    expect(rep).toMatchObject({ kind: "export-feedback", schema: 1, report: {
      form: { what: "P3", which: "png", slide: 2, comment: "the last row's border is missing\nin Acrobat" },
      deck: { slides: 4 }, lastExport: { kind: "copy", files: [] }, servedByHelper: true } });
    expect(rep.report.deck.workbook).toMatch(/^report\./);
    expect(rep.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("table tools: same size, alignment, widths, text boxes, colour scale, Shift+arrows", async ({ browser }) => {
    const a = await browser.newPage(), b = await browser.newPage();
    await openApp(a, ANNA); await openApp(b, BOB);
    await expect(a.locator(".thumb")).toHaveCount(4); await expect(b.locator(".thumb")).toHaveCount(4);
    await a.locator('.thumb[data-i="3"]').click(); await b.locator('.thumb[data-i="3"]').click();
    // the decks' logo "logo.png" is not in the folder: the side panel says so (the slide draws no logo for it)
    await expect(a.locator("#issues")).toContainText("Logo “logo.png” not found in the folder");
    const rects =(p: Page) => p.$$eval("#stage .slide > .tw", els => els.map(e => { const r = e.getBoundingClientRect(); return { x: r.left, w: r.width, h: r.height }; }));
    const slideX = async (p: Page) => (await p.locator("#stage .slide").boundingBox())!.x;

    // same size + left alignment (one undo step each)
    await a.click("#sameSize"); await saved(a);
    let r = await rects(a); expect(Math.abs(r[0].w - r[1].w)).toBeLessThan(1.5); expect(Math.abs(r[0].h - r[1].h)).toBeLessThan(1.5);
    await a.click("#posBtn"); await a.click('[data-talign="left"]'); await saved(a);
    const k = (await a.locator("#stage .slide").boundingBox())!.width / 1600;
    r = await rects(a); expect(r[0].x - await slideX(a)).toBeCloseTo(50 * k, 0);

    // Shift+arrows on the slide, then a typed column width for the selected columns
    await selectCell(a, "R1"); await a.keyboard.press("Shift+ArrowDown"); await a.keyboard.press("Shift+ArrowRight");
    await expect(a.locator("#nameBox")).toHaveText("SLIDE_3 pair!C5:D6");
    await a.fill("[title^='Width of the selected']", "150"); await a.keyboard.press("Enter");
    // meanwhile bob adds a text box above the first table on the same slide
    await selectCell(b, "R2"); await b.click('[data-addnote="top"]');
    await b.locator("textarea.note-edit").fill("Loans grew everywhere"); await b.keyboard.press("Control+Enter");
    await saved(a); await saved(b);
    let d = doc(); const pair = d.preset.slides[3], t0 = d.preset.tables.find((t: any) => t.id === pair.tables[0]);
    expect(t0.sizes.glass.cols).toMatchObject({ "3": 150, "4": 150 });           // anna's widths (in this design only)…
    expect(Object.values(pair.notes).map((n: any) => n.text)).toEqual(["Loans grew everywhere"]);   // …and bob's text box
    await expect(a.locator("#stage .tnote", { hasText: "Loans grew everywhere" })).toHaveCount(1, { timeout: 10_000 });
    // "Excel size" (TA-02): the selected columns go back to the workbook's widths in this design (where W keeps them)
    await selectCell(a, "R1"); await a.keyboard.press("Shift+ArrowDown"); await a.keyboard.press("Shift+ArrowRight");
    await expect(a.locator("#nameBox")).toHaveText("SLIDE_3 pair!C5:D6");
    const wide = (await a.locator("#stage .slide > .tw").first().boundingBox())!.width;
    await a.click("#sizeReset"); await saved(a);
    const t0r = doc().preset.tables.find((t: any) => t.id === pair.tables[0]);
    expect([t0r.sizes?.glass?.cols?.["3"], t0r.sizes?.glass?.cols?.["4"]]).toEqual([undefined, undefined]);
    await expect.poll(async () => (await a.locator("#stage .slide > .tw").first().boundingBox())!.width).toBeLessThan(wide - 10);
    await a.keyboard.press("Escape"); await a.keyboard.press("Control+z"); await saved(a);           // one undo step: 150 px again
    await pollFile(() => doc().preset.tables.find((t: any) => t.id === pair.tables[0]).sizes.glass.cols, { timeout: 10_000 }).toMatchObject({ "3": 150, "4": 150 });

    // colour scale on the second table
    const nums = a.locator("#stage .slide > .tw").nth(1).locator(".t", { hasText: /^-?[\d.]+,\d$/ });
    const f = (await nums.first().boundingBox())!, l = (await nums.last().boundingBox())!;
    await a.mouse.move(f.x + f.width / 2, f.y + f.height / 2); await a.mouse.down(); await a.mouse.move(l.x + l.width / 2, l.y + l.height / 2, { steps: 4 }); await a.mouse.up();
    await a.click("#scaleBtn"); await a.click("#scaleApply"); await saved(a);
    d = doc(); const t1 = d.preset.tables.find((t: any) => t.id === d.preset.slides[3].tables[1]);
    expect(Object.values(t1.scales)).toEqual([{ range: "I5:K13", dir: "col", mode: "zero", fill: true, ink: false }]);
    await expect(a.locator("#stage .slide > .tw").nth(1).locator(".cap.scale")).not.toHaveCount(0);

    // corners and contrast are deck settings
    await a.click("#optBtn"); await a.locator("#radiusRange").fill("0"); await a.locator("#contrastRange").fill("80"); await a.keyboard.press("Escape");
    await pollFile(() => doc().style, { timeout: 10_000 }).toMatchObject({ radius: 0, contrast: 80 });   // sliders apply after a short pause
    // soft shadows on screen (B3, a personal setting): a true blur instead of the PDF's 5 layers, and back
    const blurs = () => a.locator("#stage .slide svg filter feGaussianBlur").count();
    expect(await blurs()).toBe(0);
    await a.click("#optBtn"); await a.check("#softShadows"); await a.keyboard.press("Escape");
    await expect.poll(blurs, { timeout: 10_000 }).toBeGreaterThan(0);
    await a.click("#optBtn"); await a.uncheck("#softShadows"); await a.keyboard.press("Escape");
    await expect.poll(blurs, { timeout: 10_000 }).toBe(0);
    await a.close(); await b.close();
  });

  test("drags on the slide: corner scale, grip move, border double-click – each one undo step", async ({ page }) => {
    await openApp(page, ANNA);
    await expect(page.locator(".thumb")).toHaveCount(4);
    await page.locator('.thumb[data-i="3"]').click();                                     // SLIDE_3 pair: two tables
    const design = () => doc().style.design || "glass", slideDef = () => doc().preset.slides[3];
    const sizing = () => JSON.stringify(slideDef().sizes?.[design()] || {});
    const rect = async (i: number) => (await page.locator(`#stage .slide > .tw[data-i="${i}"]`).boundingBox())!;
    const undo = async () => { await page.locator("#stage .stagewrap").click({ position: { x: 4, y: 4 } }); await page.keyboard.press("Control+z"); };
    await page.locator("#stage .stagewrap").hover();

    // the corner of the first table: smaller, its proportions kept; one undo step back
    const before = sizing(), w0 = (await rect(0)).width;
    const corner = (await page.locator('#stage .hbox[data-i="0"] .size').boundingBox())!;
    await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2); await page.mouse.down();
    await page.mouse.move(corner.x - 120, corner.y - 60, { steps: 8 }); await page.mouse.up();
    await pollFile(sizing, { timeout: 10_000 }).not.toBe(before);
    await expect.poll(async () => (await rect(0)).width).toBeLessThan(w0 - 20);
    await undo();
    await pollFile(sizing, { timeout: 10_000 }).toBe(before);

    // the grip of the second table, dropped above the first one: the second table goes on top
    const t0 = await rect(0), grip = (await page.locator('#stage .hbox[data-i="1"] .grip').boundingBox())!;
    await page.mouse.move(grip.x + 10, grip.y + grip.height / 2); await page.mouse.down();
    await page.mouse.move(t0.x + t0.width / 2, t0.y + 4, { steps: 8 });
    await expect(page.locator("#stage .dropmark")).toBeVisible();
    await page.mouse.up();
    await pollFile(() => JSON.stringify(slideDef().sizes?.[design()]?.layout?.bands), { timeout: 10_000 }).toBe(JSON.stringify([[1], [0]]));
    await expect.poll(async () => (await rect(1)).y).toBeLessThan((await rect(0)).y);
    await undo();
    await pollFile(sizing, { timeout: 10_000 }).toBe(before);

    // a double-click on a column border: that column back to its Excel width (it was 150 px since "table tools")
    const cols = () => doc().preset.tables.find((t: any) => t.id === slideDef().tables[0]).sizes[design()].cols;
    expect(cols()["3"]).toBe(150);
    const r1 = (await page.locator('#stage .slide > .tw[data-i="0"] .t', { hasText: /^R1$/ }).boundingBox())!;
    await page.mouse.dblclick(r1.x + r1.width, r1.y + r1.height / 2);
    await pollFile(() => cols()["3"] ?? "excel", { timeout: 10_000 }).toBe("excel");
    expect(cols()["4"]).toBe(150);                                                        // only that column
    await undo();
    await pollFile(() => cols()["3"], { timeout: 10_000 }).toBe(150);
  });

  test("wizard table picker: Shift+arrows select, Enter adds the table", async ({ page }) => {
    await openApp(page, ANNA);
    await page.click("#wizardBtn"); await page.click('[data-a="next"]');
    await page.locator(".wtab", { hasText: "SLIDE_2 panel" }).click();
    await page.locator('.wgrid-in td[data-r="3"][data-c="2"]').click();
    for (const k of ["Shift+ArrowDown", "Shift+ArrowDown", "Shift+ArrowRight", "Shift+ArrowRight"]) await page.keyboard.press(k);
    await expect(page.locator("#wRange")).toHaveValue("B3:D5");
    await page.keyboard.press("Enter");
    await expect(page.locator(".wtrow")).toHaveCount(1);
    await page.locator(".wtrow .rgin").first().waitFor();
    await expect(page.locator(".wtrow .rgin")).toHaveValue("B3:D5");
    await page.click('[data-x="close"]'); await page.click('.modal [data-a="ok"]');
  });

  test("header colour, merge/unmerge, format painter, footer", async ({ page }) => {
    await openApp(page, ANNA);
    await expect(page.locator(".thumb")).toHaveCount(4);
    await page.locator('.thumb[data-i="2"]').click();
    const drag = async (from: string, to: string) => {
      const cell = (t: string) => page.locator("#stage .slide .t", { hasText: new RegExp("^" + t + "$") }).first();
      const f = (await cell(from).boundingBox())!, l = (await cell(to).boundingBox())!;
      await page.mouse.move(f.x + 6, f.y + f.height / 2); await page.mouse.down();
      await page.mouse.move(l.x + 6, l.y + l.height / 2, { steps: 4 }); await page.mouse.up();
    };
    // header row: a cell colour that replaces the Excel colour
    await drag("Bank", "Note");
    await page.click("#fillBtn"); await page.click('[data-bg="#FF3B30"]'); await saved(page);
    let e = doc().edits.SLIDE_1;
    for (const r of ["C4", "D4", "J4"]) expect(e[r].bg).toBe("#FF3B30");
    // merge two header cells, split the workbook's merged "Domestic" row
    await page.keyboard.press("Escape"); await drag("Loans", "Deposits");
    await page.click("#mergeBtn"); await saved(page);
    await selectCell(page, "Domestic"); await page.click("#unmergeBtn"); await saved(page);
    expect(doc().preset.tables.find((t: any) => t.sheet === "SLIDE_1").merges).toEqual({ "D4:F4": "merge", "C5:J5": "split" });
    // format painter: copy the header format onto the bank names
    await selectCell(page, "Bank"); await page.click("#painterBtn");
    await expect(page.locator("body")).toHaveClass(/painting/);
    await drag("Alpha", "Gamma"); await saved(page);
    await expect(page.locator("body")).not.toHaveClass(/painting/);
    e = doc().edits.SLIDE_1;
    for (const r of ["C6", "C7", "C8"]) expect(e[r].bg).toBe("#FF3B30");
    // footer on every slide
    await page.click("#optBtn"); await page.check("#ftOn");
    await page.fill("#ftText", "Confidential · {workbook}"); await page.keyboard.press("Enter");
    await page.click('#ftPos [data-pos="bc"]'); await page.keyboard.press("Escape"); await saved(page);
    expect(doc().style.footer).toMatchObject({ on: true, text: "Confidential · {workbook}", pos: "bc" });
    await expect(page.locator("#stage .slide .footer")).toContainText("Confidential · report");
    await page.screenshot({ path: path.join(process.env.SB_E2E_TMP!, "header.png") });
  });

  test("painter copies conditional formats; gridlines, vertical align, border drag, text box bubble, contents subtitles, themes", async ({ page }) => {
    await openApp(page, ANNA);
    await expect(page.locator(".thumb")).toHaveCount(4);
    await page.locator('.thumb[data-i="2"]').click();
    const cell = (t: string) => page.locator("#stage .slide .t", { hasText: new RegExp("^" + t + "$") }).first();
    const drag = async (from: string, to: string) => {
      const f = (await cell(from).boundingBox())!, l = (await cell(to).boundingBox())!;
      await page.mouse.move(f.x + 6, f.y + f.height / 2); await page.mouse.down();
      await page.mouse.move(l.x + 6, l.y + l.height / 2, { steps: 4 }); await page.mouse.up();
    };
    const tdef = () => doc().preset.tables.find((t: any) => t.sheet === "SLIDE_1");
    const sdef = (i: number) => doc().preset.slides[i];

    // format painter: the conditional format of Δ w/w (green when > 0) travels to the dates
    const caps = await page.locator("#stage .slide > .tw").first().locator(".cap").count();
    await selectCell(page, "\\+2,5"); await page.click("#painterBtn");
    await drag("01/01/2024", "03/03/2024"); await saved(page);
    const e = doc().edits.SLIDE_1;
    for (const r of ["I6", "I7", "I8"]) expect(e[r].cf).toBe("SLIDE_1!E6");
    await expect.poll(() => page.locator("#stage .slide > .tw").first().locator(".cap").count()).toBeGreaterThanOrEqual(caps + 3);

    // gridlines: no horizontal lines, vertical lines everywhere
    await selectCell(page, "Zeta");
    await page.click("#gridBtn"); await page.click('[data-grid="gridH"] [data-v="off"]'); await saved(page);
    await page.click("#gridBtn"); await page.click('[data-grid="gridV"] [data-v="on"]'); await saved(page);
    expect(tdef()).toMatchObject({ gridH: "off", gridV: "on" });

    // tables at the top of the slide
    await page.click("#posBtn"); await page.click('[data-tvalign="top"]'); await saved(page);
    expect(sdef(2).sizes[doc().style.design || "glass"].valign).toBe("top");     // per design

    // drag the right border of the table: every column gets narrower
    const edge = (await page.locator('.hbox[data-i="0"] .edge.r').boundingBox())!;
    await page.mouse.move(edge.x + 4, edge.y + edge.height / 4); await page.mouse.down();       // (the + button sits in the middle)
    await page.mouse.move(edge.x - 150, edge.y + edge.height / 4, { steps: 5 }); await page.mouse.up();
    await pollFile(() => Object.keys(tdef().sizes?.[doc().style.design || "glass"]?.cols || {}).length, { timeout: 10_000 }).toBe(7);      // C…J without the hidden column

    // text box below the table, in a bubble, centred both ways
    await selectCell(page, "Zeta"); await page.click('[data-addnote="bottom"]');
    await page.locator("textarea.note-edit").fill("Source: ECB"); await page.keyboard.press("Control+Enter"); await saved(page);
    await page.locator("#stage .tnote", { hasText: "Source: ECB" }).click();
    await page.click("#noteBubble"); await saved(page);
    await page.click('[data-valign="middle"]'); await saved(page);
    await page.click('[data-align="center"]'); await saved(page);
    expect(Object.values(sdef(2).notes)).toContainEqual(expect.objectContaining({ text: "Source: ECB", bubble: true, valign: "middle", align: "center" }));
    await expect(page.locator("#stage .notebub")).toHaveCount(1);
    await page.screenshot({ path: path.join(process.env.SB_E2E_TMP!, "round4-slide.png") });

    // contents page without subtitles
    await page.locator('.thumb[data-i="1"]').click();
    await expect(page.locator("#stage .ix-s")).not.toHaveCount(0);
    await page.click("#ixSubs"); await saved(page);
    expect(sdef(1).subs).toBe(false);
    await expect(page.locator("#stage .ix-s")).toHaveCount(0);

    // colour themes (for this design only, the default): Intesa Sanpaolo, then a custom one
    await page.click("#themeBtn");
    await expect(page.locator('#lookScope [data-scope="design"]')).toHaveClass(/on/);
    await page.click('[data-theme="intesa"]'); await saved(page);
    expect(doc().style.designs.glass.theme.id).toBe("intesa");
    await expect.poll(() => page.locator("#stage .slide").evaluate(el => (el as HTMLElement).style.getPropertyValue("--a1"))).toBe("#00953B");
    await page.screenshot({ path: path.join(process.env.SB_E2E_TMP!, "round4-intesa.png") });
    await page.click('[data-theme="custom"]'); await saved(page);
    await page.locator('[data-tk="c1"]').fill("#123456");
    await pollFile(() => doc().style.designs.glass.theme, { timeout: 10_000 }).toMatchObject({ id: "custom", c1: "#123456", a1: "#00953B" });
    await page.click('[data-theme="aurora"]'); await saved(page);
    // the third design gets its own colours; Liquid Glass does not see them
    await page.click('.tsdlg [data-a="close"]');
    await page.locator('.thumb[data-i="2"]').click(); await page.click('[data-design="clean"]'); await saved(page);
    // Excel Refined draws the tables exactly as Excel does (the workbook's colours) – it only adds text boxes
    const tableOf = () => page.locator("#stage .slide > .tw").first().innerHTML();
    const refined = await tableOf();
    await page.click('[data-design="excel"]'); await saved(page);
    expect(await tableOf()).toBe(refined);
    await page.click('[data-design="clean"]'); await saved(page);
    await page.click("#themeBtn");
    await expect(page.locator('[data-color="head"]')).toHaveCount(0);                 // no table colours to override
    await page.locator('[data-color="accent"] input').evaluate(el => { (el as HTMLInputElement).value = "#5b2c83"; el.dispatchEvent(new Event("change", { bubbles: true })); });
    await pollFile(() => doc().style.designs?.clean?.colors, { timeout: 10_000 }).toEqual({ accent: "#5B2C83" });
    expect(doc().style.colors).toBeUndefined();
    expect(await tableOf()).toBe(refined);                                              // the tables keep the workbook's colours
    // all designs: one accent everywhere, and the design's own value for it goes
    await page.click('#lookScope [data-scope="all"]');
    await page.locator('[data-color="accent"] input').evaluate(el => { (el as HTMLInputElement).value = "#aa0000"; el.dispatchEvent(new Event("change", { bubbles: true })); });
    await pollFile(() => doc().style.colors, { timeout: 10_000 }).toEqual({ accent: "#AA0000" });
    await page.click("#colorsReset");                                                     // for all designs: the design's own colours go too
    await expect(page.locator("#colorsReset")).toBeDisabled();
    await page.click('#lookScope [data-scope="design"]'); await expect(page.locator("#colorsReset")).toBeDisabled(); await page.click('.tsdlg [data-a="close"]');
    await page.click('[data-design="glass"]'); await saved(page);
    expect(doc().style.colors).toBeUndefined();
    expect(doc().style.designs?.clean?.colors).toBeUndefined();
  });

  test("typing is never overwritten by autosave or other people's changes; logo bubble can be removed", async ({ browser }) => {
    const a = await browser.newPage(), b = await browser.newPage();
    await openApp(a, ANNA); await openApp(b, BOB);
    await expect(a.locator(".thumb")).toHaveCount(4); await expect(b.locator(".thumb")).toHaveCount(4);
    await a.locator('.thumb[data-i="2"]').click(); await b.locator('.thumb[data-i="2"]').click();
    // anna starts typing a footer, bob changes the deck meanwhile (a poll and re-render arrive at anna)
    await a.click("#optBtn"); await a.locator("#ftText").click(); await a.keyboard.press("Control+a"); await a.keyboard.type("Draft for");
    let arrived = nextChange(a);
    await selectCell(b, "Kappa"); await b.keyboard.press("Control+b"); await saved(b);
    await arrived;
    await expect(a.locator("#ftText")).toHaveValue("Draft for");
    await a.keyboard.type(" review"); await a.keyboard.press("Enter"); await saved(a);
    expect(doc().style.footer.text).toBe("Draft for review");
    // the logo bubble switch is in the Logo section
    await a.click("#logoBubble"); await saved(a);
    expect(doc().style.logoBubble).toBe(false);
    await a.click("#logoBubble"); await a.keyboard.press("Escape"); await saved(a);
    // anna edits a cell while bob's change arrives: the editor and her text survive
    await selectCell(a, "Lambda"); await a.keyboard.type("Lamb");
    arrived = nextChange(a);
    await selectCell(b, "Kappa"); await b.keyboard.press("Control+i"); await saved(b);
    await arrived;
    await expect(a.locator("input.inline-edit")).toHaveValue("Lamb");
    await a.keyboard.type("da 2"); await a.keyboard.press("Enter"); await saved(a);
    expect(doc().edits.SLIDE_1.C16).toMatchObject({ orig: "Lambda", text: "Lambda 2" });
    await a.close(); await b.close();
  });

  test("one text toolbar for cells, titles and text boxes; deck text styles; shared font library", async ({ browser }) => {
    const a = await browser.newPage(), b = await browser.newPage();
    await openApp(a, ANNA); await openApp(b, BOB);
    await expect(a.locator(".thumb")).toHaveCount(4);
    await a.locator('.thumb[data-i="2"]').click();
    const sdef = (i: number) => doc().preset.slides[i];
    // nothing selected: the controls say so instead of changing shape
    await expect(a.locator("#textTarget")).toHaveText("No text selected");
    await expect(a.locator("#boldBtn")).toBeDisabled();
    // the title: click selects it, the same controls format it (sizes in points)
    await a.locator("#stage .slide .title").click();
    await expect(a.locator("#textTarget")).toHaveText("Title");
    await a.fill("#sizeBox", "40"); await a.press("#sizeBox", "Enter");
    await pollFile(() => sdef(2).fmt?.title?.size, { timeout: 10_000 }).toBe(53.3);
    await a.click("#fontBtn"); await a.click('.fontmenu [data-font="Georgia"]');
    await a.click('[data-align="center"]');
    await pollFile(() => sdef(2).fmt?.title, { timeout: 10_000 }).toMatchObject({ font: "Georgia", align: "center", size: 53.3 });
    await expect(a.locator("#stage .slide .title")).toHaveCSS("font-family", /Georgia/);
    await a.click("#clearFmt");
    await pollFile(() => sdef(2).fmt, { timeout: 10_000 }).toBeUndefined();
    // a cell: same font menu
    await selectCell(a, "Theta");
    await expect(a.locator("#textTarget")).toHaveText(/^Cell /);
    await a.click("#fontBtn"); await a.click('.fontmenu [data-font="Verdana"]');
    await pollFile(() => Object.values(doc().edits.SLIDE_1 || {}).some((e: any) => e.font === "Verdana"), { timeout: 10_000 }).toBe(true);
    // deck text styles: every text box of the deck in one place
    await a.click("#textStylesBtn");
    await a.locator('.tsrow[data-role="note"] .fontbtn').click(); await a.click('.fontmenu [data-font="Trebuchet MS"]');
    await pollFile(() => doc().style.designs?.glass?.text?.note, { timeout: 10_000 }).toEqual({ font: "Trebuchet MS" });   // for this design (the default scope)
    // fonts: an uploaded font goes to the shared library – bob gets it too
    await a.click("#tabFonts");
    const file = path.join(process.env.SB_E2E_TMP!, "CorpSans-Bold.ttf"); fs.writeFileSync(file, sfnt("Corp Sans", 700));
    await a.setInputFiles(".fontstab input[type=file]", file);
    await expect(a.locator('#fontLib [data-family="Corp Sans"]')).toBeVisible();
    const lib = JSON.parse(fs.readFileSync(path.join(data(), "fonts", "fonts.json"), "utf8"));
    expect(lib.fonts[0]).toMatchObject({ family: "Corp Sans", source: "upload", by: "anna", faces: [{ weight: 700, style: "normal" }] });
    // a variable font is stored as a static face at its declared weight (S3.2: the core worker pins its axes)
    await a.setInputFiles(".fontstab input[type=file]", path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "core", "tests", "fixtures", "fonts", "Quicksand[wght].ttf"));
    await expect(a.locator('#fontLib [data-family="Quicksand"]')).toBeVisible();
    const qs = JSON.parse(fs.readFileSync(path.join(data(), "fonts", "fonts.json"), "utf8")).fonts.find((f: any) => f.family === "Quicksand");
    const stored = fs.readFileSync(path.join(data(), "fonts", qs.faces[0].file));
    const tags = Array.from({ length: stored.readUInt16BE(4) }, (_, i) => stored.toString("latin1", 12 + 16 * i, 16 + 16 * i));
    expect(tags).toContain("glyf");
    expect(tags.filter(t => ["fvar", "gvar", "HVAR", "avar"].includes(t))).toEqual([]);
    await a.locator('#fontLib [data-family="Quicksand"] .btn.icon').click(); await a.click('.modal [data-a="ok"]');
    await expect(a.locator('#fontLib [data-family="Quicksand"]')).toHaveCount(0);
    await a.click('.tsdlg [data-a="close"]');
    await openWorkbook(b, "report.xlsx"); await continueOpen(b, "report.xlsx"); await expect(b.locator(".thumb")).toHaveCount(4);
    await b.click("#textStylesBtn"); await b.click("#tabFonts");
    await expect(b.locator('#fontLib [data-family="Corp Sans"]')).toBeVisible();
    await b.locator('#fontLib [data-family="Corp Sans"] .btn.icon').click(); await b.click('.modal [data-a="ok"]');
    await expect(b.locator('#fontLib [data-family="Corp Sans"]')).toHaveCount(0);
    await b.click('.tsdlg [data-a="close"]');
    // back to the design's look for the next tests
    await a.click("#textStylesBtn"); await a.locator('.tsrow[data-role="note"] .btn', { hasText: "Reset" }).click();
    await pollFile(() => doc().style.designs?.glass?.text, { timeout: 10_000 }).toBeUndefined();
    await a.click('.tsdlg [data-a="close"]');
    await a.close(); await b.close();
  });

  test("automated comments: one short summary for the slide's tables, follows the numbers; text boxes stretch and snap", async ({ page }) => {
    await openApp(page, BOB);
    await openWorkbook(page, "weekly.xlsx");
    await page.click('[data-a="next"]:has-text("Tables")'); await page.click('[data-a="next"]:has-text("Slides")'); await page.click('[data-a="finish"]');
    await expect(page.locator(".thumb")).toHaveCount(1);
    await page.click("#commentBtn");
    // a new comment is written as the macro writes it (B50); the summary joins the slide's tables
    await expect(page.locator('#cmtMode [data-mode="macro"]')).toHaveClass(/on/);
    await expect(page.locator("#cmtPreview")).toContainText("vs Budget - Budget Performance");
    await page.click('#cmtMode [data-mode="summary"]');
    await expect(page.locator('#cmtMode [data-mode="summary"]')).toHaveClass(/on/);
    await expect(page.locator("#cmtTables input:checked")).toHaveCount(2);                 // both tables of the slide
    const prev = page.locator("#cmtPreview");
    await expect(prev).toContainText("Total Banks Loans:");
    await expect(prev).toContainText("Total Banks Deposits:");
    await expect(prev).toContainText("w/w");
    await expect(prev).toContainText("vs Budget");
    await expect(prev).toContainText("vs EoM Aug");
    await expect(prev).not.toContainText("25/09/26");                                     // no dates
    await expect(prev).toContainText(/(Strong|Solid|Slightly positive|Weak|Slightly negative|Flat|Positive|Negative) week|weekly decline/);
    await page.locator('#cmtShape [data-shape="bullets"]').uncheck();
    await expect(prev).not.toContainText("•");
    await page.locator('#cmtShape [data-shape="bullets"]').check();
    await page.locator('#cmtKinds [data-kind="month"]').uncheck();
    await expect(prev).not.toContainText("vs EoM");
    // the boxes keep what is typed key by key: a space inside the unit, a number that starts with "0"
    await page.locator("#cmtUnit").click(); await page.keyboard.press("Control+a");
    await page.keyboard.type("mln EUR");
    await expect(page.locator("#cmtUnit")).toHaveValue("mln EUR");
    await page.locator("#cmtMin").click(); await page.keyboard.type("0.5");
    await expect(page.locator("#cmtMin")).toHaveValue("0.5");
    await page.keyboard.press("Control+a"); await page.keyboard.press("Backspace");        // back to "all movements"
    await page.click("#cmtInsert");
    const wdoc = () => deckDoc("weekly.xlsx");
    await pollFile(() => Object.values(wdoc().preset.slides[0].notes || {}).filter((n: any) => n.auto).length, { timeout: 10_000 }).toBe(1);
    const auto: any = Object.values(wdoc().preset.slides[0].notes).find((n: any) => n.auto);
    expect(auto.auto).toMatchObject({ mode: "summary", kinds: ["week", "target"], unit: "mln EUR" });
    expect(auto.auto.minAbs).toBeUndefined();
    expect(auto.auto.sections).toBeUndefined();                                            // (a summary: no macro sections)
    expect(auto.auto.tables).toHaveLength(1);
    const note = page.locator("#stage .tnote.auto");
    await expect(note).toHaveCount(1);
    await expect(note).toContainText("Total Banks Deposits");
    // changing a number on the slide rewrites the comment
    const before = await note.textContent();
    await selectCell(page, "VUB");
    for (let k = 0; k < 5; k++) await page.keyboard.press("ArrowRight");                // Δ vs. Budget Abs. of VUB
    await page.keyboard.type("900"); await page.keyboard.press("Enter");
    await expect.poll(() => note.textContent(), { timeout: 10_000 }).not.toBe(before);
    // stretch the comment by its bottom edge: it snaps to the bottom of a table, with a guide line
    const nb = (await note.boundingBox())!, tw = (await page.locator("#stage .slide > .tw").nth(0).boundingBox())!;   // the comment spans both tables: shorten it to the first one
    await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height - 2); await page.mouse.down();
    await page.mouse.move(nb.x + nb.width / 2, tw.y + tw.height + 3, { steps: 6 });
    await expect(page.locator("#stage .snapline.h")).toBeVisible();
    await page.mouse.up();
    await pollFile(() => (Object.values(wdoc().preset.slides[0].notes).find((n: any) => n.auto) as any).h, { timeout: 10_000 }).toBeGreaterThan(0);
    await expect(page.locator("#stage .snapline")).toHaveCount(0);
    await lastFileSaved("bob", "weekly.xlsx");                    // the next tests re-open it
  });

  test("the + button puts a text box there at once; text boxes move anywhere, snap, and attach back", async ({ page }) => {
    await openApp(page, BOB);
    await expect(page.locator(".thumb")).toHaveCount(1);                                   // weekly.xlsx (last file)
    const wdoc = () => deckDoc("weekly.xlsx");
    const notes = () => wdoc().preset.slides[0].notes || {};
    // + below the second table: the box is there immediately, ready for typing
    await page.locator('#stage .stagewrap').hover();
    await page.locator('#stage .hbox[data-i="1"] .addnote.bottom').click();
    await expect(page.locator("textarea.note-edit")).toBeVisible();
    await page.keyboard.type("Source: ECB"); await page.keyboard.press("Control+Enter");
    const box = page.locator("#stage .tnote", { hasText: "Source: ECB" });
    await expect(box).toBeVisible();
    // line and paragraph spacing
    await box.click();
    await page.click("#spacingBtn"); await page.click('.spacemenu [data-lh="1.5"]');
    await page.click("#spacingBtn"); await page.click('.spacemenu [data-pgap="1"]');
    await pollFile(() => { const n: any = Object.values(notes()).find((x: any) => x.text === "Source: ECB"); return n && [n.lh, n.pgap]; }, { timeout: 10_000 }).toEqual([1.5, 1]);
    await expect(box).toHaveCSS("line-height", /px/);
    // drag it by its body: it becomes free and stays where it was dropped
    const b = (await box.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2 - 40, { steps: 8 }); await page.mouse.up();
    await pollFile(() => { const n: any = Object.values(notes()).find((x: any) => x.text === "Source: ECB"); return n && n.x != null && n.y != null; }, { timeout: 10_000 }).toBe(true);
    await expect(page.locator("#stage .tnote.free", { hasText: "Source: ECB" })).toBeVisible();
    // and back next to its table
    await page.locator("#stage .tnote.free", { hasText: "Source: ECB" }).click();
    await page.click("#noteAttach");
    await pollFile(() => { const n: any = Object.values(notes()).find((x: any) => x.text === "Source: ECB"); return n && n.x; }, { timeout: 10_000 }).toBeUndefined();
  });

  test("notes section of a slide: where the footer is, movable next to the page number; raw Excel draws it too (B19); menus open", async ({ page }) => {
    await openApp(page, BOB);
    await expect(page.locator(".thumb")).toHaveCount(1);
    const wdoc = () => deckDoc("weekly.xlsx");
    // the Options menu is visible (not cut off by the top bar)
    await page.click("#optBtn");
    await expect(page.locator("#pnOn")).toBeVisible();
    await page.check("#pnOn"); await saved(page);
    await page.keyboard.press("Escape");
    // notes: added where the footer is, typed at once
    await page.click("#slideNotes");
    await expect(page.locator("textarea.note-edit")).toBeVisible();
    await page.keyboard.type("Source: internal data; figures not audited"); await page.keyboard.press("Control+Enter");
    const memo = page.locator("#stage .tnote.memo");
    await expect(memo).toContainText("Source: internal data");
    const mb = await boxOf(memo), slide = await boxOf(page.locator("#stage .slide"));
    expect(mb.y).toBeGreaterThan(slide.y + slide.height * .85);                          // at the bottom, like the footer
    // move it: its bottom edge lines up with the page number (guide line), and it stays there
    const pn = await boxOf(page.locator("#stage .slide .pageno").first());
    await page.mouse.move(mb.x + 30, mb.y + mb.height / 2); await page.mouse.down();
    await page.mouse.move(mb.x + 60, mb.y + mb.height / 2 - 30, { steps: 6 });
    await page.mouse.move(mb.x + 60, pn.y + pn.height - mb.height / 2 + 2, { steps: 4 });
    await expect(page.locator("#stage .snapline.h")).toBeVisible();
    await page.mouse.up();
    await pollFile(() => wdoc().preset.slides[0].notes["slide:notes"].x, { timeout: 10_000 }).toBeGreaterThan(56);
    // raw Excel (B19, NB-18, AC-01 since 4.3): the user's notes section, text boxes and comments are drawn there too –
    // the + buttons and Comment… are enabled; it adds no decoration of its own
    await page.click('[data-design="excel"]'); await saved(page);
    await expect(page.locator("#stage .tnote.memo")).toContainText("Source: internal data");
    expect(await page.locator("#stage .addnote").count()).toBeGreaterThan(0);
    await expect(page.locator("#commentBtn")).toBeEnabled();
    await expect(page.locator("#slideNotes")).toBeEnabled();
    await page.click('[data-design="glass"]'); await saved(page);
    await expect(memo).toBeVisible();
    await page.click("#optBtn"); await page.uncheck("#pnOn"); await saved(page); await page.keyboard.press("Escape");
  });

  test("versions: Chief and All made in the wizard, cells removed in All, every version × design exported; superscripts", async ({ page }) => {
    await openApp(page, BOB);
    await expect(page.locator(".thumb")).toHaveCount(1);
    // Excel's superscript "(1)" stays raised on the slide: its own run (S4.1: an SVG <text>, was a <sup>), smaller than
    // the text before it and above its baseline
    const sup = page.locator("#stage .slide > .tw text", { hasText: /^\(1\)$/ }).first();
    await expect(sup).toBeVisible();
    expect(await sup.evaluate(el => { const p = el.previousElementSibling; return !!p && p.tagName === "text" && +el.getAttribute("y")! < +p.getAttribute("y")! && +el.getAttribute("font-size")! < +p.getAttribute("font-size")!; })).toBe(true);
    await page.click("#wizardBtn");
    await page.click('[data-a="next"]:has-text("Tables")'); await page.click('[data-a="next"]:has-text("Slides")');                // sheets → tables → slides
    await page.click('[data-a="versions"]');
    await page.click('[data-addv="Chief"]'); await page.click('[data-addv="All"]');
    await page.fill("#wNewVersion", "Board"); await page.click("#wAddVersion");
    await expect(page.locator("#wVersions .wvrow")).toHaveCount(3);
    await page.locator('#wVersions .wvrow[data-v="All"]').click();
    // remove VUB's and PBZ's Δ vs. Budget (H10:I11 on the sheet) in "All"
    await page.locator('.wgrid-in td[data-r="10"][data-c="8"]').click();
    await page.locator('.wgrid-in td[data-r="11"][data-c="9"]').click({ modifiers: ["Shift"] });
    await expect(page.locator("#wCutRange")).toHaveValue("H10:I11");
    await page.click("#wCut");
    await expect(page.locator("#wCuts .wcut")).toHaveCount(1);
    await page.locator('#wVersions .wvrow[data-v="Board"] .del').click();
    await page.click('[data-a="finish"]');
    const wdoc = () => deckDoc("weekly.xlsx");
    await pollFile(() => (wdoc().preset.versions || []).map((v: any) => [v.name, v.hide]), { timeout: 10_000 })
      .toEqual([["Chief", {}], ["All", { LOANS_DEPOSITS: ["H10:I11"] }]]);
    // the slide shown as "All": those cells are empty; as the full deck they are back
    const vub = () => page.locator("#stage .slide > .tw").first().locator(".t").count();         // texts drawn in the loans table
    const before = await vub();
    await page.selectOption("#versionSel", { label: "All" });
    await expect.poll(vub).toBe(before - 4);                                                       // 2 rows × Abs. + %
    await page.selectOption("#versionSel", { label: "Full deck" });
    await expect.poll(vub).toBe(before);
    // every version in Liquid Glass and Excel: four PDFs named "<workbook> - <version> - <design>.pdf" (B11)
    const names = (ds: string[]) => ds.flatMap(d => ["Chief", "All"].map(v => `weekly - ${v} - ${d}.pdf`)).sort();
    const two = await fromMenu(page, "versions-2");
    expect([...two].sort()).toEqual(names(["Liquid Glass", "Excel"]));
    await expect(page.locator("#toast")).toContainText("Saved 4 PDFs");
    // every version in all three designs: six PDFs, written three at a time by the export workers
    const six = await fromMenu(page, "versions-3");
    expect([...six].sort()).toEqual(names(["Liquid Glass", "Excel", "Excel Refined"]));
    await expect(page.locator("#toast")).toContainText("Saved 6 PDFs");
    expect(await page.evaluate(() => (window as any).__sbTest.exportWorkers())).toBe(3);
    // every version in this design (Liquid Glass): the design is in the name too (B11)
    expect([...await fromMenu(page, "versions")].sort()).toEqual(names(["Liquid Glass"]));
    const pdf = (f: string) => fs.readFileSync(path.join(root(), "export", f));
    // "All" lacks the removed cells, "Chief" has them; each PDF one page per slide with its own text
    for (const d of ["Liquid Glass", "Excel", "Excel Refined"]) {
      const chief = pdfPageTexts(pdf(`weekly - Chief - ${d}.pdf`)), all = pdfPageTexts(pdf(`weekly - All - ${d}.pdf`));
      expect([chief.length, all.length]).toEqual([1, 1]);
      expect(chief[0].length).toBeGreaterThan(all[0].length);
    }
    // all text and tables: the Excel PDFs contain fonts and no pictures at all
    const xl = pdf("weekly - All - Excel.pdf").toString("latin1");
    expect(xl).toContain("/Font");
    expect(xl).not.toMatch(/\/Subtype\s*\/Image/);
    // every version in all five designs (M7b, DS-17): ten PDFs, the consulting designs by their neutral names (B11)
    const ten = await fromMenu(page, "versions-5");
    expect([...ten].sort()).toEqual(names(["Liquid Glass", "Excel", "Excel Refined", "Consulting Navy", "Consulting Red"]));
    await expect(page.locator("#toast")).toContainText("Saved 10 PDFs");
    // PX-01 (B21): every version × Liquid Glass + Excel as PDF and PowerPoint – four of each, named alike (".pptx")
    const both = await exported(page, async () => { await page.click("#exportMenuBtn"); await page.click('[data-x="vfmt-pdf-pptx"]'); await page.click('[data-x="versions-2"]'); });
    expect([...both].sort()).toEqual([...names(["Liquid Glass", "Excel"]), ...names(["Liquid Glass", "Excel"]).map(n => n.replace(/\.pdf$/, ".pptx"))].sort());
    await expect(page.locator("#toast")).toContainText("Saved 8 files");
    // "All" lacks the removed cells in the PowerPoint file too; each one slide, its table a real table
    for (const d of ["Liquid Glass", "Excel"]) {
      const chief = pdf(`weekly - Chief - ${d}.pptx`), all = pdf(`weekly - All - ${d}.pptx`);
      expect([pptxSlides(chief), pptxSlides(all)]).toEqual([1, 1]);
      expect(pptxTexts(chief).join("").length).toBeGreaterThan(pptxTexts(all).join("").length);
      expect(strFromU8(unzipSync(new Uint8Array(chief))["ppt/slides/slide1.xml"])).toContain("<a:tbl>");
    }
    // PowerPoint only: every version in this design
    const pp = await exported(page, async () => { await page.click("#exportMenuBtn"); await page.click('[data-x="vfmt-pptx"]'); await page.click('[data-x="versions"]'); });
    expect([...pp].sort()).toEqual(names(["Liquid Glass"]).map(n => n.replace(/\.pdf$/, ".pptx")));
    // the current slide, the deck, and the deck as PDF + PowerPoint (one call, both files)
    const cur = await fromMenu(page, "pptx-current");
    expect(cur).toHaveLength(1); expect(cur[0]).toMatch(/^weekly - .+\.pptx$/);
    const deck = await fromMenu(page, "pptx");
    expect(deck).toHaveLength(1); expect(pptxSlides(pdf(deck[0]))).toBe(await page.locator(".thumb").count());
    const pair = await fromMenu(page, "both");
    expect(pair.map(f => path.extname(f)).sort()).toEqual([".pdf", ".pptx"]);
    expect(path.basename(pair[0], path.extname(pair[0]))).toBe(path.basename(pair[1], path.extname(pair[1])));
    for (const d of ["Consulting Navy", "Consulting Red"]) {
      const chief = pdf(`weekly - Chief - ${d}.pdf`), src = chief.toString("latin1");
      expect(pdfPageTexts(chief)).toHaveLength(1);
      expect(src).toContain("/FontFile2");                                                   // TrueType subsets (GF)
      expect(src).not.toMatch(/\/Subtype\s*\/Type3/);
      expect(src).not.toMatch(/\/Subtype\s*\/Image/);                                     // no picture but the user's
      expect(pdfPageTexts(chief)[0].length).toBeGreaterThan(pdfPageTexts(pdf(`weekly - All - ${d}.pdf`))[0].length);   // "All" lacks the removed cells
    }
  });

  test("wizard on a sheet larger than the preview: the selection box sits exactly on the selected cells", async ({ page }) => {
    await openApp(page, BOB);
    await openWorkbook(page, "big.xlsx");
    await expect(page.locator(".wiz")).toBeVisible();
    await page.check('.sheetrow input[value="WM_ALL_STOCK_new"]');
    await page.click('[data-a="next"]');                                          // sheets → tables
    await expect(page.locator(".clipnote")).toBeVisible();                        // "Showing A1:… – type larger ranges…"
    await expect(page.locator(".wgrid-in[data-complete]")).toHaveCount(1);       // the preview's rows arrive in blocks: all there
    const td = (r: number, c: number) => page.locator(`.wgrid-in td[data-r="${r}"][data-c="${c}"]`);
    // the selection box against the cells it covers, measured in one go in the page (nothing is redrawn in between)
    const offBy = (r1: number, c1: number, r2: number, c2: number) => page.evaluate(([r1, c1, r2, c2]) => {
      const q = (s: string) => document.querySelector(s)?.getBoundingClientRect();
      const box = q(".ovb.sel"), tl = q(`.wgrid-in td[data-r="${r1}"][data-c="${c1}"]`), br = q(`.wgrid-in td[data-r="${r2}"][data-c="${c2}"]`);
      if (!box || !tl || !br) return `missing: ${!box ? "selection box " : ""}${!tl ? "first cell " : ""}${!br ? "last cell" : ""}`;
      return Math.max(Math.abs(box.left - tl.left), Math.abs(box.top - tl.top), Math.abs(box.right - br.right), Math.abs(box.bottom - br.bottom));
    }, [r1, c1, r2, c2]);
    await td(5, 4).click();
    await expect(page.locator("#wRange")).toHaveValue("D5:D5"); await expect(page.locator(".ovb.sel")).toBeVisible();
    expect(await offBy(5, 4, 5, 4)).toBeLessThan(1.5);
    await page.keyboard.press("Shift+ArrowRight"); await page.keyboard.press("Shift+ArrowDown");
    await expect(page.locator("#wRange")).toHaveValue("D5:E6"); await expect(page.locator(".ovb.sel")).toBeVisible();   // redrawn before measuring
    expect(await offBy(5, 4, 6, 5)).toBeLessThan(1.5);
    await page.click('[data-x="close"]'); await page.click('.modal [data-a="ok"]');
  });

  test("Prepare rollback: every deck's changes folded into its snapshot, nothing left past the frontier (04 §4.4)", async ({ browser }) => {
    test.setTimeout(180_000);                     // the compaction margin: recent records are folded after a 30 s wait
    const a = await browser.newPage(), b = await browser.newPage();
    await openApp(a, ANNA); await openApp(b, BOB);
    await expect(a.locator(".thumb")).toHaveCount(4);
    await openWorkbook(b, "report.xlsx"); await continueOpen(b, "report.xlsx");   // bob's last file is weekly.xlsx: both on the same deck
    await expect(b.locator(".thumb")).toHaveCount(4);
    await a.locator('.thumb[data-i="2"]').click();
    await selectCell(a, "Kappa"); await a.keyboard.press("Control+b"); await saved(a);
    const past = (name: string) => {          // complete records past the snapshot's frontier, in every journal
      const d = deckDir(name)!, snap = JSON.parse(fs.readFileSync(path.join(d, "snapshot.json"), "utf8"));
      let names: string[] = []; try { names = fs.readdirSync(path.join(d, "j")); } catch { /* none */ }
      return names.reduce((n, f) => n + frames(fs.readFileSync(path.join(d, "j", f)), snap.frontier[f.replace(/\.log$/, "")] || 0).length, 0);
    };
    expect(past("report.xlsx")).toBeGreaterThan(0);
    const before = JSON.stringify(doc().edits);
    await a.click("#optBtn"); await a.click("#prepRollback");
    await a.click('.dlg button:has-text("Prepare rollback")');
    await expect(a.locator("#toast")).toContainText(/Prepare rollback: \d+ decks? ready\./, { timeout: 120_000 });
    for (const d of fs.readdirSync(path.join(data(), "v4", "decks"))) expect(past(d.replace(/-[0-9a-f]{10}$/, "")), d).toBe(0);
    expect(JSON.stringify(doc().edits)).toBe(before);                     // the same document, now all in the snapshot
    await expect(a.locator("#deckHealth")).toContainText(/snapshot \d+ · 0 changes since/, { timeout: 10_000 });   // the side panel says so
    // both pages go on as before: a change still reaches the other one
    const arrived = nextChange(b);
    await selectCell(a, "Kappa"); await a.keyboard.press("Control+b"); await saved(a);
    await arrived;
    await a.close(); await b.close();
  });

  test("linked workbooks (S7.3, B22): a folder file's sheets join the wizard, its table draws on a slide, the deck remembers the file", async ({ page }) => {
    await openApp(page, ANNA);
    await openWorkbook(page, "Banks.xlsx");                               // no deck yet: the wizard opens
    await page.locator('[data-a="link"]').waitFor();
    await page.click('[data-a="link"]');
    await page.click('.dlg [data-a="Peers.xlsx"]');                       // the other workbooks of the folder, one button each
    const row = page.locator('.sheetrow input[value="[Peers.xlsx]Peer"]');
    await row.waitFor();
    await expect(page.locator('.sheetrow:has(input[value="[Peers.xlsx]Peer"])')).toContainText("Peers.xlsx");   // shown with its file
    await row.check();
    await page.click('[data-a="next"]');
    await page.locator(".wtab", { hasText: "Peers.xlsx" }).click();                  // the linked sheet's tab: "Peer" with its file chip
    await page.fill("#wRange", "C4:G8"); await page.click("#wAdd");
    await page.click('[data-a="next"]'); await page.click('[data-a="finish"]');
    // the only table of the deck is the linked one: its cells are drawn from Peers.xlsx
    await expect(page.locator("#stage .slide .t", { hasText: /^Peer avg$/ })).toHaveCount(1, { timeout: 20_000 });
    await expect(page.locator("#stage .slide .t", { hasText: /^below peers$/ })).toHaveCount(1);
    // the Issues panel's "Formulas" line (B24, S7.4): both files recompute like Excel but the locale-dependent cells
    await expect(page.locator("#calcLine")).toContainText("Formulas: not checked yet");
    await page.click("#calcCheckBtn");
    // (the 3 TODAY() cells equal Excel's saved values only on the day it saved them, 2026-10-16: "volatile" on any other;
    // the 3 TEXT cells with Italian codes recompute since M8 – Slide Builder formats TEXT as this Italian Excel does)
    await expect(page.locator("#calcLine")).toContainText(/Formulas: (208 of 208 recompute like Excel|205 of 208 recompute like Excel · 3 volatile \(TODAY, NOW, RAND\))/, { timeout: 30_000 });
    await expect(page.locator("#calcLine")).not.toContainText("locale");
    await expect(page.locator("#calcLine")).toContainText("3 with TEXT in Italian, formatted by Slide Builder");
    const bdoc = () => deckDoc("Banks.xlsx");
    await pollFile(() => bdoc().preset.links, { timeout: 10_000 }).toEqual(["Peers.xlsx"]);
    expect(bdoc().preset.tables.map((t: any) => t.sheet)).toEqual(["[Peers.xlsx]Peer"]);
    // opened again, the deck brings its linked workbook back
    await page.reload(); await page.locator("#openBtn").waitFor();
    await openWorkbook(page, "Banks.xlsx"); await continueOpen(page, "Banks.xlsx");
    await expect(page.locator("#stage .slide .t", { hasText: /^Peer avg$/ })).toHaveCount(1, { timeout: 20_000 });
    await lastFileSaved("anna", "Banks.xlsx");
  });

  test("consulting designs (M7b, DS-10): Consulting Navy and Consulting Red, saved, one undo step each, their own palette", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ANNA.replace(/\/$/, "") });
    await openApp(page, ANNA);                                                       // Banks.xlsx, the last workbook
    await expect(page.locator("#stage .slide")).toHaveCount(1, { timeout: 20_000 });
    const bdoc = () => deckDoc("Banks.xlsx"), before = bdoc().style.design ?? "glass";
    await expect(page.locator('[data-design="mckinsey"]')).toHaveText(/Navy/);
    await page.click('[data-design="mckinsey"]'); await saved(page);
    await expect(page.locator("#stage .slide.consult.mckinsey")).toHaveCount(1);
    expect(bdoc().style.design).toBe("mckinsey");
    await page.keyboard.press("Control+z"); await saved(page);                        // one undo step back
    expect(bdoc().style.design ?? "glass").toBe(before);
    await page.click('[data-design="bain"]'); await saved(page);
    await expect(page.locator("#stage .slide.consult.bain")).toHaveCount(1);
    // the design's own palette is the theme it starts with; the Colours tab lists the keys it uses
    await page.click("#themeBtn");
    await expect(page.locator('#themeList [data-theme="design"]')).toHaveClass(/on/);
    await expect(page.locator('[data-color="pos"]')).not.toHaveClass(/off/);
    await expect(page.locator('#lookScope [data-scope="design"]')).toContainText("Consulting Red");
    // for all designs, the themes are not this design's: they cannot be picked here, and "Design palette" leaves them alone
    const shared = JSON.stringify(bdoc().style.theme ?? null);
    await page.click('#lookScope [data-scope="all"]');
    await expect(page.locator('#themeList [data-theme="ocean"]')).toBeDisabled();
    await page.click('#themeList [data-theme="design"]');
    expect(JSON.stringify(bdoc().style.theme ?? null)).toBe(shared);
    await page.click('#lookScope [data-scope="design"]');
    await page.click('.tsdlg [data-a="close"]');
    // B29 (08 §2.8): the look's parts in ribbon 2 – a change goes to this slide, "Apply to all" makes it the deck's
    const slide0 = () => bdoc().preset.slides.find((x: any) => x.type !== "cover" && x.type !== "index") ?? bdoc().preset.slides[0];
    await expect(page.locator("#lookGroup")).toHaveAttribute("data-mode", "table");
    await expect(page.locator('#lookGroup [data-part="bars"]')).toHaveClass(/\bon\b/);
    await page.click('#lookGroup [data-part="bars"]'); await saved(page);
    expect(slide0().looks).toEqual({ bain: { bars: "off" } });
    expect(bdoc().style.designs?.bain?.consult).toBeUndefined();                           // the deck's look untouched
    await expect(page.locator('#lookGroup [data-part="bars"]')).toHaveClass(/\bown\b/);
    await page.click("#lookApplyAll"); await saved(page);                                  // the deck's, cleared on the slide
    expect(bdoc().style.designs.bain.consult).toEqual({ bars: "off" });
    expect(slide0().looks).toBeUndefined();
    await page.keyboard.press("Control+z"); await saved(page);                             // one undo step
    expect(slide0().looks).toEqual({ bain: { bars: "off" } });
    await page.click("#lookReset"); await saved(page);
    expect(slide0().looks).toBeUndefined();
    // the title selected: the headline's parts
    await page.locator("#stage .slide .tx.title").first().click();
    await expect(page.locator("#lookGroup")).toHaveAttribute("data-mode", "headline");
    await page.click('#lookGroup [data-part="headline"] [data-value="none"]'); await saved(page);
    expect(slide0().looks).toEqual({ bain: { headline: "none" } });
    await page.click("#lookReset"); await saved(page);
    await expect(page.locator("#lookSel, #tabLayout")).toHaveCount(0);                    // no dropdown, no Layout tab
    // S7b.4: thumbnails, a PNG of the slide (3× the slide) and the slide copied to the clipboard, in Consulting Red
    await expect(page.locator(".thumb .frame canvas")).toHaveCount(await page.locator(".thumb").count(), { timeout: 15_000 });
    const [png] = await fromMenu(page, "png-current");
    const pb = fs.readFileSync(path.join(root(), "export", png));
    expect([pb.subarray(1, 4).toString(), pb.readUInt32BE(16), pb.readUInt32BE(20)]).toEqual(["PNG", 4800, 2700]);
    await page.click("#exportMenuBtn"); await page.click('[data-x="copy"]');
    await expect(page.locator("#toast")).toContainText("copied", { timeout: 60_000 });
    expect(await page.evaluate(async () => { const [item] = await navigator.clipboard.read(); const b = await createImageBitmap(await item.getType("image/png")); return [b.width, b.height]; })).toEqual([4800, 2700]);
    await page.click(`[data-design="${before}"]`); await saved(page);
    await expect(page.locator("#lookGroup")).toHaveCount(0);                                 // consulting designs only
  });

  test("charts follow a scenario (S9.3, CH-03): a pie from the linked Peers table, previewed for Bank C", async ({ page }) => {
    await openApp(page, ANNA);
    await openWorkbook(page, "Banks.xlsx"); await continueOpen(page, "Banks.xlsx");
    await expect(page.locator("#stage .slide .t", { hasText: /^1761$/ })).toHaveCount(1, { timeout: 20_000 });
    // from the selected cells: the Peer avg column (Loans, Deposits) – named by the column on its left (Item)
    await selectCell(page, "1761");
    const c2 = page.locator("#stage .slide .t", { hasText: /^2268$/ }).first(), bb = (await c2.boundingBox())!;
    await page.keyboard.down("Shift"); await page.mouse.click(bb.x + 8, bb.y + bb.height / 2); await page.keyboard.up("Shift");
    await page.click("#chartBtn"); await page.click('[data-a="chart-sel"]');
    const layer = page.locator("#stage svg.layer.item");
    await expect(layer).toHaveCount(1, { timeout: 10_000 });
    await page.locator('#chartPanel [data-show="value"]').check();
    await expect(layer).toContainText("1761");
    await expect(page.locator("#chartSource")).toContainText("[Peers.xlsx]Peer!E5:E6");
    await expect(page.locator("#chartSlices .nm")).toHaveText(["Loans", "Deposits"]);
    // the preview of Bank C: the linked file recalculated, the chart with it; cleared, back to Bank A
    await page.click("#exportMenuBtn"); await page.click('[data-x="scenario"]');
    await page.fill("#scInput", "Control!B2");
    await page.fill("#scValues", "Bank A\nBank C");
    await page.selectOption("#scValue", "Bank C");
    await page.click("#scPreview");
    await expect(page.locator("#scBanner")).toContainText("Bank C", { timeout: 20_000 });
    await expect(layer).toContainText("3141", { timeout: 20_000 });
    await page.click("#scBanner button");
    await expect(layer).toContainText("1761", { timeout: 20_000 });
    // the deck keeps the chart; the scenario changed nothing in it
    await pollFile(() => (Object.values(deckDoc("Banks.xlsx").preset.slides[0].items || {}) as any[]).map(x => x.values), { timeout: 10_000 })
      .toEqual([{ table: deckDoc("Banks.xlsx").preset.tables[0].id, range: "E5:E6" }]);
    // removed again (the Run tests below export this deck), and saved before the next test opens it
    await page.locator(".itembox[data-kind=chart]").click({ position: { x: 4, y: 4 } });
    await page.keyboard.press("Delete");
    await expect(page.locator(".itembox")).toHaveCount(0);
    await pollFile(() => Object.keys(deckDoc("Banks.xlsx").preset.slides[0].items || {}), { timeout: 10_000 }).toEqual([]);
    await lastFileSaved("anna", "Banks.xlsx");
  });

  test("callouts (S9.4, CL-01, CL-02, B17): shapes and icons, fill / border / text; a callout quoting Control!B2 follows the preview of Bank C; #REF", async ({ page }) => {
    await openApp(page, ANNA);
    await openWorkbook(page, "Banks.xlsx"); await continueOpen(page, "Banks.xlsx");
    await expect(page.locator("#stage .slide .t", { hasText: /^1761$/ })).toHaveCount(1, { timeout: 20_000 });
    const items = () => (deckDoc("Banks.xlsx").preset.slides[0].items || {}) as Record<string, any>;
    // CL-01: a pill, typed in place; its fill, border and text size from ribbon 2 – each one change
    await page.click("#shapeBtn"); await page.click('.shapemenu [data-shape="pill"]');
    await expect(page.locator(".itembox[data-kind=shape]")).toHaveCount(1, { timeout: 10_000 });
    await pollFile(() => Object.values(items()).map(i => i.shape), { timeout: 10_000 }).toEqual(["pill"]);
    const id = Object.keys(items())[0];
    await page.locator(".itembox[data-kind=shape]").dblclick();
    await page.locator("#itemEdit").fill("Bank:");
    await page.keyboard.press("Control+Enter");
    // the cell quoted from the sheet view (nothing typed): Quote a cell… › Control › B2
    await page.locator(".itembox[data-kind=shape]").click();
    await page.click("#shapeQuote");
    await page.selectOption("#pkSheet", "Control");
    await page.locator('#pkRange td[data-r="2"][data-c="2"]').click();
    await expect(page.locator("#pkSel")).toHaveText("B2");
    await page.click("#pkUse");
    await pollFile(() => items()[id].text).toBe("Bank: {Control!B2}");
    const layer = page.locator(`#stage svg.layer.item[data-item="${id}"]`);
    await expect(layer).toContainText("Bank: Bank A", { timeout: 10_000 });         // CL-02: the cell's text
    await page.locator(".itembox[data-kind=shape]").click();
    await expect(page.locator("#shapeTools")).toBeVisible();
    await page.click("#shapeFill"); await page.click('[data-fill="#FFF4D6"]');
    await pollFile(() => items()[id].fill).toBe("#FFF4D6");
    await page.click("#shapeBorder"); await page.click('[data-bw="2"]');
    await pollFile(() => items()[id].border).toEqual({ color: "#1F2430", w: 2 });
    await page.click("#shapeLarger");
    await pollFile(() => items()[id].fmt).toEqual({ size: 20 });
    await page.click("#undoBtn");
    await pollFile(() => items()[id].fmt).toBeUndefined();
    // an icon: a filled outline in its box
    await page.click("#shapeBtn"); await page.click('.shapemenu [data-icon="warning"]');
    await expect(page.locator(".itembox[data-kind=shape]")).toHaveCount(2, { timeout: 10_000 });
    // CL-02: the preview of Bank C – the callout says Bank C; cleared, Bank A again
    await page.click("#exportMenuBtn"); await page.click('[data-x="scenario"]');
    await page.fill("#scInput", "Control!B2"); await page.fill("#scValues", "Bank A\nBank C");
    await page.selectOption("#scValue", "Bank C"); await page.click("#scPreview");
    await expect(layer).toContainText("Bank: Bank C", { timeout: 20_000 });
    await page.click("#scBanner button");
    await expect(layer).toContainText("Bank: Bank A", { timeout: 20_000 });
    // a reference that cannot be read: #REF on the slide, the Issues line
    // selected first (another callout is: selecting this one brings its text tools, and where ribbon 2 then wraps to one
    // more line – narrower windows, wider fonts – the slide moves down between the two clicks of a double-click)
    await page.locator(`.itembox[data-item="${id}"]`).click({ position: { x: 12, y: 12 } });    // (the icon sits in its middle)
    await page.waitForFunction(() => (window as any).__sbTest.stageIdle());
    await page.locator(`.itembox[data-item="${id}"]`).dblclick({ position: { x: 12, y: 12 } });
    await page.locator("#itemEdit").fill("Peers {Nowhere!B2}");
    await page.keyboard.press("Control+Enter");
    await expect(layer).toContainText("Peers #REF", { timeout: 10_000 });
    await expect(page.locator("#issues")).toContainText("Callout 1: Nowhere!B2 not found (shown as #REF)");
    // removed again (the Run tests export this deck)
    for (const sel of [".itembox[data-kind=shape]:not([data-item=\"" + id + "\"])", `.itembox[data-item="${id}"]`]) { await page.locator(sel).click({ position: { x: 3, y: 3 } }); await page.keyboard.press("Delete"); }
    await expect(page.locator(".itembox")).toHaveCount(0);
    await pollFile(() => Object.keys(items())).toEqual([]);
    await lastFileSaved("anna", "Banks.xlsx");
  });

  test("Run for each value… (S8.1, SC-01, SC-07): the input cell, values typed and from a range, de-duplicated; a preview on the stage, cleared", async ({ page }) => {
    test.setTimeout(180_000);                              // (settledDeck may wait for the 30 s compaction margin)
    await openApp(page, ANNA);                                                       // Banks.xlsx with the linked Peers table
    await expect(page.locator("#stage .slide")).toHaveCount(1, { timeout: 20_000 });
    await settledDeck("Banks.xlsx");                       // (a compaction due at open: content unchanged, written anew)
    const bdoc = () => deckDoc("Banks.xlsx");
    const before = bdoc();
    // the deck's one table is the linked Peers sheet: Peer avg loans are 1761 for Bank A, 3141 for Bank C (PeerData)
    const cells = page.locator("#stage .slide .t");
    await expect(cells.filter({ hasText: /^1761$/ })).toHaveCount(1);
    await selectCell(page, "Peer avg");                                              // a cell of the linked workbook's sheet
    await page.click("#exportMenuBtn"); await page.click('[data-x="scenario"]');
    const dlg = page.locator("#scenarioDialog");
    await expect(dlg).toBeVisible();
    // the input cell: "Pick a cell" takes the stage's selection (a linked sheet's id), typed in the name box's syntax
    await expect(page.locator("#scPick")).toContainText("[Peers.xlsx]Peer!E4");
    await page.click("#scPick");
    await expect(page.locator("#scInput")).toHaveValue("[Peers.xlsx]Peer!E4");
    // Select cell…: the wizard's sheet view, one cell only (a Shift+click moves it, never spans), marked red
    await page.click("#scSelect");
    await page.selectOption("#scSheet", "Control");
    await page.locator('#scRange td[data-r="2"][data-c="2"]').click();
    await page.locator('#scRange td[data-r="5"][data-c="3"]').click({ modifiers: ["Shift"] });
    await expect(page.locator("#scRangeSel")).toHaveText("C5");
    await expect(page.locator("#scRange .ovb.sel.one")).toHaveCount(1);
    await page.locator('#scRange td[data-r="2"][data-c="2"]').click();
    await page.keyboard.press("Enter");                                              // Enter takes the cell, as the button
    await expect(page.locator("#scRange")).toHaveCount(0);
    await expect(page.locator("#scInput")).toHaveValue("Control!B2");
    await page.click("#scSelect"); await page.selectOption("#scSheet", "Control");
    await page.locator('#scRange td[data-r="2"][data-c="2"]').click();
    await page.click("#scUseCell");
    await expect(page.locator("#scRange")).toHaveCount(0);
    await expect(page.locator("#scInput")).toHaveValue("Control!B2");
    await page.fill("#scInput", "[Peers.xlsx]Peer!E4");
    await expect(page.locator("#scInputNote")).toContainText("Holds “Peer avg” today (text)");
    // the stage's keys stay out of the dialog ("Peer avg" is selected behind it; focus on a button, where the stage's
    // shortcuts would act): Delete, a letter, Ctrl+Z and Tab change nothing – the cell keeps its text, the name box its
    // cell, the document is compared at the end – and Enter presses the focused button (the stage took it before)
    const nameBefore = await page.locator("#nameBox").textContent();
    await page.locator("#scFromRange").focus();
    for (const k of ["Delete", "Backspace", "x", "Control+z", "Tab"]) await page.keyboard.press(k);
    await expect(dlg).toBeVisible();
    await expect(page.locator("#nameBox")).toHaveText(nameBefore!);
    await expect(cells.filter({ hasText: /^Peer avg$/ })).toHaveCount(1);
    await page.locator("#scFromRange").focus(); await page.keyboard.press("Enter");
    await expect(page.locator("#scRange")).toBeVisible();
    await page.keyboard.press("Escape");                                             // back to the values
    await expect(page.locator("#scValues")).toBeVisible();
    await page.locator("#scText").focus();
    await page.keyboard.press("Space"); await expect(page.locator("#scText")).toBeChecked();
    await page.keyboard.press("Space"); await expect(page.locator("#scText")).not.toBeChecked();
    await page.fill("#scInput", "Control!B4");                                       // a number: numbers go in as numbers
    await expect(page.locator("#scInputNote")).toContainText("Holds “12” today (a number)");
    await page.fill("#scInput", "control!b20");                                      // any case; an empty cell
    await expect(page.locator("#scInputNote")).toContainText("Empty today");
    await page.fill("#scInput", "Nowhere!B2");
    await expect(page.locator("#scInputNote")).toContainText("No sheet “Nowhere”");
    await expect(page.locator("#scPreview")).toBeDisabled();
    await page.fill("#scInput", "Control!B2");
    await expect(page.locator("#scInputNote")).toContainText("Holds “Bank A” today (text)");
    // values typed: blank lines skipped, repeats left out, the order kept
    await page.fill("#scValues", "Bank A\nBank B\n\n  Bank A\nBank C\n");
    await expect(page.locator("#scCount")).toHaveText("3 values · 1 repeated left out");
    await expect(page.locator("#scValue option")).toHaveText(["Bank A", "Bank B", "Bank C"]);
    // from a range: the wizard's sheet view, a range dragged / Shift+clicked; the texts the cells show become the values
    await page.click("#scFromRange");
    await page.selectOption("#scSheet", "Data");
    await page.locator('#scRange td[data-r="2"][data-c="1"]').click();
    await page.locator('#scRange td[data-r="25"][data-c="1"]').click({ modifiers: ["Shift"] });
    await expect(page.locator("#scRangeSel")).toHaveText("A2:A25");
    await page.click("#scUseRange");
    await expect(page.locator("#scValues")).toHaveValue(/^Bank A\n(Bank A\n){11}(Bank B\n){11}Bank B$/);
    await expect(page.locator("#scCount")).toHaveText("2 values · 22 repeated left out");
    await page.fill("#scValues", "Bank A\nBank B\nBank C");
    // the designs (all five), the versions (the full deck), the files: PDF, and PowerPoint since 4.5 (B21)
    await expect(page.locator("#scDesigns input")).toHaveCount(5);
    await expect(page.locator("#scVersions input")).toHaveCount(1);
    await expect(page.locator("#scPdf")).toBeChecked();
    await expect(page.locator("#scPptx")).not.toBeChecked();
    await page.locator('#scDesigns [data-design="excel"]').check();
    await expect(page.locator("#scSummary")).toContainText("= 6 PDFs");
    await page.check("#scPptx");
    await expect(page.locator("#scSummary")).toContainText("× 2 = 12 files (PDF + PowerPoint)");
    await page.uncheck("#scPdf");
    await expect(page.locator("#scSummary")).toContainText("= 6 PowerPoint files");
    await page.uncheck("#scPptx");
    await expect(page.locator("#scSummary")).toContainText("Choose at least one value, design, version and kind of file.");
    await expect(page.locator("#scRun")).toBeDisabled();
    await page.check("#scPdf");
    await expect(page.locator("#scSummary")).toContainText("= 6 PDFs");
    // Preview (SC-07): Bank C on the stage, the banner names it; nothing is saved
    await page.selectOption("#scValue", "Bank C");
    await page.click("#scPreview");
    await expect(dlg).toHaveCount(0);
    await expect(page.locator("#scBanner")).toContainText("Previewing: Bank C – a scenario, not saved", { timeout: 20_000 });
    await expect(cells.filter({ hasText: /^3141$/ })).toHaveCount(1);              // the linked file recalculated
    await expect(cells.filter({ hasText: /^1761$/ })).toHaveCount(0);
    expect(bdoc()).toEqual(before);
    // Clear: the workbook's own values again
    await page.click("#scClear");
    await expect(page.locator("#scBanner")).toHaveCount(0);
    await expect(cells.filter({ hasText: /^1761$/ })).toHaveCount(1);
    await expect(cells.filter({ hasText: /^3141$/ })).toHaveCount(0);
    // the dialog opens again as it was left (UI state, never the document)
    await page.click("#exportMenuBtn"); await page.click('[data-x="scenario"]');
    await expect(page.locator("#scInput")).toHaveValue("Control!B2");
    await expect(page.locator("#scCount")).toHaveText("3 values");
    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);
    expect(bdoc()).toEqual(before);
    // S8.4 (Decisions: the cells mirrored to the page): during a preview the formula bar shows the scenario's value of
    // the selected cell; an edit made meanwhile is an ordinary edit of the deck, saved, and stays after Clear
    await page.click("#exportMenuBtn"); await page.click('[data-x="scenario"]');
    await page.selectOption("#scValue", "Bank C"); await page.click("#scPreview");
    await expect(page.locator("#scBanner")).toContainText("Previewing: Bank C", { timeout: 20_000 });
    await selectCell(page, "3141");
    await expect(page.locator("#fxInput")).toHaveValue("3141");
    await selectCell(page, "Loans"); await page.keyboard.type("Loans X"); await page.keyboard.press("Enter");
    await saved(page);
    await pollFile(() => deckDoc("Banks.xlsx").edits["[Peers.xlsx]Peer"].C5.text, { timeout: 10_000 }).toBe("Loans X");
    // a cell the scenario changed (3141 for Bank C): the edit belongs to the workbook's value (CE-09 "orig" 1761) – it
    // shows once the preview is cleared, and the page says so
    await selectCell(page, "3141"); await page.keyboard.type("9999"); await page.keyboard.press("Enter");
    await expect(page.locator("#toast")).toContainText("shows once the preview is cleared");
    await saved(page);
    await pollFile(() => { const e = deckDoc("Banks.xlsx").edits["[Peers.xlsx]Peer"].E5; return [e.orig, e.text]; }, { timeout: 10_000 }).toEqual(["1761", "9999"]);
    await page.click("#scClear");
    await expect(page.locator("#scBanner")).toHaveCount(0);
    await expect(cells.filter({ hasText: /^Loans X$/ })).toHaveCount(1);
    await expect(cells.filter({ hasText: /^9999$/ })).toHaveCount(1);
    await selectCell(page, "Loans X");
    await expect(page.locator("#fxInput")).toHaveValue("Loans X");
    // (the next tests see the deck as it was)
    await page.keyboard.press("Control+z"); await saved(page); await page.keyboard.press("Control+z"); await saved(page);
    await expect(cells.filter({ hasText: /^Loans$/ })).toHaveCount(1);
    await expect(cells.filter({ hasText: /^1761$/ })).toHaveCount(1);
  });

  test("Run for each value (S8.3, SC-02/03/05/06): 3 values × 2 designs → 6 files with their names; files untouched; equal names; progress, cancel, report", async ({ page }) => {
    test.setTimeout(180_000);                              // (settledDeck may wait for the 30 s compaction margin)
    await openApp(page, ANNA);                                                       // Banks.xlsx with the linked Peers table
    await expect(page.locator("#stage .slide")).toHaveCount(1, { timeout: 20_000 });
    await saved(page);
    // SC-05: what a run must not change – both workbooks' bytes, the deck's files on the share, its document
    const hashOf = (f: string) => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
    const dir = deckDir("Banks.xlsx")!, deckFiles = () => fs.readdirSync(dir, { recursive: true }).map(String).filter(f => fs.statSync(path.join(dir, f)).isFile()).sort();
    const state = () => JSON.stringify({ banks: hashOf(path.join(root(), "Banks.xlsx")), peers: hashOf(path.join(root(), "Peers.xlsx")), deck: deckFiles().map(f => [f, hashOf(path.join(dir, f))]) });
    await settledDeck("Banks.xlsx");
    const before = state(), docBefore = JSON.stringify(deckDoc("Banks.xlsx"));
    const exportDir = path.join(root(), "export");
    const runWith = async (input: string, values: string, designs: string[], kinds = ["pdf"]) => {
      await page.click("#exportMenuBtn"); await page.click('[data-x="scenario"]');
      await page.fill("#scInput", input);
      await expect(page.locator("#scInputNote")).toContainText("today");
      await page.fill("#scValues", values);
      for (const box of await page.locator("#scDesigns input").all()) await box.setChecked(designs.includes((await box.getAttribute("data-design"))!));
      await page.locator("#scPdf").setChecked(kinds.includes("pdf")); await page.locator("#scPptx").setChecked(kinds.includes("pptx"));
      await page.click("#scRun");
      await expect(page.locator("#scenarioDialog")).toHaveCount(0);
      await expect(page.locator("#scRunDialog")).toBeVisible();
    };
    // SC-02: the brief's case – 3 values × 2 designs, each file drawn from its value (Peer avg loans: 1761 / 2490 / 3141)
    await runWith("Control!B2", "Bank A\nBank B\nBank C", ["glass", "excel"]);
    await expect(page.locator("#scRunStatus")).toContainText("Done: 3 of 3 values · 6 files", { timeout: 120_000 });
    await expect(page.locator("#scReport li[data-status=ok]")).toHaveCount(3);
    await expect(page.locator("#toast")).toContainText("Saved 6 files");
    const peerAvg: Record<string, string> = { "Bank A": "1761", "Bank B": "2490", "Bank C": "3141" };
    for (const bank of Object.keys(peerAvg)) for (const d of ["Liquid Glass", "Excel"]) {
      const f = path.join(exportDir, `${bank} - ${d}.pdf`);
      expect(fs.existsSync(f), f).toBe(true);
      const text = pdfPageTexts(fs.readFileSync(f)).join(" ");
      expect(text, f).toContain(peerAvg[bank]);
      for (const other of Object.keys(peerAvg)) if (other !== bank) expect(text, f).not.toContain(peerAvg[other]);
    }
    await page.click("#scRunClose");
    await expect(page.locator("#scRunDialog")).toHaveCount(0);
    // SC-05: nothing of the run was saved anywhere; the slide shows the workbook's own values again
    expect(state()).toBe(before); expect(JSON.stringify(deckDoc("Banks.xlsx"))).toBe(docBefore);
    await expect(page.locator("#stage .slide .t").filter({ hasText: /^1761$/ })).toHaveCount(1);
    // SC-03: two values that the input cell shows alike (a number cell: "12" and "12,0" are both 12) – two files
    await runWith("Control!B4", "12\n12,0", ["excel"]);
    await expect(page.locator("#scRunStatus")).toContainText("Done: 2 of 2 values · 2 files", { timeout: 60_000 });
    for (const f of ["12 - Excel.pdf", "12 (2) - Excel.pdf"]) expect(fs.existsSync(path.join(exportDir, f)), f).toBe(true);
    await expect(page.locator("#scReport")).toContainText("12 (2) - Excel.pdf");
    await page.click("#scRunClose");
    // PX-01 (B21): a run of PDF and PowerPoint files – 2 values × 1 design → 2 PDFs and 2 .pptx, each drawn from its value
    await runWith("Control!B2", "Bank A\nBank B", ["excel"], ["pdf", "pptx"]);
    await expect(page.locator("#scRunStatus")).toContainText("Done: 2 of 2 values · 4 files", { timeout: 120_000 });
    await expect(page.locator("#toast")).toContainText("Saved 4 files");
    for (const bank of ["Bank A", "Bank B"]) {
      expect(fs.existsSync(path.join(exportDir, `${bank} - Excel.pdf`))).toBe(true);
      const text = pptxTexts(fs.readFileSync(path.join(exportDir, `${bank} - Excel.pptx`))).join(" ");
      expect(text).toContain(peerAvg[bank]);
      for (const other of Object.keys(peerAvg)) if (other !== bank) expect(text).not.toContain(peerAvg[other]);
    }
    await page.click("#scRunClose");
    // SC-06: progress and cancel – the files made stay, the report says how far it got
    await runWith("Control!B2", ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"].map(x => "Bank " + x).join("\n"), ["excel"]);
    await expect(page.locator("#scReport li")).not.toHaveCount(0, { timeout: 60_000 });
    await page.click("#scCancel");
    await expect(page.locator("#scRunStatus")).toContainText(/Cancelled after \d+ of 10 values/, { timeout: 60_000 });
    const n = +(/Cancelled after (\d+) of 10/.exec((await page.locator("#scRunStatus").textContent())!)![1]);
    expect(n).toBeGreaterThanOrEqual(1); expect(n).toBeLessThan(10);
    await expect(page.locator("#scReport li[data-status=ok]")).toHaveCount(n);
    await expect(page.locator("#scOpenFolder")).toBeVisible();
    await page.click("#scRunClose");
    expect(state()).toBe(before);
  });

  test("Run for each value, the gate (RC-06): a slide cell the engine computes otherwise stops the run; run anyway marks it", async ({ page }) => {
    await openApp(page, ANNA);
    await openWorkbook(page, "Gate.xlsx");                                           // no deck yet: the wizard
    await expect(page.locator(".wiz")).toBeVisible();
    await page.click('[data-a="next"]:has-text("Tables")'); await page.click('[data-a="next"]:has-text("Slides")'); await page.click('[data-a="finish"]');
    await expect(page.locator("#stage .slide .t").filter({ hasText: /^System$/ })).toHaveCount(1, { timeout: 20_000 });
    await saved(page);
    await page.click("#exportMenuBtn"); await page.click('[data-x="scenario"]');
    await page.fill("#scInput", "Control!B2");
    await expect(page.locator("#scInputNote")).toContainText("Holds “Bank A” today");
    await page.fill("#scValues", "Gate one\nGate two");                            // (names no other test's files have)
    for (const box of await page.locator("#scDesigns input").all()) await box.setChecked((await box.getAttribute("data-design")) === "excel");
    await page.click("#scRun");
    // stopped before the first value: SLIDE_1!D6 = INFO("osversion"), which the engine does not compute as Excel
    await expect(page.locator("#scGate")).toContainText("SLIDE_1!D6", { timeout: 30_000 });
    await expect(page.locator("#scRun")).toBeDisabled();
    expect(fs.existsSync(path.join(root(), "export", "Gate one - Excel.pdf"))).toBe(false);
    await page.check("#scAnyway");
    await page.click("#scRun");
    await expect(page.locator("#scRunStatus")).toContainText("Done: 2 of 2 values · 2 files", { timeout: 60_000 });
    await expect(page.locator("#scMarked")).toContainText("SLIDE_1!D6");
    expect(pdfPageTexts(fs.readFileSync(path.join(root(), "export", "Gate two - Excel.pdf"))).join(" ")).toContain("Gate two");
    await page.click("#scRunClose");
    await lastFileSaved("anna", "Gate.xlsx");
  });

  test("charts (S9.3, CH-02/03/04, B16, B24): a pie from a sheet on no slide, changed in the side panel, moved, removed; it follows a reload and a scenario; a missing source", async ({ page }) => {
    await openApp(page, ANNA);
    await openWorkbook(page, "report.xlsx"); await continueOpen(page, "report.xlsx");
    await expect(page.locator(".thumb").first()).toBeVisible({ timeout: 20_000 });
    // the slide with the bank table (the deck has a cover and contents by now)
    let si = -1;
    for (let i = 0; i < await page.locator(".thumb").count() && si < 0; i++) {
      await page.locator(".thumb").nth(i).click(); await page.locator(`.thumb.on[data-i="${i}"]`).waitFor();
      if (await page.locator("#stage .slide .t", { hasText: /^Alpha$/ }).first().waitFor({ timeout: 4000 }).then(() => true, () => false)) si = i;
    }
    expect(si).toBeGreaterThanOrEqual(0);
    const file = path.join(root(), "report.xlsx"), original = fs.readFileSync(file);
    const items = () => (doc().preset.slides[si].items || {}) as Record<string, any>;
    const chartLayer = page.locator("#stage svg.layer.item");
    // CH-02: Insert chart ▾ › from a range of a sheet that is on no slide (Numbers): the wizard's sheets, hidden ones not
    await page.click("#chartBtn");
    // the cells chosen in the sheet view (no cell names typed: product owner 2026-10-19): the numbers, then their names;
    // Escape (and Cancel) close it without a chart
    await page.click('[data-a="chart-pick"]');
    await expect(page.locator("#pickCells")).toBeVisible();
    await page.locator("#pkSheet").focus(); await page.keyboard.press("Escape");
    await expect(page.locator("#pickCells")).toHaveCount(0);
    await page.click("#chartBtn"); await page.click('[data-a="chart-pick"]');
    await page.click('#pickCells [data-a="cancel"]');
    await expect(page.locator("#pickCells")).toHaveCount(0);
    await page.click("#chartBtn"); await page.click('[data-a="chart-pick"]');
    await expect(page.locator("#pickCells")).toBeVisible();
    await expect(page.locator("#pkSheet option")).toContainText(["SLIDE_1", "Numbers"]);
    await expect(page.locator('#pkSheet option[value="Hidden data"]')).toHaveCount(0);
    await page.selectOption("#pkSheet", "Numbers");
    await expect(page.locator("#pkUse")).toBeDisabled();
    await page.locator('#pkRange td[data-r="9"][data-c="2"]').click();
    await page.locator('#pkRange td[data-r="11"][data-c="2"]').click({ modifiers: ["Shift"] });
    await expect(page.locator("#pkSel")).toHaveText("B9:B11");
    await page.click("#pkUse");                                                          // Next: their names
    await expect(page.locator("#pickCells")).toContainText("Step 2 of 2");
    // Escape goes back a step (the numbers kept, chosen again), Back too; then the names step once more
    await page.locator("#pkSheet").focus(); await page.keyboard.press("Escape");
    await expect(page.locator("#pickCells")).toContainText("Step 1 of 2");
    await page.locator('#pkRange td[data-r="9"][data-c="2"]').click();
    await page.locator('#pkRange td[data-r="11"][data-c="2"]').click({ modifiers: ["Shift"] });
    await page.click("#pkUse");
    await page.click("#pkBack");
    await expect(page.locator("#pickCells")).toContainText("Step 1 of 2");
    await page.locator('#pkRange td[data-r="9"][data-c="2"]').click();
    await page.locator('#pkRange td[data-r="11"][data-c="2"]').click({ modifiers: ["Shift"] });
    await page.click("#pkUse");
    await page.click("#pkNoNames");
    await expect(page.locator("#pickCells")).toHaveCount(0);
    await expect(page.locator(".itembox[data-kind=chart]")).toHaveCount(1, { timeout: 10_000 });
    await pollFile(() => Object.values(items()).map(i => i.values), { timeout: 10_000 }).toEqual([{ sheet: "Numbers", range: "B9:B11" }]);
    const id = Object.keys(items())[0];
    await expect(chartLayer).toHaveCount(1);
    await expect(page.locator("#chartPanel")).toBeVisible();                       // the new chart is selected
    await expect(page.locator("#chartSource")).toContainText("Numbers!B9:B11");
    await expect(page.locator("#chartSlices .slice")).toHaveCount(3);
    // Change the cells…: the same sheet view; two of the numbers and their names, then back with undo
    await page.click("#chartCells");
    await expect(page.locator("#pkSheet")).toHaveValue("Numbers");
    await page.locator('#pkRange td[data-r="9"][data-c="2"]').click();
    await page.locator('#pkRange td[data-r="10"][data-c="2"]').click({ modifiers: ["Shift"] });
    await page.click("#pkUse");
    await page.selectOption("#pkSheet", "SLIDE_1");
    await page.locator('#pkRange td[data-r="6"][data-c="3"]').click();
    await page.locator('#pkRange td[data-r="7"][data-c="3"]').click({ modifiers: ["Shift"] });
    await page.click("#pkUse");
    await pollFile(() => [items()[id].values, items()[id].labels]).toEqual([{ sheet: "Numbers", range: "B9:B10" }, { sheet: "SLIDE_1", range: "C6:C7" }]);
    await expect(page.locator("#chartSlices .nm")).toHaveText(["Alpha", "Beta"]);
    await page.click("#undoBtn");
    await pollFile(() => [items()[id].values, items()[id].labels]).toEqual([{ sheet: "Numbers", range: "B9:B11" }, undefined]);
    await expect(page.locator("#chartSlices .slice")).toHaveCount(3);
    await expect(page.locator("#issues")).not.toContainText("Chart 1");
    // the side panel: donut, values on the slices, a slice's colour – each one undo step
    await page.click('#chartPanel [data-ctype="donut"]');
    await pollFile(() => items()[id].type).toBe("donut");
    await page.locator('#chartPanel [data-show="value"]').check();
    await pollFile(() => items()[id].show).toEqual(["value", "percent"]);
    await expect(chartLayer).toContainText("1.235 €");                            // B9's own number format
    await page.click("#undoBtn");
    await pollFile(() => items()[id].show).toEqual(["percent"]);
    await expect(page.locator('#chartPanel [data-show="value"]')).not.toBeChecked();
    // a slice's own colour (the product owner: "edit colours individually"), then the design's again – one change each
    await page.locator('#chartSlices [data-slice="1"] input[type=color]').evaluate((el: HTMLInputElement) => { el.value = "#123456"; el.dispatchEvent(new Event("change", { bubbles: true })); });
    await pollFile(() => items()[id].colors).toEqual({ "1": "#123456" });
    await expect(page.locator('#chartSlices [data-slice="1"] i')).toHaveCSS("background-color", "rgb(18, 52, 86)", { timeout: 10_000 });
    await page.click('#chartSlices [data-reset="1"]');
    await pollFile(() => items()[id].colors).toBeUndefined();
    // resized by its corner: one change, its corner where the pointer let go
    const w0 = items()[id].box.w, zb = (await page.locator(".itembox[data-kind=chart] .size").boundingBox())!;
    await page.mouse.move(zb.x + zb.width / 2, zb.y + zb.height / 2); await page.mouse.down();
    await page.mouse.move(zb.x - 60, zb.y - 40, { steps: 5 }); await page.mouse.up();
    await pollFile(() => items()[id].box.w).toBeLessThan(w0 - 40);
    await page.click("#undoBtn");
    await pollFile(() => items()[id].box.w).toBe(w0);
    // a click on the chart selects it, and the slice under the pointer
    const b = (await page.locator(".itembox[data-kind=chart]").boundingBox())!;
    const sb = (await page.locator("#stage .slide").boundingBox())!;
    await page.mouse.click(sb.x + sb.width - 6, sb.y + 6);                          // the empty slide: nothing selected
    await expect(page.locator("#chartPanel")).toHaveCount(0);
    await page.mouse.click(b.x + 5, b.y + 5);
    await expect(page.locator("#chartPanel")).toBeVisible();
    // moved by a drag: one change, the chart placed freely; undo puts it back
    const box0 = items()[id].box;
    await page.mouse.move(b.x + b.width / 2, b.y + 20); await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 - 200, b.y + 60, { steps: 6 }); await page.mouse.up();
    await pollFile(() => items()[id].box.x).toBeLessThan(box0.x - 100);
    await page.click("#undoBtn");
    await pollFile(() => items()[id].box).toEqual(box0);
    // CH-03 · a reload with a changed file: the chart reads the new numbers (B9: 1 234,5 → 9 999)
    await page.locator('#chartPanel [data-show="value"]').check();
    await expect(chartLayer).toContainText("1.235 €");
    try {
    fs.writeFileSync(file, xlsxEdit(original, "xl/worksheets/sheet5.xml", x => x.replace("<c r=\"B9\" s=\"23\" t=\"n\"><v>1234.5</v>", "<c r=\"B9\" s=\"23\" t=\"n\"><v>9999</v>")));
    await page.click("#reloadBtn");
    await expect(chartLayer).toContainText("9.999 €", { timeout: 20_000 });
    // CH-04 · the source sheet gone (renamed in Excel): a placeholder, the Issues line, the chart kept in the deck
    fs.writeFileSync(file, xlsxEdit(original, "xl/workbook.xml", x => x.replace('name="Numbers"', 'name="Figures"')));
    await page.click("#reloadBtn");
    await expect(page.locator("#issues")).toContainText("Chart 1: source Numbers!B9:B11 not found", { timeout: 20_000 });
    await expect(chartLayer).toContainText("Chart: source Numbers!B9:B11 not found");
    await expect(page.locator(".itembox.broken")).toHaveCount(1);
    expect(Object.keys(items())).toEqual([id]);
    } finally { fs.writeFileSync(file, original); }            // the folder's report.xlsx as the later tests expect it
    await page.click("#reloadBtn");
    await expect(chartLayer).toContainText("1.235 €", { timeout: 20_000 });
    await expect(page.locator("#issues")).not.toContainText("Chart 1");
    // removed with Del; undo brings it back
    await page.locator(".itembox[data-kind=chart]").click({ position: { x: 4, y: 4 } });
    await page.keyboard.press("Delete");
    await expect(page.locator(".itembox")).toHaveCount(0);
    await pollFile(() => Object.keys(items())).toEqual([]);
    await page.click("#undoBtn");
    await expect(page.locator(".itembox[data-kind=chart]")).toHaveCount(1);
    await pollFile(() => Object.keys(items())).toEqual([id]);
    // and removed for good (the later tests count this deck's slides and texts as they were)
    await page.locator(".itembox[data-kind=chart]").click({ position: { x: 4, y: 4 } });
    await page.keyboard.press("Delete");
    await pollFile(() => Object.keys(items())).toEqual([]);
    await lastFileSaved("anna", "report.xlsx");
  });

  test("free layout (S10.1, FL-01, B18): switched on nothing moves; Reset layout asks and switches back; one undo step each way", async ({ page }) => {
    await openApp(page, ANNA);
    await expect(page.locator(".thumb").first()).toBeVisible({ timeout: 20_000 });
    const si = doc().preset.slides.findIndex((s: any) => s.type === "content" && s.tables.length === 2);
    expect(si).toBeGreaterThanOrEqual(0);
    await page.locator(`.thumb[data-i="${si}"]`).click(); await page.locator(`.thumb.on[data-i="${si}"]`).waitFor();
    const design = () => doc().style.design || "glass", free = () => doc().preset.slides[si].free?.[design()];
    const places = async () => { const out: number[][] = []; for (const i of [0, 1]) { const b = await boxOf(page.locator(`#stage .slide > .tw[data-i="${i}"]`)); out.push([b.x, b.y, b.width, b.height].map(v => Math.round(v * 2) / 2)); } return out; };
    const undoSteps = () => page.evaluate(() => (window as any).__sbTest.history().undo as number);
    await page.waitForFunction(() => (window as any).__sbTest.stageIdle());
    const before = await places(), u0 = await undoSteps();
    // on: every box saved as drawn – nothing moves
    await page.click("#freeLayout");
    await pollFile(() => free()?.on, { timeout: 10_000 }).toBe(true);
    await expect(page.locator("#freeLayout")).toHaveClass(/\bon\b/);
    expect(Object.keys(free().items).filter(k => k.startsWith("t:")).length).toBe(2);
    await expect.poll(() => undoSteps()).toBe(u0 + 1);
    await page.waitForFunction(() => (window as any).__sbTest.stageIdle());
    expect(await places()).toEqual(before);
    // the saved box is what the slide draws: the first table's moved 100 px right (one change), the second stays
    const id0 = doc().preset.slides[si].tables[0], s = (await boxOf(page.locator("#stage .slide"))).width / 1600, x0 = free().items["t:" + id0].x;
    await page.evaluate(([id, d, k]) => { const t = window as any, p = t.__sbTest.preset(), sl = p.slides.find((x: any) => x.id === id), f = sl.free[d];
      t.__sbTest.change("Move table", [{ op: "slide.patch", id, patch: { free: { [d]: { ...f, items: { ...f.items, [k]: { ...f.items[k], x: f.items[k].x + 100 } } } } } }]); },
      [doc().preset.slides[si].id, design(), "t:" + id0] as const);
    await pollFile(() => free().items["t:" + id0].x, { timeout: 10_000 }).toBe(x0 + 100);
    await expect.poll(() => undoSteps()).toBe(u0 + 2);
    await page.waitForFunction(() => (window as any).__sbTest.stageIdle());
    await expect.poll(async () => { const p = await places(); return [Math.abs((p[0][0] - before[0][0]) / s - 100) < 2, p[0][1] - before[0][1], p[1]]; }).toEqual([true, 0, before[1]]);
    await page.click("#undoBtn");
    await expect.poll(() => undoSteps()).toBe(u0 + 1);
    await page.waitForFunction(() => (window as any).__sbTest.stageIdle());
    await expect.poll(() => places()).toEqual(before);
    await pollFile(() => free().items["t:" + id0].x, { timeout: 10_000 }).toBe(x0);
    // Reset layout asks first; Cancel changes nothing
    await page.click("#resetLayout");
    await expect(page.locator(".dlg")).toContainText("Back to automatic layout?");
    await page.click('.dlg button:has-text("Cancel")');
    await expect(page.locator(".dlg")).toHaveCount(0);
    expect(await undoSteps()).toBe(u0 + 1);
    // …and switches back: the automatic layout, the boxes kept
    const saved = JSON.stringify(free().items);
    await page.click("#resetLayout"); await page.click('.dlg button:has-text("Automatic layout")');
    await pollFile(() => free()?.on, { timeout: 10_000 }).toBe(false);
    expect(JSON.stringify(free().items)).toBe(saved);
    await expect(page.locator("#freeLayout")).not.toHaveClass(/\bon\b/);
    await expect.poll(() => undoSteps()).toBe(u0 + 2);
    await page.waitForFunction(() => (window as any).__sbTest.stageIdle());
    expect(await places()).toEqual(before);
    // one undo step: free again; another: as before the switch
    await page.click("#undoBtn");
    await pollFile(() => free()?.on, { timeout: 10_000 }).toBe(true);
    await page.click("#undoBtn");
    await pollFile(() => free() ?? "none", { timeout: 10_000 }).toBe("none");
    await expect.poll(() => undoSteps()).toBe(u0);
    await page.waitForFunction(() => (window as any).__sbTest.stageIdle());
    expect(await places()).toEqual(before);
  });

  test("free layout drags (S10.2, FL-02, FL-03, B18): tables, text boxes and callouts moved and resized on their own, snapping unless Alt is held, one undo step each; raw Excel too", async ({ page }) => {
    await openApp(page, ANNA);
    await expect(page.locator(".thumb").first()).toBeVisible({ timeout: 20_000 });
    const si = doc().preset.slides.findIndex((s: any) => s.type === "content" && s.tables.length === 2);
    await page.locator(`.thumb[data-i="${si}"]`).click(); await page.locator(`.thumb.on[data-i="${si}"]`).waitFor();
    const slide = () => doc().preset.slides[si], [id0, id1] = slide().tables as string[];
    const free = (d = "glass") => slide().free?.[d], box = (k: string, d = "glass") => free(d)?.items?.[k];
    const undoSteps = () => page.evaluate(() => (window as any).__sbTest.history().undo as number);
    const idle = () => page.waitForFunction(() => (window as any).__sbTest.stageIdle());
    const drag = async (from: { x: number; y: number }, dx: number, dy: number, alt = false) => {
      await page.mouse.move(from.x, from.y); if (alt) await page.keyboard.down("Alt");
      await page.mouse.down(); await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 }); await page.mouse.up();
      if (alt) await page.keyboard.up("Alt");
    };
    const mid = async (sel: string) => { const b = await boxOf(page.locator(sel).first()); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    expect(doc().style.design || "glass").toBe("glass");
    await page.locator("#stage .stagewrap").hover();
    await page.click("#freeLayout");
    await pollFile(() => free()?.on, { timeout: 10_000 }).toBe(true);
    await idle();
    const s = (await boxOf(page.locator("#stage .slide"))).width / 1600;               // screen px per slide px
    let u = await undoSteps();
    // one more undo step, drawn, and saved (the file is what the next drag's numbers are read from)
    const pageFree = () => page.evaluate(i => JSON.stringify((window as any).__sbTest.preset().slides[i].free ?? null), si);
    const step = async () => { u++; await expect.poll(() => undoSteps()).toBe(u); await idle(); const want = await pageFree(); await pollFile(() => JSON.stringify(slide().free ?? null), { timeout: 10_000 }).toBe(want); };
    // the second table by its grip, Alt held (no snapping): moved by the pointer (left: it sits at the slide's right side), the first one stays
    const a0 = box("t:" + id0), b0 = box("t:" + id1);
    await drag(await mid('#stage .hbox[data-i="1"] .grip'), -90, 50, true);
    await pollFile(() => Math.abs(box("t:" + id1).x - (b0.x - 90 / s)) < 2 && Math.abs(box("t:" + id1).y - (b0.y + 50 / s)) < 2, { timeout: 10_000 }).toBe(true);
    expect(box("t:" + id0)).toEqual(a0);
    expect(box("t:" + id1).scale).toBe(b0.scale);
    await step();
    await expect.poll(async () => Math.abs((await boxOf(page.locator('#stage .slide > .tw[data-i="1"]'))).x - ((await boxOf(page.locator("#stage .slide"))).x + box("t:" + id1).x * s)) < 1.5).toBe(true);
    // its left edge dropped 3 screen px beside the first table's: snapped onto it; with Alt it stays where it was dropped
    const near = async (alt: boolean) => { const b = box("t:" + id1), a = box("t:" + id0); await drag(await mid('#stage .hbox[data-i="1"] .grip'), (a.x - b.x) * s + 3, 0, alt); };
    await near(false);
    await pollFile(() => box("t:" + id1).x, { timeout: 10_000 }).toBe(a0.x);
    await step();
    await drag(await mid('#stage .hbox[data-i="1"] .grip'), 40, 0, true); await step();
    await near(true);
    await pollFile(() => Math.abs(box("t:" + id1).x - (a0.x + 3 / s)) < 1.5, { timeout: 10_000 }).toBe(true);
    await step();
    // back to its own column (it would cover the first table's handles)
    await drag(await mid('#stage .hbox[data-i="1"] .grip'), (b0.x - box("t:" + id1).x) * s, 0, true); await step();
    // the first table's corner: smaller, its proportions kept
    await drag(await mid('#stage .hbox[data-i="0"] .size'), -70, -70, true);
    await pollFile(() => box("t:" + id0).scale < a0.scale - .02, { timeout: 10_000 }).toBe(true);
    const a1 = box("t:" + id0);
    expect(a1.w / a1.h).toBeCloseTo(a0.w / a0.h, 1);
    expect([a1.x, a1.y]).toEqual([a0.x, a0.y]);
    await step();
    // its left edge: wider to the left, its right side and top stay, the height follows
    const el = await boxOf(page.locator('#stage .hbox[data-i="0"] .edge.l'));          // (a quarter down: the + button sits mid-way)
    await drag({ x: el.x + el.width / 2, y: el.y + el.height / 4 }, -50, 0, true);
    await pollFile(() => box("t:" + id0).w > a1.w + 20, { timeout: 10_000 }).toBe(true);
    const a2 = box("t:" + id0);
    expect(Math.abs(a2.x + a2.w - (a1.x + a1.w))).toBeLessThan(2);
    expect(a2.y).toBe(a1.y);
    expect(a2.w / a2.h).toBeCloseTo(a1.w / a1.h, 1);
    await step();
    // a text box (added with +, beside its table until moved): moved by its body and stretched by its left edge – the
    // layout's box changes, the text box itself is not moved
    await page.locator('#stage .hbox[data-i="0"] .addnote.bottom').click();
    await expect(page.locator("textarea.note-edit")).toBeVisible();
    await page.keyboard.type("Free note"); await page.keyboard.press("Control+Enter");
    const note = page.locator("#stage .tnote", { hasText: "Free note" }), nk = "n:" + id0 + ":bottom";
    await expect(note).toBeVisible();
    u = await undoSteps(); await idle();
    await drag(await mid('#stage .tnote:has-text("Free note")'), 70, 40, true);
    await pollFile(() => box(nk)?.x ?? "none", { timeout: 10_000 }).not.toBe("none");
    const n1 = box(nk);
    expect(slide().notes[id0 + ":bottom"].x).toBeUndefined();
    await step();
    const nb = await boxOf(note);
    await drag({ x: nb.x + 2, y: nb.y + nb.height / 2 }, -60, 0, true);
    await pollFile(() => box(nk).w, { timeout: 10_000 }).toBeGreaterThan(n1.w + 30);
    expect(Math.abs(box(nk).x + box(nk).w - (n1.x + n1.w))).toBeLessThan(2);
    await step();
    // a callout: its body and its right edge (in a free layout an item has edges too); its own box stays
    await page.click("#shapeBtn"); await page.click('.shapemenu [data-shape="pill"]');
    await expect(page.locator(".itembox[data-kind=shape]")).toHaveCount(1, { timeout: 10_000 });
    await pollFile(() => Object.keys(slide().items || {}).length, { timeout: 10_000 }).toBe(1);
    const iid = Object.keys(slide().items)[0], own = JSON.stringify(slide().items[iid].box);
    u = await undoSteps(); await idle();
    await drag(await mid(".itembox[data-kind=shape]"), -80, -60, true);
    await pollFile(() => box("i:" + iid)?.x ?? "none", { timeout: 10_000 }).not.toBe("none");
    const i1 = box("i:" + iid);
    expect(JSON.stringify(slide().items[iid].box)).toBe(own);
    await step();
    const ib = await boxOf(page.locator(".itembox[data-kind=shape]"));
    await drag({ x: ib.x + ib.width - 2, y: ib.y + ib.height / 2 }, 50, 0, true);
    await pollFile(() => box("i:" + iid).w, { timeout: 10_000 }).toBeGreaterThan(i1.w + 30);
    expect([box("i:" + iid).x, box("i:" + iid).y, box("i:" + iid).h]).toEqual([i1.x, i1.y, i1.h]);
    await step();
    // the callout and the text box go again (Del; the text box's 🗑) – the later steps count this deck's objects as before
    await page.locator(".itembox[data-kind=shape]").click({ position: { x: 4, y: 4 } }); await page.keyboard.press("Delete");
    await pollFile(() => Object.keys(slide().items || {}).length, { timeout: 10_000 }).toBe(0);
    await note.click(); await page.click("#noteDelete");
    await pollFile(() => slide().notes?.[id0 + ":bottom"] ?? "none", { timeout: 10_000 }).toBe("none");
    // FL-03: raw Excel has its own free layout (sizes per design); its text boxes are drawn and move there too (B19)
    await page.click('[data-design="excel"]'); await saved(page); await idle();
    await page.locator('#stage .hbox[data-i="1"] .addnote.right').click();
    await expect(page.locator("textarea.note-edit")).toBeVisible();
    await page.keyboard.type("Excel note"); await page.keyboard.press("Control+Enter");
    await expect(page.locator("#stage .tnote", { hasText: "Excel note" })).toBeVisible();
    await expect(page.locator("#freeLayout")).not.toHaveClass(/\bon\b/);
    await page.click("#freeLayout");
    await pollFile(() => free("excel")?.on, { timeout: 10_000 }).toBe(true);
    await idle();
    const ek = "n:" + id1 + ":right", e0 = box(ek, "excel");
    expect(e0).toBeTruthy();
    await drag(await mid('#stage .tnote:has-text("Excel note")'), -40, 60, true);
    await pollFile(() => Math.abs(box(ek, "excel").y - (e0.y + 60 / s)) < 2, { timeout: 10_000 }).toBe(true);
    expect(free().on).toBe(true);                                                         // Liquid Glass's layout untouched
    expect(box(ek)).toBeUndefined();
    // back as the later tests expect the deck: the note gone, the automatic layouts, Liquid Glass
    await page.locator("#stage .tnote", { hasText: "Excel note" }).click(); await page.click("#noteDelete");
    await pollFile(() => slide().notes?.[id1 + ":right"] ?? "none", { timeout: 10_000 }).toBe("none");
    await page.click("#freeLayout"); await pollFile(() => free("excel")?.on, { timeout: 10_000 }).toBe(false);
    await page.click('[data-design="glass"]'); await saved(page);
    await page.click("#freeLayout"); await pollFile(() => free()?.on, { timeout: 10_000 }).toBe(false);
    await lastFileSaved("anna", "report.xlsx");
  });

  test("gridlines on selected cells (S10.3, GL-01, GL-02, B20): H, V, outline, colour, weight, clear – separate from the borders; the painter copies them", async ({ page }) => {
    await openApp(page, ANNA);
    await expect(page.locator(".thumb").first()).toBeVisible({ timeout: 20_000 });
    // the pair's first table: cells without workbook borders (where a cell has one, the border shows instead: core unit tests)
    const tid = doc().preset.tables.find((t: any) => t.sheet === "SLIDE_3 pair" && t.index === 0).id;
    const si = doc().preset.slides.findIndex((s: any) => s.tables.includes(tid));
    await page.locator(`.thumb[data-i="${si}"]`).click(); await page.locator(`.thumb.on[data-i="${si}"]`).waitFor();
    const tdef = () => doc().preset.tables.find((t: any) => t.id === tid), cg = () => tdef().cellGrid || {};
    const before = JSON.stringify({ ...tdef(), cellGrid: undefined });
    const layer = page.locator('#stage .slide > .tw[data-i="0"]');
    // (the menu stays open between clicks: it acts on the selection)
    const menu = async (sel: string) => { if (!await page.locator("#cellGrid").isVisible()) await page.click("#gridBtn"); await page.click(`#cellGrid ${sel}`); };
    await selectCell(page, "R1");
    // V: the cell's left and right lines
    await menu('[data-cg="v"]');
    await pollFile(() => Object.values(cg()), { timeout: 10_000 }).toEqual([{ v: "on" }]);
    const key = Object.keys(cg())[0];
    // colour and weight: on the selected cell's lines; drawn on the slide in that colour
    await menu('[data-cgc="#C00000"]');
    await pollFile(() => cg()[key], { timeout: 10_000 }).toEqual({ v: "on", c: "#C00000" });
    await menu('[data-cgw="2"]');
    await pollFile(() => cg()[key], { timeout: 10_000 }).toEqual({ v: "on", c: "#C00000", w: 2 });
    await expect.poll(async () => /192,0,0|#c00000/i.test(await layer.innerHTML())).toBe(true);
    // H and Outline: added to the same cell's entry; H again removes the horizontal lines
    await menu('[data-cg="h"]');
    await pollFile(() => cg()[key], { timeout: 10_000 }).toEqual({ v: "on", h: "on", c: "#C00000", w: 2 });
    await menu('[data-cg="o"]');
    await pollFile(() => cg()[key]?.o, { timeout: 10_000 }).toBe(true);
    await menu('[data-cg="h"]');
    await pollFile(() => cg()[key]?.h ?? "none", { timeout: 10_000 }).toBe("none");
    // the table's own settings and the cells' borders are not touched
    expect(JSON.stringify({ ...tdef(), cellGrid: undefined })).toBe(before);
    expect(doc().edits["SLIDE_3 pair"]?.[key]).toBeUndefined();
    // GL-02: the format painter copies them to another cell
    await selectCell(page, "R1"); await page.click("#painterBtn");
    const target = page.locator("#stage .slide .t", { hasText: /^R2$/ }).first(), tb = (await target.boundingBox())!;
    await page.mouse.click(tb.x + 6, tb.y + tb.height / 2);
    await pollFile(() => Object.keys(cg()).length, { timeout: 10_000 }).toBe(2);
    const other = Object.keys(cg()).find(k => k !== key)!;
    expect(cg()[other]).toEqual(cg()[key]);
    // Clear: the selected cell's gridlines gone (one change); undo brings them back
    await selectCell(page, "R1"); await menu('[data-cg="clear"]');
    await pollFile(() => Object.keys(cg()), { timeout: 10_000 }).toEqual([other]);
    await page.click("#undoBtn");
    await pollFile(() => Object.keys(cg()).sort(), { timeout: 10_000 }).toEqual([key, other].sort());
    // and the deck as the later tests expect it: no cell gridlines
    await page.evaluate(([id]) => (window as any).__sbTest.change("Clear cell lines", [{ op: "table.patch", id, patch: { cellGrid: null } }]), [tid]);
    await pollFile(() => tdef().cellGrid ?? "none", { timeout: 10_000 }).toBe("none");
    await expect.poll(async () => /192,0,0|#c00000/i.test(await layer.innerHTML())).toBe(false);
  });

  test("cell borders on the slide (S10.3b, B28): Borders ▾ as Excel's – outside in a style and colour, none, clear; separate from the gridlines; the painter copies them", async ({ page }) => {
    await openApp(page, ANNA);
    await expect(page.locator(".thumb").first()).toBeVisible({ timeout: 20_000 });
    const tid = doc().preset.tables.find((t: any) => t.sheet === "SLIDE_3 pair" && t.index === 0).id;
    const si = doc().preset.slides.findIndex((s: any) => s.tables.includes(tid));
    await page.locator(`.thumb[data-i="${si}"]`).click(); await page.locator(`.thumb.on[data-i="${si}"]`).waitFor();
    const tdef = () => doc().preset.tables.find((t: any) => t.id === tid), bd = () => tdef().borders || {};
    const layer = page.locator('#stage .slide > .tw[data-i="0"]'), red = async () => /192,0,0/.test(await layer.innerHTML());
    const menu = async (sel: string) => { if (!await page.locator("#borderMenu").isVisible()) await page.click("#bordersBtn"); await page.click(`#borderMenu ${sel}`); };
    // R1 and R2 (one column, two rows): Outside, medium, red
    await page.click('[data-design="excel"]'); await saved(page);
    await selectCell(page, "R1");
    const r2 = (await page.locator("#stage .slide .t", { hasText: /^R2$/ }).first().boundingBox())!;
    await page.keyboard.down("Shift"); await page.mouse.click(r2.x + 6, r2.y + r2.height / 2); await page.keyboard.up("Shift");
    await menu('[data-bs="medium"]'); await menu('[data-bc="#C00000"]'); await menu('[data-b="outside"]');
    const B = { style: "medium", color: "#C00000" };
    await pollFile(() => Object.values(bd()), { timeout: 10_000 }).toEqual([{ top: B, left: B, right: B }, { bottom: B, left: B, right: B }]);
    await expect.poll(red).toBe(true);
    const [k1, k2] = Object.keys(bd());
    // the gridlines are another layer: none were written
    expect(tdef().cellGrid).toBeUndefined();
    // No border: every edge of both cells "none" (one change); Clear: the workbook's borders again; undo
    await menu('[data-b="none"]');
    await pollFile(() => bd()[k1], { timeout: 10_000 }).toEqual({ top: "none", left: "none", right: "none", bottom: "none" });
    await expect.poll(red).toBe(false);
    await page.click("#undoBtn");
    await pollFile(() => bd()[k1], { timeout: 10_000 }).toEqual({ top: B, left: B, right: B });
    // the painter copies a cell's borders to another cell
    await selectCell(page, "R1"); await page.click("#painterBtn");
    const r4 = (await page.locator("#stage .slide .t", { hasText: /^R4$/ }).first().boundingBox())!;
    await page.mouse.click(r4.x + 6, r4.y + r4.height / 2);
    await pollFile(() => Object.keys(bd()).length, { timeout: 10_000 }).toBe(3);
    expect(Object.entries(bd()).find(([k]) => k !== k1 && k !== k2)![1]).toEqual(bd()[k1]);
    // Clear on R1:R2 → only the painted cell keeps its own; then the deck as the later tests expect it
    await selectCell(page, "R1");
    const r2b = (await page.locator("#stage .slide .t", { hasText: /^R2$/ }).first().boundingBox())!;      // (measured again: the ribbon may have changed)
    await page.keyboard.down("Shift"); await page.mouse.click(r2b.x + 6, r2b.y + r2b.height / 2); await page.keyboard.up("Shift");
    await menu('[data-b="clear"]');
    await pollFile(() => Object.keys(bd()).length, { timeout: 10_000 }).toBe(1);
    await page.evaluate(([id]) => (window as any).__sbTest.change("Borders from Excel", [{ op: "table.patch", id, patch: { borders: null } }]), [tid]);
    await pollFile(() => tdef().borders ?? "none", { timeout: 10_000 }).toBe("none");
    await expect.poll(red).toBe(false);
    await page.click('[data-design="glass"]'); await saved(page);
  });

  test("New slide (S13.4, NS-01, B40): after the selected slide, its title typed at once; #newSlide, Ctrl+M, the slide list's menu; one undo step each", async ({ page, browser }) => {
    await openApp(page, ANNA);
    await openWorkbook(page, "report.xlsx"); await continueOpen(page, "report.xlsx");
    await expect(page.locator(".thumb").first()).toBeVisible({ timeout: 20_000 });
    const undoSteps = () => page.evaluate(() => (window as any).__sbTest.history().undo as number);
    const ids = () => doc().preset.slides.map((s: any) => s.id) as string[];
    const ids0 = ids(), n0 = ids0.length, u0 = await undoSteps();
    const editor = page.locator("#stage input.inline-edit");
    // #newSlide: a blank content slide after the first, shown, its title open for typing
    await page.locator('.thumb[data-i="0"]').click(); await page.locator('.thumb.on[data-i="0"]').waitFor();
    await page.click("#newSlide");
    await expect(editor).toBeFocused({ timeout: 10_000 });
    await expect(editor).toHaveValue("New slide");
    await expect(page.locator('.thumb.on[data-i="1"]')).toBeVisible();
    await expect(page.locator("#slideCount")).toHaveText(String(n0 + 1));
    await page.keyboard.type("Outlook 2027"); await page.keyboard.press("Enter");
    await pollFile(() => doc().preset.slides[1].title, { timeout: 10_000 }).toBe("Outlook 2027");
    const added = doc().preset.slides[1];
    expect(added).toMatchObject({ type: "content", tables: [] });
    expect(ids0).not.toContain(added.id);
    expect(ids().filter(id => id !== added.id)).toEqual(ids0);
    await expect(page.locator("#stage .slide [data-edit=\"title\"]")).toHaveText("Outlook 2027");
    await expect.poll(() => undoSteps()).toBe(u0 + 2);
    // undo: the title, then the slide – one step
    await page.click("#undoBtn"); await pollFile(() => doc().preset.slides[1].title, { timeout: 10_000 }).toBe("New slide");
    await page.click("#undoBtn"); await pollFile(() => ids(), { timeout: 10_000 }).toEqual(ids0);
    await expect(page.locator("#slideCount")).toHaveText(String(n0));
    await page.click("#redoBtn"); await pollFile(() => ids().length, { timeout: 10_000 }).toBe(n0 + 1);
    await page.click("#undoBtn"); await pollFile(() => ids(), { timeout: 10_000 }).toEqual(ids0);
    // Ctrl+M (PowerPoint's): after the last slide
    await page.locator(`.thumb[data-i="${n0 - 1}"]`).click(); await page.locator(`.thumb.on[data-i="${n0 - 1}"]`).waitFor();
    await page.keyboard.press("Control+m");
    await expect(editor).toBeFocused({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await pollFile(() => ids().length, { timeout: 10_000 }).toBe(n0 + 1);
    expect(ids().slice(0, n0)).toEqual(ids0);
    expect(doc().preset.slides[n0].title).toBe("New slide");
    await expect(page.locator(`.thumb.on[data-i="${n0}"]`)).toBeVisible();
    // the slide list's right-click menu: New slide after the slide clicked
    await page.locator('.thumb[data-i="0"]').click({ button: "right" });
    await expect(page.locator("#slideMenu")).toBeVisible();
    await expect(page.locator('.thumb.on[data-i="0"]')).toBeVisible();
    await page.click("#ctxNewSlide");
    await expect(page.locator("#slideMenu")).toHaveCount(0);
    await expect(editor).toBeFocused({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await pollFile(() => ids().length, { timeout: 10_000 }).toBe(n0 + 2);
    expect(doc().preset.slides[1].title).toBe("New slide");
    expect(new Set(ids()).size).toBe(n0 + 2);                                          // ids unique (09 §2.8)
    // the menu closes on Escape without a slide
    await page.locator('.thumb[data-i="0"]').click({ button: "right" });
    await page.keyboard.press("Escape");
    await expect(page.locator("#slideMenu")).toHaveCount(0);
    expect(ids().length).toBe(n0 + 2);
    await expect.poll(() => undoSteps()).toBe(u0 + 2);
    await page.click("#undoBtn"); await page.click("#undoBtn");
    await pollFile(() => ids(), { timeout: 10_000 }).toEqual(ids0);
    await saved(page);

    // two writers (review of S13.4; 09 §2.8): anna and bob each press New slide after the same slide before either page
    // has read the other's record – both slides stay, with different ids, in the same order on both pages; anna's undo
    // takes away her slide only
    const b = await browser.newPage();
    await openApp(b, BOB); await openWorkbook(b, "report.xlsx"); await continueOpen(b, "report.xlsx");   // (bob's last file may be another)
    await expect(b.locator(".thumb")).toHaveCount(n0, { timeout: 20_000 });
    // (the deck is format 5 already – the slide.add above raised it – so a record is appended without a tail first)
    await pollFile(() => JSON.parse(fs.readFileSync(path.join(deckDir("report.xlsx")!, "snapshot.json"), "utf8")).format, { timeout: 15_000 }).toBe(5);
    const pageIds = (p: Page) => p.evaluate(() => (window as any).__sbTest.preset().slides.map((s: any) => s.id) as string[]);
    await expect.poll(() => pageIds(b)).toEqual(ids0);
    // no page reads the journals meanwhile: each one's next tail is held until both have added their slide
    const TAIL = /\/api\/decks\/[^/]+\/tail\?since=/, held: Route[] = [], heldBy = { a: 0, b: 0 };
    let holding = true;
    const hold = (who: "a" | "b") => (r: Route) => { if (!holding) return void r.continue(); heldBy[who]++; held.push(r); };
    await page.route(TAIL, hold("a")); await b.route(TAIL, hold("b"));
    await expect.poll(() => heldBy.a > 0 && heldBy.b > 0, { timeout: 10_000 }).toBe(true);   // (a tail sent before is answered)
    const after = ids0[0];
    await page.locator('.thumb[data-i="0"]').click(); await page.locator('.thumb.on[data-i="0"]').waitFor();
    await b.locator('.thumb[data-i="0"]').click(); await b.locator('.thumb.on[data-i="0"]').waitFor();
    await page.click("#newSlide"); await expect(editor).toBeFocused({ timeout: 10_000 }); await page.keyboard.press("Escape");
    const bEditor = b.locator("#stage input.inline-edit");
    await b.click("#newSlide"); await expect(bEditor).toBeFocused({ timeout: 10_000 }); await b.keyboard.press("Escape");
    await saved(page); await saved(b);
    const mine = (await pageIds(page)).filter(id => !ids0.includes(id)), bens = (await pageIds(b)).filter(id => !ids0.includes(id));
    expect(mine).toHaveLength(1); expect(bens).toHaveLength(1);                  // neither page has the other's yet
    const [annaId, bobId] = [mine[0], bens[0]];
    expect(annaId).not.toBe(bobId);
    // both on the share
    await pollFile(() => ids().length, { timeout: 10_000 }).toBe(n0 + 2);
    const both = ids();
    expect(both.filter(id => id !== annaId && id !== bobId)).toEqual(ids0);
    expect(both.indexOf(after)).toBe(0);
    expect([...both.slice(1, 3)].sort()).toEqual([annaId, bobId].sort());          // both after that slide
    // the tails go on: each page reads the other's record, both show the share's order
    holding = false; for (const r of held.splice(0)) await r.continue();
    await expect.poll(() => pageIds(page), { timeout: 15_000 }).toEqual(both);
    await expect.poll(() => pageIds(b), { timeout: 15_000 }).toEqual(both);
    await expect(page.locator("#slideCount")).toHaveText(String(n0 + 2)); await expect(b.locator("#slideCount")).toHaveText(String(n0 + 2));
    // anna's undo: her slide goes, bob's stays (on the share and on both pages)
    await page.click("#undoBtn"); await saved(page);
    const left = both.filter(id => id !== annaId);
    await pollFile(() => ids(), { timeout: 10_000 }).toEqual(left);
    await expect.poll(() => pageIds(page), { timeout: 15_000 }).toEqual(left);
    await expect.poll(() => pageIds(b), { timeout: 15_000 }).toEqual(left);
    // (bob's undo: the deck as it was for the next tests)
    await b.click("#undoBtn"); await saved(b);
    await pollFile(() => ids(), { timeout: 10_000 }).toEqual(ids0);
    await expect.poll(() => pageIds(page), { timeout: 15_000 }).toEqual(ids0);
    await page.unroute(TAIL); await b.unroute(TAIL);
    await b.close();
  });

  test("Add table (S13.4, NS-02, B40): the deck's tables, on no slide first; one added to a new slide; New table from cells; one undo step each; free layout places it in an empty spot", async ({ page }) => {
    await openApp(page, ANNA);
    await openWorkbook(page, "report.xlsx"); await continueOpen(page, "report.xlsx");
    await expect(page.locator(".thumb").first()).toBeVisible({ timeout: 20_000 });
    const undoSteps = () => page.evaluate(() => (window as any).__sbTest.history().undo as number);
    const P = () => doc().preset, u0 = await undoSteps(), defs0 = P().tables.map((t: any) => t.id) as string[];
    const onSlides = (id: string) => P().slides.filter((s: any) => (s.tables || []).includes(id)).length;
    // a new slide to add to
    await page.locator('.thumb[data-i="0"]').click(); await page.locator('.thumb.on[data-i="0"]').waitFor();
    await page.click("#newSlide");
    await expect(page.locator("#stage input.inline-edit")).toBeFocused({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await pollFile(() => P().slides[1].title, { timeout: 10_000 }).toBe("New slide");
    const sid = P().slides[1].id, slide = () => P().slides.find((s: any) => s.id === sid);
    await expect(page.locator("#stage .emptyslide")).toBeVisible();
    // the menu: every mapped table, the ones on no slide first, each with its sheet and range and a preview
    await page.click("#addTable");
    const rows = page.locator("#addTableMenu [data-table]");
    await expect(rows).toHaveCount(defs0.length);
    const listed = await rows.evaluateAll(els => els.map(e => (e as HTMLElement).dataset.table!));
    expect([...listed].sort()).toEqual([...defs0].sort());
    const used = listed.map(id => onSlides(id) > 0);
    expect(used).toEqual([...used].sort((a, b) => Number(a) - Number(b)));             // unused first
    await expect(page.locator("#addTableMenu svg.tprev").first()).toBeVisible();
    const pick = listed[0], tdef = P().tables.find((t: any) => t.id === pick);
    await expect(rows.first()).toContainText(tdef.sheet);
    await rows.first().click();
    await expect(page.locator("#addTableMenu")).toHaveCount(0);
    await pollFile(() => slide().tables, { timeout: 10_000 }).toEqual([pick]);
    await expect(page.locator('#stage .slide > .tw[data-i="0"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#stage .emptyslide")).toHaveCount(0);
    await expect.poll(() => undoSteps()).toBe(u0 + 2);
    // the menu again: that table is on this slide (not offered twice)
    await page.click("#addTable");
    await expect(page.locator(`#addTableMenu [data-table="${pick}"]`)).toBeDisabled();
    await expect(page.locator(`#addTableMenu [data-table="${pick}"]`)).toContainText("on this slide");
    // New table from cells…: the sheet view, a range of a sheet on no slide; its definition and its place in one step
    await page.click('#addTableMenu [data-a="table-pick"]');
    await expect(page.locator("#pickCells")).toBeVisible();
    await expect(page.locator("#pickCells")).toContainText("New table from cells");
    await page.selectOption("#pkSheet", "Numbers");
    await expect(page.locator("#pkUse")).toBeDisabled();
    await page.locator('#pkRange td[data-r="8"][data-c="1"]').click();
    await page.locator('#pkRange td[data-r="11"][data-c="3"]').click({ modifiers: ["Shift"] });
    await expect(page.locator("#pkSel")).toHaveText("A8:C11");
    await expect(page.locator("#pkUse")).toHaveText("Add table");
    await page.click("#pkUse");
    await expect(page.locator("#pickCells")).toHaveCount(0);
    await pollFile(() => slide().tables.length, { timeout: 10_000 }).toBe(2);
    const nid = slide().tables[1];
    expect(defs0).not.toContain(nid);
    expect(P().tables.find((t: any) => t.id === nid)).toMatchObject({ sheet: "Numbers", kind: "range", range: "A8:C11" });
    await expect(page.locator('#stage .slide > .tw[data-i="1"]')).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => undoSteps()).toBe(u0 + 3);
    await page.click("#undoBtn");
    await pollFile(() => slide().tables, { timeout: 10_000 }).toEqual([pick]);
    expect(P().tables.some((t: any) => t.id === nid)).toBe(true);                        // the definition stays (09 §2.8)
    // free layout on: a table added then sits in an empty spot of the content area, at its automatic scale; no box written
    await page.waitForFunction(() => (window as any).__sbTest.stageIdle());
    await page.click("#freeLayout");
    const design = () => doc().style.design || "glass";
    await pollFile(() => slide().free?.[design()]?.on, { timeout: 10_000 }).toBe(true);
    // (the first table made small in the top left corner: room for the next one)
    await page.evaluate(([id, d, k]) => { const t = window as any, sl = t.__sbTest.preset().slides.find((x: any) => x.id === id), f = sl.free[d], e = f.items[k];
      t.__sbTest.change("Move table", [{ op: "slide.patch", id, patch: { free: { [d]: { ...f, items: { ...f.items, [k]: { x: 60, y: 200, w: e.w * .4, h: e.h * .4, scale: (e.scale || 1) * .4 } } } } } }]); },
      [sid, design(), "t:" + pick] as const);
    await pollFile(() => slide().free[design()].items["t:" + pick].x, { timeout: 10_000 }).toBe(60);
    await page.click("#addTable");
    await page.locator(`#addTableMenu [data-table="${nid}"]`).click();
    await pollFile(() => slide().tables.length, { timeout: 10_000 }).toBe(2);
    expect(slide().free[design()].items["t:" + nid]).toBeUndefined();
    await page.waitForFunction(() => (window as any).__sbTest.stageIdle());
    const a = await boxOf(page.locator('#stage .slide > .tw[data-i="0"]')), b = await boxOf(page.locator('#stage .slide > .tw[data-i="1"]'));
    const apart = a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 || a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1;
    expect(apart).toBe(true);
    // undo all: the table, the move, the free layout, the first table, the slide
    for (let i = 0; i < 5; i++) await page.click("#undoBtn");
    await pollFile(() => slide() ?? "removed", { timeout: 10_000 }).toBe("removed");
    await expect.poll(() => undoSteps()).toBe(u0);
    await saved(page);
  });

  test("Hide slide (S13.6, HS-01, HS-03, B47): per design from the slide list's menu, grayed and marked, the stage marks it; every design; one undo step each; the deck is format 5", async ({ page }) => {
    await openApp(page, ANNA);
    await openWorkbook(page, "report.xlsx"); await continueOpen(page, "report.xlsx");
    await expect(page.locator(".thumb").first()).toBeVisible({ timeout: 20_000 });
    const undoSteps = () => page.evaluate(() => (window as any).__sbTest.history().undo as number);
    const design = () => doc().style.design || "glass", other = () => design() === "excel" ? "glass" : "excel";
    const k = (doc().preset.slides as any[]).map(s => s.type).lastIndexOf("content"), hideOf = () => doc().preset.slides[k].hide ?? null;
    const u0 = await undoSteps(), d0 = design(), t = page.locator(`.thumb[data-i="${k}"]`);
    // right-click › Hide slide: hidden in this design only
    await t.click({ button: "right" });
    await expect(page.locator("#ctxHideSlide")).toContainText("Hide slide");
    await page.click("#ctxHideSlide");
    await expect(page.locator("#slideMenu")).toHaveCount(0);
    await pollFile(() => hideOf(), { timeout: 10_000 }).toEqual({ [d0]: true });
    await expect(t).toHaveClass(/\bhid\b/);
    await expect(t.locator(".hidmark")).toHaveText("hidden");
    await expect(page.locator(`.thumb.on[data-i="${k}"]`)).toBeVisible();
    await expect(page.locator("#stageHidden")).toContainText("not exported");                // the stage still shows it, marked
    await expect(page.locator(".thumb.hid")).toHaveCount(1);
    // HS-03: the key is newer than 4.0.0 – the deck is raised to format 5 (no older page can drop it)
    await pollFile(() => JSON.parse(fs.readFileSync(path.join(deckDir("report.xlsx")!, "snapshot.json"), "utf8")).format, { timeout: 15_000 }).toBe(5);
    // another design shows it
    await page.evaluate(d => (window as any).__sbTest.change("Design", [{ op: "style.patch", patch: { design: d } }]), other());
    await expect(t).not.toHaveClass(/\bhid\b/);
    await expect(page.locator("#stageHidden")).toHaveCount(0);
    await page.click("#undoBtn");
    await expect(t).toHaveClass(/\bhid\b/);
    // Hide in every design, then Show in every design
    await t.click({ button: "right" });
    await expect(page.locator("#ctxHideAll")).toHaveText("Hide in every design");
    await page.click("#ctxHideAll");
    await pollFile(() => Object.keys(hideOf() || {}).sort(), { timeout: 10_000 }).toEqual(["bain", "clean", "excel", "glass", "mckinsey"]);
    await t.click({ button: "right" });
    await expect(page.locator("#ctxHideSlide")).toContainText("Show slide");
    await expect(page.locator("#ctxHideAll")).toHaveText("Show in every design");
    await page.click("#ctxHideAll");
    await pollFile(() => hideOf(), { timeout: 10_000 }).toBeNull();
    await expect(t).not.toHaveClass(/\bhid\b/);
    await expect(page.locator("#stageHidden")).toHaveCount(0);
    // one undo step each: show all → hide all → hide here → nothing
    await expect.poll(() => undoSteps()).toBe(u0 + 3);
    await page.click("#undoBtn"); await pollFile(() => Object.keys(hideOf() || {}).length, { timeout: 10_000 }).toBe(5);
    await page.click("#undoBtn"); await pollFile(() => hideOf(), { timeout: 10_000 }).toEqual({ [d0]: true });
    await page.click("#undoBtn"); await pollFile(() => hideOf(), { timeout: 10_000 }).toBeNull();
    await expect(page.locator(".thumb.hid")).toHaveCount(0);
    await saved(page);
  });

  test("Hidden slides in the exports (S13.6, HS-02, B47): PDF, PNG all and PowerPoint leave them out; page numbers and the contents renumber; the current slide still exports; another design keeps it", async ({ page }) => {
    await openApp(page, ANNA);
    await openWorkbook(page, "report.xlsx"); await continueOpen(page, "report.xlsx");
    await expect(page.locator(".thumb").first()).toBeVisible({ timeout: 20_000 });
    const undoSteps = () => page.evaluate(() => (window as any).__sbTest.history().undo as number);
    const change = (label: string, ops: object[]) => page.evaluate(([l, o]) => (window as any).__sbTest.change(l, o), [label, ops] as const);
    const slides = doc().preset.slides as any[], n = slides.length, k = slides.map(s => s.type).indexOf("content"), id = slides[k].id;
    const ix = slides.map(s => s.type).indexOf("index"), u0 = await undoSteps();
    const read = (f: string) => fs.readFileSync(path.join(root(), "export", f));
    // "n / N" as one run, whatever spacing the text extractor gives it, and not inside a longer number ("14 / 14")
    const pn = (a: number, b: number) => new RegExp(`(^|\\D)${a}\\s*/\\s*${b}(\\D|$)`);
    // page numbers "n / N" on every slide, and a title only this slide has
    await change("Page numbers", [{ op: "style.patch", patch: { pn: { on: true, format: "nN", cover: true } } }]);
    await change("Title", [{ op: "slide.patch", id, patch: { title: "Zeta hidden" } }]);
    await expect.poll(() => undoSteps()).toBe(u0 + 2);
    let text = pdfPageTexts(read((await exported(page, () => page.click("#exportBtn")))[0]));
    expect(text).toHaveLength(n);
    expect(text.join(" ")).toContain("Zeta hidden");
    expect(text[n - 1]).toMatch(pn(n, n));
    // hidden in this design (the slide list's menu)
    await page.locator(`.thumb[data-i="${k}"]`).click({ button: "right" }); await page.click("#ctxHideSlide");
    await expect(page.locator(`.thumb[data-i="${k}"]`)).toHaveClass(/\bhid\b/);
    await saved(page);
    text = pdfPageTexts(read((await exported(page, () => page.click("#exportBtn")))[0]));
    expect(text).toHaveLength(n - 1);
    expect(text.join(" ")).not.toContain("Zeta hidden");                                 // neither its page nor a contents entry
    expect(text[n - 2]).toMatch(pn(n - 1, n - 1));                                       // the last page renumbered
    if (ix >= 0) expect(text[ix]).toMatch(pn(ix + 1, n - 1));
    // PNG of every slide, PowerPoint: the same pages
    expect(await fromMenu(page, "png-all")).toHaveLength(n - 1);
    const [pptx] = await fromMenu(page, "pptx");
    expect(pptxSlides(read(pptx))).toBe(n - 1);
    expect(pptxTexts(read(pptx)).join(" ")).not.toContain("Zeta hidden");
    // the current slide, hidden: exported all the same (asked for it)
    await page.locator(`.thumb[data-i="${k}"]`).click(); await page.locator(`.thumb.on[data-i="${k}"]`).waitFor();
    const [one] = await fromMenu(page, "pdf-current");
    const cur = pdfPageTexts(read(one));
    expect(cur).toHaveLength(1); expect(cur[0]).toContain("Zeta hidden");
    // every version × all five designs (S13.6 review, 6): the design that hides the slide has n - 1 pages, the others n
    const d0 = doc().style.design || "glass";
    // a version as the wizard makes it (DeckVersion: its removed cells per sheet, none here)
    await change("Versions", [{ op: "preset.set", preset: { ...doc().preset, versions: [{ id: "vhs", name: "Chief", hide: {} }] } }]);
    await expect.poll(() => undoSteps()).toBe(u0 + 4);
    await saved(page);
    const LABEL: Record<string, string> = { glass: "Liquid Glass", excel: "Excel", clean: "Excel Refined", mckinsey: "Consulting Navy", bain: "Consulting Red" };
    const vfiles = await fromMenu(page, "versions-5");
    expect(vfiles).toHaveLength(5);
    await expect(page.locator("#toast")).toContainText("Saved 5 PDFs");
    for (const [d, label] of Object.entries(LABEL)) {
      const f = vfiles.find(x => new RegExp(` - Chief - ${label}( \\(images\\))?\\.pdf$`).test(x));
      expect(f, d).toBeTruthy();
      const pages = pdfPageTexts(read(f!));
      expect(pages.length, d).toBe(d === d0 ? n - 1 : n);
      expect(pages.join(" ").includes("Zeta hidden"), d).toBe(d !== d0);
    }
    // another design: every slide
    await change("Design", [{ op: "style.patch", patch: { design: (doc().style.design || "glass") === "excel" ? "glass" : "excel" } }]);
    await saved(page);
    text = pdfPageTexts(read((await exported(page, () => page.click("#exportBtn")))[0]));
    expect(text).toHaveLength(n);
    expect(text.join(" ")).toContain("Zeta hidden");
    // undo: the design, the versions, the hide, the title, the page numbers
    for (let i = 0; i < 5; i++) await page.click("#undoBtn");
    await expect.poll(() => undoSteps()).toBe(u0);
    await pollFile(() => doc().preset.slides[k].hide ?? null, { timeout: 10_000 }).toBeNull();
    await saved(page);
  });

  test("no page errors, console errors or warnings", async () => { expect(unexpected(errors)).toEqual([]); });
});

/** a minimal TrueType file: name table (family) + OS/2 (weight) – enough for the upload and its name detection */
function sfnt(family: string, weight: number): Buffer {
  const str = Buffer.from(family, "utf16le").swap16(), name = Buffer.alloc(18 + str.length);
  name.writeUInt16BE(1, 2); name.writeUInt16BE(18, 4);
  name.writeUInt16BE(3, 6); name.writeUInt16BE(1, 8); name.writeUInt16BE(0x409, 10); name.writeUInt16BE(1, 12); name.writeUInt16BE(str.length, 14);
  str.copy(name, 18);
  const os2 = Buffer.alloc(78); os2.writeUInt16BE(weight, 4);
  const head = 12 + 32, out = Buffer.alloc(head + name.length + os2.length);
  out.writeUInt32BE(0x00010000, 0); out.writeUInt16BE(2, 4);
  const rec = (i: number, tag: string, off: number, len: number) => { out.write(tag, 12 + i * 16, "latin1"); out.writeUInt32BE(off, 12 + i * 16 + 8); out.writeUInt32BE(len, 12 + i * 16 + 12); };
  rec(0, "OS/2", head + name.length, os2.length); rec(1, "name", head, name.length);
  name.copy(out, head); os2.copy(out, head + name.length);
  return out;
}
