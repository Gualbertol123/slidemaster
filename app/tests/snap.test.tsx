/* Snapping on the stage (S15.4, SN-01…SN-03; docs/next/09 §5): the page with the core in-thread and the deck in this
   browser (report.xlsx, its second slide: two tables above y 560, the band below them free for the objects here).
   A shape moved near another lines up with its edges and centre (every matched line drawn, the centre dashed), its gaps
   made equal to a pair's (the gaps marked with their size), its corner resized to another's width (both sizes marked);
   a text box outside a free layout and a line's end snap the same way; Alt turns it off for every object; the
   positions dropped are those previewed, on 1/4 px at any zoom, and those saved. (jsdom has no PointerEvent: a
   MouseEvent with its name stands in; the stage is at scale 1 unless a test sets it.) */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../src/editor/thumbs", async orig => ({ ...(await orig() as object), mountThumbs: () => { /* imperative */ } }));
vi.mock("../src/render/wall", async orig => ({ ...(await orig() as object), applyWall: () => { /* canvas */ } }));

import { App } from "../src/ui/App";
import { get } from "../src/state/store";
import { change, gotoSlide, openLocalFile } from "../src/state/app";
import { selectItem } from "../src/editor/charts";
import { insertLine } from "../src/editor/lines";
import { setStage, useStage } from "../src/stage/data";
import { indexWorkbook } from "@slide-builder/core/xlsx/workbook";
import { defaultPreset } from "@slide-builder/core/model/preset";
import { noteKey } from "@slide-builder/core/render/layout";
import type { LineItem, Op, RuntimeSlide, ShapeItem } from "@slide-builder/core/model/types";

const here = path.dirname(fileURLToPath(import.meta.url));
Element.prototype.scrollIntoView ??= function () { /* nothing to scroll */ };
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
});
