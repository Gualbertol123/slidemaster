/* End-to-end: the built app (helper/slide_builder.html) served by two real helpers that share one
   folder – user "anna" on :8951 and user "bob" on :8952. Run: npm run build && npm run test:e2e */
import { test, expect, type Locator, type Page } from "@playwright/test";
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
const errors: string[] = [];
/* browser messages the fixtures cause on purpose; any other console error or warning fails E15:
   the decks' default logo "logo.png" is not in the test folder (the app shows "Logo not found"), the helper
   has no favicon, and the uploaded test fonts are name-table stubs (sfnt() below) that Chrome cannot decode */
const EXPECTED = [/^console\.error: Failed to load resource: .* 404 .* @ \/assets\/logo\.png[?:]/, /^console\.error: Failed to load resource: .* 404 .* @ \/favicon\.ico:/,
  /^console\.warning: Failed to decode downloaded font: http:\/\/127\.0\.0\.1:\d+\/fonts\/CorpSans-/];
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
async function selectCell(page: Page, text: string) {
  await page.locator("#stage .slide .t", { hasText: new RegExp("^" + text + "$") }).first().waitFor();
  const box = (await page.locator("#stage .slide .t", { hasText: new RegExp("^" + text + "$") }).first().boundingBox())!;
  await page.mouse.click(box.x + 8, box.y + box.height / 2);
}
/** runs an export (a click) and returns the files it saved: the names the helper gave back (a toast still showing from
    the last export is not taken for this one) */
async function exported(page: Page, click: () => Promise<unknown>): Promise<string[]> {
  await page.evaluate(() => { (window as any).__sbTest.lastExport.files = []; });
  await click();
  let files: string[] = [];
  await expect.poll(async () => (files = await page.evaluate(() => [...(window as any).__sbTest.lastExport.files] as string[])).length, { timeout: 60_000 }).toBeGreaterThan(0);
  await expect(page.locator("#exportBtn")).toHaveText("Export PDF");
  return files;
}
const fromMenu = (page: Page, x: string) => exported(page, async () => { await page.click("#exportMenuBtn"); await page.click(`[data-x="${x}"]`); });
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
    await openWorkbook(b, "report.xlsx"); await b.click('[data-a="continue"]'); await expect(b.locator(".thumb")).toHaveCount(4);
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
    await page.click('[data-a="next"]'); await page.click('[data-a="next"]'); await page.click('[data-a="finish"]');
    await expect(page.locator(".thumb")).toHaveCount(1);
    await page.click("#commentBtn");
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
    await page.click('[data-a="next"]'); await page.click('[data-a="next"]');                // sheets → tables → slides
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
    await openWorkbook(b, "report.xlsx"); await b.click('[data-a="continue"]');   // bob's last file is weekly.xlsx: both on the same deck
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
    await openWorkbook(page, "Banks.xlsx"); await page.click('[data-a="continue"]');
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
    // the Look dropdown (owner, 2026-10-16: every combination): 36 looks, the design's default chosen; a pick is one undo step
    await expect(page.locator("#lookSel option")).toHaveCount(36);
    await expect(page.locator("#lookSel")).toHaveValue("exhibit full panel tinted");
    await page.selectOption("#lookSel", "rules - kpi white"); await saved(page);
    expect(bdoc().style.designs.bain.consult).toEqual({ tables: "rules", headline: "kpi", background: "white" });
    await page.keyboard.press("Control+z"); await saved(page);
    expect(bdoc().style.designs?.bain?.consult).toBeUndefined();
    await expect(page.locator("#lookSel")).toHaveValue("exhibit full panel tinted");
    // S7b.4: thumbnails, a PNG of the slide (3× the slide) and the slide copied to the clipboard, in Consulting Red
    await expect(page.locator(".thumb .frame canvas")).toHaveCount(await page.locator(".thumb").count(), { timeout: 15_000 });
    const [png] = await fromMenu(page, "png-current");
    const pb = fs.readFileSync(path.join(root(), "export", png));
    expect([pb.subarray(1, 4).toString(), pb.readUInt32BE(16), pb.readUInt32BE(20)]).toEqual(["PNG", 4800, 2700]);
    await page.click("#exportMenuBtn"); await page.click('[data-x="copy"]');
    await expect(page.locator("#toast")).toContainText("copied", { timeout: 60_000 });
    expect(await page.evaluate(async () => { const [item] = await navigator.clipboard.read(); const b = await createImageBitmap(await item.getType("image/png")); return [b.width, b.height]; })).toEqual([4800, 2700]);
    await page.click(`[data-design="${before}"]`); await saved(page);
    await expect(page.locator("#lookSel")).toHaveCount(0);                                   // consulting designs only
  });

  test("charts follow a scenario (S9.3, CH-03): a pie from the linked Peers table, previewed for Bank C", async ({ page }) => {
    await openApp(page, ANNA);
    await openWorkbook(page, "Banks.xlsx"); await page.click('[data-a="continue"]');
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
    await openWorkbook(page, "Banks.xlsx"); await page.click('[data-a="continue"]');
    await expect(page.locator("#stage .slide .t", { hasText: /^1761$/ })).toHaveCount(1, { timeout: 20_000 });
    const items = () => (deckDoc("Banks.xlsx").preset.slides[0].items || {}) as Record<string, any>;
    // CL-01: a pill, typed in place; its fill, border and text size from ribbon 2 – each one change
    await page.click("#shapeBtn"); await page.click('.shapemenu [data-shape="pill"]');
    await expect(page.locator(".itembox[data-kind=shape]")).toHaveCount(1, { timeout: 10_000 });
    await pollFile(() => Object.values(items()).map(i => i.shape), { timeout: 10_000 }).toEqual(["pill"]);
    const id = Object.keys(items())[0];
    await page.locator(".itembox[data-kind=shape]").dblclick();
    await page.locator("#itemEdit").fill("Bank: {Control!B2}");
    await page.keyboard.press("Control+Enter");
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
    await page.locator(`.itembox[data-item="${id}"]`).dblclick({ position: { x: 12, y: 12 } });    // (the icon sits in its middle)
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
    await openApp(page, ANNA);                                                       // Banks.xlsx with the linked Peers table
    await expect(page.locator("#stage .slide")).toHaveCount(1, { timeout: 20_000 });
    const bdoc = () => JSON.stringify(deckDoc("Banks.xlsx"));
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
    // the designs (all five), the versions (the full deck), PDF; PowerPoint comes with 4.5
    await expect(page.locator("#scDesigns input")).toHaveCount(5);
    await expect(page.locator("#scVersions input")).toHaveCount(1);
    await expect(page.locator("#scPptx")).toBeDisabled();
    await page.locator('#scDesigns [data-design="excel"]').check();
    await expect(page.locator("#scSummary")).toContainText("= 6 PDFs");
    // Preview (SC-07): Bank C on the stage, the banner names it; nothing is saved
    await page.selectOption("#scValue", "Bank C");
    await page.click("#scPreview");
    await expect(dlg).toHaveCount(0);
    await expect(page.locator("#scBanner")).toContainText("Previewing: Bank C – a scenario, not saved", { timeout: 20_000 });
    await expect(cells.filter({ hasText: /^3141$/ })).toHaveCount(1);              // the linked file recalculated
    await expect(cells.filter({ hasText: /^1761$/ })).toHaveCount(0);
    expect(bdoc()).toBe(before);
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
    expect(bdoc()).toBe(before);
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
    await openApp(page, ANNA);                                                       // Banks.xlsx with the linked Peers table
    await expect(page.locator("#stage .slide")).toHaveCount(1, { timeout: 20_000 });
    await saved(page);
    // SC-05: what a run must not change – both workbooks' bytes, the deck's files on the share, its document
    const hashOf = (f: string) => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
    const dir = deckDir("Banks.xlsx")!, deckFiles = () => fs.readdirSync(dir, { recursive: true }).map(String).filter(f => fs.statSync(path.join(dir, f)).isFile()).sort();
    const state = () => JSON.stringify({ banks: hashOf(path.join(root(), "Banks.xlsx")), peers: hashOf(path.join(root(), "Peers.xlsx")), deck: deckFiles().map(f => [f, hashOf(path.join(dir, f))]) });
    const before = state(), docBefore = JSON.stringify(deckDoc("Banks.xlsx"));
    const exportDir = path.join(root(), "export");
    const runWith = async (input: string, values: string, designs: string[]) => {
      await page.click("#exportMenuBtn"); await page.click('[data-x="scenario"]');
      await page.fill("#scInput", input);
      await expect(page.locator("#scInputNote")).toContainText("today");
      await page.fill("#scValues", values);
      for (const box of await page.locator("#scDesigns input").all()) await box.setChecked(designs.includes((await box.getAttribute("data-design"))!));
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
    await page.click('[data-a="next"]'); await page.click('[data-a="next"]'); await page.click('[data-a="finish"]');
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
    await openWorkbook(page, "report.xlsx"); await page.click('[data-a="continue"]');
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
    await expect(page.locator("#chartSheet option")).toContainText(["SLIDE_1", "Numbers"]);
    await expect(page.locator('#chartSheet option[value="Hidden data"]')).toHaveCount(0);
    await page.selectOption("#chartSheet", "Numbers");
    await page.fill("#chartRange", "b9:b11");
    await page.click("#chartInsert");
    await expect(page.locator(".itembox[data-kind=chart]")).toHaveCount(1, { timeout: 10_000 });
    await pollFile(() => Object.values(items()).map(i => i.values), { timeout: 10_000 }).toEqual([{ sheet: "Numbers", range: "B9:B11" }]);
    const id = Object.keys(items())[0];
    await expect(chartLayer).toHaveCount(1);
    await expect(page.locator("#chartPanel")).toBeVisible();                       // the new chart is selected
    await expect(page.locator("#chartSource")).toContainText("Numbers!B9:B11");
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
