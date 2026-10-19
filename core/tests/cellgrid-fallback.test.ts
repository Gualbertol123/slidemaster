/* S10.3 (07 §2.1, §5.2): a deck saved with gridlines on selected cells (4.4, `TableDef.cellGrid`) stays readable and
   editable by a 4.0 / 4.1 page, which keeps the entries and draws the table without them. The 4.1 operations are frozen
   in fixtures/v41/ops.ts; the deck is fixtures/cellgrid-4.4.json (added, never edited). */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { applyOps as apply41 } from "./fixtures/v41/ops";
import { applyOps, inverseOf, applyOp } from "../src/model/ops";
import { fold } from "../src/model/fold";
import type { Op, WorkbookDoc } from "../src/model/types";

const saved = (): WorkbookDoc => JSON.parse(readFileSync(new URL("./fixtures/cellgrid-4.4.json", import.meta.url), "utf8"));
const grid = (d: WorkbookDoc) => d.preset!.tables[0].cellGrid;

describe("a deck with gridlines on selected cells", () => {
  it("keeps them through a 4.1 page's edits of the same table (widths, gridlines, name) and its cells", () => {
    const doc = saved(), before = grid(doc);
    const ops = [
      { op: "table.patch", id: "t1", patch: { cols: { "2": 90 }, gridH: "on", name: "T", cellGrid: null } },
      { op: "cell.patch", sheet: "S", ref: "B3", patch: { b: true } },
    ];
    const { doc: out, skipped } = apply41(doc as never, ops as never) as { doc: WorkbookDoc; skipped: number[] };
    expect(skipped).toEqual([]);
    expect(grid(out)).toEqual(before);
    expect(out.preset!.tables[0]).toMatchObject({ cols: { "2": 90 }, gridH: "on", gridV: "on", name: "T" });
  });
  it("this page changes them per cell, undoes the change, and folds the records in any order", () => {
    const ops = [
      { op: "table.patch", id: "t1", patch: { cellGrid: { B3: null, D7: { v: "on" } } } },
      { op: "table.patch", id: "t1", patch: { cellGrid: { C3: { o: true } } } },
    ] as Op[];
    const { doc: out, skipped } = applyOps(saved(), ops);
    expect(skipped).toEqual([]);
    expect(grid(out)).toEqual({ C3: { o: true }, B5: { o: true }, C5: { o: true }, D7: { v: "on" } });
    const d = saved(), inv = inverseOf(d, ops[0])!; applyOp(d, ops[0]); applyOp(d, inv);
    expect(d).toEqual(saved());
    const snap = { format: 4, gen: 1, workbook: "W.xlsx", lamport: 7, rev: 7, frontier: {}, doc: saved() };
    const recs = [{ w: "a", s: 1, l: 8, by: "a", at: 1, ops: [ops[0]] }, { w: "b", s: 1, l: 9, by: "b", at: 2, ops: [ops[1]] }];
    const a = fold(snap as never, recs as never), b = fold(snap as never, [...recs].reverse() as never);
    expect(a.doc.preset).toEqual(out.preset);
    expect(b.doc).toEqual(a.doc);
  });
});
