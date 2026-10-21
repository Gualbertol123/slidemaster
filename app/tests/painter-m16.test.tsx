/* S16.3 (4.9, B38; PT-01…PT-03; docs/next/09 §9 Q9, Q19): the ribbon's Number group (Decimals −/+, %, Thousands) and
   vertical alignment for table cells – saved as cell.patch num / valign, each click one undo step; the format painter
   copies them (and the font); Ctrl+click several ranges – of one table or of several – or several objects, then let go
   of Ctrl: one paste onto all of them, one undo step; an object's look onto others of its kind (item.patch each). */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../src/editor/thumbs", async orig => ({ ...(await orig() as object), mountThumbs: () => { /* imperative */ } }));
vi.mock("../src/render/wall", async orig => ({ ...(await orig() as object), applyWall: () => { /* canvas */ } }));

import { App } from "../src/ui/App";
import { get } from "../src/state/store";
import { change, gotoSlide, openLocalFile, style, styleChange, undo } from "../src/state/app";
import { addSel, selCells, selItems, setSel } from "../src/editor/edit";
import { applyPainter, paintItem, startPainter, stopPainter } from "../src/editor/painter";
import { selectItem } from "../src/editor/charts";
import { installKeys } from "../src/editor/keys";
import { keyOf } from "@slide-builder/core/render/edits";
import { formatValue, isDateFmt } from "@slide-builder/core/xlsx/numfmt";
import type { CellEdit, Op } from "@slide-builder/core/model/types";
import type { Item, TableLayout } from "@slide-builder/core/xlsx/types";
import { indexWorkbook } from "@slide-builder/core/xlsx/workbook";
import { defaultPreset } from "@slide-builder/core/model/preset";

const here = path.dirname(fileURLToPath(import.meta.url));
Element.prototype.scrollIntoView ??= function () { /* nothing to scroll */ };
async function settle(n = 8) { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }
const history = () => get().deck.history.undo;
async function confirmed(steps: number) { await vi.waitFor(() => expect(history()).toBe(steps), { timeout: 10_000 }); await settle(); }
const editOf = (it: Item): CellEdit => (get().doc.view!.edits[it.L!.sheet.name] || {})[keyOf(it)] || {};
const btn = (id: string) => document.getElementById(id) as HTMLButtonElement;
/** the current slide's table t and its number cells (one cell each, not merged) */
function numbers(t: number) {
  const T = get().deck.slides[get().deck.cur].tables[t] as TableLayout;
  return { T, nums: T.items.filter(it => it.ctype === "n" && it.text && !it.merged && it.b.r === it.b.r2 && it.b.c === it.b.c2) };
}
const sel1 = (t: number, it: Item) => setSel(t, { r: it.b.r, c: it.b.c }, { r: it.b.r, c: it.b.c });
let home = 0;
const key = (k: string) => { dispatchEvent(new KeyboardEvent("keyup", { key: k })); };
async function undoTo(h: number) { while (history() > h) { const n = history(); await act(async () => undo(false)); await vi.waitFor(() => expect(history()).toBe(n - 1)); } await settle(); }
/** the deck in design d (one undo step when it changes) */
async function design(d: "glass" | "excel") { if (style().design === d) return; const h = history(); await act(async () => { styleChange("Design", { design: d }); }); await confirmed(h + 1); }
const vbtn = (v: string) => document.querySelector(`[data-valign="${v}"]`) as HTMLButtonElement;
const items = (slide: string) => get().doc.view!.preset!.slides.find(s => s.id === slide)!.items! as unknown as Record<string, Record<string, unknown>>;

describe("number display, vertical alignment and the fuller painter (S16.3)", () => {
  beforeAll(async () => {
    const buf = fs.readFileSync(path.join(here, "fixtures/report.xlsx"));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const wb = await indexWorkbook(ab); await wb.ensure(wb.meta.map(m => m.name), () => { /* progress */ });
    localStorage.setItem("sb3:doc:report.xlsx", JSON.stringify({ schema: 3, rev: 1, preset: defaultPreset(wb), style: {}, edits: {} }));
    render(<App />); installKeys();              // (main.tsx installs the keys in the page)
    const opening = openLocalFile(new File([ab], "report.xlsx"));
    await vi.waitFor(() => expect(get().ui.dialogs.dialog).toBeTruthy());
    await act(async () => { get().ui.dialogs.dialog!.resolve("continue"); await opening; });
    await settle();
    const k = get().deck.slides.findIndex(s => s.tables.length >= 2 && s.tables.every(t => t.items.some(it => it.ctype === "n")));
    expect(k).toBeGreaterThanOrEqual(0);
    home = k; await act(async () => gotoSlide(k)); await settle();
  });
  afterAll(() => cleanup());

  it("PT-01 Number group: More / Fewer decimals, %, Thousands – on every selected number, one undo step each; the text shows it", async () => {
    const { nums } = numbers(0), [a, b] = nums, h0 = history();
    await act(async () => setSel(0, { r: a.b.r, c: a.b.c }, { r: b.b.r, c: b.b.c })); await settle();
    expect(btn("numDecUp").disabled).toBe(false);
    await act(async () => { fireEvent.click(btn("numDecUp")); });
    await confirmed(h0 + 1);
    const n1 = editOf(a).num!;
    expect(n1).toMatch(/0\.0*0/);
    expect(editOf(b).num).toBeTruthy();
    // drawn on the stage: the cell's number with the new code (Italian separators, as the PDF and PowerPoint)
    const x = a.L!.sheet.get(a.b.src.r, a.b.src.c)!, shown = formatValue({ v: x.v, t: x.t, fmt: n1 }).text;
    expect(shown).not.toBe(a.text);
    await vi.waitFor(() => expect(document.getElementById("stage")!.textContent).toContain(shown), { timeout: 10_000 });
    await act(async () => { fireEvent.click(btn("numPct")); });
    await confirmed(h0 + 2);
    expect(editOf(a).num).toBe(n1 + "%");
    expect(btn("numPct").className).toContain(" on");
    await act(async () => { fireEvent.click(btn("numPct")); });
    await confirmed(h0 + 3);
    expect(editOf(a).num).toBe(n1);
    await act(async () => { fireEvent.click(btn("numDecDown")); });
    await confirmed(h0 + 4);
    // back to the workbook's own code: nothing stored
    expect(editOf(a).num).toBeUndefined();
    // undo: one step back
    await act(async () => undo(false)); await settle(12);
    expect(editOf(a).num).toBe(n1);
  });

  it("PT-01 vertical alignment for cells (Excel design): top / middle stored, Excel's own clears; Clear format clears both", async () => {
    const d0 = style().design; await design("excel");
    const { nums } = numbers(0), a = nums[2], h0 = history();
    expect(a.valign).toBe("bottom");
    await act(async () => sel1(0, a)); await settle();
    expect(vbtn("bottom").className).toContain(" on");
    const top = vbtn("top");
    expect(top.disabled).toBe(false);
    await act(async () => { fireEvent.click(top); });
    await confirmed(h0 + 1);
    expect(editOf(a).valign).toBe("top");
    await act(async () => { fireEvent.click(document.querySelector('[data-valign="middle"]')!); });
    await confirmed(h0 + 2);
    expect(editOf(a).valign).toBe("middle");
    // Bottom is where Excel puts it and this design draws it: nothing stored
    await act(async () => { fireEvent.click(vbtn("bottom")); });
    await confirmed(h0 + 3);
    expect(editOf(a).valign).toBeUndefined();
    await act(async () => { fireEvent.click(vbtn("top")); });
    await confirmed(h0 + 4);
    await act(async () => { fireEvent.click(btn("numDecUp")); });
    await confirmed(h0 + 5);
    await act(async () => { fireEvent.click(btn("clearFmt")); });
    await confirmed(h0 + 6);
    expect(editOf(a).valign).toBeUndefined(); expect(editOf(a).num).toBeUndefined();
    await design(d0 as "glass" | "excel");
  });

  it("PT-01 Liquid Glass (review 1): Excel's bottom is drawn centred, so the ribbon shows Middle; Bottom pressed is stored and shown; the painter carries it onto a default cell", async () => {
    const d0 = style().design; await design("glass");
    const { nums } = numbers(0), free = nums.filter(it => it.valign === "bottom" && !editOf(it).valign && !editOf(it).num), [a, b] = free.slice(-2), h0 = history();
    expect(free.length).toBeGreaterThanOrEqual(4);
    await act(async () => sel1(0, a)); await settle();
    // as drawn: Liquid Glass centres a workbook bottom
    expect(vbtn("middle").className).toContain(" on"); expect(vbtn("bottom").className).not.toContain(" on");
    await act(async () => { fireEvent.click(vbtn("middle")); }); await settle();
    expect(history()).toBe(h0);                                     // already there: nothing to store, no undo step
    await act(async () => { fireEvent.click(vbtn("bottom")); });
    await confirmed(h0 + 1);
    expect(editOf(a).valign).toBe("bottom");
    await vi.waitFor(() => expect(vbtn("bottom").className).toContain(" on"));
    expect(vbtn("middle").className).not.toContain(" on");
    // the painter: the source's bottom onto a default (centred) cell is stored there too
    await act(async () => { sel1(0, a); startPainter(false); }); await settle();
    expect(get().selection.painter!.pattern[0][0]!.valign).toBe("bottom");
    await act(async () => { sel1(0, b); applyPainter(); });
    await confirmed(h0 + 2);
    expect(editOf(b).valign).toBe("bottom");
    // and a centred source onto a default cell: nothing stored (it is drawn centred already)
    await act(async () => { sel1(0, free[0]); startPainter(false); }); await settle();
    expect(get().selection.painter!.pattern[0][0]!.valign).toBe("middle");
    await act(async () => { sel1(0, free[1]); applyPainter(); }); await settle();
    expect(editOf(free[1]).valign).toBeUndefined();
    await undoTo(h0);
    expect(editOf(a).valign).toBeUndefined(); expect(editOf(b).valign).toBeUndefined();
    await design(d0 as "glass" | "excel");
  });

  it("PT-01 the painter copies the number display, the vertical position and the font", async () => {
    const { nums } = numbers(0), [src, , , dst] = nums, h0 = history();
    await act(async () => change("Set up", [{ op: "cell.patch", sheet: src.L!.sheet.name, ref: keyOf(src), patch: { num: "0.000", valign: "top", font: "Arial" } } as Op]));
    await confirmed(h0 + 1);
    await act(async () => { sel1(0, src); startPainter(false); }); await settle();
    expect(get().selection.painter).toBeTruthy();
    await act(async () => { sel1(0, dst); applyPainter(); });
    await confirmed(h0 + 2);
    expect(editOf(dst)).toMatchObject({ num: "0.000", valign: "top", font: "Arial" });
    expect(get().selection.painter).toBeNull();
    // a date keeps its date format (a number's code is not pasted onto it), the rest of the look is
    const all = get().deck.slides.flatMap((s, si) => s.tables.map((T, t) => ({ si, t, T: T as TableLayout })));
    const date = all.flatMap(x => x.T.items.filter(it => { const c = x.T.sheet.get(it.b.src.r, it.b.src.c); return c && (c.t === "n" || c.t === "d") && isDateFmt(c.fmt); }).map(it => ({ ...x, it })))[0];
    expect(date).toBeTruthy();
    const h1 = history();
    await act(async () => gotoSlide(date.si)); await settle();
    const from = numbers(date.t).nums.find(it => !isDateFmt(it.L!.sheet.get(it.b.src.r, it.b.src.c)!.fmt))!;
    expect(from).toBeTruthy();
    await act(async () => change("Set up", [{ op: "cell.patch", sheet: from.L!.sheet.name, ref: keyOf(from), patch: { num: "0.000", valign: "top" } } as Op]));
    await confirmed(h1 + 1);
    await act(async () => { sel1(date.t, from); startPainter(false); }); await settle();
    await act(async () => { sel1(date.t, date.it); applyPainter(); });
    await confirmed(h1 + 2);
    expect(editOf(date.it).valign).toBe("top"); expect(editOf(date.it).num).toBeUndefined();
    await act(async () => undo(false)); await settle(8); await act(async () => undo(false)); await settle(8);
    await act(async () => gotoSlide(home)); await settle();
  });

  it("PT-02 several targets: Ctrl+click several ranges (two tables), let go of Ctrl: one paste on all of them, one undo step", async () => {
    const A = numbers(0).nums, B = numbers(1).nums, src = A[0], h0 = history();
    await act(async () => { sel1(0, src); startPainter(false); }); await settle();
    // a range of table 1, a cell of table 2, another cell of table 1: noted, nothing pasted yet
    await act(async () => { setSel(0, { r: A[4].b.r, c: A[4].b.c }, { r: A[5].b.r, c: A[5].b.c }); applyPainter(true); });
    await act(async () => { sel1(1, B[0]); applyPainter(true); });
    await act(async () => { sel1(0, A[6]); applyPainter(true); }); await settle();
    expect(get().selection.painter?.pend?.cells.length).toBe(3);
    expect(history()).toBe(h0);
    expect(document.querySelectorAll(".paintpend").length).toBeGreaterThanOrEqual(1);
    await act(async () => key("Control"));
    await confirmed(h0 + 1);
    for (const it of [A[4], A[5], B[0], A[6]]) expect(editOf(it), keyOf(it)).toMatchObject({ num: "0.000", valign: "top", font: "Arial" });
    expect(get().selection.painter).toBeNull();
    // one Ctrl+Z takes all of it back
    await act(async () => undo(false)); await settle(12);
    for (const it of [A[4], A[5], B[0], A[6]]) expect(editOf(it).num, keyOf(it)).toBeUndefined();
  });

  it("Ctrl+click multi-selection: the text and number controls act on every range at once (one undo step); a plain click starts again", async () => {
    const { nums } = numbers(0), h0 = history();
    await act(async () => { sel1(0, nums[7]); addSel(0, { r: nums[9].b.r, c: nums[9].b.c }); }); await settle();
    expect(get().selection.sel?.more?.length).toBe(1);
    expect(selCells().map(keyOf).sort()).toEqual([keyOf(nums[7]), keyOf(nums[9])].sort());
    // the table tools (borders, merges, charts, rows) act on the current range only (review 2)
    expect(selItems().map(keyOf)).toEqual([keyOf(nums[9])]);
    expect(document.querySelectorAll("#stage .selbox").length).toBeGreaterThanOrEqual(2);
    await act(async () => { fireEvent.click(btn("numThou")); });
    await confirmed(h0 + 1);
    expect(editOf(nums[7]).num ?? null).not.toBe(editOf(nums[8]).num ?? null);
    expect(editOf(nums[7]).num).toBe(editOf(nums[9]).num);
    await act(async () => sel1(0, nums[7])); await settle();
    expect(get().selection.sel?.more).toBeUndefined();
  });

  it("PT-03 objects: a callout's look onto others of its kind – one, or several with Ctrl (one undo step); another kind refuses", async () => {
    const R = get().deck.slides[get().deck.cur], h0 = history();
    const shape = (id: string, x: number, extra: object = {}): Op => ({ op: "item.patch", slide: R.id, id, patch: { kind: "shape", shape: "round", text: id, box: { x, y: 600, w: 120, h: 60 }, ...extra } } as Op);
    await act(async () => change("Callouts", [shape("pa", 100, { fill: "#C00000", border: { color: "#1F3864", w: 2 }, fmt: { b: true, color: "#FFFFFF" } }), shape("pb", 300, { fmt: { i: true } }), shape("pc", 500), shape("pd", 700),
      { op: "item.patch", slide: R.id, id: "ic", patch: { kind: "shape", shape: "icon", icon: "check", box: { x: 900, y: 600, w: 48, h: 48 } } } as Op]));
    await confirmed(h0 + 1);
    await act(async () => { selectItem("pa"); startPainter(false); }); await settle();
    expect(get().selection.painter?.obj?.kind).toBe("shape");
    // one target
    await act(async () => { expect(paintItem("pb", false)).toBe(true); });
    await confirmed(h0 + 2);
    const items = () => get().doc.view!.preset!.slides.find(s => s.id === R.id)!.items!;
    expect(R.id).toBeTruthy();
    expect(items().pb).toMatchObject({ fill: "#C00000", border: { color: "#1F3864", w: 2 }, fmt: { b: true, color: "#FFFFFF" }, text: "pb", box: { x: 300 } });
    expect((items().pb as { fmt: object }).fmt).not.toHaveProperty("i");
    // several with Ctrl: one change
    await act(async () => { selectItem("pa"); startPainter(true); }); await settle();
    await act(async () => { paintItem("pc", true); paintItem("pd", true); paintItem("ic", true); }); await settle();
    expect(get().selection.painter?.pend?.items).toEqual([{ slide: R.id, id: "pc" }, { slide: R.id, id: "pd" }]);
    expect(history()).toBe(h0 + 2);
    await act(async () => key("Control"));
    await confirmed(h0 + 3);
    expect(items().pc).toMatchObject({ fill: "#C00000" }); expect(items().pd).toMatchObject({ fill: "#C00000" });
    expect(items().ic).not.toHaveProperty("border");
    // sticky: still on, the targets cleared
    expect(get().selection.painter?.pend).toBeUndefined();
    await act(async () => stopPainter());
    await act(async () => undo(false)); await settle(12);
    expect(items().pc).not.toHaveProperty("fill"); expect(items().pd).not.toHaveProperty("fill");
    await act(async () => gotoSlide(get().deck.cur));
  });

  it("Ctrl+click ranges and the Borders menu (review 2): Outside frames the current range only – a range to its left gets no border", async () => {
    await act(async () => gotoSlide(home)); await settle();
    const { T, nums } = numbers(0), h0 = history();
    const right = nums.find(x => nums.some(y => y.b.r === x.b.r && y.b.c < x.b.c))!, left = nums.find(y => y.b.r === right.b.r && y.b.c < right.b.c)!;
    expect(T.def).toBeTruthy();
    await act(async () => { sel1(0, left); addSel(0, { r: right.b.r, c: right.b.c }); }); await settle();
    await act(async () => { fireEvent.click(btn("bordersBtn")); }); await settle();
    await act(async () => { fireEvent.click(document.querySelector('#borderMenu [data-b="outside"]')!); });
    await confirmed(h0 + 1);
    const bd = () => (get().doc.view!.preset!.tables.find(t => t.id === T.def!.id)!.borders || {}) as Record<string, Record<string, unknown>>;
    expect(Object.keys(bd()[keyOf(right)]).sort()).toEqual(["bottom", "left", "right", "top"]);
    expect(bd()[keyOf(left)]).toBeUndefined();
    await undoTo(h0);
    expect(bd()[keyOf(right)]).toBeUndefined();
  });

  it("PT-03 charts (review 3): series styles by position and the axes' formats travel – never the series' data, the axes' scale or titles", async () => {
    await act(async () => gotoSlide(home)); await settle();
    const R = get().deck.slides[get().deck.cur], sh = numbers(0).T.sheet.name, h0 = history();
    const ref = (range: string) => ({ sheet: sh, range });
    const chart = (id: string, x: number, extra: object): Op => ({ op: "item.patch", slide: R.id, id, patch: { kind: "chart", type: "column", values: ref("B2:B4"), box: { x, y: 560, w: 300, h: 200 }, ...extra } } as Op);
    await act(async () => change("Charts", [
      chart("ca", 100, { sers: {
          s1: { n: 0, name: "A", vals: [ref("B2:B4")], color: "#C00000", line: { w: 3, dash: "dashed" }, labels: { show: ["value"], pos: "outEnd" } },
          s2: { n: 1, name: "B", vals: [ref("C2:C4")], color: "#1F3864", smooth: true } },
        axes: { y: { min: 0, max: 100, step: 10, num: "0%", grid: false, fmt: { b: true }, title: "Source" }, y2: { show: true, num: "0.0" } } }),
      chart("cb", 500, { sers: {
          q: { n: 1, name: "Q", vals: [ref("C2:C4")], color: "#00FF00", line: { w: 1 } },
          p: { n: 0, name: "P", vals: [ref("B2:B4")], type: "line", axis: "y2" },
          r: { n: 2, name: "R", vals: [ref("D2:D4")], color: "#123456" } },
        axes: { y: { min: 5, max: 50, step: 5, num: "0", grid: true, title: "Target" }, x: { grid: true } } }),
    ]));
    await confirmed(h0 + 1);
    await act(async () => { selectItem("ca"); startPainter(false); }); await settle();
    expect(get().selection.painter?.obj?.kind).toBe("chart");
    await act(async () => { expect(paintItem("cb", false)).toBe(true); });
    await confirmed(h0 + 2);
    const cb = items(R.id).cb as { sers: Record<string, Record<string, unknown>>; axes: Record<string, Record<string, unknown>> };
    // by position: the source's 1st series' look on the target's 1st (p, n 0), its 2nd on q; r (no 3rd) keeps its own
    expect(cb.sers.p).toEqual({ n: 0, name: "P", vals: [ref("B2:B4")], type: "line", axis: "y2", color: "#C00000", line: { w: 3, dash: "dashed" }, labels: { show: ["value"], pos: "outEnd" } });
    expect(cb.sers.q).toEqual({ n: 1, name: "Q", vals: [ref("C2:C4")], color: "#1F3864", smooth: true });
    expect(cb.sers.r).toEqual({ n: 2, name: "R", vals: [ref("D2:D4")], color: "#123456" });
    // axes: the look over the target's scale and title; an axis only the source styles comes as its look; x back to the design's
    expect(cb.axes.y).toEqual({ min: 5, max: 50, step: 5, title: "Target", num: "0%", grid: false, fmt: { b: true } });
    expect(cb.axes.y2).toEqual({ show: true, num: "0.0" });
    expect(cb.axes.x).toBeUndefined();
    // the source untouched; one Ctrl+Z gives the target its own look back
    expect((items(R.id).ca as { sers: Record<string, unknown> }).sers.s2).toMatchObject({ name: "B", color: "#1F3864" });
    await undoTo(h0 + 1);
    const back = items(R.id).cb as typeof cb;
    expect(back.sers.p).not.toHaveProperty("color"); expect(back.sers.q.color).toBe("#00FF00"); expect(back.axes.y.num).toBe("0"); expect(back.axes.x).toEqual({ grid: true });
    await undoTo(h0);
  });

  it("PT-02 armed across slides: targets collected on two slides go in at once (one undo step); Esc with targets collected drops them", async () => {
    await act(async () => gotoSlide(home)); await settle();
    const A = numbers(0).nums, src = A[0], h0 = history();
    const other = get().deck.slides.findIndex((s, k) => k !== home && s.tables.some(t => t.items.some(it => it.ctype === "n" && it.text)));
    expect(other).toBeGreaterThanOrEqual(0);
    await act(async () => { sel1(0, src); startPainter(false); }); await settle();
    await act(async () => { sel1(0, A[10]); applyPainter(true); });
    await act(async () => gotoSlide(other)); await settle();
    expect(get().selection.painter).toBeTruthy();
    const t = get().deck.slides[other].tables.findIndex(T => T.items.some(it => it.ctype === "n" && it.text)), B = numbers(t).nums;
    await act(async () => { sel1(t, B[0]); applyPainter(true); }); await settle();
    expect(get().selection.painter?.pend?.cells.length).toBe(2);
    expect(history()).toBe(h0);
    await act(async () => key("Control"));
    await confirmed(h0 + 1);
    expect(editOf(A[10])).toMatchObject({ num: "0.000", font: "Arial" });
    expect(editOf(B[0])).toMatchObject({ font: "Arial" });
    expect(get().selection.painter).toBeNull();
    await undoTo(h0);
    expect(editOf(A[10]).font).toBeUndefined(); expect(editOf(B[0]).font).toBeUndefined();
    // Esc while targets are collected: the painter and its targets go, Ctrl let go pastes nothing
    await act(async () => gotoSlide(home)); await settle();
    await act(async () => { sel1(0, src); startPainter(false); }); await settle();
    await act(async () => { sel1(0, A[11]); applyPainter(true); }); await settle();
    expect(get().selection.painter?.pend?.cells.length).toBe(1);
    expect(document.body.dataset.paintPend).toBe("1");
    await act(async () => { fireEvent.keyDown(document.body, { key: "Escape" }); }); await settle();
    expect(get().selection.painter).toBeNull();
    await act(async () => key("Control")); await settle();
    expect(history()).toBe(h0); expect(editOf(A[11]).font).toBeUndefined();
    expect(document.body.dataset.paintPend).toBeUndefined();
  });

  it("PT-02 targets are kept by slide and table id (review 5): a slide added before them meanwhile – the paste still lands on the collected cells", async () => {
    await act(async () => gotoSlide(home)); await settle();
    const A = numbers(0).nums, src = A[0], target = A[12] ?? A[A.length - 1], h0 = history();
    expect(editOf(target).font).toBeUndefined();
    await act(async () => { sel1(0, src); startPainter(false); }); await settle();
    await act(async () => { sel1(0, target); applyPainter(true); }); await settle();
    // (another writer's slide at the front: every slide's index moves by one)
    await act(async () => change("Other writer", [{ op: "slide.add", slide: { id: "sZZfront", type: "content", title: "Front", subtitle: null, tables: [] }, after: null } as Op]));
    await confirmed(h0 + 1);
    expect(get().deck.slides[0].id).toBe("sZZfront");
    await act(async () => key("Control"));
    await confirmed(h0 + 2);
    expect(editOf(target)).toMatchObject({ num: "0.000", font: "Arial" });
    await undoTo(h0);
    expect(get().deck.slides[0].id).not.toBe("sZZfront");
  });
});
