/* End-to-end: the side panel's width (4.10.2, the owner's report 2026-10-22: the chart panel "too squashed", its type
   buttons overlapping and its boxes cut off at 250 px). Its own workbook (tests/fixtures/Panel.xlsx, a copy of
   Targets.xlsx: no other spec uses its deck). At 1366×768:
   PW-01 – the panel opens 340 px wide and the slide still fits the stage by its height (the panel costs it nothing);
           a chart with two series, its axes, a reference line, a gap arrow and change pills: no two type buttons
           overlap, every control is inside the panel, no row is wider than the panel, and no row's × button is alone
           on a line; the same at the narrowest width (280, the grip dragged); the width is kept in this browser, a
           drag past half the window stops there, a double-click on the grip goes back to 340; the stage fits again
           to the new width. A picture of the panel: $SB_PANEL_SHOT (the owner's before/after). */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fold, type DeckRecord } from "../../core/src/model/fold";

const ANNA = "http://127.0.0.1:8951/";
const BOOK = "Panel.xlsx";
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
const undoSteps = (page: Page) => page.evaluate(() => (window as any).__sbTest.history().undo as number);
const change = (page: Page, label: string, ops: object[]) => page.evaluate(([l, o]) => (window as any).__sbTest.change(l, o), [label, ops] as const);

async function openPlain(page: Page) {
  await page.goto(ANNA);
  await page.locator("#openBtn").waitFor();
  let last: string | null = null;
  try { last = JSON.parse(fs.readFileSync(path.join(data(), "users", "anna.json"), "utf8")).lastFile || null; } catch { /* first start */ }
  if (last) await expect(page.locator("#fileName")).toHaveText(new RegExp("^" + last.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " · \\d+ slides?"), { timeout: 30_000 });
  await page.click("#openBtn");
  await page.click(`[data-f="${BOOK}"]`);
  const wizard = page.locator(".wiz"), cont = page.locator('[data-a="continue"]');
  await expect(wizard.or(cont)).toBeVisible({ timeout: 20_000 });
  if (await cont.isVisible()) await cont.click();
  else { await page.click('[data-a="next"]:has-text("Tables")'); await page.click('[data-a="next"]:has-text("Slides")'); await page.click('[data-a="finish"]'); }
  await expect(page.locator("#fileName")).toHaveText(/^Panel\.xlsx · \d+ slides?/, { timeout: 30_000 });
  await expect(page.locator(".thumb").first()).toBeVisible({ timeout: 20_000 });
}

/** what is wrong with the chart panel's layout as drawn now (an empty list: nothing) */
const layoutProblems = (page: Page) => page.evaluate(() => {
  const out: string[] = [];
  const P = document.querySelector("#chartPanel") as HTMLElement, pr = P.getBoundingClientRect();
  const name = (e: Element) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + [...e.attributes].filter(a => a.name.startsWith("data-")).map(a => `[${a.name}=${a.value}]`).join("") + (e.className && typeof e.className === "string" ? "." + e.className.split(" ").join(".") : "");
  const vis = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  // the side panel ends above the status bar (it scrolls), and never sideways
  const N = document.querySelector("aside.nav") as HTMLElement, sb = document.querySelector(".statusbar")!.getBoundingClientRect();
  if (N.getBoundingClientRect().bottom > sb.top + .5) out.push("the side panel runs under the status bar");
  if (N.scrollWidth > N.clientWidth + 1) out.push(`the side panel scrolls sideways: ${N.scrollWidth} > ${N.clientWidth}`);
  // the type buttons: none overlaps another
  const T = [...P.querySelectorAll(".ctypes button")].map(b => b.getBoundingClientRect());
  if (T.length < 8) out.push("type buttons: " + T.length);
  for (let i = 0; i < T.length; i++) for (let j = i + 1; j < T.length; j++) {
    const a = T[i], b = T[j];
    if (a.left < b.right - .5 && b.left < a.right - .5 && a.top < b.bottom - .5 && b.top < a.bottom - .5) out.push(`type buttons ${i} and ${j} overlap`);
  }
  // every control inside the panel's width
  for (const e of P.querySelectorAll("input:not([type=color]),select,button,code")) {
    if (!vis(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.left < pr.left - .5 || r.right > pr.right + .5) out.push(`${name(e)} outside the panel (${Math.round(r.left - pr.left)}…${Math.round(r.right - pr.left)} of ${Math.round(pr.width)})`);
  }
  // no row (a box's container) cut off
  for (const e of P.querySelectorAll(".row,.mms,.mms label,.serhd,.seg")) {
    if (!vis(e)) continue;
    const h = e as HTMLElement;
    if (h.scrollWidth > h.clientWidth + 1) out.push(`${name(e)} clipped: ${h.scrollWidth} > ${h.clientWidth}`);
  }
  // a row's × button never alone on a line: on the row's first line, over none of the row's other controls
  for (const x of P.querySelectorAll(".row > [data-a=remove], .serhd > [data-a=remove]")) {
    const row = x.parentElement!, xr = x.getBoundingClientRect();
    if (Math.abs(xr.top - row.getBoundingClientRect().top) > 8) out.push(`${name(row)}: its × not on the row's first line`);
    for (const o of row.children) {
      if (o === x || !vis(o)) continue;
      const r = o.getBoundingClientRect();
      if (r.left < xr.right - .5 && xr.left < r.right - .5 && r.top < xr.bottom - .5 && xr.top < r.bottom - .5) out.push(`${name(row)}: its × over ${name(o)}`);
    }
    if (row.classList.contains("row")) {
      const others = [...row.children].filter(o => o !== x && vis(o)).map(o => o.getBoundingClientRect());
      if (!others.some(r => Math.abs(r.top - xr.top) <= 8 || (r.top <= xr.top + 4 && r.bottom >= xr.bottom - 4))) out.push(`${name(row)}: its × on a line of its own`);
    }
  }
  return out;
});
const navWidth = (page: Page) => page.locator("aside.nav").evaluate(e => Math.round(e.getBoundingClientRect().width));
async function dragGrip(page: Page, dx: number) {
  const g = (await page.locator("#navGrip").boundingBox())!;
  const x = g.x + g.width / 2, y = g.y + 200;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let k = 1; k <= 5; k++) await page.mouse.move(x + dx * k / 5, y);
  await page.mouse.up();
}

test("PW-01: the side panel – 340 px, resizable from 280 to half the window, the chart panel tidy at every width", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await openPlain(page);
  await saved(page);
  await pollFile(() => (doc().preset.slides as any[]).length, { timeout: 20_000 }).toBeGreaterThan(0);
  if (!(doc().preset.slides as any[]).some(s => s.type === "content")) {
    const u0 = await undoSteps(page);
    await change(page, "New slide", [{ op: "slide.add", slide: { id: "pws", type: "content", title: "Panel", tables: [] }, after: null }]);
    await expect.poll(() => undoSteps(page)).toBe(u0 + 1);
    await pollFile(() => (doc().preset.slides as any[]).some(s => s.type === "content"), { timeout: 10_000 }).toBe(true);
  }
  const slides = doc().preset.slides as any[], k = slides.findIndex(s => s.type === "content"), S = slides[k];
  await page.locator(`.thumb[data-i="${k}"]`).click(); await page.locator(`.thumb.on[data-i="${k}"]`).waitFor();

  // 340 px; the slide fits the stage by its height (as wide a panel as this costs the slide nothing at 1366×768)
  expect(await navWidth(page)).toBe(340);
  const fit = () => page.evaluate(() => { const c = document.querySelector("#stage")!, w = document.querySelector(".stagewrap")!.getBoundingClientRect();
    return { cw: c.clientWidth, ch: c.clientHeight, w: Math.round(w.width), h: Math.round(w.height) }; });
  const f0 = await fit();
  expect(Math.abs(f0.h - (f0.ch - 64))).toBeLessThanOrEqual(1);           // height-limited: (ch − 64) / 900
  expect(f0.cw - 56).toBeGreaterThan(f0.w);

  // a chart with everything the panel can show
  const D = (r: string) => ({ sheet: "SLIDE_1", range: r });
  const chart = { kind: "chart", type: "combo", title: "Weekly volume", values: D("D4:D7"), labels: D("C4:C7"), box: { x: 820, y: 200, w: 700, h: 500 },
    sers: { s1: { n: 1, name: "Volume", vals: [D("D4:D7")] }, s2: { n: 2, vals: [D("D4:D7")], type: "line" } } };
  const u = await undoSteps(page);
  await change(page, "Insert chart", [{ op: "item.patch", slide: S.id, id: "pwc", patch: chart }]);
  await expect.poll(() => undoSteps(page)).toBe(u + 1);
  await page.locator(".itembox[data-kind=chart]").first().click({ position: { x: 6, y: 6 } });
  await expect(page.locator("#chartPanel")).toBeVisible({ timeout: 10_000 });
  await page.locator('[data-ser="s1"] [data-a="more"]').click();
  await page.locator("#chartAxes > summary").click();
  await page.locator("#chartTargets > summary").click();
  await page.click("#chartAddRefTyped");
  await expect(page.locator("#chartTargets [data-ref]")).toHaveCount(1);
  await page.click("#chartAddGap"); await page.click("#chartAddChange");
  await expect(page.locator("#chartTargets [data-gap]")).toHaveCount(1);
  await expect(page.locator("#chartTargets [data-chg]")).toHaveCount(1);
  await page.locator("#chartCategoryGroups, #chartGroups").locator("summary").click();

  expect(await layoutProblems(page)).toEqual([]);
  const shot = process.env.SB_PANEL_SHOT;
  if (shot) {
    await page.locator("#chartPanel").evaluate(e => e.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: shot });
    // (the whole panel in one picture: a window tall enough for it)
    await page.setViewportSize({ width: 1366, height: 2400 });
    await page.locator("#chartPanel").screenshot({ path: shot.replace(/\.png$/, "-full.png") });
    await page.setViewportSize({ width: 1366, height: 768 });
  }

  // the narrowest: 280 (a drag well past it stops there), kept in this browser; the stage fits the new width
  await dragGrip(page, -200);
  expect(await navWidth(page)).toBe(280);
  expect(await page.evaluate(() => localStorage.getItem("sbNavWidth"))).toBe("280");
  expect(await layoutProblems(page)).toEqual([]);
  await expect.poll(async () => (await fit()).cw).toBe(f0.cw + 60);
  if (shot) {
    await page.setViewportSize({ width: 1366, height: 2400 });
    await page.locator("#chartPanel").screenshot({ path: shot.replace(/\.png$/, "-280.png") });
    await page.setViewportSize({ width: 1366, height: 768 });
  }

  // the widest: half the window
  await dragGrip(page, 900);
  expect(await navWidth(page)).toBe(683);
  expect(await layoutProblems(page)).toEqual([]);
  // kept across a reload
  await page.reload();
  await expect(page.locator(".thumb").first()).toBeVisible({ timeout: 30_000 });
  expect(await navWidth(page)).toBe(683);
  // a double-click: the usual width again, nothing kept
  await page.locator("#navGrip").dblclick();
  expect(await navWidth(page)).toBe(340);
  expect(await page.evaluate(() => localStorage.getItem("sbNavWidth"))).toBeNull();
  await expect.poll(async () => (await fit()).cw).toBe(f0.cw);
  expect(errors).toEqual([]);
});
