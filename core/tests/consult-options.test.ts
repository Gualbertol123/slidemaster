/* The consulting designs' look (B29, 08 §2.8): its parts stored per design in designs[d].consult and per slide in
   SlideDef.looks[d], validated, defaults per design; an older page keeps them (product owner, 2026-10-16: "add options to
   make different hybrids"; 2026-10-19: "composable, with selectors for each composable part"). */
import { describe, expect, it } from "vitest";
import { resolveStyle } from "../src/model/style";
import { applyOps } from "../src/model/ops";
import { applyOps as apply41 } from "./fixtures/v41/ops";
import { CONSULT_DEFAULTS, cleanConsult, consultOptions, slideLook } from "../src/model/designs";
import { slideCtx } from "../src/render/look";
import type { RenderCtx } from "../src/render/context";
import type { RuntimeSlide } from "../src/model/types";
import type { Op, WorkbookDoc } from "../src/model/types";

describe("consulting design options", () => {
  it("default per design", () => {
    expect(consultOptions({ style: resolveStyle({ design: "mckinsey" }) })).toEqual(CONSULT_DEFAULTS.mckinsey);
    expect(consultOptions({ style: resolveStyle({ design: "bain" }) })).toEqual({ tables: "exhibit", numbers: "full", bars: "on", trend: "off", band: "on", headline: "panel", kpis: "3", background: "tinted" });
  });
  it("set for one design only; invalid values dropped", () => {
    const st = { designs: { mckinsey: { consult: { headline: "panel", tables: "bogus" } }, bain: { consult: { background: "white" } } } } as never;
    expect(consultOptions({ style: resolveStyle(st, { design: "mckinsey" }) })).toEqual({ ...CONSULT_DEFAULTS.mckinsey, headline: "panel" });
    expect(consultOptions({ style: resolveStyle(st, { design: "bain" }) })).toEqual({ ...CONSULT_DEFAULTS.bain, background: "white" });
    expect(resolveStyle(st, { design: "glass" }).consult).toBeUndefined();
    expect(cleanConsult({ tables: "cards", numbers: 3, x: 1 })).toEqual({ tables: "cards" });
    // B29: every part independent; text formats keep valid values only
    expect(cleanConsult({ bars: "off", trend: "maybe", kpis: "2", band: true })).toEqual({ bars: "off", kpis: "2" });
    expect(cleanConsult({ kpiText: { font: "Georgia", size: 40, b: true, color: "#ff0000", x: 1 }, panelText: { size: 1, color: "red" } }))
      .toEqual({ kpiText: { font: "Georgia", size: 40, b: true, color: "#FF0000" } });
  });
  it("kept by this page's and a 4.1 page's operations", () => {
    const doc = (): WorkbookDoc => ({ schema: 3, workbook: "W.xlsx", rev: 1, preset: null, edits: {},
      style: { design: "mckinsey", designs: { mckinsey: { colors: { accent: "#123456" }, consult: { tables: "rules" } } } } });
    const op = { op: "style.patch", patch: { designs: { glass: { colors: { accent: "#654321" } } } } } as Op;
    expect(applyOps(doc(), [op]).doc.style.designs!.mckinsey!.consult).toEqual({ tables: "rules" });
    expect((apply41(doc() as never, [op] as never).doc as WorkbookDoc).style.designs!.mckinsey!.consult).toEqual({ tables: "rules" });
  });
  it("a slide's own look over the deck's (B29): the slide's parts, valid ones only, in the consulting designs only", () => {
    const style = resolveStyle({ designs: { mckinsey: { consult: { headline: "panel", trend: "off" } } } } as never, { design: "mckinsey" });
    const ctx = { style } as RenderCtx;
    const R = (looks: unknown) => ({ id: "s1", cfg: { tables: [], looks } } as unknown as RuntimeSlide);
    expect(slideCtx(ctx, R(undefined))).toBe(ctx);                                   // nothing of its own: the deck's
    const own = slideCtx(ctx, R({ mckinsey: { trend: "on", bars: "off", tables: "nope" }, bain: { headline: "none" } }));
    expect(consultOptions(own)).toEqual({ ...CONSULT_DEFAULTS.mckinsey, headline: "panel", trend: "on", bars: "off" });
    expect(consultOptions(ctx)).toEqual({ ...CONSULT_DEFAULTS.mckinsey, headline: "panel", trend: "off" });   // the deck's untouched
    expect(slideCtx(ctx, R({ mckinsey: { bars: "off" } }))).toBe(slideCtx(ctx, R({ mckinsey: { bars: "off" } })));   // one context per look
    const glass = { style: resolveStyle({}, { design: "glass" }) } as RenderCtx;
    expect(slideCtx(glass, R({ mckinsey: { bars: "off" } }))).toBe(glass);
    expect(slideLook({ looks: { mckinsey: { kpis: "1" } } }, "glass")).toEqual({});
  });
  it("slide.patch sets, replaces and clears a design's slide look; undo restores it", () => {
    const doc = (): WorkbookDoc => ({ schema: 3, workbook: "W.xlsx", rev: 1, edits: {}, style: {},
      preset: { sheets: [], tables: [], slides: [{ id: "s1", tables: [], looks: { bain: { band: "off" } } }] } as never });
    const set = { op: "slide.patch", id: "s1", patch: { looks: { mckinsey: { bars: "off" } } } } as Op;
    const r = applyOps(doc(), [set]);
    expect(r.doc.preset!.slides[0].looks).toEqual({ bain: { band: "off" }, mckinsey: { bars: "off" } });
    const cleared = applyOps(r.doc, [{ op: "slide.patch", id: "s1", patch: { looks: { mckinsey: null, bain: null } } } as Op]);
    expect(cleared.doc.preset!.slides[0].looks).toBeUndefined();
  });
});
