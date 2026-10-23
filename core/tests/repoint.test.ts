/* B57 (4.14): repointing references when cells move in Excel – model/datarefs.ts (refsOf, rewritePatch, the shift maths,
   the fingerprint, the checks, findBlock), model/repoint.ts (the bulk plans: an item, a slide, the deck on a sheet, a
   sheet renamed, a table with everything keyed by its cells), render/follow.ts (follow the header where the cells are
   read: the cache keys, a reload, a scenario's view), the format guard (format 10: needsV10 per key, the frozen 4.13.1
   lists reaching inside a DataRef), the inverses (one undo restores everything), the vectors (m20-repoint.json). */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOp, applyOps, docNeedsV10, emptyDoc, inverseOf, knownOp, needsV10, needsV9 } from "../src/model/ops";
import { presetSheets, runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { checkRef, following, findBlock, findHeaderRow, fingerprint, fmtA1, getAt, parseA1, refAt, refsOf, retoken, rewritePatch, shiftA1, shiftSpan, tableHeader, type RefSlot } from "../src/model/datarefs";
import { planItem, planItems, planSheet, planTable } from "../src/model/repoint";
import { bindIssue, boundItem } from "../src/render/follow";
import { seriesData, chartData } from "../src/render/chart-data";
import { chartKey } from "../src/render/chart-dl";
import { kpiData } from "../src/render/kpi-dl";
import { progressData } from "../src/render/chart-progress";
import type { RenderCtx } from "../src/render/context";
import type { ChartItem, DataRef, Item, ItemPatch, KpiItem, Op, Preset, RefBind, WorkbookDoc } from "../src/model/types";
import type { Cell, Sheet, Workbook } from "../src/xlsx/types";
import { b54Ops, kpiCard, volumeCard } from "./b54-deck";
import { achievementCard } from "./b55-deck";
import { movedB54 } from "./b57-book";
import { loadVectors } from "./vectors";

const here = path.dirname(fileURLToPath(import.meta.url));
const BOOK = path.join(here, "../../app/tests/fixtures/B54.xlsx");
const bytes = () => new Uint8Array(fs.readFileSync(BOOK));
const ab = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
const V = (range: string): DataRef => ({ sheet: "Volumes", range });
const K = (range: string): DataRef => ({ sheet: "KPI", range });
const BOX = { x: 0, y: 0, w: 600, h: 400 };
function ctxOf(wb: Workbook, preset: Preset | null = null): RenderCtx {
  return { style: resolveStyle({}, {}), edits: {}, slides: preset ? runtimeSlides(wb, preset, "B54.xlsx") : [], preset, workbook: "B54.xlsx", logoSrc: "", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null };
}
const check = (wb: Workbook) => ({ sheet: (n: string) => wb.sheets.find(s => s.name === n) || null });
/** an undo as DocSync keeps it: each op's inverse on the document before it, applied in reverse order */
function undoOf(doc: Pick<WorkbookDoc, "preset" | "style" | "edits">, ops: Op[]) {
  const work = structuredClone(doc), inv: Op[] = [];
  for (const o of ops) { const i = inverseOf(work, o); if (applyOp(work, o) && i) inv.unshift(i); }
  return { after: work, inv };
}

/* ---- refsOf covers every DataRef of an item: at the type level (a DataRef field added to ChartItem or KpiItem and not
   listed here fails tsc -p tests) and at run time (each listed path is found in a full item) ---- */
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type HasRef<V> = [Extract<V, DataRef>] extends [never] ? false : true;
/** the paths of every DataRef in T ("*": a map's entry, "#": an array's element) */
type RefPaths<T, D extends unknown[] = []> = D["length"] extends 7 ? never
  : T extends readonly (infer E)[] ? Sub<"#", E, D>
  : T extends object ? { [K in keyof T & string]-?: Sub<string extends K ? "*" : K, NonNullable<T[K]>, D> }[keyof T & string] : never;
type Sub<K extends string, V, D extends unknown[]> = HasRef<V> extends true ? K | Deeper<K, Exclude<V, DataRef>, D> : Deeper<K, V, D>;
type Deeper<K extends string, V, D extends unknown[]> = [RefPaths<V, [...D, 0]>] extends [never] ? never : `${K}.${RefPaths<V, [...D, 0]> & string}`;
/** the DataRef paths refsOf lists (`progress.cats` and `groups.*.cats` may also be names typed) */
const CHART_PATHS = ["values", "labels", "sers.*.name", "sers.*.vals.#", "sers.*.xs.#", "sers.*.target.#", "groups.*.cats",
  "axes.x.cells.min", "axes.x.cells.max", "axes.x.cells.step", "axes.y.cells.min", "axes.y.cells.max", "axes.y.cells.step", "axes.y2.cells.min", "axes.y2.cells.max", "axes.y2.cells.step",
  "marks.*.value", "marks.*.name", "filter.by", "filter.eq", "stats.*.cell", "moms.*.cell", "tag.text", "subtitle",
  "progress.vals.#", "progress.targets.#", "progress.cats", "progress.table.by", "progress.table.val", "progress.table.target"] as const;
const KPI_PATHS = ["head", "cur", "rows.#.src.cell", "rows.#.src.ref"] as const;
type _chart = Expect<Equal<RefPaths<ChartItem>, (typeof CHART_PATHS)[number]>>;
type _kpi = Expect<Equal<RefPaths<KpiItem>, (typeof KPI_PATHS)[number]>>;
/** a chart with every reference set, each to its own cell */
function fullChart(): ChartItem {
  let n = 0; const R = (): DataRef => ({ sheet: "Volumes", range: "A" + ++n });
  return { kind: "chart", type: "combo", box: BOX, values: R(), labels: R(),
    sers: { s1: { n: 1, name: R(), vals: [R(), R()], xs: [R()], target: [R()] } }, groups: { g1: { n: 1, cats: R() } },
    axes: { x: { cells: { min: R(), max: R(), step: R() } }, y: { cells: { min: R(), max: R(), step: R() } }, y2: { cells: { min: R(), max: R(), step: R() } } },
    marks: { m1: { kind: "ref", value: R(), name: R() } }, filter: { by: R(), eq: R() }, stats: { k1: { n: 1, src: "cell", cell: R() } }, moms: { k1: { n: 1, vs: "cell", cell: R() } },
    tag: { text: R() }, subtitle: R(), progress: { vals: [R()], targets: [R()], cats: R(), table: { by: R(), val: R(), target: R() } } };
}
const pattern = (p: string) => p.replace(/^(sers|groups|marks|stats|moms)\.[^.]+/, "$1.*").replace(/\.\d+(?=\.|$)/g, ".#");

describe("B57 · refsOf", () => {
  it("lists every DataRef of a chart and of a KPI card, each path once, each reference distinct, with words", () => {
    const c = fullChart(), slots = refsOf(c);
    expect([...new Set(slots.map(s => pattern(s.path)))].sort()).toEqual([...CHART_PATHS].sort());
    expect(new Set(slots.map(s => s.path)).size).toBe(slots.length);
    expect(new Set(slots.map(s => s.ref.range)).size).toBe(slots.length);              // (every reference found once)
    for (const s of slots) expect(getAt(c, s.path)).toEqual(s.ref);
    expect(slots.map(s => s.label)).toContain("Series 1 values (part 1)");
    expect(slots.map(s => s.label)).toContain("Filter column");
    const k = kpiCard(2, BOX), ks = refsOf(k);
    expect(ks.map(s => [s.path, s.label])).toEqual([["head", "KPI title"], ["cur", "KPI value"], ["rows.0.src.ref", "Row 1 “vs Bdg” reference"], ["rows.1.src.ref", "Row 2 “vs prev. Week” reference"], ["rows.2.src.ref", "Row 3 “vs EoM” reference"]]);
    expect([...new Set([...ks, ...refsOf({ ...k, rows: [{ src: { cell: K("F2") } }] })].map(s => pattern(s.path)))].sort()).toEqual([...KPI_PATHS].sort());
  });
  it("the owner's card: the budget line by its name, the stat cells; quoted cells of a callout and of a text mark", () => {
    const labels = refsOf(volumeCard("Loans", "D2", BOX, { text: "Actual loans" })).map(s => s.label);
    expect(labels).toEqual(["Values as a pie", "Category names", "Series 1 “Loans” values", "“Budget” line value", "Filter column"]);
    const shape: Item = { kind: "shape", shape: "rect", box: BOX, text: "Loans {Volumes!C5} vs {'KPI'!$B$2}" };
    expect(refsOf(shape).map(s => [s.path, refAt(s.ref)])).toEqual([["text~0", "Volumes!C5"], ["text~1", "KPI!B2"]]);
    expect(retoken("Loans {Volumes!C5} vs {'KPI'!$B$2}", 1, { sheet: "KPI new", range: "B4" })).toBe("Loans {Volumes!C5} vs {'KPI new'!B4}");
    const ch = { ...volumeCard("Loans", "D2", BOX, { text: "x" }), marks: { t: { kind: "text" as const, text: "see {Volumes!D2}", a: { s: "vol", i: 0 } } } };
    expect(refsOf(ch).filter(s => s.token).map(s => s.path)).toEqual(["marks.t.text~0"]);
    expect(refsOf({ kind: "later" } as unknown as Item)).toEqual([]);
  });
  it("presetSheets loads every sheet an item reads (a stat's cell, the subtitle's, a budget chart's – listed by refsOf)", () => {
    const c: ChartItem = { kind: "chart", type: "line", box: BOX, values: V("C2:C9"), stats: { k: { n: 1, src: "cell", cell: { sheet: "Other", range: "B2" } } }, subtitle: { sheet: "Subs", range: "A1" },
      progress: { vals: [{ sheet: "Prog", range: "C2" }] } };
    expect(presetSheets({ sheets: [], tables: [], slides: [{ id: "s", type: "content", tables: [], items: { c } }] }).sort()).toEqual(["Other", "Prog", "Subs", "Volumes"]);
  });
});

describe("B57 · rewritePatch (one item.patch, only the references named)", () => {
  it("a series' cells: its entry whole, nothing else; a KPI row: the rows whole; a bind with it; a path not there is left out", () => {
    const c = volumeCard("Loans", "D2", { x: 61, y: 340, w: 725, h: 520 }, { text: "Actual loans" });
    const p = rewritePatch(c, { "sers.vol.vals.0": V("E4:E11") }, { "sers.vol.vals.0": { at: "Volumes!E4:E11", h: "Volume_EUR_m", hr: 1 } })!;
    expect(Object.keys(p).sort()).toEqual(["bind", "sers"]);
    expect(p.sers!.vol).toEqual({ ...c.sers!.vol, vals: [V("E4:E11")] });
    const { doc } = applyOps(emptyDoc("W"), b54Ops());
    const d2 = applyOps(doc, [{ op: "item.patch", slide: "b54", id: "cl", patch: p }]).doc, it = d2.preset!.slides[0].items!.cl as ChartItem;
    expect({ ...it, sers: undefined, bind: undefined }).toEqual({ ...c, sers: undefined, bind: undefined });   // the rest kept exactly
    expect(it.sers!.vol.vals).toEqual([V("E4:E11")]);
    const k = kpiCard(3, BOX), q = rewritePatch(k, { cur: K("B5"), "rows.1.src.ref": K("D5") })!;
    expect(q).toEqual({ cur: K("B5"), rows: [k.rows![0], { ...k.rows![1], src: { ref: K("D5"), mode: "pct" } }, k.rows![2]] });
    expect(rewritePatch(k, { "sers.x.vals.0": V("A1") })).toBe(null);
    const sh: Item = { kind: "shape", shape: "rect", box: BOX, text: "{Volumes!C5} and {Volumes!C9}" };
    expect(rewritePatch(sh, { "text~1": V("E11") })).toEqual({ text: "{Volumes!C5} and {Volumes!E11}" });
    const ax = rewritePatch(fullChart(), { "axes.y.cells.max": V("Z9") })!;
    expect(Object.keys(ax)).toEqual(["axes"]); expect(Object.keys(ax.axes!)).toEqual(["y"]);
  });
});

describe("B57 · the shift maths", () => {
  it("a plain move: every cell by N; off the sheet is null", () => {
    expect(shiftA1("C2:C9", { dr: 2, dc: 0 })).toBe("C4:C11");
    expect(shiftA1("C7", { dr: 0, dc: 2 })).toBe("E7");
    expect(shiftA1("$C$2:$D$3", { dr: -1, dc: -2 })).toBe("A1:B2");
    expect(shiftA1("A1", { dr: -1, dc: 0 })).toBe(null);
    expect(shiftA1("C7:C7", { dr: 1, dc: 0 })).toBe("C8:C8");                         // (a pair stays a pair)
  });
  it("Excel's insert at a row / column: below or right of it moves, a range across it grows, above stays", () => {
    const ins = { dr: 2, dc: 0, row: 5 };
    expect(shiftA1("C2:C4", ins)).toBe("C2:C4");
    expect(shiftA1("C5:C9", ins)).toBe("C7:C11");
    expect(shiftA1("C2:C9", ins)).toBe("C2:C11");                                      // across the insertion point
    expect(shiftA1("C4", ins)).toBe("C4"); expect(shiftA1("C5", ins)).toBe("C7");
    expect(shiftA1("B:D", { dr: 0, dc: 1, col: 3 })).toBe("B:E");                      // whole columns
    expect(shiftA1("C:C", { dr: 0, dc: 1, col: 3 })).toBe("D:D");
    expect(shiftA1("5:7", ins)).toBe("7:9");                                           // whole rows
    expect(shiftA1("3:7", ins)).toBe("3:9");
    expect(shiftA1("5:7", { dr: 0, dc: 3, col: 1 })).toBe("5:7");                      // (rows: a column move leaves them)
  });
  it("Excel's delete: cells gone are null, a range across it shrinks, below moves up", () => {
    const del = { dr: -2, dc: 0, row: 5 };                                             // rows 5 and 6 deleted
    expect(shiftA1("C5:C6", del)).toBe(null);
    expect(shiftA1("C6", del)).toBe(null);
    expect(shiftA1("C2:C9", del)).toBe("C2:C7");
    expect(shiftA1("C6:C9", del)).toBe("C5:C7");
    expect(shiftA1("C7:C9", del)).toBe("C5:C7");
    expect(shiftA1("C2:C4", del)).toBe("C2:C4");
    expect(shiftSpan(3, 10, -3, 5, 100)).toEqual([3, 7]);
    expect(shiftA1("D:F", { dr: 0, dc: -2, col: 2 })).toBe("B:D");
    expect(shiftA1("not an address", del)).toBe("not an address");
  });
});

describe("B57 · fingerprint, the checks and find the block (the B54 workbook, then as saved after the move)", async () => {
  const wb = await readWorkbook(ab(bytes())), moved = await readWorkbook(ab(movedB54(bytes())));
  const vol = (w: Workbook) => w.sheets.find(s => s.name === "Volumes")!;
  it("the fingerprint: the column header above, the first category on the left; a text range's own first cell", () => {
    expect(fingerprint(vol(wb), parseA1("C2:C9")!, "num", "Volumes!C2:C9")).toEqual({ at: "Volumes!C2:C9", h: "Volume_EUR_m", hr: 1, l: "Q3", lc: 1 });
    expect(fingerprint(vol(wb), parseA1("A2:A9")!, "text", "Volumes!A2:A9")).toEqual({ at: "Volumes!A2:A9", h: "Product", hr: 1, l: "Loans" });
    expect(fingerprint(vol(wb), parseA1("C1:C9")!, "num", "x")).toEqual({ at: "x", h: "Volume_EUR_m", l: "Period", lc: 1 });   // (a range starting on its header: hr 0, unset)
    const kpi = wb.sheets.find(s => s.name === "KPI")!;
    expect(fingerprint(kpi, parseA1("B3")!, "num", "KPI!B3")).toEqual({ at: "KPI!B3", h: "Current", hr: 2, l: "Deposits", lc: 1 });
  });
  it("the checks: OK; moved (the header bound is not there); empty; text where numbers were expected; a missing sheet or table", () => {
    const slot: Pick<RefSlot, "ref" | "want"> = { ref: V("C2:C9"), want: "num" };
    const b = fingerprint(vol(wb), parseA1("C2:C9")!, "num", "Volumes!C2:C9");
    expect(checkRef(slot, check(wb), b).status).toBe("ok");
    const m = checkRef(slot, check(moved), b);
    expect(m.status).toBe("moved");
    expect(m.why).toContain("“Volume_EUR_m” is no longer at C1");
    expect(checkRef(slot, check(moved), null).status).toBe("ok");                        // (no bind: numbers – the budget's – look fine)
    expect(checkRef(slot, check(moved), { ...b, at: "Volumes!D2:D9" }).status).toBe("ok"); // (a stale bind is ignored)
    expect(checkRef({ ref: V("Z2:Z9"), want: "num" }, check(wb)).status).toBe("empty");
    expect(checkRef({ ref: V("A2:A9"), want: "num" }, check(wb)).status).toBe("text");
    expect(checkRef({ ref: { sheet: "Gone", range: "A1" }, want: "any" }, check(wb)).status).toBe("sheet");
    expect(checkRef({ ref: { sheet: "Gone", range: "A1" }, want: "any" }, { ...check(wb), exists: () => true }).status).toBe("wait");
    expect(checkRef({ ref: { table: "t9", range: "A1" }, want: "any" }, check(wb)).status).toBe("table");
    expect(checkRef({ ref: V("1A"), want: "any" }, check(wb)).status).toBe("bad");
  });
  it("find the block: the Volume column found by its header, 2 rows down and 2 columns right; the KPI value 2 rows down", () => {
    const b = fingerprint(vol(wb), parseA1("C2:C9")!, "num", "Volumes!C2:C9");
    expect(findBlock(vol(moved), parseA1("C2:C9")!, b)).toEqual({ dr: 2, dc: 2 });
    expect(findBlock(vol(wb), parseA1("C2:C9")!, b)).toEqual({ dr: 0, dc: 0 });
    const kb = fingerprint(wb.sheets.find(s => s.name === "KPI")!, parseA1("B3")!, "num", "KPI!B3");
    expect(findBlock(moved.sheets.find(s => s.name === "KPI")!, parseA1("B3")!, kb)).toEqual({ dr: 2, dc: 0 });
    expect(findBlock(vol(moved), parseA1("C2:C9")!, { h: "Nowhere", hr: 1 })).toBe(null);
    // a header twice: the one whose label agrees wins
    const lab = fingerprint(vol(wb), parseA1("D2:D9")!, "num", "Volumes!D2:D9");
    expect(findBlock(vol(moved), parseA1("D2:D9")!, lab)).toEqual({ dr: 2, dc: -1 });
    // a table's header row
    const h = tableHeader(vol(wb), parseA1("A1:D9")!);
    expect(h).toEqual(["Product", "Period", "Volume_EUR_m", "EoM_Budget_EUR_m"]);
    expect(findHeaderRow(vol(moved), parseA1("A1:D9")!, h)).toEqual({ dr: 2, dc: 0 });
  });
});

/** a sheet of these cells (text or numbers), "A1" → value */
function fakeSheet(name: string, cells: Record<string, string | number>): Sheet {
  const m = new Map<string, Cell>();
  for (const [a, v] of Object.entries(cells)) { const g = parseA1(a)!; m.set(a, { r: g.r1, c: g.c1, v, t: typeof v === "number" ? "n" : "s", fmt: "General" } as Cell); }
  const by = new Map([...m.values()].map(x => [x.r + ":" + x.c, x]));
  return { name, cells: m, get: (r: number, c: number) => by.get(r + ":" + c) || null } as unknown as Sheet;
}
describe("B57 · the same header twice (review of 35757c1, 1)", () => {
  // 2025 and 2026 under the same header "Actual"; series 2 bound to the 2026 column E, following; a column inserted at B
  const before = fakeSheet("S", { A1: "Product", C1: "Actual", E1: "Actual", A2: "Loans", C2: 10, E2: 20, A3: "Deposits", C3: 11, E3: 21 });
  const after = fakeSheet("S", { A1: "Product", D1: "Actual", F1: "Actual", A2: "Loans", D2: 10, F2: 20, A3: "Deposits", D3: 11, F3: 21 });
  const b = fingerprint(before, parseA1("E2:E3")!, "num", "S!E2:E3");
  const ctxS = (S: Sheet): RenderCtx => ({ ...ctxOf({ sheets: [S] } as unknown as Workbook), sheet: n => n === "S" ? S : null });
  const item = (): ChartItem => ({ kind: "chart", type: "column", box: BOX, values: { sheet: "S", range: "C2:C3" },
    sers: { s1: { n: 1, vals: [{ sheet: "S", range: "C2:C3" }] }, s2: { n: 2, vals: [{ sheet: "S", range: "E2:E3" }] } }, bind: { "sers.s2.vals.0": { ...b, f: true } } });
  it("the label is found by scanning left along the row (a column inserted between labels and data); both candidates agree: ambiguous", () => {
    expect(b).toEqual({ at: "S!E2:E3", h: "Actual", hr: 1, l: "Loans", lc: 4 });
    expect(findBlock(after, parseA1("E2:E3")!, b)).toEqual({ ambiguous: 2 });
    expect(findBlock(before, parseA1("E2:E3")!, b)).toEqual({ dr: 0, dc: 0 });
  });
  it("following: the stored A1 kept (never the 2025 column), and the item's issue says moved?", () => {
    const x = ctxS(after), r = boundItem(item(), x);
    expect(r.sers!.s2.vals).toEqual([{ sheet: "S", range: "E2:E3" }]);
    expect(bindIssue(item(), x)).toMatch(/Series 2 values: the cells moved\? .*“Actual” is in 2 places: not followed/);
    expect(checkRef({ ref: { sheet: "S", range: "E2:E3" }, want: "num" }, { sheet: () => after }, b).status).toBe("moved");
  });
  it("one header with that text: found wherever the column went; a label that differs alone is a note, not moved?", () => {
    const one = fakeSheet("S", { A1: "Product", D1: "Actual", A2: "Loans", D2: 10, A3: "Deposits", D3: 11 });
    const b1 = fingerprint(fakeSheet("S", { A1: "Product", C1: "Actual", A2: "Loans", C2: 10, A3: "Deposits", C3: 11 }), parseA1("C2:C3")!, "num", "S!C2:C3");
    expect(findBlock(one, parseA1("C2:C3")!, b1)).toEqual({ dr: 0, dc: 1 });
    // the same headers, the labels re-sorted: one with that header, the label advisory
    const sorted = fakeSheet("S", { A1: "Product", C1: "Actual", A2: "Deposits", C2: 11, A3: "Loans", C3: 10 });
    const c = checkRef({ ref: { sheet: "S", range: "C2:C3" }, want: "num" }, { sheet: () => sorted }, b1);
    expect(c.status).toBe("ok"); expect(c.note).toContain("“Deposits” now (it was “Loans”)");
    // two headers, the label singles one out: that one
    const two = fakeSheet("S", { A1: "Product", D1: "Actual", A2: "Loans", D2: 10, H1: "Actual", G2: "Other", H2: 5 });
    expect(findBlock(two, parseA1("C2:C3")!, b1)).toEqual({ dr: 0, dc: 1 });
  });
  it("a quoted cell of a text never follows: item.patch with such a bind is refused", () => {
    const doc = applyOps(emptyDoc("W"), [{ op: "preset.set", preset: { sheets: [], tables: [], slides: [{ id: "s", type: "content", tables: [] }] } }, { op: "item.patch", slide: "s", id: "t", patch: { kind: "shape", shape: "rect", box: BOX, text: "{S!A1}" } }] as Op[]).doc;
    const r = applyOps(doc, [{ op: "item.patch", slide: "s", id: "t", patch: { bind: { "text~0": { at: "S!A1", h: "x", f: true } } } } as Op, { op: "item.patch", slide: "s", id: "t", patch: { bind: { "text~0": { at: "S!A1", h: "x" } } } } as Op]);
    expect(r.skipped).toEqual([0]);
    expect(following({ kind: "shape", shape: "rect", box: BOX, bind: { "text~0": { f: true } } } as Item)).toEqual([]);
  });
});

describe("B57 · follow the header (render/follow.ts): read where the header is now", async () => {
  const wb = await readWorkbook(ab(bytes())), moved = await readWorkbook(ab(movedB54(bytes())));
  const card = (): ChartItem => {
    const c = volumeCard("Loans", "D2", BOX, { text: "x" });
    return { ...c, bind: { "sers.vol.vals.0": { ...fingerprint(wb.sheets[1], parseA1("C2:C9")!, "num", "Volumes!C2:C9"), f: true },
      "filter.by": { ...fingerprint(wb.sheets[1], parseA1("A2:A9")!, "text", "Volumes!A2:A9"), f: true },
      "labels": { ...fingerprint(wb.sheets[1], parseA1("B2:B9")!, "text", "Volumes!B2:B9"), f: true } } };
  };
  it("unmoved: the item itself; moved: a copy at the header's place – the same numbers, the cache key holding the new address", () => {
    const c = card(), x0 = ctxOf(wb), x1 = ctxOf(moved);
    expect(boundItem(c, x0)).toBe(c);
    const r = boundItem(c, x1);
    expect(r).not.toBe(c);
    expect(r.sers!.vol.vals).toEqual([V("E4:E11")]);
    expect(r.filter!.by).toEqual(V("A4:A11"));
    expect(r.labels).toEqual(V("B4:B11"));
    expect(r.values).toEqual(V("C2:C9"));                                               // (no bind: as stored)
    expect(boundItem(c, x1)).toBe(r);                                                    // (memoised per sheet object)
    const d0 = seriesData(c, x0), d1 = seriesData(r, x1);
    expect(d0.ok && d1.ok).toBe(true);
    if (d0.ok && d1.ok) { expect(d1.series[0].vals).toEqual(d0.series[0].vals); expect(d1.cats).toEqual(d0.cats); expect(d1.key).toContain("E4:E11"); }
    expect(chartKey(r, x1)).toContain("E4:E11");
    // without follow the moved book draws the budget's numbers
    const d2 = seriesData(c, x1);
    expect(d2.ok && d2.series[0].vals).toEqual([11790, 11790, 11790, 11790]);
    expect(d0.ok && d0.series[0].vals).toEqual([11576, 11411, 13000, 12000]);
  });
  it("a column moved only (no rows inserted): the values follow; the stored A1 stays the fallback when the header is nowhere", async () => {
    const colOnly = await readWorkbook(ab(movedB54(bytes(), { rows: 0 })));
    expect(boundItem(card(), ctxOf(colOnly)).sers!.vol.vals).toEqual([V("E2:E9")]);
    const lost = { ...card(), bind: { "sers.vol.vals.0": { at: "Volumes!C2:C9", h: "Nowhere", hr: 1, f: true } } } as ChartItem;
    expect(boundItem(lost, ctxOf(moved))).toBe(lost);
    expect(bindIssue(lost, ctxOf(moved))).toContain("“Nowhere” is no longer at C1");
    expect(bindIssue(card(), ctxOf(moved))).toBe(null);                                 // (following: found, nothing to say)
    const still = { ...card(), bind: { "sers.vol.vals.0": { ...card().bind!["sers.vol.vals.0"], f: undefined } } } as ChartItem;
    expect(bindIssue(still, ctxOf(moved))).toContain("Series 1 “Loans” values: the cells moved?");
  });
  it("a scenario's view (another sheet object) and a reload resolve again; a KPI card and a budget chart follow too", async () => {
    const c = card(), x1 = ctxOf(moved), view = Object.create(moved.sheets[1]);
    const xs: RenderCtx = { ...x1, sheet: n => n === "Volumes" ? view : x1.sheet!(n) };
    const a = boundItem(c, x1), b = boundItem(c, xs);
    expect(b).not.toBe(a); expect(b.sers!.vol.vals).toEqual(a.sers!.vol.vals);
    expect(boundItem(c, x1)).toBe(a); expect(boundItem(c, xs)).toBe(b);              // (a few views at once: Run for each value)
    const reloaded = await readWorkbook(ab(movedB54(bytes())));
    expect(boundItem(c, ctxOf(reloaded))).not.toBe(a);
    const k: KpiItem = { ...kpiCard(3, BOX), bind: { cur: { ...fingerprint(wb.sheets[0], parseA1("B3")!, "num", "KPI!B3"), f: true } } };
    const kr = boundItem(k, x1);
    expect(kr.cur).toEqual(K("B5"));
    expect(kpiData(kr, x1).value).toBe(kpiData(k, ctxOf(wb)).value);
    const p = achievementCard(BOX), pb: ChartItem = { ...p, bind: { "progress.table.val": { ...fingerprint(wb.sheets[1], parseA1("C2:C9")!, "num", "Volumes!C2:C9"), f: true },
      "progress.table.target": { ...fingerprint(wb.sheets[1], parseA1("D2:D9")!, "num", "Volumes!D2:D9"), f: true },
      "progress.table.by": { ...fingerprint(wb.sheets[1], parseA1("A2:A9")!, "text", "Volumes!A2:A9"), f: true } } };
    const pr = boundItem(pb, x1), d0 = progressData(p, ctxOf(wb)), d1 = progressData(pr, x1);
    expect(pr.progress!.table).toEqual({ by: V("A4:A11"), val: V("E4:E11"), target: V("C4:C11") });
    expect(d1.ok && d0.ok && d1.rows.map(r => [r.v, r.t])).toEqual(d0.ok && d0.rows.map(r => [r.v, r.t]));
    const pie: ChartItem = { kind: "chart", type: "pie", box: BOX, values: V("C2:C5"), bind: { values: { ...fingerprint(wb.sheets[1], parseA1("C2:C5")!, "num", "Volumes!C2:C5"), f: true } } };
    expect(chartData(boundItem(pie, x1), x1)).toMatchObject({ ok: true, source: "Volumes!E4:E7" });
  });
});

describe("B57 · format 10 (needsV10 per key; the frozen 4.13.1 lists)", () => {
  const P = (patch: unknown): Op => ({ op: "item.patch", slide: "s", id: "c", patch } as unknown as Op);
  it("an item's bind is format 10, its removal is not; a table's sheet, range or bind is, its 4.13 keys are not", () => {
    expect(needsV10(P({ bind: { values: { at: "S!A1", h: "x" } } }))).toBe(true);
    expect(needsV10(P({ bind: { values: { f: true } } }))).toBe(true);
    expect(needsV10(P({ bind: { values: null } }))).toBe(false);
    expect(needsV10(P({ bind: null }))).toBe(false);
    expect(needsV9(P({ bind: { values: { f: true } } }))).toBe(true);                 // (and every lower format's guard)
    const T = (patch: unknown): Op => ({ op: "table.patch", id: "t", patch } as unknown as Op);
    expect(needsV10(T({ range: "C4:F12" }))).toBe(true);
    expect(needsV10(T({ sheet: "New" }))).toBe(true);
    expect(needsV10(T({ bind: { at: "A1:B2", h: ["a"] } }))).toBe(true);
    expect(needsV10(T({ bind: null }))).toBe(false);
    expect(needsV10(T({ cols: { 3: 80 }, name: "x", cellGrid: {}, borders: {} }))).toBe(false);
    expect(needsV10({ op: "table.add", table: { id: "t", sheet: "S", kind: "range", range: "A1:B2", bind: { at: "A1:B2", h: ["a"] } }, slide: "s" } as unknown as Op)).toBe(true);
    expect(needsV10({ op: "table.add", table: { id: "t", sheet: "S", kind: "range", range: "A1:B2" }, slide: "s" } as unknown as Op)).toBe(false);
    const doc = { preset: { sheets: [], tables: [{ id: "t", sheet: "S", kind: "range", range: "A1", bind: { at: "A1", h: [] } }], slides: [] }, edits: {} } as unknown as WorkbookDoc;
    expect(docNeedsV10(doc)).toBe(true);
    for (const o of [P({ bind: { a: { f: true } } }), T({ range: "A1" }), T({ sheet: "x", bind: null })]) expect(knownOp(o)).toBe(true);
  });
  it("a new key INSIDE a DataRef anywhere in an item is format 10 (V4131_INSIDE reaches every nested reference)", () => {
    const X = { sheet: "S", range: "A1", follow: true };
    const later: [string, unknown][] = [["values", { values: X }], ["labels", { labels: X }], ["series vals", { sers: { s: { n: 1, vals: [X] } } }], ["series name", { sers: { s: { n: 1, name: X, vals: [] } } }],
      ["series xs", { sers: { s: { n: 1, vals: [], xs: [X] } } }], ["series target", { sers: { s: { n: 1, vals: [], target: [X] } } }], ["group cats", { groups: { g: { n: 1, cats: X } } }],
      ["mark value", { marks: { m: { kind: "ref", value: X } } }], ["mark name", { marks: { m: { kind: "ref", name: X } } }], ["axis cell", { axes: { y: { cells: { min: X } } } }],
      ["filter by", { filter: { by: X, eq: "a" } }], ["filter eq", { filter: { by: { sheet: "S", range: "A1" }, eq: X } }], ["stat cell", { stats: { k: { n: 1, src: "cell", cell: X } } }],
      ["momentum cell", { moms: { k: { n: 1, vs: "cell", cell: X } } }], ["tag", { tag: { text: X } }], ["KPI head", { head: X }], ["KPI value", { cur: X }],
      ["KPI row cell", { rows: [{ src: { cell: X } }] }], ["KPI row ref", { rows: [{ src: { ref: X, mode: "pct" } }] }]];
    for (const [what, p] of later) expect(needsV10(P(p)), what).toBe(true);
    // (the plain DataRef: 4.13.1's own – not format 10)
    for (const [what, p] of later) expect(needsV10(P(JSON.parse(JSON.stringify(p).replace(/,"follow":true/g, "")))), what).toBe(false);
  });
});

describe("B57 · bulk plans and their undo", async () => {
  const wb = await readWorkbook(ab(bytes()));
  it("the item: every reference by N rows (its own move) – one item.patch, binds following; undo restores it", () => {
    const { doc } = applyOps(emptyDoc("W"), b54Ops());
    const it = doc.preset!.slides[0].items!.cl as ChartItem;
    const fp = (ref: DataRef, want: RefSlot["want"]): RefBind => ({ at: refAt(ref), h: want + "!" });
    const r = planItem(doc, "b54", "cl", it, { kind: "shift", s: { dr: 2, dc: 0 }, sheet: null }, { fp, where: "Slide 1" });
    expect(r.rows.map(x => [x.what, x.from, x.to])).toEqual([["Values as a pie", "Volumes!C2:C9", "Volumes!C4:C11"], ["Category names", "Volumes!B2:B9", "Volumes!B4:B11"],
      ["Series 1 “Loans” values", "Volumes!C2:C9", "Volumes!C4:C11"], ["“Budget” line value", "Volumes!D2", "Volumes!D4"], ["Filter column", "Volumes!A2:A9", "Volumes!A4:A11"]]);
    const { after, inv } = undoOf(doc, [r.op!]);
    const moved = after.preset!.slides[0].items!.cl as ChartItem;
    expect(moved.marks!.r1).toEqual({ ...it.marks!.r1, value: V("D4") });
    expect(moved.bind!["filter.by"]).toEqual({ at: "Volumes!A4:A11", h: "text!" });
    expect({ ...moved, values: 0, labels: 0, sers: 0, marks: 0, filter: 0, bind: 0 }).toEqual({ ...it, values: 0, labels: 0, sers: 0, marks: 0, filter: 0, bind: 0 });
    expect(applyOps(after, inv).doc).toEqual(applyOps(doc, []).doc);
  });
  it("a slide's or the deck's items on one sheet; Change sheet (a renamed sheet) – references of other sheets stay", () => {
    const { doc } = applyOps(emptyDoc("W"), b54Ops());
    const p = planItems(doc, { kind: "shift", s: { dr: 2, dc: 0 }, sheet: "KPI" });
    expect(p.ops.map(o => (o as { id: string }).id)).toEqual(["k1", "k2", "k3", "k4"]);
    expect(p.rows.every(r => r.from.startsWith("KPI!"))).toBe(true);
    const s = planItems(doc, { kind: "sheet", from: "Volumes", to: "Volumes (2)" }, { slides: ["b54"] });
    const after = applyOps(doc, s.ops).doc;
    expect(refsOf(after.preset!.slides[0].items!.cd).map(x => refAt(x.ref))).toEqual(refsOf(doc.preset!.slides[0].items!.cd).map(x => refAt(x.ref).replace("Volumes!", "Volumes (2)!")));
    expect(refsOf(after.preset!.slides[0].items!.k1).map(x => refAt(x.ref))).toEqual(refsOf(doc.preset!.slides[0].items!.k1).map(x => refAt(x.ref)));
    expect(planItems(doc, { kind: "sheet", from: "Nope", to: "x" }).ops).toEqual([]);
  });
  it("a table moved by N rows: its range, widths / heights (per design too), merges, scales, gridlines, borders, hidden rows and columns, cell edits, versions and the charts reading it move with it; undo restores all", () => {
    const preset: Preset = { sheets: ["Volumes"], tables: [{ id: "t1", sheet: "Volumes", kind: "range", range: "A1:D9", cols: { 3: 90 }, rows: { 2: 30, 9: 25 },
      sizes: { glass: { cols: { 3: 100 }, rows: { 5: 40 } } }, merges: { "A2:A5": "merge" }, scales: { s1: { range: "C2:C9", dir: "col", mode: "minmax", fill: true, ink: false } },
      cellGrid: { C3: { h: "on" } }, borders: { D4: { top: "none" } }, bind: { at: "A1:D9", h: ["Product", "Period", "Volume_EUR_m", "EoM_Budget_EUR_m"] } },
    { id: "t2", sheet: "Volumes", kind: "range", range: "F1:G3" }],
      slides: [{ id: "s1", type: "content", tables: ["t1", "t2"], hidden: { "t1:r4": true, "t1:cB": true, "t2:r2": true },
        items: { c1: { kind: "chart", type: "pie", box: BOX, values: { table: "t1", range: "C2:C5" } }, c2: { kind: "chart", type: "pie", box: BOX, values: V("C6:C9") }, c3: { kind: "chart", type: "pie", box: BOX, values: V("F2:F3") } } }],
      versions: [{ id: "v1", name: "Chief", hide: { Volumes: ["C5:D6", "G2"] }, drop: { Volumes: ["3:4", "B", "F:G"] } }] };
    const doc = { preset, style: {}, edits: { Volumes: { C3: { bg: "#FFFF00" }, B7: { text: "x", orig: "W37" }, F2: { b: true } }, KPI: { A1: { b: true } } } } as unknown as WorkbookDoc;
    const plan = planTable(doc, "t1", { kind: "shift", s: { dr: 2, dc: 0 }, sheet: null });
    const { after, inv } = undoOf(doc, plan.ops);
    const t = after.preset!.tables[0];
    expect(t).toMatchObject({ range: "A3:D11", cols: { 3: 90 }, rows: { 4: 30, 11: 25 }, sizes: { glass: { cols: { 3: 100 }, rows: { 7: 40 } } }, merges: { "A4:A7": "merge" },
      cellGrid: { C5: { h: "on" } }, borders: { D6: { top: "none" } }, bind: { at: "A3:D11" } });
    expect(t.scales!.s1.range).toBe("C4:C11");
    expect(after.preset!.tables[1]).toEqual(preset.tables[1]);                          // (the other table stays)
    expect(after.preset!.slides[0].hidden).toEqual({ "t1:r6": true, "t1:cB": true, "t2:r2": true });
    expect(after.edits).toEqual({ Volumes: { C5: { bg: "#FFFF00" }, B9: { text: "x", orig: "W37" }, F2: { b: true } }, KPI: { A1: { b: true } } });
    // (an entry inside the table moves with it; whole rows / columns reach beyond it – other tables of the sheet: left, said)
    expect(after.preset!.versions![0]).toEqual({ id: "v1", name: "Chief", hide: { Volumes: ["C7:D8", "G2"] }, drop: { Volumes: ["3:4", "B", "F:G"] } });
    const items = after.preset!.slides[0].items!;
    expect([(items.c1 as ChartItem).values, (items.c2 as ChartItem).values, (items.c3 as ChartItem).values]).toEqual([{ table: "t1", range: "C4:C7" }, V("C8:C11"), V("F2:F3")]);
    expect(plan.rows.map(r => [r.what, r.from, r.to])).toEqual([["Table cells", "Volumes!A1:D9", "Volumes!A3:D11"], ["Values", "Volumes!C2:C5", "Volumes!C4:C7"], ["Values", "Volumes!C6:C9", "Volumes!C8:C11"]]);
    expect(plan.notes.join(" | ")).toMatch(/move with it.*2 cell edits move.*1 version.*2 version entries .*reach beyond the table: left as they are/);
    expect(applyOps(after, inv).doc).toEqual(applyOps(doc, []).doc);                  // one undo: everything back
    // a range the move would push off the sheet: nothing moves
    expect(planTable(doc, "t1", { kind: "shift", s: { dr: -1, dc: 0 }, sheet: null }).ops).toEqual([]);
    // Change sheet: the table, its cells' edits and the versions' entries touching it go to the new sheet
    const s = planTable(doc, "t1", { kind: "sheet", from: "Volumes", to: "Vol2" });
    const a2 = undoOf(doc, s.ops);
    expect(a2.after.preset!.tables[0]).toMatchObject({ sheet: "Vol2", range: "A1:D9", merges: { "A2:A5": "merge" } });
    expect(a2.after.edits).toEqual({ Volumes: { F2: { b: true } }, Vol2: { C3: { bg: "#FFFF00" }, B7: { text: "x", orig: "W37" } }, KPI: { A1: { b: true } } });
    expect(a2.after.preset!.versions![0].hide).toEqual({ Volumes: ["G2"], Vol2: ["C5:D6"] });
    expect(a2.after.preset!.versions![0].drop).toEqual({ Volumes: ["3:4", "B", "F:G"] });            // (beyond the table: stay)
    expect((a2.after.preset!.slides[0].items!.c2 as ChartItem).values).toEqual({ sheet: "Vol2", range: "C6:C9" });
    expect((a2.after.preset!.slides[0].items!.c1 as ChartItem).values).toEqual({ table: "t1", range: "C2:C5" });
    expect(applyOps(a2.after, a2.inv).doc).toEqual(applyOps(doc, []).doc);
    // Excel's insert at row 5 on the whole sheet: rows above stay, the table grows across it
    const ins = planSheet(doc, { kind: "shift", s: { dr: 2, dc: 0, row: 5 }, sheet: "Volumes" });
    const a3 = undoOf(doc, ins.ops);
    expect(a3.after.preset!.tables.map(x => x.kind === "range" ? x.range : "")).toEqual(["A1:D11", "F1:G3"]);
    expect(a3.after.edits.Volumes).toEqual({ C3: { bg: "#FFFF00" }, B9: { text: "x", orig: "W37" }, F2: { b: true } });
    expect(a3.after.preset!.slides[0].hidden).toEqual({ "t1:r4": true, "t1:cB": true, "t2:r2": true });
    expect(a3.after.preset!.versions![0].drop).toEqual({ Volumes: ["3:4", "B", "F:G"] });
    expect(a3.after.preset!.versions![0].hide).toEqual({ Volumes: ["C7:D8", "G2"] });
    expect(applyOps(a3.after, a3.inv).doc).toEqual(applyOps(doc, []).doc);
    // the whole sheet renamed: everything named by it
    const ren = planSheet(doc, { kind: "sheet", from: "Volumes", to: "Vol2" });
    const a4 = applyOps(doc, ren.ops).doc;
    expect(a4.preset!.tables.map(x => x.sheet)).toEqual(["Vol2", "Vol2"]);
    expect(Object.keys(a4.edits).sort()).toEqual(["KPI", "Vol2"]);
    expect(a4.preset!.versions![0]).toEqual({ id: "v1", name: "Chief", hide: { Vol2: ["C5:D6", "G2"] }, drop: { Vol2: ["3:4", "B", "F:G"] } });
  });
  it("a markers table: its range is found by its markers – its settings move by N; its sheet's cells inside it with it", () => {
    const preset: Preset = { sheets: ["Volumes"], tables: [{ id: "m", sheet: "Volumes", kind: "markers", anchor: "A1", index: 0, cols: { 2: 50 } }], slides: [{ id: "s", type: "content", tables: ["m"], hidden: { "m:r3": true } }] };
    const doc = { preset, style: {}, edits: {} } as unknown as WorkbookDoc;
    const p = planTable(doc, "m", { kind: "shift", s: { dr: 1, dc: 0 }, sheet: null }, { rect: parseA1("A1:D9") });
    const a = applyOps(doc, p.ops).doc;
    expect(a.preset!.tables[0]).toEqual({ ...preset.tables[0], cols: { 2: 50 } });
    expect(a.preset!.slides[0].hidden).toEqual({ "m:r4": true });
    expect(p.rows[0].what).toBe("Table settings (found by its x markers)");
    // its rectangle not known: no cell edit nor version entry of the sheet is its own (review of 35757c1, 3)
    const d2 = { preset: { ...preset, versions: [{ id: "v", name: "V", hide: { Volumes: ["Z50:Z60"] } }] }, style: {}, edits: { Volumes: { Z100: { b: true }, A1: { b: true } } } } as unknown as WorkbookDoc;
    const p2 = planTable(d2, "m", { kind: "shift", s: { dr: 1, dc: 0 }, sheet: null });
    expect(p2.ops.filter(o => o.op === "cell.patch" || o.op === "version.patch")).toEqual([]);
    expect(p2.notes.join(" ")).toContain("cells are not known");
    const a2 = applyOps(d2, p2.ops).doc;
    expect([a2.edits, a2.preset!.versions]).toEqual([d2.edits, d2.preset!.versions]);
  });
  it("a table's range: table.patch applies a sheet and a range, never a bad one or a removal; inverse back", () => {
    const doc = { preset: { sheets: [], tables: [{ id: "t", sheet: "S", kind: "range", range: "A1:B2" }, { id: "m", sheet: "S", kind: "markers", anchor: "A1", index: 0 }], slides: [] }, style: {}, edits: {} } as unknown as WorkbookDoc;
    const T = (id: string, patch: unknown): Op => ({ op: "table.patch", id, patch } as unknown as Op);
    const ok = T("t", { sheet: "S2", range: "C3:D4" });
    const inv = inverseOf(doc, ok);
    expect(inv).toEqual(T("t", { sheet: "S", range: "A1:B2" }));
    const d = applyOps(doc, [ok, T("t", { range: null }), T("t", { sheet: "" }), T("t", { range: "Z" }), T("m", { range: "A1:B2" }), T("t", { bind: { at: 1 } })]);
    expect(d.skipped).toEqual([1, 2, 3, 4, 5]);
    expect(d.doc.preset!.tables[0]).toEqual({ id: "t", sheet: "S2", kind: "range", range: "C3:D4" });
    expect(applyOps(d.doc, [inv!]).doc.preset!.tables[0]).toEqual(doc.preset!.tables[0]);
  });
  it("the runtime slide follows a table's new range (its layout is read from it)", () => {
    const preset: Preset = { sheets: ["Volumes"], tables: [{ id: "t", sheet: "Volumes", kind: "range", range: "A1:D9" }], slides: [{ id: "s", type: "content", tables: ["t"] }] };
    const after = applyOps({ ...emptyDoc("W"), preset }, [{ op: "table.patch", id: "t", patch: { range: "A3:D11" } } as Op]).doc;
    const L = runtimeSlides(wb, after.preset, "B54.xlsx")[0].tables[0];
    expect([L.g.r1 + 1, L.g.r2 - 1]).toEqual([3, 11]);
    expect(fmtA1({ r1: 3, c1: 1, r2: 11, c2: 4 })).toBe("A3:D11");
  });
});

describe("B57 · vectors (shared/ops-vectors.d/m20-repoint.json)", () => {
  it("are there, and every op of them is known and format 10 when it writes a B57 key", () => {
    const vs = loadVectors().filter(v => /^B57 /.test(v.name));
    expect(vs.length).toBeGreaterThanOrEqual(3);
    for (const v of vs) for (const o of v.ops) expect(knownOp(o)).toBe(true);
    const ops = vs.flatMap(v => v.ops as Op[]);
    expect(ops.some(o => o.op === "table.patch" && needsV10(o))).toBe(true);
    expect(ops.some(o => o.op === "item.patch" && needsV10(o))).toBe(true);
  });
});
// (the type-level checks are compile-time only)
export type _checks = [_chart, _kpi, ItemPatch];
