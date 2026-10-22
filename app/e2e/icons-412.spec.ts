/* End-to-end: the icon and shape window (4.12, the owner's request of 2026-10-22) on the helper of app.spec.ts (anna
   :8951), with its own workbook (tests/fixtures/Icons.xlsx, a copy of Labels.xlsx: no other spec uses its deck).
   ICW-01 – one entry point: the ribbon's Shapes & icons… opens the window at once (no dropdown, no More icons…); its
            main area is the Tabler set (the 17 built-in icons are not offered), its side column the shapes and a text
            box – each inserted in one step.
   ICW-02 – the window fits 1024 × 768 and 1920 × 1080: inside the viewport, the grid scrolls, the side column beside
            the grid when wide and above it when narrow; no backdrop blur.
   ICW-03 – the keyboard: the search box focused, ↓ into the grid, the arrows move, Enter on a tile inserts it, Tab
            stays in the window, Escape closes it.
   ICW-04 – a deck with the 17 built-in icons (as 4.3–4.11 wrote them): drawn on the stage, no Issues line, exported
            to PDF and PowerPoint (each one custom geometry, never a picture); Change icon… on one opens the new window at
            its Tabler counterpart.
   ICW-05 – (review) nothing reaches the deck behind the window: a click on its title then Delete / Ctrl+Z / PageDown, a
            grid scrolled away from its focused tile then Delete; Escape closes from anywhere.
   ICW-06 – at 1024 × 768 the button is on the bar (PR #39 gives its group data-prio 0) and works; made the least needed
            group, it goes to More ▾ (from 944 px) and works from there. */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { fold, type DeckRecord } from "../../core/src/model/fold";

const ANNA = "http://127.0.0.1:8951/";
const BOOK = "Icons.xlsx";
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
const read = (f: string) => fs.readFileSync(path.join(root(), "export", f));

async function openPlain(page: Page) {
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
    await page.click('[data-a="next"]:has-text("Tables")'); await page.click('[data-a="next"]:has-text("Slides")'); await page.click('[data-a="finish"]');
  }
  await expect(page.locator("#fileName")).toHaveText(/^Icons\.xlsx · \d+ slides?/, { timeout: 30_000 });
  // (below 1100 px the side panel is a rail, PR #39: its slide numbers instead of the thumbnails)
  await expect(page.locator(".thumb").first().or(page.locator("#navRail")).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".thumb").first()).toBeAttached();
  await page.waitForFunction(() => (window as any).__sbTest.stageIdle(), null, { timeout: 30_000 });
}
/** the first slide's items as saved */
const items = () => ((doc().preset.slides as any[])[0].items || {}) as Record<string, any>;
const waitHits = (page: Page) => expect(page.locator("#iconGrid")).toHaveAttribute("data-n", /^[1-9]\d{3}$/, { timeout: 30_000 });
/** the built-in icons of 4.3 (core/src/render/icons.ts ICONS) */
const BUILTIN = ["arrow-up", "arrow-down", "check", "warning", "info", "flag", "star", "bank", "euro", "percent", "calendar", "chart", "target", "bell", "pin", "bulb", "lock"];

test.describe.serial("the icon and shape window (4.12)", () => {
  test("ICW-01: one entry point; the Tabler icons only; the side column inserts a shape and a text box", async ({ page }) => {
    await openPlain(page);
    await saved(page);
    await expect(page.locator("#shapeBtn")).toHaveCount(1);
    await expect(page.locator("#shapeBtn")).toHaveText(/Shapes & icons…/);
    await page.click("#shapeBtn");
    await expect(page.locator('#iconPicker [role="dialog"]')).toBeVisible();
    await expect(page.locator(".shapemenu")).toHaveCount(0);
    await expect(page.locator("#moreIcons")).toHaveCount(0);
    await expect(page.locator("#iconSearch")).toBeFocused();
    await waitHits(page);
    // the main area: Tabler ids only, none of the built-in names, whatever the search
    for (const q of ["", "warning", "bank", "pin"]) {
      await page.fill("#iconSearch", q);
      await expect(page.locator("#iconGrid")).toHaveAttribute("data-q", q, { timeout: 10_000 });
      const ids = await page.locator("#iconPicker [data-icon]").evaluateAll(es => es.map(e => (e as HTMLElement).dataset.icon!));
      expect(ids.length, q).toBeGreaterThan(0);
      expect(ids.filter(id => !/^tabler(-filled)?:/.test(id)), q).toEqual([]);
      expect(ids.filter(id => BUILTIN.includes(id)), q).toEqual([]);
    }
    // the side column: the shapes and a text box
    await expect(page.locator("#iconShapes [data-shape]")).toHaveCount(7);
    let u = await undoSteps(page);
    await page.click('#iconShapes [data-shape="round"]');
    await expect(page.locator("#iconPicker")).toHaveCount(0);
    await expect.poll(() => undoSteps(page)).toBe(u + 1);
    await pollFile(() => Object.values(items()).map(i => i.shape), { timeout: 10_000 }).toEqual(["round"]);
    u = await undoSteps(page);
    await page.click("#shapeBtn"); await page.click('#iconShapes [data-shape="text"]');
    await expect.poll(() => undoSteps(page)).toBe(u + 1);
    await pollFile(() => Object.values(items()).find(i => i.fill === "none"), { timeout: 10_000 })
      .toEqual({ kind: "shape", shape: "rect", box: { x: 640, y: 390, w: 320, h: 120 }, fill: "none", border: { color: "#000000", w: 0 }, fmt: { align: "left" } });
    await expect(page.locator(".itembox[data-kind=shape]")).toHaveCount(2, { timeout: 10_000 });
    // typed into on the slide like any callout
    const tb = Object.entries(items()).find(([, i]) => i.fill === "none")![0];
    await page.locator(`.itembox[data-item="${tb}"]`).dblclick();
    await page.locator("#itemEdit").fill("A text box");
    await page.keyboard.press("Control+Enter");
    await pollFile(() => items()[tb].text, { timeout: 10_000 }).toBe("A text box");
    await expect(page.locator(`#stage svg.layer.item[data-item="${tb}"]`)).toContainText("A text box", { timeout: 10_000 });
    // removed again (the text box on top first: both sit in the slide's middle)
    for (const id of Object.keys(items()).reverse()) { await page.locator(`.itembox[data-item="${id}"]`).click({ position: { x: 3, y: 3 } }); await page.keyboard.press("Delete"); }
    await pollFile(() => Object.keys(items()), { timeout: 10_000 }).toEqual([]);
    await saved(page);
  });

  for (const [w, h] of [[1024, 768], [1920, 1080], [1280, 800]] as [number, number][]) {
    test(`ICW-02: the window fits ${w} × ${h}: inside the viewport, the grid scrolls, the side column ${w > 1100 ? "beside" : "above"} the grid; no backdrop blur`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await openPlain(page);
      await page.click("#shapeBtn");
      await waitHits(page);
      const m = await page.evaluate(() => {
        const r = (s: string) => document.querySelector(s)!.getBoundingClientRect(), g = document.querySelector<HTMLElement>("#iconGrid")!;
        return { dlg: r(".icdlg").toJSON(), grid: r("#iconGrid").toJSON(), side: r("#iconShapes").toJSON(), opts: r(".icopts").toJSON(),
          scroll: [g.scrollHeight, g.clientHeight, g.scrollWidth, g.clientWidth], page: [document.documentElement.scrollWidth, document.documentElement.scrollHeight, innerWidth, innerHeight],
          blur: getComputedStyle(document.querySelector("#iconPicker")!).backdropFilter, cols: +g.dataset.cols! };
      });
      expect(m.dlg.left).toBeGreaterThanOrEqual(0); expect(m.dlg.top).toBeGreaterThanOrEqual(0);
      expect(m.dlg.right).toBeLessThanOrEqual(w); expect(m.dlg.bottom).toBeLessThanOrEqual(h);
      expect(m.dlg.width).toBeGreaterThanOrEqual(Math.min(1100, w - 32));            // large
      expect(m.opts.bottom).toBeLessThanOrEqual(m.dlg.bottom + 0.5);                 // the options and Cancel inside
      expect(m.page[0]).toBeLessThanOrEqual(m.page[2]);                              // no page scroll
      expect(m.scroll[0]).toBeGreaterThan(m.scroll[1]);                              // the grid scrolls…
      expect(m.scroll[2]).toBeLessThanOrEqual(m.scroll[3]);                          // …only down
      expect(m.grid.height).toBeGreaterThanOrEqual(4 * 46);
      expect(m.cols).toBe(Math.floor(m.scroll[3] / 46));                            // as many columns as fit
      expect(["none", ""]).toContain(m.blur);
      if (w > 1100) { expect(m.side.left).toBeGreaterThanOrEqual(m.grid.right - 0.5); expect(m.side.top).toBeLessThan(m.grid.bottom); }
      else { expect(m.side.bottom).toBeLessThanOrEqual(m.grid.top + 0.5); expect(m.side.height).toBeLessThan(100); }
      // every side entry visible inside the window
      for (const b of await page.locator("#iconShapes [data-shape]").all()) {
        const bb = (await b.boundingBox())!;
        expect(bb.x + bb.width).toBeLessThanOrEqual(m.dlg.right); expect(bb.y + bb.height).toBeLessThanOrEqual(m.dlg.bottom);
      }
      await page.keyboard.press("Escape");
      await expect(page.locator("#iconPicker")).toHaveCount(0);
    });
  }

  test("ICW-03: the keyboard – search focused, ↓ into the grid, arrows, Enter on a tile inserts it, Tab stays in the window, Escape closes", async ({ page }) => {
    await openPlain(page);
    await page.click("#shapeBtn");
    await waitHits(page);
    await expect(page.locator("#iconSearch")).toBeFocused();
    await page.fill("#iconSearch", "arrow");
    await expect(page.locator("#iconGrid")).toHaveAttribute("data-q", "arrow", { timeout: 10_000 });
    const cols = +(await page.locator("#iconGrid").getAttribute("data-cols"))!;
    const idx = () => page.evaluate(() => (document.activeElement as HTMLElement).dataset.idx ?? (document.activeElement as HTMLElement).id);
    await page.keyboard.press("ArrowDown"); expect(await idx()).toBe("0");
    await page.keyboard.press("ArrowRight"); expect(await idx()).toBe("1");
    await page.keyboard.press("ArrowDown"); expect(await idx()).toBe(String(cols + 1));
    for (let k = 0; k < 12; k++) await page.keyboard.press("ArrowDown");             // past the rows in view: scrolled
    expect(await idx()).toBe(String(13 * cols + 1));
    await expect(page.locator(`#iconGrid [data-idx="${13 * cols + 1}"]`)).toBeInViewport();
    await page.keyboard.press("Home"); expect(await idx()).toBe("0");
    await page.keyboard.press("ArrowUp"); expect(await idx()).toBe("iconSearch");
    // Tab round the window and back to the search box: the focus never leaves it
    const n = await page.locator('.icdlg :is(input:not([disabled]), button:not([disabled]):not([tabindex="-1"]))').count();
    for (let k = 0; k < n; k++) { await page.keyboard.press("Tab"); expect(await page.evaluate(() => !!document.activeElement?.closest(".icdlg"))).toBe(true); }
    expect(await idx()).toBe("iconSearch");
    await page.keyboard.press("Shift+Tab"); expect(await idx()).toBe("iconCancel");
    // Enter on a tile inserts that icon (one step, the window closed)
    await page.locator("#iconSearch").focus();
    await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowRight");
    const want = await page.evaluate(() => (document.activeElement as HTMLElement).dataset.icon!);
    expect(want).toMatch(/^tabler(-filled)?:/);
    const u = await undoSteps(page);
    await page.keyboard.press("Enter");
    await expect(page.locator("#iconPicker")).toHaveCount(0);
    await expect.poll(() => undoSteps(page)).toBe(u + 1);
    await pollFile(() => Object.values(items()).map(i => i.icon), { timeout: 10_000 }).toEqual([want]);
    // Escape closes, nothing inserted; the focus back on the button
    await page.click("#shapeBtn");
    await expect(page.locator("#iconSearch")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("#iconPicker")).toHaveCount(0);
    await expect(page.locator("#shapeBtn")).toBeFocused();
    expect(await undoSteps(page)).toBe(u + 1);
    // removed again
    const id = Object.keys(items())[0];
    await page.locator(`.itembox[data-item="${id}"]`).click({ position: { x: 3, y: 3 } }); await page.keyboard.press("Delete");
    await pollFile(() => Object.keys(items()), { timeout: 10_000 }).toEqual([]);
    await saved(page);
  });

  test("ICW-04: a deck with the 17 built-in icons draws, exports to PDF and PowerPoint as before; Change icon… opens the new window", async ({ page }) => {
    await openPlain(page);
    await saved(page);
    const S = (doc().preset.slides as any[])[0];
    // the icons as 4.3–4.11 wrote them (a built-in name in `icon`), on a 6-column grid
    const ops = BUILTIN.map((n, k) => ({ op: "item.patch", slide: S.id, id: "old" + k, patch: { kind: "shape", shape: "icon", icon: n, ...(k % 3 ? { fill: "#C42B1C" } : {}), box: { x: 80 + (k % 6) * 90, y: 300 + Math.floor(k / 6) * 90, w: 64, h: 64 } } }));
    const u = await undoSteps(page);
    await change(page, "Insert icon", ops);
    await expect.poll(() => undoSteps(page)).toBe(u + 1);
    await pollFile(() => Object.values(items()).map(i => i.icon).sort(), { timeout: 10_000 }).toEqual([...BUILTIN].sort());
    await saved(page);
    for (let k = 0; k < BUILTIN.length; k++) await expect(page.locator(`#stage svg.layer.item[data-item="old${k}"] path`).first()).toBeAttached({ timeout: 10_000 });
    await expect(page.locator("#issues")).not.toContainText("is not in the icon set");
    // the PDF and the PowerPoint file: each icon custom geometry
    const pdf = read((await exported(page, () => page.click("#exportBtn")))[0]);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const z = unzipSync(new Uint8Array(read((await exported(page, async () => { await page.click("#exportMenuBtn"); await page.click('[data-x="pptx"]'); })).slice(-1)[0])));
    const slide1 = strFromU8(z["ppt/slides/slide1.xml"]);
    // (the slide's only custom geometry: one shape per icon; its one picture is the table's Liquid Glass card)
    expect((slide1.match(/<a:custGeom>/g) || []).length).toBe(BUILTIN.length);
    // Change icon… on the old "warning": the new window, at its Tabler counterpart (filled)
    const k = BUILTIN.indexOf("warning");
    await page.locator(`.itembox[data-item="old${k}"]`).click({ position: { x: 3, y: 3 } });
    await page.click("#iconChange");
    await expect(page.locator("#iconPicker .dlghd b")).toHaveText("Change icon");
    await expect(page.locator("#iconSearch")).toHaveValue("alert triangle");
    await expect(page.locator("#iconGrid")).toHaveAttribute("data-q", "alert triangle", { timeout: 20_000 });
    await expect(page.locator("#iconGrid .ictile").first()).toHaveAttribute("data-icon", "tabler-filled:alert-triangle");
    await expect(page.locator("#iconShapes")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.locator("#iconPicker")).toHaveCount(0);
    expect(items()["old" + k].icon).toBe("warning");                                // nothing changed
  });

  test("ICW-05: the deck behind the window is out of reach – a click on its title, Delete, Ctrl+Z, a scrolled grid; Escape closes", async ({ page }) => {
    await openPlain(page);
    await saved(page);
    const S = (doc().preset.slides as any[])[0];
    let u = await undoSteps(page);
    await change(page, "Insert shape", [{ op: "item.patch", slide: S.id, id: "keep1", patch: { kind: "shape", shape: "pill", box: { x: 100, y: 100, w: 320, h: 120 } } }]);
    await expect.poll(() => undoSteps(page)).toBe(u + 1);
    await pollFile(() => Object.keys(items()).includes("keep1"), { timeout: 10_000 }).toBe(true);
    const all0 = Object.keys(items()).sort();                                     // (ICW-04's icons stay on this slide)
    await page.locator('.itembox[data-item="keep1"]').click({ position: { x: 4, y: 4 } });
    await expect(page.locator("#shapeTools")).toBeVisible();
    u = await undoSteps(page);
    // a click on the window's title: the focus stays in the window; Delete, Ctrl+Z and PageDown change nothing behind it
    await page.click("#shapeBtn"); await waitHits(page);
    await page.click("#iconPickerTitle");
    expect(await page.evaluate(() => !!document.activeElement?.closest(".icdlg"))).toBe(true);
    for (const k of ["Delete", "Backspace", "Control+z", "PageDown"]) await page.keyboard.press(k);
    await expect(page.locator("#iconPicker")).toBeVisible();
    await page.waitForTimeout(500);
    expect(await undoSteps(page)).toBe(u);
    await pollFile(() => Object.keys(items()).sort(), { timeout: 10_000 }).toEqual(all0);
    // Tab from there goes into the window, Escape closes it
    await page.click("#iconPickerTitle"); await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest(".icdlg"))).toBe(true);
    await page.click("#iconPickerTitle"); await page.keyboard.press("Escape");
    await expect(page.locator("#iconPicker")).toHaveCount(0);
    // ↓ into the grid, the grid scrolled far (its focused tile no longer drawn): the focus on the grid, Delete does nothing
    await page.click("#shapeBtn"); await waitHits(page);
    await page.keyboard.press("ArrowDown");
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.idx)).toBe("0");
    await page.locator("#iconGrid").evaluate(g => { g.scrollTop = 40 * 46; });
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("iconGrid");
    await page.keyboard.press("Delete");
    await page.waitForTimeout(500);
    expect(await undoSteps(page)).toBe(u);
    await pollFile(() => Object.keys(items()).sort(), { timeout: 10_000 }).toEqual(all0);
    // the arrow keys go on from the grid
    await page.keyboard.press("ArrowRight");
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.idx)).toBe("1");
    await page.keyboard.press("Escape");
    await expect(page.locator("#iconPicker")).toHaveCount(0);
    // removed again
    await page.locator('.itembox[data-item="keep1"]').click({ position: { x: 4, y: 4 } }); await page.keyboard.press("Delete");
    await pollFile(() => Object.keys(items()).includes("keep1"), { timeout: 10_000 }).toBe(false);
    await saved(page);
  });

  test("ICW-06: at 1024 × 768 the button is on the bar (its group data-prio 0, PR #39) and works; and from More ▾ when its group is there", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openPlain(page);
    await saved(page);
    const btn = page.locator("#shapeBtn"), bar = page.locator(".obar", { has: btn });
    // its group in More ▾: the bar is told to show it there (the narrowest case of #39's plan), whatever this window fits
    const inMore = await btn.evaluate(b => !!b.closest("[data-ovf]"));
    console.log("ICW-06: Shapes & icons… is " + (inMore ? "in More ▾" : "on the bar") + " at 1024 × 768");
    if (inMore || !(await btn.isVisible())) {
      await bar.locator(":scope > .obmore").click();
      await expect(bar).toHaveAttribute("data-more", "");
    }
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(page.locator('#iconPicker [role="dialog"]')).toBeVisible();
    await waitHits(page);
    const box = (await page.locator(".icdlg").boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(1024);
    expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(768);
    const before = Object.keys(items()), u = await undoSteps(page);
    await page.click('#iconShapes [data-shape="arrow"]');
    await expect(page.locator("#iconPicker")).toHaveCount(0);
    await expect.poll(() => undoSteps(page)).toBe(u + 1);
    await pollFile(() => Object.values(items()).filter((i: any) => i.shape === "arrow").length, { timeout: 10_000 }).toBe(1);
    const id = Object.keys(items()).find(k => !before.includes(k))!;
    await page.keyboard.press("Escape");
    await page.locator(`.itembox[data-item="${id}"]`).click({ position: { x: 4, y: 4 } }); await page.keyboard.press("Delete");
    await pollFile(() => Object.keys(items()).includes(id), { timeout: 10_000 }).toBe(false);
    await saved(page);
    // its group in More ▾ for sure. #39 gives the Insert group data-prio 0 (the most needed: it goes to More last, so at
    // 1024 × 768 it stays on the bar); here it is made the least needed and the window narrowed until the bar moves it
    await btn.evaluate(b => b.closest(".grp")!.setAttribute("data-prio", "9"));
    let w = 1024;
    await page.setViewportSize({ width: 1000, height: 768 }); await page.setViewportSize({ width: w, height: 768 }); await page.waitForTimeout(150);
    while (!(await btn.evaluate(b => !!b.closest("[data-ovf]"))) && w > 560) { w -= 40; await page.setViewportSize({ width: w, height: 768 }); await page.waitForTimeout(150); }
    console.log("ICW-06: in More ▾ from " + w + " px");
    expect(await btn.evaluate(b => !!b.closest("[data-ovf]"))).toBe(true);
    await expect(btn).toBeHidden();
    await bar.locator(":scope > .obmore").click();
    await expect(bar).toHaveAttribute("data-more", "");
    await btn.click();
    await expect(page.locator('#iconPicker [role="dialog"]')).toBeVisible();
    await waitHits(page);
    const nb = (await page.locator(".icdlg").boundingBox())!;
    expect(nb.x).toBeGreaterThanOrEqual(0); expect(nb.x + nb.width).toBeLessThanOrEqual(w);
    const u2 = await undoSteps(page), before2 = Object.keys(items());
    await page.click('#iconShapes [data-shape="text"]');
    await expect(page.locator("#iconPicker")).toHaveCount(0);
    await expect.poll(() => undoSteps(page)).toBe(u2 + 1);
    await pollFile(() => Object.keys(items()).filter(k => !before2.includes(k)).length, { timeout: 10_000 }).toBe(1);
    await page.click("#undoBtn").catch(async () => { await page.keyboard.press("Control+z"); });
    await pollFile(() => Object.keys(items()).filter(k => !before2.includes(k)).length, { timeout: 10_000 }).toBe(0);
    await saved(page);
  });

  test("no page errors", async () => { expect(errors).toEqual([]); });
});
