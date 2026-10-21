/* End-to-end: delete-versions (S16.2, B37; docs/next/09 §3.7) on the two helpers of app.spec.ts (anna :8951, bob :8952,
   one shared folder; runs after it, as open.spec.ts does):
   VD-01 – the wizard's step 4 deletes rows / columns of a version (#wDropRows, #wDropCols: struck through on the grid,
           ✕ restores), beside Remove cells; ribbon 2 › Cells › For this version ▾ does the same without the wizard
           (disabled with the full deck shown), one undo step each; two people on two sheets of one version both win;
   VD-03 – every export of the version leaves the rows out: PDF and PowerPoint (a real a:tbl of its rows), every
           version × design, Run for each value × that version. (VD-02, what reads the table: core/tests/versions-m16.) */
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
async function forVersion(page: Page, id: "vDropRows" | "vDropCols" | "vEmpty" | "vRestoreSel" | "vRestoreAll") { await page.click("#versionBtn"); await page.click("#" + id); }
async function exported(page: Page, click: () => Promise<unknown>): Promise<string[]> {
  await page.evaluate(() => { (window as any).__sbTest.lastExport.files = []; });
  await click();
  let files: string[] = [];
  await expect.poll(async () => (files = await page.evaluate(() => [...(window as any).__sbTest.lastExport.files] as string[])).length, { timeout: 60_000 }).toBeGreaterThan(0);
  await expect(page.locator("#exportBtn")).toHaveText("Export PDF");
  return files;
}
const read = (f: string) => fs.readFileSync(path.join(root(), "export", f));
/** a PowerPoint file's tables per slide: rows, columns and the texts of the cells */
function pptxTables(b: Buffer) {
  const z = unzipSync(new Uint8Array(b));
  return Object.keys(z).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => +a.match(/\d+/)![0] - +b.match(/\d+/)![0]).map(n =>
    strFromU8(z[n]).split("<p:graphicFrame>").slice(1).filter(g => g.includes("<a:tbl>")).map(g => ({
      rows: (g.match(/<a:tr /g) || []).length, text: [...g.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1]).join(" ") })));
}
const versionsOf = () => (doc().preset.versions || []) as any[];
const byName = (n: string) => versionsOf().find(v => v.name === n);

test.describe.serial("delete-versions (S16.2)", () => {
  test("VD-01: the wizard deletes rows / columns of a version (struck through, ✕ restores); For this version ▾ without the wizard, one undo step each; two people on two sheets", async ({ page, browser }) => {
    await openReport(page, ANNA);
    // the wizard, step 4: a version "VD" with rows 10–11 deleted (Epsilon, Zeta) and column G, then G restored by ✕
    await page.click("#wizardBtn");
    await page.click('[data-a="next"]:has-text("Tables")'); await page.click('[data-a="next"]:has-text("Slides")');
    await page.click('[data-a="versions"]');
    await page.fill("#wNewVersion", "VD"); await page.click("#wAddVersion");
    await page.locator('#wVersions .wvrow[data-v="VD"]').click();
    await page.locator(".wtab", { hasText: "SLIDE_1" }).first().click();
    await page.locator('.wgrid-in td[data-r="10"][data-c="3"]').click();
    await page.locator('.wgrid-in td[data-r="11"][data-c="4"]').click({ modifiers: ["Shift"] });
    await page.click("#wDropRows");
    await page.locator('.wgrid-in td[data-r="6"][data-c="7"]').click();
    await page.click("#wDropCols");
    await expect(page.locator("#wDrops .wcut")).toHaveCount(2);
    await expect(page.locator("#wDrops .wcut").first()).toContainText("rows 10–11 deleted");
    await expect(page.locator(".wov .ovb.drop.r")).toHaveCount(1);
    await expect(page.locator(".wov .ovb.drop.c")).toHaveCount(1);
    await page.locator("#wDrops .wcut", { hasText: "column G" }).locator(".del").click();
    await expect(page.locator("#wDrops .wcut")).toHaveCount(1);
    await expect(page.locator(".wov .ovb.drop.c")).toHaveCount(0);
    await page.click('[data-a="finish"]');
    await pollFile(() => byName("VD")?.drop, { timeout: 10_000 }).toEqual({ SLIDE_1: ["10:11"] });
    // the deck now holds a deleted row: format 5 (the guard)
    await pollFile(() => fs.existsSync(path.join(deckDir("report.xlsx")!, "incident-format-5.json")), { timeout: 30_000 }).toBe(true);
    // the bank table's slide; the full deck shows Epsilon, "VD" does not
    let si = -1;
    for (let i = 0; i < await page.locator(".thumb").count() && si < 0; i++) {
      await page.locator(".thumb").nth(i).click(); await page.locator(`.thumb.on[data-i="${i}"]`).waitFor();
      if (await cell(page, "Alpha").first().waitFor({ timeout: 4000 }).then(() => true, () => false)) si = i;
    }
    expect(si).toBeGreaterThanOrEqual(0);
    await page.selectOption("#versionSel", { label: "Full deck" });
    await expect(page.locator("#versionBtn")).toBeDisabled();
    await expect(cell(page, "Epsilon")).toHaveCount(1);
    await page.selectOption("#versionSel", { label: "VD" });
    await expect(cell(page, "Epsilon")).toHaveCount(0);
    await expect(cell(page, "Alpha")).toHaveCount(1);
    // For this version ▾: Delete columns (Since, G), one step; undo, redo
    const u0 = await undoSteps(page);
    await select(page, "Since");
    await forVersion(page, "vDropCols");
    await pollFile(() => byName("VD").drop, { timeout: 10_000 }).toEqual({ SLIDE_1: ["10:11", "G"] });
    await expect(cell(page, "Since")).toHaveCount(0);
    await expect.poll(() => undoSteps(page)).toBe(u0 + 1);
    await page.keyboard.press("Control+z");
    await pollFile(() => byName("VD").drop, { timeout: 10_000 }).toEqual({ SLIDE_1: ["10:11"] });
    await expect(cell(page, "Since")).toHaveCount(1);
    await page.keyboard.press("Control+y");
    await pollFile(() => byName("VD").drop, { timeout: 10_000 }).toEqual({ SLIDE_1: ["10:11", "G"] });
    // Empty cells: Alpha's Loans emptied in place
    await select(page, "Alpha");
    await forVersion(page, "vEmpty");
    await pollFile(() => byName("VD").hide.SLIDE_1?.length, { timeout: 10_000 }).toBe(1);
    await expect(cell(page, "Alpha")).toHaveCount(0);
    // bob, at the same time, deletes a row of the pair's sheet in the same version: both lists end up there
    const bob = await browser.newPage();
    await openReport(bob, BOB);
    await change(bob, "Delete rows", [{ op: "version.patch", id: byName("VD").id, patch: { drop: { "SLIDE_3 pair": ["6"] } } }]);
    await pollFile(() => byName("VD").drop, { timeout: 15_000 }).toEqual({ SLIDE_1: ["10:11", "G"], "SLIDE_3 pair": ["6"] });
    await bob.close();
    // Restore selection across the closed-up gap (Gamma … Eta): rows 10–11 come back, G stays deleted
    await select(page, "Gamma", "Eta");
    await forVersion(page, "vRestoreSel");
    await pollFile(() => byName("VD").drop?.SLIDE_1, { timeout: 10_000 }).toEqual(["G"]);
    await expect(cell(page, "Epsilon")).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test("VD-03: the version's exports leave its rows out – PDF, PowerPoint (a real a:tbl), every version × design, Run for each value × version", async ({ page }) => {
    test.setTimeout(240_000);
    await openReport(page, ANNA);
    await change(page, "Delete rows", [{ op: "version.patch", id: byName("VD").id, patch: { drop: { SLIDE_1: ["10:11"] }, hide: null } }]);
    await pollFile(() => byName("VD").drop.SLIDE_1, { timeout: 10_000 }).toEqual(["10:11"]);
    // every version × Liquid Glass + Excel, PDF and PowerPoint
    const files = await exported(page, async () => { await page.click("#exportMenuBtn"); await page.click('[data-x="vfmt-pdf-pptx"]'); await page.click('[data-x="versions-2"]'); });
    const mine = files.filter(f => / - VD - /.test(f));
    expect(mine.length).toBe(4);
    for (const f of mine.filter(f => f.endsWith(".pptx"))) {
      const t = pptxTables(read(f)).flat();
      expect(t.length, f).toBeGreaterThan(0);
      expect(t.map(x => x.text).join(" "), f).not.toMatch(/\bEpsilon\b|\bZeta\b/);
      expect(t.map(x => x.text).join(" "), f).toMatch(/\bEta\b/);
    }
    for (const f of mine.filter(f => f.endsWith(".pdf"))) {
      const text = pdfPageTexts(read(f)).join(" ");
      expect(text, f).not.toMatch(/\bEpsilon\b/);
      expect(text, f).toMatch(/\bAlpha\b/);
    }
    // another version keeps them (the full deck's file, this design)
    const full = await exported(page, async () => { await page.selectOption("#versionSel", { label: "Full deck" }); await page.click("#exportMenuBtn"); await page.click('[data-x="pptx"]'); });
    expect(pptxTables(read(full[0])).flat().map(x => x.text).join(" ")).toMatch(/\bEpsilon\b/);
    // Run for each value × "VD": each value's files without the deleted rows
    await page.click("#exportMenuBtn"); await page.click('[data-x="scenario"]');
    await page.fill("#scInput", "SLIDE_1!L2");
    await expect(page.locator("#scInputNote")).toContainText("today");
    await page.fill("#scValues", "VD one\nVD two");
    for (const box of await page.locator("#scDesigns input").all()) await box.setChecked((await box.getAttribute("data-design")) === "excel");
    for (const box of await page.locator("#scVersions input").all()) await box.setChecked((await box.getAttribute("data-version")) === byName("VD").id);
    await page.locator("#scPdf").setChecked(true); await page.locator("#scPptx").setChecked(true);
    await page.click("#scRun");
    await expect(page.locator("#scRunStatus")).toContainText("Done: 2 of 2 values · 4 files", { timeout: 120_000 });
    const runFiles = fs.readdirSync(path.join(root(), "export")).filter(f => /^VD (one|two)\b.*VD.*Excel\.(pdf|pptx)$/.test(f));
    expect(runFiles.length).toBe(4);
    for (const f of runFiles) {
      const text = f.endsWith(".pdf") ? pdfPageTexts(read(f)).join(" ") : pptxTables(read(f)).flat().map(x => x.text).join(" ");
      expect(text, f).not.toMatch(/\bEpsilon\b/);
      expect(text, f).toMatch(/\bAlpha\b/);
    }
    await page.click("#scRunClose");
    expect(errors).toEqual([]);
  });
});
