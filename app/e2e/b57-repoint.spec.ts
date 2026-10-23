/* End-to-end: B57 (the owner, 2026-10-23: "if i move cells around in excel the graphs and tabs will break, i want to be
   easily able to repoint them without having to rebuild the entire graph") on the helper of app.spec.ts (anna :8951), from
   a copy of the B54 workbook (tests/fixtures/B54.xlsx as B57.xlsx: a deck of its own, so the raise to format 10 leaves
   B54's and B55's decks alone):
   B57-01 – a chart card (Deposits, the long Volumes table) and a KPI card (Deposits, the KPI sheet); the chart's headers
            remembered (Data sources › Remember headers), the KPI card's not (the page compares a reload with the
            workbook before it); the workbook changed on disk as Excel saves it after the owner's move (2 rows inserted
            above both tables, the Volume column moved from C to E: core/tests/b57-book.ts) and reloaded: the stage shows
            wrong data, Issues › Data sources and the panel say "moved?"; Find the block for the slide's objects: the
            preview of every old → new address, ONE undo step, the right numbers again; undo restores the old addresses,
            redo the new; Follow header on the chart's values, then the column moved back in Excel: no repoint, the
            right numbers. B57_SHOTS (a folder): b57-panel.png (the Data sources panel with its statuses) and
            b57-preview.png (Find the block's preview). */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fold, type DeckRecord } from "../../core/src/model/fold";
import { kpiCard, volumeCard } from "../../core/tests/b54-deck";
import { movedB54 } from "../../core/tests/b57-book";

const ANNA = "http://127.0.0.1:8951/";
const BOOK = "B57.xlsx";
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
async function openBook(page: Page) {
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(ANNA);
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
  await expect(page.locator("#fileName")).toHaveText(/^B57\.xlsx · \d+ slides?/, { timeout: 30_000 });
}
const undoSteps = (page: Page) => page.evaluate(() => (window as any).__sbTest.history().undo as number);
const change = (page: Page, label: string, ops: object[]) => page.evaluate(([l, o]) => (window as any).__sbTest.change(l, o), [label, ops] as const);
/** every text the stage draws (its display list) */
const stageTexts = (page: Page) => page.evaluate(async () => {
  const s = await (window as any).__sbTest.stageNodes(), out: string[] = [];
  const walk = (nodes: any[]) => { for (const n of nodes || []) { if (n.t === "group") walk(n.children); else if (n.t === "text") out.push(n.src); } };
  for (const L of s?.layers || []) walk(L.nodes || []);
  return out;
});
const status = (page: Page, p: string) => page.locator(`#dataSources [data-path="${p}"]`).getAttribute("data-status");
const select = async (page: Page, id: string) => { await page.locator(`.itembox[data-item="${id}"]`).click(); await expect(page.locator(`#dataSources[data-target="i:${id}"]`)).toBeVisible(); };

test.describe.serial("Data sources: repoint when cells move in Excel (B57)", () => {
  test("B57-01: chart card and KPI card; the workbook moved and reloaded – moved?; Find the block (one step, the right numbers); undo; Follow header", async ({ page }) => {
    test.setTimeout(300_000);
    const file = path.join(root(), BOOK), original = fs.readFileSync(path.join(root(), "B54.xlsx"));
    fs.writeFileSync(file, original);
    const shots = process.env.B57_SHOTS;
    try {
      await openBook(page);
      await saved(page);
      const slides = () => ((doc().preset?.slides || []) as any[]);
      await change(page, "New slide", [{ op: "slide.add", slide: { id: "b57s", type: "content", title: "Deposits", tables: [] }, after: null }]);
      await pollFile(() => slides().some(s => s.id === "b57s"), { timeout: 20_000 }).toBe(true);
      const k = slides().findIndex(s => s.id === "b57s");
      await page.locator(`.thumb[data-i="${k}"]`).click(); await page.locator(`.thumb.on[data-i="${k}"]`).waitFor();
      // 1. a chart card and a KPI card
      await change(page, "Cards", [
        { op: "item.patch", slide: "b57s", id: "cd", patch: volumeCard("Deposits", "D6", { x: 61, y: 300, w: 900, h: 560 }, { text: "Illustrative" }) },
        { op: "item.patch", slide: "b57s", id: "kd", patch: kpiCard(3, { x: 1000, y: 300, w: 380, h: 150 }) }]);
      await expect.poll(async () => { const T = await stageTexts(page); return ["7.000", "DEPOSITS · WEEKLY VOLUME"].filter(s => !T.includes(s)); }, { timeout: 30_000 }).toEqual([]);
      // the chart's headers remembered (one step); the KPI card's not
      await select(page, "cd");
      await page.click("#srcToggle");
      await expect(page.locator('#dataSources [data-path="sers.vol.vals.0"]')).toHaveAttribute("data-status", "ok");
      let u = await undoSteps(page);
      await page.click("#srcRemember");
      await expect.poll(() => undoSteps(page)).toBe(u + 1);
      await pollFile(() => slides().find(s => s.id === "b57s").items.cd.bind?.["sers.vol.vals.0"]?.h, { timeout: 20_000 }).toBe("Volume_EUR_m");
      await pollFile(() => JSON.parse(fs.readFileSync(path.join(deckDir(BOOK)!, "snapshot.json"), "utf8")).format, { timeout: 60_000 }).toBe(10);
      await saved(page);

      // 2. the workbook as Excel saves it after the move; 3. reloaded: wrong data, moved?
      fs.writeFileSync(file, movedB54(new Uint8Array(original)));
      await page.click("#reloadBtn");
      await expect(page.locator("#srcIssues")).toContainText("moved?", { timeout: 30_000 });
      await expect(page.locator('#srcIssues [data-target="cd"]')).toContainText("Series 1 “Deposits” values – moved?");
      await expect(page.locator('#srcIssues [data-target="kd"]')).toContainText("KPI value – moved?");
      await expect(page.locator("#issues")).toContainText("the cells moved?");
      // (the KPI card's title cell A3 holds the header now: the card reads the wrong row)
      await expect.poll(async () => { const T = await stageTexts(page); return [T.includes("PRODUCT"), T.includes("DEPOSITS")]; }, { timeout: 30_000 }).toEqual([true, false]);
      await select(page, "cd");
      expect(await status(page, "sers.vol.vals.0")).toBe("moved");
      expect(await status(page, "filter.by")).toBe("moved");
      if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.locator("#sideNav").screenshot({ path: path.join(shots, "b57-panel.png") }); }

      // 4. Find the block for the slide's objects: the preview, then one step
      await page.selectOption("#srcScope", "slide");
      await page.click("#srcFind");
      const pv = page.locator("#srcPreview");
      await expect(pv).toContainText("Volumes!C2:C9 → Volumes!E4:E11");
      await expect(pv).toContainText("Volumes!A2:A9 → Volumes!A4:A11");
      await expect(pv).toContainText("KPI!B3 → KPI!B5");
      await pv.scrollIntoViewIfNeeded();
      if (shots) await page.locator("#sideNav").screenshot({ path: path.join(shots, "b57-preview.png") });
      u = await undoSteps(page);
      await page.click("#srcApply");
      await expect.poll(() => undoSteps(page)).toBe(u + 1);
      await expect.poll(async () => { const T = await stageTexts(page); return [...["7.000", "DEPOSITS"].filter(s => !T.includes(s)), ...(T.includes("PRODUCT") ? ["PRODUCT"] : [])]; }, { timeout: 30_000 }).toEqual([]);
      await expect(page.locator("#srcIssues")).toHaveCount(0);
      await pollFile(() => slides().find(s => s.id === "b57s").items.cd.sers.vol.vals[0].range, { timeout: 20_000 }).toBe("E4:E11");
      await pollFile(() => slides().find(s => s.id === "b57s").items.kd.cur.range, { timeout: 20_000 }).toBe("B5");
      const card = slides().find(s => s.id === "b57s").items.cd;
      expect([card.title, card.tag, card.stats.s1.label, card.marks.r1.value]).toEqual(["DEPOSITS · WEEKLY VOLUME", { text: "Illustrative" }, "Latest volume", { sheet: "Volumes", range: "C8" }]);

      // 5. undo: the old addresses (moved? again); redo
      await page.click("#undoBtn");
      await expect.poll(() => undoSteps(page)).toBe(u);
      await pollFile(() => slides().find(s => s.id === "b57s").items.cd.sers.vol.vals[0].range, { timeout: 20_000 }).toBe("C2:C9");
      await pollFile(() => slides().find(s => s.id === "b57s").items.kd.cur.range, { timeout: 20_000 }).toBe("B3");
      await expect(page.locator("#srcIssues")).toContainText("moved?");
      await page.click("#redoBtn");
      await expect.poll(() => undoSteps(page)).toBe(u + 1);
      await expect(page.locator("#srcIssues")).toHaveCount(0);

      // 6. Follow header on the chart's values: the column moved back in Excel needs no repoint
      await select(page, "cd");
      u = await undoSteps(page);
      // (one step each: each box ticked once the previous one's change is in)
      for (const [j, p] of ["sers.vol.vals.0", "filter.by", "labels", "marks.r1.value"].entries()) {
        const box = page.locator(`#dataSources [data-path="${p}"] [data-a="follow"]`);
        await box.click();
        await expect.poll(() => undoSteps(page)).toBe(u + j + 1);
        await expect(box).toBeChecked();
      }
      await saved(page);
      fs.writeFileSync(file, movedB54(new Uint8Array(original), { rows: 3, swap: false }));
      await page.click("#reloadBtn");
      await expect(page.locator('#srcIssues [data-target="cd"]')).toContainText("Values as a pie – moved?", { timeout: 30_000 });   // (not followed: said)
      await expect(page.locator('#srcIssues [data-target="cd"]')).not.toContainText("Series 1");
      await select(page, "cd");
      await expect(page.locator('#dataSources [data-path="sers.vol.vals.0"] [data-a="now"]')).toContainText("Volumes!C5:C12", { timeout: 30_000 });
      expect(await status(page, "sers.vol.vals.0")).toBe("ok");
      await expect.poll(async () => (await stageTexts(page)).includes("7.000"), { timeout: 30_000 }).toBe(true);
      expect(slides().find(s => s.id === "b57s").items.cd.sers.vol.vals[0].range).toBe("E4:E11");     // (stored: the fallback)
      expect(await undoSteps(page)).toBe(0);                                  // (no repoint: nothing changed since the reload)
      await saved(page);
    } finally { fs.writeFileSync(file, original); }
  });
  test("no page errors", async () => { expect(errors).toEqual([]); });
});
