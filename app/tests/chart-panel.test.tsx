/* The chart panel (S14.5, CT-08; docs/next/09 §2.2, §8 M14): the type switch gives an old chart (a pie of one range) its
   first series; series are added from cells of any sheet, removed and reordered; type and axis per series, colours per
   series and per point, labels, axes, legend place and hidden entries, category groups and dividers, targets, marks –
   each ONE item.patch (one undo step), changing only the entries it touches, so two writers on two series both keep
   theirs (both fold orders). A stack per series is not offered (PowerPoint cannot draw it). The stage picks a point or
   a mark from the chart's own hits. The panel's cost on a keypress (09 §7.4: keypress → pixels p95 50 ms). */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { Profiler } from "react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../src/editor/thumbs", async orig => ({ ...(await orig() as object), mountThumbs: () => { /* imperative */ } }));
vi.mock("../src/render/wall", async orig => ({ ...(await orig() as object), applyWall: () => { /* canvas */ } }));

import { App } from "../src/ui/App";
import { ItemPanel } from "../src/ui/ItemPanel";
import { get } from "../src/state/store";
import { change, gotoSlide, openLocalFile, undo } from "../src/state/app";
import { insertChartRefs, itemOf, itemPatch, selectItem } from "../src/editor/charts";
import {
  addGroupPatch, addMarkPatch, addSeriesPatch, allSeries, axisPatch, labelsPatch, legendHidePatch, moveSeriesPatch, newEntryId, pointPatch, refPatch,
  removeGroupPatch, removeSeriesPatch, seriesPatch, typePatch,
} from "../src/editor/chart-panel";
import { applyRef } from "../src/editor/chart-send";
import { chartHitAt, chartHits } from "../src/stage/chart-hits";
import { CHART_TEXT } from "../src/editor/chart-text";
import type { ChartItem, ItemPatch, Op, WorkbookDoc } from "@slide-builder/core/model/types";
import { applyOps, emptyDoc, inverseOf } from "@slide-builder/core/model/ops";
import { indexWorkbook } from "@slide-builder/core/xlsx/workbook";
import { defaultPreset } from "@slide-builder/core/model/preset";

const here = path.dirname(fileURLToPath(import.meta.url));
Element.prototype.scrollIntoView ??= function () { /* nothing to scroll */ };

/* ---- the panel's changes as operations (editor/chart-panel.ts) ---- */
const box = { x: 0, y: 0, w: 600, h: 400 };
const pie: ChartItem = { kind: "chart", type: "pie", values: { sheet: "SLIDE_1", range: "D6:D8" }, labels: { sheet: "SLIDE_1", range: "C6:C8" }, series: "Loans", box };
/** a deck with one slide holding `it` as item "c" */
function docWith(it: ChartItem) {
  const ops = [{ op: "preset.set", preset: { sheets: ["SLIDE_1"], tables: [], slides: [{ id: "s", type: "content", tables: [] }] } }, { op: "item.patch", slide: "s", id: "c", patch: it }] as Op[];
  return applyOps(emptyDoc("W.xlsx"), ops).doc;
}
const itemIn = (d: Pick<WorkbookDoc, "preset">) => d.preset!.slides[0].items!.c as ChartItem;
const op = (p: ItemPatch) => ({ op: "item.patch", slide: "s", id: "c", patch: p }) as Op;
/** the same change of item `id` on the page's current slide */
const op2 = (id: string, p: ItemPatch) => ({ op: "item.patch", slide: get().deck.slides[get().deck.cur].id, id, patch: p }) as Op;
/** a patch applied, and undone by its inverse: back to the chart as it was */
function roundTrip(it: ChartItem, p: ItemPatch | null) {
  expect(p).not.toBeNull();
  const d0 = docWith(it), o = op(p!), inv = inverseOf(d0, o)!, d1 = applyOps(d0, [o]).doc;
  expect(applyOps(d1, [inv]).doc.preset!.slides[0].items!.c).toEqual(itemIn(d0));
  return itemIn(d1);
}

const col = (() => { const d0 = docWith(pie); return itemIn(applyOps(d0, [op(typePatch(pie, "column"))]).doc); })();
describe("the panel's changes (editor/chart-panel.ts): one item.patch each, undone by its inverse", () => {
  it("the type switch: an old chart (no series) gets its first series from its numbers, `values` kept; back to pie keeps the series", () => {
    const col = roundTrip(pie, typePatch(pie, "column"));
    expect(col.type).toBe("column");
    expect(col.sers).toEqual({ s1: { n: 1, vals: [pie.values], name: "Loans" } });
    expect(col.values).toEqual(pie.values);
    expect(col.labels).toEqual(pie.labels);
    expect(typePatch(col, "pie")).toEqual({ type: "pie" });
    expect(typePatch(col, "combo")).toEqual({ type: "combo" });                // its series are already there
    expect(typePatch(pie, "donut")).toEqual({ type: "donut" });
  });
  it("the type switch carries the pie's own slice colours into the points and its labels into the series' (S14.5 review 6)", () => {
    const styled: ChartItem = { ...pie, colors: { 0: "#123456", 2: "#abcdef", 5: "nope" }, show: ["label", "value", "percent"] };
    const c = roundTrip(styled, typePatch(styled, "line"));
    expect(c.sers!.s1).toEqual({ n: 1, vals: [pie.values], name: "Loans", points: { 0: { color: "#123456" }, 2: { color: "#ABCDEF" } }, labels: { show: ["category", "value"] } });
    // (a pie's "percent", a share of the whole pie, has no column / line counterpart; nothing set, nothing carried)
    expect(typePatch({ ...pie, show: ["percent"] }, "column").sers!.s1).toEqual({ n: 1, vals: [pie.values], name: "Loans" });
  });
  it("series: add (from another sheet), remove (its legend entry and marks with it), reorder (two entries)", () => {
    const add = addSeriesPatch(col, { sheet: "Numbers", range: "B9:B11" }), s2 = Object.keys(add.sers!)[0];
    expect(s2).toMatch(/^s[0-9a-z]{5}$/);                                          // a random id (review 1)
    const two = roundTrip(col, add);
    expect(allSeries(two).map(([id, s]) => [id, s.n, s.vals])).toEqual([["s1", 1, [pie.values]], [s2, 2, [{ sheet: "Numbers", range: "B9:B11" }]]]);
    // a combo's new series: a line
    expect(Object.values(addSeriesPatch({ ...two, type: "combo" }, pie.values).sers!)[0]).toMatchObject({ n: 3, type: "line" });
    const moved = roundTrip(two, moveSeriesPatch(two, s2, -1));
    expect(allSeries(moved).map(([id]) => id)).toEqual([s2, "s1"]);
    expect(Object.keys(moveSeriesPatch(two, s2, -1)!.sers!)).toEqual([s2, "s1"]);       // only the two entries
    expect(moveSeriesPatch(two, "s1", -1)).toBeNull();
    // equal n: the order asked for, whatever the ids
    const tied: ChartItem = { ...two, sers: { a: { n: 1, vals: [] }, b: { n: 1, vals: [] } } };
    expect(allSeries(roundTrip(tied, moveSeriesPatch(tied, "b", -1))).map(([id]) => id)).toEqual(["b", "a"]);
    const marked = roundTrip(two, { ...addMarkPatch(two, "arrow", { s: s2, i: 1 }), legendHide: { [s2]: true } });
    const gone = roundTrip(marked, removeSeriesPatch(marked, s2));
    expect(Object.keys(gone.sers!)).toEqual(["s1"]);
    expect(gone.marks).toBeUndefined();
    expect(gone.legendHide).toBeUndefined();
  });
  it("per series: type and axis, colour, name from a cell, targets, x values, smoothing, labels; per point: colour, label, a waterfall total", () => {
    let c = roundTrip(col, seriesPatch(col, "s1", { type: "line", axis: "y2", color: "#123456", smooth: true }));
    expect(c.sers!.s1).toMatchObject({ type: "line", axis: "y2", color: "#123456", smooth: true });
    c = roundTrip(c, seriesPatch(c, "s1", { axis: null }));
    expect(c.sers!.s1.axis).toBeUndefined();
    c = roundTrip(c, refPatch(c, { what: "name", ser: "s1" }, { sheet: "SLIDE_1", range: "D4:D5" }));
    expect(c.sers!.s1.name).toEqual({ sheet: "SLIDE_1", range: "D4" });
    c = roundTrip(c, refPatch(c, { what: "target", ser: "s1" }, { sheet: "SLIDE_1", range: "F6:F8" }));
    expect(c.sers!.s1.target).toEqual([{ sheet: "SLIDE_1", range: "F6:F8" }]);
    c = roundTrip(c, refPatch(c, { what: "xs", ser: "s1" }, { sheet: "SLIDE_1", range: "E6:E8" }));
    expect(c.sers!.s1.xs).toEqual([{ sheet: "SLIDE_1", range: "E6:E8" }]);
    c = roundTrip(c, labelsPatch(c, "s1", { show: ["value", "ofTarget"], pos: "inEnd" }));
    expect(c.sers!.s1.labels).toEqual({ show: ["value", "ofTarget"], pos: "inEnd" });
    c = roundTrip(c, labelsPatch(c, "s1", { show: [], pos: null }));
    expect(c.sers!.s1.labels).toBeUndefined();
    c = roundTrip(c, pointPatch(c, "s1", 2, { color: "#A6A6A6", label: null }));
    expect(c.sers!.s1.points).toEqual({ 2: { color: "#A6A6A6", label: null } });
    c = roundTrip(c, pointPatch(c, "s1", 2, { total: true }));
    expect((c.sers!.s1.points!["2"] as { total?: boolean }).total).toBe(true);
    c = roundTrip(c, pointPatch(c, "s1", 2, { color: null, label: undefined, total: null }));
    expect(c.sers!.s1.points).toBeUndefined();
  });
  it("axes, legend (place, a hidden entry), category groups (the present categories become the first) and their dividers, marks", () => {
    let c = roundTrip(col, axisPatch(col, "y", { min: 0, max: 9e6, step: 1e6, num: "#,##0", grid: false }));
    expect(c.axes).toEqual({ y: { min: 0, max: 9e6, step: 1e6, num: "#,##0", grid: false } });
    c = roundTrip(c, axisPatch(c, "y", { min: null, max: null, step: null, num: null, grid: null }));
    expect(c.axes).toBeUndefined();
    c = roundTrip(c, { legendAt: "inside-tr" });
    c = roundTrip(c, legendHidePatch("s1", true));
    expect([c.legendAt, c.legendHide]).toEqual(["inside-tr", { s1: true }]);
    const gp = addGroupPatch(c, { sheet: "Numbers", range: "B9:B10" }), g2 = Object.keys(gp.groups!).find(k => k !== "g1")!;
    expect(g2).toMatch(/^g[0-9a-z]{5}$/);
    c = roundTrip(c, gp);
    expect(c.groups).toEqual({ g1: { n: 1, cats: pie.labels }, [g2]: { n: 2, cats: { sheet: "Numbers", range: "B9:B10" }, divider: { dash: "dashed" } } });
    c = roundTrip(c, seriesPatch(c, "s1", { group: g2 }));
    const ungrouped = roundTrip(c, removeGroupPatch(c, g2));
    expect(Object.keys(ungrouped.groups!)).toEqual(["g1"]);
    expect(ungrouped.sers!.s1.group).toBeUndefined();
    for (const k of ["arrow", "icon", "text", "line", "band"] as const) {
      const m = Object.values(roundTrip(c, addMarkPatch(c, k, { s: "s1", i: 0 }, 3)).marks!)[0];
      expect(m.kind).toBe(k);
      expect(m.a).toEqual({ s: "s1", i: 0 });
    }
    expect(Object.values(addMarkPatch(c, "arrow", { s: "s1", i: 0 })!.marks!)[0]).toMatchObject({ b: "floor", style: { heads: { a: "triangle" } } });
    // (review 3) nothing to stand on: no mark – a series that is gone, a point past its series' end, and a line or a
    // band at its series' last point (no next one); an arrow, icon or text there is fine
    expect(addMarkPatch(c, "arrow", { s: "gone", i: 0 })).toBeNull();
    expect(addMarkPatch(c, "text", { s: "s1", i: 3 }, 3)).toBeNull();
    expect(addMarkPatch(c, "line", { s: "s1", i: 2 }, 3)).toBeNull();
    expect(addMarkPatch(c, "band", { s: "s1", i: 2 }, 3)).toBeNull();
    expect(addMarkPatch(c, "line", { s: "s1", i: 1 }, 3)).not.toBeNull();
    expect(addMarkPatch(c, "icon", { s: "s1", i: 2 }, 3)).not.toBeNull();
  });
  it("two writers: two series changed at once both stay (in either order); one series changed by both: the later one", () => {
    const add = addSeriesPatch(col, { sheet: "Numbers", range: "B9:B11" }), s2 = Object.keys(add.sers!)[0];
    const two = itemIn(applyOps(docWith(col), [op(add)]).doc);
    const a = op(seriesPatch(two, "s1", { color: "#111111" })!), b = op(seriesPatch(two, s2, { axis: "y2" })!), ax = op(axisPatch(two, "y", { min: 0 }));
    for (const order of [[a, b, ax], [ax, b, a], [b, a, ax]]) {
      const c = itemIn(applyOps(docWith(two), order).doc);
      expect([c.sers!.s1.color, c.sers![s2].axis, c.axes?.y?.min]).toEqual(["#111111", "y2", 0]);
    }
    const x = op(seriesPatch(two, "s1", { color: "#222222" })!);
    expect(itemIn(applyOps(docWith(two), [a, x]).doc).sers!.s1.color).toBe("#222222");
    expect(itemIn(applyOps(docWith(two), [x, a]).doc).sers!.s1.color).toBe("#111111");
  });
  it("two writers ADDING at once (review 1): each made its patch from the same chart; both series, both groups, both marks stay, in either order", () => {
    // each writer's page made its patch from the chart as it saw it – the same one
    const sa = op(addSeriesPatch(col, { sheet: "Numbers", range: "B9:B11" })), sb = op(addSeriesPatch(col, { sheet: "SLIDE_1", range: "F6:F8" }));
    const ga = op(addGroupPatch(col, { sheet: "Numbers", range: "B9:B10" })), gb = op(addGroupPatch(col, { sheet: "SLIDE_1", range: "C9:C10" }));
    const ma = op(addMarkPatch(col, "arrow", { s: "s1", i: 0 })!), mb = op(addMarkPatch(col, "text", { s: "s1", i: 1 })!);
    for (const order of [[sa, sb, ga, gb, ma, mb], [mb, gb, sb, ma, ga, sa]]) {
      const c = itemIn(applyOps(docWith(col), order).doc);
      expect(allSeries(c).map(([, s]) => s.vals[0])).toEqual(expect.arrayContaining([pie.values, { sheet: "Numbers", range: "B9:B11" }, { sheet: "SLIDE_1", range: "F6:F8" }]));
      expect(allSeries(c)).toHaveLength(3);
      // the present categories' group "g1" written by both (equal), and each writer's own group
      expect(Object.values(c.groups!).map(g => g.cats)).toEqual(expect.arrayContaining([pie.labels, { sheet: "Numbers", range: "B9:B10" }, { sheet: "SLIDE_1", range: "C9:C10" }]));
      expect(Object.keys(c.groups!)).toHaveLength(3);
      expect(Object.values(c.marks!).map(m => m.kind).sort()).toEqual(["arrow", "text"]);
    }
    // a new id is never one the chart has: a roll that hits one rolls again
    const first = newEntryId({}, "m", () => 0.5), rolls = [0.5, 0.25];
    let k = 0;
    expect(newEntryId({ [first]: 1 }, "m", () => rolls[k++])).toBe(newEntryId({}, "m", () => 0.25));
    expect(k).toBe(2);
  });
});

describe("the stage's point and mark hits (stage/chart-hits.ts)", () => {
  const nodes = [{ t: "group", transform: [1, 0, 0, 1, 10, 20], children: [
    { t: "hit", kind: "point", id: "c:s1:0", x: 0, y: 0, w: 20, h: 20, label: "Loans · Alpha" },
    { t: "hit", kind: "point", id: "c:my:id:3", x: 30, y: 0, w: 20, h: 20 },
    { t: "hit", kind: "mark", id: "c:m1", x: 5, y: 5, w: 30, h: 30 },
    { t: "hit", kind: "item", id: "c", x: 0, y: 0, w: 100, h: 100 }] }] as never;
  it("a point by series and index (a series id with ':' too), a mark before a point under it, nothing outside", () => {
    expect(chartHits(nodes, "c").map(h => h.point ?? h.mark)).toEqual([{ s: "s1", i: 0 }, { s: "my:id", i: 3 }, "m1"]);
    expect(chartHitAt(nodes, "c", 12, 22)?.point).toEqual({ s: "s1", i: 0 });
    expect(chartHitAt(nodes, "c", 20, 30)?.mark).toBe("m1");
    expect(chartHitAt(nodes, "c", 200, 200)).toBeNull();
    expect(chartHitAt(nodes, "other", 12, 22)).toBeNull();
  });
  it("the status line names the selected point or mark", () => {
    const c = { ...col, sers: { s1: { n: 1, name: "Loans", vals: [] } } };
    expect(CHART_TEXT.status(c, { id: "c", slice: null, point: { s: "s1", i: 2 } })).toMatch(/^Point 3 of 'Loans' selected/);
    expect(CHART_TEXT.status(c, { id: "c", slice: null, mark: "m1" })).toMatch(/^A mark of the chart selected/);
  });
});

/* ---- the panel on the page (CT-08) ---- */
async function settle(n = 8) { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }
const history = () => get().deck.history.undo;
async function confirmed(steps: number) { await vi.waitFor(() => expect(history()).toBe(steps), { timeout: 10_000 }); await settle(); }
const panel = () => document.getElementById("chartPanel")!;
const q = (sel: string) => panel().querySelector(sel) as HTMLElement;
/** a Field typed into and applied (Enter blurs it) */
async function type(el: HTMLElement, v: string) {
  await act(async () => { fireEvent.focus(el); fireEvent.change(el, { target: { value: v } }); fireEvent.blur(el); });
}

describe("the chart panel on the page (CT-08)", () => {
  let id = "", s2 = "", s3 = "";
  const it_ = () => itemOf(id) as ChartItem;
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
    // (a content slide with a table: the keypress measurement types into it)
    const si = get().deck.slides.findIndex(R => R.tables.some(T => T.def?.sheet === "SLIDE_1"));
    expect(si).toBeGreaterThanOrEqual(0);
    await act(async () => gotoSlide(si)); await settle();
    const h0 = history();
    await act(async () => { id = insertChartRefs({ sheet: "SLIDE_1", range: "D6:D8" }, { sheet: "SLIDE_1", range: "C6:C8" })!; });
    await confirmed(h0 + 1);
    await vi.waitFor(() => expect(document.getElementById("chartPanel")).toBeTruthy());
  });
  afterAll(() => cleanup());

  it("an old chart saved as type \"column\" without series (4.3–4.6) shows Pie, as it draws; Column then gives it its series (M14 review 9)", async () => {
    const h0 = history();
    await act(async () => { itemPatch("Old column chart", id, { type: "column" }); }); await confirmed(h0 + 1);
    expect(it_().type).toBe("column"); expect(it_().sers).toBeUndefined();
    await vi.waitFor(() => expect(q('[data-ctype="pie"]').className).toBe("on"));
    expect(q('[data-ctype="column"]').className).toBe("");
    await act(async () => { fireEvent.click(q('[data-ctype="column"]')); }); await confirmed(h0 + 2);
    expect(it_().sers).toEqual({ s1: { n: 1, vals: [{ sheet: "SLIDE_1", range: "D6:D8" }] } });
    expect(q('[data-ctype="column"]').className).toBe("on");
    await act(async () => undo(false)); await confirmed(h0 + 1);
    await act(async () => undo(false)); await confirmed(h0);
    expect(it_().type).toBe("pie");
  });

  it("a pie switched to columns: one step, its first series from its numbers; the series panel replaces the slices; undo", async () => {
    const h0 = history();
    expect(q('[data-ctype="pie"]').className).toBe("on");
    expect(q("#chartSlices") ?? q("#chartSource")).toBeTruthy();
    await act(async () => { fireEvent.click(q('[data-ctype="column"]')); }); await confirmed(h0 + 1);
    expect(it_().sers).toEqual({ s1: { n: 1, vals: [{ sheet: "SLIDE_1", range: "D6:D8" }] } });
    expect(q('[data-ctype="column"]').className).toBe("on");
    expect(q("#chartSeriesPanel")).toBeTruthy();
    expect(q("#chartSource")).toBeNull();
    await act(async () => undo(false)); await confirmed(h0);
    expect(it_().sers).toBeUndefined();
    expect(q("#chartSeriesPanel")).toBeNull();
    await act(async () => { fireEvent.click(q('[data-ctype="column"]')); }); await confirmed(h0 + 1);
  });

  it("+ Add series… asks for the cells in the sheet view; the chosen cells (another sheet) add a series – one step; ↑ reorders, × removes", async () => {
    const h0 = history();
    await act(async () => { fireEvent.click(q("#chartAddSeries")); }); await settle();
    expect(get().ui.dialogs.pick).toEqual({ kind: "chart-ref", id, ref: { what: "add" } });
    await vi.waitFor(() => expect(document.getElementById("pickCells")?.textContent).toContain("Chart: add a series"));
    expect(document.getElementById("pkNoNames")).toBeNull();                        // one step: no names step
    await act(async () => { fireEvent.click(document.querySelector('#pickCells [data-a="cancel"]')!); });
    expect(document.getElementById("pickCells")).toBeNull();
    // (what the dialog does with the cells chosen there)
    await act(async () => { applyRef(id, { what: "add" }, { sheet: "SLIDE_1", range: "F6:F8" }); }); await confirmed(h0 + 1);
    await act(async () => { applyRef(id, { what: "add" }, { sheet: "Numbers", range: "B9:B11" }); }); await confirmed(h0 + 2);
    const ids = allSeries(it_()).map(([k]) => k);
    expect(allSeries(it_()).map(([, s]) => s.vals[0].range)).toEqual(["D6:D8", "F6:F8", "B9:B11"]);
    [s2, s3] = ids.slice(1);
    await vi.waitFor(() => expect(panel().querySelectorAll(".ser").length).toBe(3));
    await act(async () => { fireEvent.click(q(`[data-ser="${s3}"] [data-a="up"]`)); }); await confirmed(h0 + 3);
    expect(allSeries(it_()).map(([k]) => k)).toEqual(["s1", s3, s2]);
    expect(get().deck.history.undoLabel).toBe("Series order");
    await act(async () => { fireEvent.click(q(`[data-ser="${s3}"] [data-a="remove"]`)); }); await confirmed(h0 + 4);
    expect(allSeries(it_()).map(([k]) => k)).toEqual(["s1", s2]);
    await act(async () => undo(false)); await confirmed(h0 + 3);
    expect(allSeries(it_()).map(([k]) => k)).toEqual(["s1", s3, s2]);
  });

  it("a series' details: its name, combo type, right axis, labels; the stack per series is disabled and says why", async () => {
    let h = history();
    await type(q(`[data-ser="${s2}"] [data-a="name"]`), "Deposits"); await confirmed(h + 1);
    expect(it_().sers![s2].name).toBe("Deposits");
    h = history();
    await act(async () => { fireEvent.click(q('[data-ctype="combo"]')); }); await confirmed(h + 1);
    await act(async () => { fireEvent.click(q(`[data-ser="${s2}"] [data-a="more"]`)); });
    await act(async () => { fireEvent.click(q(`[data-ser="${s2}"] [data-stype="line"]`)); }); await confirmed(h + 2);
    await act(async () => { fireEvent.click(q(`[data-ser="${s2}"] [data-axis="y2"]`)); }); await confirmed(h + 3);
    expect(it_().sers![s2]).toMatchObject({ type: "line", axis: "y2", name: "Deposits" });
    const box = q(`[data-ser="${s2}"] [data-lshow="value"]`) as HTMLInputElement;
    await act(async () => { box.checked = true; fireEvent(box, new Event("change", { bubbles: true })); }); await confirmed(h + 4);
    expect(it_().sers![s2].labels).toEqual({ show: ["value"] });
    const stack = q(`[data-ser="${s2}"] [data-a="serstack"]`) as HTMLSelectElement;
    expect(stack.disabled).toBe(true);
    expect(stack.title).toMatch(/PowerPoint/);
    // the right axis shows in Axes once a series stands on it; its maximum: one step
    expect(q('#chartAxes [data-ax="y2"]')).toBeTruthy();
    await type(q('#chartAxes [data-ax="y2"] .num'), "0"); await confirmed(h + 5);
    expect(it_().axes?.y2?.min).toBe(0);
    expect(get().deck.history.undoLabel).toBe("Right axis: minimum");
  });

  it("legend place and a hidden entry; a group of other categories with a divider; one step each", async () => {
    const h = history();
    await act(async () => { fireEvent.change(q("#chartLegendAt"), { target: { value: "top" } }); }); await confirmed(h + 1);
    expect(it_().legendAt).toBe("top");
    const cb = q(`#chartLegend [data-hide="${s2}"]`) as HTMLInputElement;
    await act(async () => { cb.checked = false; fireEvent(cb, new Event("change", { bubbles: true })); }); await confirmed(h + 2);
    expect(it_().legendHide).toEqual({ [s2]: true });
    await act(async () => { applyRef(id, { what: "group-add" }, { sheet: "Numbers", range: "B9:B10" }); }); await confirmed(h + 3);
    const g2 = Object.keys(it_().groups!).find(k => k !== "g1")!;
    expect(Object.keys(it_().groups!).sort()).toEqual(["g1", g2].sort());
    await vi.waitFor(() => expect(panel().querySelectorAll("#chartGroups .grp").length).toBe(2));
    await act(async () => { fireEvent.change(q(`#chartGroups [data-group="${g2}"] [data-a="divider"]`), { target: { value: "dotted" } }); }); await confirmed(h + 4);
    expect(it_().groups![g2].divider).toEqual({ dash: "dotted" });
    await act(async () => undo(false)); await confirmed(h + 3);
    expect(it_().groups![g2].divider).toEqual({ dash: "dashed" });
  });

  it("a point selected (as the stage does): its colour and label; marks need a point and are added there; the panel's cost on a keypress", async () => {
    const h = history();
    expect((q('[data-addmark="arrow"]') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { selectItem(id, null, { point: { s: "s1", i: 1 } }); });
    expect(q("#chartPoint")?.dataset.i).toBe("1");
    await type(q('#chartPoint [data-a="plabel"]'), "Peak"); await confirmed(h + 1);
    expect(it_().sers!.s1.points).toEqual({ 1: { label: "Peak" } });
    await act(async () => { fireEvent.click(q('[data-addmark="arrow"]')); }); await confirmed(h + 2);
    expect(Object.values(it_().marks!)).toEqual([{ kind: "arrow", a: { s: "s1", i: 1 }, b: "floor", style: { w: 1.5, heads: { a: "triangle" } } }]);
    await vi.waitFor(() => expect(panel().querySelectorAll("#chartMarks .mark").length).toBe(1));
  });

  it("a stale point adds nothing (review 3): the series' last point has no line or band to the next; its series removed, the point leaves the selection", async () => {
    const dis = (k: string) => (q(`[data-addmark="${k}"]`) as HTMLButtonElement).disabled;
    await act(async () => { selectItem(id, null, { point: { s: "s1", i: 2 } }); });   // s1: D6:D8, three points
    expect(q("#chartPoint")?.dataset.i).toBe("2");
    expect(["arrow", "icon", "text", "line", "band"].map(dis)).toEqual([false, false, false, true, true]);
    expect(q('[data-addmark="line"]').title).toMatch(/no next point/);
    await act(async () => { selectItem(id, null, { point: { s: s2, i: 1 } }); });
    expect(["arrow", "line"].map(dis)).toEqual([false, false]);
    const h = history();
    await act(async () => { fireEvent.click(q(`[data-ser="${s2}"] [data-a="remove"]`)); }); await confirmed(h + 1);
    await vi.waitFor(() => expect(get().selection.itemSel?.point ?? null).toBeNull());
    expect(get().selection.itemSel?.id).toBe(id);                                 // the chart stays selected
    expect(q("#chartPoint")).toBeNull();
    expect(["arrow", "icon", "text", "line", "band"].map(dis)).toEqual([true, true, true, true, true]);
    // a mark selected and then removed (another writer) leaves the selection too
    const mid = Object.keys(it_().marks!)[0];
    await act(async () => { selectItem(id, null, { mark: mid }); });
    expect(get().selection.itemSel?.mark).toBe(mid);
    await act(async () => { change("Remove mark", [op2(id, { marks: { [mid]: null } })]); }); await confirmed(h + 2);
    await vi.waitFor(() => expect(get().selection.itemSel?.mark ?? null).toBeNull());
    await act(async () => undo(false)); await confirmed(h + 1);
    await act(async () => undo(false)); await confirmed(h);
    expect(Object.keys(it_().sers!)).toContain(s2);
  });

  it("the panel's cost on a keypress", async () => {
    await act(async () => { selectItem(id, null, { point: { s: "s1", i: 1 } }); });
    // a cell typed into on the slide's own table (the chart unchanged) does not draw the panel again (S14.5 review 4:
    // measured 0; at most the one draw of a store change that reaches it); when the chart itself changes (20 changes of
    // an axis) the panel's own draw – React's Profiler time of ItemPanel, not keypress → pixels (that is the bench's,
    // tools/bench.mjs) – stays far below 09 §7.4's 50 ms
    const times: number[] = [];
    const { unmount } = render(<Profiler id="p" onRender={(_id, _ph, actual) => times.push(actual)}><ItemPanel /></Profiler>);
    const first = times.length;
    for (let k = 0; k < 20; k++) await act(async () => { change("Cell", [{ op: "cell.patch", sheet: "SLIDE_1", ref: "E6", patch: { text: String(k + 1) + ",5", orig: "2,5" } } as Op]); });
    const onKeys = times.length - first;
    expect(onKeys).toBeLessThanOrEqual(1);
    times.length = 0;
    for (let k = 0; k < 20; k++) await act(async () => { change("Left axis: step", [op2(id, axisPatch(it_(), "y", { step: (k + 1) * 1e6 }))]); });
    unmount();
    const sortedT = times.slice().sort((a, b) => a - b), p95 = sortedT[Math.ceil(sortedT.length * .95) - 1] ?? 0;
    // (CHART_PANEL_TIMES=<file>: the numbers appended there, for PROGRESS's measurements)
    if (process.env.CHART_PANEL_TIMES) fs.appendFileSync(process.env.CHART_PANEL_TIMES, `chart panel: ${onKeys} draws on 20 keypresses; its draw on a chart change: p50 ${sortedT[Math.floor(sortedT.length / 2)]?.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, max ${sortedT[sortedT.length - 1]?.toFixed(2)} ms (${times.length} draws)\n`);
    expect(times.length).toBeGreaterThanOrEqual(10);                              // (changes close together draw once)
    expect(p95).toBeLessThan(50);
  });
});
