/* End-to-end: a chart's targets (B52, product owner 2026-10-22) on the helper of app.spec.ts (anna :8951). Its own
   workbook (tests/fixtures/Targets.xlsx: SLIDE_1 the weekly volumes of the owner's picture, Targets the budget and
   ambition – no other spec uses its deck), so the raise to format 7 leaves report.xlsx's deck (format 6, which
   hidden-m16 / versions-m16 check) alone:
   B52-01 – a line chart of SLIDE_1!D4:D7; Targets › + Reference line from a cell… picks Targets!B3 in the sheet view (one
            cell, one step); + Gap arrow and + Change pills (one step each); the pills switched off and on (one step
            each); the deck goes to format 7 (incident-format-7.json); the PDF draws the gap's caption, the line's value
            and the pills' changes; the PowerPoint file has the reference line as a second line chart group of the native
            chart (its value cell in the embedded workbook), the gap arrow a line shape with a native end, the pills
            rounded rectangles – no picture, no connector shape; undo takes the extras off one by one. */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { pdfPageRuns } from "./pdftext";
import { fold, type DeckRecord } from "../../core/src/model/fold";

const ANNA = "http://127.0.0.1:8951/";
const BOOK = "Targets.xlsx";
const root = () => process.env.SB_E2E_ROOT!, data = () => process.env.SB_E2E_DATA!;
const deckDir = (name: string) => { const d = path.join(data(), "v4", "decks"); const f = fs.readdirSync(d).find(n => n.startsWith(name + "-") && /-[0-9a-f]{10}$/.test(n)); return f ? path.join(d, f) : null; };
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
/** the deck as everybody reads it: the snapshot and the records past its frontier, folded */
function doc(): any {
  const d = deckDir(BOOK)!;
  const snap = JSON.parse(fs.readFileSync(path.join(d, "snapshot.json"), "utf8"));
  let names: string[] = []; try { names = fs.readdirSync(path.join(d, "j")); } catch { /* no journal yet */ }
  return fold(snap, names.flatMap(n => frames(fs.readFileSync(path.join(d, "j", n)), snap.frontier[n.replace(/\.log$/, "")] || 0))).doc;
}
const pollFile = <T>(read: () => T, opts?: { timeout?: number }) =>
  expect.poll(() => { try { return read(); } catch (e) { return "not saved yet: " + (e as Error).message; } }, opts);
const saved = (page: Page) => expect(page.locator("#sbSave")).toHaveText("✓ Saved", { timeout: 40_000 });
const errors: string[] = [];

async function openPlain(page: Page, url: string) {
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(url);
  await page.locator("#openBtn").waitFor();
  await expect(page.locator("#srv")).toHaveCount(0);
  let last: string | null = null;
  try { last = JSON.parse(fs.readFileSync(path.join(data(), "users", "anna.json"), "utf8")).lastFile || null; } catch { /* first start */ }
  if (last) await expect(page.locator("#fileName")).toHaveText(new RegExp("^" + last.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " · \\d+ slides?"), { timeout: 30_000 });
  await page.click("#openBtn");
  await page.click(`[data-f="${BOOK}"]`);
  const wizard = page.locator(".wiz"), cont = page.locator('[data-a="continue"]');
  await expect(wizard.or(cont)).toBeVisible({ timeout: 20_000 });
  if (await cont.isVisible()) await cont.click();
  else {
    await page.click('[data-a="next"]:has-text("Tables")'); await page.click('[data-a="next"]:has-text("Slides")'); await page.click('[data-a="finish"]');
  }
  await expect(page.locator("#fileName")).toHaveText(/^Targets\.xlsx · \d+ slides?/, { timeout: 30_000 });
  await expect(page.locator(".thumb").first()).toBeVisible({ timeout: 20_000 });
}
const undoSteps = (page: Page) => page.evaluate(() => (window as any).__sbTest.history().undo as number);
const change = (page: Page, label: string, ops: object[]) => page.evaluate(([l, o]) => (window as any).__sbTest.change(l, o), [label, ops] as const);
async function exported(page: Page, click: () => Promise<unknown>): Promise<string[]> {
  await page.evaluate(() => { (window as any).__sbTest.lastExport.files = []; });
  await click();
  let files: string[] = [];
  await expect.poll(async () => (files = await page.evaluate(() => [...(window as any).__sbTest.lastExport.files] as string[])).length, { timeout: 60_000 }).toBeGreaterThan(0);
  await expect(page.locator("#exportBtn")).toHaveText("Export PDF");
  return files;
}
const fromMenu = (page: Page, x: string) => exported(page, async () => { await page.click("#exportMenuBtn"); await page.click(`[data-x="${x}"]`); });
const read = (f: string) => fs.readFileSync(path.join(root(), "export", f));

test.describe.serial("a chart's targets (B52)", () => {
  test("B52-01: a reference line from a cell, a gap arrow and change pills – one undo step each, format 7, drawn in the PDF and as a native series and shapes in PowerPoint", async ({ page }) => {
    await openPlain(page, ANNA);
    await saved(page);
    await pollFile(() => (doc().preset.slides as any[]).length, { timeout: 20_000 }).toBeGreaterThan(0);
    // a content slide to put the chart on (the wizard's deck may have none)
    if (!(doc().preset.slides as any[]).some(s => s.type === "content")) {
      const u0 = await undoSteps(page);
      await change(page, "New slide", [{ op: "slide.add", slide: { id: "b52s", type: "content", title: "Targets", tables: [] }, after: null }]);
      await expect.poll(() => undoSteps(page)).toBe(u0 + 1);
      await pollFile(() => (doc().preset.slides as any[]).some(s => s.type === "content"), { timeout: 10_000 }).toBe(true);
    }
    const slides = doc().preset.slides as any[], k = slides.findIndex(s => s.type === "content"), S = slides[k];
    await page.locator(`.thumb[data-i="${k}"]`).click(); await page.locator(`.thumb.on[data-i="${k}"]`).waitFor();
    const D = (r: string) => ({ sheet: "SLIDE_1", range: r }), T = (r: string) => ({ sheet: "Targets", range: r });
    const chart = { kind: "chart", type: "line", title: "Weekly volume", values: D("D4:D7"), labels: D("C4:C7"), legendAt: "none", box: { x: 820, y: 200, w: 700, h: 500 },
      sers: { s1: { n: 1, name: "Volume", vals: [D("D4:D7")], marker: { shape: "circle", size: 8 } } } };
    let u = await undoSteps(page);
    await change(page, "Insert chart", [{ op: "item.patch", slide: S.id, id: "b52c", patch: chart }]);
    await expect.poll(() => undoSteps(page)).toBe(u + 1);
    const item = () => (doc().preset.slides as any[]).find(s => s.id === S.id).items?.b52c;
    await pollFile(() => item()?.type, { timeout: 10_000 }).toBe("line");
    // (the slide's pictures before the targets – the wallpaper, the logo: the targets add none)
    await saved(page);
    const picsOf = (b: Buffer) => { const z0 = unzipSync(new Uint8Array(b)); return Object.keys(z0).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map(n => strFromU8(z0[n])).filter(x => x.includes("<c:chart ")).map(x => (x.match(/<p:pic>/g) || []).length); };
    const pics0 = picsOf(read((await fromMenu(page, "pptx"))[0]));
    expect(pics0.length).toBe(1);
    await page.locator('.itembox[data-kind=chart]').first().click({ position: { x: 6, y: 6 } });
    await expect(page.locator("#chartTargets")).toBeVisible({ timeout: 10_000 });
    await page.locator("#chartTargets > summary").click();
    await expect(page.locator("#chartAddGap")).toBeDisabled();

    // + Reference line from a cell…: the sheet view, ONE cell (Targets!B3), one step
    u = await undoSteps(page);
    await page.click("#chartAddRef");
    await expect(page.locator("#pickCells")).toContainText("Chart: add a reference line");
    await page.selectOption("#pkSheet", "Targets");
    await page.locator('#pkRange td[data-r="3"][data-c="2"]').click();
    await expect(page.locator("#pkSel")).toHaveText("B3");
    await page.click("#pkUse");
    await expect(page.locator("#pickCells")).toHaveCount(0);
    await expect.poll(() => undoSteps(page)).toBe(u + 1);
    const marks = () => Object.entries(item().marks || {}) as [string, any][];
    await pollFile(() => marks().map(([, m]) => [m.kind, m.value]), { timeout: 10_000 }).toEqual([["ref", T("B3")]]);
    const rid = marks()[0][0];
    // + Gap arrow, + Change pills: one step each
    await page.click("#chartAddGap");
    await expect.poll(() => undoSteps(page)).toBe(u + 2);
    await page.click("#chartAddChange");
    await expect.poll(() => undoSteps(page)).toBe(u + 3);
    await pollFile(() => marks().map(([, m]) => m.kind).sort(), { timeout: 10_000 }).toEqual(["change", "gap", "ref"]);
    expect(marks().find(([, m]) => m.kind === "gap")![1]).toMatchObject({ a: { s: "s1", i: -1 }, ref: rid, caption: "gap to target" });
    const pid = marks().find(([, m]) => m.kind === "change")![0];
    // the pills off (kept) and on again: one step each
    await page.locator(`#chartTargets [data-chg="${pid}"] [data-a="on"]`).uncheck();
    await pollFile(() => item().marks[pid].off, { timeout: 10_000 }).toBe(true);
    await expect.poll(() => undoSteps(page)).toBe(u + 4);
    await page.locator(`#chartTargets [data-chg="${pid}"] [data-a="on"]`).check();
    await pollFile(() => item().marks[pid].off ?? null, { timeout: 10_000 }).toBeNull();
    await expect.poll(() => undoSteps(page)).toBe(u + 5);
    // the deck holds marks 4.9 does not draw: format 7, its marker
    await pollFile(() => fs.existsSync(path.join(deckDir(BOOK)!, "incident-format-7.json")), { timeout: 30_000 }).toBe(true);
    await pollFile(() => JSON.parse(fs.readFileSync(path.join(deckDir(BOOK)!, "snapshot.json"), "utf8")).format, { timeout: 30_000 }).toBe(7);
    await saved(page);

    // the PDF: the gap's caption and difference (11,442 − 11,790), the line's value label, the first pill's change
    const runs = pdfPageRuns(read((await exported(page, () => page.click("#exportBtn")))[0]))[k].map(r => r.text);
    expect(runs, JSON.stringify(runs)).toContain("gap to target");
    expect(runs.some(t => /^\u2212348$/.test(t)), JSON.stringify(runs)).toBe(true);
    expect(runs.some(t => /^11[.,]790$/.test(t)), JSON.stringify(runs)).toBe(true);
    expect(runs.some(t => /^\u2212165 \(\u22121[.,]4%\)$/.test(t)), JSON.stringify(runs)).toBe(true);
    // the PowerPoint file: the native chart's second line group is the reference line (its cell's value in every row, the
    // others "=" the first), the gap arrow a line shape with a native end, the pills rounded rectangles; no picture
    const z = unzipSync(new Uint8Array(read((await fromMenu(page, "pptx")).slice(-1)[0])));
    const charts = Object.keys(z).filter(n => /^ppt\/charts\/chart\d+\.xml$/.test(n)).map(n => strFromU8(z[n]));
    const ours = charts.find(x => x.includes("Volume"))!;
    expect([...ours.matchAll(/<c:lineChart>/g)].length).toBe(2);
    expect(ours).toContain('<c:crossBetween val="midCat"/>');
    const book = Object.keys(z).find(n => /^ppt\/embeddings\/.*\.xlsx$/.test(n) && strFromU8(unzipSync(z[n])["xl/worksheets/sheet1.xml"]).includes("Volume"))!;
    expect(strFromU8(unzipSync(z[book])["xl/worksheets/sheet1.xml"])).toMatch(/<f>\$C\$2<\/f><v>11790<\/v>/);
    const sx = Object.keys(z).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map(n => strFromU8(z[n])).find(x => x.includes("gap to target"))!;
    expect(sx).toContain('prst="roundRect"'); expect(sx).toMatch(/<a:tailEnd type="triangle"/);
    expect(sx).not.toContain("<p:cxnSp");
    expect((sx.match(/<p:pic>/g) || []).length).toBe(pics0[0]);                  // no picture of the chart or its extras

    // undo: the pills' on / off, then the pills, the gap arrow, the line – one step each
    for (let s = 0; s < 5; s++) await page.click("#undoBtn");
    await pollFile(() => marks().length, { timeout: 10_000 }).toBe(0);
    await page.click("#undoBtn");
    await pollFile(() => item() ?? null, { timeout: 10_000 }).toBeNull();
    await saved(page);
  });
  test("no page errors", async () => { expect(errors).toEqual([]); });
});
