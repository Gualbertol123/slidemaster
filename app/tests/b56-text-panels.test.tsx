/* B56 (4.14): the Text control of every part (font from the font list, size in points, colour, bold, italic, alignment,
   capitals) in the KPI card panel, the chart panel's sections and the table's Table text menu; the KPI card's and the chart
   card's Layout (sizing and positioning); the parts dragged on the stage (`offs`) and Reset; the format painter copying
   texts and layout between items of a kind. Each control ONE op (one undo step); usable at the side panel's 280 px. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../src/editor/thumbs", async orig => ({ ...(await orig() as object), mountThumbs: () => { /* imperative */ } }));
vi.mock("../src/render/wall", async orig => ({ ...(await orig() as object), applyWall: () => { /* canvas */ } }));

import { App } from "../src/ui/App";
import { get } from "../src/state/store";
import { change, ctx, gotoSlide, openLocalFile, undo } from "../src/state/app";
import { insertChartRefs, itemOf, selectItem } from "../src/editor/charts";
import { insertKpiCards } from "../src/editor/kpi";
import { paintItem, startPainter, stopPainter } from "../src/editor/painter";
import { cleanFmt, fmtMapPatch, isOffKey, layPatch, offPatch, offsResetPatch, textsPatch } from "../src/editor/textparts";
import { scopeItems, scopeShown } from "../src/editor/tabletext";
import { setSel, curSlide } from "../src/editor/edit";
import { effFmt } from "@slide-builder/core/render/edits";
import type { ChartItem, KpiItem, Op } from "@slide-builder/core/model/types";
import { indexWorkbook } from "@slide-builder/core/xlsx/workbook";
import { defaultPreset } from "@slide-builder/core/model/preset";

const here = path.dirname(fileURLToPath(import.meta.url));
Element.prototype.scrollIntoView ??= function () { /* nothing to scroll */ };

describe("the builders (editor/textparts.ts)", () => {
  it("a part's format, a layout setting, an offset (added to the earlier one; back at its place: removed), Reset", () => {
    expect(cleanFmt({ font: "", size: 12, b: undefined, color: "#112233" })).toEqual({ size: 12, color: "#112233" });
    expect(textsPatch("value", { align: "center", font: "" })).toEqual({ texts: { value: { align: "center" } } });
    expect(textsPatch("value", {})).toEqual({ texts: { value: null } });
    expect(layPatch("split", 40)).toEqual({ lay: { split: 40 } });
    expect(offPatch(undefined, "kv", 35, -13, { w: 350, h: 130 })).toEqual({ offs: { kv: { dx: .1, dy: -.1 } } });
    expect(offPatch({ dx: .1, dy: -.1 }, "kv", -35, 13, { w: 350, h: 130 })).toEqual({ offs: { kv: null } });
    expect(offsResetPatch()).toEqual({ offs: null });
    expect(["kv", "st:s1", "title", "v:s1:2"].map(isOffKey)).toEqual([true, true, false, false]);
  });
  it("a format kept as a map (titleFmt, fmt): the keys it drops sent as null", () => {
    expect(fmtMapPatch({ b: true, size: 20 }, { size: 22, align: "left" })).toEqual({ size: 22, align: "left", b: null });
    expect(fmtMapPatch({ b: true }, null)).toBeNull();
  });
});

async function settle(n = 8) { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }
const history = () => get().deck.history.undo;
async function confirmed(steps: number) { await vi.waitFor(() => expect(history()).toBe(steps), { timeout: 10_000 }); await settle(); }
async function type(el: HTMLElement, v: string) { await act(async () => { fireEvent.focus(el); fireEvent.change(el, { target: { value: v } }); fireEvent.blur(el); }); }
async function check(el: HTMLElement, v: boolean) { const b = el as HTMLInputElement; await act(async () => { b.checked = v; fireEvent(b, new Event("change", { bubbles: true })); }); }
async function color(el: HTMLElement, v: string) { const b = el as HTMLInputElement; await act(async () => { b.value = v; fireEvent(b, new Event("change", { bubbles: true })); }); }
async function step(fn: () => Promise<void>, label?: string) { const h = history(); await fn(); await confirmed(h + 1); if (label) expect(get().deck.history.undoLabel).toBe(label); }
const click = (el: Element | null) => act(async () => { fireEvent.click(el!); });
/** opens a part's Text control in `root` and returns a query inside it */
async function tf(root: HTMLElement, id: string) {
  const box = () => root.querySelector(`[data-tf="${id}"]`) as HTMLElement;
  if (!box().querySelector(".tfbody")) await click(box().querySelector('[data-a="tf"]'));
  return (a: string) => box().querySelector(a) as HTMLElement;
}
async function pickFont(btnRoot: HTMLElement, font: string) {
  await click(btnRoot.querySelector(".fontbtn"));
  await vi.waitFor(() => expect(document.querySelector(`.fontmenu [data-font="${font}"]`)).toBeTruthy());
  await click(document.querySelector(`.fontmenu [data-font="${font}"]`));
}

describe("on the page", () => {
  let kids: string[] = [], cid = "";
  const k = (i = 0) => itemOf(kids[i]) as KpiItem, c = () => itemOf(cid) as ChartItem;
  const kp = () => document.getElementById("kpiPanel")!, cp = () => document.getElementById("chartPanel")!;
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
    await act(async () => { kids = await insertKpiCards("SLIDE_1", "C5:F8"); });
    await confirmed(h0 + 1);
    await vi.waitFor(() => expect(kp()).toBeTruthy());
  });
  afterAll(() => cleanup());

  it("KPI card · Text: each part's font, size (pt → px), colour, bold, italic, alignment, capitals – one step each; ↺ the design's", async () => {
    const v = await tf(kp(), "kpi-value");
    await step(() => pickFont(kp().querySelector('[data-tf="kpi-value"]') as HTMLElement, "Georgia"), "Value: font");
    await step(() => type(v('[data-a="tfsize"]'), "36"), "Value: size");
    await step(() => color(v('[data-a="tfcolor"]'), "#123456"), "Value: colour");
    await step(() => click(v('[data-a="tfb"]')), "Value: bold");
    await step(() => click(v('[data-a="tfi"]')), "Value: italic");
    await step(() => click(v('[data-al="center"]')), "Value: alignment");
    expect(k().texts!.value).toEqual({ font: "Georgia", size: 48, color: "#123456", b: false, i: true, align: "center" });
    const hd = await tf(kp(), "kpi-head");
    await step(() => click(hd('[data-a="tfcaps"]')), "Header: capitals");
    expect(k().texts!.head).toEqual({ caps: false });
    await step(() => click(hd('[data-a="tfreset"]')), "Header: the design's text");
    expect(k().texts!.head).toBeUndefined();
    const h = history(); await act(async () => undo(false)); await confirmed(h - 1);
    expect(k().texts!.head).toEqual({ caps: false });
    // the other cards untouched
    expect(k(1).texts).toBeUndefined();
  });
  it("KPI card · Layout: the value centred (the owner's \"centre the 10\"), its vertical place, the divider, the header bar, the rows, the padding", async () => {
    const q = (s: string) => kp().querySelector(s) as HTMLElement;
    await step(() => click(q('#kpiValueAlign [data-v="right"]')), "KPI value alignment");
    expect(k().texts!.value!.align).toBe("right");
    await step(() => click(q('#kpiValueAlign [data-v="center"]')), "KPI value alignment");
    expect(k().texts!.value).toMatchObject({ align: "center", font: "Georgia" });             // (the rest of its format kept)
    await step(() => click(q('#kpiValueV [data-v="top"]')), "KPI value vertical place");
    await step(() => type(q("#kpiSplit"), "45"), "KPI divider place");
    await step(() => check(q("#kpiDiv"), false), "KPI divider");
    await step(() => type(q("#kpiHeadH"), "30"), "KPI header bar height");
    await step(() => check(q("#kpiBar"), false), "KPI header bar");
    await step(() => click(q('#kpiRows [data-v="middle"]')), "KPI rows place");
    await step(() => type(q("#kpiRowGap"), "6"), "KPI row spacing");
    await step(() => type(q("#kpiPad"), "200"), "KPI padding");
    expect(k().lay).toEqual({ valign: "top", split: 45, div: false, headH: 30, bar: false, rows: "middle", rowGap: 6, pad: 80 });
    await step(() => check(q("#kpiBar"), true), "KPI header bar");
    await step(() => type(q("#kpiSplit"), ""), "KPI divider place");
    expect(k().lay).toEqual({ valign: "top", div: false, headH: 30, rows: "middle", rowGap: 6, pad: 80 });
  });
  it("KPI card · a drag of the value and of the rows is one step each (offs); Reset puts them back in one step", async () => {
    const R = curSlide()!;
    await step(async () => { change("Move KPI part", [{ op: "item.patch", slide: R.id, id: kids[0], patch: offPatch(k().offs?.kv, "kv", 35, 0, k().box) } as Op]); });
    await step(async () => { change("Move KPI part", [{ op: "item.patch", slide: R.id, id: kids[0], patch: offPatch(k().offs?.kr, "kr", 0, 10, k().box) } as Op]); });
    expect(Object.keys(k().offs!)).toEqual(["kv", "kr"]);
    await vi.waitFor(() => expect(kp().querySelector("#kpiMovedN")!.textContent).toBe("2"));
    await step(() => click(kp().querySelector("#kpiOffsReset")), "KPI parts back in place");
    expect(k().offs).toBeUndefined();
  });
  it("KPI card · the format painter copies the texts and the layout to another card (not its offsets)", async () => {
    await act(async () => { selectItem(kids[0]); startPainter(false); }); await settle();
    const h = history();
    await act(async () => { expect(paintItem(kids[2], false)).toBe(true); }); await confirmed(h + 1);
    expect(k(2).texts).toEqual(k(0).texts);
    expect(k(2).lay).toEqual(k(0).lay);
    await act(async () => stopPainter());
  });
  it("KPI card · fits a 280 px side panel", () => {
    expect(kp().outerHTML).not.toMatch(/width:\s*[3-9]\d\dpx/);
    for (const r of kp().querySelectorAll<HTMLElement>("#kpiLayout .row, #kpiText .tfbody .row")) expect(r.className).toMatch(/wrap/);
  });

  it("chart · the title's, all labels', the axes', the data labels', the legend's text – one step each", async () => {
    const h0 = history();
    await act(async () => { cid = insertChartRefs({ sheet: "SLIDE_1", range: "D6:D8" }, { sheet: "SLIDE_1", range: "C6:C8" })!; });
    await confirmed(h0 + 1);
    await vi.waitFor(() => expect(cp()).toBeTruthy());
    await step(async () => { fireEvent.click(cp().querySelector('[data-ctype="line"]')!); });
    const t = await tf(cp(), "chart-title");
    await step(() => type(t('[data-a="tfsize"]'), "21"), "Title text: size");
    await step(() => click(t('[data-al="left"]')), "Title text: alignment");
    expect(c().titleFmt).toEqual({ size: 28, align: "left" });
    await step(() => click(t('[data-a="tfreset"]')), "Title text: the design's text");
    expect(c().titleFmt).toBeUndefined();
    const all = await tf(cp(), "chart-labels");
    await step(() => type(all('[data-a="tfsize"]'), "9"), "All labels: size");
    expect(c().fmt).toEqual({ size: 12 });
    expect(all('[data-al="left"]')).toBeNull();                                            // (no alignment for labels)
    await act(async () => { (cp().querySelector("#chartAxes") as HTMLDetailsElement).open = true; }); await settle();
    const ax = await tf(cp(), "axis-y");
    await step(() => pickFont(cp().querySelector('[data-tf="axis-y"]') as HTMLElement, "Verdana"), "Left axis: text: font");
    await step(() => click(ax('[data-a="tfi"]')), "Left axis: text: italic");
    expect(c().axes!.y!.fmt).toEqual({ font: "Verdana", i: true });
    const cat = await tf(cp(), "axis-x");
    await step(() => color(cat('[data-a="tfcolor"]'), "#AA0000"), "Categories: text: colour");
    expect(c().axes!.x!.fmt).toEqual({ color: "#AA0000" });
    await act(async () => { (cp().querySelector("#chartLegend") as HTMLDetailsElement).open = true; }); await settle();
    const lg = await tf(cp(), "chart-legend");
    await step(() => type(lg('[data-a="tfsize"]'), "10.5"), "Legend text: size");
    expect(c().texts!.legend).toEqual({ size: 14 });
    // a series' data labels
    const sid = Object.keys(c().sers!)[0];
    await act(async () => { fireEvent.click(cp().querySelector(`[data-ser="${sid}"] [data-a="more"]`)!); }); await settle();
    const dl = await tf(cp(), "labels-" + sid);
    await step(() => click(dl('[data-a="tfb"]')), "Label text: bold");
    expect(c().sers![sid].labels!.fmt).toEqual({ b: true });
  });
  it("chart card · Text and Layout: the stats row centred, chip widths, the momentum row spread, the tag under the title, spacing, plot margins", async () => {
    await step(async () => { fireEvent.click(cp().querySelector("#chartCardPreset")!); }, "Chart card");
    const q = (s: string) => cp().querySelector(s) as HTMLElement;
    await step(() => click(q('#chartStatsAlign [data-v="center"]')), "Stats row alignment");
    await step(() => type(q("#chartStatW"), "22"), "Stats row chip width");
    await step(() => click(q('#chartMomsAlign [data-v="spread"]')), "Momentum row alignment");
    await step(() => type(q("#chartGapH"), "12"), "Space under the title");
    await step(() => type(q("#chartGapP"), "16"), "Space after the stats row");
    await step(() => type(q("#chartGapF"), "18"), "Space above the momentum row");
    await step(() => type(q("#chartPadL"), "20"), "Plot margin, left");
    await step(() => type(q("#chartPadB"), "999"), "Plot margin, bottom");
    expect(c().lay).toEqual({ stats: "center", statW: 22, moms: "spread", gapH: 12, gapP: 16, gapF: 18, padL: 20, padB: 400 });
    await step(() => click(q('#chartStatsAlign [data-v="left"]')), "Stats row alignment");
    expect(c().lay!.stats).toBeUndefined();
    const sl = await tf(cp(), "card-statLabel");
    await step(() => click(sl('[data-al="center"]')), "Stat label: alignment");
    await step(() => click(sl('[data-a="tfcaps"]')), "Stat label: capitals");
    expect(c().texts!.statLabel).toEqual({ align: "center", caps: false });
    for (const p of ["statValue", "momHead", "momVal", "momCap"]) expect(cp().querySelector(`[data-tf="card-${p}"]`), p).toBeTruthy();
    expect(cp().querySelector('[data-tf="card-tag"]')).toBeTruthy();
    // the tag: its place (once it has one)
    await step(() => type(q("#chartTag"), "Illustrative"), "Chart tag");
    await step(() => click(q('#chartTagPos [data-v="below"]')), "Tag place");
    expect(c().lay!.tag).toBe("below");
    // chips dragged (offs) and the chart's Reset: nudges and offsets in one step
    const R = curSlide()!;
    await step(async () => { change("Move chart card part", [{ op: "item.patch", slide: R.id, id: cid, patch: offPatch(undefined, "st:s1", 30, 0, c().box) } as Op]); });
    await step(async () => { change("Move chart label", [{ op: "item.patch", slide: R.id, id: cid, patch: { nudge: { title: { dx: .1, dy: 0 } } } } as Op]); });
    await vi.waitFor(() => expect(q("#chartNudgeN").textContent).toBe("2"));
    await step(() => click(q("#chartNudgeReset")), "Labels back in place");
    expect([c().offs, c().nudge]).toEqual([undefined, undefined]);
  });
  it("chart · a reference line's label text", async () => {
    const R = curSlide()!;
    await step(async () => { change("Add reference line", [{ op: "item.patch", slide: R.id, id: cid, patch: { marks: { r1: { kind: "ref", value: 2, name: "Budget" } } } } as Op]); });
    await act(async () => { (cp().querySelector("#chartTargets") as HTMLDetailsElement).open = true; }); await settle();
    const r = await tf(cp(), "ref-r1");
    await step(() => type(r('[data-a="tfsize"]'), "12"), "Label text: size");
    expect(c().marks!.r1.fmt).toEqual({ size: 16 });
  });

  it("table · Table text: the whole table, its header, body or totals in one step; the ribbon's cells formats", async () => {
    const R = curSlide()!, T = R.tables[0];
    await act(async () => { setSel(0, { r: T.rows[0], c: T.cols[0] }, { r: T.rows[0], c: T.cols[0] }); }); await settle();
    await click(document.getElementById("tableTextBtn"));
    await vi.waitFor(() => expect(document.getElementById("tableTextMenu")).toBeTruthy());
    const menu = () => document.getElementById("tableTextMenu")!;
    const all = scopeItems(T, "all"), body = scopeItems(T, "body"), header = scopeItems(T, "header");
    expect(all.length).toBe(T.items.length);
    expect(body.length + header.length).toBeLessThanOrEqual(all.length);
    expect(body.length).toBeGreaterThan(0);
    await click(menu().querySelector('[data-scope="body"]'));
    const box = (s: string) => menu().querySelector(`[data-tf="table-body"] ${s}`) as HTMLElement;
    await step(() => type(box('[data-a="tfsize"]'), "10"), "Body: size");
    const c0 = ctx();
    expect(new Set(body.map(it => effFmt(c0, it).sz))).toEqual(new Set([10]));
    // the header's cells keep their size
    if (header.length) expect(header.every(it => (ctx().edits[it.L!.sheet.name] || {})[`${String.fromCharCode(64 + it.b.src.c)}${it.b.src.r}`]?.sz !== 10)).toBe(true);
    await step(() => pickFont(menu().querySelector('[data-tf="table-body"]') as HTMLElement, "Georgia"), "Body: font");
    expect(scopeShown(body).font).toBe("Georgia");
    await step(() => click(box('[data-a="tfreset"]')), "Body: the design's text");
    expect(scopeShown(body).font).toBeUndefined();
  });
});
