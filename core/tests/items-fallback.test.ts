/* S9.1 (07 §2.1–§2.2): a deck saved with charts and callouts (4.3) stays readable and editable by a 4.0 / 4.1 page.
   The 4.1 operations are frozen in fixtures/v41/ops.ts; the deck is fixtures/items-4.3.json (added, never edited). */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { applyOps as apply41 } from "./fixtures/v41/ops";
import { applyOps } from "../src/model/ops";
import { fold } from "../src/model/fold";
import type { Op, WorkbookDoc } from "../src/model/types";

const saved = (): WorkbookDoc => JSON.parse(readFileSync(new URL("./fixtures/items-4.3.json", import.meta.url), "utf8"));
const items = (d: WorkbookDoc) => d.preset!.slides.map(s => s.items);

describe("a deck with charts and callouts", () => {
  it("keeps its items through a 4.1 page's edits; the 4.1 page skips the item operations it does not know", () => {
    const doc = saved(), before = items(doc);
    const ops = [
      { op: "slide.patch", id: "s1", patch: { title: "Edited on 4.1", notes: { "t1:top": null, "t1:left": { text: "L" } } } },
      { op: "item.patch", slide: "s1", id: "c1", patch: { legend: "bottom" } },
      { op: "table.patch", id: "t1", patch: { cols: { "2": 90 } } },
      { op: "cell.patch", sheet: "S", ref: "B3", patch: { i: true } },
    ];
    const { doc: out, skipped } = apply41(doc as never, ops as never) as { doc: WorkbookDoc; skipped: number[] };
    expect(skipped).toEqual([1]);
    expect(items(out)).toEqual(before);
    expect(out.preset!.slides[1].title).toBe("Edited on 4.1");
    expect(out.edits.S).toEqual({ A2: { b: true }, B3: { i: true } });
  });
  it("this page applies the same records, item operation included, and folds them in any order", () => {
    const ops = [
      { op: "item.patch", slide: "s1", id: "c1", patch: { legend: "bottom", colors: { "1": "#00A3E0" } } },
      { op: "item.patch", slide: "s1", id: "k2", patch: null },
    ] as Op[];
    const { doc: out, skipped } = applyOps(saved(), ops);
    expect(skipped).toEqual([]);
    expect(Object.keys(out.preset!.slides[1].items!)).toEqual(["c1", "c2", "k1"]);
    expect(out.preset!.slides[1].items!.c1).toMatchObject({ legend: "bottom", colors: { "0": "#0A2A66", "1": "#00A3E0", "3": "#CC0000" } });
    const snap = { format: 4, gen: 1, workbook: "W.xlsx", lamport: 12, rev: 12, frontier: {}, doc: saved() };
    const recs = [{ w: "a", s: 1, l: 13, by: "a", at: 1, ops: [ops[0]] }, { w: "b", s: 1, l: 14, by: "b", at: 2, ops: [ops[1]] }];
    const f = fold(snap as never, recs as never), g = fold(snap as never, [...recs].reverse() as never);
    expect(f.doc.preset).toEqual(out.preset);
    expect(g.doc).toEqual(f.doc);
  });
});
