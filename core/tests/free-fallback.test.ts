/* S10.1 (07 §2.1, §5.1): a deck saved with a free layout (4.4, `SlideDef.free`) stays readable and editable by a 4.0 / 4.1
   page, which draws its automatic layout and keeps the free boxes. The 4.1 operations are frozen in fixtures/v41/ops.ts;
   the deck is fixtures/free-4.4.json (added, never edited). */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { applyOps as apply41 } from "./fixtures/v41/ops";
import { applyOps } from "../src/model/ops";
import { fold } from "../src/model/fold";
import type { Op, WorkbookDoc } from "../src/model/types";

const saved = (): WorkbookDoc => JSON.parse(readFileSync(new URL("./fixtures/free-4.4.json", import.meta.url), "utf8"));
const free = (d: WorkbookDoc) => d.preset!.slides[1].free;

describe("a deck with a free layout", () => {
  it("keeps its free boxes through a 4.1 page's edits of the same slide (notes, sizing, title) and its tables", () => {
    const doc = saved(), before = free(doc);
    const ops = [
      { op: "slide.patch", id: "s1", patch: { title: "Edited on 4.1", notes: { "t1:right": null, "t1:top": { text: "T" } }, sizes: { glass: { scale: 0.7 } } } },
      { op: "table.patch", id: "t1", patch: { cols: { "2": 90 } } },
    ];
    const { doc: out, skipped } = apply41(doc as never, ops as never) as { doc: WorkbookDoc; skipped: number[] };
    expect(skipped).toEqual([]);
    expect(free(out)).toEqual(before);
    expect(out.preset!.slides[1]).toMatchObject({ title: "Edited on 4.1", notes: { "t1:top": { text: "T" } }, sizes: { glass: { scale: 0.7 } } });
  });
  it("a 4.1 page sending a `free` key in a slide.patch changes nothing of it (it does not know the key)", () => {
    const { doc: out } = apply41(saved() as never, [{ op: "slide.patch", id: "s1", patch: { free: null, title: "X" } }] as never) as { doc: WorkbookDoc };
    expect(free(out)).toEqual(free(saved()));
  });
  it("this page switches it off and on, and folds the records in any order", () => {
    const f = free(saved())!;
    const ops = [
      { op: "slide.patch", id: "s1", patch: { free: { glass: { ...f.glass!, on: false } } } },
      { op: "slide.patch", id: "s1", patch: { free: { excel: { ...f.excel!, on: true } } } },
    ] as Op[];
    const { doc: out, skipped } = applyOps(saved(), ops);
    expect(skipped).toEqual([]);
    expect(free(out)).toEqual({ glass: { ...f.glass!, on: false }, excel: { ...f.excel!, on: true } });
    const snap = { format: 4, gen: 1, workbook: "W.xlsx", lamport: 9, rev: 9, frontier: {}, doc: saved() };
    const recs = [{ w: "a", s: 1, l: 10, by: "a", at: 1, ops: [ops[0]] }, { w: "b", s: 1, l: 11, by: "b", at: 2, ops: [ops[1]] }];
    const a = fold(snap as never, recs as never), b = fold(snap as never, [...recs].reverse() as never);
    expect(a.doc.preset).toEqual(out.preset);
    expect(b.doc).toEqual(a.doc);
  });
});
