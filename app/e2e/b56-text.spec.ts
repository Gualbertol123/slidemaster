/* End-to-end: B56 (4.14) on the helper of app.spec.ts (anna :8951), the owner's slide of B54 rebuilt from its own copy of
   the workbook (tests/fixtures/B56.xlsx = B54.xlsx: no other spec uses its deck) in the Excel design:
   B56-01 – the "10" centred on all four KPI cards through the KPI panel's Layout (one step each); the chart's title and
            axis labels in another font and size through the chart panel's Text controls; the stats row centred; the deck
            saved (texts / lay, format 10); the stage, the PDF and the PowerPoint file reflect both: the value centred in
            its section (the stage's display list; PowerPoint: a text box of the section, algn="ctr"), the axis labels'
            font and size (PowerPoint: the native chart's c:txPr; the PDF: the new font embedded). B56_SHOTS=<folder>
            saves b56-before.png, b56-after.png and b56-pptx/b56-slide.pptx for review. */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { fold, type DeckRecord } from "../../core/src/model/fold";
import { HEADLINE, kpiCard, volumeCard } from "../../core/tests/b54-deck";

const ANNA = "http://127.0.0.1:8951/";
const BOOK = "B56.xlsx";
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
    for (const n of ["KPI", "Volumes"]) { const c = page.getByRole("checkbox", { name: new RegExp("^" + n + " ") }); if (!await c.isChecked()) await c.check(); }
    await page.click('[data-a="next"]:has-text("Tables")'); await page.click('[data-a="next"]:has-text("Slides")');
    await page.locator(".wiz").getByRole("button", { name: "+ New slide" }).click(); await page.click('[data-a="finish"]'); }
  await expect(page.locator("#fileName")).toHaveText(/^B56\.xlsx · \d+ slides?/, { timeout: 30_000 });
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
/** the stage's text nodes of one item's layer */
const itemTexts = (page: Page, id: string) => page.evaluate(async (item) => {
  const s = await (window as any).__sbTest.stageNodes(), out: any[] = [];
  const walk = (nodes: any[], dx: number) => { for (const n of nodes || []) { if (n.t === "group") walk(n.children, dx + (n.transform ? n.transform[4] : 0)); else if (n.t === "text") out.push({ src: n.src, x: n.x + dx, w: n.w, size: n.size, css: n.css }); } };
  for (const L of s?.layers || []) if (L.item === item) walk(L.nodes || [], 0);
  return out;
}, id);
/** a step in one undo step */
async function oneStep(page: Page, fn: () => Promise<unknown>) { const u = await undoSteps(page); await fn(); await expect.poll(() => undoSteps(page)).toBe(u + 1); }
/** the base fonts a PDF embeds */
const pdfFonts = (pdf: Buffer) => [...new Set([...pdf.toString("latin1").matchAll(/\/BaseFont\s*\/([A-Za-z0-9+\-_,]+)/g)].map(m => m[1].replace(/^[A-Z]{6}\+/, "")))];

test.describe.serial("Text, sizing and positioning (B56)", () => {
  test("B56-01: the 10 centred on the KPI cards and the chart's axis font changed in the panels; saved; the PDF and the PowerPoint file reflect both", async ({ page }) => {
    test.setTimeout(300_000);
    await openPlain(page, ANNA);
    await saved(page);
    const slides0 = () => ((doc().preset?.slides || []) as any[]);
    await change(page, "Design", [{ op: "style.patch", patch: { design: "excel" } }]);
    // the owner's slide: B54's fixture rebuilt (four KPI cards, two chart cards) on a slide of its own, first
    const w = 350, gap = 26, x0 = 61, S = "b56s";
    await change(page, "Owner's slide", [{ op: "slide.add", slide: { id: S, type: "content", title: HEADLINE, tables: [] }, after: null },
      ...[2, 3, 4, 5].map((r, j) => ({ op: "item.patch", slide: S, id: "k" + (r - 1), patch: kpiCard(r, { x: x0 + j * (w + gap), y: 180, w, h: 130 }) })),
      { op: "item.patch", slide: S, id: "cl", patch: volumeCard("Loans", "D2", { x: x0, y: 340, w: 725, h: 520 }, { text: "Actual loans" }) },
      { op: "item.patch", slide: S, id: "cd", patch: volumeCard("Deposits", "D6", { x: x0 + 725 + gap, y: 340, w: 725, h: 520 }, { text: "Illustrative", color: "#D93025" }) }]);
    await pollFile(() => slides0().some(s => s.id === S), { timeout: 20_000 }).toBe(true);
    const k = slides0().findIndex(s => s.id === S);
    await page.locator(`.thumb[data-i="${k}"]`).click(); await page.locator(`.thumb.on[data-i="${k}"]`).waitFor();
    await saved(page);
    await expect.poll(async () => (await itemTexts(page, "k1")).some(t => t.src === "10"), { timeout: 30_000 }).toBe(true);
    const shots = process.env.B56_SHOTS;
    const png = async (name: string) => {
      await page.waitForTimeout(1200);
      const b = read((await fromMenu(page, "png-current"))[0]);
      expect(b.subarray(1, 4).toString("latin1")).toBe("PNG");
      if (shots) { fs.mkdirSync(shots, { recursive: true }); fs.writeFileSync(path.join(shots, name), b); }
    };
    await png("b56-before.png");
    const pdf0 = read((await exported(page, () => page.click("#exportBtn")))[0]);
    const valueX = async (id: string) => { const T = await itemTexts(page, id), v = T.find(t => t.src === "10" || t.src === "−10")!; return v.x + v.w / 2; };
    const before = await valueX("k1");

    // the KPI panel: centre the value on each card (Layout › Value ↔) – one step each
    for (const id of ["k1", "k2", "k3", "k4"]) {
      await page.locator(`.itembox[data-item="${id}"]`).click({ position: { x: 300, y: 110 } });
      await expect(page.locator("#kpiPanel")).toHaveAttribute("data-item", id);
      const lay = page.locator("#kpiLayout");
      if (!await lay.getAttribute("open")) await lay.locator("> summary").click();
      await oneStep(page, () => page.click('#kpiValueAlign [data-v="center"]'));
    }
    await pollFile(() => ["k1", "k2", "k3", "k4"].map(id => slides0().find(s => s.id === S).items[id].texts?.value?.align), { timeout: 20_000 }).toEqual(["center", "center", "center", "center"]);
    // the stage: the value in the middle of its section (36 % of the card)
    await expect.poll(() => valueX("k1"), { timeout: 20_000 }).toBeCloseTo(x0 + w * .36 / 2, 0);
    expect(await valueX("k1")).toBeGreaterThan(before + 10);

    // the chart panel: the title and the axis labels in another font and size; the stats row centred
    await page.locator('.itembox[data-item="cd"]').click({ position: { x: 600, y: 470 } });
    await expect(page.locator("#chartPanel")).toHaveAttribute("data-item", "cd");
    const tfBox = async (sel: string, font: string, pt: string) => {
      const box = page.locator(`[data-tf="${sel}"]`);
      if (!await box.locator(".tfbody").count()) await box.locator('[data-a="tf"]').click();
      await oneStep(page, async () => { await box.locator(".fontbtn").click(); await page.locator(`.fontmenu [data-font="${font}"]`).click(); });
      await oneStep(page, async () => { await box.locator('[data-a="tfsize"]').fill(pt); await box.locator('[data-a="tfsize"]').press("Enter"); });
    };
    await tfBox("chart-title", "Georgia", "16");
    const axes = page.locator("#chartAxes");
    if (!await axes.getAttribute("open")) await axes.locator("> summary").click();
    await tfBox("axis-y", "Consolas", "9");
    await tfBox("axis-x", "Consolas", "9");
    await oneStep(page, () => page.click('#chartStatsAlign [data-v="center"]'));
    await pollFile(() => { const c = slides0().find(s => s.id === S).items.cd; return [c.titleFmt, c.axes.y.fmt, c.axes.x.fmt, c.lay]; }, { timeout: 20_000 })
      .toEqual([{ align: "left", font: "Georgia", size: 21.3 }, { font: "Consolas", size: 12 }, { font: "Consolas", size: 12 }, { stats: "center" }]);
    // the deck: format 10 (B55's guard raises it for the new keys)
    await pollFile(() => JSON.parse(fs.readFileSync(path.join(deckDir(BOOK)!, "snapshot.json"), "utf8")).format, { timeout: 60_000 }).toBeGreaterThanOrEqual(10);
    await saved(page);
    await expect.poll(async () => (await itemTexts(page, "cd")).filter(t => t.src === "W38" && /Consolas/.test(t.css) && t.size === 12).length, { timeout: 20_000 }).toBe(1);
    await page.locator(".thumb.on").click();                // (the selection off for the picture)
    await png("b56-after.png");

    // PowerPoint: the value's text box aligned centre in its section; the axes' c:txPr in Consolas 7.2 pt; the title
    const pptx = read((await fromMenu(page, "pptx")).slice(-1)[0]);
    if (shots) { fs.mkdirSync(path.join(shots, "b56-pptx"), { recursive: true }); fs.writeFileSync(path.join(shots, "b56-pptx", "b56-slide.pptx"), pptx); }
    const z = unzipSync(new Uint8Array(pptx));
    const sx = Object.keys(z).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map(n => strFromU8(z[n])).find(x => x.includes("ILLUSTRATIVE") && x.includes("vs prev. Week"))!;
    expect(sx).toBeTruthy();
    const algnOf = (t: string) => { const i = sx.indexOf(`<a:t>${t}</a:t>`), p = sx.lastIndexOf("<a:pPr", i); return /algn="(\w+)"/.exec(sx.slice(p, i))?.[1]; };
    expect([algnOf("10"), algnOf("−10")]).toEqual(["ctr", "ctr"]);
    expect(sx).not.toContain("<p:cxnSp");
    const charts = Object.keys(z).filter(n => /^ppt\/charts\/chart\d+\.xml$/.test(n)).map(n => strFromU8(z[n]));
    const cd = charts.find(c => c.includes("DEPOSITS · WEEKLY VOLUME"))!;
    expect(cd).toBeTruthy();
    for (const ax of ["c:valAx", "c:catAx"]) { const seg = cd.slice(cd.indexOf(`<${ax}>`), cd.indexOf(`</${ax}>`)); expect(seg, ax).toContain('<a:latin typeface="Consolas"/>'); expect(seg, ax).toMatch(/sz="720"/); }
    const title = cd.slice(cd.indexOf("<c:title>"), cd.indexOf("</c:title>"));
    expect(title).toContain('<a:latin typeface="Georgia"/>');
    // the PDF: the axis labels' font embedded (a monospaced face for Consolas on this PC), which it was not before
    const pdf = read((await exported(page, () => page.click("#exportBtn")))[0]);
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    const f0 = pdfFonts(pdf0), f1 = pdfFonts(pdf);
    expect(f1.filter(f => !f0.includes(f)).length, `fonts before ${f0.join(" ")}; after ${f1.join(" ")}`).toBeGreaterThan(0);
  });
  test("no page errors", async () => { expect(errors).toEqual([]); });
});
