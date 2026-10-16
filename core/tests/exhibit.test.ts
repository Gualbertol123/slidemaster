/* Tables read as exhibits (render/exhibit.ts): the label column, body and total rows, the period series, the reference
   columns and the variance groups of a table, and the facts the consulting designs quote – every one a cell. */
import { describe, expect, it } from "vitest";
import { exhibitFacts, exhibitOf } from "../src/render/exhibit";
import { keyOf } from "../src/render/edits";
import type { DeckVersion, Op } from "../src/model/types";
import { deckOf } from "./corpus-deck";

describe("exhibitOf", () => {
  it("deck20: labels, the Week37–39 series, the Budget reference, five variances, the total", async () => {
    const { ctx, slides } = await deckOf("deck20.json"), L = slides[0].tables[0], ex = exhibitOf(L, ctx());
    expect(ex.kind).toBe("exhibit");
    expect(ex.labelCol).toBe(3);
    expect(ex.rows.map(r => r.label?.text)).toEqual(["VUB", "PBZ", "BIB", "Alex", "CIB", "ISP SLO", "ISP RO", "ISP ALB", "ISP BiH", "EximBank", "Pravex"]);
    expect(ex.rows.every(r => r.kind === "body")).toBe(true);
    expect(ex.total?.label?.text).toBe("TOTAL BANKS LOANS (1)");
    expect(ex.total?.kind).toBe("total");
    expect(ex.series).toEqual({ cols: [4, 5, 6], labels: ["Week37", "Week38", "Week39"] });
    expect(ex.refs).toEqual([{ col: 7, label: "Eom Budget" }]);
    expect(ex.deltas).toEqual([
      { label: "vs Budget", abs: 8, pct: 9 }, { label: "vs Prev. Week", abs: 10, pct: 11 }, { label: "vs EoM Aug 2026", abs: 12, pct: 13 },
      { label: "vs Q2", abs: 14, pct: 15 }, { label: "vs BoY", abs: 16, pct: 17 }]);
    expect(ex.head).toEqual([5, 6]);
    const vub = ex.rows[0];
    expect(vub.cells.get(6)).toMatchObject({ text: "2.037", v: 2037, r: vub.r, c: 6 });
    expect(vub.cells.get(8)?.v).toBe(-69);
    expect(ex.rows[9].cells.get(7)?.v ?? null).toBeNull();                       // EximBank: no budget
    expect(ex.total!.cells.get(6)?.v).toBe(77407);
  });

  it("deck20: the facts the KPI line and the message panel quote", async () => {
    const { ctx, slides } = await deckOf("deck20.json"), f = exhibitFacts(exhibitOf(slides[0].tables[0], ctx()));
    expect(f.headline?.value.v).toBe(77407);
    expect(f.headline?.label).toBe("Total Banks Loans · Week39");
    expect(f.kpis.map(k => [k.label, k.value.v])).toEqual([["vs Prev. Week", 192], ["vs Budget", -43], ["vs BoY", 3245]]);
    expect(f.lead?.label).toBe("vs Budget");
    expect(f.lead?.value.v).toBe(-43);
    expect(f.lead?.pct?.text).toBe("-0,1%");
    // VUB −69, PBZ −16, CIB −47, ISP ALB −78, ISP BiH −25 below budget; EximBank and Pravex have none
    expect(f.short).toEqual({ n: 5, of: 9 });
    expect(f.worst?.label).toBe("ISP ALB");
    expect(f.worst?.abs?.v).toBe(-78);
    expect(f.worst?.pct?.text).toBe("-0,9%");
    expect(exhibitFacts(exhibitOf(slides[0].tables[0], ctx()))).toBe(f);           // cached
  });

  it("edits and versions: the effective text; a removed cell has no value", async () => {
    const d0 = await deckOf("deck20.json"), vub = exhibitOf(d0.slides[0].tables[0], d0.ctx()).rows[0], ref = keyOf(vub.cells.get(8)!.it), w39 = keyOf(vub.cells.get(6)!.it);
    const { ctx, slides } = await deckOf("deck20.json", "mckinsey", [{ op: "cell.patch", sheet: "SLIDE_01", ref, patch: { text: "-100", orig: "-69" } } as Op]);
    const L = slides[0].tables[0], ex = exhibitOf(L, ctx());
    expect(ex.rows[0].cells.get(8)).toMatchObject({ text: "-100", v: -100 });
    const v: DeckVersion = { id: "v", name: "v", hide: { SLIDE_01: [w39] } }, cut = exhibitOf(L, ctx(v));
    expect(cut.rows[0].cells.get(6)).toMatchObject({ text: "", v: null });
  });

  it("plain tables: no labelled numbers, nothing to show as an exhibit, or a column it cannot show", async () => {
    const r = await deckOf("report.json"), p = await deckOf("plain.json"), e = await deckOf("edge-formats.json");
    const rep = exhibitOf(r.slides[0].tables[0], r.ctx());                         // text columns (Since, Note) and a second Δ w/w
    expect(rep.kind).toBe("plain");
    expect(rep.rows).toEqual([]);
    expect(rep.head.length).toBeGreaterThan(0);
    expect(exhibitFacts(rep)).toEqual({ headline: null, kpis: [], lead: null, short: null, worst: null });
    expect(exhibitOf(p.slides[0].tables[0], p.ctx()).kind).toBe("plain");          // Col 1 … Col 5: no periods, no variances
    expect(exhibitOf(e.slides[0].tables[0], e.ctx()).kind).toBe("plain");
    const q = exhibitOf(r.slides[1].tables[0], r.ctx());                            // Region · Q1 · Q2: a series
    expect(q.kind).toBe("exhibit");
    expect(q.series).toEqual({ cols: [4, 5], labels: ["Q1", "Q2"] });
    expect(q.total).toBeNull();
  });
});
