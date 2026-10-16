/* M7b (08 §3, DS-10): a deck saved in a consulting design and opened by a 4.0 / 4.1 page. The 4.1 rules are frozen in
   fixtures/v41 (model/style.ts, ops.ts, types.ts as on main at 4.1); the deck itself is fixtures/consult-4.2.json. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolveStyle as resolve41 } from "./fixtures/v41/style";
import { applyOps as apply41 } from "./fixtures/v41/ops";
import { resolveStyle } from "../src/model/style";
import { applyOps } from "../src/model/ops";
import { DESIGNS, DESIGN_LABEL, isConsult } from "../src/model/designs";
import type { Op, StylePatch, WorkbookDoc } from "../src/model/types";

const saved = (): WorkbookDoc => JSON.parse(readFileSync(new URL("./fixtures/consult-4.2.json", import.meta.url), "utf8"));
const consultKeys = (d: WorkbookDoc) => ({
  design: d.style.design,
  looks: Object.keys(d.style.designs || {}).filter(isConsult).sort(),
  sizes: d.preset!.slides.flatMap(s => Object.keys(s.sizes || {}).filter(isConsult)).sort(),
});

describe("a deck saved in a consulting design", () => {
  it("opens as Liquid Glass on a 4.1 page", () => {
    const st = resolve41({}, saved().style as never);
    expect(st.design).toBe("glass");
  });
  it("keeps every consulting setting through a 4.1 page's edits", () => {
    const doc = saved(), before = consultKeys(doc);
    const ops = [
      { op: "style.patch", patch: { glass: "strong", designs: { glass: { colors: { accent: "#123456" } } } } },
      { op: "slide.patch", id: doc.preset!.slides[1].id, patch: { title: "Edited on 4.1", sizes: { glass: { scale: 0.9 } } } },
    ] as Op[];
    const { doc: out, skipped } = apply41(doc as never, ops as never);
    expect(skipped).toEqual([]);
    expect(consultKeys(out as never)).toEqual(before);
    expect((out as WorkbookDoc).style.designs!.mckinsey).toEqual(saved().style.designs!.mckinsey);
    // and back on this page: still the consulting design, with its own look and sizes
    const st = resolveStyle({}, (out as WorkbookDoc).style);
    expect(st.design).toBe("mckinsey");
    expect(st.colors.accent).toBe("#0A2A66");
    expect((out as WorkbookDoc).preset!.slides[1].sizes!.mckinsey).toEqual({ scale: 0.8 });
  });
  it("is the same on this page's operations", () => {
    const doc = saved(), before = consultKeys(doc);
    const { doc: out } = applyOps(doc, [{ op: "style.patch", patch: { designs: { glass: { colors: { accent: "#123456" } } } } } as Op]);
    expect(consultKeys(out)).toEqual(before);
  });
});

describe("the consulting designs' style", () => {
  it("are known designs with neutral names", () => {
    expect(DESIGNS).toEqual(["glass", "excel", "clean", "mckinsey", "bain"]);
    expect([DESIGN_LABEL.mckinsey, DESIGN_LABEL.bain]).toEqual(["Consulting Navy", "Consulting Red"]);
    expect(resolveStyle({ design: "bain" }).design).toBe("bain");
    expect(resolveStyle({ design: "other" as never }).design).toBe("glass");
  });
  it("keep their palette under a shared theme; a theme of their own applies (08 §6 Q4)", () => {
    const shared: StylePatch = { theme: { id: "intesa" } };
    expect(resolveStyle(shared, { design: "mckinsey" }).theme.id).toBe("consult-navy");
    expect(resolveStyle(shared, { design: "bain" }).theme.id).toBe("consult-red");
    expect(resolveStyle(shared, { design: "excel" }).theme.id).toBe("intesa");
    expect(resolveStyle(shared, { design: "bain", designs: { bain: { theme: { id: "ocean" } } } }).theme.id).toBe("ocean");
    // colour overrides apply in every design (TH-09)
    expect(resolveStyle({ colors: { accent: "#112233" } }, { design: "bain" }).colors.accent).toBe("#112233");
  });
});
