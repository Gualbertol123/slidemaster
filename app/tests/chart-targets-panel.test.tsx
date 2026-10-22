/* The chart panel's targets (4.10, B52): reference lines from a cell (picked in the sheet view; a typed value the
   fallback), gap arrows, change pills and the point values – each control ONE item.patch of one marks entry (one undo
   step), each extra switched on / off and styled on its own; the builders' inverses put the chart back. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../src/editor/thumbs", async orig => ({ ...(await orig() as object), mountThumbs: () => { /* imperative */ } }));
vi.mock("../src/render/wall", async orig => ({ ...(await orig() as object), applyWall: () => { /* canvas */ } }));

import { App } from "../src/ui/App";
import { get } from "../src/state/store";
import { gotoSlide, openLocalFile, undo } from "../src/state/app";
import { insertChartRefs, itemOf, selectItem } from "../src/editor/charts";
import { addChangePatch, addGapPatch, addRefPatch, markOnPatch, oneCell, refPatch, removeSeriesPatch } from "../src/editor/chart-panel";
import { applyRef } from "../src/editor/chart-send";
import type { ChartItem, ChartMark, ItemPatch, Op } from "@slide-builder/core/model/types";
import { applyOps, emptyDoc, inverseOf, needsV7 } from "@slide-builder/core/model/ops";
import { indexWorkbook } from "@slide-builder/core/xlsx/workbook";
import { defaultPreset } from "@slide-builder/core/model/preset";

const here = path.dirname(fileURLToPath(import.meta.url));
Element.prototype.scrollIntoView ??= function () { /* nothing to scroll */ };

const box = { x: 0, y: 0, w: 600, h: 400 };
const line: ChartItem = { kind: "chart", type: "line", values: { sheet: "SLIDE_1", range: "D6:D8" }, box, sers: { s1: { n: 1, vals: [{ sheet: "SLIDE_1", range: "D6:D8" }] } } };
function docWith(it: ChartItem) {
  const ops = [{ op: "preset.set", preset: { sheets: ["SLIDE_1"], tables: [], slides: [{ id: "s", type: "content", tables: [] }] } }, { op: "item.patch", slide: "s", id: "c", patch: it }] as Op[];
  return applyOps(emptyDoc("W.xlsx"), ops).doc;
}
const itemIn = (d: ReturnType<typeof docWith>) => d.preset!.slides[0].items!.c as ChartItem;
/** a patch applied as one op, and undone by its inverse: back to the chart as it was */
function roundTrip(it: ChartItem, p: ItemPatch | null) {
  expect(p).not.toBeNull();
  const d0 = docWith(it), o = { op: "item.patch", slide: "s", id: "c", patch: p } as Op, inv = inverseOf(d0, o)!, d1 = applyOps(d0, [o]).doc;
  expect(applyOps(d1, [inv]).doc.preset!.slides[0].items!.c).toEqual(itemIn(d0));
  expect(needsV7(o)).toBe(true);
  return itemIn(d1);
}
const only = (it: ChartItem, kind: string): [string, ChartMark] => Object.entries(it.marks || {}).find(([, k]) => k.kind === kind)!;

describe("the builders (editor/chart-panel.ts): one marks entry each, undone by its inverse; format 7", () => {
  it("a reference line at a cell (its first cell), or typed; its value or name from a cell; switched off and on", () => {
    const a = roundTrip(line, addRefPatch(line, { sheet: "Targets", range: "B3:C3" }));
    const [rid, r] = only(a, "ref");
    expect(r).toEqual({ kind: "ref", value: { sheet: "Targets", range: "B3" } });
    expect(only(roundTrip(line, addRefPatch(line, 11790)), "ref")[1].value).toBe(11790);
    expect(refPatch(a, { what: "ref-value", mark: rid }, { sheet: "T2", range: "D4:D5" })).toEqual({ marks: { [rid]: { kind: "ref", value: { sheet: "T2", range: "D4" } } } });
    expect(refPatch(a, { what: "ref-name", mark: rid }, { sheet: "T2", range: "D3" })).toEqual({ marks: { [rid]: { kind: "ref", value: { sheet: "Targets", range: "B3" }, name: { sheet: "T2", range: "D3" } } } });
    const off = roundTrip(a, markOnPatch(a, rid, false));
    expect(off.marks![rid].off).toBe(true);
    expect(markOnPatch(off, rid, true)).toEqual({ marks: { [rid]: { kind: "ref", value: { sheet: "Targets", range: "B3" } } } });
    expect([oneCell({ what: "ref-add" }), oneCell({ what: "ref-value", mark: "r" }), oneCell({ what: "vals", ser: "s" })]).toEqual([true, true, false]);
  });
  it("a gap arrow needs a reference line (to the first one, from the last point or the selected one); change pills on the first line series", () => {
    expect(addGapPatch(line)).toBeNull();
    const a = docWith(line), withRef = roundTrip(itemIn(a), addRefPatch(line, 5)), rid = only(withRef, "ref")[0];
    expect(only(roundTrip(withRef, addGapPatch(withRef)), "gap")[1]).toEqual({ kind: "gap", a: { s: "s1", i: -1 }, ref: rid, caption: "gap to target" });
    expect(only(roundTrip(withRef, addGapPatch(withRef, { s: "s1", i: 1 })), "gap")[1].a).toEqual({ s: "s1", i: 1 });
    expect(only(roundTrip(line, addChangePatch(line)), "change")[1]).toEqual({ kind: "change", a: { s: "s1", i: -1 }, caption: "Change" });
    // a series removed takes its gap arrows and pills with it (they stand on it, M14's rule)
    const both = roundTrip(roundTrip(withRef, addGapPatch(withRef)), addChangePatch(withRef));
    expect(Object.keys(removeSeriesPatch(both, "s1").marks || {}).length).toBe(2);
  });
});

async function settle(n = 8) { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }
const history = () => get().deck.history.undo;
async function confirmed(steps: number) { await vi.waitFor(() => expect(history()).toBe(steps), { timeout: 10_000 }); await settle(); }
const panel = () => document.getElementById("chartPanel")!;
const q = (sel: string) => panel().querySelector(sel) as HTMLElement;
async function type(el: HTMLElement, v: string) { await act(async () => { fireEvent.focus(el); fireEvent.change(el, { target: { value: v } }); fireEvent.blur(el); }); }
async function check(el: HTMLElement, v: boolean) { const b = el as HTMLInputElement; await act(async () => { b.checked = v; fireEvent(b, new Event("change", { bubbles: true })); }); }
async function choose(el: HTMLElement, v: string) { await act(async () => { fireEvent.change(el, { target: { value: v } }); }); }
async function color(el: HTMLElement, v: string) { await act(async () => { fireEvent.input(el, { target: { value: v } }); fireEvent.change(el, { target: { value: v } }); fireEvent.blur(el); }); }

describe("the targets on the page", () => {
  let id = "";
  const it_ = () => itemOf(id) as ChartItem;
  /** one control used: one more undo step, and the undo label */
  async function step(fn: () => Promise<void>, label?: string) {
    const h = history();
    await fn(); await confirmed(h + 1);
    if (label) expect(get().deck.history.undoLabel).toBe(label);
  }
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
    const si = get().deck.slides.findIndex(R => R.tables.some(T => T.def?.sheet === "SLIDE_1"));
    await act(async () => gotoSlide(si)); await settle();
    const h0 = history();
    await act(async () => { id = insertChartRefs({ sheet: "SLIDE_1", range: "D6:D8" }, { sheet: "SLIDE_1", range: "C6:C8" })!; });
    await confirmed(h0 + 1);
    await vi.waitFor(() => expect(document.getElementById("chartPanel")).toBeTruthy());
    await step(async () => { fireEvent.click(q('[data-ctype="line"]')); });
    await vi.waitFor(() => expect(q("#chartTargets")).toBeTruthy());
  });
  afterAll(() => cleanup());

  it("reference lines: + from a cell asks for ONE cell in the sheet view; the chosen cell adds the line (one step); each setting one step; off keeps it", async () => {
    expect((q("#chartAddGap") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fireEvent.click(q("#chartAddRef")); }); await settle();
    expect(get().ui.dialogs.pick).toEqual({ kind: "chart-ref", id, ref: { what: "ref-add" } });
    await vi.waitFor(() => expect(document.getElementById("pickCells")?.textContent).toContain("Chart: add a reference line"));
    await act(async () => { fireEvent.click(document.querySelector('#pickCells [data-a="cancel"]')!); });
    await step(async () => { applyRef(id, { what: "ref-add" }, { sheet: "Numbers", range: "B9" }); }, "Chart · add a reference line");
    const [rid] = only(it_(), "ref");
    await vi.waitFor(() => expect(q(`[data-ref="${rid}"]`)).toBeTruthy());
    const R = (a: string) => q(`[data-ref="${rid}"] [data-a="${a}"]`);
    await step(() => type(R("rname"), "EoM budget"), "Reference line name");
    await step(() => choose(R("rdash"), "dotted"), "Reference line dash");
    await step(() => color(R("rcolor"), "#1f1f1f"), "Reference line colour");
    await step(() => type(R("rw"), "2"), "Reference line width");
    await step(() => choose(R("rshow"), "value"), "Reference line label");
    await step(() => choose(R("rpos"), "left"), "Reference line label place");
    expect(it_().marks![rid]).toEqual({ kind: "ref", value: { sheet: "Numbers", range: "B9" }, name: "EoM budget", style: { dash: "dotted", color: "#1F1F1F", w: 2 }, show: "value", pos: "left" });
    await step(async () => { applyRef(id, { what: "ref-value", mark: rid }, { sheet: "SLIDE_1", range: "D7" }); });
    expect(it_().marks![rid].value).toEqual({ sheet: "SLIDE_1", range: "D7" });
    await step(() => type(R("rtyped"), "120"), "Reference line typed value");
    expect(it_().marks![rid].value).toBe(120);
    await step(() => check(R("on"), false), "Hide reference line");
    expect(it_().marks![rid].off).toBe(true);
    await step(() => check(R("on"), true), "Show reference line");
    expect(it_().marks![rid].off).toBeUndefined();
    const h = history();
    await act(async () => undo(false)); await confirmed(h - 1);
    expect(it_().marks![rid].off).toBe(true);
    await act(async () => undo(false)); await confirmed(h - 2);
    expect(it_().marks![rid].value).toBe(120);
    await step(() => check(R("on"), true));
  }, 30_000);
  it("a gap arrow: added in one step (to the first line), each setting one step", async () => {
    await step(async () => { fireEvent.click(q("#chartAddGap")); }, "Add gap arrow");
    const [gid, g] = only(it_(), "gap");
    expect(g).toMatchObject({ kind: "gap", a: { s: "s1", i: -1 }, ref: only(it_(), "ref")[0] });
    await vi.waitFor(() => expect(q(`[data-gap="${gid}"]`)).toBeTruthy());
    const G = (a: string) => q(`[data-gap="${gid}"] [data-a="${a}"]`);
    await step(() => type(G("gcaption"), "gap to budget"), "Gap arrow caption");
    await step(() => check(G("gpct"), true), "Gap arrow %");
    await step(() => type(G("gnum"), "#,##0"), "Gap arrow format");
    await step(() => choose(G("gside"), "left"), "Gap arrow side");
    await step(() => choose(G("gheads"), "both"), "Gap arrow heads");
    await step(() => choose(G("gpoint"), "1"), "Gap arrow point");
    await step(() => choose(G("gsigns"), "fixed"), "Gap arrow colours");
    await vi.waitFor(() => expect(G("gcolor")).toBeTruthy());
    await step(() => color(G("gcolor"), "#1f3864"), "Gap arrow colour");
    expect(it_().marks![gid]).toEqual({ kind: "gap", a: { s: "s1", i: 1 }, ref: only(it_(), "ref")[0], caption: "gap to budget", pct: true, num: "#,##0", pos: "left",
      style: { heads: { a: "triangle", b: "triangle" }, color: "#1F3864" }, signs: "fixed" });
    await step(() => check(G("on"), false), "Hide gap arrow");
    await step(async () => { fireEvent.click(G("remove")); }, "Remove gap arrow");
    expect(it_().marks![gid]).toBeUndefined();
  }, 30_000);
  it("change pills: added in one step, each setting one step; the point values on and off in one step", async () => {
    await act(async () => { selectItem(id, null, { point: null }); });
    await step(async () => { fireEvent.click(q("#chartAddChange")); }, "Add change pills");
    const [pid] = only(it_(), "change");
    await vi.waitFor(() => expect(q(`[data-chg="${pid}"]`)).toBeTruthy());
    const P = (a: string) => q(`[data-chg="${pid}"] [data-a="${a}"]`);
    await step(() => check(P("cpct"), false), "Change pills: %");
    await step(() => check(P("cpct"), true), "Change pills: %");
    await step(() => check(P("cabs"), false), "Change pills: absolute");
    await step(() => choose(P("cpairs"), "last"), "Change pills: pairs");
    await step(() => choose(P("cposition"), "line"), "Change pills: place");
    await step(() => type(P("cnum"), "0"), "Change pills: format");
    await step(() => type(P("ccaption"), "Week-on-week change"), "Change pills: caption");
    await step(() => color(P("cneg"), "#b00020"), "Change pill colours");
    expect(it_().marks![pid]).toMatchObject({ kind: "change", a: { s: "s1", i: -1 }, abs: false, pairs: "last", pos: "line", num: "0", caption: "Week-on-week change", signs: { neg: "#B00020" } });
    const V = q('#chartTargets [data-a="tvalues"]');
    await step(() => check(V, true), "Point values");
    expect(it_().sers!.s1.labels).toEqual({ show: ["value"], pos: "above" });
    await step(() => check(q('#chartTargets [data-a="tvalues"]'), false), "No point values");
    // the generic Marks list does not list the targets
    expect(panel().querySelectorAll("#chartMarks .mark").length).toBe(0);
  }, 30_000);
});
