/* 4.13.2 (owner's screenshot of 2026-10-23, image 20: a slide of four KPI cards and two chart cards, no table):
   1 · the stage's "No tables on this slide – Add table (Insert) puts one here." hint (and the Issues line "No tables on
       this slide.") only on a slide with nothing on it – no table, no item of any kind, no text box;
   2 · the Loans card's categories read "Loans" four times ("vs Loans" under the momentum): the page's own steps, as the
       owner took them – Insert chart ▾ › Choose the cells… (step 1 the volumes, step 2 "their names" on the Product
       column: PickCells' finish → insertChartRefs), the type switch to a line, the filter's Cells… on the Product column
       and its value, + Stats and momentum – store names that ARE the filter's column (none of the later steps changes
       them); the chart now draws the periods. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emptySlide } from "../src/stage/empty-hint";
import { slideIssues } from "../src/editor/issues";
import { cardPresetPatch, filterPatch } from "../src/editor/chart-card";
import { refPatch, typePatch } from "../src/editor/chart-panel";
import { applyOps, emptyDoc } from "@slide-builder/core/model/ops";
import { readWorkbook } from "@slide-builder/core/xlsx/workbook";
import { runtimeSlides } from "@slide-builder/core/model/preset";
import { resolveStyle } from "@slide-builder/core/model/style";
import { seriesData } from "@slide-builder/core/render/chart-data";
import type { RenderCtx } from "@slide-builder/core/render/context";
import type { ChartItem, ItemPatch, Op, RuntimeSlide } from "@slide-builder/core/model/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const R = (cfg: Partial<RuntimeSlide["cfg"]>, tables: unknown[] = [], type: RuntimeSlide["type"] = "content") =>
  ({ id: "s", type, tables, cfg: { id: "s", type, tables: [], ...cfg }, missing: 0 }) as unknown as RuntimeSlide;
const box = { x: 0, y: 0, w: 100, h: 100 };

describe("4.13.2 · the empty slide's hint", () => {
  it("only a content slide with no table, no item and no text box is empty", () => {
    expect(emptySlide(R({}))).toBe(true);
    expect(emptySlide(R({ items: {}, notes: {} }))).toBe(true);
    // image 20: KPI cards and chart cards, no table
    expect(emptySlide(R({ items: { k1: { kind: "kpi", head: { sheet: "KPI", range: "A2" }, box } as never, cl: { kind: "chart", type: "line", values: { sheet: "Volumes", range: "C2:C9" }, box } } }))).toBe(false);
    for (const it of [{ kind: "shape", shape: "rect", box }, { kind: "line", route: "straight", a: { x: 0, y: 0 }, b: { x: 9, y: 9 }, box }, { kind: "sticker", box }])
      expect(emptySlide(R({ items: { i1: it as never } })), it.kind).toBe(false);
    expect(emptySlide(R({ notes: { "t1:right": { text: "Note" } } }))).toBe(false);
    expect(emptySlide(R({}, [{}]))).toBe(false);
    expect(emptySlide(R({}, [], "cover"))).toBe(false);
    expect(emptySlide(R({ items: { gone: null as never } }))).toBe(true);           // (a removed item's leftover)
  });
  it("the Issues panel: \"No tables on this slide.\" only on an empty slide", () => {
    const html = (S: RuntimeSlide) => slideIssues(S, { slides: [S], edits: {}, preset: null, style: resolveStyle({}, { design: "excel" } as never) } as never).map(x => x.html);
    expect(html(R({}))).toContain("No tables on this slide.");
    expect(html(R({ items: { cl: { kind: "chart", type: "line", values: { sheet: "Volumes", range: "C2:C9" }, box } } }))).not.toContain("No tables on this slide.");
  });
});

describe("4.13.2 · a filtered chart is never named by its filter column (the owner's Loans card)", () => {
  it("Choose the cells… with the Product column as the names, a line, the filter on Product, + Stats and momentum: the periods", async () => {
    const V = (range: string) => ({ sheet: "Volumes", range });
    // PickCells' finish for an Insert chart: insertChartRefs(values, labels) → this item (editor/charts.ts addChart)
    let it: ChartItem = { kind: "chart", type: "pie", values: V("C2:C9"), labels: V("A2:A9"), show: ["percent"], legend: "right", box: { x: 900, y: 200, w: 600, h: 440 } };
    const ops: Op[] = [{ op: "preset.set", preset: { sheets: ["KPI", "Volumes"], tables: [], slides: [{ id: "s", type: "content", tables: [] }] } }, { op: "item.patch", slide: "s", id: "cl", patch: it as unknown as ItemPatch }];
    const step = (p: ItemPatch | null) => { expect(p).not.toBeNull(); ops.push({ op: "item.patch", slide: "s", id: "cl", patch: p }); it = applyOps(emptyDoc("B54.xlsx"), ops).doc.preset!.slides[0].items!.cl as ChartItem; };
    step(typePatch(it, "line"));
    step(refPatch(it, { what: "filter-by" }, V("A2:A9")));
    step(filterPatch(it, { eq: "Loans" }));
    step(cardPresetPatch(it));
    // none of the steps touched the names: they are the filter's column
    expect([it.labels, it.filter]).toEqual([V("A2:A9"), { by: V("A2:A9"), eq: "Loans" }]);
    const b = fs.readFileSync(path.join(here, "fixtures/B54.xlsx")), wb = await readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    const view = applyOps(emptyDoc("B54.xlsx"), ops).doc, slides = runtimeSlides(wb, view.preset, "B54.xlsx", "excel");
    const ctx: RenderCtx = { style: resolveStyle({}, { ...view.style, design: "excel" }), edits: {}, slides, preset: view.preset || null, workbook: "B54.xlsx", logoSrc: "", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null, forExport: true };
    const D = seriesData(it, ctx);
    expect(D.ok && [D.cats, D.series[0].vals, D.issues]).toEqual([["Q3", "W37", "W38", "W39"], [11576, 11411, 13000, 12000], []]);
  });
});
