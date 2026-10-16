/* The consulting designs' options (Design… › Layout): stored per design in designs[d].consult, validated, defaults per
   design; an older page keeps them (product owner, 2026-10-16: "add options to make different hybrids"). */
import { describe, expect, it } from "vitest";
import { resolveStyle } from "../src/model/style";
import { applyOps } from "../src/model/ops";
import { applyOps as apply41 } from "./fixtures/v41/ops";
import { CONSULT_DEFAULTS, cleanConsult, consultOptions } from "../src/model/designs";
import type { Op, WorkbookDoc } from "../src/model/types";

describe("consulting design options", () => {
  it("default per design", () => {
    expect(consultOptions({ style: resolveStyle({ design: "mckinsey" }) })).toEqual(CONSULT_DEFAULTS.mckinsey);
    expect(consultOptions({ style: resolveStyle({ design: "bain" }) })).toEqual({ tables: "exhibit", numbers: "full", headline: "panel", background: "tinted" });
  });
  it("set for one design only; invalid values dropped", () => {
    const st = { designs: { mckinsey: { consult: { headline: "panel", tables: "bogus" } }, bain: { consult: { background: "white" } } } } as never;
    expect(consultOptions({ style: resolveStyle(st, { design: "mckinsey" }) })).toEqual({ ...CONSULT_DEFAULTS.mckinsey, headline: "panel" });
    expect(consultOptions({ style: resolveStyle(st, { design: "bain" }) })).toEqual({ ...CONSULT_DEFAULTS.bain, background: "white" });
    expect(resolveStyle(st, { design: "glass" }).consult).toBeUndefined();
    expect(cleanConsult({ tables: "cards", numbers: 3, x: 1 })).toEqual({ tables: "cards" });
  });
  it("kept by this page's and a 4.1 page's operations", () => {
    const doc = (): WorkbookDoc => ({ schema: 3, workbook: "W.xlsx", rev: 1, preset: null, edits: {},
      style: { design: "mckinsey", designs: { mckinsey: { colors: { accent: "#123456" }, consult: { tables: "rules" } } } } });
    const op = { op: "style.patch", patch: { designs: { glass: { colors: { accent: "#654321" } } } } } as Op;
    expect(applyOps(doc(), [op]).doc.style.designs!.mckinsey!.consult).toEqual({ tables: "rules" });
    expect((apply41(doc() as never, [op] as never).doc as WorkbookDoc).style.designs!.mckinsey!.consult).toEqual({ tables: "rules" });
  });
});
