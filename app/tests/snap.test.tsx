/* Snapping on the stage (S15.4, SN-01…SN-03; docs/next/09 §5): the page with the core in-thread and the deck in this
   browser (report.xlsx, its second slide: two tables above y 560, the band below them free for the objects here).
   A shape moved near another lines up with its edges and centre (every matched line drawn, the centre dashed), its gaps
   made equal to a pair's (the gaps marked with their size), its corner resized to another's width (both sizes marked);
   a text box outside a free layout and a line's end snap the same way; Alt turns it off for every object; the
   positions dropped are those previewed, on 1/4 px at any zoom, and those saved. (jsdom has no PointerEvent: a
   MouseEvent with its name stands in; the stage is at scale 1 unless a test sets it.) */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../src/editor/thumbs", async orig => ({ ...(await orig() as object), mountThumbs: () => { /* imperative */ } }));
vi.mock("../src/render/wall", async orig => ({ ...(await orig() as object), applyWall: () => { /* canvas */ } }));

import { App } from "../src/ui/App";
import { get } from "../src/state/store";
import { change, ctx, gotoSlide, openLocalFile } from "../src/state/app";
import { freeLayoutOff, freeLayoutOn } from "../src/editor/free";
import { colEdges } from "../src/stage/hit";
import { selectItem } from "../src/editor/charts";
import { insertLine } from "../src/editor/lines";
import { setStage, useStage } from "../src/stage/data";
import { indexWorkbook } from "@slide-builder/core/xlsx/workbook";
import { defaultPreset } from "@slide-builder/core/model/preset";
import { computeLayout, freeKey, noteKey, tableH, tableW } from "@slide-builder/core/render/layout";
import { routeOf } from "@slide-builder/core/render/line-dl";
import { slideCtx } from "@slide-builder/core/render/look";
import type { Design, LineItem, Op, RuntimeSlide, ShapeItem } from "@slide-builder/core/model/types";

const here = path.dirname(fileURLToPath(import.meta.url));
Element.prototype.scrollIntoView ??= function () { /* nothing to scroll */ };
Element.prototype.setPointerCapture ??= function () { /* jsdom: no capture */ };
(globalThis as { PointerEvent?: unknown }).PointerEvent ??= class PointerEvent extends MouseEvent { pointerId = 1; };
async function settle(n = 8) { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }
const history = () => get().deck.history.undo;
async function confirmed(steps: number) { await vi.waitFor(() => expect(history()).toBe(steps), { timeout: 10_000 }); await settle(); }
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const R = (): RuntimeSlide => get().deck.slides[get().deck.cur];
const shape = (id: string) => R().cfg.items?.[id] as ShapeItem;
type Keys = { altKey?: boolean };
/** a drag in slide px (÷ the stage's scale on screen): down on `sel`, moves to the target, then `during` (the preview
    drawn: its guides), up */
async function drag(sel: string, from: { x: number; y: number }, to: { x: number; y: number }, keys: Keys = {}, during?: () => void | Promise<void>) {
  const el = $(sel); expect(el, sel).toBeTruthy();
  await act(async () => {
    fireEvent.pointerDown(el!, { button: 0, clientX: from.x, clientY: from.y, ...keys });
    fireEvent.pointerMove(window, { clientX: (from.x + to.x) / 2, clientY: (from.y + to.y) / 2, ...keys });
    fireEvent.pointerMove(window, { clientX: to.x, clientY: to.y, ...keys });
  });
  if (during) { await vi.waitFor(() => expect(useStage.getState().drag ?? $(".linehits path[stroke-dasharray]")).toBeTruthy(), { timeout: 2000 }); await settle(2); await during(); }
  await act(async () => { fireEvent.pointerUp(window, { clientX: to.x, clientY: to.y, ...keys }); });
  await settle();
}
const guides = (axis: "v" | "h") => $$(`#stage .snapline.${axis}`).map(e => [parseFloat(e.style.left || e.style.top), e.classList.contains("centre")]);
/** the shapes of these tests at these boxes (one undo step), drawn */
async function place(boxes: Record<string, ShapeItem["box"]>) {
  const h0 = history();
  await act(async () => change("Place", Object.entries(boxes).map(([id, box]) => ({ op: "item.patch", slide: R().id, id, patch: { kind: "shape", shape: "rect", box } } as Op))));
  await confirmed(h0 + 1);
  for (const id of Object.keys(boxes)) await vi.waitFor(() => expect($(`.itembox[data-item="${id}"]`)).toBeTruthy(), { timeout: 10_000 });
  await settle();
}
const clear = async () => { const ids = Object.keys(R().cfg.items || {}); if (!ids.length) return; const h0 = history(); await act(async () => change("Clear", ids.map(id => ({ op: "item.patch", slide: R().id, id, patch: null } as Op)))); await confirmed(h0 + 1); };

describe("snapping on the stage (S15.4, SN-01…SN-03)", () => {
  beforeAll(async () => {
    const buf = fs.readFileSync(path.join(here, "fixtures/report.xlsx"));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const wb = await indexWorkbook(ab); await wb.ensure(wb.meta.map(m => m.name), () => { /* progress */ });
    localStorage.setItem("sb3:doc:report.xlsx", JSON.stringify({ schema: 3, rev: 1, preset: defaultPreset(wb), style: {}, edits: {} }));
    render(<App />);
    const opening = openLocalFile(new File([ab], "report.xlsx"));
    await vi.waitFor(() => expect(get().ui.dialogs.dialog).toBeTruthy());
    await act(async () => { get().ui.dialogs.dialog!.resolve("continue"); await opening; });
    await settle();
    await act(async () => gotoSlide(1)); await settle();
    expect(R().tables.length).toBeGreaterThan(0);
    expect(useStage.getState().scale).toBe(1);
  });
  afterAll(() => { cleanup(); });

  it("SN-01: a shape lines up with another's edges and centre – every matched line drawn, the centre dashed; dropped where previewed", async () => {
    await clear();
    await place({ sa: { x: 600, y: 640, w: 100, h: 60 }, sb: { x: 1000, y: 720, w: 100, h: 60 } });
    const h0 = history();
    let shown: unknown = null;
    // the left edge would land 4 px right of A's, the top 3 px below A's bottom
    await drag('.itembox[data-item="sb"]', { x: 1050, y: 750 }, { x: 1050 - 396, y: 750 - 17 }, {}, () => {
      expect(guides("v")).toEqual([[600, false], [650, true], [700, false]]);
      expect(guides("h")).toEqual([[700, false]]);
      shown = (useStage.getState().drag as { box: unknown }).box;
    });
    await confirmed(h0 + 1);
    expect(shape("sb").box).toEqual({ x: 600, y: 700, w: 100, h: 60 });
    expect(shown).toEqual(shape("sb").box);                                   // the preview is the drop
    expect($$("#stage .snapline")).toHaveLength(0);                           // the guides go with the drag
    // Alt: no snapping – exactly where the pointer went
    await drag('.itembox[data-item="sb"]', { x: 650, y: 730 }, { x: 650 + 3, y: 730 + 22 }, { altKey: true }, () => { expect($$("#stage .snapline")).toHaveLength(0); });
    await confirmed(h0 + 2);
    expect(shape("sb").box).toEqual({ x: 603, y: 722, w: 100, h: 60 });
    // the slide's centre line (dashed)
    await drag('.itembox[data-item="sb"]', { x: 650, y: 750 }, { x: 650 + 145, y: 750 }, {}, () => { expect(guides("v")).toContainEqual([800, true]); });
    await confirmed(h0 + 3);
    expect(shape("sb").box.x).toBe(750);
  }, 60_000);

  it("SN-02: equal spacing beyond a pair (both gaps marked with their size) and equal size on a resize (both sizes marked)", async () => {
    await clear();
    await place({ sa: { x: 600, y: 640, w: 100, h: 60 }, sb: { x: 800, y: 640, w: 100, h: 60 }, sc: { x: 1200, y: 700, w: 100, h: 60 } });
    const h0 = history();
    await drag('.itembox[data-item="sc"]', { x: 1250, y: 730 }, { x: 1250 - 197, y: 730 - 55 }, {}, () => {
      const gaps = $$("#stage .snapgap.x");
      expect(gaps).toHaveLength(2);
      expect(gaps.map(g => [parseFloat(g.style.left), parseFloat(g.style.width)])).toEqual([[700, 100], [900, 100]]);
      expect($$("#stage .snaptip").map(t => t.textContent)).toEqual(["100 px", "100 px"]);
    });
    await confirmed(h0 + 1);
    expect(shape("sc").box).toEqual({ x: 1000, y: 640, w: 100, h: 60 });
    // A's corner: 137 wide → 140, the width of D
    await place({ sd: { x: 1260, y: 760, w: 140, h: 40 } });
    await act(async () => { selectItem("sa"); }); await settle();
    const h1 = history();
    await drag('.itembox[data-item="sa"] .size', { x: 700, y: 700 }, { x: 737, y: 700 }, {}, () => {
      expect($$("#stage .snapsize.w")).toHaveLength(2);
      expect($$("#stage .snaptip").map(t => t.textContent).filter(t => t === "= 140 px")).toHaveLength(2);
    });
    await confirmed(h1 + 1);
    expect(shape("sa").box).toEqual({ x: 600, y: 640, w: 140, h: 60 });
    // Alt: the width as dragged
    await drag('.itembox[data-item="sa"] .size', { x: 740, y: 700 }, { x: 735, y: 703 }, { altKey: true });
    await confirmed(h1 + 2);
    expect(shape("sa").box).toEqual({ x: 600, y: 640, w: 135, h: 63 });
  }, 60_000);

  it("SN-03: a text box outside a free layout snaps too, and Alt turns it off (as for every object)", async () => {
    await clear();
    await place({ sa: { x: 600, y: 640, w: 100, h: 60 } });
    const key = noteKey(R(), 0, "bottom"), h0 = history();
    await act(async () => change("Text box", [{ op: "slide.patch", id: R().id, patch: { notes: { [key]: { text: "Snap me", x: 1100, y: 700, w: 200, h: 50 } } } } as Op]));
    await confirmed(h0 + 1);
    await vi.waitFor(() => expect($(`#stage [data-note="${key}"]`)).toBeTruthy(), { timeout: 10_000 });
    expect(R().cfg.free).toBeFalsy();
    // its left edge 5 px right of A's right edge: Alt – stays there
    await drag(`#stage [data-note="${key}"]`, { x: 1200, y: 725 }, { x: 1200 - 395, y: 725 }, { altKey: true }, () => { expect($$("#stage .snapline.v")).toHaveLength(0); });
    await confirmed(h0 + 2);
    expect(R().cfg.notes![key]).toMatchObject({ x: 705, y: 700, w: 200, h: 50 });
    // without Alt (4 px left: a move, not a click): on A's right edge
    await drag(`#stage [data-note="${key}"]`, { x: 800, y: 725 }, { x: 796, y: 725 }, {}, () => { expect(guides("v")).toContainEqual([700, false]); });
    await confirmed(h0 + 3);
    expect(R().cfg.notes![key]).toMatchObject({ x: 700, y: 700 });
    await act(async () => change("Text box gone", [{ op: "slide.patch", id: R().id, patch: { notes: { [key]: null } } } as Op])); await confirmed(h0 + 4);
  }, 60_000);

  it("a line's end snaps to an object's edge and middle (Alt: off); the line moved whole lines up by its bounds", async () => {
    await clear();
    await place({ sa: { x: 600, y: 640, w: 100, h: 60 } });
    const h0 = history();
    let id = "";
    await act(async () => { id = insertLine("line")!; }); await confirmed(h0 + 1);
    await vi.waitFor(() => expect($(`.linehandle.b[data-item="${id}"]`)).toBeTruthy(), { timeout: 10_000 });
    const L0 = R().cfg.items![id] as LineItem;
    // end b to 4 px right of A's left edge, 1 px below its middle → on (600, 670); both guides drawn (the middle dashed)
    await drag(`.linehandle.b[data-item="${id}"]`, L0.b, { x: 604, y: 671 }, {}, () => {
      expect(guides("v")).toEqual([[600, false]]);
      expect(guides("h")).toEqual([[670, true]]);
    });
    await confirmed(h0 + 2);
    expect((R().cfg.items![id] as LineItem).b).toEqual({ x: 600, y: 670 });
    await drag(`.linehandle.b[data-item="${id}"]`, { x: 600, y: 670 }, { x: 603, y: 672 }, { altKey: true });
    await confirmed(h0 + 3);
    expect((R().cfg.items![id] as LineItem).b).toEqual({ x: 603, y: 672 });
  }, 60_000);

  it("zoomed: the snapping distance is 8 screen px (8 / scale slide px) and the drop lands on 1/4 px", async () => {
    await clear();
    await place({ sa: { x: 1150, y: 640, w: 60, h: 60 }, sb: { x: 1300, y: 760, w: 100, h: 30 } });
    await act(async () => { setStage({ scale: .8 }); }); await settle();
    try {
      const h0 = history();
      // 5 × 3 screen px = 6.25 × 3.75 slide px: nothing within 10 px – on 1/4 px as the pointer went
      await drag('.itembox[data-item="sb"]', { x: 100, y: 100 }, { x: 105, y: 103 });
      await confirmed(h0 + 1);
      expect(shape("sb").box).toEqual({ x: 1306.25, y: 763.75, w: 100, h: 30 });
      // 70 screen px left: its left edge 8.75 slide px from A's right edge (more than 8, less than 10) – snapped at this zoom
      await drag('.itembox[data-item="sb"]', { x: 100, y: 100 }, { x: 30, y: 100 });
      await confirmed(h0 + 2);
      expect(shape("sb").box.x).toBe(1210);
    } finally { await act(async () => { setStage({ scale: 1 }); }); await settle(); }
  }, 60_000);

  /* ---- S15.4 review follow-ups (w2-review-S15.4 findings 1, 2, 3, 5) ---- */
  const q4 = (v: number) => Math.abs(v * 4 - Math.round(v * 4)) < 1e-9;
  /** free layout on, table 0 at (x, y) at scale k (its width then off the 1/4 px grid), drawn */
  async function freeTable0(x: number, y: number, k: number) {
    const h0 = history();
    await act(async () => freeLayoutOn(R())); await confirmed(h0 + 1);
    const c = slideCtx(ctx(), R()), T = R().tables[0], W = tableW(T, c), H = tableH(T, c), d = c.style.design, key = freeKey.table(R(), 0);
    const items = { ...R().cfg.free![d]!.items, [key]: { x, y, w: W * k, h: H * k, scale: k } };
    await act(async () => change("Place table", [{ op: "slide.patch", id: R().id, patch: { free: { [d]: { on: true, items } } } } as Op])); await confirmed(h0 + 2);
    await vi.waitFor(() => expect($('#stage .hbox[data-i="0"] .grip')).toBeTruthy(), { timeout: 10_000 });
    await settle();
    return { W, H, d, key, h0: h0 + 2 };
  }
  const freeBox = (d: Design, key: string) => R().cfg.free![d]!.items[key] as { x: number; y: number; w: number; h: number; scale: number };
  const off = async () => { if (!R().cfg.free?.[ctx().style.design]?.on) return; const h0 = history(); await act(async () => freeLayoutOff(R())); await confirmed(h0 + 1); };

  afterEach(async () => { await off(); });
  it("a free table moved against the slide's right and bottom edges: dropped where previewed, on 1/4 px, on the slide (review 1)", async () => {
    await clear();
    const { W, d, key, h0 } = await freeTable0(100, 100, .7771);
    expect(q4(W * .7771)).toBe(false);                                         // a width off the grid
    let shown: { x: number; y: number } | null = null;
    await drag('#stage .hbox[data-i="0"] .grip', { x: 110, y: 105 }, { x: 110 + 3000, y: 105 + 3000 }, {}, () => {
      const b = (useStage.getState().drag as { boxes: { x: number; y: number }[] }).boxes[0]; shown = { x: b.x, y: b.y };
    });
    await confirmed(h0 + 1);
    const f = freeBox(d, key);
    expect(f.x).toBe(Math.floor((1600 - f.w) * 4) / 4);
    expect(f.y).toBe(Math.floor((900 - f.h) * 4) / 4);
    expect(q4(f.x) && q4(f.y)).toBe(true);
    expect(f.x + f.w).toBeLessThanOrEqual(1600); expect(f.y + f.h).toBeLessThanOrEqual(900);
    expect(shown).toEqual({ x: f.x, y: f.y });                                 // the preview is the drop
    expect(f.scale).toBe(.7771);                                               // a move keeps its scale
    await off();
  }, 60_000);

  it("a free table resized by its bottom or top edge: the snapped edge lands on the target exactly, its height on 1/4 px (review 2)", async () => {
    await clear();
    const { W, H, d, key, h0 } = await freeTable0(100, 100, .5);
    const bottom0 = 100 + H * .5, target = Math.round(bottom0 + Math.min(120, (1500 * H / W - H * .5) / 2)) + .25;
    await place({ sa: { x: 1300, y: target, w: 80, h: 40 } });
    const h1 = history();
    let marks: unknown = null;
    await drag('#stage .hbox[data-i="0"] .edge.b', { x: 120, y: bottom0 }, { x: 120, y: target - 3 }, {}, () => { marks = (useStage.getState().drag as { marks: unknown }).marks; expect(guides("h")).toContainEqual([target, false]); });
    await confirmed(h1 + 1);
    const f = freeBox(d, key);
    expect(f.y + f.h).toBe(target);                                            // on the guide, not 1/8 px off
    expect(q4(f.h)).toBe(true);
    expect(f.w / W).toBeCloseTo(f.scale, 12); expect(f.h / H).toBeCloseTo(f.scale, 12);
    expect(marks).toBeTruthy();
    // the top edge: up onto the shape's bottom when it is above
    await place({ sb: { x: 1300, y: 20.5, w: 80, h: 40 } });
    const h2 = history(), top0 = f.y;
    await drag('#stage .hbox[data-i="0"] .edge.t', { x: 120, y: top0 }, { x: 120, y: 60.5 + 2 }, {}, () => { expect(guides("h")).toContainEqual([60.5, false]); });
    await confirmed(h2 + 1);
    const g = freeBox(d, key);
    expect(g.y).toBe(60.5);
    expect(g.y + g.h).toBeCloseTo(target, 6);                                  // the bottom stays (within its 1/4 px rounding)
    expect(q4(g.h) && q4(g.y)).toBe(true);
    void h0; await off();
  }, 60_000);

  it("a text box stretched by its edge outside a free layout snaps (Alt: off), dropped on 1/4 px (review 5)", async () => {
    await clear();
    await place({ sa: { x: 900, y: 640, w: 100, h: 60 } });
    const key = noteKey(R(), 0, "bottom"), h0 = history();
    await act(async () => change("Text box", [{ op: "slide.patch", id: R().id, patch: { notes: { [key]: { text: "Stretch me", x: 500, y: 760, w: 200, h: 50 } } } } as Op]));
    await confirmed(h0 + 1);
    await vi.waitFor(() => expect($(`#stage [data-note="${key}"]`)).toBeTruthy(), { timeout: 10_000 });
    expect(R().cfg.free?.[ctx().style.design]?.on ?? false).toBe(false);
    // jsdom lays nothing out: the box's rectangle on screen is its slide box (scale 1)
    const el = $(`#stage [data-note="${key}"]`)!;
    el.getBoundingClientRect = () => { const n = R().cfg.notes![key] as { x: number; y: number; w: number; h: number }; return { left: n.x, right: n.x + n.w, top: n.y, bottom: n.y + n.h, x: n.x, y: n.y, width: n.w, height: n.h, toJSON() { return this; } } as DOMRect; };
    // the right edge 4 px short of A's left edge: onto it (width 400), the guide drawn
    await drag(`#stage [data-note="${key}"]`, { x: 700, y: 785 }, { x: 896, y: 785 }, {}, () => { expect(guides("v")).toContainEqual([900, false]); });
    await confirmed(h0 + 2);
    expect(R().cfg.notes![key]).toMatchObject({ w: 400 });
    // Alt: as dragged (to 1/4 px)
    await drag(`#stage [data-note="${key}"]`, { x: 900, y: 785 }, { x: 896.6, y: 785 }, { altKey: true }, () => { expect($$("#stage .snapline.v")).toHaveLength(0); });
    await confirmed(h0 + 3);
    expect((R().cfg.notes![key] as { w: number }).w).toBe(396.5);
    await act(async () => change("Text box gone", [{ op: "slide.patch", id: R().id, patch: { notes: { [key]: null } } } as Op])); await confirmed(h0 + 4);
  }, 60_000);

  it("an elbow's bend snaps onto an object's edge exactly, its fraction keeping the point (review 3)", async () => {
    await clear();
    await place({ sa: { x: 700, y: 640, w: 100, h: 60 } });
    const h0 = history();
    let id = "";
    await act(async () => { id = insertLine("elbow")!; }); await confirmed(h0 + 1);
    const a = { x: 301, y: 610 }, b = { x: 1004, y: 830 };
    await act(async () => change("Place line", [{ op: "item.patch", slide: R().id, id, patch: { route: "elbow", bend: "hv", mid: .5, a, b, box: { x: 300, y: 609, w: 705, h: 222 } } } as Op])); await confirmed(h0 + 2);
    await act(async () => { selectItem(id); }); await settle();
    await vi.waitFor(() => expect($(`.linehandle.mid[data-item="${id}"]`)).toBeTruthy(), { timeout: 10_000 });
    const m0 = routeOf(R().cfg.items![id] as LineItem, a, b).mid;
    await drag(`.linehandle.mid[data-item="${id}"]`, m0, { x: 697, y: m0.y + 1 }, {}, () => { expect(guides("v")).toContainEqual([700, false]); });
    await confirmed(h0 + 3);
    const L = R().cfg.items![id] as LineItem, r = routeOf(L, a, b);
    expect(r.d[1]).toEqual(["L", 700, 610]);                                   // the bend on the guide (1/1000 would give 700.03)
    expect(r.d[2][1]).toBe(700);
  }, 60_000);

  it("another table's cell borders are targets: a shape's edge lines up with a column border (review 5)", async () => {
    await clear();
    const c = slideCtx(ctx(), R()), boxes = computeLayout(R(), c).boxes, t0 = boxes[0]!;
    const inner = colEdges(R().tables[0], c).map(([x0, w]) => t0.x + (x0 + w) * t0.scale).filter(x => x > t0.x + 20 && x < t0.x + t0.w - 20);
    expect(inner.length).toBeGreaterThan(0);
    // a border away from every other target's x (the boxes' edges and centres, the slide's)
    const others = [0, 50, 800, 1550, 1600, ...boxes.flatMap(bx => bx ? [bx.x, bx.x + bx.w / 2, bx.x + bx.w] : [])];
    const x = inner.find(v => others.every(o => Math.abs(o - v) > 12) && inner.every(u => u === v || Math.abs(u - v) > 12));
    expect(x, "a column border on its own").toBeTruthy();
    await place({ sc: { x: Math.round(x!) + 40, y: 700, w: 60, h: 40 } });
    const h0 = history();
    await drag('.itembox[data-item="sc"]', { x: Math.round(x!) + 70, y: 720 }, { x: Math.round(x!) + 70 - (Math.round(x!) + 40 - x!) + 3, y: 720 }, {}, () => {
      expect(guides("v").some(([at]) => Math.abs((at as number) - x!) < .26)).toBe(true);
    });
    await confirmed(h0 + 1);
    expect(Math.abs(shape("sc").box.x - x!)).toBeLessThanOrEqual(.125);        // on the border, at 1/4 px
    expect(q4(shape("sc").box.x)).toBe(true);
  }, 60_000);
});
