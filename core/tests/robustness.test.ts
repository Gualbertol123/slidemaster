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
import { resetPlatform, setPlatform } from "../src/platform";
import { FakeDeck } from "./fakedeck";
import { DocSync } from "../src/sync/docsync";
import { History, MAX_STEPS } from "../src/sync/history";
import { indexWorkbook, isEncryptedPackage } from "../src/xlsx/workbook";
import { MirrorWorkbook } from "../src/xlsx/mirror";
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
/** a new deck as the helper opens it (fakedeck.ts) */
const openDeck = (name: string) => new FakeDeck(name + "-0123456789", name).open("me@pc#mmmmmmmm");
const oneTable = (sheet: string): Preset => ({ sheets: [sheet], tables: [{ id: "t1", sheet, kind: "markers", anchor: "A1", index: 0 } as never], slides: [{ id: "s2", type: "content", title: null, subtitle: null, tables: ["t1"], layout: null } as never] });

/** a page connected to a host in this thread, with an in-memory helper */
function page() {
  const [a, b] = pair();
  serve(new Port<CoreMethods, PageMethods, PageEvents, CoreEvents>(b), { autoTail: false });
  const port = new Port<PageMethods, CoreMethods, CoreEvents, PageEvents>(a);
  // the helper's deck storage (fakedeck.ts): every append is stamped with the server's time
  const api = new FakeDeck("x-0123456789", "x").api();
  port.handle("deckSnapshot", () => api.snapshot(""));
  port.handle("deckTail", x => api.tail(x.key, x.since));
  port.handle("deckAppend", x => api.append(x.key, x.writer, x.record));
  port.handle("deckCompact", x => api.compact(x.key, x.baseGen, x.snapshot));
  port.handle("deckRotate", x => api.rotate(x.key, x.writer));
  port.handle("deckFormat5", x => api.format5(x.key));
  port.handle("deckPrepare", () => null);
  port.handle("digitWidth", () => 0);
  port.handle("convertPicture", () => null);
  port.handle("linkedWorkbook", () => null);
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
    setPlatform({ text: { maxDigitWidth: () => new Promise(r => setTimeout(() => r(7), 20)) } });
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

  it("overlapping index calls in any order: the newer one always gets its own workbook", async () => {
    setPlatform({ text: { maxDigitWidth: () => new Promise(r => setTimeout(() => r(7), 20)) } });
    type Info = Awaited<ReturnType<CoreMethods["index"]>>;
    for (const [older, newer] of [[() => padded("deck20.xlsx"), () => book("report.xlsx")], [() => book("deck20.xlsx"), () => padded("report.xlsx")], [() => book("report.xlsx"), () => book("deck20.xlsx")]] as const) {
      const p = page();
      await p.port.call("init", { served: false, client: "c", me: "me" });
      const [ra, rb] = await Promise.allSettled([p.port.call("index", transfer({ buf: older() }, [])), p.port.call("index", transfer({ buf: newer() }, []))]);
      // the newer open always succeeds, with its own number; the older one finished first (its own number) or gave up
      expect(rb.status).toBe("fulfilled");
      const ib = (rb as PromiseFulfilledResult<Info>).value;
      if (ra.status === "fulfilled") expect(ra.value.book).not.toBe(ib.book);
      else expect(ra.reason.code).toBe("SUPERSEDED");
      // what the newer number reads is the newer workbook (its preset uses its sheets), and it starts
      const names = new Set(ib.meta.map(m => m.name)), dp = await p.port.call("defaultPreset", { book: ib.book });
      expect(dp.tables.every(t => names.has(t.sheet))).toBe(true);
      await p.port.call("start", { book: ib.book, name: "x", deck: openDeck("x"), preset: dp, inputs });
    }
  });

  it("a start refused before the switch says so (NOT_STARTED): the open document stays", async () => {
    const p = page();
    await p.port.call("init", { served: false, client: "c", me: "me" });
    const ia = await p.port.call("index", transfer({ buf: book("report.xlsx") }, []));
    await p.port.call("start", { book: ia.book, name: "x", deck: openDeck("x"), preset: await p.port.call("defaultPreset", { book: ia.book }), inputs });
    const ib = await p.port.call("index", transfer({ buf: book("deck20.xlsx") }, []));
    await p.port.call("index", transfer({ buf: book("report.xlsx") }, []));          // a newer open
    const e = await p.port.call("start", { book: ib.book, name: "y", deck: openDeck("y"), preset: null, inputs }).catch(x => x);
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
    await p.port.call("start", { book: info.book, name: "x", deck: openDeck("x"), preset: cover, inputs });
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
    await p.port.call("start", { book: info.book, name: "x", deck: openDeck("x"), preset: { sheets: [], tables: [], slides: [] }, inputs });
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
    await p.port.call("start", { book: info.book, name: "x", deck: openDeck("x"), preset: await p.port.call("defaultPreset", { book: info.book }), inputs });
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
  it("a late tail answer does not take back what a newer one brought", async () => {
    const deck = new FakeDeck(), bob = "bob@pc#bbbbbbbb", base = deck.api();
    const slow: (() => void)[] = [];
    let slowNext = true;
    const api = { ...base, tail: (k: string, since: Record<string, number>) => {
      const answer = base.tail(k, since);
      if (slowNext) { slowNext = false; return new Promise<Awaited<typeof answer>>(r => slow.push(() => void answer.then(r))); }
      return answer; } };
    const s = new DocSync(api, "w.xlsx", deck.open("me@pc#mmmmmmmm"), "me", { autoTail: false });
    deck.doAppend(bob, { l: 1, w: bob, s: 1, by: "bob", ops: [{ op: "cell.patch", sheet: "S", ref: "A1", patch: { b: true } } as Op] });
    const p1 = s.poll();                                                                         // answered late
    deck.doAppend(bob, { l: 2, w: bob, s: 2, by: "bob", ops: [{ op: "cell.patch", sheet: "S", ref: "B2", patch: { i: true } } as Op] });
    await s.poll();                                                                              // one tail at a time: skipped
    s.apply([{ op: "cell.patch", sheet: "S", ref: "C3", patch: { b: true } } as Op]); await s.flush();
    slow.forEach(f => f()); await p1;
    await s.poll();
    expect(s.server.rev).toBe(3);
    expect((s.view.edits as Record<string, Record<string, unknown>>).S).toEqual({ A1: { b: true }, B2: { i: true }, C3: { b: true } });
    s.dispose();
  });

  it("a retired document (another workbook opened) keeps saving what it had queued", async () => {
    const deck = new FakeDeck();
    deck.failures.push("before");
    const s = new DocSync(deck.api(), "w", deck.open("me@pc#mmmmmmmm"), "me", { autoTail: false });
    s.apply([{ op: "style.patch", patch: { radius: 3 } } as Op]);
    await s.flush();
    expect(s.state).toBe("error");
    let told = 0;
    s.retire(() => told++);
    expect(told).toBe(0);                                              // not saved yet
    await s.flush();                                                   // the retry (its timer is kept by retire)
    expect(deck.records().length).toBe(1);
    expect(s.busy).toBe(false);
    expect(told).toBe(1);                                              // the page can stop warning on close
    s.dispose();
  });
});

describe("the open workbook while another is being opened", () => {
  it("indexing another workbook does not make the worker resend the open one's slices", async () => {
    const p = page();
    await p.port.call("init", { served: false, client: "c", me: "me" });
    const ia = await p.port.call("index", transfer({ buf: book("report.xlsx") }, []));
    await p.port.call("start", { book: ia.book, name: "x", deck: openDeck("x"), preset: await p.port.call("defaultPreset", { book: ia.book }), inputs });
    await p.port.call("index", transfer({ buf: book("deck20.xlsx") }, []));          // e.g. the wizard of another file is open
    const n = p.slices.length;
    await p.port.call("apply", { label: "R", ops: [{ op: "style.patch", patch: { radius: 9 } } as Op] });
    // the newest document sent (an event carries it only when it changed: the save after the 300 ms debounce sends
    // the deck's new health without it)
    await until(() => [...p.docs].reverse().find(d => d.view)?.view?.style.radius === 9);
    // a style change needs no new slices of the open workbook: nothing of book ia is sent again
    expect(p.slices.slice(n).filter(e => e.book === ia.book && (e.shared || e.sheets.length))).toEqual([]);
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
  /** a compound file with one directory entry named `stream` (and the same text again inside a stream's data) */
  const cfb = (stream: string) => {
    const b = new Uint8Array(2048); b.set([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
    const put = (at: number, s: string) => { for (let i = 0; i < s.length; i++) { b[at + 2 * i] = s.charCodeAt(i); b[at + 2 * i + 1] = 0; } };
    put(1024, stream); b[1024 + 64] = (stream.length + 1) * 2;               // the entry and its name length
    put(1536 + 10, "EncryptedPackage");                                      // the text in data: not an entry
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
});

describe("wallpaper", () => {
  it("is drawn once when it is asked for again while it is being drawn (the worker's warm-up and the first glass slide)", async () => {
    const { makeWall } = await import("../src/render/wallpaper");
    const { resolveStyle } = await import("../src/model/style");
    let surfaces = 0;
    const noop = () => undefined, grad = { addColorStop: noop };
    const ctx = new Proxy({}, { get: (_t, k) => k === "createLinearGradient" || k === "createRadialGradient" ? () => grad
      : k === "getImageData" ? () => ({ data: new Uint8ClampedArray(4) }) : noop, set: () => true });
    setPlatform({ text: { maxDigitWidth: () => 7 }, canvas: {
      create: () => { surfaces++; return { ctx: ctx as never, image: {} as never, toDataURL: () => new Promise<string>(r => setTimeout(() => r("data:image/jpeg;base64,AAAA"), 5)) }; },
      decode: () => Promise.reject(new Error("unused")) } });
    try {
      const st = resolveStyle({ contrast: 77 });                            // settings no other test draws
      const [a, b] = await Promise.all([makeWall(st), makeWall(st)]);
      expect(a).toBe(b);
      const per = surfaces;                                                 // the surfaces of one drawing
      expect(await makeWall(st)).toBe(a);
      expect(surfaces).toBe(per);
      expect(per).toBeLessThanOrEqual(3);                                   // sharp, deepened, blurred – once
    } finally { resetPlatform(); }
  });
});
