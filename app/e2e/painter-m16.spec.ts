/* S16.3 (4.9, B38; PT-01…PT-03; docs/next/09 §9 Q9, Q19): the Number group and the vertical alignment of table cells,
   the fuller format painter (number display, vertical position, font), its paste onto a multi-selection (Ctrl+click,
   let go of Ctrl: one undo step) and onto objects of one kind. Runs after app.spec.ts on the same two helpers and
   folder (report.xlsx's deck, made there). */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fold, type DeckRecord } from "../../core/src/model/fold";

const ANNA = "http://127.0.0.1:8951/";
const data = () => process.env.SB_E2E_DATA!;
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
/** the deck as everybody reads it, and its records (one per change: one undo step) */
function deck(name = "report.xlsx") {
  const d = deckDir(name)!, snap = JSON.parse(fs.readFileSync(path.join(d, "snapshot.json"), "utf8"));
  let names: string[] = []; try { names = fs.readdirSync(path.join(d, "j")); } catch { /* none yet */ }
  const recs = names.flatMap(n => frames(fs.readFileSync(path.join(d, "j", n)), snap.frontier[n.replace(/\.log$/, "")] || 0));
  return { doc: fold(snap, recs).doc as any, recs };
}
const pollFile = <T>(f: () => T, o = { timeout: 10_000 }) => expect.poll(() => { try { return f(); } catch { return undefined as unknown as T; } }, o);

async function openApp(page: Page, url: string, errors: string[]) {
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(url);
  await page.locator("#openBtn").waitFor();
  await expect(page.locator("#srv")).toHaveCount(0);
  // start-up reopens anna's last workbook (open.spec.ts ran before): report.xlsx's deck is opened when it is another
  let last: string | null = null;
  try { last = JSON.parse(fs.readFileSync(path.join(data(), "users", "anna.json"), "utf8")).lastFile || null; } catch { /* first start */ }
  if (last) await expect(page.locator("#fileName")).toHaveText(new RegExp("^" + last.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " · \\d+ slides?"), { timeout: 30_000 });
  if (last !== "report.xlsx") {
    await page.click("#openBtn"); await page.click('[data-f="report.xlsx"]'); await page.click('[data-a="continue"]');
    await expect(page.locator("#fileName")).toHaveText(/^report\.xlsx · \d+ slides?/, { timeout: 30_000 });
  }
}
/** the stage draws the slide chosen (it keeps the previous slide until the new one arrives: a cell found before then is
    the old slide's, detached a moment later – boundingBox() null) */
const stageOn = (page: Page) => expect.poll(() => page.evaluate(() => (window as any).__sbTest.stageIdle() as boolean)).toBe(true);
/** a slide of the deck with a number table, shown; its first table's number cells (the stage's text elements) */
async function numberSlide(page: Page) {
  const si = deck().doc.preset.slides.findIndex((s: any) => s.type === "content" && s.tables.length >= 2);
  await page.locator(`.thumb[data-i="${si}"]`).click(); await page.locator(`.thumb.on[data-i="${si}"]`).waitFor(); await stageOn(page);
  return page.locator('#stage .slide .t').filter({ hasText: /^[+-]?\d[\d.]*(,\d+)?%?$/ });
}
async function clickCell(page: Page, l: ReturnType<Page["locator"]>, mods: ("Control")[] = []) {
  const b = (await l.boundingBox())!;
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.click(b.x + 6, b.y + b.height / 2);
}

test("PT-01 Number group and vertical alignment of cells: saved per cell, drawn, one undo step each", async ({ page: a }) => {
  const errors: string[] = [];
  await openApp(a, ANNA, errors);
  const nums = await numberSlide(a), first = nums.first(), text0 = (await first.textContent())!;
  await clickCell(a, first);
  await a.click("#numDecUp");
  const sheetEdits = () => Object.values(deck().doc.edits).flatMap((s: any) => Object.values(s)) as any[];
  await pollFile(() => sheetEdits().some(e => typeof e.num === "string")).toBe(true);
  // drawn: the cell shows one more decimal
  await expect(a.locator("#stage .slide")).toContainText(new RegExp(text0.replace(/[.+%]/g, "\\$&").replace(/(,\d+)?(%?)$/, ",\\d+$2")));
  await a.click("#numPct");
  await pollFile(() => sheetEdits().some(e => /%$/.test(e.num || ""))).toBe(true);
  await a.click('[data-valign="top"]');
  await pollFile(() => sheetEdits().some(e => e.valign === "top")).toBe(true);
  // undo: the vertical position back first
  await a.click("#undoBtn");
  await pollFile(() => sheetEdits().some(e => e.valign === "top")).toBe(false);
  // (an undo leaves no cell selected: the cell again, then Clear format)
  await clickCell(a, first); await a.click("#clearFmt");
  await pollFile(() => sheetEdits().some(e => typeof e.num === "string")).toBe(false);
  expect(errors).toEqual([]);
});

test("PT-01 / PT-02 the painter copies number display and vertical position; Ctrl+click several ranges, let go: one paste, one undo step", async ({ page }) => {
  const errors: string[] = [];
  await openApp(page, ANNA, errors);
  const nums = await numberSlide(page);
  await clickCell(page, nums.nth(0));
  await page.click("#numDecUp"); await page.click('[data-valign="top"]');
  const edits = () => Object.entries(deck().doc.edits).flatMap(([sh, s]: [string, any]) => Object.entries(s).map(([k, e]) => ({ k: sh + "!" + k, e: e as any })));
  await pollFile(() => edits().filter(x => x.e.valign === "top" && x.e.num).length).toBe(1);
  // the painter, then three cells with Ctrl held: nothing saved until Ctrl is let go
  await clickCell(page, nums.nth(0)); await page.click("#painterBtn");
  const recs0 = deck().recs.length;
  await clickCell(page, nums.nth(3), ["Control"]); await clickCell(page, nums.nth(5)); await clickCell(page, nums.nth(7));
  await expect(page.locator("#stage .paintpend")).toHaveCount(3);
  await page.waitForTimeout(500);
  expect(deck().recs.length).toBe(recs0);
  await page.keyboard.up("Control");
  await pollFile(() => edits().filter(x => x.e.valign === "top" && x.e.num).length).toBe(4);
  expect(deck().recs.length).toBe(recs0 + 1);
  // one Ctrl+Z takes the whole paste back
  await page.click("#undoBtn");
  await pollFile(() => edits().filter(x => x.e.valign === "top" && x.e.num).length).toBe(1);
  // the deck as it was
  await clickCell(page, nums.nth(0)); await page.click("#clearFmt");
  await pollFile(() => edits().filter(x => x.e.valign || x.e.num).length).toBe(0);
  expect(errors).toEqual([]);
});

test("PT-03 objects: a callout's look onto two others with Ctrl (one undo step); a chart's onto a callout is refused", async ({ page }) => {
  const errors: string[] = [];
  await openApp(page, ANNA, errors);
  await numberSlide(page);
  const sid = await page.evaluate(() => { const p = (window as any).__sbTest.preset(); return p.slides.find((s: any) => s.type === "content" && s.tables.length >= 2).id; });
  await page.evaluate(id => (window as any).__sbTest.change("Callouts", ["qa", "qb", "qc"].map((k, i) => ({ op: "item.patch", slide: id, id: k,
    patch: { kind: "shape", shape: "round", text: k, box: { x: 200 + i * 300, y: 700, w: 160, h: 60 }, ...(i ? {} : { fill: "#C00000", border: { color: "#1F3864", w: 2 } }) } }))), sid);
  const items = () => deck().doc.preset.slides.find((s: any) => s.id === sid).items || {};
  await pollFile(() => Object.keys(items()).filter(k => /^q[abc]$/.test(k)).length).toBe(3);
  await page.locator('.itembox[data-item="qa"]').click();
  await page.click("#painterBtn");
  const recs0 = deck().recs.length;
  await page.keyboard.down("Control");
  await page.locator('.itembox[data-item="qb"]').click(); await page.locator('.itembox[data-item="qc"]').click();
  await page.keyboard.up("Control");
  await pollFile(() => [items().qb?.fill, items().qc?.fill]).toEqual(["#C00000", "#C00000"]);
  expect(deck().recs.length).toBe(recs0 + 1);
  expect(items().qb.text).toBe("qb");
  await page.click("#undoBtn");
  await pollFile(() => [items().qb?.fill ?? null, items().qc?.fill ?? null]).toEqual([null, null]);
  await page.evaluate(id => (window as any).__sbTest.change("Remove callouts", ["qa", "qb", "qc"].map(k => ({ op: "item.patch", slide: id, id: k, patch: null }))), sid);
  await pollFile(() => Object.keys(items()).filter(k => /^q[abc]$/.test(k)).length).toBe(0);
  expect(errors).toEqual([]);
});

test("PT-02 armed across slides: Ctrl+click a cell, go to the next slide with Ctrl held, Ctrl+click there, let go: one paste on both slides; Esc with targets collected drops them", async ({ page }) => {
  const errors: string[] = [];
  await openApp(page, ANNA, errors);
  // two content slides with tables one after the other
  const slides = deck().doc.preset.slides as any[], si = slides.findIndex((s, k) => s.type === "content" && s.tables.length && slides[k + 1]?.type === "content" && slides[k + 1].tables.length);
  expect(si).toBeGreaterThanOrEqual(0);
  const numCells = () => page.locator("#stage .slide .t").filter({ hasText: /^[+-]?\d[\d.]*(,\d+)?%?$/ });
  await page.locator(`.thumb[data-i="${si}"]`).click(); await page.locator(`.thumb.on[data-i="${si}"]`).waitFor(); await stageOn(page);
  const edits = () => Object.entries(deck().doc.edits).flatMap(([sh, s]: [string, any]) => Object.entries(s).map(([k, e]) => ({ k: sh + "!" + k, e: e as any })));
  const marked = () => edits().filter(x => x.e.valign === "top").length;
  // the source: top
  await clickCell(page, numCells().nth(0)); await page.click('[data-valign="top"]');
  await pollFile(marked).toBe(1);
  await clickCell(page, numCells().nth(0)); await page.click("#painterBtn");
  const recs0 = deck().recs.length;
  await clickCell(page, numCells().nth(2), ["Control"]);
  // Ctrl still held: the next slide (Alt+↓), a cell there
  await page.keyboard.down("Alt"); await page.keyboard.press("ArrowDown"); await page.keyboard.up("Alt");
  await page.locator(`.thumb.on[data-i="${si + 1}"]`).waitFor(); await stageOn(page);
  await expect(page.locator("#painterBtn")).toHaveClass(/ on/);
  await clickCell(page, numCells().nth(0));
  await expect(page.locator("body")).toHaveAttribute("data-paint-pend", "2");
  await page.waitForTimeout(500);
  expect(deck().recs.length).toBe(recs0);
  await page.keyboard.up("Control");
  // (two slides may show the same sheet's cells: at least one more cell, from one record)
  await pollFile(marked).toBeGreaterThanOrEqual(2);
  expect(deck().recs.length).toBe(recs0 + 1);
  await page.click("#undoBtn");
  await pollFile(marked).toBe(1);
  // Esc while targets are collected: nothing pasted, the painter off
  await page.locator(`.thumb[data-i="${si}"]`).click(); await page.locator(`.thumb.on[data-i="${si}"]`).waitFor(); await stageOn(page);
  await clickCell(page, numCells().nth(0)); await page.click("#painterBtn");
  const recs1 = deck().recs.length;
  await clickCell(page, numCells().nth(3), ["Control"]);
  await expect(page.locator("#stage .paintpend")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("#painterBtn")).not.toHaveClass(/ on/);
  await expect(page.locator("#stage .paintpend")).toHaveCount(0);
  await page.keyboard.up("Control");
  await page.waitForTimeout(500);
  expect(deck().recs.length).toBe(recs1);
  expect(marked()).toBe(1);
  // the deck as it was
  await clickCell(page, numCells().nth(0)); await page.click("#clearFmt");
  await pollFile(marked).toBe(0);
  expect(errors).toEqual([]);
});
