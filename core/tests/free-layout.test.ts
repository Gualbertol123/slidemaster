/* Free layout (S10.1, FL-01, B18; docs/next/07 §5.1, ADR-017): switched on, a slide's tables, text boxes and items sit
   at saved boxes per design – nothing moves at the switch, nothing re-flows after it; switched off, the automatic layout
   returns as it was and the boxes stay saved; one operation, one undo step, each way. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOp, applyOps, emptyDoc, inverseOf } from "../src/model/ops";
import { runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { excelToDisplayList, type Metrics } from "../src/render/excel-dl";
import { slideToDisplayList } from "../src/render/slide-dl";
import { areaFor, computeLayout, emptySpot, firstEmpty, freeBoxes, freeKey, freeOf, GX, GY, itemBoxOf, noteKey, tableH, tableW } from "../src/render/layout";
import { History } from "../src/sync/history";
import { wrapLines } from "../src/text/lines";
import type { RenderCtx } from "../src/render/context";
import type { Design, Op, WorkbookDoc } from "../src/model/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const DECKS = path.join(here, "../../tests/corpus/decks"), BOOKS = path.join(here, "../../tests/corpus/workbooks");
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
const SLIDE = "p2knyyz";
/* weekly-options' content slide (two tables, a free text box, a bubble beside, an automated comment below, the notes
   section) with a chart attached right of the first table and a callout placed freely */
const ITEMS: Op[] = [
  { op: "item.patch", slide: SLIDE, id: "c1", patch: { kind: "chart", type: "pie", values: { sheet: "LOANS_DEPOSITS", range: "C5:C7" }, box: { x: 0, y: 0, w: 220, h: 160 }, attach: { table: "l4tsxhl", side: "right" } } },
  { op: "item.patch", slide: SLIDE, id: "k1", patch: { kind: "shape", shape: "pill", text: "Note", box: { x: 1200, y: 760, w: 200, h: 60 } } },
];
async function open(extra: Op[] = []) {
  const d = JSON.parse(fs.readFileSync(path.join(DECKS, "weekly-options.json"), "utf8")) as { workbook: string; ops: Op[] };
  const wb = await readWorkbook(ab(path.join(BOOKS, d.workbook)));
  const doc = applyOps(emptyDoc("W.xlsx"), [...d.ops, ...ITEMS]).doc as WorkbookDoc;
  for (const op of extra) applyOp(doc, op);
  const at = (design: Design, D: Pick<WorkbookDoc, "preset" | "style" | "edits"> = doc) => {
    const style = { ...resolveStyle({}, D.style), design }, slides = runtimeSlides(wb, D.preset, "W.xlsx", design);
    const ctx: RenderCtx = { style, edits: D.edits || {}, slides, preset: D.preset || null, workbook: "W.xlsx", logoSrc: "", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null };
    const i = slides.findIndex(s => s.id === SLIDE), R = slides[i];
    const dl = () => { const boxes = computeLayout(R, ctx).boxes; return slideToDisplayList(R, i, ctx, R.tables.map(L => excelToDisplayList(L, ctx, M)), boxes, { wall: null, logo: null }, M, "1 October 2026"); };
    return { R, ctx, dl };
  };
  return { doc, at };
}
const on = (design: Design, items: Record<string, unknown>): Op => ({ op: "slide.patch", id: SLIDE, patch: { free: { [design]: { on: true, items } } } } as Op);

describe("free layout: switching on moves nothing (FL-01)", () => {
  for (const design of ["excel", "clean"] as Design[]) it(design + ": the display list before and after the switch is the same", async () => {
    const { doc, at } = await open(), before = at(design);
    expect(Object.keys(before.R.cfg.notes || {}).length).toBeGreaterThanOrEqual(3);
    const items = freeBoxes(before.R, before.ctx);
    // every table, text box beside a table and item has its box
    expect(Object.keys(items).sort()).toEqual(["i:c1", "i:k1", "n:dj7beg8:bottom", "n:l4tsxhl:right", "n:l4tsxhl:top", "t:dj7beg8", "t:l4tsxhl"].sort());
    const d2 = structuredClone(doc); expect(applyOp(d2, on(design, items))).toBe(true);
    const after = at(design, d2);
    expect(freeOf(after.R, after.ctx)).not.toBeNull();
    expect(after.dl().nodes).toEqual(before.dl().nodes);
  });
  for (const design of ["glass", "excel", "clean", "mckinsey", "bain"] as Design[]) it(design + ": the same boxes", async () => {
    const { doc, at } = await open(), before = at(design), d2 = structuredClone(doc);
    applyOp(d2, on(design, freeBoxes(before.R, before.ctx)));
    const after = at(design, d2), a = computeLayout(after.R, after.ctx), b = computeLayout(before.R, before.ctx);
    expect(a.boxes.map(x => [x.x, x.y, x.w, x.h, x.scale, x.notes, x.items ?? {}])).toEqual(b.boxes.map(x => [x.x, x.y, x.w, x.h, x.scale, JSON.parse(JSON.stringify(x.notes, (k, v) => k === "free" ? undefined : v)), x.items ?? {}]).map(r => { r[5] = Object.fromEntries(Object.entries(r[5] as object).map(([k, v]) => [k, { ...v, free: true }])); return r; }));
    expect([a.k, a.fit, a.reduced]).toEqual([1, 1, false]);
    expect(itemBoxOf(after.R, "k1", a.boxes, after.ctx)).toEqual(itemBoxOf(before.R, "k1", b.boxes, before.ctx));
    // another design is not switched
    const other = at(design === "excel" ? "clean" : "excel", d2);
    expect(freeOf(other.R, other.ctx)).toBeNull();
  });
});

describe("free layout: the saved boxes, nothing re-flows", () => {
  it("tables at their box and scale, text boxes and items at theirs; no fit, no shared scale", async () => {
    const { doc, at } = await open(), s0 = at("excel"), items = freeBoxes(s0.R, s0.ctx);
    const t = items["t:l4tsxhl"];
    const tw = t.w * 1.25, th = t.h * 1.25, tx = 1600 - tw - 20, ty = 900 - th - 20;
    items["t:l4tsxhl"] = { x: tx, y: ty, w: tw, h: th, scale: t.scale! * 1.25 };
    items["n:l4tsxhl:right"] = { x: 20, y: 30, w: 300, h: 80 };
    items["i:c1"] = { x: 60, y: 600, w: 250, h: 200 };
    items["i:k1"] = { x: 1300, y: 40, w: 180, h: 50 };
    const d2 = structuredClone(doc); applyOp(d2, on("excel", items));
    const s = at("excel", d2), L = computeLayout(s.R, s.ctx), b = L.boxes[0];
    expect([b.x, b.y, b.scale]).toEqual([tx, ty, t.scale! * 1.25]);
    expect(b.w).toBeCloseTo(tableW(s.R.tables[0], s.ctx) * t.scale! * 1.25);
    expect(b.notes.right).toEqual({ x: 20, y: 30, w: 300, h: 80, free: true });
    expect(b.items!.c1).toEqual({ x: 60, y: 600, w: 250, h: 200 });
    expect(itemBoxOf(s.R, "k1", L.boxes, s.ctx)).toEqual({ x: 1300, y: 40, w: 180, h: 50 });
    // the other table did not move although the first one now overlaps it
    expect(L.boxes[1].x).toBe(items["t:dj7beg8"].x); expect(L.boxes[1].y).toBe(items["t:dj7beg8"].y);
    expect([L.k, L.fit]).toEqual([1, 1]);
  });
  it("a box from a shared document: past the slide's edge it stays where it is; an invalid one is ignored (the automatic place)", async () => {
    const { doc, at } = await open(), s0 = at("clean"), auto = computeLayout(s0.R, s0.ctx).boxes;
    const items = freeBoxes(s0.R, s0.ctx);
    items["n:l4tsxhl:top"] = { x: 1580, y: -50, w: 300, h: 80 };                    // partly off the slide: kept
    items["i:c1"] = { x: 1, y: 1, w: -5, h: 10 } as never;                           // invalid → beside its table
    items["t:dj7beg8"] = { x: "a", y: 0, w: 10, h: 10 } as never;                    // invalid → automatic
    items["i:k1"] = { x: 1e9, y: 0, w: 10, h: 10 };                                  // beyond reach → its own box
    const d2 = structuredClone(doc); applyOp(d2, on("clean", items));
    const s = at("clean", d2), L = computeLayout(s.R, s.ctx).boxes;
    expect(L[0].notes.top).toEqual({ x: 1580, y: -50, w: 300, h: 80, free: true });
    expect(L[0].items!.c1).toEqual(auto[0].items!.c1);
    expect([L[1].x, L[1].y, L[1].scale]).toEqual([auto[1].x, auto[1].y, auto[1].scale]);
    expect(itemBoxOf(s.R, "k1", L, s.ctx)).toEqual({ x: 1200, y: 760, w: 200, h: 60 });
  });
  it("a table's scale from a shared document: NaN or below 0.05 → from its box's width; at least 0.05; a huge one bounded", async () => {
    const { doc, at } = await open(), s0 = at("excel"), items = freeBoxes(s0.R, s0.ctx), W = tableW(s0.R.tables[0], s0.ctx), t = items["t:l4tsxhl"];
    const scaleWith = (scale: unknown, w = t.w) => { const d2 = structuredClone(doc); applyOp(d2, on("excel", { ...items, "t:l4tsxhl": { ...t, w, scale } })); const s = at("excel", d2); return computeLayout(s.R, s.ctx).boxes[0].scale; };
    expect(scaleWith(NaN, 400)).toBeCloseTo(400 / W);
    expect(scaleWith(1e-9, 400)).toBeCloseTo(400 / W);
    expect(scaleWith(undefined, 1e-6)).toBe(.05);
    expect(scaleWith(1e12) * W).toBeLessThanOrEqual(16000 + 1e-6);
  });
  it("a text box placed past the slide's edge before the switch: switching on moves nothing (the display list is the same)", async () => {
    const { doc, at } = await open([{ op: "slide.patch", id: SLIDE, patch: { notes: { "l4tsxhl:top": { text: "Out", x: 1450, y: 860, w: 300, h: 80 } } } } as Op]);
    const before = at("excel"), d2 = structuredClone(doc);
    applyOp(d2, on("excel", freeBoxes(before.R, before.ctx)));
    expect(at("excel", d2).dl().nodes).toEqual(before.dl().nodes);
  });
  it("a text box or item added after the switch-on: its automatic place beside its table, moved with the table", async () => {
    const { doc, at } = await open(), s0 = at("excel"), items = freeBoxes(s0.R, s0.ctx), auto = computeLayout(s0.R, s0.ctx).boxes[1];
    items["t:dj7beg8"] = { ...items["t:dj7beg8"], x: items["t:dj7beg8"].x - 40, y: items["t:dj7beg8"].y + 30 };
    const d2 = structuredClone(doc); applyOp(d2, on("excel", items));
    applyOp(d2, { op: "slide.patch", id: SLIDE, patch: { notes: { "dj7beg8:top": { text: "Added later" } } } } as Op);
    const s = at("excel", d2), b = computeLayout(s.R, s.ctx).boxes[1];
    const a2 = computeLayout({ ...s.R, cfg: { ...s.R.cfg, free: undefined } }, s.ctx).boxes[1];   // where the automatic layout puts it now
    expect(b.notes.top!.x - b.x).toBeCloseTo(a2.notes.top!.x - a2.x);
    expect(b.notes.top!.y - b.y).toBeCloseTo(a2.notes.top!.y - a2.y);
    expect(b.notes.bottom).toEqual({ ...items["n:dj7beg8:bottom"], free: true });          // saved: stays
    expect(b.x).toBe(auto.x - 40);
  });
});

describe("free layout: a table added after the switch-on (Add table, S13.4, 09 §2.8)", () => {
  const apart = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
    a.x + a.w + GX <= b.x + .01 || b.x + b.w + GX <= a.x + .01 || a.y + a.h + GY <= b.y + .01 || b.y + b.h + GY <= a.y + .01;
  for (const design of ["glass", "excel", "clean", "mckinsey", "bain"] as Design[]) it(design + ": at its automatic scale, at the first empty spot of the content area; no box written", async () => {
    const { doc, at } = await open(), s0 = at(design), items = freeBoxes(s0.R, s0.ctx), A = areaFor(s0.R, s0.ctx), auto = computeLayout(s0.R, s0.ctx).boxes;
    // the first table small in the top left corner, the second without a box (as table.add leaves it)
    const W = tableW(s0.R.tables[0], s0.ctx), H = tableH(s0.R.tables[0], s0.ctx);
    items["t:l4tsxhl"] = { x: A.x, y: A.y, w: W * .3, h: H * .3, scale: .3 };
    delete items["t:dj7beg8"];
    const d2 = structuredClone(doc); applyOp(d2, on(design, items));
    const s = at(design, d2), L = computeLayout(s.R, s.ctx).boxes, b = L[1];
    expect(b.scale).toBeCloseTo(auto[1].scale);
    expect([b.w, b.h]).toEqual([auto[1].w, auto[1].h]);
    expect(b.x).toBeGreaterThanOrEqual(A.x); expect(b.y).toBeGreaterThanOrEqual(A.y);
    expect(b.x + b.w).toBeLessThanOrEqual(A.x + A.w + .01); expect(b.y + b.h).toBeLessThanOrEqual(A.y + A.h + .01);
    const taken = [L[0], ...Object.values(L[0].notes), ...Object.values(L[0].items || {}), itemBoxOf(s.R, "k1", L, s.ctx)!];
    for (const t of taken) if (t) expect(apart(b, t)).toBe(true);
    expect(s.R.cfg.free![design]!.items["t:dj7beg8"]).toBeUndefined();
    expect(at(design, d2).dl().nodes.length).toBeGreaterThan(0);
    // the same on every call (the stage, the export, the drags read it)
    expect(computeLayout(s.R, s.ctx).boxes[1]).toEqual(b);
  });
  // (review of S13.4: the text boxes that go beside the new table count when looking for room – they move with it)
  for (const design of ["glass", "excel", "clean", "mckinsey", "bain"] as Design[]) it(design + ": its text box without a place of its own lands on nothing either", async () => {
    const { doc, at } = await open(), s0 = at(design), items = freeBoxes(s0.R, s0.ctx), A = areaFor(s0.R, s0.ctx);
    const W = tableW(s0.R.tables[0], s0.ctx), H = tableH(s0.R.tables[0], s0.ctx);
    items["t:l4tsxhl"] = { x: A.x, y: A.y, w: W * .3, h: H * .3, scale: .3 };
    delete items["t:dj7beg8"]; delete items["n:dj7beg8:bottom"];                   // the table and its comment below: no box
    const d2 = structuredClone(doc); applyOp(d2, on(design, items));
    const s = at(design, d2), L = computeLayout(s.R, s.ctx).boxes, b = L[1], note = b.notes.bottom!;
    expect(note).toBeTruthy();
    const taken = [L[0], ...Object.values(L[0].notes), ...Object.values(L[0].items || {}), itemBoxOf(s.R, "k1", L, s.ctx)!].filter(Boolean);
    for (const t of taken) { expect(apart(b, t)).toBe(true); expect(apart(note, t)).toBe(true); }
    expect(note.y).toBeGreaterThanOrEqual(b.y + b.h - .01);                         // still below its table
    expect(note.y + note.h).toBeLessThanOrEqual(A.y + A.h + .01);
  });
  it("a table that fits above another but its comment would not: not there (it and its comment fit elsewhere, or smaller)", async () => {
    const { doc, at } = await open(), s0 = at("excel"), items = freeBoxes(s0.R, s0.ctx), A = areaFor(s0.R, s0.ctx), auto = computeLayout(s0.R, s0.ctx).boxes;
    const W = tableW(s0.R.tables[0], s0.ctx), H = tableH(s0.R.tables[0], s0.ctx), sc = A.w / W;
    // the first table across the whole width, just below the room the second table needs (not its comment)
    const y = A.y + auto[1].h + GY + 1;
    items["t:l4tsxhl"] = { x: A.x, y, w: A.w, h: H * sc, scale: sc };
    delete items["n:l4tsxhl:top"]; delete items["n:l4tsxhl:right"]; delete items["i:c1"];
    items["n:l4tsxhl:top"] = { x: A.x + A.w - 10, y: A.y + A.h - 10, w: 10, h: 10 };     // out of the way
    items["n:l4tsxhl:right"] = { x: A.x + A.w - 10, y: A.y + A.h - 30, w: 10, h: 10 };
    items["i:c1"] = { x: A.x + A.w - 30, y: A.y + A.h - 10, w: 10, h: 10 };
    delete items["t:dj7beg8"]; delete items["n:dj7beg8:bottom"];
    const d2 = structuredClone(doc); applyOp(d2, on("excel", items));
    const s = at("excel", d2), L = computeLayout(s.R, s.ctx).boxes, b = L[1], note = b.notes.bottom!;
    expect(apart(note, L[0])).toBe(true);
    expect(apart(b, L[0])).toBe(true);
    // (the corner had room for the table alone at its scale: not taken, its comment would be on the first table)
    expect(Math.abs(b.y - A.y) < .01 && Math.abs(b.scale - auto[1].scale) < 1e-9).toBe(false);
  });
  it("no empty spot even at a quarter of its scale: where the automatic layout puts it", async () => {
    const { doc, at } = await open(), s0 = at("excel"), items = freeBoxes(s0.R, s0.ctx), A = areaFor(s0.R, s0.ctx), auto = computeLayout(s0.R, s0.ctx).boxes;
    items["t:l4tsxhl"] = { ...items["t:l4tsxhl"], x: A.x, y: A.y, w: A.w, h: A.h, scale: Math.max(A.w / tableW(s0.R.tables[0], s0.ctx), A.h / tableH(s0.R.tables[0], s0.ctx)) };
    delete items["t:dj7beg8"];
    const d2 = structuredClone(doc); applyOp(d2, on("excel", items));
    const s = at("excel", d2), b = computeLayout(s.R, s.ctx).boxes[1];
    expect([b.x, b.y, b.w, b.h]).toEqual([auto[1].x, auto[1].y, auto[1].w, auto[1].h]);
  });
  it("firstEmpty: top to bottom, then left to right, GX / GY apart; null when nothing fits", () => {
    const A = { x: 0, y: 0, w: 1000, h: 500 };
    expect(firstEmpty(A, 100, 100, [])).toEqual({ x: 0, y: 0 });
    expect(firstEmpty(A, 100, 100, [{ x: 0, y: 0, w: 300, h: 200 }])).toEqual({ x: 300 + GX, y: 0 });
    expect(firstEmpty(A, 800, 100, [{ x: 0, y: 0, w: 300, h: 200 }])).toEqual({ x: 0, y: 200 + GY });
    expect(firstEmpty(A, 100, 100, [{ x: 0, y: 0, w: 1000, h: 500 }])).toBeNull();
    expect(firstEmpty(A, 1200, 100, [])).toBeNull();
  });
  it("emptySpot: its size first, else ¾, ½, ⅓, ¼ of it; null when not even a quarter fits", () => {
    const A = { x: 0, y: 0, w: 1000, h: 500 }, top = { x: 0, y: 0, w: 1000, h: 300 };
    expect(emptySpot(A, 400, 100, [top])).toEqual({ x: 0, y: 300 + GY, f: 1 });
    expect(emptySpot(A, 400, 200, [top])).toEqual({ x: 0, y: 300 + GY, f: .75 });            // 172 px left: 150 fits
    expect(emptySpot(A, 400, 400, [top])).toEqual({ x: 0, y: 300 + GY, f: 1 / 3 });
    expect(emptySpot(A, 400, 800, [top])).toBeNull();
  });
});

describe("free layout: off brings the automatic layout back, on again the saved boxes – one undo step each", () => {
  it("on, move, off, on: nothing lost; the history counts one step per switch", async () => {
    const { doc, at } = await open(), s0 = at("excel"), auto = computeLayout(s0.R, s0.ctx).boxes;
    const h = new History(), d = structuredClone(doc) as WorkbookDoc;
    const step = (label: string, op: Op) => { const inv = inverseOf(d, op)!; expect(applyOp(d, op)).toBe(true); h.record("W.xlsx", label, [op], [inv], undefined, 0); };
    const undo = () => { const e = h.take(false)!; for (const op of e.undo) applyOp(d, op); h.done(e, false, true); };
    const boxes = () => { const s = at("excel", d); return computeLayout(s.R, s.ctx).boxes; };
    step("Free layout", on("excel", freeBoxes(s0.R, s0.ctx)));
    const cur = d.preset!.slides.find(x => x.id === SLIDE)!.free!.excel!;
    step("Move table", { op: "slide.patch", id: SLIDE, patch: { free: { excel: { on: true, items: { ...cur.items, "t:l4tsxhl": { ...cur.items["t:l4tsxhl"], x: 77 } } } } } } as Op);
    expect(boxes()[0].x).toBe(77);
    const f = d.preset!.slides.find(x => x.id === SLIDE)!.free!.excel!;
    step("Automatic layout", { op: "slide.patch", id: SLIDE, patch: { free: { excel: { ...f, on: false } } } } as Op);
    expect(boxes().map(b => [b.x, b.y, b.scale])).toEqual(auto.map(b => [b.x, b.y, b.scale]));
    expect(d.preset!.slides.find(x => x.id === SLIDE)!.free!.excel!.items["t:l4tsxhl"].x).toBe(77);     // kept
    step("Free layout", { op: "slide.patch", id: SLIDE, patch: { free: { excel: { ...f, on: true } } } } as Op);
    expect(boxes()[0].x).toBe(77);
    expect(h.summary().undo).toBe(4);
    undo(); expect(boxes().map(b => b.x)).toEqual(auto.map(b => b.x));                // one step: automatic again
    undo(); expect(boxes()[0].x).toBe(77);                                            // one step: free again
    undo(); undo();
    expect(d.preset!.slides.find(x => x.id === SLIDE)!.free).toBeUndefined();          // back to the deck before
    expect(h.summary()).toMatchObject({ undo: 0, redo: 4 });
  });
  it("the keys", async () => {
    const { at } = await open(), s = at("excel");
    expect([freeKey.table(s.R, 0), freeKey.note(noteKey(s.R, 0, "top")), freeKey.item("c1")]).toEqual(["t:l4tsxhl", "n:l4tsxhl:top", "i:c1"]);
  });
});
