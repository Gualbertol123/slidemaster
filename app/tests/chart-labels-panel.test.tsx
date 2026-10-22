/* B53 (4.11): the chart panel's new label places (point values Auto, a point's own place, the reference label's, gap
   arrow's and pills' places), an axis's min / max / step from a cell (picked in the sheet view, one cell), the moved
   labels' Reset, and a label dragged on the stage – each ONE item.patch (one undo step); the builders' inverses put the
   chart back, and every one of them needs format 8. */
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
import { addRefPatch, addGapPatch, addChangePatch, axisCellPatch, nudgePatch, nudgeResetPatch, oneCell, refPatch } from "../src/editor/chart-panel";
import { applyRef } from "../src/editor/chart-send";
import { labelDrag } from "../src/stage/drags";
import { curSlide } from "../src/editor/edit";
import type { ChartItem, ChartMark, ItemPatch, Op } from "@slide-builder/core/model/types";
import { applyOps, emptyDoc, inverseOf, needsV8 } from "@slide-builder/core/model/ops";
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
function roundTrip(it: ChartItem, p: ItemPatch | null, v8 = true) {
  expect(p).not.toBeNull();
  const d0 = docWith(it), o = { op: "item.patch", slide: "s", id: "c", patch: p } as Op, inv = inverseOf(d0, o)!, d1 = applyOps(d0, [o]).doc;
  expect(applyOps(d1, [inv]).doc.preset!.slides[0].items!.c).toEqual(itemIn(d0));
  expect(needsV8(o)).toBe(v8);
  return itemIn(d1);
}
const only = (it: ChartItem, kind: string): [string, ChartMark] => Object.entries(it.marks || {}).find(([, k]) => k.kind === kind)!;

describe("the builders (editor/chart-panel.ts): one entry each, undone by its inverse; format 8", () => {
  it("an axis's bound from a cell (its first cell), typed again with ×; one cell in the sheet view", () => {
    const a = roundTrip(line, axisCellPatch(line, "y", "max", { sheet: "Targets", range: "C3" }));
    expect(a.axes!.y).toEqual({ cells: { max: { sheet: "Targets", range: "C3" } } });
    expect(refPatch(a, { what: "axis", ax: "y", key: "min" }, { sheet: "T", range: "B2:B4" })).toEqual({ axes: { y: { cells: { max: { sheet: "Targets", range: "C3" }, min: { sheet: "T", range: "B2" } } } } });
    expect(roundTrip(a, axisCellPatch(a, "y", "max", null), false).axes?.y).toBeUndefined();
    expect(oneCell({ what: "axis", ax: "y", key: "step" })).toBe(true);
  });
  it("a dragged label: its offset as a fraction of the chart's box, added to the one it had; back at its place the entry goes; Reset clears all", () => {
    const a = roundTrip(line, nudgePatch(line, "v:s1:1", 30, -20, box));
    expect(a.nudge).toEqual({ "v:s1:1": { dx: .05, dy: -.05 } });
    expect(nudgePatch(a, "v:s1:1", 30, 20, box)).toEqual({ nudge: { "v:s1:1": { dx: .1, dy: 0 } } });
    expect(nudgePatch(a, "v:s1:1", -30, 20, box)).toEqual({ nudge: { "v:s1:1": null } });
    expect(roundTrip(a, nudgeResetPatch(), false).nudge).toBeUndefined();
  });
});

async function settle(n = 8) { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }
const history = () => get().deck.history.undo;
async function confirmed(steps: number) { await vi.waitFor(() => expect(history()).toBe(steps), { timeout: 10_000 }); await settle(); }
const panel = () => document.getElementById("chartPanel")!;
const q = (sel: string) => panel().querySelector(sel) as HTMLElement;
async function choose(el: HTMLElement, v: string) { await act(async () => { fireEvent.change(el, { target: { value: v } }); }); }

describe("the label places, axis cells and moved labels on the page", () => {
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
    await vi.waitFor(() => expect(q("#chartTargets")).toBeTruthy());
  });
  afterAll(() => cleanup());

  it("point values Auto in one step; an axis's max from a cell: the sheet view asks for one cell, the cell is one step, × one step", async () => {
    await act(async () => { fireEvent.click(q('[data-ser="s1"] [data-a="more"]')); }); await settle();
    await step(() => choose(q('[data-ser="s1"] [data-a="lpos"]'), "auto"), "Label position");
    expect(it_().sers!.s1.labels?.pos).toBe("auto");
    const Y = (a: string) => q(`#chartAxes [data-ax="y"] [data-a="${a}"]`);
    await act(async () => { fireEvent.click(Y("cell-max")); }); await settle();
    expect(get().ui.dialogs.pick).toEqual({ kind: "chart-ref", id, ref: { what: "axis", ax: "y", key: "max" } });
    await vi.waitFor(() => expect(document.getElementById("pickCells")?.textContent).toContain("Chart: the axis's bound from a cell"));
    await act(async () => { fireEvent.click(document.querySelector('#pickCells [data-a="cancel"]')!); });
    await step(async () => { applyRef(id, { what: "axis", ax: "y", key: "max" }, { sheet: "SLIDE_1", range: "D8" }); });
    expect(it_().axes?.y?.cells).toEqual({ max: { sheet: "SLIDE_1", range: "D8" } });
    await vi.waitFor(() => expect(Y("nocell-max")).toBeTruthy());
    await step(async () => { fireEvent.click(Y("nocell-max")); }, "Left axis: max typed");
    expect(it_().axes?.y).toBeUndefined();
  }, 30_000);
  it("the targets' places: the reference label inside, the gap's direction / label side / caption, the pills' row and caption – one step each", async () => {
    await step(async () => { applyRef(id, { what: "ref-add" }, { sheet: "SLIDE_1", range: "D7" }); });
    const [rid] = only(it_(), "ref");
    await vi.waitFor(() => expect(q(`[data-ref="${rid}"]`)).toBeTruthy());
    await step(() => choose(q(`[data-ref="${rid}"] [data-a="rpos"]`), "inside"), "Reference line label place");
    await step(async () => { fireEvent.click(q("#chartAddGap")); }, "Add gap arrow");
    const [gid] = only(it_(), "gap");
    await vi.waitFor(() => expect(q(`[data-gap="${gid}"]`)).toBeTruthy());
    const G = (a: string) => q(`[data-gap="${gid}"] [data-a="${a}"]`);
    await step(() => choose(G("gfrom"), "point"), "Gap arrow direction");
    await step(() => choose(G("glabel"), "left"), "Gap label side");
    await step(() => choose(G("gcap"), "above"), "Gap caption place");
    expect(it_().marks![gid]).toMatchObject({ from: "point", labelSide: "left", capPos: "above" });
    await step(async () => { fireEvent.click(q("#chartAddChange")); }, "Add change pills");
    const [pid] = only(it_(), "change");
    await vi.waitFor(() => expect(q(`[data-chg="${pid}"]`)).toBeTruthy());
    await step(() => choose(q(`[data-chg="${pid}"] [data-a="cposition"]`), "point"), "Change pills: place");
    await step(() => choose(q(`[data-chg="${pid}"] [data-a="ccap"]`), "right"), "Change pills: caption place");
    expect(it_().marks![pid]).toMatchObject({ pos: "point", capPos: "right" });
    expect(it_().marks![rid].pos).toBe("inside");
    // one series with targets: no legend unless asked for (the panel shows what the chart draws)
    expect((q("#chartLegendAt") as HTMLSelectElement).value).toBe("none");
  }, 30_000);
  it("a label dragged on the stage: one op, one undo step; a click without a move changes nothing; Reset puts every label back in one step", async () => {
    const R = curSlide()!, host = document.createElement("div"); document.body.appendChild(host);
    const drag = async (dx: number, dy: number) => act(async () => {
      labelDrag(R, id, "v:s1:1", { x: 100, y: 100, w: 40, h: 16 }, { x: 0, y: 0, w: 600, h: 400 }, host, new PointerEvent("pointerdown", { button: 0, clientX: 10, clientY: 10 }));
      expect(host.querySelector(".labelghost")).toBeTruthy();
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 10 + dx, clientY: 10 + dy }));
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 10 + dx, clientY: 10 + dy }));
    });
    const h = history();
    await drag(1, 1); await settle();
    expect(history()).toBe(h); expect(host.querySelector(".labelghost")).toBeNull();
    await step(() => drag(60, -40), "Move chart label");
    const n = it_().nudge!["v:s1:1"];
    expect(n.dx).toBeGreaterThan(0); expect(n.dy).toBeLessThan(0);
    await vi.waitFor(() => expect((q("#chartNudgeReset") as HTMLButtonElement).disabled).toBe(false));
    await step(async () => { fireEvent.click(q("#chartNudgeReset")); }, "Labels back in place");
    expect(it_().nudge).toBeUndefined();
    const h2 = history();
    await act(async () => undo(false)); await confirmed(h2 - 1);
    expect(it_().nudge?.["v:s1:1"]).toEqual(n);
  }, 30_000);
});
