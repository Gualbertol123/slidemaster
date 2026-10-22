/* End-to-end: a chart's labels (B53, product owner 2026-10-22) on the helper of app.spec.ts (anna :8951). Its own
   workbook (tests/fixtures/Labels.xlsx, a copy of B52's Targets.xlsx: SLIDE_1 the weekly volumes, Targets the budget
   and the ambition – no other spec uses its deck, so the raise to format 8 leaves the other decks alone):
   B53-01 – the owner's chart (a line, its budget line from a cell, the gap arrow, the pills); the point values set to
            Auto (one step); the left axis's max from a cell picked in the sheet view (Targets!C3, one step); the deck
            goes to format 8 (incident-format-8.json); the gap arrow's label dragged on the stage (a dashed ghost; one
            step; its offset a fraction of the chart's box; the stage draws it there); the PDF draws the gap and the
            axis's top at the cell's 12.000, the PNG export a picture, the PowerPoint chart the resolved c:max with the
            gap label a text box; Reset puts it back in one step, undo brings the dragged place again. */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { pdfPageRuns } from "./pdftext";
import { fold, type DeckRecord } from "../../core/src/model/fold";

const ANNA = "http://127.0.0.1:8951/";
const BOOK = "Labels.xlsx";
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
  await expect(page.locator("#fileName")).toHaveText(/^Labels\.xlsx · \d+ slides?/, { timeout: 30_000 });
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

/** the stage's draggable labels of an item ("label" hits, id "<item>|<key>"), in slide px (group transforms applied) */
async function labelHits(page: Page, item: string): Promise<Record<string, { x: number; y: number; w: number; h: number }>> {
  return page.evaluate(async item => {
    const s = await (window as any).__sbTest.stageNodes(), out: Record<string, { x: number; y: number; w: number; h: number }> = {};
    const walk = (nodes: any[], M: number[]) => { for (const n of nodes || []) {
      if (n.t === "group") { const T = n.transform; walk(n.children, T ? [M[0] * T[0] + M[2] * T[1], M[1] * T[0] + M[3] * T[1], M[0] * T[2] + M[2] * T[3], M[1] * T[2] + M[3] * T[3], M[0] * T[4] + M[2] * T[5] + M[4], M[1] * T[4] + M[3] * T[5] + M[5]] : M); continue; }
      if (n.t === "hit" && n.kind === "label" && typeof n.id === "string" && n.id.startsWith(item + "|")) out[n.id.slice(item.length + 1)] = { x: M[0] * n.x + M[4], y: M[3] * n.y + M[5], w: M[0] * n.w, h: M[3] * n.h };
    } };
    for (const L of s?.layers || []) walk(L.nodes || [], [1, 0, 0, 1, 0, 0]);
    return out;
  }, item);
}

test.describe.serial("chart labels (B53)", () => {
  test("B53-01: point values Auto, the axis's max from a cell, a label dragged on the slide – one undo step each, format 8, the PDF / PNG / PowerPoint follow", async ({ page }) => {
    await openPlain(page, ANNA);
    await saved(page);
    await pollFile(() => (doc().preset.slides as any[]).length, { timeout: 20_000 }).toBeGreaterThan(0);
    if (!(doc().preset.slides as any[]).some(s => s.type === "content")) {
      const u0 = await undoSteps(page);
      await change(page, "New slide", [{ op: "slide.add", slide: { id: "b53s", type: "content", title: "Labels", tables: [] }, after: null }]);
      await expect.poll(() => undoSteps(page)).toBe(u0 + 1);
      await pollFile(() => (doc().preset.slides as any[]).some(s => s.type === "content"), { timeout: 10_000 }).toBe(true);
    }
    const slides = doc().preset.slides as any[], k = slides.findIndex(s => s.type === "content"), S = slides[k];
    await page.locator(`.thumb[data-i="${k}"]`).click(); await page.locator(`.thumb.on[data-i="${k}"]`).waitFor();
    const D = (r: string) => ({ sheet: "SLIDE_1", range: r }), T = (r: string) => ({ sheet: "Targets", range: r });
    // the owner's chart: a line, its budget line from a cell, the gap arrow and the pills (B52: format 7)
    const chart = { kind: "chart", type: "line", title: "W/W Stock", values: D("D4:D7"), labels: D("C4:C7"), box: { x: 700, y: 180, w: 820, h: 560 },
      sers: { s1: { n: 1, name: "Volume", vals: [D("D4:D7")], smooth: true, marker: { shape: "circle", size: 8 }, labels: { show: ["value"], pos: "above" } } },
      marks: { r1: { kind: "ref", value: T("B3"), name: "EoM Budget" }, g1: { kind: "gap", a: { s: "s1", i: -1 }, ref: "r1", caption: "Gap to Budget" }, p1: { kind: "change", a: { s: "s1", i: -1 }, caption: "Week-on-week change" } } };
    let u = await undoSteps(page);
    await change(page, "Insert chart", [{ op: "item.patch", slide: S.id, id: "b53c", patch: chart }]);
    await expect.poll(() => undoSteps(page)).toBe(u + 1);
    const item = () => (doc().preset.slides as any[]).find(s => s.id === S.id).items?.b53c;
    await pollFile(() => item()?.type, { timeout: 10_000 }).toBe("line");
    await saved(page);
    await page.locator('.itembox[data-item="b53c"]').click({ position: { x: 6, y: 6 } });
    await expect(page.locator("#chartPanel")).toBeVisible({ timeout: 10_000 });

    // point values Auto: one step
    u = await undoSteps(page);
    await page.click('#chartPanel [data-ser="s1"] [data-a="more"]');
    await page.selectOption('#chartPanel [data-ser="s1"] [data-a="lpos"]', "auto");
    await expect.poll(() => undoSteps(page)).toBe(u + 1);
    await pollFile(() => item().sers.s1.labels.pos, { timeout: 10_000 }).toBe("auto");
    // the left axis's max from a cell: the sheet view asks for ONE cell (Targets!C3, the ambition 12,000), one step
    await page.locator("#chartAxes > summary").click();
    await page.click('#chartAxes [data-ax="y"] [data-a="cell-max"]');
    await expect(page.locator("#pickCells")).toContainText("Chart: the axis's bound from a cell");
    await page.selectOption("#pkSheet", "Targets");
    await page.locator('#pkRange td[data-r="3"][data-c="3"]').click();
    await expect(page.locator("#pkSel")).toHaveText("C3");
    await page.click("#pkUse");
    await expect(page.locator("#pickCells")).toHaveCount(0);
    await expect.poll(() => undoSteps(page)).toBe(u + 2);
    await pollFile(() => item().axes?.y?.cells?.max, { timeout: 10_000 }).toEqual(T("C3"));
    // the deck holds what 4.10 does not draw whole: format 8, its marker
    await pollFile(() => fs.existsSync(path.join(deckDir(BOOK)!, "incident-format-8.json")), { timeout: 30_000 }).toBe(true);
    await pollFile(() => JSON.parse(fs.readFileSync(path.join(deckDir(BOOK)!, "snapshot.json"), "utf8")).format, { timeout: 40_000 }).toBe(8);
    await saved(page);

    // the gap's label dragged 60 slide px to the left and 20 up: one step, its offset as a fraction of the chart's box
    await expect.poll(async () => Object.keys(await labelHits(page, "b53c")), { timeout: 20_000 }).toContain("g:g1");
    const L = (await labelHits(page, "b53c"))["g:g1"], ib = await page.locator('.itembox[data-item="b53c"]').boundingBox(), kx = ib!.width / 820;
    const sx = ib!.x + (L.x - 700 + L.w / 2) * kx, sy = ib!.y + (L.y - 180 + L.h / 2) * kx;
    u = await undoSteps(page);
    await page.mouse.move(sx, sy); await page.mouse.down();
    await page.mouse.move(sx - 30 * kx, sy - 10 * kx, { steps: 4 }); await page.mouse.move(sx - 60 * kx, sy - 20 * kx, { steps: 4 });
    await expect(page.locator('.labelghost[data-label="g:g1"]')).toHaveCount(1);
    await page.mouse.up();
    await expect.poll(() => undoSteps(page)).toBe(u + 1);
    await pollFile(() => item().nudge?.["g:g1"], { timeout: 10_000 }).toBeTruthy();
    const n = item().nudge["g:g1"];
    expect(n.dx * 820).toBeCloseTo(-60, 0); expect(n.dy * 560).toBeCloseTo(-20, 0);
    await expect.poll(async () => { const h = (await labelHits(page, "b53c"))["g:g1"]; return h ? Math.round(h.x - L.x) : null; }, { timeout: 20_000 }).toBe(-60);
    await saved(page);
    // (review) a click on the budget line's label selects its mark (no step); a drag of it moves it (one step)
    const R1 = (await labelHits(page, "b53c"))["r:r1"];
    const rx = ib!.x + (R1.x - 700 + R1.w / 2) * kx, ry = ib!.y + (R1.y - 180 + R1.h / 2) * kx;
    u = await undoSteps(page);
    await page.mouse.click(rx, ry);
    await expect(page.locator('.pointmark[data-mark="r1"]')).toBeVisible({ timeout: 10_000 });
    expect(await undoSteps(page)).toBe(u);
    await page.mouse.move(rx, ry); await page.mouse.down();
    await page.mouse.move(rx, ry + 15 * kx, { steps: 4 }); await page.mouse.move(rx, ry + 30 * kx, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => undoSteps(page)).toBe(u + 1);
    await pollFile(() => Math.round((item().nudge?.["r:r1"]?.dy ?? 0) * 560), { timeout: 10_000 }).toBe(30);
    await saved(page);

    // the PDF: the gap (−348) and the axis's top at the cell's 12.000; PNG: a picture; PowerPoint: the resolved c:max,
    // the gap label a text box, no picture of the chart
    const runs = pdfPageRuns(read((await exported(page, () => page.click("#exportBtn")))[0]))[k].map(r => r.text);
    expect(runs.some(t => /^−348$/.test(t)), JSON.stringify(runs)).toBe(true);
    expect(runs.some(t => /^12[.,]000$/.test(t)), JSON.stringify(runs)).toBe(true);
    const png = read((await fromMenu(page, "png-current"))[0]);
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG"); expect(png.length).toBeGreaterThan(10_000);
    const z = unzipSync(new Uint8Array(read((await fromMenu(page, "pptx")).slice(-1)[0])));
    const ours = Object.keys(z).filter(nm => /^ppt\/charts\/chart\d+\.xml$/.test(nm)).map(nm => strFromU8(z[nm])).find(x => x.includes("Volume"))!;
    expect(ours).toContain('<c:max val="12000"/>');
    const sx2 = Object.keys(z).filter(nm => /^ppt\/slides\/slide\d+\.xml$/.test(nm)).map(nm => strFromU8(z[nm])).find(x => x.includes("Gap to Budget"))!;
    expect(sx2).toContain("−348"); expect(sx2).not.toContain("<p:cxnSp");

    // Reset: every label back, one step; undo: the dragged place again
    await page.locator("#chartPanel").evaluate(e => e.scrollIntoView());
    u = await undoSteps(page);
    await page.click("#chartNudgeReset");
    await expect.poll(() => undoSteps(page)).toBe(u + 1);
    await pollFile(() => item().nudge ?? null, { timeout: 10_000 }).toBeNull();
    await page.click("#undoBtn");
    await pollFile(() => item().nudge?.["g:g1"] ?? null, { timeout: 10_000 }).toEqual(n);
    await saved(page);
  });
  test("no page errors", async () => { expect(errors).toEqual([]); });
});
