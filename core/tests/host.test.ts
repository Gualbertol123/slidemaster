/* The core worker's host (src/worker/host.ts, PLAN S2.4) in this thread, through the same RPC as a real worker:
   it owns the workbook, the shared document and undo/redo; the page receives slices, table HTML and document
   snapshots, in that order. Two hosts share an in-memory helper (two people). */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Port, pair, transfer } from "../src/rpc/port";
import { serve } from "../src/worker/host";
import { fold } from "../src/model/fold";
import { FakeDeck } from "./fakedeck";
import type { CoreEvents, CoreMethods, DocEvent, PageEvents, PageMethods, StageSlide } from "../src/rpc/messages";
import type { Op, WorkbookDoc } from "../src/model/types";
import { A1 } from "../src/xlsx/util";
import { platform, setPlatform } from "../src/platform";
import type { ImgMeta } from "../src/xlsx/drawing";

const here = path.dirname(fileURLToPath(import.meta.url));
const book = (n: string) => { const b = fs.readFileSync(path.join(here, "../../tests/corpus/workbooks", n)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const tick = () => new Promise(r => setTimeout(r, 5));
async function until(f: () => boolean, ms = 5000) { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error("timeout"); await tick(); } }

/** an in-memory helper's deck storage (fakedeck.ts, as helper/slidebuilder/decks.py); `doc` = everything on it, folded */
let writers = 0;
function server() {
  const deck = new FakeDeck("report.xlsx-0123456789", "report.xlsx");
  return { deck, get doc() { return fold(deck.snap, deck.records()).doc; },
    open: () => deck.open(`p${++writers}@pc#${"abcdefgh".slice(writers % 8)}${"a".repeat(writers % 8)}`) };
}
function page(srv: ReturnType<typeof server>, who: string) {
  const [a, b] = pair();
  const host = serve(new Port<CoreMethods, PageMethods, PageEvents, CoreEvents>(b), { autoTail: false });
  const port = new Port<PageMethods, CoreMethods, CoreEvents, PageEvents>(a);
  const api = srv.deck.api(); void who;
  port.handle("deckSnapshot", () => api.snapshot(""));
  port.handle("deckTail", x => api.tail(x.key, x.since));
  port.handle("deckAppend", x => api.append(x.key, x.writer, x.record));
  port.handle("deckCompact", x => api.compact(x.key, x.baseGen, x.snapshot));
  port.handle("deckRotate", x => api.rotate(x.key, x.writer));
  port.handle("digitWidth", () => 0);
  port.handle("convertPicture", () => null);
  port.handle("analyzeImages", () => []);
  // a snapshot carries the document only when it changed: the page keeps the last one (as app.ts does)
  const seen: { k: string; v: unknown }[] = [], docs: (DocEvent & { view: WorkbookDoc })[] = [];
  let view = null as unknown as WorkbookDoc;
  port.on("slices", v => seen.push({ k: "slices", v }));
  port.on("stage", v => seen.push({ k: "stage", v }));
  port.on("doc", v => { seen.push({ k: "doc", v }); if (v.view) view = v.view; docs.push({ ...v, view }); });
  return { port, seen, docs, host, last: () => docs[docs.length - 1] };
}
const inputs = { defaults: {}, logoSrc: "", version: "", workbook: "report.xlsx" };

describe("core host", () => {
  it("opens a workbook, owns the document and its history, and sends slices, then the snapshot, then the slide on the stage", async () => {
    const srv = server(), p = page(srv, "anna");
    await p.port.call("init", { served: true, client: "c1", me: "anna" });
    const info = await p.port.call("index", transfer({ buf: book("report.xlsx") }, []));
    expect(info.meta.length).toBeGreaterThan(0);
    await until(() => p.seen.some(e => e.k === "slices"));
    const preset = await p.port.call("defaultPreset", {});
    expect(preset.tables.length).toBeGreaterThan(0);
    // by number: the workbook being opened (S2.6: the page asks the worker instead of laying out its mirror)
    expect((await p.port.call("defaultPreset", { book: info.book })).tables.map(t => t.sheet)).toEqual(preset.tables.map(t => t.sheet));
    const st = await p.port.call("start", { name: "report.xlsx", deck: srv.open(), preset, inputs, stage: { slide: 0, known: [] } });
    expect(st.view.preset).toEqual(preset);
    expect(st.history).toEqual({ undo: 0, redo: 0, undoLabel: "", redoLabel: "" });
    // the first redraw: the slices, the snapshot, then the stage's slide, sent unasked (S4.1)
    await until(() => p.seen.some(e => e.k === "stage"));
    const firstSlices = p.seen.findIndex(e => e.k === "slices"), firstDoc = p.seen.findIndex(e => e.k === "doc"), firstStage = p.seen.findIndex(e => e.k === "stage");
    expect(firstSlices).toBeGreaterThanOrEqual(0); expect(firstDoc).toBeGreaterThan(firstSlices); expect(firstStage).toBeGreaterThan(firstDoc);
    expect((p.seen[firstStage].v as StageSlide).layers.some(l => l.table !== null)).toBe(true);

    // an edit: applied by the owner, undoable, saved through the page
    const sheet = preset.tables[0].sheet, n0 = p.docs.length;
    const r = await p.port.call("apply", { label: "Bold", ops: [{ op: "cell.patch", sheet, ref: "C5", patch: { b: true } } as Op] });
    expect(r.changed).toBe(true);
    await until(() => p.docs.length > n0);
    expect(p.last().change?.local).toBe(true); expect(p.last().ack).toBe(1);
    expect(p.last().view.edits[sheet].C5).toEqual({ b: true });
    expect(p.last().history).toMatchObject({ undo: 1, redo: 0, undoLabel: "Bold" });
    await p.port.call("flush", {});
    expect(srv.doc.edits[sheet].C5).toEqual({ b: true });
    // nothing to change: no history step, but the page still gets its acknowledgement
    const n1 = p.docs.length;
    expect((await p.port.call("apply", { label: "Nothing", ops: [{ op: "slide.patch", id: "no such slide", patch: { title: "x" } } as Op] })).changed).toBe(false);
    await until(() => p.docs.length > n1); expect(p.last().ack).toBe(2); expect(p.last().history.undo).toBe(1);

    // undo / redo with labels
    expect(await p.port.call("undo", { redo: false })).toEqual({ label: "Bold", changed: true });
    await until(() => !p.last().view.edits[sheet]?.C5?.b);
    expect(p.last().history).toMatchObject({ undo: 0, redo: 1, redoLabel: "Bold" });
    expect(await p.port.call("undo", { redo: true })).toEqual({ label: "Bold", changed: true });
    await until(() => !!p.last().view.edits[sheet]?.C5?.b);

    // slider drags within 1.5 s are one step
    for (const radius of [10, 20, 30]) await p.port.call("apply", { label: "Radius", ops: [{ op: "style.patch", patch: { radius } } as Op], coalesce: "radius" });
    await until(() => p.last().view.style.radius === 30);
    expect(p.last().history).toMatchObject({ undo: 2, undoLabel: "Radius" });
    await p.port.call("undo", { redo: false });
    await until(() => p.last().view.style.radius !== 30);
    expect(p.last().view.style.radius).toBeUndefined();

    // a changed table: the stage's slide comes again unasked, its table drawn anew (a new layer key)
    const tableKeys = () => new Set([...p.seen].filter(e => e.k === "stage").flatMap(e => (e.v as StageSlide).layers.filter(l => l.table !== null).map(l => l.key)));
    const before = tableKeys();
    await p.port.call("apply", { label: "Fill", ops: [{ op: "cell.patch", sheet, ref: "D6", patch: { fill: "#FF0000" } } as Op] });
    await until(() => p.last().view.edits[sheet]?.D6?.fill === "#FF0000");
    await until(() => [...tableKeys()].some(k => !before.has(k)));

    // column widths of one design (no change of tableKey): a new key, so the stage never shows the old drawing
    const id = preset.tables[0].id, k0 = tableKeys(), wide = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [String(i + 1), 250]));
    await p.port.call("apply", { label: "Width", ops: [{ op: "table.patch", id, patch: { sizes: { glass: { cols: wide }, excel: { cols: wide }, clean: { cols: wide } } } } as Op] });
    await until(() => [...tableKeys()].some(k => !k0.has(k)));
  });

  it("two people: each sees the other's change, and undo reverts only one's own", async () => {
    const srv = server(), a = page(srv, "anna"), b = page(srv, "bob");
    for (const [p, me] of [[a, "anna"], [b, "bob"]] as const) {
      await p.port.call("init", { served: true, client: me, me });
      await p.port.call("index", { buf: book("report.xlsx") });
    }
    const preset = await a.port.call("defaultPreset", {}), sheet = preset.tables[0].sheet;
    await a.port.call("start", { name: "report.xlsx", deck: srv.open(), preset, inputs }); await a.port.call("flush", {});
    await b.port.call("start", { name: "report.xlsx", deck: srv.open(), preset: null, inputs });
    await a.port.call("apply", { label: "A1", ops: [{ op: "cell.patch", sheet, ref: "C5", patch: { b: true } } as Op] }); await a.port.call("flush", {});
    await b.port.call("apply", { label: "B1", ops: [{ op: "cell.patch", sheet, ref: "C5", patch: { i: true } } as Op] }); await b.port.call("flush", {});
    await a.port.call("poll", {});
    await until(() => !!a.last().view.edits[sheet]?.C5?.i);
    expect(a.last().change?.by).toBe("bob");
    await a.port.call("undo", { redo: false }); await a.port.call("flush", {});
    expect(srv.doc.edits[sheet].C5).toEqual({ i: true });
  });

  it("an unreadable file is refused with its code", async () => {
    const p = page(server(), "anna");
    await p.port.call("init", { served: false, client: "c", me: "anna" });
    const err = await p.port.call("index", { buf: new TextEncoder().encode("not a zip").buffer }).catch(e => e);
    expect((err as { code?: string }).code).toBe("NOTZIP");
  });
});

describe("opening another workbook while one is open", () => {
  it("calls about the workbook being opened read that one; the open one's history does not carry over", async () => {
    const srv = server(), p = page(srv, "anna");
    await p.port.call("init", { served: true, client: "c1", me: "anna" });
    const a = await p.port.call("index", { buf: book("report.xlsx") }), preset = await p.port.call("defaultPreset", {});
    await p.port.call("start", { name: "report.xlsx", deck: srv.open(), preset, inputs });
    await p.port.call("apply", { label: "Bold", ops: [{ op: "cell.patch", sheet: preset.tables[0].sheet, ref: "C5", patch: { b: true } } as Op] });
    await until(() => p.last().history.undo === 1);
    // B is indexed (big.xlsx is "big": its sheets are read on demand) while A stays open
    const b = await p.port.call("index", { buf: book("big.xlsx") });
    expect(b.book).not.toBe(a.book);
    const names = b.meta.map(m => m.name);
    const read = await p.port.call("getSheetMeta", { book: b.book, names, load: true });
    expect(read.sheets.map(s => s.name)).toEqual(names);                        // B's sheets, not A's
    await p.port.call("ensure", { book: b.book, names });
    await expect(p.port.call("ensure", { book: 999, names })).rejects.toThrow(/no longer open/);
    const slicesForB = p.seen.filter(e => e.k === "slices" && (e.v as { book: number }).book === b.book);
    expect(slicesForB.length).toBeGreaterThan(0);
    const st = await p.port.call("start", { name: "big.xlsx", deck: new FakeDeck("big.xlsx-0123456789", "big.xlsx").open("me@pc#mmmmmmmm"), preset: null, inputs: { ...inputs, workbook: "big.xlsx" } });
    expect(st.history).toEqual({ undo: 0, redo: 0, undoLabel: "", redoLabel: "" });   // as v3: a new workbook, no history
    await expect(p.port.call("getSheetMeta", { book: a.book, names, load: false })).rejects.toThrow(/no longer open/);
  });

  it("after an undo the stage draws the restored state again", async () => {
    const srv = server(), p = page(srv, "anna");
    await p.port.call("init", { served: true, client: "c1", me: "anna" });
    await p.port.call("index", { buf: book("report.xlsx") });
    const preset = await p.port.call("defaultPreset", {}), sheet = preset.tables[0].sheet;
    await p.port.call("start", { name: "report.xlsx", deck: srv.open(), preset, inputs });
    // the stage's layers are keyed by what they are drawn from: the keys of the restored state come back after the undo
    const keys = async () => (await p.port.call("stage", { slide: 0, known: [] }))!.layers.map(l => l.key).join("\n");
    const before = await keys();
    await p.port.call("apply", { label: "Fill", ops: [{ op: "cell.patch", sheet, ref: "C5", patch: { fill: "#FF0000" } } as Op] });
    await until(() => !!p.last().view.edits[sheet]?.C5);
    expect(await keys()).not.toBe(before);                                             // the drawing follows the snapshot
    await p.port.call("undo", { redo: false });
    await until(() => !p.last().view.edits[sheet]?.C5);
    expect(await keys()).toBe(before);
  });
});

describe("what the wizard and the formula bar read (S2.5)", () => {
  it("summaries, windows, suggestions, cells and table sizes come from the worker's sheets", async () => {
    const { readWorkbook } = await import("../src/xlsx/workbook");
    const { sheetInfo, sheetWindow, cellInfo, tableSize } = await import("../src/xlsx/sheetview");
    const { detectTables } = await import("../src/xlsx/detect");
    const { defaultPreset } = await import("../src/model/preset");
    for (const name of ["report.xlsx", "deck20.xlsx", "edge-formats.xlsx", "edge-pictures.xlsx"]) {
      const full = await readWorkbook(book(name)), p = page(server(), "anna");
      await p.port.call("init", { served: false, client: "c", me: "anna" });
      const info = await p.port.call("index", { buf: book(name) });
      const names = info.meta.map(m => m.name), tables = defaultPreset(full).tables;
      const meta = await p.port.call("getSheetMeta", { book: info.book, names, load: true, tables });
      expect(meta.sheets).toEqual(full.sheets.map(sheetInfo));
      expect(meta.sizes).toEqual(tables.map(t => [t.id, tableSize(full, t)]));
      // the same sizes as resolveTable, also for a marker table with its own sizes and for grown ranges
      const { resolveTable, gToRange } = await import("../src/model/preset");
      const more = [...tables, ...full.sheets.flatMap(S => S.tables.slice(0, 1).flatMap(T => [
        { id: "m" + S.name, sheet: S.name, kind: "markers" as const, anchor: "", index: 0, cols: { [String(T.cols[0])]: 99 } },
        { id: "g" + S.name, sheet: S.name, kind: "range" as const, range: gToRange(T.g), grow: true },
      ]))];
      expect(more.map(t => tableSize(full, t))).toEqual(more.map(t => { const L = resolveTable(full, t as never); return L ? [L.rows.length, L.cols.length] : null; }));
      for (const S of full.sheets) {
        const R2 = Math.max(S.tables.length ? 30 : 20, sheetInfo(S).used.r2 + 3), C2 = Math.max(10, sheetInfo(S).used.c2 + 2);
        expect(await p.port.call("getSheetWindow", { book: info.book, sheet: S.name, r0: 1, r1: R2, c0: 1, c1: C2 })).toEqual(sheetWindow(S, 1, R2, 1, C2));
        expect(await p.port.call("detectTables", { book: info.book, sheet: S.name })).toEqual(detectTables(S));
        for (const ref of ["A1", "B2", "C5", "D6", "H10"]) expect(await p.port.call("getCell", { book: info.book, sheet: S.name, ref })).toEqual(cellInfo(S, ref));
      }
      expect(await p.port.call("getSheetWindow", { book: info.book, sheet: "no such sheet", r0: 1, r1: 2, c0: 1, c1: 2 })).toBeNull();
    }
  }, 120_000);
  it("a window holds the cells the preview shows: text as Excel shows it, fill, colour, bold, numbers right", async () => {
    const { readWorkbook } = await import("../src/xlsx/workbook");
    const { sheetWindow } = await import("../src/xlsx/sheetview");
    const wb = await readWorkbook(book("edge-formats.xlsx")), S = wb.sheets[0], w = sheetWindow(S, 1, 30, 1, 6);
    expect(w.rows.length).toBe(30); expect(w.cols.length).toBe(6);
    const texts = w.cells.map(c => c.text);
    expect(texts).toContain("1.234.568");                         // "#,##0" as Excel shows it
    expect(w.cells.some(c => c.right)).toBe(true);
  });

  it("start is tied to the workbook being opened: an older one is refused and the open document stays (milestone review)", async () => {
    const srv = server(), p = page(srv, "anna");
    await p.port.call("init", { served: true, client: "c1", me: "anna" });
    const first = await p.port.call("index", transfer({ buf: book("report.xlsx") }, []));
    const preset = await p.port.call("defaultPreset", { book: first.book });
    await p.port.call("start", { book: first.book, name: "report.xlsx", deck: srv.open(), preset, inputs });
    const a = await p.port.call("index", transfer({ buf: book("report.xlsx") }, []));
    const b = await p.port.call("index", transfer({ buf: book("report.xlsx") }, []));
    expect(b.book).toBeGreaterThan(a.book);
    await expect(p.port.call("start", { book: a.book, name: "other.xlsx", deck: srv.open(), preset: null, inputs })).rejects.toThrow(/no longer being opened/);
    // the first workbook's document is still the open one: an edit reaches it
    const sheet = preset.tables[0].sheet;
    expect((await p.port.call("apply", { label: "B", ops: [{ op: "cell.patch", sheet, ref: "C5", patch: { b: true } } as Op] })).changed).toBe(true);
  });

  it("a crashed other side: the calls waiting for it fail (failPending)", async () => {
    const [x, y] = pair();
    const callee = new Port<{ hang(a: Record<string, never>): number }, object, object, object>(y);
    callee.handle("hang", () => new Promise<number>(() => { /* never answers */ }));
    const caller = new Port<object, { hang(a: Record<string, never>): number }, object, object>(x);
    const pending = caller.call("hang", {});
    caller.failPending(new Error("stopped"));
    await expect(pending).rejects.toThrow("stopped");
  });
});

describe("the stage's slide (S4.1)", () => {
  async function opened() {
    const srv = server(), p = page(srv, "anna");
    await p.port.call("init", { served: true, client: "c1", me: "anna" });
    await p.port.call("index", transfer({ buf: book("report.xlsx") }, []));
    const preset = await p.port.call("defaultPreset", {});
    await p.port.call("start", { name: "report.xlsx", deck: srv.open(), preset, inputs });
    const slide = preset.slides.findIndex(s => s.tables.length > 1);
    return { p, preset, slide: slide >= 0 ? slide : preset.slides.findIndex(s => s.tables.length) };
  }
  const tables = (s: Awaited<ReturnType<typeof stageOf>>) => s!.layers.filter(l => l.table !== null);
  const stageOf = (p: ReturnType<typeof page>, slide: number, known: string[] = []) => p.port.call("stage", { slide, known, today: "13 Oct 2026", nodes: true });

  it("each table is a layer of its own, kept by its key until its cells change; text boxes are layers too", async () => {
    const { p, preset, slide } = await opened();
    const one = await stageOf(p, slide);
    expect(one!.id).toBe(preset.slides[slide].id);
    const t1 = tables(one);
    expect(t1.map(l => l.table)).toEqual(preset.slides[slide].tables.map((_, i) => i));
    for (const l of t1) {
      expect(l.box!.w).toBeGreaterThan(0);
      expect(l.nodes.some(n => n.t === "hit" && n.kind === "t")).toBe(true);           // the cells, in table px
      expect(l.svg.join("")).toMatch(/<rect [^>]*class="t" data-hit="t" data-id="\d+,\d+"><desc>/);   // the markup the page shows
      expect(l.svg.join("")).toContain(`id="t${l.table}-`);                                    // its ids its own on the page
    }
    // the markup alone unless the nodes are asked for (the page draws the markup)
    expect((await p.port.call("stage", { slide, known: [], today: "13 Oct 2026" }))!.layers.filter(l => l.table !== null).every(l => !l.nodes.length && l.svg.length)).toBe(true);
    // asked again with nothing changed: the same keys (the page keeps the layers it has)
    expect(tables(await stageOf(p, slide)).map(l => l.key)).toEqual(t1.map(l => l.key));
    // a cell of the first table changes: its table gets a new key; every other table keeps its own – the second table
    // of this slide (the same sheet: a table is keyed by the edits of its own cells) and a table of another sheet
    const L0 = preset.tables.find(t => t.id === preset.slides[slide].tables[0])!;
    const other = preset.slides.findIndex(s => s.tables.some(id => preset.tables.find(t => t.id === id)!.sheet !== L0.sheet));
    const before = tables(await stageOf(p, other)).map(l => l.key);
    const cell = t1[0].nodes.find(n => n.t === "hit" && n.kind === "t") as { id: string }, [r, c] = cell.id.split(",").map(Number);
    await p.port.call("apply", { label: "Bold", ops: [{ op: "cell.patch", sheet: L0.sheet, ref: A1(r, c), patch: { b: true } } as Op] });
    await p.port.call("flush", {});
    const t2 = tables(await stageOf(p, slide));
    expect(t2[0].key).not.toBe(t1[0].key);
    expect(preset.tables.find(t => t.id === preset.slides[slide].tables[1])!.sheet).toBe(L0.sheet);
    expect(t2.slice(1).map(l => l.key)).toEqual(t1.slice(1).map(l => l.key));
    expect(other).toBeGreaterThanOrEqual(0);
    expect(tables(await stageOf(p, other)).map(l => l.key)).toEqual(before);
    // a text box with a bubble above the first table: one layer from its bubble's hit to its text
    const id = preset.slides[slide].id, key = preset.slides[slide].tables[0] + ":top";
    await p.port.call("apply", { label: "Add text box", ops: [{ op: "slide.patch", id, patch: { notes: { [key]: { text: "Loans grew", bubble: true } } } } as Op] });
    const s3 = await stageOf(p, slide), notes = s3!.layers.filter(l => l.note);
    expect(notes.length).toBe(1);
    const hits = notes[0].nodes.filter(n => n.t === "hit") as { id: string; label?: string }[];
    expect(hits.map(h => h.id.split(" ")[0])).toEqual([expect.stringMatching(/notebub|gls/), "tnote"]);
    expect(hits[1].label).toBe("Loans grew");
    // nothing of the text box is left in the furniture
    expect(s3!.layers.filter(l => !l.note && l.table === null).flatMap(l => l.nodes).some(n => n.t === "hit" && /^tnote\b|notebub/.test(n.id))).toBe(false);
    expect(notes[0].box!.w).toBeGreaterThan(0);
  });
  it("tables alike in every way but their sheet (deck20) are kept apart: each slide shows its own numbers", async () => {
    const srv = server(), p = page(srv, "anna");
    await p.port.call("init", { served: true, client: "c1", me: "anna" });
    await p.port.call("index", transfer({ buf: book("deck20.xlsx") }, []));
    const preset = await p.port.call("defaultPreset", {});
    await p.port.call("start", { name: "deck20.xlsx", deck: srv.open(), preset, inputs });
    const content = preset.slides.flatMap((s, i) => s.tables.length ? [i] : []).slice(0, 3);
    const cells = async (slide: number) => (await p.port.call("stage", { slide, known: [], nodes: true }))!.layers.filter(l => l.table !== null)
      .flatMap(l => l.nodes.filter(n => n.t === "hit" && n.kind === "t").map(n => (n as { label?: string }).label)).join("|");
    const seen = await Promise.all(content.map(cells));
    expect(new Set(seen).size).toBe(seen.length);
    expect(await cells(content[0])).toBe(seen[0]);                                   // and asked again: the same
  });
  it("many edits of one table keep a few of its drawings, not one per edit (the worker's memory)", async () => {
    const { p, preset, slide } = await opened();
    const L0 = preset.tables.find(t => t.id === preset.slides[slide].tables[0])!;
    const cell = tables(await stageOf(p, slide))[0].nodes.find(n => n.t === "hit" && n.kind === "t") as { id: string }, [r, c] = cell.id.split(",").map(Number);
    for (let k = 0; k < 12; k++) {
      await p.port.call("apply", { label: "Text", ops: [{ op: "cell.patch", sheet: L0.sheet, ref: A1(r, c), patch: { text: "v" + k, orig: "x" } } as Op] });
      await stageOf(p, slide);
    }
    // the worker keeps three drawings of that table (the current one and two for undo), whatever the number of edits
    const cache = (p.host as unknown as { stageCache: Map<string, unknown> }).stageCache;
    expect([...cache.keys()].filter(k => k.startsWith(L0.sheet + "|" + L0.id + "|")).length).toBe(3);
    // an undo shows a kept drawing: the same key as two edits ago, not built again
    const two = tables(await stageOf(p, slide))[0].key;
    await p.port.call("apply", { label: "Text", ops: [{ op: "cell.patch", sheet: L0.sheet, ref: A1(r, c), patch: { text: "w", orig: "x" } } as Op] });
    await stageOf(p, slide);
    await p.port.call("undo", { redo: false });
    expect(tables(await stageOf(p, slide))[0].key).toBe(two);
  });
  it("a logo the page is slow to read holds nothing: the start, the snapshot and the stage's slide come; the slide again once it is read", async () => {
    const srv = server(), p = page(srv, "anna");
    // the page reads pictures for the worker (core.worker.ts installs this): it does not answer yet
    let answer: (v: [string, ImgMeta][]) => void = () => undefined;
    const before = platform();
    setPlatform({ ...before, images: () => new Promise<[string, ImgMeta][]>(r => { answer = r; }) });
    try {
    const stages: unknown[] = [];
    p.port.on("stage", s => stages.push(s));
    await p.port.call("init", { served: true, client: "c1", me: "anna" });
    await p.port.call("index", transfer({ buf: book("report.xlsx") }, []));
    const preset = await p.port.call("defaultPreset", {}), slide = preset.slides.findIndex(s => s.tables.length);
    const t0 = Date.now();
    const st = await p.port.call("start", { name: "report.xlsx", deck: srv.open(), preset, inputs: { ...inputs, logoSrc: "/assets/logo.png" }, stage: { slide, known: [] } });
    expect(st.view.preset).toEqual(preset);
    expect(Date.now() - t0).toBeLessThan(1000);                                               // not held by the logo
    const s = await p.port.call("stage", { slide, known: [], nodes: true });
    expect(s!.layers.length).toBeGreaterThan(0);
    expect(JSON.stringify(s!.layers)).not.toContain('"logo"');                                 // drawn without it for now
    const n = stages.length;
    answer([["/assets/logo.png", { round: false, alpha: false, w: 400, h: 100 }]]);
    await until(() => stages.slice(n).some(x => JSON.stringify(x).includes("sbimg:logo-")));     // and sent again with it
    } finally { setPlatform(before); }
  });
  it("a late font's redraw: fontsSettling stays true until the slide drawn again has been sent (the capture tools wait)", async () => {
    const before = platform();
    const text = { ...before.text, onLate: null as (() => void) | null, settling: false };
    setPlatform({ ...before, text });
    try {
      const { p, slide } = await opened();
      const host = p.host as unknown as { lateRedraws: number };
      const stages: unknown[] = [];
      p.port.on("stage", s => stages.push(s));
      await p.port.call("stage", { slide, known: [], today: "13 Oct 2026" });                // the page shows this slide
      expect(await p.port.call("fontsSettling", {})).toBe(false);
      text.settling = true;                                                                   // a face missed its budget
      expect(await p.port.call("fontsSettling", {})).toBe(true);
      text.settling = false; text.onLate!();                                                  // it came: the redraw starts
      expect(host.lateRedraws).toBe(1);                                                       // …not on the page yet: still settling
      await until(() => stages.length > 0 && host.lateRedraws === 0);
      expect(await p.port.call("fontsSettling", {})).toBe(false);
    } finally { setPlatform(before); }
  });
  it("pictures the page has are not sent again; a slide that does not exist is null", async () => {
    const { p, slide } = await opened();
    const one = await stageOf(p, slide);
    // layers the page names (it shows them) come without their markup; the others with theirs
    const named = one!.layers.filter(l => l.table !== null).map(l => l.key);
    const again = await p.port.call("stage", { slide, known: [], have: named });
    expect(again!.layers.map(l => named.includes(l.key) ? l.svg.length === 0 : l.svg.length > 0).every(Boolean)).toBe(true);
    const ids = Object.keys(one!.images);
    expect(Object.keys((await stageOf(p, slide, ids))!.images)).toEqual([]);
    expect(await stageOf(p, 999)).toBe(null);
  });
});
