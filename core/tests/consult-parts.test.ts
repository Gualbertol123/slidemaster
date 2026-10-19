/* The composable consulting look (B29, docs/next/08 §2.8): every part on its own – Δ bars, trend line, latest bar, the
   number of KPIs, the KPI line's and the panel's text formats – and a slide's own look over the deck's. With every part
   at its default the output is unchanged (the snapshots of consult-dl / consult-slide stay). */
import { describe, expect, it } from "vitest";
import { exhibitLayout } from "../src/render/exhibit";
import { consultToDisplayList } from "../src/render/consult-dl";
import { slideToDisplayList } from "../src/render/slide-dl";
import { computeLayout } from "../src/render/layout";
import { validate, type DisplayList, type HitNode, type Node, type TextNode } from "../src/dl/types";
import type { RenderCtx } from "../src/render/context";
import type { ConsultOptions } from "../src/model/designs";
import type { Metrics } from "../src/render/excel-dl";
import { deckOf } from "./corpus-deck";
import { wrapLines } from "../src/text/lines";

const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
const flat = (l: DisplayList): Node[] => l.flatMap(n => n.t === "group" ? [n, ...flat(n.children)] : [n]);
const withOpts = (c: RenderCtx, o: Partial<ConsultOptions>): RenderCtx => ({ ...c, style: { ...c.style, consult: { ...(c.style.consult || {}), ...o } } } as RenderCtx);
const kinds = (c: RenderCtx, L: Parameters<typeof exhibitLayout>[0]) => exhibitLayout(L, c)!.cols.map(k => k.kind);

describe("exhibit parts", () => {
  it("Δ bars: lanes beside the variances (full), bars or % texts (compact)", async () => {
    for (const design of ["mckinsey", "bain"] as const) {
      const { ctx, slides } = await deckOf("deck20.json", design), L = slides[0].tables[0];
      expect(kinds(ctx(), L).filter(k => k === "lane").length, design).toBe(design === "mckinsey" ? 5 : 2);
      expect(kinds(withOpts(ctx(), { bars: "off" }), L)).not.toContain("lane");
      const off = withOpts(ctx(), { numbers: "compact", bars: "off" });
      expect(kinds(off, L)).not.toContain("dbar");
      expect(kinds(off, L).filter(k => k === "dpct").length, design).toBe(5);
      expect(validate(consultToDisplayList(L, off, M).nodes)).toEqual([]);
    }
  });
  it("trend line: Navy's default, Red's when asked; off removes it", async () => {
    for (const design of ["mckinsey", "bain"] as const) {
      const { ctx, slides } = await deckOf("deck20.json", design), L = slides[0].tables[0];
      for (const numbers of ["full", "compact"] as const) {
        expect(kinds(withOpts(ctx(), { numbers, trend: "on" }), L), design + numbers).toContain("trend");
        expect(kinds(withOpts(ctx(), { numbers, trend: "off" }), L), design + numbers).not.toContain("trend");
      }
      const g = exhibitLayout(L, withOpts(ctx(), { trend: "on" }))!, dl = consultToDisplayList(L, withOpts(ctx(), { trend: "on" }), M);
      expect(validate(dl.nodes)).toEqual([]);
      expect(flat(dl.nodes).filter(n => n.t === "path").length, design).toBeGreaterThanOrEqual(g.ex.rows.length);   // a line per row
    }
  });
  it("latest bar: drawn under the latest value when on, in both designs", async () => {
    for (const design of ["mckinsey", "bain"] as const) {
      const { ctx, slides } = await deckOf("deck20.json", design), L = slides[0].tables[0];
      const n = (o: Partial<ConsultOptions>) => flat(consultToDisplayList(L, withOpts(ctx(), o), M).nodes).filter(x => x.t === "rect").length;
      const on = n({ band: "on" }), off = n({ band: "off" });
      expect(on - off, design).toBeGreaterThanOrEqual(9);                            // one per body row with a value
      expect(n({ numbers: "compact", band: "on" }) - n({ numbers: "compact", band: "off" }), design).toBeGreaterThanOrEqual(9);
    }
  });
});

describe("headline parts", () => {
  const slide = async (design: "mckinsey" | "bain", o: Partial<ConsultOptions> = {}) => {
    const { ctx, slides } = await deckOf("deck20.json", design), c = withOpts(ctx(), o), i = slides.findIndex(s => s.type === "content"), R = slides[i];
    const boxes = computeLayout(R, c).boxes, tables = R.tables.map(L => consultToDisplayList(L, c, M));
    return slideToDisplayList(R, i, c, tables, boxes, { wall: null, logo: null } as never, M, "1 October 2026").nodes;
  };
  const kpiHits = (dl: DisplayList) => flat(dl).filter((n): n is HitNode => n.t === "hit" && n.id === "kpi");
  it("KPIs: the headline and 1–3 variances", async () => {
    for (const k of ["1", "2", "3"] as const) expect(kpiHits(await slide("mckinsey", { kpis: k })).length).toBe(1 + +k);
  });
  it("the KPI line's and the panel's text format", async () => {
    const after = (dl: DisplayList, id: string) => { const all = flat(dl), i = all.findIndex(n => n.t === "hit" && n.id === id); return all.slice(i + 1).find((n): n is TextNode => n.t === "text")!; };
    const k0 = after(await slide("mckinsey"), "kpi"), k1 = after(await slide("mckinsey", { kpiText: { font: "Arial", i: true, color: "#123456" } }), "kpi");
    expect(k1.font + (k1.css || "")).toContain("Arial"); expect(k0.font + (k0.css || "")).not.toContain("Arial");
    expect(k1.i).toBe(true);
    expect(JSON.stringify(k1.fill)).toContain(JSON.stringify([0x12, 0x34, 0x56]));
    const p0 = after(await slide("bain"), "sig-lead"), p1 = after(await slide("bain", { panelText: { size: 60, b: false } }), "sig-lead");
    expect(p1.size).toBeLessThanOrEqual(60); expect(p1.size).not.toBe(p0.size);
    expect(!!p1.b || (p1.weight ?? 400) >= 600).toBe(false);
  });
  it("a slide's own look (SlideDef.looks) over the deck's: only that slide changes", async () => {
    const { ctx, slides } = await deckOf("deck20.json", "mckinsey"), c = ctx(), ids = slides.map((s, i) => [s, i] as const).filter(([s]) => s.type === "content").slice(0, 2);
    const draw = () => ids.map(([R, i]) => { const boxes = computeLayout(R, c).boxes, tables = R.tables.map(L => consultToDisplayList(L, c, M)); return kpiHits(slideToDisplayList(R, i, c, tables, boxes, { wall: null, logo: null } as never, M, "x").nodes).length; });
    expect(draw()).toEqual([4, 4]);
    (ids[0][0].cfg as { looks?: unknown }).looks = { mckinsey: { kpis: "1" } };
    expect(draw()).toEqual([2, 4]);
  });
});
