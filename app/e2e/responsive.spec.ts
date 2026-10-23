/* End-to-end: the window's size and the slide's zoom (4.12, the owner's request of 2026-10-22: "Control plus scroll
   wheel should zoom into the slide and not the entire page … the toolbars at the top and on the left should adapt
   responsively"). Its own workbook (tests/fixtures/Zoom.xlsx, a copy of Panel.xlsx: no other spec uses its deck).
   RZ-01 – at 1024×768, 1280×720, 1366×768, 1440×900, 1536×864 and 1920×1080: the page never scrolls sideways; the top bar
           and the text ribbon keep to one row, the layout ribbon to two, every control on them inside the window – a group
           that does not fit is in More ▾, and there inside the window too; the side panel works (a rail below 1100 px, its » opens it,
           « folds it, the choice kept); the slide is on the stage, the status bar's zoom inside the window. Again with
           Windows' display scaling, 125 % (1536×864) and 150 % (1280×720). Pictures: $SB_RESPONSIVE_SHOTS/
           responsive-1024.png, -1366.png, -1920.png.
   RZ-02 – Ctrl + wheel over the slide zooms the slide, the point under the pointer staying there – the page's own zoom
           (devicePixelRatio, innerWidth, visualViewport.scale) never changes and the page never scrolls; zoomed in, a
           plain wheel scrolls the stage, Shift + wheel sideways; Ctrl + = / − / 0 and the status bar's − / + / Fit;
           over the side panel Ctrl + wheel zooms the slide too; the zoom is not in the deck.
   RZ-03 – at 200 % a shape dragged 100 × 60 screen px (Alt: no snapping) moves 50 × 30 slide px, saved so; its box on
           the stage stays on the slide's drawing. Picture: zoom-200.png.
   RZ-04 – (4.13.1) right after resize() the bars' marks are those of the new width, More ▾ shown exactly when it holds
           groups (RZ-01 had read them before the page measured: CI on PR #42). */
import { test, expect, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fold, type DeckRecord } from "../../core/src/model/fold";

const ANNA = "http://127.0.0.1:8951/";
const BOOK = "Zoom.xlsx";
const SHOTS = process.env.SB_RESPONSIVE_SHOTS || "";
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
function doc(): any {
  const d = deckDir(BOOK)!;
  const snap = JSON.parse(fs.readFileSync(path.join(d, "snapshot.json"), "utf8"));
  let names: string[] = []; try { names = fs.readdirSync(path.join(d, "j")); } catch { /* no journal yet */ }
  return fold(snap, names.flatMap(n => frames(fs.readFileSync(path.join(d, "j", n)), snap.frontier[n.replace(/\.log$/, "")] || 0))).doc;
}
const pollFile = <T>(read: () => T, opts?: { timeout?: number }) =>
  expect.poll(() => { try { return read(); } catch (e) { return "not saved yet: " + (e as Error).message; } }, opts);
const saved = (page: Page) => expect(page.locator("#sbSave")).toHaveText("✓ Saved", { timeout: 40_000 });
const change = (page: Page, label: string, ops: object[]) => page.evaluate(([l, o]) => (window as any).__sbTest.change(l, o), [label, ops] as const);
const idle = (page: Page) => page.waitForFunction(() => (window as any).__sbTest.stageIdle());

async function openDeck(page: Page) {
  await page.goto(ANNA);
  await page.locator("#openBtn").waitFor({ state: "attached" });
  // the workbook opened last opens by itself: waited for before opening this one
  let last: string | null = null;
  try { last = JSON.parse(fs.readFileSync(path.join(data(), "users", "anna.json"), "utf8")).lastFile || null; } catch { /* first start */ }
  if (last) await expect(page.locator("#fileName")).toHaveText(new RegExp("^" + last.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " · \\d+ slides?"), { timeout: 30_000 });
  // (a narrow window: Open may be in More ▾)
  if (!(await page.locator("#openBtn").isVisible())) await page.locator(".topbar .obmore").click();
  await page.click("#openBtn");
  await page.click(`[data-f="${BOOK}"]`);
  const wizard = page.locator(".wiz"), cont = page.locator('[data-a="continue"]');
  await expect(wizard.or(cont)).toBeVisible({ timeout: 20_000 });
  if (await cont.isVisible()) await cont.click();
  else { await page.click('[data-a="next"]:has-text("Tables")'); await page.click('[data-a="next"]:has-text("Slides")'); await page.click('[data-a="finish"]'); }
  await expect(page.locator("#fileName")).toHaveText(/^Zoom\.xlsx · \d+ slides?/, { timeout: 30_000 });
  await expect(page.locator("#stage .slide .t", { hasText: /^Week 38$/ })).toHaveCount(1, { timeout: 30_000 });
  await idle(page);
}

/** what is wrong with the page's layout at this window size (an empty list: nothing) */
const layoutProblems = (page: Page) => page.evaluate(() => {
  const out: string[] = [], W = innerWidth, H = innerHeight;
  const name = (e: Element) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (typeof e.className === "string" && e.className ? "." + e.className.trim().split(/\s+/).join(".") : "");
  const vis = (e: Element) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden"; };
  const de = document.documentElement;
  if (de.scrollWidth > W + 1 || document.body.scrollWidth > W + 1) out.push(`the page is wider than the window: ${Math.max(de.scrollWidth, document.body.scrollWidth)} > ${W}`);
  if (scrollX || scrollY) out.push(`the page is scrolled: ${scrollX}, ${scrollY}`);
  // the bars: one row, every control drawn inside the window and inside its bar's row
  for (const bar of document.querySelectorAll<HTMLElement>(".topbar, .ribbon")) {
    const br = bar.getBoundingClientRect();
    if (bar.hasAttribute("data-more")) out.push(`${name(bar)}: More is open`);
    const rows = +(bar.getAttribute("data-max-rows") || 1);
    if (br.height > 52 * rows) out.push(`${name(bar)} is ${Math.round(br.height)} px tall (more than ${rows} row${rows > 1 ? "s" : ""})`);
    for (const c of bar.querySelectorAll("button, input:not([type=file]), select, .target, .fname")) {
      if (!vis(c)) continue;
      const r = c.getBoundingClientRect();
      if (r.left < -.5 || r.right > W + .5) out.push(`${name(c)} outside the window (${Math.round(r.left)}…${Math.round(r.right)} of ${W})`);
      if (r.top < br.top - .5 || r.bottom > br.bottom + .5) out.push(`${name(c)} outside its bar's row`);
      // not covered by a neighbour (a control squeezed under another)
      const at = document.elementFromPoint(Math.min(W - 1, Math.max(0, r.left + r.width / 2)), r.top + r.height / 2);
      if (at && !c.contains(at) && !at.contains(c) && !c.closest(".dd")?.contains(at)) out.push(`${name(c)} covered by ${name(at)}`);
    }
  }
  // the stage: the slide drawn, inside the canvas
  const cv = document.querySelector(".canvas")!.getBoundingClientRect(), sw = document.querySelector("#stage .stagewrap")?.getBoundingClientRect();
  if (!sw || sw.width < 300) out.push(`the slide is ${sw ? Math.round(sw.width) : 0} px wide`);
  else if (sw.left < cv.left - .5 || sw.right > cv.right + .5 || sw.top < cv.top - .5 || sw.bottom > cv.bottom + .5) out.push("the slide runs out of the stage");
  // the status bar: its zoom inside the window, nothing sideways
  const sb = document.querySelector<HTMLElement>(".statusbar")!, z = document.querySelector("#zoomctl")?.getBoundingClientRect();
  if (!z || z.right > W + .5 || z.left < 0) out.push("the zoom control is not inside the window");
  if (sb.scrollWidth > sb.clientWidth + 1) out.push(`the status bar overflows: ${sb.scrollWidth} > ${sb.clientWidth}`);
  if (sb.getBoundingClientRect().bottom > H + .5) out.push("the status bar is below the window");
  // the side panel: never wider than half the window (or its 280 px), never sideways
  const N = document.querySelector<HTMLElement>("aside.nav")!, nw = N.getBoundingClientRect().width;
  if (nw > Math.max(280, W / 2) + 1) out.push(`the side panel is ${nw} px wide`);
  if (N.scrollWidth > N.clientWidth + 1) out.push("the side panel scrolls sideways");
  return out;
});

/** the window resized, and the page past it. setViewportSize returns with innerWidth already new, but Chromium
    dispatches the window's `resize` event – where each OverflowBar measures again (ui/OverflowBar.tsx) – only in the
    next rendering step: until then the bars carry the marks of the old width (RZ-01 in CI on PR #42 read the previous
    size's data-has-more, then waited 90 s on a More button already hidden; RZ-04). One animation frame: the resize steps
    run before its callbacks */
async function resize(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => r())));
}

/** a bar's More ▾ in one read: how many groups it holds (data-has-more) and whether its button is drawn */
const moreState = (bar: Locator) => bar.evaluate((b: HTMLElement) => {
  const m = b.querySelector<HTMLElement>(":scope > .obmore"), r = m?.getBoundingClientRect();
  return { n: Number(b.getAttribute("data-has-more") || 0), shown: !!m && !!r && r.width > 0 && r.height > 0 && getComputedStyle(m).visibility !== "hidden" };
});

/** every control in a bar's More ▾: shown when it opens, inside the window and below the bar's first row */
async function moreProblems(page: Page): Promise<string[]> {
  const out: string[] = [];
  const bars = page.locator(".topbar, .ribbon");
  for (let i = 0; i < await bars.count(); i++) {
    // read at once, in the page: its groups in More and its More button shown – the one without the other is a bug
    const bar = bars.nth(i), { n, shown } = await moreState(bar);
    expect(shown, `bar ${i}: More ▾ shown exactly when it holds groups (data-has-more ${n})`).toBe(n > 0);
    if (!n) continue;
    await bar.locator(":scope > .obmore").click();
    await expect(bar).toHaveAttribute("data-more", "");
    out.push(...await bar.evaluate((b: HTMLElement) => {
      const o: string[] = [], W = innerWidth, groups = [...b.querySelectorAll(":scope > [data-ovf]")];
      if (!groups.length) o.push("More holds nothing");
      for (const g of groups) for (const c of [g, ...g.querySelectorAll("button, input, select")]) {
        const r = c.getBoundingClientRect();
        if (c === g && !(r.width > 0 && r.height > 0)) o.push(`a group in More is not shown: ${g.className}`);
        if (r.width > 0 && (r.left < -.5 || r.right > W + .5)) o.push(`${c.id || c.className} in More is outside the window`);
      }
      return o;
    }));
    await bar.locator(":scope > .obmore").click();            // closed again (Esc would also clear the cell selected)
    await expect(bar).not.toHaveAttribute("data-more", "");
  }
  return out;
}

const SIZES: [number, number][] = [[1024, 768], [1280, 720], [1366, 768], [1440, 900], [1536, 864], [1920, 1080]];

test.describe("responsive", () => {
  test("RZ-01: at every window size the bars keep their rows (the rest in More ▾), the panel and the stage work", async ({ page }) => {
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    await resize(page, 1366, 768);
    await openDeck(page);
    await saved(page);
    // a cell selected: the text tools are on
    const cb = (await page.locator("#stage .slide .t", { hasText: /^Week 38$/ }).boundingBox())!;
    await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2);
    await expect(page.locator("#textTarget")).not.toHaveText("No text selected");
    for (const [w, h] of SIZES) {
      await resize(page, w, h);
      await expect.poll(() => layoutProblems(page), { message: `${w}×${h}` }).toEqual([]);
      expect(await moreProblems(page), `${w}×${h}`).toEqual([]);
      // the side panel: a rail below 1100 px, open above (nothing chosen yet)
      const rail = w < 1100;
      await expect(page.locator("aside.nav")).toHaveClass(rail ? /\brail\b/ : /^nav$/);
      await expect(page.locator(rail ? "#navRail" : "#thumbs")).toBeVisible();
      if (!rail) expect(await page.locator("aside.nav").evaluate(e => e.getBoundingClientRect().width)).toBeGreaterThanOrEqual(280);
      if (SHOTS && [1024, 1366, 1920].includes(w)) await page.screenshot({ path: path.join(SHOTS, `responsive-${w}.png`) });
    }
    // More ▾ at 1024: what it holds works from there – the alignment of the selected cell
    await resize(page, 1024, 768);
    await expect.poll(() => layoutProblems(page)).toEqual([]);
    const r1 = page.locator("nav.ribbon:not(.ribbon2)");
    expect(Number(await r1.getAttribute("data-has-more"))).toBeGreaterThan(0);
    await expect(page.locator('[data-align="right"]')).toBeHidden();
    await r1.locator(":scope > .obmore").click();
    await page.locator('[data-align="right"]').click();
    await expect(page.locator('[data-align="right"]')).toHaveClass(/\bon\b/);
    await page.locator('[data-align="auto"]').click();          // back to Excel's
    await page.keyboard.press("Escape");                          // Esc closes More
    await expect(r1).not.toHaveAttribute("data-more", "");
    await expect(page.locator('[data-align="right"]')).toBeHidden();
    // the rail at 1024: » opens the panel (kept), « folds it again (kept); the slide numbers show the slide
    await page.locator("#navRail #navRailBtn").click();
    await expect(page.locator("aside.nav")).not.toHaveClass(/\brail\b/);
    await expect(page.locator("#thumbs")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("sbNavRail"))).toBe("open");
    await expect.poll(() => layoutProblems(page)).toEqual([]);
    await page.locator(".navhd #navRailBtn").click();
    await expect(page.locator("aside.nav")).toHaveClass(/\brail\b/);
    expect(await page.evaluate(() => localStorage.getItem("sbNavRail"))).toBe("rail");
    await resize(page, 1920, 1080);
    await expect(page.locator("aside.nav")).toHaveClass(/\brail\b/);    // chosen: at every width
    await page.locator("#navRail .railslide").first().click();
    await expect(page.locator("#navRail .railslide").first()).toHaveClass(/\bon\b/);
    await page.locator("#navRail #navRailBtn").click();
    await page.evaluate(() => localStorage.removeItem("sbNavRail"));
    expect(errors).toEqual([]);
  });

  for (const [scale, w, h] of [[1.25, 1536, 864], [1.5, 1280, 720]] as const) {
    test(`RZ-01: Windows display scaling ${scale * 100} % (${w}×${h} CSS px)`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
      const page = await ctx.newPage();
      try {
        await openDeck(page);
        expect(await page.evaluate(() => devicePixelRatio)).toBe(scale);
        await expect.poll(() => layoutProblems(page)).toEqual([]);
        expect(await moreProblems(page)).toEqual([]);
      } finally { await ctx.close(); }
    });
  }

  // 4.13.1: RZ-01 read a bar's data-has-more before the page had measured the new width (CI on PR #42) – resize() waits
  // for that; here the window goes from one size to another where the bars' More ▾ changes, and right after resize()
  // the marks are those of the new width (the same a frame later), More ▾ shown exactly when it holds groups
  test("RZ-04: right after the window is resized the bars' marks are those of the new width", async ({ page }) => {
    await resize(page, 1024, 768);
    await page.goto(ANNA);
    await page.locator("#openBtn").waitFor({ state: "attached" });
    // every bar in one read (the same test as moreState)
    const state = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".topbar, .ribbon")].map(b => {
      const m = b.querySelector<HTMLElement>(":scope > .obmore"), r = m?.getBoundingClientRect();
      return { n: Number(b.getAttribute("data-has-more") || 0), shown: !!m && !!r && r.width > 0 && r.height > 0 && getComputedStyle(m).visibility !== "hidden" };
    }));
    const frame = () => page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    await frame();
    for (let k = 0; k < 6; k++) for (const w of [1920, 1024]) {
      await resize(page, w, 768);
      const now = await state();
      for (const s of now) expect(s.shown, `${w}: More ▾ shown exactly when it holds groups`).toBe(s.n > 0);
      // the narrow window has groups in More, the wide one none: each step changes the marks
      expect(now.some(s => s.n > 0), `${w}`).toBe(w === 1024);
      await frame();
      expect(await state(), `${w}: the same a frame later`).toEqual(now);
    }
  });

  test("RZ-02: Ctrl + wheel zooms the slide at the pointer, never the page; the wheel scrolls the zoomed stage; the keys and the status bar", async ({ page }) => {
    await resize(page, 1366, 768);
    await openDeck(page);
    const view = () => page.evaluate(() => ({ dpr: devicePixelRatio, w: innerWidth, vv: visualViewport?.scale ?? 1, sx: scrollX, sy: scrollY,
      top: document.scrollingElement!.scrollTop, left: document.scrollingElement!.scrollLeft }));
    const v0 = await view();
    expect(v0).toEqual({ dpr: 1, w: 1366, vv: 1, sx: 0, sy: 0, top: 0, left: 0 });
    const zoomPct = async () => Number((await page.locator("#zoomVal").textContent())!.replace("%", ""));
    const fit = await zoomPct();
    await expect(page.locator("#zoomFit")).toHaveClass(/\bon\b/);
    /** the slide point (slide px) under screen point (x, y) */
    const slidePoint = (x: number, y: number) => page.locator("#stage .slide").evaluate((s, [x, y]) => {
      const r = s.getBoundingClientRect(), k = r.width / 1600; return { x: (x - r.left) / k, y: (y - r.top) / k };
    }, [x, y] as const);
    const cell = (await page.locator("#stage .slide .t", { hasText: /^Week 38$/ }).boundingBox())!;
    const x = cell.x + cell.width / 2, y = cell.y + cell.height / 2, p0 = await slidePoint(x, y);
    await page.mouse.move(x, y);
    await page.keyboard.down("Control");
    for (let k = 0; k < 4; k++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(40); }
    await page.keyboard.up("Control");
    await expect.poll(zoomPct).toBeGreaterThan(fit * 1.8);
    await idle(page);
    const p1 = await slidePoint(x, y);
    expect(Math.abs(p1.x - p0.x)).toBeLessThan(3); expect(Math.abs(p1.y - p0.y)).toBeLessThan(3);   // still under the pointer
    expect(await view()).toEqual(v0);                                   // the page did not zoom, nor scroll
    await expect(page.locator("#zoomFit")).not.toHaveClass(/\bon\b/);
    // the zoom is the view's: not in the deck
    expect(JSON.stringify(doc())).not.toMatch(/"zoom"/);
    // zoomed in: a plain wheel scrolls the stage, Shift + wheel sideways; the zoom stays
    const z1 = await zoomPct(), sc = () => page.locator("#stage").evaluate(e => ({ l: e.scrollLeft, t: e.scrollTop }));
    const s0 = await sc();
    await page.mouse.wheel(0, 120);
    await expect.poll(async () => (await sc()).t).toBeGreaterThan(s0.t);
    await page.keyboard.down("Shift"); await page.mouse.wheel(0, 120); await page.keyboard.up("Shift");
    await expect.poll(async () => (await sc()).l).toBeGreaterThan(s0.l);
    expect(await zoomPct()).toBe(z1);
    expect(await view()).toEqual(v0);
    // Ctrl + wheel down: out again, at least to 25 %
    await page.keyboard.down("Control");
    for (let k = 0; k < 25; k++) await page.mouse.wheel(0, 200);
    await page.keyboard.up("Control");
    await expect.poll(zoomPct).toBe(25);
    expect(await view()).toEqual(v0);
    // the keys: Ctrl + 0 fits, Ctrl + = steps in, Ctrl + − out; the page never zooms
    await page.keyboard.press("Control+0");
    await expect.poll(zoomPct).toBe(fit);
    await expect(page.locator("#zoomFit")).toHaveClass(/\bon\b/);
    await page.keyboard.press("Control+Equal");
    await expect.poll(zoomPct).toBeGreaterThan(fit);
    const z2 = await zoomPct();
    await page.keyboard.press("Control+Minus");
    await expect.poll(zoomPct).toBeLessThan(z2);
    expect(await view()).toEqual(v0);
    // the status bar: 100 %, +, −, Fit
    await page.click("#zoomVal"); await expect.poll(zoomPct).toBe(100);
    await page.click("#zoomIn"); await expect.poll(zoomPct).toBe(110);
    await page.click("#zoomOut"); await page.click("#zoomOut"); await expect.poll(zoomPct).toBe(90);
    await page.click("#zoomFit"); await expect.poll(zoomPct).toBe(fit);
    // over the side panel: the slide zooms (about the stage's middle), the page does not
    const nav = (await page.locator("aside.nav").boundingBox())!;
    await page.mouse.move(nav.x + nav.width / 2, nav.y + 150);
    await page.keyboard.down("Control"); await page.mouse.wheel(0, -100); await page.keyboard.up("Control");
    await expect.poll(zoomPct).toBeGreaterThan(fit);
    expect(await view()).toEqual(v0);
    // a window resize keeps a chosen zoom; at Fit it fits again
    const z3 = await zoomPct();
    await resize(page, 1280, 720);
    await expect.poll(zoomPct).toBe(z3);
    await page.keyboard.press("Control+0");
    const fit2 = await zoomPct();
    await resize(page, 1440, 900);
    await expect.poll(zoomPct).toBeGreaterThan(fit2);
    await resize(page, 1366, 768);
    await expect.poll(zoomPct).toBe(fit);
  });

  test("RZ-03: at 200 % a drag moves a shape by half the screen px; its box stays on the drawing", async ({ page }) => {
    await resize(page, 1366, 768);
    await openDeck(page);
    const S = doc().preset.slides[0], items = () => (doc().preset.slides[0].items || {}) as Record<string, any>;
    const box0 = { x: 400, y: 600, w: 160, h: 100 };
    await change(page, "Insert shape", [{ op: "item.patch", slide: S.id, id: "rzs", patch: { kind: "shape", shape: "rect", box: box0 } }]);
    await pollFile(() => items().rzs?.box, { timeout: 10_000 }).toEqual(box0);
    await idle(page);
    // 200 %: 100 %, then Ctrl + = to 200
    await page.click("#zoomVal");
    for (const z of [110, 125, 150, 175, 200]) { await page.keyboard.press("Control+Equal"); await expect(page.locator("#zoomVal")).toHaveText(z + "%"); }
    await idle(page);
    const it = page.locator('.itembox[data-item="rzs"]');
    await it.scrollIntoViewIfNeeded();
    const k = (await page.locator("#stage .slide").boundingBox())!.width / 1600;
    expect(k).toBeCloseTo(2, 3);
    /** the item's box on the stage, in slide px (from the slide's corner) */
    const onStage = () => it.evaluate(e => { const s = document.querySelector("#stage .slide")!.getBoundingClientRect(), r = e.getBoundingClientRect(), k = s.width / 1600;
      return { x: (r.left - s.left) / k, y: (r.top - s.top) / k, w: r.width / k, h: r.height / k }; });
    const near = (a: Record<string, number>, b: Record<string, number>) => Object.keys(b).every(q => Math.abs(a[q] - b[q]) < .75);
    expect(near(await onStage(), box0), JSON.stringify(await onStage())).toBe(true);
    const b = (await it.boundingBox())!, fx = b.x + b.width / 2, fy = b.y + b.height / 2;
    await page.mouse.move(fx, fy); await page.keyboard.down("Alt"); await page.mouse.down();
    await page.mouse.move(fx + 100, fy + 60, { steps: 12 });
    await page.mouse.up(); await page.keyboard.up("Alt");
    const moved = { x: box0.x + 50, y: box0.y + 30, w: 160, h: 100 };
    await pollFile(() => items().rzs.box, { timeout: 10_000 }).toEqual(moved);
    await idle(page);
    await expect.poll(async () => near(await onStage(), moved)).toBe(true);
    // the selection's box is the item's (selected by the drag)
    expect(await page.locator("#zoomVal").textContent()).toBe("200%");
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "zoom-200.png") });
    // removed again; Fit
    await it.click({ position: { x: 4, y: 4 } }); await page.keyboard.press("Delete");
    await pollFile(() => items().rzs ?? null, { timeout: 10_000 }).toBe(null);
    await page.keyboard.press("Control+0");
  });
});
