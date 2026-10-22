/* End-to-end: hidden rows and columns per slide (S16.1, B36; docs/next/09 §3.6) on the two helpers of app.spec.ts
   (anna :8951, bob :8952, one shared folder; runs after it, as open.spec.ts does):
   HR-01 – Hide ▾ hides the selected rows / columns of a table on one slide, the same table on another slide keeps
           them; the stage's double mark brings them back; one undo step each; two people hiding two rows of one table
           at once both win; every export (PDF, PNG, PowerPoint: a real a:tbl of the visible rows) closes them up;
   HR-02 – what reads the table follows: its size on the slide, a chart on the slide that reads it. */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { pdfPageTexts } from "./pdftext";
import { fold, type DeckRecord } from "../../core/src/model/fold";

const ANNA = "http://127.0.0.1:8951/", BOB = "http://127.0.0.1:8952/";
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
  try { last = JSON.parse(fs.readFileSync(path.join(data(), "users", (url === ANNA ? "anna" : "bob") + ".json"), "utf8")).lastFile || null; } catch { /* first start */ }
  if (last) await expect(page.locator("#fileName")).toHaveText(new RegExp("^" + last.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " · \\d+ slides?"), { timeout: 30_000 });
  await page.click("#openBtn");
  await page.click('[data-f="report.xlsx"]');
  // the saved deck (app.spec made it), else the wizard straight through
  const wizard = page.locator(".wiz"), cont = page.locator('[data-a="continue"]');
  await expect(wizard.or(cont)).toBeVisible({ timeout: 20_000 });
  if (await cont.isVisible()) await cont.click();
  else { await page.click('[data-a="next"]:has-text("Tables")'); await page.click('[data-a="next"]:has-text("Slides")'); await page.click('[data-a="finish"]'); }
  await expect(page.locator("#fileName")).toHaveText(/^report\.xlsx · \d+ slides?/, { timeout: 30_000 });
  await expect(page.locator(".thumb").first()).toBeVisible({ timeout: 20_000 });
}
const undoSteps = (page: Page) => page.evaluate(() => (window as any).__sbTest.history().undo as number);
const change = (page: Page, label: string, ops: object[]) => page.evaluate(([l, o]) => (window as any).__sbTest.change(l, o), [label, ops] as const);
const cell = (page: Page, text: string) => page.locator("#stage .slide .t", { hasText: new RegExp("^" + text + "$") });
async function select(page: Page, from: string, to?: string) {
  await cell(page, from).first().waitFor();
  const a = (await cell(page, from).first().boundingBox())!;
  await page.mouse.click(a.x + 8, a.y + a.height / 2);
  if (to) { const b = (await cell(page, to).first().boundingBox())!; await page.keyboard.down("Shift"); await page.mouse.click(b.x + 8, b.y + b.height / 2); await page.keyboard.up("Shift"); }
}
async function hideMenu(page: Page, id: "hideRows" | "hideCols" | "unhideAll") { await page.click("#hideBtn"); await page.click("#" + id); }
async function exported(page: Page, click: () => Promise<unknown>): Promise<string[]> {
  const before = await page.evaluate(() => { const t = (window as any).__sbTest; t.lastExport.files = []; return t.toastNow()?.id ?? 0; });
  await click();
  let files: string[] = [];
  await expect.poll(async () => (files = await page.evaluate(() => [...(window as any).__sbTest.lastExport.files] as string[])).length, { timeout: 60_000 }).toBeGreaterThan(0);
  void before;
  await expect(page.locator("#exportBtn")).toHaveText("Export PDF");
  return files;
}
const fromMenu = (page: Page, x: string) => exported(page, async () => { await page.click("#exportMenuBtn"); await page.click(`[data-x="${x}"]`); });
const read = (f: string) => fs.readFileSync(path.join(root(), "export", f));
/** a PowerPoint file's tables per slide: rows, columns and the texts of the cells */
function pptxTables(b: Buffer) {
  const z = unzipSync(new Uint8Array(b));
  return Object.keys(z).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => +a.match(/\d+/)![0] - +b.match(/\d+/)![0]).map(n =>
    strFromU8(z[n]).split("<p:graphicFrame>").slice(1).filter(g => g.includes("<a:tbl>")).map(g => ({
      rows: (g.match(/<a:tr /g) || []).length, cols: (g.match(/<a:gridCol /g) || []).length, text: [...g.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1]).join(" ") })));
}

test.describe.serial("hidden rows and columns per slide (S16.1)", () => {
  test("HR-01: Hide rows / columns on one slide, the other slide keeps them; the double mark unhides; one undo step each; two people at once; every export closes them up", async ({ page, browser }) => {
    await openReport(page, ANNA);
    const slides = doc().preset.slides as any[], k = slides.findIndex(s => s.type === "content" && s.tables.length === 1);
    const S = slides[k], tid = S.tables[0], hiddenOf = (id: string) => (doc().preset.slides as any[]).find(s => s.id === id)?.hidden ?? null;
    // the same table on a second slide (New slide + Add table, as the page sends them)
    const u0 = await undoSteps(page);
    await change(page, "New slide", [{ op: "slide.add", slide: { id: "hr01", type: "content", title: "Every bank", subtitle: null, tables: [] }, after: S.id }]);
    await change(page, "Add table", [{ op: "table.add", table: (doc().preset.tables as any[]).find(t => t.id === tid), slide: "hr01" }]);
    await expect.poll(() => undoSteps(page)).toBe(u0 + 2);
    await page.locator(`.thumb[data-i="${k}"]`).click(); await page.locator(`.thumb.on[data-i="${k}"]`).waitFor();
    await expect(page.locator("#hideBtn")).toBeDisabled();
    // Hide rows: Beta and Gamma, one step
    await select(page, "Beta", "Gamma");
    await hideMenu(page, "hideRows");
    await pollFile(() => Object.keys(hiddenOf(S.id) || {}).sort(), { timeout: 10_000 }).toEqual([tid + ":r7", tid + ":r8"]);
    await expect(cell(page, "Beta")).toHaveCount(0);
    await expect(cell(page, "Alpha")).toHaveCount(1);
    await expect(page.locator(".hidrc.hrow")).toHaveCount(1);
    await expect(page.locator(".hidrcnote")).toHaveText("Σ incl. hidden rows");
    await expect(page.locator("#hideBtn")).toContainText("Hide (2)");
    // the other slide keeps them
    await page.locator(`.thumb[data-i="${k + 1}"]`).click(); await page.locator(`.thumb.on[data-i="${k + 1}"]`).waitFor();
    await expect(cell(page, "Beta")).toHaveCount(1);
    await expect(page.locator(".hidrc")).toHaveCount(0);
    // Hide columns there (Deposits), its own entry
    await select(page, "Deposits");
    await hideMenu(page, "hideCols");
    await pollFile(() => hiddenOf("hr01"), { timeout: 10_000 }).toEqual({ [tid + ":cF"]: true });
    await expect(cell(page, "Deposits")).toHaveCount(0);
    await expect(page.locator(".hidrc.hcol")).toHaveCount(1);
    await expect.poll(() => undoSteps(page)).toBe(u0 + 4);
    // bob, at the same time, hides another row of the same table on the first slide: both rows end up hidden
    const bob = await browser.newPage();
    await openReport(bob, BOB);
    await bob.locator(`.thumb[data-i="${k}"]`).click(); await bob.locator(`.thumb.on[data-i="${k}"]`).waitFor();
    await select(bob, "Zeta");
    await Promise.all([hideMenu(bob, "hideRows"), (async () => { await page.locator(`.thumb.on[data-i="${k}"]`).waitFor(); await select(page, "Epsilon"); await hideMenu(page, "hideRows"); })()]);
    await pollFile(() => Object.keys(hiddenOf(S.id) || {}).sort(), { timeout: 20_000 }).toEqual([tid + ":r10", tid + ":r11", tid + ":r7", tid + ":r8"]);
    await expect(cell(page, "Zeta")).toHaveCount(0, { timeout: 15_000 });
    await expect(cell(bob, "Epsilon")).toHaveCount(0, { timeout: 15_000 });
    await saved(bob); await bob.close();
    await saved(page);
    // every export: the first slide without the rows, the second with them (and without Deposits)
    const pdf = pdfPageTexts(read((await exported(page, () => page.click("#exportBtn")))[0]));
    expect(pdf[k]).toContain("Alpha"); expect(pdf[k]).not.toContain("Beta"); expect(pdf[k]).not.toContain("Zeta");
    expect(pdf[k + 1]).toContain("Beta"); expect(pdf[k + 1]).not.toContain("Deposits");
    expect(await fromMenu(page, "png-all")).toHaveLength(pdf.length);
    const t = pptxTables(read((await fromMenu(page, "pptx"))[0]));
    expect(t[k]).toHaveLength(1); expect(t[k + 1]).toHaveLength(1);
    expect(t[k][0].rows).toBe(t[k + 1][0].rows - 4);
    expect(t[k][0].cols).toBe(t[k + 1][0].cols + 1);
    expect(t[k][0].text).not.toMatch(/\bBeta\b|\bZeta\b/);
    expect(t[k + 1][0].text).toMatch(/\bBeta\b/);
    // the double mark brings rows back (one step); Unhide all the rest (one step)
    await page.locator(`.thumb[data-i="${k}"]`).click(); await page.locator(`.thumb.on[data-i="${k}"]`).waitFor();
    const u1 = await undoSteps(page);
    await page.locator(".hidrc.hrow").first().click();
    await expect.poll(() => undoSteps(page)).toBe(u1 + 1);
    await pollFile(() => Object.keys(hiddenOf(S.id) || {}).length, { timeout: 10_000 }).toBe(2);
    await hideMenu(page, "unhideAll");
    await pollFile(() => hiddenOf(S.id), { timeout: 10_000 }).toBeNull();
    await expect(cell(page, "Beta")).toHaveCount(1);
    await expect(page.locator(".hidrc")).toHaveCount(0);
    await page.click("#undoBtn");
    await pollFile(() => Object.keys(hiddenOf(S.id) || {}).length, { timeout: 10_000 }).toBe(2);
    await page.click("#redoBtn");
    await pollFile(() => hiddenOf(S.id), { timeout: 10_000 }).toBeNull();
    // the deck holds a key 4.8.0 does not know: format 6 (AUDIT-3 COMPAT-1), its marker incident-format-6.json
    await pollFile(() => JSON.parse(fs.readFileSync(path.join(deckDir("report.xlsx")!, "snapshot.json"), "utf8")).format, { timeout: 15_000 }).toBe(6);
    expect(fs.existsSync(path.join(deckDir("report.xlsx")!, "incident-format-6.json"))).toBe(true);
    await saved(page);
  });

  test("HR-02: the table's size and a chart on the slide follow the hidden rows; the chart on another slide keeps them", async ({ page }) => {
    await openReport(page, ANNA);
    const slides = doc().preset.slides as any[], k = slides.findIndex(s => s.type === "content" && s.tables.length === 1);
    const S = slides[k], tid = S.tables[0], k2 = slides.findIndex(s => s.id === "hr01");
    const pie = (id: string) => ({ op: "item.patch", slide: id, id: "hrpie", patch: { kind: "chart", type: "pie", values: { table: tid, range: "D6:D11" }, show: ["label"], legend: "right", box: { x: 980, y: 250, w: 560, h: 420 } } });
    await change(page, "Chart", [pie(S.id)]);
    if (k2 >= 0) await change(page, "Chart", [pie("hr01")]);
    await page.locator(`.thumb[data-i="${k}"]`).click(); await page.locator(`.thumb.on[data-i="${k}"]`).waitFor();
    const h0 = (await page.locator('#stage .hits[data-t="0"]').boundingBox())!.height;
    const legend = (p: Page) => p.evaluate(() => JSON.stringify(((window as any).__sbTest.stage()?.layers || []).filter((l: any) => l.item === "hrpie")));
    await expect.poll(() => legend(page)).toContain("Beta");
    await select(page, "Beta");
    await hideMenu(page, "hideRows");
    await pollFile(() => (doc().preset.slides as any[]).find(s => s.id === S.id).hidden, { timeout: 10_000 }).toEqual({ [tid + ":r7"]: true });
    await expect.poll(async () => (await page.locator('#stage .hits[data-t="0"]').boundingBox())!.height).toBeLessThan(h0);
    await expect.poll(() => legend(page)).not.toContain("Beta");               // the chart's slices and legend
    if (k2 >= 0) {
      await page.locator(`.thumb[data-i="${k2}"]`).click(); await page.locator(`.thumb.on[data-i="${k2}"]`).waitFor();
      await expect.poll(() => legend(page)).toContain("Beta");                 // Q7: another slide's chart keeps it
    }
    for (let i = 0; i < (k2 >= 0 ? 3 : 2); i++) await page.click("#undoBtn");
    await saved(page);
  });

  test("no page errors", async () => { expect(errors).toEqual([]); });
});
