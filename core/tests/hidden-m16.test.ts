/* Hidden rows and columns per slide (S16.1, B36, docs/next/09 §2.5 / §3.6; HR-01, HR-02): the slide.patch map `hidden`
   ("<tableId>:r<row>" / "<tableId>:c<COL>") and the one mechanism behind it – buildLayout closes the set up as Excel's
   hidden rows – with a version's `drop` (S16.2's input, owned here) as the same set:
   * the op: shared/ops-vectors.d/m16-hidden.json (+ needsV5 / docNeedsV5 per case), knownOp, the saved deck
     fixtures/saved/hidden-4.9.json (two writers, folded in any order);
   * the layout: rows / columns closed up on that slide only, merges lose them, sizes follow, a set that would empty the
     table is not applied, the layout and table keys miss where the set changed, the cache stays bounded;
   * what reads the layout: borders / cell gridlines, the automated comment's grid, charts on the same slide (Q7);
   * every design's display list and the PowerPoint export (an a:tbl of the visible rows only, where the display list
     draws it), the PDF of the same deck. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { loadVectors } from "./vectors";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOp, applyOps, docNeedsV5, emptyDoc, inverseOf, knownOp, needsV5 } from "../src/model/ops";
import { fold, nextSnapshot } from "../src/model/fold";
import { HMARK, LCACHE, resolveTable, runtimeSlides } from "../src/model/preset";
import { dropHidden, hiddenEntries, hiddenKey, hideFor, hideKey, parseHiddenKey, slideHidden } from "../src/model/hidden";
import { resolveStyle } from "../src/model/style";
import { tableKey, type RenderCtx } from "../src/render/context";
import { gridOf } from "../src/render/comment";
import { effItems } from "../src/render/edits";
import { chartData, chartKey } from "../src/render/chart-dl";
import { E } from "../src/pptx/drawingml";
import { Port, pair, transfer } from "../src/rpc/port";
import { serve } from "../src/worker/host";
import { ExportHost, type ExportCorePort, type ExportPort } from "../src/worker/export-host";
import { FakeDeck } from "./fakedeck";
import type { CoreEvents, CoreMethods, ExportJob, ExportMethods, ExportPageMethods, PageEvents, PageMethods, SlideList } from "../src/rpc/messages";
import type { ChartItem, Design, Op, Preset } from "../src/model/types";
import type { Workbook } from "../src/xlsx/types";
import type { Node } from "../src/dl/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const DECKS = path.join(here, "../../tests/corpus/decks"), BOOKS = path.join(here, "../../tests/corpus/workbooks");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const DESIGNS: Design[] = ["glass", "excel", "clean", "mckinsey", "bain"];
const TODAY = "1 October 2026";
/** SB_PPTX_OUT=<folder>: the files made here are written there too (for tools/pptxcheck.py and for opening in PowerPoint) */
const OUT = process.env.SB_PPTX_OUT || "";
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const keep = (name: string, b: ArrayBuffer | Uint8Array) => { if (OUT) fs.writeFileSync(path.join(OUT, name), new Uint8Array(b)); };

/* ---- report.xlsx: SLIDE_1's table dhnms9c (rows 4-19 but 9, Excel-hidden; columns C-J but H; a merge D5:J5) on two
   slides, the pair of SLIDE_3 on a third ---- */
const REPORT = JSON.parse(fs.readFileSync(path.join(DECKS, "report.json"), "utf8")) as { workbook: string; ops: Op[] };
const BASE = (REPORT.ops[0] as Extract<Op, { op: "preset.set" }>).preset as Preset;
const T = "dhnms9c";
const preset = (): Preset => {
  const p = structuredClone(BASE);
  p.slides = [{ ...p.slides[0], id: "s1", title: "Loans" }, { id: "s2", type: "content", title: "Loans, every bank", tables: [T] }, { ...p.slides[1], id: "s3", title: "Pair" }];
  return p;
};
const hide = (slide: string, h: Record<string, true | null> | null): Op => ({ op: "slide.patch", id: slide, patch: { hidden: h } } as Op);
let WB: Workbook | null = null;
const book = async () => WB || (WB = await readWorkbook(ab(path.join(BOOKS, REPORT.workbook))));
const ctxOf = (wb: Workbook, p: Preset, design: Design = "excel", extra: Partial<RenderCtx> = {}): RenderCtx => {
  const slides = runtimeSlides(wb, p, "W.xlsx", design);
  return { style: resolveStyle({}, { design }), edits: {}, slides, preset: p, workbook: "W.xlsx", logoSrc: "", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null, ...extra };
};
const textAt = (L: { items: { b: { r: number; c: number }; text: string }[] }, r: number, c: number) => L.items.find(i => i.b.r === r && i.b.c === c)?.text;

describe("the op: slide.patch map `hidden` (shared/ops-vectors.d/m16-hidden.json)", () => {
  const mine = loadVectors().filter(v => /^(slide\.patch hidden|fold: .*\(S16\.1\))/.test(v.name));
  it("the file has its cases, and the runner reads them (ops.test.ts runs every case)", () => {
    expect(mine.length).toBe(9);
  });
  for (const v of mine.filter(x => !x.fold)) it(v.name + " – known, format 5 (needsV5 / docNeedsV5)", () => {
    for (const op of v.ops) expect(knownOp(op), JSON.stringify(op)).toBe(true);
    expect(v.ops.map((op: Op) => needsV5(op))).toEqual(v.expect.needsV5);
    const { doc } = applyOps(v.doc, v.ops);
    expect(docNeedsV5(doc)).toBe(v.expect.docNeedsV5);
    // undo: the inverses in reverse order give the document back
    const d = structuredClone(v.doc), inv: Op[] = [];
    for (const op of v.ops) { const i = inverseOf(d, op); if (i) inv.unshift(i); applyOp(d, op); }
    for (const i of inv) applyOp(d, i);
    expect(d.preset).toEqual(v.doc.preset);
  });
  it("the keys: a row by its number, a column by its letters; anything else is not a key", () => {
    expect(hiddenKey("t3", "r", 12)).toBe("t3:r12");
    expect(hiddenKey("t3", "c", 5)).toBe("t3:cE");
    expect(hiddenKey("t3", "c", 28)).toBe("t3:cAB");
    expect(parseHiddenKey("t3:r12")).toEqual({ table: "t3", kind: "r", n: 12 });
    expect(parseHiddenKey("t3:cAB")).toEqual({ table: "t3", kind: "c", n: 28 });
    for (const k of ["t3", "t3:r0", "t3:x1", ":r1", "t3:c5", "t3:rE", "t3:r12a"]) expect(parseHiddenKey(k), k).toBeNull();
    expect(hiddenEntries({ hidden: { "a:r1": true, "a:cB": true, "b:r1": true } }, "a")).toEqual(["a:r1", "a:cB"]);
    const h = slideHidden({ hidden: { "a:r1": true, "a:cB": true, "b:r3": true, "a:zz": true } }, "a");
    expect([[...h.rows], [...h.cols]]).toEqual([[1], [2]]);
  });
  it("a version's drop (S16.2's input): rows \"5:7\" / \"5\", columns \"C:D\" / \"C\"; others skipped; joined with the slide's", () => {
    const h = dropHidden(["5:7", "9", "c:d", "F", "x1", "", 3, "7:5", "B:7"]);
    expect([[...h.rows].sort((a, b) => a - b), [...h.cols].sort((a, b) => a - b)]).toEqual([[5, 6, 7, 9], [3, 4, 6]]);
    const j = hideFor({ hidden: { "t:r12": true } }, "t", "S", { S: ["3"], O: ["4"] });
    expect(hideKey(j)).toBe("r3,12c");
    expect(hideKey(hideFor(null, "t", "S", null))).toBe("");
  });
});

describe("a deck saved by 4.9 with hidden rows (fixtures/saved/hidden-4.9.json, added, never edited)", () => {
  it("two writers' records fold in any order; each slide keeps its own set; a 4.9 page compacts them; format 5; the layouts follow", async () => {
    const saved = JSON.parse(fs.readFileSync(path.join(here, "fixtures", "saved", "hidden-4.9.json"), "utf8"));
    const { snapshot: snap, records: recs } = saved as { snapshot: any; records: any[] };
    expect(recs.every(r => r.ops.every(knownOp))).toBe(true);
    expect(recs.every(r => r.ops.some(needsV5))).toBe(true);
    const f = fold(snap, recs), p = f.doc.preset!;
    expect([f.doc.rev, f.lamport, f.doc.updatedBy]).toEqual([10, 11, "bob"]);
    expect(fold(snap, [...recs].reverse()).doc).toEqual(f.doc);
    expect(fold(snap, [...recs.slice(4), ...recs.slice(0, 4)]).doc).toEqual(f.doc);
    expect(p.slides.map(s => s.hidden)).toEqual([{ [T + ":r7"]: true, [T + ":cE"]: true, [T + ":r10"]: true }, { [T + ":r12"]: true }, { "ybyk4v2:r6": true, "62de08x:cJ": true }]);
    const next = nextSnapshot(snap, f, {});
    expect(next.format).toBe(5);
    expect(next.doc.preset).toEqual(p);
    expect(docNeedsV5(next.doc)).toBe(true);
    const wb = await book(), [a, b, c] = runtimeSlides(wb, p, "report.xlsx", "excel");
    expect(a.tables[0].rows).toEqual([4, 5, 6, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(a.tables[0].cols).toEqual([3, 4, 6, 7, 9, 10]);
    expect(b.tables[0].rows).toEqual([4, 5, 6, 7, 8, 10, 11, 13, 14, 15, 16, 17, 18, 19]);
    expect(c.tables.map(L => [L.rows.length, L.cols.length])).toEqual([[6, 3], [10, 3]]);
  });
});

describe("the layout (HR-01, HR-02): closed up on that slide only", () => {
  it("rows and columns of the slide's set are closed up as Excel's hidden ones; the other slide and the shared layout keep them", async () => {
    const wb = await book(), p = preset();
    applyOp({ preset: p, style: {}, edits: {} }, hide("s1", { [T + ":r7"]: true, [T + ":cE"]: true }));
    const [a, b] = runtimeSlides(wb, p, "W.xlsx", "excel"), A = a.tables[0], B = b.tables[0], S = wb.sheets.find(s => s.name === "SLIDE_1")!;
    expect(A.rows).not.toContain(7);
    expect(A.cols).not.toContain(5);
    expect(B.rows).toContain(7);
    expect(B.cols).toContain(5);
    expect(S.tables[0].rows).toContain(7);                         // the shared "x" layout is never changed
    expect([A.hiddenRows, A.hiddenCols]).toEqual([B.hiddenRows + 1, B.hiddenCols + 1]);
    expect(A.H).toBeCloseTo(B.H - B.rowH.get(7)!, 5);
    expect(A.W).toBeCloseTo(B.W - B.colW.get(5)!, 5);
    // the rows below move up by the hidden row's height; no item of the hidden row or column is left
    expect(A.rowY.get(8)).toBeCloseTo(B.rowY.get(8)! - B.rowH.get(7)!, 5);
    expect(A.items.some(i => i.b.r === 7 || i.b.c === 5)).toBe(false);
    expect(textAt(A, 8, 3)).toBe("Gamma");
    expect(textAt(B, 7, 3)).toBe("Beta");
    expect(A.hide).toBe("r7c5");
    expect(B.hide).toBeUndefined();
  });
  it("a merge loses its hidden rows and columns (Excel's behaviour); a hidden row the merge spans whole takes it away", async () => {
    const wb = await book(), p = preset();
    const at = (h: Record<string, true>) => { const q = structuredClone(p); q.slides[0].hidden = h; return runtimeSlides(wb, q, "W", "excel")[0].tables[0]; };
    // the merge C5:J5 without its first column C: from D, its value still the merge's top-left cell's
    const D = at({ [T + ":cC"]: true }), box = D.items.find(i => i.merged)!;
    expect([box.b.r, box.b.c, box.b.r2, box.b.c2]).toEqual([5, 4, 5, 10]);
    expect(box.b.src).toEqual({ r: 5, c: 3 });
    expect(at({ [T + ":r5"]: true }).items.some(i => i.merged)).toBe(false);
  });
  it("the table's own sizes and the slide's set together; a set that would leave no row is not applied (the table stays)", async () => {
    const wb = await book(), p = preset();
    p.tables[0].sizes = { excel: { rows: { 8: 40 } } };
    p.slides[0].hidden = { [T + ":r7"]: true };
    const A = runtimeSlides(wb, p, "W", "excel")[0].tables[0];
    expect(A.rowH.get(8)).toBe(40);
    expect(A.rows).not.toContain(7);
    const all = Object.fromEntries([4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map(r => [T + ":r" + r, true])) as Record<string, true>;
    p.slides[0].hidden = all;
    const Z = runtimeSlides(wb, p, "W", "excel")[0];
    expect(Z.tables).toHaveLength(1);
    expect(Z.tables[0].rows.length).toBe(15);
    expect(Z.tables[0].hide).toBeUndefined();
  });
  it("two writers who each hide all but one row empty the table together: the version's drop still applies, then nothing (review 1)", async () => {
    const wb = await book(), saved = JSON.parse(fs.readFileSync(path.join(here, "fixtures", "saved", "hidden-4.9.json"), "utf8"));
    const snap = structuredClone(saved.snapshot), p0 = preset();
    snap.doc.preset = p0;
    const shown = [4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];       // (9 is hidden in Excel)
    const keys = (rows: number[]) => Object.fromEntries(rows.map(r => [T + ":r" + r, true])) as Record<string, true>;
    // each writer's own check (hideSel) passes: one row is left on their screen
    const recs = [
      { l: 20, w: "cara@pc3#cccccccc", s: 1, by: "cara", at: 1792000100000, ops: [hide("s1", keys(shown.filter(r => r !== 19)))] },
      { l: 20, w: "dan@pc4#dddddddd", s: 1, by: "dan", at: 1792000100001, ops: [hide("s1", keys(shown.filter(r => r !== 4)))] }];
    const p = fold(snap, recs).doc.preset!;
    expect(fold(snap, [...recs].reverse()).doc.preset).toEqual(p);
    expect(Object.keys(p.slides[0].hidden!).length).toBe(shown.length);              // together: every row
    // the version deletes rows 6:7 – on s1 they stay deleted (the version's set alone), and on s2 too
    const [a, b] = runtimeSlides(wb, p, "W", "excel", { drop: { SLIDE_1: ["6:7"] } });
    expect(a.tables[0].rows).toEqual(shown.filter(r => r !== 6 && r !== 7));
    expect(a.tables[0].hide).toBe("r6,7c");
    expect(b.tables[0].rows).toEqual(a.tables[0].rows);
    // the cached layout is the same on the next resolve (the key holds the fallback); a drop that empties it alone: nothing
    expect(runtimeSlides(wb, p, "W", "excel", { drop: { SLIDE_1: ["6:7"] } })[0].tables[0]).toBe(a.tables[0]);
    expect(runtimeSlides(wb, p, "W", "excel", { drop: { SLIDE_1: ["8"] } })[0].tables[0].rows).toEqual(shown.filter(r => r !== 8));
    const z = runtimeSlides(wb, p, "W", "excel", { drop: { SLIDE_1: ["1:30"] } })[0].tables[0];
    expect(z.rows).toEqual(shown);
    expect(z.hide).toBeUndefined();
    // without a version: no set (as before)
    expect(runtimeSlides(wb, p, "W", "excel")[0].tables[0].rows).toEqual(shown);
  });
  it("cached layouts of hidden sets: the key's marker is not a sheet name's text, and a layout in use is evicted last (review 3)", async () => {
    const wb = await book(), def = preset().tables[0];
    LCACHE.clear();
    // a sheet named with "|h" in it: its plain layout key never counts as a hidden set's
    LCACHE.set("Q1|hist|{}", { wb, L: resolveTable(wb, def, "excel")! });
    const keep = resolveTable(wb, def, "excel", { rows: new Set([7]), cols: new Set() })!;
    for (let r = 0; r < 60; r++) {
      resolveTable(wb, def, "excel", { rows: new Set([4 + (r % 15)]), cols: new Set([r % 2 ? 3 : 4]) });
      expect(resolveTable(wb, def, "excel", { rows: new Set([7]), cols: new Set() })).toBe(keep);   // used again: kept
    }
    expect(LCACHE.has("Q1|hist|{}")).toBe(true);
    expect([...LCACHE.keys()].filter(k => k.includes(HMARK)).length).toBeLessThanOrEqual(48);
    expect(HMARK).toBe("\u0001h");
  });
  it("rows outside the table do not count: the same layout as without them", async () => {
    const wb = await book(), def = preset().tables[0];
    const L0 = resolveTable(wb, def, "excel"), L1 = resolveTable(wb, def, "excel", { rows: new Set([2, 40]), cols: new Set([1, 30]) });
    expect(L1).toBe(L0);
  });
  it("a version's drop (S16.2) closes the rows up on every slide; the slide's own set joins it", async () => {
    const wb = await book(), p = preset();
    p.slides[0].hidden = { [T + ":r7"]: true };
    const [a, b] = runtimeSlides(wb, p, "W", "excel", { drop: { SLIDE_1: ["10:11", "G"] } });
    expect(a.tables[0].rows.filter(r => [7, 10, 11].includes(r))).toEqual([]);
    expect(b.tables[0].rows.filter(r => [7, 10, 11].includes(r))).toEqual([7]);
    expect(b.tables[0].cols).not.toContain(7);
    expect([a.tables[0].hide, b.tables[0].hide]).toEqual(["r7,10,11c7", "r10,11c7"]);
    // another sheet's tables are untouched (the pair of SLIDE_3)
    const [, , c] = runtimeSlides(wb, p, "W", "excel", { drop: { SLIDE_1: ["10"] } });
    expect(c.tables.every(L => !L.hide)).toBe(true);
  });
  it("the table key misses where the set changed, and only there; layouts of hidden sets stay bounded", async () => {
    const wb = await book(), p = preset();
    p.slides[0].hidden = { [T + ":r7"]: true };
    const c = ctxOf(wb, p), [A] = c.slides[0].tables, [B] = c.slides[1].tables;
    expect(tableKey(c, A)).not.toBe(tableKey(c, B));
    p.slides[0].hidden = { [T + ":r7"]: true, [T + ":r8"]: true };
    const c2 = ctxOf(wb, p);
    expect(tableKey(c2, c2.slides[0].tables[0])).not.toBe(tableKey(c, A));
    expect(tableKey(c2, c2.slides[1].tables[0])).toBe(tableKey(c, B));
    for (let r = 4; r < 120; r++) resolveTable(wb, p.tables[0], "excel", { rows: new Set([4 + (r % 15)]), cols: new Set([r % 2 ? 3 : 4]) });
    expect([...LCACHE.keys()].filter(k => k.includes(HMARK)).length).toBeLessThanOrEqual(48);
  });
});

describe("what reads the layout follows it (HR-02)", () => {
  it("borders and cell gridlines: a hidden row's own border goes with it, the neighbours keep theirs; outlines round the visible cells", async () => {
    const wb = await book(), p = preset();
    p.tables[0].borders = { D7: { bottom: { style: "thick", color: "#FF0000" } }, D8: { top: { style: "medium", color: "#0000FF" } } };
    p.tables[0].cellGrid = { C6: { o: true }, C7: { o: true }, C8: { o: true } };
    p.slides[0].hidden = { [T + ":r7"]: true };
    const c = ctxOf(wb, p), A = c.slides[0].tables[0], B = c.slides[1].tables[0];
    const ea = effItems(A, c), eb = effItems(B, c), at = (l: typeof ea, r: number, col: number) => l.find(i => i.b.r === r && i.b.c === col)!;
    // shown: D8's top is its own (blue), never the hidden D7's red bottom
    expect(at(ea, 8, 4).top).toMatchObject({ color: "#0000FF" });
    expect(ea.some(i => ["top", "bottom", "left", "right"].some(k => (i as unknown as Record<string, { color?: string } | null>)[k]?.color === "#FF0000"))).toBe(false);
    // the other slide: D7 is drawn (its red bottom is the edge it shares with D8, whose own top setting wins there)
    expect(at(eb, 7, 4).text).toBeTruthy();
    // the outline: C6 and C8 now touch, so their shared edge is inside the outline (no line there)
    expect(at(ea, 6, 3).cgrid?.bottom).toBeUndefined();
    expect(at(ea, 8, 3).cgrid?.top).toBeUndefined();
    expect(at(ea, 6, 3).cgrid?.top).toBeTruthy();
    expect(at(ea, 8, 3).cgrid?.bottom).toBeTruthy();
  });
  it("the automated comment's grid quotes the shown cells (Q8: Excel's totals are not recomputed)", async () => {
    const wb = await book(), p = preset();
    p.slides[0].hidden = { [T + ":r7"]: true, [T + ":cE"]: true };
    const c = ctxOf(wb, p), gA = gridOf(c.slides[0].tables[0], c), gB = gridOf(c.slides[1].tables[0], c);
    expect(gA.length).toBe(gB.length - 1);
    expect(gA[0].length).toBe(gB[0].length - 1);
    expect(gA.map(r => r[0].text)).not.toContain("Beta");
    expect(gB.map(r => r[0].text)).toContain("Beta");
  });
  it("a chart on the slide that reads the table skips its hidden rows; the same chart on another slide keeps them (Q7)", async () => {
    const wb = await book(), p = preset();
    const pie = (values: ChartItem["values"]): ChartItem => ({ kind: "chart", type: "pie", values, show: ["label", "percent"], legend: "right", box: { x: 980, y: 250, w: 560, h: 420 } });
    // by the table, and by a sheet range inside it
    p.slides[0].items = { c1: pie({ table: T, range: "D6:D11" }), c2: pie({ sheet: "SLIDE_1", range: "D6:D11" }) };
    p.slides[1].items = { c3: pie({ table: T, range: "D6:D11" }) };
    p.slides[0].hidden = { [T + ":r7"]: true };
    const c = ctxOf(wb, p), [c1, c2] = Object.values(p.slides[0].items) as ChartItem[], c3 = p.slides[1].items.c3 as ChartItem;
    const labels = (it: ChartItem) => { const d = chartData(it, c); return d.ok ? d.slices.map(s => s.label) : []; };
    expect(labels(c1)).toEqual(["Alpha", "Gamma", "Epsilon", "Zeta"]);
    expect(labels(c2)).toEqual(["Alpha", "Gamma", "Epsilon", "Zeta"]);
    expect(labels(c3)).toEqual(["Alpha", "Beta", "Gamma", "Epsilon", "Zeta"]);
    // its cache key follows: unhiding draws Beta again
    const k1 = chartKey(c1, c);
    p.slides[0].hidden = { [T + ":r8"]: true };
    const c4 = ctxOf(wb, p);
    expect(labels(c1).length).toBe(4);
    expect(chartData(c1, c4).ok && (chartData(c1, c4) as { slices: { label: string }[] }).slices.map(s => s.label)).toEqual(["Alpha", "Beta", "Epsilon", "Zeta"]);
    expect(chartKey(c1, c4)).not.toBe(k1);
    // a version's drop: every chart reading the sheet skips it
    const c5 = ctxOf(wb, p, "excel", { version: { id: "v", name: "V", hide: {}, drop: { SLIDE_1: ["6"] } } as never });
    expect((chartData(c3, c5) as { slices: { label: string }[] }).slices.map(s => s.label)).toEqual(["Beta", "Gamma", "Epsilon", "Zeta"]);
  });
});

describe("charts on duplicated slides and ranges past the table (review 2, 6)", () => {
  const pie = (values: ChartItem["values"]): ChartItem => ({ kind: "chart", type: "pie", values, show: ["label", "percent"], legend: "right", box: { x: 980, y: 250, w: 560, h: 420 } });
  const labels = (it: ChartItem, c: RenderCtx) => { const d = chartData(it, c); return d.ok ? d.slices.map(s => s.label) : []; };
  it("Duplicate slide: the copy's chart is equal to the original's, and only the slide that hides rows skips them", async () => {
    const wb = await book(), p = preset();
    p.slides[0].items = { c1: pie({ table: T, range: "D6:D11" }) };
    p.slides[1] = { ...structuredClone(p.slides[0]), id: "s2", title: "Loans (copy)" };   // as Duplicate slide makes it
    p.slides[1].hidden = { [T + ":r7"]: true };                                            // only the copy hides Beta
    const c = ctxOf(wb, p), [orig, copy] = [p.slides[0].items!.c1, p.slides[1].items!.c1] as ChartItem[];
    expect(orig).toEqual(copy);
    expect(orig).not.toBe(copy);
    expect(labels(orig, c)).toEqual(["Alpha", "Beta", "Gamma", "Epsilon", "Zeta"]);
    expect(labels(copy, c)).toEqual(["Alpha", "Gamma", "Epsilon", "Zeta"]);
    // and the other way round (the first slide hides, the copy does not)
    const q = structuredClone(p); q.slides[0].hidden = q.slides[1].hidden; delete q.slides[1].hidden;
    const d = ctxOf(wb, q);
    expect(labels(q.slides[0].items!.c1 as ChartItem, d)).toEqual(["Alpha", "Gamma", "Epsilon", "Zeta"]);
    expect(labels(q.slides[1].items!.c1 as ChartItem, d)).toEqual(["Alpha", "Beta", "Gamma", "Epsilon", "Zeta"]);
  });
  it("only slides that hide rows are looked at, the item by identity: a copy of the chart on no slide keeps every row", async () => {
    const wb = await book(), p = preset();
    p.slides[0].items = { c1: pie({ table: T, range: "D6:D11" }) };
    const c = ctxOf(wb, p);
    expect(labels(p.slides[0].items.c1 as ChartItem, c)).toHaveLength(5);
    p.slides[0].hidden = { [T + ":r7"]: true };
    const c2 = ctxOf(wb, p);
    expect(labels(structuredClone(p.slides[0].items.c1) as ChartItem, c2)).toHaveLength(5);          // a copy: on no slide
    expect(labels(p.slides[0].items.c1 as ChartItem, c2)).toHaveLength(4);
  });
  it("a sheet range overlapping the table reads it, also when it runs past the table (Q7: any overlap, e.g. a total row under it)", async () => {
    const wb = await book(), p = preset();
    // the table is B3:K20 (rows 4-19 inside): D6:D21 runs two rows past it, D2:D7 starts above it; D22:D24 is outside
    p.slides[0].items = { past: pie({ sheet: "SLIDE_1", range: "D6:D21" }), above: pie({ sheet: "SLIDE_1", range: "D2:D7" }), out: pie({ sheet: "SLIDE_1", range: "D22:D24" }) };
    p.slides[1].items = { past: pie({ sheet: "SLIDE_1", range: "D6:D21" }) };
    const base = ctxOf(wb, p), before = { past: labels(p.slides[0].items.past as ChartItem, base), above: labels(p.slides[0].items.above as ChartItem, base), out: labels(p.slides[0].items.out as ChartItem, base) };
    p.slides[0].hidden = { [T + ":r7"]: true };
    const c = ctxOf(wb, p);
    expect(before.past).toContain("Beta");
    expect(labels(p.slides[0].items.past as ChartItem, c)).toEqual(before.past.filter(l => l !== "Beta"));
    expect(labels(p.slides[0].items.above as ChartItem, c)).toEqual(before.above.filter(l => l !== "Beta"));
    expect(labels(p.slides[0].items.out as ChartItem, c)).toEqual(before.out);
    expect(labels(p.slides[1].items.past as ChartItem, c)).toEqual(before.past);           // another slide keeps it
  });
  it("a set the table could not apply (it would empty it) is not applied to its chart either", async () => {
    const wb = await book(), p = preset();
    p.slides[0].items = { c1: pie({ table: T, range: "D6:D11" }) };
    p.slides[0].hidden = Object.fromEntries([4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map(r => [T + ":r" + r, true])) as Record<string, true>;
    const c = ctxOf(wb, p);
    expect(c.slides[0].tables[0].hide).toBeUndefined();
    expect(labels(p.slides[0].items.c1 as ChartItem, c)).toEqual(["Alpha", "Beta", "Gamma", "Epsilon", "Zeta"]);
  });
});

/* ---- the export's path: the core worker (a deck in memory) and an export worker linked to it (as pptx-m13.test.ts) ---- */
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), c => c.charCodeAt(0));
const FONTS = path.join(here, "fixtures", "fonts");
const FONT_FILES: Record<string, Uint8Array> = Object.fromEntries(["Carlito-Regular.ttf", "Carlito-Bold.ttf"].map(f => [f, new Uint8Array(fs.readFileSync(path.join(FONTS, f)))]));
/** Carlito stands in for Arial (the PDF needs a face of this PC for every design's text) */
const CATALOG = [400, 700].map(weight => ({ source: "system" as const, file: weight === 400 ? "Carlito-Regular.ttf" : "Carlito-Bold.ttf", family: "Arial", weight, italic: false }));
async function open(deck: FakeDeck, p: Preset) {
  const api = deck.api(), [a, b] = pair();
  serve(new Port<CoreMethods, PageMethods, PageEvents, CoreEvents>(b), { autoTail: false });
  const port = new Port<PageMethods, CoreMethods, CoreEvents, PageEvents>(a);
  port.handle("deckSnapshot", () => api.snapshot("")); port.handle("deckTail", x => api.tail(x.key, x.since));
  port.handle("deckAppend", x => api.append(x.key, x.writer, x.record)); port.handle("deckCompact", x => api.compact(x.key, x.baseGen, x.snapshot));
  port.handle("deckRotate", x => api.rotate(x.key, x.writer)); port.handle("deckFormat5", x => api.format5(x.key));
  port.handle("deckPrepare", () => null); port.handle("digitWidth", () => 0); port.handle("convertPicture", () => null); port.handle("analyzeImages", () => []);
  port.handle("linkedWorkbook", () => null);
  for (const e of ["slices", "stage", "doc"] as const) port.on(e, () => undefined);
  await port.call("init", { served: true, client: "c1", me: "anna" });
  await port.call("index", transfer({ buf: ab(path.join(BOOKS, deck.snap.workbook)) }, []));
  await port.call("start", { name: deck.snap.workbook, deck: deck.open("anna@pc#aaaaaaaa"), preset: p, inputs: { defaults: {}, logoSrc: "", version: "", workbook: deck.snap.workbook }, stage: { slide: 0, known: [] } });
  const [c, d] = pair(), [e, f] = pair();
  const page = new Port<ExportPageMethods, ExportMethods, Record<string, never>, Record<string, never>>(c);
  page.handle("fontFile", x => { const g = FONT_FILES[x.file]; return g ? g.slice().buffer as ArrayBuffer : null; });
  page.handle("pictureBytes", () => PNG.slice().buffer as ArrayBuffer);
  new ExportHost(new Port(d) as unknown as ExportPort).link(new Port(e) as unknown as ExportCorePort);
  new Port<{ slideLists(x: unknown): SlideList[] }, Record<string, never>, Record<string, never>, Record<string, never>>(f)
    .handle("slideLists", x => port.call("slideLists", x as never));
  const apply = async (label: string, ops: Op[]) => (await port.call("apply", { label, ops })).changed;
  const lists = (design: Design) => port.call("slideLists", { design, version: "", forExport: true, thumb: false, today: TODAY, pptx: true });
  const run = (kind: ExportJob["kind"], design: Design) => page.call("run", { kind, design, version: "", forExport: true, thumb: false, today: TODAY, scale: 1, title: "Report", catalog: kind === "pdf" ? CATALOG : [] });
  return { apply, lists, run };
}
const textOf = (xml: string) => [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1]);
function tablesOf(xml: string) {
  return xml.split("<p:graphicFrame>").slice(1).map(g => g.split("</p:graphicFrame>")[0]).filter(g => g.includes("<a:tbl>")).map(g => {
    const off = /<p:xfrm><a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(g)!;
    return { x: +off[1], y: +off[2], w: +off[3], h: +off[4], rows: (g.match(/<a:tr /g) || []).length, cols: (g.match(/<a:gridCol /g) || []).length, text: textOf(g) };
  });
}
/** what the display list draws of each table: the box of its cells ("t" hits inside the "tw" group), in slide px */
function dlTables(nodes: Node[]) {
  const out: { x: number; y: number; w: number; h: number }[] = [];
  type M = [number, number, number, number, number, number];
  const mul = (A: M, B: M): M => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
  const cells = (ns: Node[], M: M, acc: { x0: number; y0: number; x1: number; y1: number }) => {
    for (const n of ns) {
      if (n.t === "group") cells(n.children, n.transform ? mul(M, n.transform as M) : M, acc);
      else if (n.t === "hit" && n.kind === "t" && n.w > 0 && n.h > 0) {
        const x = M[0] * n.x + M[4], y = M[3] * n.y + M[5], x2 = M[0] * (n.x + n.w) + M[4], y2 = M[3] * (n.y + n.h) + M[5];
        acc.x0 = Math.min(acc.x0, x); acc.y0 = Math.min(acc.y0, y); acc.x1 = Math.max(acc.x1, x2); acc.y1 = Math.max(acc.y1, y2);
      }
    }
  };
  const walk = (ns: Node[], M: M) => ns.forEach((n, i) => {
    if (n.t === "hit" && n.id === "tw" && ns[i + 1]?.t === "group") {
      const acc = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      cells([ns[i + 1]], M, acc);
      if (acc.x1 > acc.x0) out.push({ x: acc.x0, y: acc.y0, w: acc.x1 - acc.x0, h: acc.y1 - acc.y0 });
    } else if (n.t === "group" && !(i > 0 && ns[i - 1].t === "hit" && (ns[i - 1] as { id: string }).id === "tw")) walk(n.children, n.transform ? mul(M, n.transform as M) : M);
  });
  walk(nodes, [1, 0, 0, 1, 0, 0]);
  return out;
}
const words = (ns: Node[]): string[] => ns.flatMap(n => n.t === "text" ? [n.src] : n.t === "group" ? words(n.children) : []);
function sameBox(t: { x: number; y: number; w: number; h: number }, d: { x: number; y: number; w: number; h: number }) {
  const e = E(.75);
  return Math.abs(t.x - E(d.x)) <= e && Math.abs(t.y - E(d.y)) <= e && Math.abs(t.x + t.w - E(d.x + d.w)) <= e && Math.abs(t.y + t.h - E(d.y + d.h)) <= e;
}

describe("every design and PowerPoint (HR-01: closed up in every export)", () => {
  it("the display list draws the visible rows only, on that slide; the a:tbl holds exactly them, where the display list draws it; the PDF too", async () => {
    const deck = new FakeDeck("report.xlsx-0123456789", "report.xlsx"), h = await open(deck, preset());
    // one action, one op: Hide rows (Beta, Epsilon) and Hide columns (the first Δ w/w)
    expect(await h.apply("Hide rows", [hide("s1", { [T + ":r7"]: true, [T + ":r10"]: true })])).toBe(true);
    expect(await h.apply("Hide columns", [hide("s1", { [T + ":cE"]: true })])).toBe(true);
    expect(await h.apply("Hide rows", [hide("s3", { "ybyk4v2:r6": true })])).toBe(true);
    for (const design of DESIGNS) {
      const ls = await h.lists(design), r = await h.run("pptx", design), z = unzipSync(new Uint8Array(r.files[0]));
      keep(`m16-hidden-${design}.pptx`, r.files[0]);
      const slide = (i: number) => strFromU8(z[`ppt/slides/slide${i + 1}.xml`]);
      const wA = words(ls[0].dl.nodes), wB = words(ls[1].dl.nodes);
      expect(wA, design).toContain("Alpha");
      expect(wA, design).not.toContain("Beta");
      expect(wA, design).not.toContain("Epsilon");
      expect(wB, design).toContain("Beta");
      expect(wB, design).toContain("Epsilon");
      for (let i = 0; i < 3; i++) {
        const xml = slide(i), want = dlTables(ls[i].dl.nodes), got = tablesOf(xml);
        expect(xml, design).not.toContain("p:cxnSp");
        expect(xml, design).not.toContain("<p:pic>");
        expect(got.length, `${design} slide ${i + 1}`).toBe(want.length);
        want.forEach((d, k) => expect(sameBox(got[k], d), `${design} slide ${i + 1} table ${k + 1}`).toBe(true));
      }
      const [tA] = tablesOf(slide(0)), [tB] = tablesOf(slide(1));
      expect(tA.text.join(" "), design).not.toMatch(/\bBeta\b|\bEpsilon\b/);
      expect(tB.text.join(" "), design).toMatch(/\bBeta\b/);
      // every design (report.xlsx's tables are plain, so the consulting designs draw them as the grid too): 13 of the 15
      // rows, 6 of the 7 columns (Excel's own hidden row 9 and column H stay hidden); SLIDE_3's pair 6 and 10 rows
      expect([tA.rows, tA.cols], design).toEqual([13, 6]);
      expect([tB.rows, tB.cols], design).toEqual([15, 7]);
      expect(tablesOf(slide(2)).map(t => [t.rows, t.cols]), design).toEqual([[6, 3], [10, 4]]);
    }
    const pdf = await h.run("pdf", "excel"), s = Buffer.from(new Uint8Array(pdf.files[0])).toString("latin1");
    expect((s.match(/\/Type\s*\/Page[^s]/g) || []).length).toBe(3);
    keep("m16-hidden-excel.pdf", pdf.files[0]);
    // unhide: the next export has the rows again (one op each way)
    expect(await h.apply("Unhide all on this table", [hide("s1", { [T + ":r7"]: null, [T + ":r10"]: null, [T + ":cE"]: null })])).toBe(true);
    const z = unzipSync(new Uint8Array((await h.run("pptx", "excel")).files[0]));
    expect(tablesOf(strFromU8(z["ppt/slides/slide1.xml"]))[0].rows).toBe(15);
  }, 120_000);
});

describe("an exhibit (the consulting designs draw their own rows: review 7)", () => {
  it("deck20 as an exhibit: the a:tbl loses exactly the hidden body row and column, on that table only, in every design", async () => {
    const D20 = JSON.parse(fs.readFileSync(path.join(DECKS, "deck20.json"), "utf8")) as { workbook: string; ops: Op[] };
    const p = structuredClone((D20.ops[0] as Extract<Op, { op: "preset.set" }>).preset as Preset);
    const deck = new FakeDeck("deck20.xlsx-0123456789", "deck20.xlsx"), h = await open(deck, p);
    // slide 1's loans table (x0r1235): PBZ (row 11) and the abs. column of "Δ vs. BoY" (P); the deposits table beside it keeps both
    const count = async (design: Design) => {
      const r = await h.run("pptx", design), z = unzipSync(new Uint8Array(r.files[0])), xml = strFromU8(z["ppt/slides/slide1.xml"]);
      expect(xml, design).not.toContain("<p:pic>");
      return tablesOf(xml);
    };
    const before: Record<string, ReturnType<typeof tablesOf>> = {};
    for (const design of DESIGNS) before[design] = await count(design);
    expect(await h.apply("Hide rows", [hide("cz9uvf0", { "x0r1235:r11": true, "x0r1235:cP": true })])).toBe(true);
    // the exhibit's rows: 2 header rows, 11 banks, the total (14); its columns per design's own groups
    expect(before.mckinsey.map(t => [t.rows, t.cols])).toEqual([[14, 26], [14, 26]]);
    expect(before.bain.map(t => [t.rows, t.cols])).toEqual([[14, 22], [14, 22]]);
    for (const design of DESIGNS) {
      const after = await count(design), [a, b] = after, [a0, b0] = before[design];
      keep(`m16-hidden-exhibit-${design}.pptx`, (await h.run("pptx", design)).files[0]);
      expect([a.rows, a.cols], design).toEqual([a0.rows - 1, a0.cols - 1]);
      expect([b.rows, b.cols], design).toEqual([b0.rows, b0.cols]);
      expect(a.text, design).not.toContain("PBZ");
      expect(b.text, design).toContain("PBZ");
      expect(a0.text, design).toContain("PBZ");
    }
  }, 120_000);
});
