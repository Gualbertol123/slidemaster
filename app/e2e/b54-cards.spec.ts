/* End-to-end: the owner's slide of B54 (2026-10-23, image 15) on the helper of app.spec.ts (anna :8951), from its own
   workbook (tests/fixtures/B54.xlsx: "KPI" = image 16, "Volumes" = image 17 – no other spec uses its deck, so the raise to
   format 9 leaves the other decks alone):
   B54-01 – the headline; Insert chart ▾ › KPI cards from table… on KPI!A1:H5 (the sheet view, one step: four cards);
            the two chart cards on the long Volumes table, filtered by product (Loans, Deposits), each with the EoM
            budget line from a cell, the stats row, the tag, the separator and the momentum row; the deck goes to format 9
            (incident-format-9.json); the stage shows the image's numbers; a cell edited in the workbook and reloaded:
            the card follows (Deposits −10 → −9: +10,9 % vs Bdg, the chart's last volume 7.000 → 6.500); PDF, PNG and
            PowerPoint (native charts, KPI groups of shapes and text boxes, no picture of them); the slide in Glass,
            Navy and Excel saved for review when B54_SHOTS names a folder. */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { fold, type DeckRecord } from "../../core/src/model/fold";
import { HEADLINE, volumeCard } from "../../core/tests/b54-deck";

const ANNA = "http://127.0.0.1:8951/";
const BOOK = "B54.xlsx";
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
function xlsxEdit(buf: Buffer, part: string, f: (xml: string) => string): Buffer {
  const z = unzipSync(new Uint8Array(buf)); z[part] = strToU8(f(strFromU8(z[part])));
  return Buffer.from(zipSync(z));
}
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
    // (the sheets' names hold no "slide": none pre-selected – both chosen)
    for (const n of ["KPI", "Volumes"]) { const c = page.getByRole("checkbox", { name: new RegExp("^" + n + " ") }); if (!await c.isChecked()) await c.check(); }
    await page.click('[data-a="next"]:has-text("Tables")'); await page.click('[data-a="next"]:has-text("Slides")');
    // (no tables: the wizard asks for a slide – an empty one)
    await page.locator(".wiz").getByRole("button", { name: "+ New slide" }).click(); await page.click('[data-a="finish"]'); }
  await expect(page.locator("#fileName")).toHaveText(/^B54\.xlsx · \d+ slides?/, { timeout: 30_000 });
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
/** every text the stage draws (its display list) */
const stageTexts = (page: Page) => page.evaluate(async () => {
  const s = await (window as any).__sbTest.stageNodes(), out: string[] = [];
  const walk = (nodes: any[]) => { for (const n of nodes || []) { if (n.t === "group") walk(n.children); else if (n.t === "text") out.push(n.src); } };
  for (const L of s?.layers || []) walk(L.nodes || []);
  return out;
});
const NEG = "−";

test.describe.serial("KPI cards and chart cards (B54)", () => {
  test("B54-01: the owner's slide from the fixture – KPI cards from the table, the chart cards on the long table, format 9; a cell edited and reloaded; the exports", async ({ page }) => {
    test.setTimeout(240_000);
    await openPlain(page, ANNA);
    await saved(page);
    const slides0 = () => ((doc().preset?.slides || []) as any[]);
    // the owner's slide: a slide of its own (whatever the wizard made), first
    await change(page, "New slide", [{ op: "slide.add", slide: { id: "b54s", type: "content", title: HEADLINE, tables: [] }, after: null }]);
    await pollFile(() => slides0().some(s => s.id === "b54s"), { timeout: 20_000 }).toBe(true);
    const k = slides0().findIndex(s => s.id === "b54s"), S = slides0()[k];
    await page.locator(`.thumb[data-i="${k}"]`).click(); await page.locator(`.thumb.on[data-i="${k}"]`).waitFor();
    // (4.13.2) nothing on the slide yet: the empty slide's hint
    await expect(page.locator("#stage .emptyslide")).toBeVisible({ timeout: 20_000 });

    // KPI cards from table: the sheet view, KPI!A1:H5, one step – four cards, one per product
    let u = await undoSteps(page);
    await page.click("#chartBtn");
    await page.click('[data-a="kpi-pick"]');
    await expect(page.locator("#pickCells")).toContainText("KPI cards from table");
    await page.selectOption("#pkSheet", "KPI");
    await page.locator('#pkRange td[data-r="1"][data-c="1"]').click();
    await page.locator('#pkRange td[data-r="5"][data-c="8"]').click({ modifiers: ["Shift"] });
    await expect(page.locator("#pkSel")).toHaveText("A1:H5");
    await page.click("#pkUse");
    await expect(page.locator("#pickCells")).toHaveCount(0);
    await expect.poll(() => undoSteps(page)).toBe(u + 1);
    const items = () => (slides0().find(s => s.id === S.id).items || {}) as Record<string, any>;
    await pollFile(() => Object.values(items()).filter(i => i.kind === "kpi").length, { timeout: 20_000 }).toBe(4);
    // (4.13.2, image 20) KPI cards and no table: not an empty slide – no hint over the cards
    await expect(page.locator("#stage .emptyslide")).toHaveCount(0);
    const kpis = Object.entries(items()).filter(([, i]) => i.kind === "kpi").sort(([, a], [, b]) => a.box.x - b.box.x || a.box.y - b.box.y);
    expect(kpis.map(([, i]) => i.head)).toEqual(["A2", "A3", "A4", "A5"].map(range => ({ sheet: "KPI", range })));
    // the row as the owner's picture: four cards across, the two chart cards under them
    const w = 350, gap = 26, x0 = 61;
    await change(page, "KPI row", kpis.map(([id], j) => ({ op: "item.patch", slide: S.id, id, patch: { box: { x: x0 + j * (w + gap), y: 180, w, h: 130 } } })));
    u = await undoSteps(page);
    await change(page, "Insert chart cards", [
      // (4.13.2, image 20) the Loans card as the owner's deck holds it: its names the Product column, the filter's column too
      { op: "item.patch", slide: S.id, id: "cl", patch: { ...volumeCard("Loans", "D2", { x: x0, y: 340, w: 725, h: 520 }, { text: "Actual loans" }), labels: { sheet: "Volumes", range: "A2:A9" } } },
      { op: "item.patch", slide: S.id, id: "cd", patch: volumeCard("Deposits", "D6", { x: x0 + 725 + gap, y: 340, w: 725, h: 520 }, { text: "Illustrative", color: "#D93025" }) }]);
    await expect.poll(() => undoSteps(page)).toBe(u + 1);
    await pollFile(() => items().cd?.filter?.eq, { timeout: 20_000 }).toBe("Deposits");
    // format 9: the marker and the snapshot
    await pollFile(() => fs.existsSync(path.join(deckDir(BOOK)!, "incident-format-9.json")), { timeout: 40_000 }).toBe(true);
    await pollFile(() => JSON.parse(fs.readFileSync(path.join(deckDir(BOOK)!, "snapshot.json"), "utf8")).format, { timeout: 60_000 }).toBe(9);
    await saved(page);

    // the stage: the image's numbers
    const want = ["DEPOSITS", "CERTIFICATES", "+1,0%", NEG + "2,0%", "+3,0%", "vs prev. Week", "DEPOSITS · WEEKLY VOLUME", "ILLUSTRATIVE", "ACTUAL LOANS",
      "LATEST VOLUME", "7.000", "8.700", NEG + "1.700", "210", "MOMENTUM", NEG + "1.420 (" + NEG + "16,9%)", "+0 (+0,0%)", "since trough", NEG + "2.000 (" + NEG + "22,2%)", "WoW", "+589 (+5,2%)"];
    await expect.poll(async () => { const T = await stageTexts(page); return want.filter(s => !T.includes(s)); }, { timeout: 30_000 }).toEqual([]);
    await expect(page.locator("#issues")).not.toContainText("KPI");
    // (4.13.2) both cards' categories are the periods (the Loans card's names were its filter column), never "vs Loans"
    const T0 = await stageTexts(page);
    expect([T0.filter(t => t === "W39").length >= 2, T0.includes("vs Loans"), T0.some(t => t.includes("No tables"))]).toEqual([true, false, false]);
    await expect(page.locator("#issues")).not.toContainText("No tables");
    // the slide in Glass, Navy and Excel (the review's pictures)
    const shots = process.env.B54_SHOTS;
    const design = async (d: string) => { await change(page, "Design", [{ op: "style.patch", patch: { design: d } }]); await saved(page); await page.waitForTimeout(1500); };
    for (const [d, name] of [["glass", "b54-slide.png"], ["mckinsey", "b54-navy.png"], ["excel", "b54-excel.png"]] as const) {
      await design(d);
      const png = read((await fromMenu(page, "png-current"))[0]);
      expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
      if (shots) { fs.mkdirSync(shots, { recursive: true }); fs.writeFileSync(path.join(shots, name), png); }
    }
    await design("glass");
    // PowerPoint: two native charts, the KPI cards as groups of shapes and text boxes, no picture of them, no connector
    const pptx = read((await fromMenu(page, "pptx")).slice(-1)[0]);
    if (shots) { fs.mkdirSync(path.join(shots, "b54-pptx"), { recursive: true }); fs.writeFileSync(path.join(shots, "b54-pptx", "b54-slide.pptx"), pptx); }
    const z = unzipSync(new Uint8Array(pptx));
    const sx = Object.keys(z).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map(n => strFromU8(z[n])).find(x => x.includes("ILLUSTRATIVE"))!;
    expect(sx).toBeTruthy();
    for (const s of ["DEPOSITS", "vs prev. Week", "MOMENTUM", "GAP TO BUDGET", 'name="KPI card ']) expect(sx, s).toContain(s);
    expect(sx).not.toContain("<p:cxnSp");
    // (4.13.2) the Loans chart (its numbers 11576 …, stored with the Product names): its categories in PowerPoint are the periods
    const lx = Object.keys(z).filter(n => /^ppt\/charts\/chart\d+\.xml$/.test(n)).map(n => strFromU8(z[n])).find(x => /<c:v>11576<\/c:v>/.test(x))!;
    expect(lx).toBeTruthy();
    const cats = [...(/<c:cat>([\s\S]*?)<\/c:cat>/.exec(lx)?.[1] || "").matchAll(/<c:v>([^<]*)<\/c:v>/g)].map(m => m[1]);
    expect(cats).toEqual(["Q3", "W37", "W38", "W39"]);
    expect(Object.keys(z).filter(n => /^ppt\/charts\/chart\d+\.xml$/.test(n)).length).toBeGreaterThanOrEqual(2);
    // PDF: the numbers as text
    const pdf = read((await exported(page, () => page.click("#exportBtn")))[0]).toString("latin1");
    expect(pdf.startsWith("%PDF")).toBe(true);

    // a cell edited in Excel and the workbook reloaded: the card and the chart follow
    const file = path.join(root(), BOOK), original = fs.readFileSync(file);
    try {
      fs.writeFileSync(file, xlsxEdit(xlsxEdit(original, "xl/worksheets/sheet1.xml", x => x.replace('<c r="B3" t="n"><v>-10</v></c>', '<c r="B3" t="n"><v>-9</v></c>')),
        "xl/worksheets/sheet2.xml", x => x.replace('<c r="C9" t="n"><v>7000</v></c>', '<c r="C9" t="n"><v>6500</v></c>')));
      await page.click("#reloadBtn");
      await expect.poll(async () => { const T = await stageTexts(page); return [NEG + "9", "+10,9%", "6.500", NEG + "2.200"].filter(s => !T.includes(s)); }, { timeout: 30_000 }).toEqual([]);
    } finally { fs.writeFileSync(file, original); }
    await page.click("#reloadBtn");
    await expect.poll(async () => (await stageTexts(page)).includes("7.000"), { timeout: 30_000 }).toBe(true);
    await saved(page);
  });
  test("no page errors", async () => { expect(errors).toEqual([]); });
});
