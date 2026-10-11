/* The core worker's host (src/worker/host.ts, PLAN S2.4) in this thread, through the same RPC as a real worker:
   it owns the workbook, the shared document and undo/redo; the page receives slices, table HTML and document
   snapshots, in that order. Two hosts share an in-memory helper (two people). */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Port, pair, transfer } from "../src/rpc/port";
import { serve } from "../src/worker/host";
import { applyOps, emptyDoc } from "../src/model/ops";
import type { CoreEvents, CoreMethods, DocEvent, PageEvents, PageMethods } from "../src/rpc/messages";
import type { Op, WorkbookDoc } from "../src/model/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const book = (n: string) => { const b = fs.readFileSync(path.join(here, "../../tests/corpus/workbooks", n)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const tick = () => new Promise(r => setTimeout(r, 5));
async function until(f: () => boolean, ms = 5000) { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error("timeout"); await tick(); } }

/** an in-memory helper: applies ops to the latest document, like backend/slidebuilder/store.py */
function server() {
  let doc: WorkbookDoc = emptyDoc("report.xlsx");
  return {
    get doc() { return doc; },
    getDoc: (since?: number) => since === doc.rev ? null : structuredClone(doc),
    postOps: (ops: Op[], who: string) => { const r = applyOps(doc, ops); if (r.applied) { r.doc.rev = doc.rev + 1; r.doc.updatedBy = who; r.doc.log = [...(doc.log || []), { rev: r.doc.rev, by: who, at: 0 }]; } doc = r.doc; return { doc: structuredClone(doc) }; },
  };
}
function page(srv: ReturnType<typeof server>, who: string) {
  const [a, b] = pair();
  serve(new Port<CoreMethods, PageMethods, PageEvents, CoreEvents>(b));
  const port = new Port<PageMethods, CoreMethods, CoreEvents, PageEvents>(a);
  port.handle("getDoc", x => srv.getDoc(x.since));
  port.handle("postOps", x => srv.postOps(x.ops, who));
  port.handle("digitWidth", () => 0);
  port.handle("convertPicture", () => null);
  port.handle("analyzeImages", () => []);
  const seen: { k: string; v: unknown }[] = [], docs: DocEvent[] = [];
  const html = new Map<string, string>();
  port.on("slices", v => seen.push({ k: "slices", v }));
  port.on("html", v => { seen.push({ k: "html", v }); for (const [id, kind, key, h] of v) html.set(id + "|" + kind + "|" + key, h); });
  port.on("doc", v => { seen.push({ k: "doc", v }); docs.push(v); });
  return { port, seen, docs, html, last: () => docs[docs.length - 1] };
}
const inputs = { defaults: {}, logoSrc: "", version: "", workbook: "report.xlsx" };

describe("core host", () => {
  it("opens a workbook, owns the document and its history, and sends slices, then HTML, then the snapshot", async () => {
    const srv = server(), p = page(srv, "anna");
    await p.port.call("init", { served: true, client: "c1", me: "anna" });
    const info = await p.port.call("index", transfer({ buf: book("report.xlsx") }, []));
    expect(info.meta.length).toBeGreaterThan(0);
    await until(() => p.seen.some(e => e.k === "slices"));
    const preset = await p.port.call("defaultPreset", {});
    expect(preset.tables.length).toBeGreaterThan(0);
    const st = await p.port.call("start", { name: "report.xlsx", doc: srv.getDoc()!, preset, inputs });
    expect(st.view.preset).toEqual(preset);
    expect(st.history).toEqual({ undo: 0, redo: 0, undoLabel: "", redoLabel: "" });
    // the first redraw: HTML for every table before the snapshot
    const firstDoc = p.seen.findIndex(e => e.k === "doc"), firstHtml = p.seen.findIndex(e => e.k === "html");
    expect(firstHtml).toBeGreaterThanOrEqual(0); expect(firstHtml).toBeLessThan(firstDoc);
    expect(p.html.size).toBeGreaterThanOrEqual(preset.tables.length);

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

    // a changed table: new HTML for it arrives before the snapshot that shows it
    const before = new Set(p.html.keys()), oldHtml = new Set(p.html.values());
    await p.port.call("apply", { label: "Fill", ops: [{ op: "cell.patch", sheet, ref: "D6", patch: { fill: "#FF0000" } } as Op] });
    await until(() => p.last().view.edits[sheet]?.D6?.fill === "#FF0000");
    expect([...p.html.keys()].some(k => !before.has(k))).toBe(true);
    expect([...p.html].filter(([k]) => !before.has(k)).some(([, h]) => !oldHtml.has(h))).toBe(true);

    // column widths of one design (no change of tableKey): a new key, so the page never shows the old HTML
    const id = preset.tables[0].id, keysOf = () => [...p.html.keys()].filter(k => k.startsWith(id + "|html|"));
    const k0 = new Set(keysOf()), wide = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [String(i + 1), 250]));
    await p.port.call("apply", { label: "Width", ops: [{ op: "table.patch", id, patch: { sizes: { glass: { cols: wide }, excel: { cols: wide }, clean: { cols: wide } } } } as Op] });
    await until(() => keysOf().some(k => !k0.has(k)));
  });

  it("two people: each sees the other's change, and undo reverts only one's own", async () => {
    const srv = server(), a = page(srv, "anna"), b = page(srv, "bob");
    for (const [p, me] of [[a, "anna"], [b, "bob"]] as const) {
      await p.port.call("init", { served: true, client: me, me });
      await p.port.call("index", { buf: book("report.xlsx") });
    }
    const preset = await a.port.call("defaultPreset", {}), sheet = preset.tables[0].sheet;
    await a.port.call("start", { name: "report.xlsx", doc: srv.getDoc()!, preset, inputs }); await a.port.call("flush", {});
    await b.port.call("start", { name: "report.xlsx", doc: srv.getDoc()!, preset: null, inputs });
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
    await p.port.call("start", { name: "report.xlsx", doc: srv.getDoc()!, preset, inputs });
    await p.port.call("apply", { label: "Bold", ops: [{ op: "cell.patch", sheet: preset.tables[0].sheet, ref: "C5", patch: { b: true } } as Op] });
    await until(() => p.last().history.undo === 1);
    // B is indexed (big.xlsx is "big": its sheets are read on demand) while A stays open
    const b = await p.port.call("index", { buf: book("big.xlsx") });
    expect(b.book).not.toBe(a.book);
    const names = b.meta.map(m => m.name);
    const whole = await p.port.call("sheets", { book: b.book, names });
    expect(whole.sheets.map(s => s.name)).toEqual(names);                       // B's sheets, not A's
    await p.port.call("ensure", { book: b.book, names });
    await expect(p.port.call("ensure", { book: 999, names })).rejects.toThrow(/no longer open/);
    const slicesForB = p.seen.filter(e => e.k === "slices" && (e.v as { book: number }).book === b.book);
    expect(slicesForB.length).toBeGreaterThan(0);
    const st = await p.port.call("start", { name: "big.xlsx", doc: emptyDoc("big.xlsx"), preset: null, inputs: { ...inputs, workbook: "big.xlsx" } });
    expect(st.history).toEqual({ undo: 0, redo: 0, undoLabel: "", redoLabel: "" });   // as v3: a new workbook, no history
    await expect(p.port.call("sheets", { book: a.book, names })).rejects.toThrow(/no longer open/);
  });

  it("after an undo the page gets the HTML of the restored state again", async () => {
    const srv = server(), p = page(srv, "anna");
    await p.port.call("init", { served: true, client: "c1", me: "anna" });
    await p.port.call("index", { buf: book("report.xlsx") });
    const preset = await p.port.call("defaultPreset", {}), sheet = preset.tables[0].sheet;
    await p.port.call("start", { name: "report.xlsx", doc: srv.getDoc()!, preset, inputs });
    // the page keeps the latest key per table: the keys of the restored state must arrive again after the undo
    const latest = () => new Map([...p.seen].filter(e => e.k === "html").flatMap(e => e.v as [string, string, string, string][]).map(([id, kind, key]) => [id + "|" + kind, key]));
    const before = latest();
    await p.port.call("apply", { label: "Fill", ops: [{ op: "cell.patch", sheet, ref: "C5", patch: { fill: "#FF0000" } } as Op] });
    await until(() => !!p.last().view.edits[sheet]?.C5);
    expect([...latest()].some(([k, v]) => before.get(k) !== v)).toBe(true);
    await p.port.call("undo", { redo: false });
    await until(() => !p.last().view.edits[sheet]?.C5);
    expect(latest()).toEqual(before);
  });
});
