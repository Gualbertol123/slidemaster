/* End-to-end: the owner's budget-achievement card of B55 (2026-10-23, image 19) on the helper of app.spec.ts (anna :8951),
   from the B54 workbook (tests/fixtures/B54.xlsx, its long "Volumes" table):
   B55-01 – the B54 slide with its cards narrowed to make room (the owner's layout); Insert chart ▾ › Budget
            achievement… on Volumes!A1:D9 (the sheet view, one step: one bar per product, its latest week against its EoM
            budget); the deck goes to format 10 (incident-format-10.json); the stage shows the picture's numbers (101,8 %,
            "+210 over", 80,5 %, "1.700 to go"); a cell edited in the workbook and reloaded: the card follows (Deposits W39
            7.000 → 9.000: 103,4 %, "+300 over"); PDF, PNG and PowerPoint (a native chart, the names and gaps as text
            boxes, no picture); when B55_SHOTS names a folder: the card alone in Glass, Navy and Excel (b55-glass.png,
            b55-navy.png, b55-excel.png), the whole slide (b55-slide.png) and the PowerPoint file (b55-pptx/). */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { fold, type DeckRecord } from "../../core/src/model/fold";
import { HEADLINE } from "../../core/tests/b54-deck";
import { b55Ops } from "../../core/tests/b55-deck";

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


test.describe.serial("Budget achievement (B55)", () => {
  test("B55-01: the card from the Volumes long table beside the B54 cards, format 10; a cell edited and reloaded; the exports", async ({ page }) => {
    test.setTimeout(300_000);
    await openPlain(page, ANNA);
    await saved(page);
    const slides0 = () => ((doc().preset?.slides || []) as any[]);
    await change(page, "New slide", [{ op: "slide.add", slide: { id: "b55s", type: "content", title: HEADLINE, tables: [] }, after: null }]);
    await pollFile(() => slides0().some(s => s.id === "b55s"), { timeout: 20_000 }).toBe(true);
    const k = slides0().findIndex(s => s.id === "b55s");
    await page.locator(`.thumb[data-i="${k}"]`).click(); await page.locator(`.thumb.on[data-i="${k}"]`).waitFor();
    // the B54 cards, narrowed to the left as in the owner's layout (core/tests/b55-deck.ts)
    const ops = b55Ops("b55s"), ba = ops.find((o: any) => o.id === "ba") as any;
    await change(page, "B54 cards", ops.filter((o: any) => o.op === "item.patch" && o.id !== "ba"));
    const items = () => (slides0().find(s => s.id === "b55s").items || {}) as Record<string, any>;
    await pollFile(() => Object.keys(items()).length, { timeout: 20_000 }).toBe(6);

    // Insert chart ▾ › Budget achievement…: the sheet view, Volumes!A1:D9, one step
    let u = await undoSteps(page);
    await page.click("#chartBtn");
    await page.click('[data-a="progress-pick"]');
    await expect(page.locator("#pickCells")).toContainText("Budget achievement");
    await page.selectOption("#pkSheet", "Volumes");
    await page.locator('#pkRange td[data-r="1"][data-c="1"]').click();
    await page.locator('#pkRange td[data-r="9"][data-c="4"]').click({ modifiers: ["Shift"] });
    await expect(page.locator("#pkSel")).toHaveText("A1:D9");
    await page.click("#pkUse");
    await expect(page.locator("#pickCells")).toHaveCount(0);
    await expect.poll(() => undoSteps(page)).toBe(u + 1);
    await pollFile(() => Object.values(items()).filter(i => i.type === "progress").length, { timeout: 20_000 }).toBe(1);
    const [id, it] = Object.entries(items()).find(([, i]) => i.type === "progress")!;
    expect(it).toMatchObject({ title: "BUDGET ACHIEVEMENT", subtitle: "Latest volume / EoM budget",
      progress: { table: { by: { sheet: "Volumes", range: "A2:A9" }, val: { sheet: "Volumes", range: "C2:C9" }, target: { sheet: "Volumes", range: "D2:D9" } } } });
    await expect(page.locator("#chartProgress")).toBeVisible();
    // at the right of the slide, as the owner's picture
    await change(page, "Place the card", [{ op: "item.patch", slide: "b55s", id, patch: { box: ba.patch.box } }]);
    // format 10: the marker and the snapshot
    await pollFile(() => fs.existsSync(path.join(deckDir(BOOK)!, "incident-format-10.json")), { timeout: 40_000 }).toBe(true);
    await pollFile(() => JSON.parse(fs.readFileSync(path.join(deckDir(BOOK)!, "snapshot.json"), "utf8")).format, { timeout: 60_000 }).toBe(10);
    await saved(page);

    // the stage: the picture's numbers (it-IT, as the B54 cards beside it)
    const want = ["BUDGET ACHIEVEMENT", "Latest volume / EoM budget", "101,8%", "80,5%", "LOANS", "DEPOSITS", "+210 over", "1.700 to go", "LATEST VOLUME", "CERTIFICATES"];
    await expect.poll(async () => { const T = await stageTexts(page); return want.filter(s => !T.includes(s)); }, { timeout: 30_000 }).toEqual([]);
    await expect(page.locator("#issues")).not.toContainText("Chart");
    // the slide and the card alone in Glass, Navy and Excel (the review's pictures: the card cut from the exported PNG)
    const shots = process.env.B55_SHOTS;
    const design = async (d: string) => { await change(page, "Design", [{ op: "style.patch", patch: { design: d } }]); await saved(page); await page.waitForTimeout(1500); };
    const box = ba.patch.box as { x: number; y: number; w: number; h: number };
    for (const [d, name] of [["glass", "b55-glass.png"], ["mckinsey", "b55-navy.png"], ["excel", "b55-excel.png"]] as const) {
      await design(d);
      const png = read((await fromMenu(page, "png-current"))[0]);
      expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
      if (!shots) continue;
      fs.mkdirSync(shots, { recursive: true });
      if (d === "glass") fs.writeFileSync(path.join(shots, "b55-slide.png"), png);
      const cut = await page.context().newPage();
      const W = png.readUInt32BE(16), f = W / 1600, pad = 6 * f;
      await cut.setViewportSize({ width: W, height: png.readUInt32BE(20) });
      await cut.setContent(`<body style="margin:0"><img src="data:image/png;base64,${png.toString("base64")}"></body>`);
      await cut.locator("img").waitFor();
      fs.writeFileSync(path.join(shots, name), await cut.screenshot({ clip: { x: box.x * f - pad, y: box.y * f - pad, width: box.w * f + 2 * pad, height: box.h * f + 2 * pad } }));
      await cut.close();
    }
    await design("glass");
    // PowerPoint: a native column chart (the % as its data labels), the names and gaps as text boxes, no picture
    const pptx = read((await fromMenu(page, "pptx")).slice(-1)[0]);
    if (shots) { fs.mkdirSync(path.join(shots, "b55-pptx"), { recursive: true }); fs.writeFileSync(path.join(shots, "b55-pptx", "b55-slide.pptx"), pptx); }
    const z = unzipSync(new Uint8Array(pptx));
    const sx = Object.keys(z).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map(n => strFromU8(z[n])).find(x => x.includes("1.700 to go"))!;
    expect(sx).toBeTruthy();
    for (const s of ["LOANS", "DEPOSITS", "+210 over", "Latest volume / EoM budget"]) expect(sx, s).toContain(s);
    expect(sx).not.toContain("<p:cxnSp");
    const charts = Object.keys(z).filter(n => /^ppt\/charts\/chart\d+\.xml$/.test(n)).map(n => strFromU8(z[n]));
    expect(charts.some(c => c.includes("101,8%") && c.includes('<c:overlap val="100"/>'))).toBe(true);
    const pdf = read((await exported(page, () => page.click("#exportBtn")))[0]).toString("latin1");
    expect(pdf.startsWith("%PDF")).toBe(true);

    // a cell edited in Excel and the workbook reloaded: the card follows
    const file = path.join(root(), BOOK), original = fs.readFileSync(file);
    try {
      fs.writeFileSync(file, xlsxEdit(original, "xl/worksheets/sheet2.xml", x => x.replace('<c r="C9" t="n"><v>7000</v></c>', '<c r="C9" t="n"><v>9000</v></c>')));
      await page.click("#reloadBtn");
      await expect.poll(async () => { const T = await stageTexts(page); return ["103,4%", "+300 over"].filter(s => !T.includes(s)); }, { timeout: 30_000 }).toEqual([]);
      expect(await stageTexts(page)).not.toContain("80,5%");
    } finally { fs.writeFileSync(file, original); }
    await page.click("#reloadBtn");
    await expect.poll(async () => (await stageTexts(page)).includes("80,5%"), { timeout: 30_000 }).toBe(true);
    await saved(page);
  });
  test("no page errors", async () => { expect(errors).toEqual([]); });
});
