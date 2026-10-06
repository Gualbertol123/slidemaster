import { describe, expect, it } from "vitest";
import vectors from "../../shared/ops-vectors.json";
import { applyOps, inverseOf, applyOp } from "../src/model/ops";
import type { Op } from "../src/model/types";

describe("operations follow shared/ops-vectors.json", () => {
  for (const v of vectors as any[]) {
    it(v.name, () => {
      const { doc, applied, skipped } = applyOps(v.doc, v.ops);
      expect(doc.preset).toEqual(v.expect.preset);
      expect(doc.style).toEqual(v.expect.style);
      expect(doc.edits).toEqual(v.expect.edits);
      expect(applied).toBe(v.expect.applied);
      expect(skipped).toEqual(v.expect.skipped);
    });
  }
});

describe("inverse operations", () => {
  const base = () => ({ preset: { sheets: [], tables: [], slides: [{ id: "s1", type: "content" as const, title: "T", tables: [] }] }, style: { design: "glass" as const, pn: { on: true } }, edits: { S: { A1: { b: true } } } });
  const cases: Op[] = [
    { op: "cell.patch", sheet: "S", ref: "A1", patch: { b: false, text: "x", orig: "y" } },
    { op: "cell.patch", sheet: "S", ref: "B2", patch: { fill: "#fff" } },
    { op: "slide.patch", id: "s1", patch: { title: "New", logo: false } },
    { op: "style.patch", patch: { design: "excel", pn: { on: false, size: 20 } } },
    { op: "preset.set", preset: null },
  ];
  for (const op of cases) it(op.op + " round-trips", () => {
    const d = base(); const inv = inverseOf(d, op)!;
    applyOp(d, op); applyOp(d, inv);
    expect(d).toEqual(base());
  });
  it("undo of my edit keeps another user's later edit", () => {
    const d: any = base(); const mine: Op = { op: "cell.patch", sheet: "S", ref: "A1", patch: { sz: 20 } };
    const inv = inverseOf(d, mine)!; applyOp(d, mine);
    applyOp(d, { op: "cell.patch", sheet: "S", ref: "C3", patch: { b: true } });   // someone else
    applyOp(d, inv);
    expect(d.edits.S).toEqual({ A1: { b: true }, C3: { b: true } });
  });
});

describe("inverse of map merges", () => {
  const base = () => ({ preset: { sheets: [], tables: [{ id: "t", sheet: "S", kind: "range" as const, range: "A1:B2", cols: { "2": 80 } }], slides: [{ id: "s", type: "content" as const, tables: ["t"], notes: { "t:top": { text: "A" } } }] }, style: { radius: 100 }, edits: {} });
  const cases: Op[] = [
    { op: "table.patch", id: "t", patch: { cols: { "2": 120, "3": 50 }, name: "X" } },
    { op: "table.patch", id: "t", patch: { cols: null } },
    { op: "slide.patch", id: "s", patch: { notes: { "t:top": null, "t:left": { text: "L" } }, align: "left", scale: .7 } },
    { op: "style.patch", patch: { radius: 40, contrast: 80, logoBubble: false } },
  ];
  for (const op of cases) it(op.op + " " + JSON.stringify((op as any).patch).slice(0, 40) + " round-trips", () => {
    const d: any = base(); const inv = inverseOf(d, op)!;
    applyOp(d, op); applyOp(d, inv);
    expect(d).toEqual(base());
  });
});
