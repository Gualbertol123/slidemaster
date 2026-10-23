/* 4.13.2 (owner's screenshot of 2026-10-23, image 20): a chart card on the long Volumes table (app/tests/fixtures/B54.xlsx),
   filtered by Product, whose category names are the Product column itself – as Insert chart ▾ › Choose the cells… stores
   them when step 2 takes the Product cells as "their names", or From the selected cells when the selection starts at
   Product. Every kept row shows "Loans" there: the axis read Loans, Loans, Loans, Loans and the momentum captions
   "vs Loans". A filtered chart's categories are never named by its filter column (the nearest other text column left of
   the numbers names them: Period); names all alike are an Issues line. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, emptyDoc } from "../src/model/ops";
import { runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { excelToDisplayList, type Metrics } from "../src/render/excel-dl";
import { slideToDisplayList } from "../src/render/slide-dl";
import { computeLayout } from "../src/render/layout";
import { seriesData } from "../src/render/chart-data";
import { wrapLines } from "../src/text/lines";
import type { DisplayList, Node, TextNode } from "../src/dl/types";
import type { RenderCtx } from "../src/render/context";
import type { ChartItem, ItemPatch, Op } from "../src/model/types";
import { b54Ops, volumeCard } from "./b54-deck";

const here = path.dirname(fileURLToPath(import.meta.url));
const BOOK = path.join(here, "../../app/tests/fixtures/B54.xlsx");
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
const flat = (l: DisplayList): Node[] => l.flatMap(n => n.t === "group" ? [n, ...flat(n.children)] : [n]);
const V = (range: string) => ({ sheet: "Volumes", range });
/** the Loans card as the owner's deck holds it: its names the Product column (A2:A9), the filter's column too */
const loans = (labels?: ChartItem["labels"] | null): ChartItem => {
  const c = volumeCard("Loans", "D2", { x: 61, y: 340, w: 725, h: 520 }, { text: "Actual loans" });
  const { labels: _l, ...rest } = c;
  return { ...rest, ...(labels ? { labels } : {}), moms: { m1: { n: 1, vs: "first" }, m2: { n: 2, vs: "trough" }, m3: { n: 3, vs: "prev" } } };
};
async function deck(card: ChartItem) {
  const b = await fs.promises.readFile(BOOK), wb = await readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  const ops: Op[] = [...b54Ops(), { op: "item.patch", slide: "b54", id: "cl", patch: null }, { op: "item.patch", slide: "b54", id: "cl", patch: card as unknown as ItemPatch }];
  const { doc: view, skipped } = applyOps(emptyDoc("B54.xlsx"), ops);
  expect(skipped).toEqual([]);
  const style = resolveStyle({}, { ...view.style, design: "excel" }), slides = runtimeSlides(wb, view.preset, "B54.xlsx", "excel");
  const ctx: RenderCtx = { style, edits: {}, slides, preset: view.preset || null, workbook: "B54.xlsx", logoSrc: "", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null, forExport: true };
  const l = slideToDisplayList(slides[0], 0, ctx, [], computeLayout(slides[0], ctx).boxes, { wall: null, logo: null }, M, "23 October 2026", { sem: true });
  const at = l.items.cl.at, texts = flat(l.nodes.slice(at[0], at[1])).filter((n): n is TextNode => n.t === "text").map(t => t.src);
  return { ctx, it: view.preset!.slides[0].items!.cl as unknown as ChartItem, texts, issue: l.items.cl.issue };
}

describe("4.13.2 · a filtered chart's categories are never its filter column", () => {
  it("names stored as the Product column (= filter.by): Period names the categories, the momentum reads vs Q3 / vs W38", async () => {
    const { ctx, it: c, texts, issue } = await deck(loans(V("A2:A9")));
    expect(c.labels).toEqual(V("A2:A9"));
    const D = seriesData(c, ctx);
    expect(D.ok && D.cats).toEqual(["Q3", "W37", "W38", "W39"]);
    expect(D.ok && D.series[0].vals).toEqual([11576, 11411, 13000, 12000]);
    expect(D.ok && D.issues).toEqual([]);
    for (const s of ["vs Q3", "vs W38", "since trough", "W39"]) expect(texts, s).toContain(s);
    expect(texts).not.toContain("vs Loans");
    expect(texts.filter(t => t === "Loans")).toEqual([]);
    expect(issue).toBeNull();
  });
  it("names left unset: the nearest text column left of the numbers that is not the filter's (Period whichever side Product is)", async () => {
    const { ctx, it: c } = await deck(loans(null));
    const D = seriesData(c, ctx);
    expect(D.ok && D.cats).toEqual(["Q3", "W37", "W38", "W39"]);
    // a filter on Period (B) with the numbers in C: the auto names skip B and take Product (A) – never the filter column
    const byPeriod = seriesData({ ...c, filter: { by: V("B2:B9"), eq: "W38" } }, ctx);
    expect(byPeriod.ok && byPeriod.cats).toEqual(["Loans", "Deposits"]);
  });
  it("other names are kept; names all alike are an Issues line (a chart without a filter keeps them as chosen)", async () => {
    const { ctx, it: c } = await deck(loans(V("B2:B9")));
    const D = seriesData(c, ctx);
    expect(D.ok && [D.cats, D.issues]).toEqual([["Q3", "W37", "W38", "W39"], []]);
    // no filter: Loans' four rows named by Product (Choose the cells… C2:C5, names A2:A5)
    const plain = seriesData({ ...c, filter: undefined, values: V("C2:C5"), labels: V("A2:A5"), sers: { vol: { n: 1, vals: [V("C2:C5")] } } }, ctx);
    expect(plain.ok && plain.cats).toEqual(["Loans", "Loans", "Loans", "Loans"]);
    expect(plain.ok && plain.issues).toEqual(["every category is named “Loans”: choose the names in Change the cells… (e.g. the Period column)"]);
  });
  it("review of PR #43: groups of one category each named alike (\"Total\") are no Issues line; a filtered chart whose only text column is the filter's is numbered by the rows drawn", async () => {
    const { ctx, it: c } = await deck(loans(V("B2:B9")));
    const grouped = seriesData({ ...c, filter: undefined, labels: undefined, groups: { g1: { n: 1, cats: ["Total"], label: "Loans" }, g2: { n: 2, cats: ["Total"], label: "Deposits" } },
      sers: { a: { n: 1, vals: [V("C5")], group: "g1" }, b: { n: 2, vals: [V("C9")], group: "g2" } } }, ctx);
    expect(grouped.ok && [grouped.cats, grouped.issues]).toEqual([["Total", "Total"], []]);
    // the KPI sheet: Product (A) the only text column; filtered on it, the WM row (the 3rd of the table) is category 1
    const K = (range: string) => ({ sheet: "KPI", range });
    const one = seriesData({ ...c, labels: undefined, values: K("C2:C5"), sers: { vol: { n: 1, vals: [K("C2:C5")] } }, filter: { by: K("A2:A5"), eq: "WM" }, marks: undefined, stats: undefined, moms: undefined }, ctx);
    expect(one.ok && one.cats).toEqual(["1"]);
  });
});
