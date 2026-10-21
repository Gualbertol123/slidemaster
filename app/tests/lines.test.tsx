/* Lines on the slide (S15.3, LN-01 / LN-02; docs/next/09 §2.3, §5.3): the page with the core in-thread and the deck in this
   browser. Insert line ▾ puts each of the owner's kinds on the slide (one undo step each); the stage draws a band along
   a line to select and move it and, while it is selected, its end and middle handles; an end dragged with Ctrl onto an
   object's anchor attaches to it and follows it when it moves, dragged elsewhere comes free; Shift keeps 0 / 45 / 90°;
   the middle bends an elbow; in a free layout the drags write this design's entry (its bounds and a / b) and leave the
   other designs alone; the ribbon restyles it; an end whose object is deleted stays put, with the Issues line. Each
   drop or change one undo step. (jsdom has no PointerEvent: a MouseEvent with its name stands in; Del is deleteItem, the key handler is not installed here.) */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../src/editor/thumbs", async orig => ({ ...(await orig() as object), mountThumbs: () => { /* imperative */ } }));
vi.mock("../src/render/wall", async orig => ({ ...(await orig() as object), applyWall: () => { /* canvas */ } }));

import { App } from "../src/ui/App";
import { get } from "../src/state/store";
import { ctx, gotoSlide, openLocalFile } from "../src/state/app";
import { deleteItem, insertShape, itemPatch, selectItem } from "../src/editor/charts";
import { freeLayoutOn } from "../src/editor/free";
import { lineNow, lineOps, midFor, presetLine, snap45, LINE_PRESETS } from "../src/editor/lines";
import { slideIssues } from "../src/editor/issues";
import { useStage } from "../src/stage/data";
import { indexWorkbook } from "@slide-builder/core/xlsx/workbook";
import { defaultPreset } from "@slide-builder/core/model/preset";
import { anchorPoint } from "@slide-builder/core/render/line-dl";
import { computeLayout } from "@slide-builder/core/render/layout";
import { slideCtx } from "@slide-builder/core/render/look";
import type { LineItem, RuntimeSlide } from "@slide-builder/core/model/types";

const here = path.dirname(fileURLToPath(import.meta.url));
Element.prototype.scrollIntoView ??= function () { /* nothing to scroll */ };
(globalThis as { PointerEvent?: unknown }).PointerEvent ??= class PointerEvent extends MouseEvent { pointerId = 1; };
async function settle(n = 8) { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }
const history = () => get().deck.history.undo;
async function confirmed(steps: number) { await vi.waitFor(() => expect(history()).toBe(steps), { timeout: 10_000 }); await settle(); }
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const click = async (sel: string) => { const e = $(sel); expect(e, sel).toBeTruthy(); await act(async () => { fireEvent.click(e!); }); await settle(); };
const R = (): RuntimeSlide => get().deck.slides[get().deck.cur];
const items = () => R().cfg.items || {};
const line = (id: string) => items()[id] as LineItem;
const lastId = (before: string[]) => Object.keys(items()).find(k => !before.includes(k))!;
/** a drag in slide px (the stage is at scale 1 here): down on `sel`, moves to the target, up – with the keys held */
async function drag(sel: string, from: { x: number; y: number }, to: { x: number; y: number }, keys: { ctrlKey?: boolean; shiftKey?: boolean } = {}) {
  const el = $(sel); expect(el, sel).toBeTruthy();
  await act(async () => {
    fireEvent.pointerDown(el!, { button: 0, clientX: from.x, clientY: from.y });
    fireEvent.pointerMove(window, { clientX: (from.x + to.x) / 2, clientY: (from.y + to.y) / 2, ...keys });
    fireEvent.pointerMove(window, { clientX: to.x, clientY: to.y, ...keys });
    fireEvent.pointerUp(window, { clientX: to.x, clientY: to.y, ...keys });
  });
  await settle();
}
async function waitDrawn(id: string) { await vi.waitFor(() => expect($(`.linehit[data-item="${id}"]`)).toBeTruthy(), { timeout: 10_000 }); await settle(); }

describe("lines on the slide (S15.3, LN-01 / LN-02)", () => {
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
  });
  afterAll(() => { cleanup(); });

  it("Insert line ▾: every kind of the owner's list, one undo step each, drawn on the stage", async () => {
    for (const p of LINE_PRESETS) {
      const h0 = history(), before = Object.keys(items());
      await click("#lineBtn"); await click(`[data-line="${p.id}"]`);
      await confirmed(h0 + 1);
      const id = lastId(before);
      expect(line(id)).toEqual({ ...presetLine(p.id) });
      await waitDrawn(id);
      expect(get().selection.itemSel?.id).toBe(id);
      expect($("#lineTools")).toBeTruthy();
      expect(document.querySelectorAll(`.linehandle[data-item="${id}"]`)).toHaveLength(3);
      await act(async () => { deleteItem(); }); await confirmed(h0 + 2);
      expect(items()[id]).toBeUndefined();
    }
  }, 60_000);

  it("an end handle moves that end (Shift: 0 / 45 / 90°); the body moves the whole line – each drop one undo step", async () => {
    const h0 = history(), before = Object.keys(items());
    await click("#lineBtn"); await click('[data-line="arrow"]'); await confirmed(h0 + 1);
    const id = lastId(before), L0 = line(id);
    await waitDrawn(id);
    await drag(`.linehandle.b[data-item="${id}"]`, L0.b, { x: L0.b.x + 100, y: L0.b.y + 50 });
    await confirmed(h0 + 2);
    expect(line(id).b).toEqual({ x: L0.b.x + 100, y: L0.b.y + 50 });
    expect(line(id).a).toEqual(L0.a);
    expect(line(id).box).toEqual({ x: L0.a.x - 1, y: L0.a.y - 1, w: 422, h: 52 });
    // Shift: 45°
    const L1 = line(id);
    await drag(`.linehandle.b[data-item="${id}"]`, L1.b, { x: L1.b.x - 10, y: L1.b.y + 300 }, { shiftKey: true });
    await confirmed(h0 + 3);
    const s = line(id), ang = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x) * 180 / Math.PI;
    expect(Math.abs(ang - 45)).toBeLessThan(.01);
    expect(snap45({ x: 0, y: 0 }, { x: 10, y: 1 })).toEqual({ x: 10.05, y: 0 });
    // the body: the whole line
    const L2 = line(id), m = { x: (L2.a.x + L2.b.x) / 2, y: (L2.a.y + L2.b.y) / 2 };
    await drag(`.linehit[data-item="${id}"]`, m, { x: m.x - 40, y: m.y - 30 });
    await confirmed(h0 + 4);
    expect(line(id).a).toEqual({ x: L2.a.x - 40, y: L2.a.y - 30 });
    expect(line(id).b).toEqual({ x: L2.b.x - 40, y: L2.b.y - 30 });
  }, 60_000);

  it("Ctrl attaches an end to an object's anchor; the end follows the object; deleting the object leaves the end, with the Issues line", async () => {
    const h0 = history(), before = Object.keys(items());
    const shape = insertShape("rect")!; await confirmed(h0 + 1);
    await act(async () => itemPatch("Move shape", shape, { box: { x: 200, y: 700, w: 200, h: 100 } })); await confirmed(h0 + 2);
    await click("#lineBtn"); await click('[data-line="callout"]'); await confirmed(h0 + 3);
    const id = Object.keys(items()).find(k => !before.includes(k) && k !== shape)!;
    await waitDrawn(id);
    const L0 = line(id), target = { x: 400, y: 750 };                              // the shape's right middle
    await drag(`.linehandle.a[data-item="${id}"]`, L0.a, { x: target.x + 6, y: target.y - 5 }, { ctrlKey: true });
    await confirmed(h0 + 4);
    expect(line(id).ends).toEqual({ a: { to: "i:" + shape, at: "r" } });
    expect(line(id).a).toEqual(target);
    // the object moves: the end follows (drawn there; the PowerPoint and PDF exports take the same ends)
    await act(async () => itemPatch("Move shape", shape, { box: { x: 300, y: 600, w: 200, h: 100 } })); await confirmed(h0 + 5);
    expect(lineNow(R(), id, ctx())!.a).toEqual({ x: 500, y: 650 });
    // dragged away without Ctrl: free again
    await drag(`.linehandle.a[data-item="${id}"]`, { x: 500, y: 650 }, { x: 520, y: 640 });
    await confirmed(h0 + 6);
    expect(line(id).ends).toBeUndefined();
    expect(line(id).a).toEqual({ x: 520, y: 640 });
    // attached again, then its object deleted: the end stays at its last saved point, the Issues panel says why
    await drag(`.linehandle.a[data-item="${id}"]`, { x: 520, y: 640 }, { x: 500, y: 652 }, { ctrlKey: true });
    await confirmed(h0 + 7);
    await act(async () => { selectItem(shape); }); await settle();
    await act(async () => { deleteItem(); }); await confirmed(h0 + 8);
    await vi.waitFor(() => expect(useStage.getState().shown?.items?.[id]?.issue).toBe("its end lost its object"), { timeout: 10_000 });
    expect(lineNow(R(), id, ctx())!.a).toEqual({ x: 500, y: 650 });
    const issues = slideIssues(R(), ctx(), useStage.getState().shown!.items).map(x => x.html);
    expect(issues.some(x => /^Line \d+: its end lost its object$/.test(x))).toBe(true);
  }, 60_000);

  it("an elbow's middle handle moves its bend; the ribbon restyles it (style replaced whole), one undo step each", async () => {
    const h0 = history(), before = Object.keys(items());
    await click("#lineBtn"); await click('[data-line="elbow"]'); await confirmed(h0 + 1);
    const id = lastId(before), L0 = line(id);
    await waitDrawn(id);
    const mid = { x: (L0.a.x + L0.b.x) / 2, y: (L0.a.y + L0.b.y) / 2 };
    await drag(`.linehandle.mid[data-item="${id}"]`, mid, { x: L0.a.x + 80, y: mid.y + 33 });
    await confirmed(h0 + 2);
    expect(line(id).mid).toBe(.25);
    expect(line(id).a).toEqual(L0.a);
    expect(midFor({ route: "curve" }, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 30 })).toBe(30);
    await click("#lineColor"); await click('[data-lcolor="#C42B1C"]'); await confirmed(h0 + 3);
    await click("#lineWeight"); await click('[data-lw="3"]'); await confirmed(h0 + 4);
    await click("#lineWeight"); await click('[data-ldash="dashed"]'); await confirmed(h0 + 5);
    await click("#lineHeadA"); await click('[data-head="oval"]'); await confirmed(h0 + 6);
    await click("#lineHeadB"); await click('[data-head="none"]'); await confirmed(h0 + 7);
    expect(line(id).style).toEqual({ color: "#C42B1C", w: 3, dash: "dashed", heads: { a: "oval" } });
    await click("#lineRoute"); await click('[data-route="curve"]'); await confirmed(h0 + 8);
    expect(line(id)).toMatchObject({ route: "curve" });
    expect(line(id).mid).toBeUndefined();
    const t = $("#lineText") as HTMLInputElement;
    await act(async () => { t.value = "+12 % vs plan"; fireEvent.change(t); }); await confirmed(h0 + 9);
    expect(line(id).text).toBe("+12 % vs plan");
  }, 60_000);

  it("free layout: a drag writes this design's entry (bounds and a / b), the item and the other designs untouched", async () => {
    const h0 = history(), before = Object.keys(items());
    await click("#lineBtn"); await click('[data-line="line"]'); await confirmed(h0 + 1);
    const id = lastId(before), L0 = line(id);
    await act(async () => freeLayoutOn(R())); await confirmed(h0 + 2);
    const d = ctx().style.design, other = d === "excel" ? "glass" : "excel";
    expect(R().cfg.free?.[d]?.items["i:" + id]).toMatchObject({ a: L0.a, b: L0.b });
    await waitDrawn(id);
    const m = { x: (L0.a.x + L0.b.x) / 2, y: L0.a.y };
    await drag(`.linehit[data-item="${id}"]`, m, { x: m.x + 20, y: m.y + 10 });
    await confirmed(h0 + 3);
    expect(R().cfg.free?.[d]?.items["i:" + id]).toEqual({ x: L0.a.x + 19, y: L0.a.y + 9, w: 322, h: 2, a: { x: L0.a.x + 20, y: L0.a.y + 10 }, b: { x: L0.b.x + 20, y: L0.b.y + 10 } });
    expect(line(id)).toEqual(L0);
    expect(R().cfg.free?.[other]).toBeUndefined();
    expect(lineNow(R(), id, ctx())!.a).toEqual({ x: L0.a.x + 20, y: L0.a.y + 10 });
    // the op builder in automatic layout: one item.patch, the ends at 1/4 px
    const auto = { ...R(), cfg: { ...R().cfg, free: undefined } } as RuntimeSlide;
    expect(lineOps(auto, id, ctx(), { x: 10.13, y: 20 }, { x: 30, y: 40.6 })).toEqual([{ op: "item.patch", slide: R().id, id, patch: { a: { x: 10.25, y: 20 }, b: { x: 30, y: 40.5 }, box: { x: 9.25, y: 19, w: 21.75, h: 22.5 } } }]);
    // a table's anchor point, as the stage offers it with Ctrl
    const sc = slideCtx(ctx(), R()), t = computeLayout(R(), sc).boxes[0];
    const p = anchorPoint(t, "l");
    expect(p.x).toBeCloseTo(t.x, 2); expect(p.y).toBeCloseTo(t.y + t.h / 2, 2);
  });
});
