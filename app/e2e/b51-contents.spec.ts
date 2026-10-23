/* End-to-end: the contents slide's title and list moved in a free layout (B51, product owner 2026-10-22) on the helper
   of app.spec.ts (anna :8951; runs after it, as open.spec.ts does – alone, the wizard makes the deck):
   B51-01 – in Excel (the Intesa Sanpaolo template), Free layout on the contents slide, its list and its title dragged
            by their grips and the list resized by its corner: one undo step each, saved per slide and design; the PDF
            draws them where they were dropped (the title's and an entry's text inside their saved boxes), the
            PowerPoint file has the title as its placeholder and the entry as a text box at those places (EMU); undo
            puts them back. */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { pdfPageRuns } from "./pdftext";
import { fold, type DeckRecord } from "../../core/src/model/fold";

const ANNA = "http://127.0.0.1:8951/";
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
/** the report.xlsx deck as everybody reads it: the snapshot and the records past its frontier, folded */
function doc(): any {
  const d = deckDir("report.xlsx")!;
  const snap = JSON.parse(fs.readFileSync(path.join(d, "snapshot.json"), "utf8"));
  let names: string[] = []; try { names = fs.readdirSync(path.join(d, "j")); } catch { /* no journal yet */ }
  return fold(snap, names.flatMap(n => frames(fs.readFileSync(path.join(d, "j", n)), snap.frontier[n.replace(/\.log$/, "")] || 0))).doc;
}
const pollFile = <T>(read: () => T, opts?: { timeout?: number }) =>
  expect.poll(() => { try { return read(); } catch (e) { return "not saved yet: " + (e as Error).message; } }, opts);
const saved = (page: Page) => expect(page.locator("#sbSave")).toHaveText("✓ Saved", { timeout: 10_000 });
const errors: string[] = [];

async function openReport(page: Page, url: string) {
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(url);
  await page.locator("#openBtn").waitFor();
  await expect(page.locator("#srv")).toHaveCount(0);
  let last: string | null = null;
  try { last = JSON.parse(fs.readFileSync(path.join(data(), "users", "anna.json"), "utf8")).lastFile || null; } catch { /* first start */ }
  if (last) await expect(page.locator("#fileName")).toHaveText(new RegExp("^" + last.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " · \\d+ slides?"), { timeout: 30_000 });
  await page.click("#openBtn");
  await page.click('[data-f="report.xlsx"]');
  const wizard = page.locator(".wiz"), cont = page.locator('[data-a="continue"]');
  await expect(wizard.or(cont)).toBeVisible({ timeout: 20_000 });
  if (await cont.isVisible()) await cont.click();
  else { await page.click('[data-a="next"]:has-text("Tables")'); await page.click('[data-a="next"]:has-text("Slides")'); await page.click('[data-a="finish"]'); }
  await expect(page.locator("#fileName")).toHaveText(/^report\.xlsx · \d+ slides?/, { timeout: 30_000 });
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
/** a PowerPoint slide's text shapes: placeholder, box in slide px (EMU / 7 620), text */
function pptxShapes(b: Buffer, slide: number) {
  const z = unzipSync(new Uint8Array(b)), xml = strFromU8(z[`ppt/slides/slide${slide + 1}.xml`]);
  return [...xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)].map(m => {
    const off = /<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"/.exec(m[1]);
    return { ph: /<p:ph type="(\w+)"/.exec(m[1])?.[1] ?? null, x: +off![1] / 7620, y: +off![2] / 7620, w: +off![3] / 7620, h: +off![4] / 7620,
      ex: +off![1], ey: +off![2], text: [...m[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(t => t[1]).join("") };
  });
}
type B = { x: number; y: number; w: number; h: number; scale?: number };
const inBox = (p: { x: number; y: number }, b: B, e = 2) => p.x >= b.x - e && p.x <= b.x + b.w + e && p.y >= b.y - e && p.y <= b.y + b.h + e;
/** a drag of an element's centre by (dx, dy) screen px, in steps */
async function drag(page: Page, sel: string, dx: number, dy: number) {
  await page.locator(".stagewrap").hover();
  const b = (await page.locator(sel).boundingBox())!, x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let k = 1; k <= 6; k++) await page.mouse.move(x + dx * k / 6, y + dy * k / 6);
  await page.mouse.up();
}

test.describe.serial("the contents slide's parts in a free layout (B51)", () => {
  test("B51-01: the contents title and list dragged and resized in Excel: one undo step each, saved, drawn there in the PDF and the PowerPoint file", async ({ page }) => {
    await openReport(page, ANNA);
    await saved(page);
    await pollFile(() => (doc().preset.slides as any[]).length, { timeout: 20_000 }).toBeGreaterThan(0);
    // a contents slide (the wizard's deck may have none) and the template's design
    if (!(doc().preset.slides as any[]).some(s => s.type === "index")) {
      const u = await undoSteps(page);
      await change(page, "New slide", [{ op: "slide.add", slide: { id: "b51ix", type: "index", title: "Contents", subtitle: null, tables: [] }, after: null }]);
      await expect.poll(() => undoSteps(page)).toBe(u + 1);
    }
    if (doc().style?.design !== "excel") { await change(page, "Design", [{ op: "style.patch", patch: { design: "excel" } }]); await pollFile(() => doc().style.design, { timeout: 10_000 }).toBe("excel"); }
    const slides = doc().preset.slides as any[], k = slides.findIndex(s => s.type === "index"), S = slides[k];
    const entryOf = () => (doc().preset.slides as any[]).find(s => s.id === S.id)?.free?.excel ?? null;
    await page.locator(`.thumb[data-i="${k}"]`).click(); await page.locator(`.thumb.on[data-i="${k}"]`).waitFor();
    await expect(page.locator("#freeLayout")).toBeEnabled();
    const u0 = await undoSteps(page);
    await page.click("#freeLayout");
    await pollFile(() => entryOf()?.on, { timeout: 10_000 }).toBe(true);
    const toc = '#stage .hbox.cpart[data-part="toc"]', title = '#stage .hbox.cpart[data-part="title"]';
    await expect(page.locator(toc)).toHaveCount(1); await expect(page.locator(title)).toHaveCount(1);
    const scale = await page.evaluate(() => { const r = document.querySelector(".stagewrap")!.getBoundingClientRect(); return r.width / 1600; });
    const box0 = async (sel: string) => page.locator(sel).evaluate(el => { const s = (el as HTMLElement).style; return { x: parseFloat(s.left), y: parseFloat(s.top), w: parseFloat(s.width), h: parseFloat(s.height) }; });
    // (4.14 CI: the drag waits for the switch to be saved – its record goes through the deck's raise to format 6 – and for
    // the list's box to stand still: a drag that starts while the stage draws the free layout again can miss the handle)
    await saved(page);
    await expect.poll(async () => { const a = JSON.stringify(await box0(toc)); await page.waitForTimeout(150); return a === JSON.stringify(await box0(toc)); }, { timeout: 10_000 }).toBe(true);
    const L0 = await box0(toc), T0 = await box0(title);

    // the list's corner: smaller (it stays where it is); then the list down and to the right; the title to the bottom right
    await drag(page, toc + " .size", -L0.w * scale * .2, -L0.h * scale * .2);
    await pollFile(() => entryOf()?.items?.["c:toc"]?.scale ?? 1, { timeout: 10_000 }).toBeLessThan(.95);
    await expect.poll(() => undoSteps(page)).toBe(u0 + 2);
    await expect.poll(() => box0(toc).then(b => Math.round(b.w))).toBe(Math.round(entryOf().items["c:toc"].w));
    await drag(page, toc + " .grip", 160, 30);   // (not to the slide's foot)
    await pollFile(() => Math.round(entryOf()?.items?.["c:toc"]?.x ?? -1), { timeout: 10_000 }).toBeGreaterThan(Math.round(L0.x + 60));
    await expect.poll(() => undoSteps(page)).toBe(u0 + 3);
    await drag(page, title + " .grip", 600 * scale, 640 * scale);
    await pollFile(() => entryOf()?.items?.["c:title"]?.y ?? null, { timeout: 10_000 }).not.toBeNull();
    await expect.poll(() => undoSteps(page)).toBe(u0 + 4);
    const L: B = entryOf().items["c:toc"], T: B = entryOf().items["c:title"];
    expect(L.x).toBeGreaterThan(L0.x + 60); expect(L.y).toBeGreaterThan(L0.y + 15);
    expect(T.x).toBeGreaterThan(T0.x + 300); expect(T.y).toBeGreaterThan(T0.y + 300);
    expect(T.scale).toBe(1);
    // the stage draws them there: the handles come back from the drawn slide
    await expect.poll(() => box0(toc).then(b => [Math.round(b.x), Math.round(b.y), Math.round(b.w)])).toEqual([Math.round(L.x), Math.round(L.y), Math.round(L.w)]);
    await expect.poll(() => box0(title).then(b => [Math.round(b.x), Math.round(b.y)])).toEqual([Math.round(T.x), Math.round(T.y)]);
    await saved(page);

    // the PDF: the title's text and the first entry's inside their saved boxes
    const runs = pdfPageRuns(read((await exported(page, () => page.click("#exportBtn")))[0]))[k];
    const tRun = runs.find(r => S.title ? r.text.startsWith((S.title as string).slice(0, 6)) : /Contents|INDICE/i.test(r.text))!;
    expect(tRun, JSON.stringify(runs.slice(0, 8))).toBeTruthy();
    expect(inBox(tRun, T), JSON.stringify({ tRun, T })).toBe(true);
    // (the first entry: the first text after the first page number the list shows; every row's text inside the box)
    const p1 = runs.findIndex(r => /^\d+$/.test(r.text) && r !== tRun), eRun = runs[p1 + 1];
    expect(eRun && eRun.text.length > 3, JSON.stringify({ runs: runs.slice(0, 20), L })).toBe(true);
    for (const r of runs) if (r !== tRun && r.y > 100 && r.y < 800) expect(inBox(r, L), JSON.stringify({ r, L })).toBe(true);

    // the PowerPoint file: the title a placeholder at the title's box, the entry's text box in the list's box; the same
    // places as the PDF (the run's origin inside the shape)
    const sh = pptxShapes(read((await fromMenu(page, "pptx"))[0]), k);
    const tph = sh.find(s => s.ph === "title")!;
    expect(tph.text).toContain(tRun.text.slice(0, 6));
    expect(Math.abs(tph.x - T.x)).toBeLessThanOrEqual(8); expect(Math.abs(tph.y - T.y)).toBeLessThanOrEqual(8);
    expect(tRun.x).toBeGreaterThanOrEqual(tph.x - 1); expect(tRun.x).toBeLessThanOrEqual(tph.x + tph.w);
    expect(tRun.y).toBeGreaterThanOrEqual(tph.y); expect(tRun.y).toBeLessThanOrEqual(tph.y + tph.h + 1);
    const ebox = sh.find(s => !s.ph && s.text.startsWith(eRun!.text.slice(0, 8)))!;
    expect(ebox, JSON.stringify(sh.map(s => s.text))).toBeTruthy();
    expect(inBox(ebox, L, 8)).toBe(true);
    expect(Math.abs(eRun!.x - ebox.x)).toBeLessThanOrEqual(8);

    // undo: the title, then the list's move, then its corner, each one step; the free layout off again
    await page.click("#undoBtn"); await pollFile(() => entryOf()?.items?.["c:title"] ?? null, { timeout: 10_000 }).toBeNull();
    await page.click("#undoBtn"); await pollFile(() => Math.round(entryOf()?.items?.["c:toc"]?.x ?? -1), { timeout: 10_000 }).toBe(Math.round(L0.x));
    await page.click("#undoBtn"); await pollFile(() => entryOf()?.items?.["c:toc"] ?? null, { timeout: 10_000 }).toBeNull();
    await page.click("#undoBtn"); await pollFile(() => entryOf()?.on ?? false, { timeout: 10_000 }).toBe(false);
    await expect(page.locator(toc)).toHaveCount(0);
    // the deck held a box 4.8.0 does not draw: format 6 (AUDIT-3 COMPAT-1)
    await pollFile(() => JSON.parse(fs.readFileSync(path.join(deckDir("report.xlsx")!, "snapshot.json"), "utf8")).format, { timeout: 15_000 }).toBe(6);
    await saved(page);
  });
  test("no page errors", async () => { expect(errors).toEqual([]); });
});
