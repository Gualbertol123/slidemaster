/* S10.3b (07 §5.2, B25): a deck saved with cell borders set on the slide (4.4, `TableDef.borders`) stays readable and
   editable by a 4.0 / 4.1 page, which keeps the entries and draws the workbook's borders. The 4.1 operations are frozen
   in fixtures/v41/ops.ts; the deck is fixtures/borders-4.4.json (added, never edited). */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { applyOps as apply41 } from "./fixtures/v41/ops";
import { applyOps, inverseOf, applyOp } from "../src/model/ops";
import { fold } from "../src/model/fold";
import type { Op, WorkbookDoc } from "../src/model/types";

const saved = (): WorkbookDoc => JSON.parse(readFileSync(new URL("./fixtures/borders-4.4.json", import.meta.url), "utf8"));
const borders = (d: WorkbookDoc) => d.preset!.tables[0].borders;

describe("a deck with cell borders", () => {
  it("keeps them through a 4.1 page's edits of the same table (widths, gridlines, name) and its cells", () => {
    const doc = saved(), before = borders(doc);
    const ops = [
      { op: "table.patch", id: "t1", patch: { cols: { "2": 90 }, gridH: "on", name: "T", borders: null } },
      { op: "cell.patch", sheet: "S", ref: "B3", patch: { b: true } },
    ];
    const { doc: out, skipped } = apply41(doc as never, ops as never) as { doc: WorkbookDoc; skipped: number[] };
    expect(skipped).toEqual([]);
    expect(borders(out)).toEqual(before);
    expect(out.preset!.tables[0]).toMatchObject({ cols: { "2": 90 }, gridH: "on", name: "T", cellGrid: { B5: { o: true } } });
  });
  it("this page changes them per cell, undoes the change, and folds the records in any order", () => {
    const ops = [
      { op: "table.patch", id: "t1", patch: { borders: { B3: null, D7: { top: "none" } } } },
      { op: "table.patch", id: "t1", patch: { borders: { C3: { bottom: { style: "thick", color: "#000000" } } } } },
    ] as Op[];
    const { doc: out, skipped } = applyOps(saved(), ops);
    expect(skipped).toEqual([]);
    expect(borders(out)).toEqual({ C3: { bottom: { style: "thick", color: "#000000" } }, D7: { top: "none" } });
    expect(out.preset!.tables[0].cellGrid).toEqual({ B5: { o: true } });
    const d = saved(), inv = inverseOf(d, ops[0])!; applyOp(d, ops[0]); applyOp(d, inv);
    expect(d).toEqual(saved());
    const snap = { format: 4, gen: 1, workbook: "W.xlsx", lamport: 7, rev: 7, frontier: {}, doc: saved() };
    const recs = [{ w: "a", s: 1, l: 8, by: "a", at: 1, ops: [ops[0]] }, { w: "b", s: 1, l: 9, by: "b", at: 2, ops: [ops[1]] }];
    const a = fold(snap as never, recs as never), b = fold(snap as never, [...recs].reverse() as never);
    expect(a.doc.preset).toEqual(out.preset);
    expect(b.doc).toEqual(a.doc);
  });
});
