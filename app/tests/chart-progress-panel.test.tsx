/* The budget-achievement chart in the page (4.14, B55): Insert chart ▾ › Budget achievement… (a long table's columns
   by their header names, else their order; one undo step), the type switch, the chart panel's controls – each ONE
   item.patch, undone by its inverse, format 10 –, cells picked in the sheet view, a subtitle on a series chart's card,
   and the panel at the side panel's 280 px. */
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
import { itemOf } from "../src/editor/charts";
import { oneCell, refPatch, typePatch } from "../src/editor/chart-panel";
import { applyRef } from "../src/editor/chart-send";
import { insertAchievement } from "../src/editor/chart-progress-insert";
import { achievementFromTable, headerWords, progressColumns, progressFmtPatch, progressPatch, sourcePatch, subtitleOf, subtitlePatch, toProgressPatch } from "../src/editor/chart-progress";
import type { ChartItem, ItemPatch, Op } from "@slide-builder/core/model/types";
import { applyOps, emptyDoc, inverseOf, needsV10 } from "@slide-builder/core/model/ops";
import { indexWorkbook } from "@slide-builder/core/xlsx/workbook";
import { defaultPreset } from "@slide-builder/core/model/preset";

const here = path.dirname(fileURLToPath(import.meta.url));
Element.prototype.scrollIntoView ??= function () { /* nothing to scroll */ };
const V = (range: string) => ({ sheet: "Volumes", range });
const HEAD = ["Product", "Period", "Volume_EUR_m", "EoM_Budget_EUR_m"];
const ach = achievementFromTable("Volumes", "A1:D9", HEAD)!;
function docWith(it: ChartItem) {
  const ops = [{ op: "preset.set", preset: { sheets: ["Volumes"], tables: [], slides: [{ id: "s", type: "content", tables: [] }] } }, { op: "item.patch", slide: "s", id: "c", patch: it }] as Op[];
  return applyOps(emptyDoc("W.xlsx"), ops).doc;
}
const itemIn = (d: ReturnType<typeof docWith>) => d.preset!.slides[0].items!.c as ChartItem;
function roundTrip(it: ChartItem, p: ItemPatch | null, v10 = true) {
  expect(p).not.toBeNull();
  const d0 = docWith(it), o = { op: "item.patch", slide: "s", id: "c", patch: p } as Op, inv = inverseOf(d0, o)!, d1 = applyOps(d0, [o]).doc;
  expect(applyOps(d1, [inv]).doc.preset!.slides[0].items!.c).toEqual(itemIn(d0));
  expect(needsV10(o)).toBe(v10);
  return itemIn(d1);
}

describe("the builders (editor/chart-progress.ts)", () => {
  it("Budget achievement… of the Volumes table: the columns by name, the picture's title and subtitle", () => {
    expect(progressColumns(HEAD, 1)).toEqual({ by: 1, val: 3, target: 4 });
    expect(progressColumns(["Desk", "Week", "Actual", "Target"], 2)).toEqual({ by: 2, val: 4, target: 5 });
    expect(progressColumns(["a", "b", "c", "d", "e"], 1)).toEqual({ by: 1, val: 4, target: 5 });          // (no names: the order)
    expect([headerWords("Volume_EUR_m"), headerWords("EoM_Budget_EUR_m"), subtitleOf("Volume_EUR_m", "EoM_Budget_EUR_m")]).toEqual(["volume", "EoM budget", "Latest volume / EoM budget"]);
    expect(ach).toMatchObject({ type: "progress", title: "BUDGET ACHIEVEMENT", subtitle: "Latest volume / EoM budget",
      progress: { table: { by: V("A2:A9"), val: V("C2:C9"), target: V("D2:D9") } }, values: V("C2:C9"), labels: V("A2:A9") });
    expect(achievementFromTable("Volumes", "A1:A9", ["Product"])).toBeNull();
    // a table whose first row is numbers only: no header row – every row is data, the columns in their order
    expect(achievementFromTable("Volumes", "B2:E9", ["1", "2", "3", "4"])!.progress!.table).toEqual({ by: V("B2:B9"), val: V("D2:D9"), target: V("E2:E9") });
  });
  it("each setting one entry of `progress` (written whole), undone by its inverse; format 10", () => {
    const a = roundTrip(ach, progressPatch(ach, { over: "color", overFill: "#00AA00" }));
    expect(a.progress).toMatchObject({ over: "color", overFill: "#00AA00", table: ach.progress!.table });
    const b = roundTrip(a, progressPatch(a, { over: "over budget", under: "to reach", sign: "both" }, "gap"));
    expect(b.progress!.gap).toEqual({ over: "over budget", under: "to reach", sign: "both" });
    expect(roundTrip(b, progressPatch(b, { over: "", under: null, sign: null }, "gap")).progress!.gap).toBeUndefined();
    expect(roundTrip(a, progressFmtPatch(a, "pct", { size: 30, color: "#FF0000" })).progress!.pct).toEqual({ fmt: { size: 30, color: "#FF0000" } });
    const c = roundTrip(ach, sourcePatch(ach, "cells"));
    expect([c.progress!.table, c.progress!.vals, c.progress!.targets]).toEqual([undefined, [V("C2:C9")], [V("D2:D9")]]);
    expect(roundTrip(c, sourcePatch(c, "table")).progress!.table).toEqual({ by: V("A2:A9"), val: V("C2:C9"), target: V("D2:D9") });
    expect(roundTrip(ach, subtitlePatch("  "), false).subtitle).toBeUndefined();                // (a removal: no raise)
  });
  it("the cells picked in the sheet view; the type switch from a series chart", () => {
    expect(roundTrip(ach, refPatch(ach, { what: "prog-by" }, V("B2:B9"))).progress!.table!.by).toEqual(V("B2:B9"));
    const v = roundTrip(ach, refPatch(ach, { what: "prog-val" }, V("D2:D9")));
    expect([v.progress!.table!.val, v.values]).toEqual([V("D2:D9"), V("D2:D9")]);
    expect(roundTrip(ach, refPatch(ach, { what: "prog-targets" }, V("D5"))).progress!.targets).toEqual([V("D5")]);
    expect(roundTrip(ach, refPatch(ach, { what: "subtitle-cell" }, V("A1:B1"))).subtitle).toEqual(V("A1"));
    expect([oneCell({ what: "subtitle-cell" }), oneCell({ what: "prog-vals" })]).toEqual([true, false]);
    const line: ChartItem = { kind: "chart", type: "line", values: V("C2:C9"), box: { x: 0, y: 0, w: 1, h: 1 }, sers: { s1: { n: 1, vals: [V("C2:C9")], target: [V("D2:D9")] } } };
    expect(roundTrip(line, typePatch(line, "progress"))).toMatchObject({ type: "progress", progress: { vals: [V("C2:C9")], targets: [V("D2:D9")] } });
    expect(toProgressPatch(ach)).toEqual({ type: "progress" });                      // (its own progress kept)
    expect(roundTrip(line, subtitlePatch("Weekly")).subtitle).toBe("Weekly");
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

describe("the chart on the page", () => {
  let id: string | null = "";
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
  });
  afterAll(() => cleanup());

  it("Insert chart ▾ › Budget achievement…: the sheet view, then one chart in one undo step; the panel opens on it", async () => {
    await act(async () => { fireEvent.click(document.getElementById("chartBtn")!); }); await settle();
    await act(async () => { fireEvent.click(document.querySelector('[data-a="progress-pick"]')!); }); await settle();
    expect(get().ui.dialogs.pick).toEqual({ kind: "progress" });
    await act(async () => { fireEvent.click(document.querySelector('#pickCells [data-a="cancel"]')!); }); await settle();
    const h0 = history();
    await act(async () => { id = await insertAchievement("SLIDE_1", "C5:F8"); });
    await confirmed(h0 + 1);
    expect(get().deck.history.undoLabel).toBe("Insert budget achievement");
    expect(it_()).toMatchObject({ type: "progress", title: "BUDGET ACHIEVEMENT" });
    expect(it_().progress!.table).toBeTruthy();
    await vi.waitFor(() => expect(q("#chartProgress")).toBeTruthy());
    expect(q('[data-ctype="progress"]').className).toBe("on");
  });
  it("the panel: data, words, colours, bars, card – one step each; undo", async () => {
    await step(() => type(q("#progOver"), "above"), "Words of the gap");
    await step(() => type(q("#progUnder"), "below"), "Words of the gap");
    await step(() => choose(q("#progSign"), "both"), "Sign of the gap");
    await step(() => type(q("#progGapNum"), "#,##0.0"), "Format of the gap");
    expect(it_().progress!.gap).toEqual({ over: "above", under: "below", sign: "both", num: "#,##0.0" });
    await step(() => type(q("#progPctNum"), "0%"), "Format of the %");
    await step(() => type(q("#progPctSize"), "30"), "Size of the %");
    await step(() => check(q("#progCaps"), false), "Names in capitals");
    await step(() => check(q("#progCatOn"), false), "Hide the names");
    expect(it_().progress!.pct).toEqual({ num: "0%", fmt: { size: 30 } });
    expect(it_().progress!.cat).toEqual({ caps: false, off: true });
    await step(() => choose(q("#progOverMode"), "mark"), "Over budget");
    await vi.waitFor(() => expect(q('[data-a="prog-over"]')).toBeTruthy());
    await step(async () => { fireEvent.change(q('[data-a="prog-fill"]'), { target: { value: "#123456" } }); fireEvent.blur(q('[data-a="prog-fill"]')); }, "Bar fill colour");
    expect(it_().progress!.fill).toBe("#123456");
    await step(() => type(q("#progBarGap"), "80"), "Bar gap");
    await step(() => check(q("#progAxis"), true), "Value axis");
    expect([it_().gap, it_().axes?.y?.show, it_().progress!.over]).toEqual([80, true, "mark"]);
    await step(() => type(q("#chartSubtitle"), "Latest volume / EoM budget"), "Chart subtitle");
    await step(() => type(q("#chartTag"), "Illustrative"), "Chart tag");
    await step(() => check(q("#chartSep"), true), "Chart separator");
    expect([it_().subtitle, it_().tag, it_().sep]).toEqual(["Latest volume / EoM budget", { text: "Illustrative" }, {}]);
    // the data: cells, a product column picked in the sheet view
    await step(async () => { fireEvent.click(q('[data-src="cells"]')); }, "Budget data from cells");
    expect(it_().progress!.table).toBeUndefined();
    await act(async () => { fireEvent.click(q('[data-a="prog-targets"]')); }); await settle();
    expect(get().ui.dialogs.pick).toEqual({ kind: "chart-ref", id, ref: { what: "prog-targets" } });
    await act(async () => { fireEvent.click(document.querySelector('#pickCells [data-a="cancel"]')!); });
    await step(async () => { applyRef(id!, { what: "prog-targets" }, { sheet: "SLIDE_1", range: "F6" }); });
    expect(it_().progress!.targets).toEqual([{ sheet: "SLIDE_1", range: "F6" }]);
    const h = history();
    await act(async () => undo(false)); await confirmed(h - 1);
    expect(it_().progress!.targets).not.toEqual([{ sheet: "SLIDE_1", range: "F6" }]);
  }, 40_000);
  it("at the side panel's narrowest (280 px) every control is there, rows wrapping", async () => {
    const nav = panel().closest(".nav") as HTMLElement | null;
    if (nav) nav.style.width = "280px";
    for (const sel of ["#progSource", "#progPctOn", "#progOver", "#progUnder", "#progSign", '[data-a="prog-fill"]', '[data-a="prog-track"]', "#progOverMode", "#progBarGap", "#progAxis", "#progGrid", "#chartSubtitle", "#chartTag", "#chartSep"]) expect(q(sel), sel).toBeTruthy();
    expect([...panel().querySelectorAll("#chartProgress .row.wrap")].length).toBeGreaterThan(8);
    const css = fs.readFileSync(path.join(here, "../src/ui/chart-panel.css"), "utf8");
    expect(css).toMatch(/#chartProgress \.row\.wrap\{flex-wrap:wrap\}/);
  });
});
