/* The chart panel's card (4.13, B54): the stats row, the tag, the separator, the momentum row and the long table's filter
   – each control ONE item.patch (one undo step), cells picked in the sheet view; the builders' inverses put the chart
   back, every write of a card part is format 9 (needsV9); the section is usable at the side panel's 280 px. */
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
import { insertChartRefs, itemOf } from "../src/editor/charts";
import { oneCell, refPatch } from "../src/editor/chart-panel";
import { applyRef } from "../src/editor/chart-send";
import { addMomPatch, addStatPatch, cardPresetPatch, filterPatch, momPatch, removeStatPatch, statPatch, tagPatch } from "../src/editor/chart-card";
import type { ChartItem, ItemPatch, Op } from "@slide-builder/core/model/types";
import { applyOps, emptyDoc, inverseOf, needsV9 } from "@slide-builder/core/model/ops";
import { indexWorkbook } from "@slide-builder/core/xlsx/workbook";
import { defaultPreset } from "@slide-builder/core/model/preset";

const here = path.dirname(fileURLToPath(import.meta.url));
Element.prototype.scrollIntoView ??= function () { /* nothing to scroll */ };
const box = { x: 0, y: 0, w: 600, h: 400 };
const line: ChartItem = { kind: "chart", type: "line", values: { sheet: "Volumes", range: "C2:C9" }, box, sers: { s1: { n: 1, vals: [{ sheet: "Volumes", range: "C2:C9" }] } },
  marks: { r1: { kind: "ref", value: { sheet: "Volumes", range: "D6" }, name: "Budget" } } };
function docWith(it: ChartItem) {
  const ops = [{ op: "preset.set", preset: { sheets: ["Volumes"], tables: [], slides: [{ id: "s", type: "content", tables: [] }] } }, { op: "item.patch", slide: "s", id: "c", patch: it }] as Op[];
  return applyOps(emptyDoc("W.xlsx"), ops).doc;
}
const itemIn = (d: ReturnType<typeof docWith>) => d.preset!.slides[0].items!.c as ChartItem;
function roundTrip(it: ChartItem, p: ItemPatch | null, v9 = true) {
  expect(p).not.toBeNull();
  const d0 = docWith(it), o = { op: "item.patch", slide: "s", id: "c", patch: p } as Op, inv = inverseOf(d0, o)!, d1 = applyOps(d0, [o]).doc;
  expect(applyOps(d1, [inv]).doc.preset!.slides[0].items!.c).toEqual(itemIn(d0));
  expect(needsV9(o)).toBe(v9);
  return itemIn(d1);
}

describe("the builders (editor/chart-card.ts): one entry each, undone by its inverse; format 9", () => {
  it("the preset card: latest, the reference line, the gap to it, a separator, three momentum chips", () => {
    const a = roundTrip(line, cardPresetPatch(line));
    expect(a.stats).toEqual({ s1: { n: 1, label: "Latest", src: "last" }, s2: { n: 2, label: "Reference", src: "ref", ref: "r1" }, s3: { n: 3, label: "Gap", src: "gap", ref: "r1" } });
    expect([a.sep, Object.values(a.moms!).map(m => m.vs)]).toEqual([{}, ["first", "trough", "prev"]]);
    const b = roundTrip(a, addStatPatch(a, "cell"));
    expect(b.stats!.s4).toEqual({ n: 4, src: "cell" });
    expect(addStatPatch(b)).toBeNull();                                   // (at most 4)
    expect(roundTrip(b, removeStatPatch("s4"), false).stats!.s4).toBeUndefined();
    expect(roundTrip(a, statPatch(a, "s1", { label: "Latest volume", good: "down", signs: true })).stats!.s1).toEqual({ n: 1, label: "Latest volume", src: "last", good: "down", signs: true });
    expect(roundTrip(a, addMomPatch(a, "peak")).moms!.m4).toEqual({ n: 4, vs: "peak" });
    expect(roundTrip(a, momPatch(a, "m3", { show: "pct", caption: "WoW" })).moms!.m3).toEqual({ n: 3, vs: "prev", show: "pct", caption: "WoW" });
  });
  it("the tag, the filter and the cells picked for them", () => {
    expect(roundTrip(line, tagPatch(line, "Illustrative", "#D93025")).tag).toEqual({ text: "Illustrative", color: "#D93025" });
    expect(tagPatch(line, " ")).toEqual({ tag: null });
    const f = roundTrip(line, refPatch(line, { what: "filter-by" }, { sheet: "Volumes", range: "A2:A9" }));
    expect(f.filter).toEqual({ by: { sheet: "Volumes", range: "A2:A9" }, eq: "" });
    expect(roundTrip(f, filterPatch(f, { eq: "Deposits" })).filter!.eq).toBe("Deposits");
    expect(roundTrip(f, refPatch(f, { what: "filter-eq" }, { sheet: "KPI", range: "A3:A4" })).filter!.eq).toEqual({ sheet: "KPI", range: "A3" });
    expect(refPatch(line, { what: "filter-eq" }, { sheet: "KPI", range: "A3" })).toBeNull();          // no column yet
    const a = roundTrip(line, cardPresetPatch(line));
    expect(roundTrip(a, refPatch(a, { what: "stat-cell", stat: "s1" }, { sheet: "KPI", range: "B2:B5" })).stats!.s1).toEqual({ n: 1, label: "Latest", src: "cell", cell: { sheet: "KPI", range: "B2" } });
    expect(roundTrip(a, refPatch(a, { what: "mom-cell", mom: "m1" }, { sheet: "KPI", range: "C2" })).moms!.m1).toEqual({ n: 1, vs: "cell", cell: { sheet: "KPI", range: "C2" } });
    expect([oneCell({ what: "filter-by" }), oneCell({ what: "filter-eq" }), oneCell({ what: "stat-cell", stat: "s" }), oneCell({ what: "tag-cell" })]).toEqual([false, true, true, true]);
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

describe("the card on the page", () => {
  let id = "";
  const it_ = () => itemOf(id) as ChartItem;
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
    await vi.waitFor(() => expect(q("#chartCard")).toBeTruthy());
  });
  afterAll(() => cleanup());

  it("+ Stats and momentum: one step; each chip's setting one step; off keeps it; undo", async () => {
    await step(async () => { fireEvent.click(q("#chartCardPreset")); }, "Chart card");
    expect(Object.keys(it_().stats!)).toEqual(["s1"]);                  // (no reference line: the last value alone)
    expect(Object.keys(it_().moms!)).toEqual(["m1", "m2", "m3"]);
    const S = (a: string) => q(`[data-stat="s1"] [data-a="${a}"]`);
    await step(() => type(S("slabel"), "Latest volume"), "Stat label");
    await step(() => choose(S("ssrc"), "max"), "Stat value");
    await step(() => check(S("ssigns"), true), "Stat colours");
    await step(() => choose(S("good"), "down"), "Stat direction");
    await step(() => type(S("snum"), "#,##0"), "Stat format");
    expect(it_().stats!.s1).toEqual({ n: 1, label: "Latest volume", src: "max", signs: true, good: "down", num: "#,##0" });
    // a cell: asked in the sheet view (one cell)
    await act(async () => { choose(S("ssrc"), "cell"); }); await settle();
    expect(get().ui.dialogs.pick).toEqual({ kind: "chart-ref", id, ref: { what: "stat-cell", stat: "s1" } });
    await act(async () => { fireEvent.click(document.querySelector('#pickCells [data-a="cancel"]')!); });
    await step(async () => { applyRef(id, { what: "stat-cell", stat: "s1" }, { sheet: "Numbers", range: "B9" }); });
    expect(it_().stats!.s1.cell).toEqual({ sheet: "Numbers", range: "B9" });
    await step(() => check(S("on"), false), "Hide stat");
    await step(async () => { fireEvent.click(q("#chartAddStat")); }, "Add stat");
    const M = (a: string) => q(`[data-mom="m3"] [data-a="${a}"]`);
    await step(() => choose(M("mshow"), "pct"), "Momentum shows");
    await step(() => type(M("mcap"), "WoW"), "Momentum caption");
    await step(() => choose(M("mvs"), "peak"), "Momentum basis");
    await step(() => choose(M("good"), "neutral"), "Momentum direction");
    expect(it_().moms!.m3).toEqual({ n: 3, vs: "peak", show: "pct", caption: "WoW", good: "neutral" });
    await step(async () => { fireEvent.click(q("#chartAddMom")); }, "Add momentum chip");
    await step(() => type(q("#chartMomLabel"), "Trend"), "Momentum label");
    await step(() => check(q("#chartSep"), false), "No chart separator");
    expect(it_().sep).toBeUndefined();
    await step(() => type(q("#chartTag"), "Illustrative"), "Chart tag");
    expect(it_().tag).toEqual({ text: "Illustrative" });
    // the filter: its column picked (a range), then its value typed
    await step(async () => { applyRef(id, { what: "filter-by" }, { sheet: "SLIDE_1", range: "C6:C8" }); });
    await vi.waitFor(() => expect(q("#chartFilterEq")).toBeTruthy());
    await step(() => type(q("#chartFilterEq"), "Alpha"), "Chart filter value");
    expect(it_().filter).toEqual({ by: { sheet: "SLIDE_1", range: "C6:C8" }, eq: "Alpha" });
    const h = history();
    await act(async () => undo(false)); await confirmed(h - 1);
    expect(it_().filter!.eq).toBe("");
    await step(async () => { fireEvent.click(q('[data-a="filteroff"]')); }, "Chart filter off");
    expect(it_().filter).toBeUndefined();
  }, 40_000);
  it("at the side panel's narrowest (280 px) every card control is there, rows wrapping (no fixed widths past it)", async () => {
    const nav = panel().closest(".nav") as HTMLElement | null;
    if (nav) nav.style.width = "280px";
    for (const sel of ["#chartAddStat", "#chartAddMom", "#chartTag", "#chartSep", '[data-a="filterby"]']) expect(q(sel), sel).toBeTruthy();
    expect([...panel().querySelectorAll("#chartCard .row.wrap")].length).toBeGreaterThan(4);
    const css = fs.readFileSync(path.join(here, "../src/ui/chart-panel.css"), "utf8");
    expect(css).toMatch(/#chartCard \.row\.wrap\{flex-wrap:wrap\}/);
  });
});
