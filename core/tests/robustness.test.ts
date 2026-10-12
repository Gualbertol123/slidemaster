/* Races, failures and slow shares around the core worker (the pre-M3 review, docs/next/review-pre-M3.md, findings
   5 and 7–12; each test failed on 6aafcb9): overlapping opens, late poll answers, a failed background read, a big
   workbook whose first slides read no sheet, a worker that stopped, a refused start, edits queued when another
   workbook is opened, snapshots without an unchanged document; plus encrypted files, the history's 200 steps and
   text-box fitting (05 §4 UN-05, NB-14). */
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, zipSync } from "fflate";
import { Port, pair, transfer, type Wire } from "../src/rpc/port";
import { serve } from "../src/worker/host";
import { resetPlatform, setPlatform, type NoteMeasure, type TextMeasurer } from "../src/platform";
import { applyOps, emptyDoc } from "../src/model/ops";
import { DocSync } from "../src/sync/docsync";
import { History, MAX_STEPS } from "../src/sync/history";
import { indexWorkbook, isEncryptedPackage } from "../src/xlsx/workbook";
import { MirrorWorkbook } from "../src/xlsx/mirror";
import { fitNoteSize } from "../src/render/slide";
import type { CoreEvents, CoreMethods, DocEvent, PageEvents, PageMethods } from "../src/rpc/messages";
import type { Op, Preset, WorkbookDoc } from "../src/model/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const bytes = (n: string) => new Uint8Array(fs.readFileSync(path.join(here, "../../tests/corpus/workbooks", n)));
const book = (n: string) => { const b = bytes(n); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const tick = () => new Promise(r => setTimeout(r, 5));
async function until(f: () => boolean, ms = 5000) { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error("timeout"); await tick(); } }
/** a workbook over the "big" size (sheets read on demand): the corpus file with 7 MB of padding */
const padded = (n: string) => { const files = unzipSync(bytes(n)); files["pad.bin"] = new Uint8Array(7 * 1048576); const z = zipSync(files, { level: 0 }); return z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength) as ArrayBuffer; };
const inputs = { defaults: {}, logoSrc: "", version: "", workbook: "x" };
const oneTable = (sheet: string): Preset => ({ sheets: [sheet], tables: [{ id: "t1", sheet, kind: "markers", anchor: "A1", index: 0 } as never], slides: [{ id: "s2", type: "content", title: null, subtitle: null, tables: ["t1"], layout: null } as never] });

/** a page connected to a host in this thread, with an in-memory helper */
function page() {
  const [a, b] = pair();
  serve(new Port<CoreMethods, PageMethods, PageEvents, CoreEvents>(b));
  const port = new Port<PageMethods, CoreMethods, CoreEvents, PageEvents>(a);
  let srv = emptyDoc("x");
  port.handle("getDoc", () => null);
  port.handle("postOps", x => { const r = applyOps(srv, x.ops); r.doc.rev = srv.rev + 1; srv = r.doc; return { doc: structuredClone(srv) }; });
  port.handle("digitWidth", () => 0);
  port.handle("convertPicture", () => null);
  port.handle("analyzeImages", () => []);
  const slices: CoreEvents["slices"][] = [], progress: string[] = [], errors: string[] = [], docs: DocEvent[] = [];
  port.on("slices", v => slices.push(v));
  port.on("progress", p => progress.push(p ? p.text : "<hide>"));
  port.on("error", e => errors.push(e.message));
  port.on("doc", v => docs.push(v));
  return { port, slices, progress, errors, docs };
}
afterEach(() => resetPlatform());

describe("opening", () => {
  it("overlapping index calls: each answer names its own workbook, the older one gives up", async () => {
    // as in the worker: the digit width is a round trip to the page, so the first index is still reading when the second comes
    setPlatform({ text: { maxDigitWidth: () => new Promise(r => setTimeout(() => r(7), 20)), noteFits: () => true } });
    const p = page();
    await p.port.call("init", { served: false, client: "c", me: "me" });
    const [ra, rb] = await Promise.allSettled([p.port.call("index", transfer({ buf: book("report.xlsx") }, [])), p.port.call("index", transfer({ buf: book("deck20.xlsx") }, []))]);
    expect(ra.status).toBe("rejected");
    expect((ra as PromiseRejectedResult).reason.code).toBe("SUPERSEDED");
    expect(rb.status).toBe("fulfilled");
    const ib = (rb as PromiseFulfilledResult<Awaited<ReturnType<CoreMethods["index"]>>>).value;
    expect(ib.meta.map(m => m.name)).toContain("SLIDE_01");
    const names = new Set(ib.meta.map(m => m.name)), dp = await p.port.call("defaultPreset", { book: ib.book });
    expect(dp.tables.length).toBeGreaterThan(0);
    expect(dp.tables.every(t => names.has(t.sheet))).toBe(true);          // deck20's tables, not report.xlsx's
    // the progress overlay is hidden at the end, whatever happened
    expect(p.progress[p.progress.length - 1]).toBe("<hide>");
  });

  it("a start refused before the switch says so (NOT_STARTED): the open document stays", async () => {
    const p = page();
    await p.port.call("init", { served: false, client: "c", me: "me" });
    const ia = await p.port.call("index", transfer({ buf: book("report.xlsx") }, []));
    await p.port.call("start", { book: ia.book, name: "x", doc: emptyDoc("x"), preset: await p.port.call("defaultPreset", { book: ia.book }), inputs });
    const ib = await p.port.call("index", transfer({ buf: book("deck20.xlsx") }, []));
    await p.port.call("index", transfer({ buf: book("report.xlsx") }, []));          // a newer open
    const e = await p.port.call("start", { book: ib.book, name: "y", doc: emptyDoc("y"), preset: null, inputs }).catch(x => x);
    expect(e.code).toBe("NOT_STARTED");
    // the first workbook's document still answers
    expect((await p.port.call("apply", { label: "x", ops: [{ op: "style.patch", patch: { radius: 5 } } as Op] })).changed).toBe(true);
  });

  it("a big workbook whose first slides read no sheet still gets its shared styles with the first sheet", async () => {
    const p = page();
    await p.port.call("init", { served: false, client: "c", me: "me" });
    const info = await p.port.call("index", transfer({ buf: padded("report.xlsx") }, []));
    expect(info.big).toBe(true);
    const wb = new MirrorWorkbook(info, async (b, names) => { await p.port.call("ensure", { book: b, names }); });
    await tick(); for (const e of p.slices) if (e.book === wb.book) wb.receive(e.shared, e.sheets);
    p.port.on("slices", e => { if (e.book === wb.book) wb.receive(e.shared, e.sheets); });
    const cover: Preset = { sheets: [], tables: [], slides: [{ id: "s1", type: "cover", title: "Cover", subtitle: null, tables: [], layout: null } as never] };
    await p.port.call("start", { book: info.book, name: "x", doc: emptyDoc("x"), preset: cover, inputs });
    await p.port.call("apply", { label: "Wizard changes", ops: [{ op: "preset.set", preset: oneTable(info.meta[0].name) }] });
    await until(() => wb.sheets.length > 0);
    expect(wb.shared).toBeTruthy();
  });

  it("a background read that fails hides the progress overlay and reports the error", async () => {
    // as in core.worker.ts: picture analysis is a call to the page (here it fails)
    setPlatform({ images: async () => { throw new Error("page could not decode a picture"); } });
    const p = page();
    await p.port.call("init", { served: true, client: "c", me: "me" });
    const info = await p.port.call("index", transfer({ buf: padded("edge-pictures.xlsx") }, []));
    await p.port.call("start", { book: info.book, name: "x", doc: emptyDoc("x"), preset: { sheets: [], tables: [], slides: [] }, inputs });
    await p.port.call("apply", { label: "Wizard changes", ops: [{ op: "preset.set", preset: oneTable(info.meta[0].name) }] });
    await until(() => p.errors.length > 0);
    await until(() => p.progress[p.progress.length - 1] === "<hide>");
    expect(p.errors[0]).toMatch(/decode a picture/);
  });
});

describe("snapshots", () => {
  it("carry the document only when it changed (a save-state change sends none)", async () => {
    const p = page();
    await p.port.call("init", { served: true, client: "c", me: "me" });
    const info = await p.port.call("index", transfer({ buf: book("report.xlsx") }, []));
    await p.port.call("start", { book: info.book, name: "x", doc: emptyDoc("x"), preset: await p.port.call("defaultPreset", { book: info.book }), inputs });
    const n = p.docs.length;
    await p.port.call("apply", { label: "R", ops: [{ op: "style.patch", patch: { radius: 7 } } as Op] });
    await p.port.call("flush", {});
    await until(() => p.docs[p.docs.length - 1]?.save === "saved");
    const after = p.docs.slice(n);
    expect(after[0].view?.style.radius).toBe(7);                       // the change: with its document
    expect(after.slice(1).every(d => d.view === undefined)).toBe(true);  // "saving", "saved" (revision only): without
  });
});

describe("DocSync on a slow share", () => {
  it("a late poll answer does not replace a newer server document", async () => {
    let doc: WorkbookDoc = emptyDoc("w.xlsx");
    const commit = (ops: Op[], by: string) => { const r = applyOps(doc, ops); r.doc.rev = doc.rev + 1; r.doc.updatedBy = by; doc = r.doc; return structuredClone(doc); };
    const slow: (() => void)[] = [];
    let slowNext = true;
    const api = { served: true,
      getDoc: (_n: string, since?: number) => { const snap = since === doc.rev ? null : structuredClone(doc);
        if (slowNext) { slowNext = false; return new Promise<WorkbookDoc | null>(r => slow.push(() => r(snap))); } return Promise.resolve(snap); },
      postOps: async (_n: string, ops: Op[]) => ({ doc: commit(ops, "me") }) };
    const s = new DocSync(api, "w.xlsx", structuredClone(doc), "c1", "me");
    commit([{ op: "cell.patch", sheet: "S", ref: "A1", patch: { b: true } } as Op], "bob");      // rev 1
    const p1 = s.poll();                                                                         // answered late (rev 1)
    commit([{ op: "cell.patch", sheet: "S", ref: "B2", patch: { i: true } } as Op], "bob");      // rev 2
    await s.poll();                                                                              // one poll at a time: skipped
    s.apply([{ op: "cell.patch", sheet: "S", ref: "C3", patch: { u: true } } as Op]); await s.flush();   // my save: rev 3
    slow.forEach(f => f()); await p1;
    expect(s.server.rev).toBe(3);
    expect((s.view.edits as Record<string, Record<string, unknown>>).S.B2).toEqual({ i: true });
    s.dispose();
  });

  it("a retired document (another workbook opened) keeps saving what it had queued", async () => {
    let fail = true, saved: Op[] = [];
    const api = { served: true, getDoc: async () => null,
      postOps: async (_n: string, ops: Op[]) => { if (fail) throw new Error("share unavailable"); saved = ops; return { doc: { ...emptyDoc("w"), rev: 1 } }; } };
    const s = new DocSync(api, "w", emptyDoc("w"), "c", "me");
    s.apply([{ op: "style.patch", patch: { radius: 3 } } as Op]);
    await s.flush();
    expect(s.state).toBe("error");
    s.retire();
    fail = false;
    await s.flush();                                                   // the retry (its timer is kept by retire)
    expect(saved.length).toBe(1);
    expect(s.busy).toBe(false);
    s.dispose();
  });
});

describe("a worker that stopped", () => {
  it("fails what waits and every later call, and tells its listeners once", async () => {
    const wire: Wire = { postMessage: () => { /* nobody answers */ }, onmessage: null };
    const port = new Port<PageMethods, CoreMethods, CoreEvents, PageEvents>(wire);
    const heard: string[] = [];
    port.onClose(e => heard.push(e.message));
    const first = port.call("flush", {});
    port.close(new Error("stopped"));
    port.close(new Error("again"));
    await expect(first).rejects.toThrow("stopped");
    await expect(port.call("apply", { label: "x", ops: [] })).rejects.toThrow("stopped");
    expect(heard).toEqual(["stopped"]);
    expect(port.closed?.message).toBe("stopped");
  });
});

describe("files", () => {
  const cfb = (stream: string) => {
    const b = new Uint8Array(2048); b.set([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
    for (let i = 0; i < stream.length; i++) { b[1024 + 2 * i] = stream.charCodeAt(i); b[1025 + 2 * i] = 0; }
    return b.buffer;
  };
  it("an encrypted .xlsx is refused as ENCRYPTED (not sent to Excel); an .xls stays CFB", async () => {
    expect(isEncryptedPackage(new Uint8Array(cfb("EncryptedPackage")))).toBe(true);
    await expect(indexWorkbook(cfb("EncryptedPackage"))).rejects.toMatchObject({ code: "ENCRYPTED" });
    await expect(indexWorkbook(cfb("Workbook"))).rejects.toMatchObject({ code: "CFB" });
  });
  it("empty, non-zip and truncated files are NOTZIP; a workbook with only hidden sheets lists none", async () => {
    for (const buf of [new ArrayBuffer(0), new TextEncoder().encode("hello").buffer, book("report.xlsx").slice(0, 4700), new Uint8Array([0x50, 0x4B, 3, 4]).buffer])
      await expect(indexWorkbook(buf as ArrayBuffer)).rejects.toMatchObject({ code: "NOTZIP" });
    const files = unzipSync(bytes("report.xlsx"));
    files["xl/workbook.xml"] = new TextEncoder().encode(new TextDecoder().decode(files["xl/workbook.xml"]).replace(/<sheet /g, '<sheet state="hidden" '));
    const z = zipSync(files), wb = await indexWorkbook(z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength) as ArrayBuffer);
    expect(wb.meta.length).toBe(0);
    expect(wb.hiddenSheets.length).toBeGreaterThan(0);
  });
});

describe("history and text boxes (05 §4 UN-05, NB-14)", () => {
  it("keeps the last 200 steps, and a new change clears redo", () => {
    const h = new History();
    for (let i = 0; i < MAX_STEPS + 25; i++) h.record("w", "step " + i, [], [], undefined, i * 2000);
    expect(MAX_STEPS).toBe(200);
    expect(h.undo.length).toBe(200);
    expect(h.undo[0].label).toBe("step 25");
    const a = h.take(false)!; h.done(a, false, true);
    expect(h.redo.length).toBe(1);
    h.record("w", "new", [], [], undefined, 1e9);
    expect(h.redo.length).toBe(0);
  });
  it("fitNoteSize shrinks 1 px at a time until the text fits, never below 9 px", () => {
    const note = {} as NoteMeasure;
    const fitsAt = (max: number): TextMeasurer => ({ maxDigitWidth: () => 7, noteFits: (_n, s) => s <= max });
    expect(fitNoteSize(note, 20, fitsAt(30))).toBe(20);
    expect(fitNoteSize(note, 20, fitsAt(14))).toBe(14);
    expect(fitNoteSize(note, 20, fitsAt(3))).toBe(9);
  });
});
