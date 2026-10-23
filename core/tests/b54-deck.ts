/* B54 (4.13): the owner's target slide (image 15 of 2026-10-23) as operations on the workbook tests/fixtures/B54.xlsx –
   a headline and two (the KPI cards are v4/B54-kpi-item's) chart cards on the long Volumes table, filtered by product: Loans and Deposits, each with the
   EoM budget line from a cell, the stats row (latest volume, EoM budget, gap to budget), a corner tag, a separator and
   the momentum row (vs the first period, since the trough, week on week). Used by core/tests/chart-card.test.ts and the
   e2e spec B54-01. */
import type { ChartItem, DataRef, ItemPatch, Op } from "../src/model/types";

export const HEADLINE = "Deposits are below the EoM budget (102%) and declined week on week";
const V = (range: string): DataRef => ({ sheet: "Volumes", range });
/** the chart card of one product of the Volumes table */
export function volumeCard(product: "Loans" | "Deposits", budget: string, box: ChartItem["box"], tag: { text: string; color?: string }): ChartItem {
  return { kind: "chart", type: "line", title: product.toUpperCase() + " · WEEKLY VOLUME", titleFmt: { align: "left" }, values: V("C2:C9"), labels: V("B2:B9"), legendAt: "none", box,
    filter: { by: V("A2:A9"), eq: product },
    axes: { y: { num: "#,##0" } },
    sers: { vol: { n: 1, name: product, vals: [V("C2:C9")], color: "#2F55F4", line: { w: 3 }, marker: { shape: "circle", size: 9 }, labels: { show: ["value"], pos: "above", fmt: { b: true } } } },
    marks: { r1: { kind: "ref", value: V(budget), name: "Budget", style: { dash: "solid", w: 1.5 } } },
    stats: { s1: { n: 1, label: "Latest volume", src: "last" }, s2: { n: 2, label: "EoM budget", src: "ref", ref: "r1" }, s3: { n: 3, label: "Gap to budget", src: "gap", ref: "r1" } },
    tag, sep: {},
    moms: { m1: { n: 1, vs: "first" }, m2: { n: 2, vs: "trough" }, m3: { n: 3, vs: "prev", caption: "WoW" } } };
}
/** the slide's operations: the preset (sheets, one content slide with the headline), two chart cards */
export function b54Ops(slide = "b54"): Op[] {
  const gap = 26, x0 = 61;
  return [
    { op: "preset.set", preset: { sheets: ["KPI", "Volumes"], tables: [], slides: [{ id: slide, type: "content", title: HEADLINE, tables: [] }] } },
    { op: "item.patch", slide, id: "cl", patch: volumeCard("Loans", "D2", { x: x0, y: 340, w: 725, h: 520 }, { text: "Actual loans" }) as unknown as ItemPatch },
    { op: "item.patch", slide, id: "cd", patch: volumeCard("Deposits", "D6", { x: x0 + 725 + gap, y: 340, w: 725, h: 520 }, { text: "Illustrative", color: "#D93025" }) as unknown as ItemPatch },
  ];
}
